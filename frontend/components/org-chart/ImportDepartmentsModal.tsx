'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  ArrowLeft,
  Undo2,
} from 'lucide-react'
import { createDepartment, listImportBatches, createImportBatch, undoImport } from '@/lib/api/departments'
import { placeUnderParent } from '@/lib/org-chart-layout'
import { useToast } from '@/components/ui/Toast'
import type { Department, User } from '@/lib/types'
import Tooltip from '@/components/ui/Tooltip'

interface Props {
  orgId: string
  departments: Department[]
  users: User[]
  onClose: () => void
  onImported: () => void
}

interface ImportRow {
  name: string
  parent: string
  head: string
  description: string
}

interface RowResult {
  row: number
  name: string
  status: 'created' | 'failed'
  error?: string
}

// Colour is intentionally NOT importable — every department is auto-assigned a
// distinct colour by the app (users can override it in-app afterwards).
const COLUMNS = ['name', 'parent_department', 'head', 'description'] as const
type Column = (typeof COLUMNS)[number]

const HEADER_LABEL: Record<Column, string> = {
  name: 'name *',
  parent_department: 'parent_department',
  head: 'head (manager name)',
  description: 'description',
}

const COLUMN_ALIASES: Record<string, Column> = {
  name: 'name',
  department: 'name',
  parent_department: 'parent_department',
  parent: 'parent_department',
  parent_dept: 'parent_department',
  head: 'head',
  head_user: 'head',
  dept_head: 'head',
  manager: 'head',
  description: 'description',
}

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

