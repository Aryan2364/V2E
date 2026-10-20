'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Download,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  Undo2,
} from 'lucide-react'
import { createRole, listImportBatches, createImportBatch, undoImport } from '@/lib/api/roles'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import ImportDialog from '@/components/imports/ImportDialog'
import { useGuardedClose } from '@/lib/use-guarded-close'
import type { Department, RoleLevel } from '@/lib/types'
import { formatDateTime } from '@/lib/format'

interface Props {
  orgId: string
  departments: Department[]
  onClose: () => void
  onImported: () => void
}

interface ImportRow {
  title: string
  department: string
  level: string
  job_description: string
}

interface RowResult {
  row: number
  title: string
  status: 'created' | 'failed'
  error?: string
}

const COLUMNS = ['title', 'department', 'level', 'job_description'] as const
type Column = (typeof COLUMNS)[number]

const HEADER_LABEL: Record<Column, string> = {
  title: 'title *',
  department: 'department *',
  level: 'level',
  job_description: 'job_description',
}

const COLUMN_ALIASES: Record<string, Column> = {
  title: 'title',
  role: 'title',
  job_role: 'title',
  name: 'title',
  department: 'department',
  dept: 'department',
  level: 'level',
  seniority: 'level',
  job_description: 'job_description',
  description: 'job_description',
  jd: 'job_description',
}

const LEVELS: RoleLevel[] = ['head', 'senior', 'mid', 'junior']

function normalizeHeader(h: string): string {
  return h
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((v) => v && v.trim() !== '')))
}

const norm = (s: string) => s.trim().toLowerCase()

