'use client'

// One wizard for every bulk import: template download -> upload -> (optional server
// validation and review) -> commit -> result, plus import history with undo and batch
// detail. Each import supplies an ImportConfig; nothing here knows about employees,
// tasks or any other entity.

import { useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Download, FileText, History, RefreshCw, ShieldAlert, Undo2, UploadCloud, X, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { apiErrorMessage, parseCsv } from '@/lib/import/csv'
import { gridToRows } from '@/lib/import/parse'
import { downloadErrorReport, downloadTemplateXlsx, readXlsxGrid } from '@/lib/import/xlsx'
import type {
  DetailOrigin,
  ErrorReportEntry,
  ImportConfig,
  ImportPhase,
  ImportViewCtx,
} from '@/lib/import/types'

/** State of the template button while its reference data loads (tasks load options first). */
export interface TemplateGate {
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  error?: string | null
  onRetry?: () => void
}

interface Props<K extends string, TRow, TVal, TRes, TBatch extends { id: string }, TDetail extends { id: string }, TUndo> {
  config: ImportConfig<K, TRow, TVal, TRes, TBatch, TDetail, TUndo>
  onClose: () => void
  /** Called after an undo changed data, so the page can refresh. */
  onChanged: () => void
  /** Render inline inside another modal: no own dialog, no close button, no full-page preview. */
  embedded?: boolean
  templateGate?: TemplateGate
  /** Runs when the wizard returns to the upload step (clear entity-local state). */
  onReset?: () => void
  /** Error-report columns and widths; reports are disabled when absent. */
  report?: { colWidth: number }
}

export default function BulkImportWizard<
  K extends string,
  TRow,
  TVal,
  TRes,
  TBatch extends { id: string },
  TDetail extends { id: string },
  TUndo,
>({
  config,
  onClose,
  onChanged,
  embedded = false,
  templateGate,
  onReset,
  report,
}: Props<K, TRow, TVal, TRes, TBatch, TDetail, TUndo>) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<ImportPhase>('upload')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<TRow[]>([])
  const [sourceRows, setSourceRows] = useState<number[]>([])
  const [validation, setValidation] = useState<TVal | null>(null)
  const [result, setResult] = useState<TRes | null>(null)
  const [parseError, setParseError] = useState('')
  const [building, setBuilding] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [batches, setBatches] = useState<TBatch[]>([])
  const [undoResult, setUndoResult] = useState<TUndo | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null)
  const [detail, setDetail] = useState<TDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin>('history')

  const isValidateFlow = !!config.validate && !!config.preview
  const preview = config.preview

  // ─── Template ──────────────────────────────────────────────────────────────
  async function downloadTemplate() {
    setBuilding(true)
    try {
      await downloadTemplateXlsx(config.template.build, config.template.fileName)
    } catch {
      toast.error('Could not build the template. Please try again.')
    } finally {
      setBuilding(false)
    }
  }

  // ─── Upload / parse ────────────────────────────────────────────────────────
  async function runValidation(parsed: TRow[]) {
    if (!config.validate) return
    setValidating(true)
    try {
      setValidation(await config.validate(parsed))
      setPhase('preview')
    } catch (err) {
      setParseError(apiErrorMessage(err, 'Could not validate the file. Please try again.'))
    } finally {
      setValidating(false)
    }
  }

  function handleFile(file: File) {
    setParseError('')
    setValidation(null)
    setResult(null)
    setRows([])
    setFileName(file.name)

    const finish = (grid: string[][]) => {
      const parsed = gridToRows<K, TRow>(grid, config.columns, config.parse)
      if (parsed.error) {
        setParseError(parsed.error)
        return
      }
      setRows(parsed.rows)
      setSourceRows(parsed.sourceRows)
      void runValidation(parsed.rows)
    }

    if (/\.xlsx$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buf) =>
          readXlsxGrid(buf, {
            sheetName: config.parse.sheetName,
            minColumns: config.columns.length,
            dateMode: config.parse.dateMode,
          }),
        )
        .then(finish)
        .catch(() => setParseError('Could not read this Excel file. Make sure it is a valid .xlsx.'))
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          finish(parseCsv(String(reader.result ?? '')))
        } catch {
          setParseError('Could not read this file. Make sure it is a valid CSV.')
        }
      }
      reader.onerror = () => setParseError('Could not read this file.')
      reader.readAsText(file)
    }
  }

  function resetToUpload() {
    setPhase('upload')
    setRows([])
    setSourceRows([])
    setValidation(null)
    setResult(null)
    setParseError('')
    setFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    onReset?.()
  }

  // ─── Commit ────────────────────────────────────────────────────────────────
  async function importNow() {
    if (isValidateFlow ? !validation : rows.length === 0) return
    setConfirmOpen(false)
    setImporting(true)
    try {
      const out = await config.commit(rows, fileName, sourceRows)
      setResult(out.result)
      if (out.openBatchId && config.history.detail) await openBatch(out.openBatchId, 'import')
      else setPhase('result')
    } catch (err) {
      const msg = apiErrorMessage(err, config.commitErrorFallback)
      if (config.commitErrorMode === 'toast') toast.error(msg)
      else setParseError(msg)
    } finally {
      setImporting(false)
    }
  }

  function requestImport() {
    if (preview?.confirm) setConfirmOpen(true)
    else void importNow()
  }

  // ─── History, batch detail, undo ───────────────────────────────────────────
  async function openHistory() {
    setPhase('history')
    setUndoResult(null)
    try {
      setBatches(await config.history.list())
    } catch {
      setBatches([])
    }
  }

  async function openBatch(batchId: string, origin: DetailOrigin = 'history') {
    const loadDetail = config.history.detail
    if (!loadDetail) return
    setDetailOrigin(origin)
    setPhase('batch-detail')
    setDetail(null)
    setLoadingDetail(true)
    try {
      setDetail(await loadDetail(batchId))
    } catch {
      toast.error('Could not load this import’s details.')
      if (origin === 'history') setPhase('history')
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleUndo(batchId: string) {
    setUndoingId(batchId)
    try {
      const res = await config.history.undo(batchId)
      setUndoResult(res)
      const t = config.history.undoToast(res)
      toast[t.kind](t.message)
      onChanged()
      try {
        setBatches(await config.history.list())
      } catch {
        setBatches([])
      }
      // If a detail view is open for this batch, refresh it to reflect removals.
      if (config.history.detail && detail?.id === batchId) {
        try {
          setDetail(await config.history.detail(batchId))
        } catch {
          /* keep the stale detail rather than blanking the view */
        }
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, config.history.undoErrorFallback))
    } finally {
      setUndoingId(null)
    }
  }

  function requestUndo(id: string) {
    if (config.history.undoConfirm) setUndoConfirm(id)
    else void handleUndo(id)
  }

  async function downloadReport(entries: ErrorReportEntry[], filename: string) {
    if (!report || entries.length === 0) return
    try {
      await downloadErrorReport(config.columns, entries, filename, report.colWidth)
    } catch {
      toast.error('Could not build the file.')
    }
  }

  const ctx: ImportViewCtx<TRow, TVal, TRes, TBatch, TDetail, TUndo> = {
    fileName,
    rows,
    validation,
    result,
    undoResult,
    batches,
    detail,
    loadingDetail,
    detailOrigin,
    importing,
    undoingId,
    excelRow: (n) => sourceRows[n - 2] ?? n,
    setPhase,
    openBatch: (id, origin) => void openBatch(id, origin),
    requestUndo,
    importNow: () => void importNow(),
    requestImport,
    chooseAnotherFile: () => setPhase('upload'),
    downloadReport: (entries, filename) => void downloadReport(entries, filename),
  }

  // ─── Layout ────────────────────────────────────────────────────────────────
  const isFullPage = phase === 'preview' && !!preview?.fullPage && !embedded
  const title =
    config.phaseTitles?.[phase] ??
    (phase === 'preview'
      ? 'Review before importing'
      : phase === 'history'
        ? 'Import history'
        : phase === 'batch-detail'
          ? 'Import details'
          : config.title)

  const showBack =
    phase === 'history' || phase === 'batch-detail' || (phase === 'preview' && !!preview?.backArrow)
  const onBack = () => {
    if (phase === 'history') {
      if (isValidateFlow) resetToUpload()
      else setPhase('upload')
    } else if (phase === 'batch-detail') {
      if (detailOrigin === 'import') resetToUpload()
      else void openHistory()
    } else setPhase('upload')
  }

  const titleNode = embedded ? (
    <h2 className="text-card-heading font-medium text-text-primary">{title}</h2>
  ) : (
    <DialogTitle className="text-card-heading font-medium text-text-primary">{title}</DialogTitle>
  )

  const gate = templateGate ?? {}
  const historyButton = (
    <Button variant="secondary" size="sm" onClick={() => void openHistory()}>
      <History size={15} /> {config.historyButtonLabel}
    </Button>
  )

  const shell = (
    <>
      <div
        className={
          embedded
            ? 'flex flex-col flex-1 min-h-0 bg-surface'
            : `bg-surface shadow-xl flex flex-col ${isFullPage ? 'w-full h-full max-h-none rounded-none' : 'w-full sm:max-w-3xl sm:rounded-xl rounded-t-xl max-h-[92vh]'}`
        }
      >
        {/* Header — hidden on the embedded upload step (the host modal frames it). */}
        {!(embedded && phase === 'upload') && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
            <div className="flex items-center gap-3">
              {showBack && (
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Back" onClick={onBack} />}>
                    <ArrowLeft size={18} />
                  </TooltipTrigger>
                  <TooltipContent>Back</TooltipContent>
                </Tooltip>
              )}
              {titleNode}
            </div>
            <div className="flex items-center gap-1">
              {phase === 'upload' && !embedded && historyButton}
              {!embedded && (
                <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                  <X size={18} />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className={`px-6 py-4 overflow-y-auto space-y-4 ${isFullPage || embedded ? 'flex-1 min-h-0' : ''}`}>
          {phase === 'upload' && (
            <>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary-subtle border border-primary-border">
                <FileText size={18} className="text-primary-text mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary">Step 1 — Download the Excel template</p>
                  <div className="text-body text-text-secondary mt-0.5">{config.uploadIntro}</div>
                  {gate.error ? (
                    <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-danger-bg border border-danger-border">
                      <AlertCircle size={15} className="text-danger mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-body text-danger">{gate.error}</p>
                        <Button size="sm" onClick={gate.onRetry} loading={gate.loading} loadingLabel="Retrying…">
                          <RefreshCw size={13} /> Retry
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="mt-3"
                      onClick={() => void downloadTemplate()}
                      disabled={gate.disabled}
                      loading={building || gate.loading}
                      loadingLabel={gate.loading ? (gate.loadingLabel ?? 'Loading…') : 'Building…'}
                    >
                      <Download size={15} /> Download Excel template
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-body font-medium text-text-primary">{config.uploadStep2Label}</p>
                  {embedded && historyButton}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-surface-sunken transition-colors"
                >
                  {validating ? (
                    <Loader2 size={26} className="text-primary-text animate-spin" />
                  ) : (
                    <UploadCloud size={26} className="text-text-muted" />
                  )}
                  <span className="text-label font-medium text-text-secondary">
                    {validating ? 'Checking your file…' : fileName || 'Click to choose an .xlsx or .csv file'}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </div>

              {parseError && (
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">{parseError}</div>
              )}

              {!isValidateFlow && rows.length > 0 && !parseError && (
                <div className="p-3 bg-success-bg border border-success-border rounded-lg text-body text-success">
                  Ready to import <span className="font-medium">{rows.length}</span> {config.directNoun}
                  {rows.length !== 1 ? 's' : ''} from <span className="font-medium">{fileName}</span>.
                </div>
              )}
            </>
          )}

          {phase === 'preview' && validation && preview && (
            <>
              {parseError && (
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">{parseError}</div>
              )}
              {preview.render(ctx)}
            </>
          )}
          {phase === 'result' && result && config.renderResult(ctx)}
          {phase === 'history' && config.history.render(ctx)}
          {phase === 'batch-detail' && config.history.renderDetail?.(ctx)}
        </div>

        {/* Footer — review */}
        {phase === 'preview' && validation && preview?.footerWarning && (
          <div className="flex items-center gap-4 px-6 py-4 border-t border-border-light">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <ShieldAlert size={16} className="text-warning mt-0.5 shrink-0" />
              <p className="text-meta leading-snug text-warning">{preview.footerWarning(validation)}</p>
            </div>
            <Button variant="secondary" className="shrink-0" onClick={() => setPhase('upload')}>
              Choose another file
            </Button>
            <Button
              className="shrink-0"
              onClick={requestImport}
              disabled={preview.readyCount(validation) === 0}
              loading={importing}
              loadingLabel="Importing…"
            >
              {preview.importLabel(preview.readyCount(validation))}
            </Button>
          </div>
        )}

        {/* Footer — direct import (no review step) */}
        {phase === 'upload' && !isValidateFlow && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void importNow()} disabled={rows.length === 0} loading={importing} loadingLabel="Importing…">
              {`Import${rows.length > 0 ? ` ${rows.length}` : ''}`}
            </Button>
          </div>
        )}

        {/* Footer — finished (result, or a fresh import's detail page) */}
        {(phase === 'result' || (phase === 'batch-detail' && detailOrigin === 'import')) && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
            <Button variant="secondary" onClick={resetToUpload}>
              Import another file
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      </div>

      {/* Import confirmation */}
      {preview?.confirm && (
        <AlertDialog open={confirmOpen && !!validation} onOpenChange={(next) => !next && setConfirmOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${preview.confirm.tone === 'danger' ? 'bg-danger-bg' : 'bg-primary-subtle'}`}
                >
                  {preview.confirm.tone === 'danger' ? (
                    <ShieldAlert size={20} className="text-danger" />
                  ) : (
                    <CheckCircle2 size={20} className="text-primary-text" />
                  )}
                </div>
                <div>
                  <AlertDialogTitle>{validation ? preview.confirm.title(validation) : ''}</AlertDialogTitle>
                  <AlertDialogDescription>{preview.confirm.description}</AlertDialogDescription>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go back</AlertDialogCancel>
              <AlertDialogAction
                variant={preview.confirm.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => void importNow()}
              >
                Yes, import now
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Undo confirmation */}
      {config.history.undoConfirm && (
        <AlertDialog open={!!undoConfirm} onOpenChange={(next) => !next && setUndoConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center shrink-0">
                  <Undo2 size={20} className="text-danger" />
                </div>
                <div>
                  <AlertDialogTitle>Undo this import?</AlertDialogTitle>
                  <AlertDialogDescription>{config.history.undoConfirm.description}</AlertDialogDescription>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go back</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const id = undoConfirm
                  setUndoConfirm(null)
                  if (id) void handleUndo(id)
                }}
              >
                <Undo2 size={14} /> Yes, undo import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )

  if (embedded) return shell
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        size="lg"
        showCloseButton={false}
        className={
          isFullPage ? 'max-w-none! w-screen h-[100dvh] max-h-[100dvh]! rounded-none! p-0' : 'max-w-3xl max-h-[92vh] p-0'
        }
      >
        {shell}
      </DialogContent>
    </Dialog>
  )
}