export default function ImportDepartmentsModal({
  orgId,
  departments,
  users,
  onClose,
  onImported,
}: Props) {
  const { addToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

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
      addToast('Import undone successfully', 'success')
      onImported()
      loadHistory()
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Could not undo this import'
      addToast(msg, 'error')
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
      const ws = wb.addWorksheet('Departments')
      const lists = wb.addWorksheet('Lists')
      lists.state = 'veryHidden'

      const deptNames = uniq(departments.map((d) => d.name))
      const people = uniq(users.map((u) => u.name))
      deptNames.forEach((v, i) => (lists.getCell(i + 1, 1).value = v)) // col A
      people.forEach((v, i) => (lists.getCell(i + 1, 2).value = v)) // col B

      ws.addRow(COLUMNS.map((c) => HEADER_LABEL[c]))
      const headerRow = ws.getRow(1)
      headerRow.height = 22
      headerRow.eachCell((cell: any, col: number) => {
        const required = COLUMNS[col - 1] === 'name'
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: required ? 'FF2563EB' : 'FF475569' },
        }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      ws.columns.forEach((c: any) => (c.width = 26))

      const sampleParent = departments[0]?.name ?? 'Executive'
      const sampleHead = users[0]?.name ?? ''
      ws.addRow(['Engineering', sampleParent, sampleHead, 'Builds the product'])
      ws.addRow(['Mobile Apps', 'Engineering', '', 'iOS & Android'])

      const LAST = 300
      const addListDV = (col: number, formula: string) => {
        const letter = String.fromCharCode(64 + col)
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${letter}${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [formula],
            showErrorMessage: false, // parents may reference other new rows, so don't hard-block
          }
        }
      }
      addListDV(2, `Lists!$A$1:$A$${Math.max(deptNames.length, 1)}`) // parent_department
      addListDV(3, `Lists!$B$1:$B$${Math.max(people.length, 1)}`) // head

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'department-import-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('Could not build the template. Please try again.', 'error')
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
    if (idx.name === undefined) {
      return {
        rows: [],
        error:
          'Could not find the required "name" column. Download the template to see the expected format.',
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
        name: get('name'),
        parent: get('parent_department'),
        head: get('head'),
        description: get('description'),
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

  // ─── Import (topological: create parents before children) ───────────────────────
  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)

    // Resolve heads by name; track department names → id as we create them.
    const userByName = new Map(users.map((u) => [norm(u.name), u.id]))
    const nameToId = new Map(departments.map((d) => [norm(d.name), d.id]))
    // A mutable working copy so placeUnderParent offsets new siblings correctly.
    const working: Department[] = departments.map((d) => ({ ...d }))

    const results: RowResult[] = []
    // Pre-flag blank names and within-file duplicates.
    const pending: { row: ImportRow; line: number }[] = []
    const seenNames = new Set(nameToId.keys())
    rows.forEach((row, i) => {
      const line = i + 2 // header is line 1
      if (!row.name) {
        results.push({ row: line, name: '(blank)', status: 'failed', error: 'Name is required.' })
        return
      }
      if (seenNames.has(norm(row.name))) {
        results.push({
          row: line,
          name: row.name,
          status: 'failed',
          error: 'A department with this name already exists.',
        })
        return
      }
      seenNames.add(norm(row.name))
      pending.push({ row, line })
    })

    // Create in waves: a row is ready when it has no parent, or its parent already exists.
    let remaining = pending
    while (remaining.length > 0) {
      const ready = remaining.filter(({ row }) => !row.parent || nameToId.has(norm(row.parent)))
      if (ready.length === 0) break // remaining rows have unresolved/cyclic parents
      const next: typeof remaining = remaining.filter((p) => !ready.includes(p))

      for (const { row, line } of ready) {
        const parentId = row.parent ? nameToId.get(norm(row.parent)) : undefined
        const headId = row.head ? userByName.get(norm(row.head)) : undefined
        if (row.head && !headId) {
          results.push({
            row: line,
            name: row.name,
            status: 'failed',
            error: `No member named "${row.head}" to set as head.`,
          })
          continue
        }
        const { x, y } = placeUnderParent(working, parentId)
        try {
          // No colour on import — the app auto-assigns a distinct one per dept.
          const created = await createDepartment(orgId, {
            name: row.name,
            description: row.description || undefined,
            parent_department_id: parentId,
            head_user_id: headId,
            position_x: x,
            position_y: y,
          })
          nameToId.set(norm(row.name), created.id)
          working.push({ ...(created as Department), position_x: x, position_y: y })
          results.push({ row: line, name: row.name, status: 'created' })
        } catch (err: any) {
          const msg = err?.response?.data?.message ?? 'Could not create this department.'
          results.push({
            row: line,
            name: row.name,
            status: 'failed',
            error: Array.isArray(msg) ? msg.join(', ') : msg,
          })
        }
      }
      remaining = next
    }
    // Anything still remaining is an unresolved parent reference.
    for (const { row, line } of remaining) {
      results.push({
        row: line,
        name: row.name,
        status: 'failed',
        error: `Parent department "${row.parent}" was not found.`,
      })
    }

    results.sort((a, b) => a.row - b.row)
    const created = results.filter((r) => r.status === 'created').length
    const failed = results.length - created
    
    const createdDeptIds = results
      .filter((r) => r.status === 'created')
      .map((r) => nameToId.get(norm(r.name)))
      .filter((id): id is string => !!id)

    if (createdDeptIds.length > 0) {
      try {
        await createImportBatch(orgId, {
          file_name: fileName || undefined,
          total_rows: rows.length,
          created_count: created,
          failed_count: failed,
          department_ids: createdDeptIds,
        })
      } catch (e) {
        console.error('Failed to create import batch record', e)
      }
    }

    setResult({ created, failed, results })
    if (created > 0) {
      addToast(
        `Imported ${created} department${created !== 1 ? 's' : ''}`,
        failed > 0 ? 'warning' : 'success',
      )
      onImported()
    } else {
      addToast('No departments were imported', 'error')
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

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-[12px] rounded-t-[16px] shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-3">
            {phase === 'history' && (
              <Tooltip label="Back to upload">
              <button
                onClick={() => setPhase('upload')}
                className="p-1 hover:bg-[#F1F5F9] rounded-xs transition-colors text-[#64748B] hover:text-[#0F172A]"
                aria-label="Back to upload"
              >
                <ArrowLeft size={16} />
              </button>
              </Tooltip>
            )}
            <h2 className="text-[18px] font-semibold text-[#0F172A]">Import Departments</h2>
          </div>
          <div className="flex items-center gap-2.5">
            {phase === 'upload' && !result && (
              <button
                onClick={() => {
                  setPhase('history')
                  loadHistory()
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-[#475569] bg-[#F1F5F9] hover:bg-[#E2E8F0] transition-colors"
              >
                <History size={14} /> Import History
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-[6px] text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-5">
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
                <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-[#DCFCE7] border border-[#BBF7D0]">
                  <CheckCircle2 size={16} className="text-[#16A34A]" />
                  <span className="text-sm font-semibold text-[#166534]">{result.created} imported</span>
                </div>
                {result.failed > 0 && (
                  <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-[#FEE2E2] border border-[#FECACA]">
                    <AlertCircle size={16} className="text-[#DC2626]" />
                    <span className="text-sm font-semibold text-[#991B1B]">{result.failed} failed</span>
                  </div>
                )}
              </div>

              {failedRows.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-[10px] overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0]">
                    <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                      Rows that need fixing
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-[#F1F5F9]">
                    {failedRows.map((r) => (
                      <div key={r.row} className="px-4 py-2.5">
                        <p className="text-sm font-medium text-[#0F172A]">
                          Row {r.row}
                          {r.name ? ` · ${r.name}` : ''}
                        </p>
                        <p className="text-sm text-[#DC2626] mt-0.5">{r.error}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[13px] text-[#475569]">
                Imported departments are placed under their parent on the chart. Press{' '}
                <span className="font-semibold text-[#0F172A]">Auto-arrange</span> in the tree view to
                tidy the whole structure.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                >
                  Import another file
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1 — template */}
              <div className="flex items-start gap-3 p-4 rounded-[10px] bg-[#EFF6FF] border border-[#BFDBFE]">
                <FileText size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Step 1 — Download the Excel template
                  </p>
                  <p className="text-[13px] text-[#475569] mt-0.5">
                    Only <span className="font-semibold text-[#2563EB]">name</span> is required. The{' '}
                    <strong>parent_department</strong> and <strong>head</strong> columns are dropdowns
                    from your org. You can reference a parent that is{' '}
                    <strong>also being imported</strong> — rows are created parents-first
                    automatically.
                  </p>
                  <button
                    onClick={downloadTemplate}
                    disabled={building}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
                  >
                    {building ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {building ? 'Building…' : 'Download Excel template'}
                  </button>
                </div>
              </div>

              {/* Step 2 — upload */}
              <div>
                <p className="text-sm font-semibold text-[#0F172A] mb-2">
                  Step 2 — Upload the filled file
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-[10px] border-2 border-dashed border-[#CBD5E1] hover:border-[#2563EB] hover:bg-[#F8FAFC] transition-colors"
                >
                  <UploadCloud size={26} className="text-[#94A3B8]" />
                  <span className="text-sm font-medium text-[#475569]">
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
                <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] text-sm text-[#DC2626]">
                  {parseError}
                </div>
              )}

              {rows.length > 0 && !parseError && (
                <div className="p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-[8px] text-sm text-[#166534]">
                  Ready to import <span className="font-semibold">{rows.length}</span> department
                  {rows.length !== 1 ? 's' : ''} from{' '}
                  <span className="font-semibold">{fileName}</span>.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && phase !== 'history' && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={rows.length === 0 || importing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
            >
              {importing && <Loader2 size={15} className="animate-spin" />}
              {importing ? 'Importing…' : `Import${rows.length > 0 ? ` ${rows.length}` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function UndoSummary({ undoResult }: { undoResult: any }) {
  return (
    <div className="border border-[#E2E8F0] rounded-[10px] p-4 space-y-2">
      <p className="text-sm font-semibold text-[#0F172A]">
        Removed {undoResult.undone} department{undoResult.undone !== 1 ? 's' : ''}.
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
    return <p className="text-sm text-[#94A3B8] py-8 text-center">No imports yet.</p>
  }
  return (
    <div className="space-y-3">
      {undoResult && <UndoSummary undoResult={undoResult} />}
      <div className="border border-[#E2E8F0] rounded-[10px] divide-y divide-[#F1F5F9]">
        {batches.map((b) => (
          <div key={b.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#0F172A] truncate">
                {b.file_name || 'Untitled import'}
                {b.status !== 'committed' && (
                  <span className="ml-2 text-[11px] font-semibold text-[#94A3B8] uppercase">{b.status.replace('_', ' ')}</span>
                )}
              </p>
              <p className="text-xs text-[#64748B] mt-0.5">
                {new Date(b.created_at).toLocaleString()} · by {b.imported_by} · {b.created_count} created
                {b.failed_count > 0 ? `, ${b.failed_count} failed` : ''} · {b.remaining} still present
              </p>
            </div>
            {b.can_undo ? (
              <button
                onClick={() => onUndo(b.id)}
                disabled={undoingId === b.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-[#B91C1C] bg-white border border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-60 transition-colors shrink-0"
              >
                {undoingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                Undo
              </button>
            ) : (
              <span className="text-[11px] text-[#94A3B8] shrink-0">
                {b.status === 'undone' ? 'Undone' : 'Cannot Undo'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