// ─── CSV parser (RFC-4180-ish; handles quotes, escaped quotes, CRLF) ────────────
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
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export default function ImportJobRolesModal({ orgId, departments, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<{ created: number; failed: number; results: RowResult[] } | null>(
    null,
  )

  type Phase = 'upload' | 'history'
  const [phase, setPhase] = useState<Phase>('upload')
  const [batches, setBatches] = useState<any[]>([])
  const [undoResult, setUndoResult] = useState<any | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)

  async function loadHistory() {
    try {
      const data = await listImportBatches(orgId)
      setBatches(data)
    } catch {
      setBatches([])
    }
  }

  async function handleUndo(batchId: string) {
    setUndoingId(batchId)
    setUndoResult(null)
    try {
      const res = await undoImport(orgId, batchId)
      setUndoResult(res)
      toast.success('Import undone successfully')
      onImported()
      loadHistory()
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Could not undo this import'
      toast.error(msg)
    } finally {
      setUndoingId(null)
    }
  }

  // ─── Template (.xlsx with dropdowns) ──────────────────────────────────────────
  async function downloadTemplate() {
    setBuilding(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Job Roles')
      const lists = wb.addWorksheet('Lists')
      lists.state = 'veryHidden'

      const deptNames = uniq(departments.map((d) => d.name))
      deptNames.forEach((v, i) => (lists.getCell(i + 1, 1).value = v)) // col A
      LEVELS.forEach((v, i) => (lists.getCell(i + 1, 2).value = v)) // col B

      ws.addRow(COLUMNS.map((c) => HEADER_LABEL[c]))
      const headerRow = ws.getRow(1)
      headerRow.height = 22
      headerRow.eachCell((cell: any, col: number) => {
        const key = COLUMNS[col - 1]
        const required = key === 'title' || key === 'department'
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: required ? 'FF1E40AF' : 'FF475569' },
        }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      ws.columns.forEach((c: any) => (c.width = 28))

      const sampleDept = departments[0]?.name ?? 'Engineering'
      ws.addRow(['Senior Engineer', sampleDept, 'senior', 'Owns delivery of core services'])
      ws.addRow(['Engineer', sampleDept, 'mid', ''])

      const LAST = 300
      const addListDV = (col: number, formula: string) => {
        const letter = String.fromCharCode(64 + col)
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${letter}${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [formula],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Pick from the list',
            error: 'Choose a value from the dropdown, or clear the cell.',
          }
        }
      }
      addListDV(2, `Lists!$A$1:$A$${Math.max(deptNames.length, 1)}`) // department
      addListDV(3, `Lists!$B$1:$B$${LEVELS.length}`) // level

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'job-role-import-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not build the template. Please try again.')
    } finally {
      setBuilding(false)
    }
  }

  // ─── Parsing ──────────────────────────────────────────────────────────────────
  function gridToRows(grid: string[][]): { rows: ImportRow[]; error?: string } {
    if (grid.length === 0) return { rows: [], error: 'The file is empty.' }
    const header = grid[0].map(normalizeHeader)
    const idx: Partial<Record<Column, number>> = {}
    header.forEach((h, i) => {
      const col = COLUMN_ALIASES[h]
      if (col && idx[col] === undefined) idx[col] = i
    })
    if (idx.title === undefined || idx.department === undefined) {
      return {
        rows: [],
        error:
          'Could not find the required "title" and "department" columns. Download the template to see the expected format.',
      }
    }
    const parsed: ImportRow[] = []
    for (let r = 1; r < grid.length; r++) {
      const cells = grid[r]
      if (!cells || cells.every((c) => (c ?? '').trim() === '')) continue
      const get = (c: Column) => {
        const i = idx[c]
        return i !== undefined ? (cells[i] ?? '').trim() : ''
      }
      parsed.push({
        title: get('title'),
        department: get('department'),
        level: get('level'),
        job_description: get('job_description'),
      })
    }
    if (parsed.length === 0) return { rows: [], error: 'No data rows found below the header.' }
    return { rows: parsed }
  }

  async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
    const mod: any = await import('exceljs')
    const ExcelJS = mod.default ?? mod
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    if (!ws) return []
    const cellText = (cell: any): string => {
      const v = cell?.value
      if (v == null) return ''
      if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('')
        if (typeof v.text === 'string') return v.text
        if ('result' in v) return v.result == null ? '' : String(v.result)
        return ''
      }
      return String(v)
    }
    const colCount = Math.max(ws.getRow(1).cellCount, COLUMNS.length)
    const grid: string[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c)))
      grid.push(cells)
    }
    return grid
  }

  function handleFile(file: File) {
    setParseError('')
    setResult(null)
    setRows([])
    setFileName(file.name)
    const finish = (grid: string[][]) => {
      const { rows: parsed, error } = gridToRows(grid)
      if (error) {
        setParseError(error)
        return
      }
      setRows(parsed)
    }
    if (/\.xlsx$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then(parseXlsx)
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

  // ─── Import ─────────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)

    const deptByName = new Map(departments.map((d) => [norm(d.name), d.id]))
    const results: RowResult[] = []

    const createdRoleIds: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const line = i + 2 // header is line 1
      if (!row.title) {
        results.push({ row: line, title: '(blank)', status: 'failed', error: 'Title is required.' })
        continue
      }
      const departmentId = deptByName.get(norm(row.department))
      if (!departmentId) {
        results.push({
          row: line,
          title: row.title,
          status: 'failed',
          error: row.department
            ? `Department "${row.department}" was not found.`
            : 'Department is required.',
        })
        continue
      }
      const lvl = norm(row.level)
      let level: RoleLevel
      if (!lvl) level = 'mid'
      else if ((LEVELS as string[]).includes(lvl)) level = lvl as RoleLevel
      else {
        results.push({
          row: line,
          title: row.title,
          status: 'failed',
          error: `Invalid level "${row.level}". Use one of: ${LEVELS.join(', ')}.`,
        })
        continue
      }
      try {
        const created = await createRole(orgId, {
          department_id: departmentId,
          title: row.title,
          level,
          job_description: row.job_description || undefined,
        })
        createdRoleIds.push(created.id)
        results.push({ row: line, title: row.title, status: 'created' })
      } catch (err: any) {
        const msg = err?.response?.data?.message ?? 'Could not create this job role.'
        results.push({
          row: line,
          title: row.title,
          status: 'failed',
          error: Array.isArray(msg) ? msg.join(', ') : msg,
        })
      }
    }

    const created = results.filter((r) => r.status === 'created').length
    const failed = results.length - created

    if (created > 0) {
      try {
        await createImportBatch(orgId, {
          file_name: fileName || undefined,
          total_rows: rows.length,
          created_count: created,
          failed_count: failed,
          role_ids: results
            .filter((r) => r.status === 'created')
            // Match with standard createRole return ids
            .map((_, i) => createdRoleIds[i])
            .filter(Boolean),
        })
      } catch (e) {
        console.error('Failed to create import batch record', e)
      }
    }

    setResult({ created, failed, results })
    if (created > 0) {
      const importedMsg = `Imported ${created} job role${created !== 1 ? 's' : ''}`
      if (failed > 0) toast.warning(importedMsg)
      else toast.success(importedMsg)
      onImported()
    } else {
      toast.error('No job roles were imported')
    }
    setImporting(false)
  }

  function reset() {
    setRows([])
    setResult(null)
    setParseError('')
    setFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const failedRows = result?.results.filter((r) => r.status === 'failed') ?? []

  const guard = useGuardedClose({
    open: true,
    values: { file: result ? '' : fileName, count: result ? 0 : rows.length },
    noun: 'import',
    onClose,
  })

  return (
    <ImportDialog
      title="Import job roles"
      onClose={guard.requestClose}
      busy={importing}
      size="md"
      back={phase === 'history' ? { label: 'Back to upload', onClick: () => setPhase('upload') } : undefined}
      headerAction={
        phase === 'upload' && !result ? (
          <Button
            variant="on-brand"
            size="sm"
            onClick={() => {
              setPhase('history')
              loadHistory()
            }}
          >
            <History size={14} /> Import history
          </Button>
        ) : undefined
      }
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={reset}>Import another file</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        ) : phase !== 'history' ? (
          <>
            <Button variant="secondary" type="button" onClick={guard.requestClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              onClick={handleImport}
              disabled={rows.length === 0}
              loading={importing}
              loadingLabel="Importing"
            >
              {`Import${rows.length > 0 ? ` ${rows.length}` : ''}`}
            </Button>
          </>
        ) : undefined
      }
    >
          {phase === 'history' ? (
            <HistoryView
              batches={batches}
              onUndo={handleUndo}
              undoingId={undoingId}
              undoResult={undoResult}
            />
          ) : result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-success-bg border border-success-border">
                  <CheckCircle2 size={16} className="text-success" />
                  <span className="text-body font-medium text-success">{result.created} imported</span>
                </div>
                {result.failed > 0 && (
                  <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-danger-bg border border-danger-border">
                    <AlertCircle size={16} className="text-danger" />
                    <span className="text-body font-medium text-danger">{result.failed} failed</span>
                  </div>
                )}
              </div>

              {failedRows.length > 0 && (
                <div className="border border-border-light rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
                    <p className="text-meta font-medium text-text-secondary">
                      Rows that need fixing
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-surface-control">
                    {failedRows.map((r) => (
                      <div key={r.row} className="px-4 py-2.5">
                        <p className="text-body font-medium text-text-primary">
                          Row {r.row}
                          {r.title ? ` · ${r.title}` : ''}
                        </p>
                        <p className="text-body text-danger mt-0.5">{r.error}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-label text-text-secondary">
                KRAs and KPIs aren&apos;t part of the import — open a job role and use{' '}
                <span className="font-medium text-text-primary">Edit</span> to add them.
              </p>
            </div>
          ) : (
            <>
              {/* Step 1 — template */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-subtle border border-primary-border">
                <FileText size={18} className="text-primary-text mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-body font-medium text-text-primary">
                    Step 1 — Download the Excel template
                  </p>
                  <p className="text-label text-text-secondary mt-0.5">
                    Required columns (<span className="font-medium text-primary-text">blue header, marked&nbsp;*</span>):
                    title and department. The <strong>department</strong> and <strong>level</strong>{' '}
                    columns are <strong>dropdowns</strong>. Level defaults to{' '}
                    <strong>mid</strong> when left blank.
                  </p>
                  <Button variant="secondary" className="mt-3" onClick={downloadTemplate} disabled={building}>
                    {building ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {building ? 'Building…' : 'Download Excel template'}
                  </Button>
                </div>
              </div>

              {/* Step 2 — upload */}
              <div>
                <p className="text-body font-medium text-text-primary mb-2">
                  Step 2 — Upload the filled file
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-surface-sunken transition-colors"
                >
                  <UploadCloud size={26} className="text-text-muted" />
                  <span className="text-body font-medium text-text-secondary">
                    {fileName || 'Click to choose an .xlsx or .csv file'}
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
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">
                  {parseError}
                </div>
              )}

              {rows.length > 0 && !parseError && (
                <div className="p-3 bg-success-bg border border-success-border rounded-lg text-body text-success">
                  Ready to import <span className="font-medium">{rows.length}</span> job role
                  {rows.length !== 1 ? 's' : ''} from{' '}
                  <span className="font-medium">{fileName}</span>.
                </div>
              )}
            </>
          )}
      {guard.warning}
    </ImportDialog>
  )
}

function UndoSummary({ undoResult }: { undoResult: any }) {
  return (
    <div className="border border-border-light rounded-xl p-4 space-y-2">
      <p className="text-body font-medium text-text-primary">
        Removed {undoResult.undone} job role{undoResult.undone !== 1 ? 's' : ''}.
      </p>
    </div>
  )
}

function HistoryView({
  batches,
  onUndo,
  undoingId,
  undoResult,
}: {
  batches: any[]
  onUndo: (batchId: string) => void
  undoingId: string | null
  undoResult: any | null
}) {
  if (batches.length === 0) {
    return <p className="text-body text-text-muted py-8 text-center">No imports yet.</p>
  }
  return (
    <div className="space-y-3">
      {undoResult && <UndoSummary undoResult={undoResult} />}
      <div className="border border-border-light rounded-xl divide-y divide-surface-control">
        {batches.map((b) => (
          <div key={b.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-text-primary truncate">
                {b.file_name || 'Untitled import'}
                {b.status !== 'committed' && (
                  <span className="ml-2 text-meta font-medium text-text-muted uppercase">{b.status.replace('_', ' ')}</span>
                )}
              </p>
              <p className="text-meta text-text-muted mt-0.5">
                {formatDateTime(new Date(b.created_at))} · by {b.imported_by} · {b.created_count} created
                {b.failed_count > 0 ? `, ${b.failed_count} failed` : ''} · {b.remaining} still present
              </p>
            </div>
            {b.can_undo ? (
              <Button variant="secondary" size="sm" className="shrink-0" onClick={() => onUndo(b.id)} disabled={undoingId === b.id}>
                {undoingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                Undo
              </Button>
            ) : (
              <span className="text-meta text-text-muted shrink-0">
                {b.status === 'undone' ? 'Undone' : 'Cannot undo'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
