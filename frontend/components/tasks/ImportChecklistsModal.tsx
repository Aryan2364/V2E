'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Tooltip from '@/components/ui/tooltip'
import {
  X,
  Download,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  History,
  Undo2,
  ListChecks,
} from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import type {
  BulkImportChecklistRow,
  ChecklistImportValidationResult,
  ChecklistImportResult,
  ChecklistImportBatchSummary,
  ChecklistUndoImportResult,
} from '@/lib/types/tasks'
import { useToast } from '@/components/ui/Toast'

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
}

// Machine column keys, in template order.
const COLUMNS = ['checklist_name', 'item'] as const
type Column = (typeof COLUMNS)[number]

const HEADER_LABEL: Record<Column, string> = {
  checklist_name: 'Checklist Name *',
  item: 'Item *',
}

const COLUMN_ALIASES: Record<string, Column> = {
  checklist_name: 'checklist_name',
  checklist: 'checklist_name',
  name: 'checklist_name',
  template: 'checklist_name',
  template_name: 'checklist_name',
  item: 'item',
  items: 'item',
  task: 'item',
  step: 'item',
  checklist_item: 'item',
  line: 'item',
}

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function SummaryChip({ color, label }: { color: 'green' | 'red' | 'amber' | 'blue'; label: string }) {
  const styles = {
    green: 'bg-success-bg text-success',
    red: 'bg-danger-bg text-danger',
    amber: 'bg-warning-bg text-warning',
    blue: 'bg-primary-subtle text-primary-text',
  }[color]
  return <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${styles}`}>{label}</span>
}

export default function ImportChecklistsModal({ orgId, onClose, onImported }: Props) {
  const { addToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  type Phase = 'upload' | 'preview' | 'result' | 'history'
  const [phase, setPhase] = useState<Phase>('upload')
  const [fileName, setFileName] = useState('')
  const [parsedRows, setParsedRows] = useState<BulkImportChecklistRow[]>([])
  const [validation, setValidation] = useState<ChecklistImportValidationResult | null>(null)
  const [commitResult, setCommitResult] = useState<ChecklistImportResult | null>(null)
  const [parseError, setParseError] = useState('')
  const [building, setBuilding] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)

  const [batches, setBatches] = useState<ChecklistImportBatchSummary[]>([])
  const [undoResult, setUndoResult] = useState<ChecklistUndoImportResult | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)

  // ─── Template download ──────────────────────────────────────────────────────
  async function downloadTemplate() {
    setBuilding(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Checklists')

      ws.addRow(COLUMNS.map((c) => HEADER_LABEL[c]))
      const headerRow = ws.getRow(1)
      headerRow.height = 22
      headerRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      ws.columns = [{ width: 34 }, { width: 52 }]

      // Example: two checklists, one row per item (same name groups items).
      ws.addRow(['Client Onboarding', 'Collect KYC documents'])
      ws.addRow(['Client Onboarding', 'Create account'])
      ws.addRow(['Client Onboarding', 'Send welcome email'])
      ws.addRow(['Vendor Setup', 'Verify GST number'])
      ws.addRow(['Vendor Setup', 'Sign NDA'])

      // A short instructions sheet.
      const wsInfo = wb.addWorksheet('How to use')
      wsInfo.columns = [{ width: 90 }]
      const lines = [
        'How to fill this file',
        '',
        '1. Put one checklist ITEM per row.',
        '2. Rows that share the same "Checklist Name" become ONE checklist template.',
        '3. You can add as many checklists as you like in this one file.',
        '4. Both columns are required. Blank rows are ignored.',
        '5. Imported checklists arrive INACTIVE — set "Who can use this checklist", then activate each.',
      ]
      lines.forEach((t, i) => {
        wsInfo.addRow([t])
        if (i === 0) wsInfo.getRow(1).font = { bold: true, size: 13 }
      })

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'checklist-import-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('Could not build the template. Please try again.', 'error')
    } finally {
      setBuilding(false)
    }
  }

  // ─── Parsing ────────────────────────────────────────────────────────────────
  function gridToRows(grid: string[][]): { rows: BulkImportChecklistRow[]; error?: string } {
    if (grid.length === 0) return { rows: [], error: 'The file is empty.' }
    const header = grid[0].map(normalizeHeader)
    const idx: Partial<Record<Column, number>> = {}
    header.forEach((h, i) => {
      const col = COLUMN_ALIASES[h]
      if (col && idx[col] === undefined) idx[col] = i
    })
    if (idx.checklist_name === undefined || idx.item === undefined) {
      return { rows: [], error: 'Could not find the required "Checklist Name" and "Item" columns. Download the template to see the expected format.' }
    }
    const parsed: BulkImportChecklistRow[] = []
    for (let r = 1; r < grid.length; r++) {
      const cells = grid[r]
      if (!cells || cells.every((c) => (c ?? '').trim() === '')) continue
      const get = (c: Column) => {
        const i = idx[c]
        return i !== undefined ? (cells[i] ?? '').trim() : ''
      }
      parsed.push({ checklist_name: get('checklist_name'), item: get('item') })
    }
    if (parsed.length === 0) return { rows: [], error: 'No data rows found below the header.' }
    return { rows: parsed }
  }

  async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
    const mod: any = await import('exceljs')
    const ExcelJS = mod.default ?? mod
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.getWorksheet('Checklists') ?? wb.worksheets[0]
    if (!ws) return []
    const cellText = (cell: any): string => {
      const v = cell?.value
      if (v == null) return ''
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('')
        if (typeof v.text === 'string') return v.text
        if ('result' in v) return v.result == null ? '' : String(v.result)
        return ''
      }
      return String(v)
    }
    const headerRow = ws.getRow(1)
    const colCount = Math.max(headerRow.cellCount, COLUMNS.length)
    const grid: string[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c)))
      grid.push(cells)
    }
    return grid
  }

  async function runValidation(rows: BulkImportChecklistRow[]) {
    setValidating(true)
    try {
      const res = await tasksApi.validateChecklistImport(orgId, rows)
      setValidation(res)
      setPhase('preview')
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Could not validate the file. Please try again.'
      setParseError(Array.isArray(msg) ? msg.join(', ') : msg)
    } finally {
      setValidating(false)
    }
  }

  function handleFile(file: File) {
    setParseError('')
    setValidation(null)
    setCommitResult(null)
    setParsedRows([])
    setFileName(file.name)
    const finish = (grid: string[][]) => {
      const { rows: parsed, error } = gridToRows(grid)
      if (error) { setParseError(error); return }
      setParsedRows(parsed)
      runValidation(parsed)
    }
    if (/\.xlsx$/i.test(file.name)) {
      file.arrayBuffer().then(parseXlsx).then(finish).catch(() => setParseError('Could not read this Excel file. Make sure it is a valid .xlsx.'))
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        try { finish(parseCsv(String(reader.result ?? ''))) } catch { setParseError('Could not read this file. Make sure it is a valid CSV.') }
      }
      reader.onerror = () => setParseError('Could not read this file.')
      reader.readAsText(file)
    }
  }

  // ─── Commit ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    setImporting(true)
    try {
      const res = await tasksApi.commitChecklistImport(orgId, parsedRows, fileName)
      setCommitResult(res)
      setPhase('result')
      if (res.created > 0) {
        addToast(`Imported ${res.created} checklist${res.created !== 1 ? 's' : ''}`, res.failed > 0 ? 'warning' : 'success')
        onImported()
      } else {
        addToast('No checklists were imported', 'error')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Import failed. Please try again.'
      setParseError(Array.isArray(msg) ? msg.join(', ') : msg)
    } finally {
      setImporting(false)
    }
  }

  // ─── History + undo ───────────────────────────────────────────────────────────
  async function openHistory() {
    setPhase('history')
    setUndoResult(null)
    try { setBatches(await tasksApi.listChecklistImportBatches(orgId)) } catch { setBatches([]) }
  }

  async function handleUndo(batchId: string) {
    setUndoingId(batchId)
    try {
      const res = await tasksApi.undoChecklistImport(orgId, batchId)
      setUndoResult(res)
      addToast(res.undone > 0 ? `Removed ${res.undone} imported checklist${res.undone !== 1 ? 's' : ''}` : 'Nothing was removed', res.kept.length > 0 ? 'warning' : 'success')
      onImported()
      setBatches(await tasksApi.listChecklistImportBatches(orgId))
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Undo failed.'
      addToast(Array.isArray(msg) ? msg.join(', ') : msg, 'error')
    } finally {
      setUndoingId(null)
    }
  }

  function resetToUpload() {
    setPhase('upload')
    setParsedRows([])
    setValidation(null)
    setCommitResult(null)
    setParseError('')
    setFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const visibleRows = useMemo(() => {
    if (!validation) return []
    return onlyProblems ? validation.rows.filter((r) => r.status !== 'ready' || r.issues.length > 0) : validation.rows
  }, [validation, onlyProblems])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-3xl sm:rounded-xl rounded-t-xl shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div className="flex items-center gap-3">
            {(phase === 'preview' || phase === 'history') && (
              <button
                onClick={phase === 'history' ? resetToUpload : () => setPhase('upload')}
                className="p-1.5 rounded-[6px] text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
                aria-label="Back"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="text-[18px] font-medium text-text-primary">
              {phase === 'preview' ? 'Review before importing' : phase === 'history' ? 'Import history' : phase === 'result' ? 'Import complete' : 'Import Checklists'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {phase === 'upload' && (
              <button
                onClick={openHistory}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] font-medium text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
              >
                <History size={15} /> History
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto space-y-4">
          {/* ── Upload ── */}
          {phase === 'upload' && (
            <>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary-subtle border border-primary-border">
                <FileText size={18} className="text-primary-text mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Step 1 — Download the Excel template</p>
                  <p className="text-[13px] text-text-secondary mt-0.5">
                    Put <strong>one item per row</strong>. Rows that share the same <strong>Checklist Name</strong> become one
                    checklist — so a single file can hold <strong>many checklists</strong>. Imported checklists arrive{' '}
                    <strong>inactive</strong> so you can set who can use each one, then activate it.
                  </p>
                  <button
                    onClick={downloadTemplate}
                    disabled={building}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
                  >
                    {building ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {building ? 'Building…' : 'Download Excel template'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-text-primary mb-2">Step 2 — Upload the filled file to review</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-surface-sunken transition-colors"
                >
                  {validating ? <Loader2 size={26} className="text-primary-text animate-spin" /> : <UploadCloud size={26} className="text-text-muted" />}
                  <span className="text-sm font-medium text-text-secondary">
                    {validating ? 'Checking your file…' : fileName || 'Click to choose an .xlsx or .csv file'}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
              </div>

              {parseError && (
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-sm text-danger">{parseError}</div>
              )}
            </>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && validation && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <SummaryChip color="blue" label={`${validation.templates} checklist${validation.templates !== 1 ? 's' : ''}`} />
                <SummaryChip color="green" label={`${validation.ready} item${validation.ready !== 1 ? 's' : ''} ready`} />
                {validation.errors > 0 && <SummaryChip color="red" label={`${validation.errors} error${validation.errors !== 1 ? 's' : ''}`} />}
                {validation.warnings > 0 && <SummaryChip color="amber" label={`${validation.warnings} warning${validation.warnings !== 1 ? 's' : ''}`} />}
                <span className="ml-auto text-xs text-text-muted truncate max-w-[40%]">from {fileName}</span>
              </div>

              {/* Grouped checklists preview */}
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Checklists to create</p>
                {validation.groups.filter((g) => g.items.length > 0).length === 0 && (
                  <p className="text-sm text-text-muted">No valid checklists found. Fix the errors below and re-upload.</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {validation.groups.filter((g) => g.items.length > 0).map((g, i) => (
                    <div key={i} className="border border-border-light rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">{g.name}</span>
                        <span className="shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 bg-primary-subtle text-primary-text">{g.items.length} item{g.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      {g.already_exists && (
                        <span className="inline-block mt-1 text-[11px] font-medium text-warning">A checklist with this name already exists</span>
                      )}
                      <ul className="mt-1.5 space-y-0.5">
                        {g.items.slice(0, 4).map((it, j) => (
                          <li key={j} className="text-xs text-text-secondary truncate">• {it}</li>
                        ))}
                        {g.items.length > 4 && <li className="text-xs text-text-muted">+{g.items.length - 4} more</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Problem rows */}
              {(validation.errors > 0 || validation.warnings > 0) && (
                <div>
                  <label className="flex items-center gap-2 text-[13px] text-text-secondary mb-2">
                    <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="rounded-xs border-border" />
                    Show only rows with problems
                  </label>
                  <div className="border border-border-light rounded-lg overflow-hidden">
                    <div className="max-h-[34vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-sunken sticky top-0">
                          <tr className="text-left text-xs text-text-muted">
                            <th className="px-3 py-2 font-medium w-12">Row</th>
                            <th className="px-3 py-2 font-medium">Checklist</th>
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((r) => (
                            <tr key={r.row} className="border-t border-border-light align-top">
                              <td className="px-3 py-2 text-text-muted">{r.row}</td>
                              <td className="px-3 py-2 text-text-primary truncate max-w-[140px]">{r.checklist_name || <span className="text-danger">—</span>}</td>
                              <td className="px-3 py-2 text-text-secondary truncate max-w-[160px]">{r.item || <span className="text-danger">—</span>}</td>
                              <td className="px-3 py-2">
                                {r.issues.length === 0 ? (
                                  <span className="inline-flex items-center gap-1 text-success text-xs"><CheckCircle2 size={13} /> OK</span>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {r.issues.map((iss, k) => (
                                      <li key={k} className={`inline-flex items-center gap-1 text-xs ${iss.severity === 'error' ? 'text-danger' : 'text-warning'}`}>
                                        {iss.severity === 'error' ? <AlertCircle size={12} /> : <AlertTriangle size={12} />} {iss.message}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleImport}
                  disabled={importing || validation.templates === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
                >
                  {importing ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />}
                  {importing ? 'Importing…' : `Import ${validation.templates} checklist${validation.templates !== 1 ? 's' : ''}`}
                </button>
                <button onClick={() => setPhase('upload')} className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary bg-surface border border-border-light hover:bg-surface-control transition-colors">Choose another file</button>
              </div>
            </>
          )}

          {/* ── Result ── */}
          {phase === 'result' && commitResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <SummaryChip color="green" label={`${commitResult.created} created`} />
                {commitResult.failed > 0 && <SummaryChip color="red" label={`${commitResult.failed} failed`} />}
              </div>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-warning-border">
                <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />
                <p className="text-[13px] text-warning">
                  Imported checklists are <strong>inactive</strong>. Open each one, set <strong>“Who can use this checklist”</strong>,
                  then <strong>activate</strong> it so it appears when creating tasks.
                </p>
              </div>
              {commitResult.batch_id && (
                <button
                  onClick={() => handleUndo(commitResult.batch_id as string)}
                  disabled={undoingId === commitResult.batch_id}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-danger bg-surface border border-danger-border hover:bg-danger-bg transition-colors"
                >
                  {undoingId === commitResult.batch_id ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}
                  Undo this import
                </button>
              )}
              {undoResult && (
                <p className="text-sm text-text-secondary">Removed {undoResult.undone}. {undoResult.kept.length > 0 && `Kept ${undoResult.kept.length} (already activated).`}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={resetToUpload} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover transition-colors">Import another file</button>
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary bg-surface border border-border-light hover:bg-surface-control transition-colors">Done</button>
              </div>
            </div>
          )}

          {/* ── History ── */}
          {phase === 'history' && (
            <div className="space-y-3">
              {batches.length === 0 && <p className="text-sm text-text-muted text-center py-8">No imports yet.</p>}
              {batches.map((b) => (
                <div key={b.id} className="border border-border-light rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{b.file_name || 'Checklist import'}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {new Date(b.created_at).toLocaleString()} · by {b.imported_by}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <SummaryChip color="green" label={`${b.created_count} created`} />
                        {b.failed_count > 0 && <SummaryChip color="red" label={`${b.failed_count} failed`} />}
                        <SummaryChip color="blue" label={`${b.remaining} remaining`} />
                        {b.status !== 'committed' && <SummaryChip color="amber" label={b.status === 'undone' ? 'undone' : 'partly undone'} />}
                      </div>
                    </div>
                    <Tooltip label={b.can_undo ? 'Remove the still-inactive checklists from this import' : 'Nothing left to undo'}>
                    <button
                      onClick={() => handleUndo(b.id)}
                      disabled={!b.can_undo || undoingId === b.id}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-danger bg-surface border border-danger-border hover:bg-danger-bg disabled:text-text-muted disabled:border-border-light disabled:hover:bg-surface transition-colors"
                    >
                      {undoingId === b.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                      Undo
                    </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
