'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  UploadCloud,
  FileText,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  History,
  Undo2,
  ShieldAlert,
  Wrench,
  Paperclip,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import { PendingFileList } from '@/components/ui/AttachmentList'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import TagList from '@/components/tasks/TagList'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import type { TaskTagRef } from '@/lib/types/tasks'
import {
  getImportOptions,
  validateTaskImport,
  commitTaskImport,
  listTaskImportBatches,
  getTaskImportBatchDetail,
  undoTaskImport,
  type BulkTaskImportRow,
  type TaskImportOptions,
  type TaskImportValidationResult,
  type TaskImportValidationRow,
  type TaskImportResolved,
  type TaskImportResult,
  type TaskImportBatchSummary,
  type TaskImportBatchDetail,
  type TaskUndoImportResult,
} from '@/lib/api/task-import'

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
  /** Render inline inside another modal (the Create Task modal's "Bulk upload" tab):
      no own portal/overlay, no close-X, no full-page preview breakout. */
  embedded?: boolean
}

/** Glue for combined dropdown values, e.g. "Jane Doe · Sales · Manager". Must match the backend. */
const VALUE_SEPARATOR = ' · '

// Machine column keys, in template order (A…AA — 27 columns).
const COLUMNS = [
  'title',
  'description',
  'priority',
  'category',
  'tags',
  'deadline_date',
  'deadline_time',
  'assignee_1',
  'assignee_2',
  'assignee_3',
  'assignee_4',
  'assignee_5',
  'cc_1',
  'cc_2',
  'cc_3',
  'completion_mode',
  'proof_required',
  'proof_allowed_types',
  'escalation_1',
  'escalation_2',
  'escalation_3',
  'linked_goal',
  'reminder_days_before',
  'checklist_template',
  'checklist_items',
  'attachments',
  'holiday_override',
] as const

type Column = (typeof COLUMNS)[number]

const REQUIRED: Column[] = ['title', 'deadline_date', 'assignee_1']

const HEADER_LABEL: Record<Column, string> = {
  title: 'title *',
  description: 'description',
  priority: 'priority',
  category: 'category',
  tags: 'tags',
  deadline_date: 'deadline_date *',
  deadline_time: 'deadline_time',
  assignee_1: 'assignee_1 *',
  assignee_2: 'assignee_2',
  assignee_3: 'assignee_3',
  assignee_4: 'assignee_4',
  assignee_5: 'assignee_5',
  cc_1: 'cc_1',
  cc_2: 'cc_2',
  cc_3: 'cc_3',
  completion_mode: 'completion_mode',
  proof_required: 'proof_required',
  proof_allowed_types: 'proof_allowed_types',
  escalation_1: 'escalation_1',
  escalation_2: 'escalation_2',
  escalation_3: 'escalation_3',
  linked_goal: 'linked_goal',
  reminder_days_before: 'reminder_days_before',
  checklist_template: 'checklist_template',
  checklist_items: 'checklist_items',
  attachments: 'attachments',
  holiday_override: 'holiday_override',
}

// A single guide row is written under the header (row 2) spelling out each column's
// rule. Its title cell starts with GUIDE_MARKER so the importer always skips it —
// the user can leave it or delete it, either way it never becomes a task.
const GUIDE_MARKER = '↳'

const COLUMN_RULE: Record<Column, string> = {
  title: 'Required · ≤50 chars (Error) · repeats flagged (Warning)',
  description: '≤2000 chars (Error)',
  priority: 'Pick from list (Error if unknown)',
  category: 'Pick from list (Error if unknown)',
  tags: 'Pipe-separated; must match an existing tag',
  deadline_date: 'Required · today or later · YYYY-MM-DD (Error) · holiday/leave flagged (Warning)',
  deadline_time: 'HH:mm · defaults 23:59',
  assignee_1: 'Required · pick from list (Error)',
  assignee_2: 'Pick from list (Error if unknown)',
  assignee_3: 'Pick from list (Error if unknown)',
  assignee_4: 'Pick from list (Error if unknown)',
  assignee_5: 'Pick from list (Error if unknown)',
  cc_1: 'Pick from list (Error if unknown)',
  cc_2: 'Pick from list (Error if unknown)',
  cc_3: 'Pick from list (Error if unknown)',
  completion_mode: 'any_can_complete / all_must_complete',
  proof_required: 'Yes / No',
  proof_allowed_types: 'e.g. pdf | png (Warning if unknown)',
  escalation_1: 'Pick from list (Warning if same as assignee)',
  escalation_2: 'Pick from list',
  escalation_3: 'Pick from list',
  linked_goal: 'Pick from list (Error if unknown)',
  reminder_days_before: 'Whole number ≥ 0 (Error)',
  checklist_template: 'Pick a template you can use (Error)',
  checklist_items: 'Separate items with |',
  attachments: 'Filenames, separate with | · upload files in the app',
  holiday_override: 'Yes / No · keep a non-working-day date',
}

const COLUMN_ALIASES: Record<string, Column> = Object.fromEntries(
  COLUMNS.map((c) => [c, c]),
) as Record<string, Column>
// A few forgiving aliases.
Object.assign(COLUMN_ALIASES, {
  name: 'title',
  task: 'title',
  task_title: 'title',
  desc: 'description',
  due_date: 'deadline_date',
  deadline: 'deadline_date',
  due_time: 'deadline_time',
  assignee: 'assignee_1',
  cc: 'cc_1',
  goal: 'linked_goal',
  checklist: 'checklist_items',
  tag: 'tags',
})

function normalizeHeader(h: string): string {
  return h
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── CSV helper (fallback when a .csv is uploaded) ─────────────────────────────

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

const STATUS_STYLES: Record<TaskImportValidationRow['status'], { dot: string; text: string; label: string }> = {
  ready: { dot: 'bg-[#16A34A]', text: 'text-[#166534]', label: 'Ready' },
  error: { dot: 'bg-[#DC2626]', text: 'text-[#991B1B]', label: 'Error' },
}

/** Fixed vocabulary for the exported failure_status column (sortable in Excel). */
const FIELD_FAILURE_LABEL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  category: 'Category',
  tags: 'Tags',
  deadline_date: 'Deadline',
  deadline_time: 'Deadline',
  assignee_1: 'Assignee',
  assignee_2: 'Assignee',
  assignee_3: 'Assignee',
  assignee_4: 'Assignee',
  assignee_5: 'Assignee',
  cc_1: 'CC',
  cc_2: 'CC',
  cc_3: 'CC',
  completion_mode: 'Completion Mode',
  proof_allowed_types: 'Proof',
  escalation_1: 'Escalation',
  escalation_2: 'Escalation',
  escalation_3: 'Escalation',
  linked_goal: 'Goal',
  reminder_days_before: 'Reminder',
  checklist_template: 'Checklist',
}

function failureStatusesFromRow(row: TaskImportValidationRow): string[] {
  const set = new Set<string>()
  for (const iss of row.issues) {
    if (iss.severity !== 'error') continue
    set.add(FIELD_FAILURE_LABEL[iss.field ?? ''] ?? 'Other')
  }
  if (set.size === 0) set.add('Other')
  return Array.from(set)
}

function normName(s: string): string {
  return s.trim().toLowerCase()
}

export default function ImportTasksModal({ orgId, onClose, onImported, embedded = false }: Props) {
  const { addToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    // Embedded inside another modal — the host already locks body scroll.
    if (embedded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [embedded])

  const [options, setOptions] = useState<TaskImportOptions | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const loadOptions = useCallback(() => {
    if (!orgId) { setLoadingOptions(false); setOptionsError('No organization selected.'); return }
    setLoadingOptions(true)
    setOptionsError(null)
    getImportOptions(orgId)
      .then((o) => { setOptions(o); setOptionsError(null) })
      .catch((err: any) => {
        setOptions(null)
        const msg = err?.response?.data?.message
        setOptionsError(
          (Array.isArray(msg) ? msg.join(', ') : msg) ??
            err?.message ??
            'Could not load the template options. Please retry.',
        )
      })
      .finally(() => setLoadingOptions(false))
  }, [orgId])
  useEffect(() => { loadOptions() }, [loadOptions])

  type Phase = 'upload' | 'preview' | 'result' | 'history' | 'batch-detail'
  const [phase, setPhase] = useState<Phase>('upload')
  const [fileName, setFileName] = useState('')
  const [parsedRows, setParsedRows] = useState<BulkTaskImportRow[]>([])
  // Parallel to parsedRows: the real spreadsheet row each came from (for display).
  const [sourceRows, setSourceRows] = useState<number[]>([])
  const [validation, setValidation] = useState<TaskImportValidationResult | null>(null)
  const [commitResult, setCommitResult] = useState<TaskImportResult | null>(null)
  const [parseError, setParseError] = useState('')
  const [building, setBuilding] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [chipFilter, setChipFilter] = useState<'total' | 'ready' | 'error' | 'warning'>('total')

  // Shared attachment pool — files referenced by the sheet's `attachments` column,
  // matched to rows by filename and uploaded to each created task after commit.
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])

  const [batches, setBatches] = useState<TaskImportBatchSummary[]>([])
  const [undoResult, setUndoResult] = useState<TaskUndoImportResult | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null)
  const [batchDetail, setBatchDetail] = useState<TaskImportBatchDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailOrigin, setDetailOrigin] = useState<'history' | 'import'>('history')

  // Filenames the sheet asks to attach, across all rows (deduped, lowercased).
  const referencedFileNames = useMemo(() => {
    const set = new Set<string>()
    for (const r of parsedRows) {
      for (const n of (r.attachments ?? '').split(/[|\n]/).map((s) => s.trim()).filter(Boolean)) {
        set.add(normName(n))
      }
    }
    return set
  }, [parsedRows])

  const uploadedNameSet = useMemo(
    () => new Set(attachmentFiles.map((f) => normName(f.name))),
    [attachmentFiles],
  )
  const missingFileNames = useMemo(
    () => Array.from(referencedFileNames).filter((n) => !uploadedNameSet.has(n)),
    [referencedFileNames, uploadedNameSet],
  )

  // ─── Template (.xlsx with reference sheets + dropdowns) ───────────────────────
  async function downloadTemplate() {
    if (!options) return
    const importTags = options.tags ?? []
    setBuilding(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Tasks')
      const wsPri = wb.addWorksheet('Priorities')
      const wsCat = wb.addWorksheet('Categories')
      const wsTag = wb.addWorksheet('Tags')
      const wsGoal = wb.addWorksheet('Goals')
      const wsTpl = wb.addWorksheet('Checklist Templates')
      const wsPeople = wb.addWorksheet('Assignees')

      const refHeader = (sheet: any, headers: string[]) => {
        sheet.addRow(headers)
        const hr = sheet.getRow(1)
        hr.height = 20
        hr.eachCell((cell: any) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } }
          cell.alignment = { vertical: 'middle', horizontal: 'left' }
        })
      }

      refHeader(wsPri, ['Sr. No.', 'Priority'])
      options.priorities.forEach((p, i) => wsPri.addRow([i + 1, p.label]))
      wsPri.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 28))

      refHeader(wsCat, ['Sr. No.', 'Category'])
      options.categories.forEach((c, i) => wsCat.addRow([i + 1, c.name]))
      wsCat.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 28))

      // Tags — the valid names for the `tags` column. A cell takes several, so it gets
      // no dropdown; it is checked against this list on upload.
      refHeader(wsTag, ['Sr. No.', 'Tag'])
      importTags.forEach((t, i) => wsTag.addRow([i + 1, t.name]))
      wsTag.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 28))

      refHeader(wsGoal, ['Sr. No.', 'Quarterly Goal'])
      options.goals.forEach((g, i) => wsGoal.addRow([i + 1, g.title]))
      wsGoal.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 40))

      refHeader(wsTpl, ['Sr. No.', 'Checklist Template'])
      options.checklist_templates.forEach((t, i) => wsTpl.addRow([i + 1, t.name]))
      wsTpl.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 36))

      // Assignees — Sr | Name | Department | Role | Value (pick this). Value is the
      // exact dropdown value used by every assignee / CC / escalation column.
      refHeader(wsPeople, ['Sr. No.', 'Name', 'Department', 'Role', 'Value (pick this)'])
      options.assignees.forEach((a, i) =>
        wsPeople.addRow([i + 1, a.name, a.department_name ?? '', a.role_title ?? '', a.value]),
      )
      wsPeople.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : i === 4 ? 44 : 24))

      // Main sheet header.
      ws.addRow(COLUMNS.map((c) => HEADER_LABEL[c]))
      const headerRow = ws.getRow(1)
      headerRow.height = 22
      headerRow.eachCell((cell: any, col: number) => {
        const key = COLUMNS[col - 1]
        const required = REQUIRED.includes(key)
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FF2563EB' : 'FF475569' } }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      ws.columns.forEach((c: any) => (c.width = 20))

      // Guide row (row 2) — each column's rule in plain words. Skipped on import
      // (its title cell starts with GUIDE_MARKER); the user may delete it.
      const guideCells = COLUMNS.map((c) => COLUMN_RULE[c])
      guideCells[0] = `${GUIDE_MARKER} Guide row (safe to delete) · ${COLUMN_RULE.title}`
      const guideRow = ws.addRow(guideCells)
      guideRow.height = 30
      guideRow.eachCell((cell: any) => {
        cell.font = { italic: true, color: { argb: 'FF475569' }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      })

      // Two example rows using real option values where available.
      const p0 = options.priorities[0]?.label ?? ''
      const c0 = options.categories[0]?.name ?? ''
      const tg0 = importTags.slice(0, 2).map((t) => t.name).join(' | ')
      const a0 = options.assignees[0]?.value ?? 'Jane Doe · Sales'
      const a1 = options.assignees[1]?.value ?? ''
      const tpl0 = options.checklist_templates[0]?.name ?? ''
      const today = getNow()
      const soon = new Date(today.getTime() + 7 * 864e5)
      ws.addRow([
        'Prepare Q3 report', 'Draft and circulate the quarterly report', p0, c0, tg0,
        toYmd(soon), '17:00', a0, a1, '', '', '', '', '', '',
        a1 ? 'all_must_complete' : 'any_can_complete', 'No', '', '', '', '', '',
        '2', tpl0, 'Collect figures | Write summary | Send for review', '', 'No',
      ])
      ws.addRow([
        'Kickoff meeting notes', '', p0, c0, '',
        toYmd(soon), '', a0, '', '', '', '', '', '', '',
        'any_can_complete', 'Yes', 'pdf | docx', '', '', '', '', '1', '', '', 'notes.pdf', 'No',
      ])

      // Column letters A…Z, then AA, AB… (there are more than 26 columns).
      const letter = (idx: number): string =>
        idx < 26 ? String.fromCharCode(65 + idx) : letter(Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26))
      const LAST = 500
      const addListDV = (col: Column, formula: string) => {
        const L = letter(COLUMNS.indexOf(col))
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${L}${r}`).dataValidation = {
            type: 'list', allowBlank: true, formulae: [formula],
            showErrorMessage: true, errorStyle: 'warning',
            errorTitle: 'Pick from the list',
            error: 'Choose a value from the dropdown, or clear the cell.',
          }
        }
      }
      const addDateDV = (col: Column) => {
        const L = letter(COLUMNS.indexOf(col))
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${L}${r}`).numFmt = 'yyyy-mm-dd'
          ws.getCell(`${L}${r}`).dataValidation = {
            type: 'date', operator: 'greaterThanOrEqual', allowBlank: true,
            formulae: ['=TODAY()'], showErrorMessage: true, errorStyle: 'warning',
            errorTitle: 'Check the date',
            error: 'Enter a real date that is today or later (YYYY-MM-DD).',
          }
        }
      }

      // Only attach a range-backed dropdown when its reference sheet has rows —
      // an empty list would produce an inverted range ($B$2:$B$1) that Excel rejects.
      if (options.priorities.length) addListDV('priority', `Priorities!$B$2:$B$${options.priorities.length + 1}`)
      if (options.categories.length) addListDV('category', `Categories!$B$2:$B$${options.categories.length + 1}`)
      addDateDV('deadline_date')
      if (options.assignees.length) {
        const range = `Assignees!$E$2:$E$${options.assignees.length + 1}`
        for (const col of ['assignee_1', 'assignee_2', 'assignee_3', 'assignee_4', 'assignee_5', 'cc_1', 'cc_2', 'cc_3', 'escalation_1', 'escalation_2', 'escalation_3'] as Column[]) {
          addListDV(col, range)
        }
      }
      addListDV('completion_mode', '"any_can_complete,all_must_complete"')
      addListDV('proof_required', '"No,Yes"')
      if (options.goals.length) addListDV('linked_goal', `Goals!$B$2:$B$${options.goals.length + 1}`)
      if (options.checklist_templates.length) addListDV('checklist_template', `'Checklist Templates'!$B$2:$B$${options.checklist_templates.length + 1}`)
      addListDV('holiday_override', '"No,Yes"')

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'task-import-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('Could not build the template. Please try again.', 'error')
    } finally {
      setBuilding(false)
    }
  }

  // ─── Parsing ──────────────────────────────────────────────────────────────────

  function gridToRows(grid: string[][]): { rows: BulkTaskImportRow[]; sourceRows: number[]; error?: string } {
    if (grid.length === 0) return { rows: [], sourceRows: [], error: 'The file is empty.' }
    const header = grid[0].map(normalizeHeader)
    const idx: Partial<Record<Column, number>> = {}
    header.forEach((h, i) => {
      const col = COLUMN_ALIASES[h]
      if (col && idx[col] === undefined) idx[col] = i
    })
    if (idx.title === undefined) {
      return { rows: [], sourceRows: [], error: 'Could not find the required "title" column. Download the template to see the expected format.' }
    }
    const parsed: BulkTaskImportRow[] = []
    // The true 1-based spreadsheet row each parsed row came from — so error/preview
    // row numbers always match what the user sees in Excel, even past the guide row.
    const sourceRows: number[] = []
    for (let r = 1; r < grid.length; r++) {
      const cells = grid[r]
      if (!cells || cells.every((c) => (c ?? '').trim() === '')) continue
      const get = (c: Column) => {
        const i = idx[c]
        return i !== undefined ? (cells[i] ?? '').trim() : ''
      }
      // Skip the template's guide/rules row wherever it sits (its title starts with ↳).
      if (get('title').startsWith(GUIDE_MARKER)) continue
      const row: BulkTaskImportRow = {}
      for (const c of COLUMNS) (row as any)[c] = get(c)
      // Precompute the browser-local deadline instant so the server never shifts it.
      if (row.deadline_date && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline_date)) {
        const t = row.deadline_time && /^\d{2}:\d{2}$/.test(row.deadline_time) ? row.deadline_time : '23:59'
        const d = new Date(`${row.deadline_date}T${t}`)
        if (!Number.isNaN(d.getTime())) row.deadline_iso = d.toISOString()
      }
      parsed.push(row)
      sourceRows.push(r + 1) // grid index r (0-based, header at 0) → 1-based Excel row
    }
    if (parsed.length === 0) return { rows: [], sourceRows: [], error: 'No data rows found below the header.' }
    return { rows: parsed, sourceRows }
  }

  async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
    const mod: any = await import('exceljs')
    const ExcelJS = mod.default ?? mod
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.getWorksheet('Tasks') ?? wb.worksheets[0]
    if (!ws) return []
    const cellText = (cell: any): string => {
      const v = cell?.value
      if (v == null) return ''
      if (v instanceof Date) return toYmd(v)
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

  async function runValidation(rows: BulkTaskImportRow[]) {
    setValidating(true)
    try {
      const res = await validateTaskImport(orgId, rows)
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
      const { rows, sourceRows: srcs, error } = gridToRows(grid)
      if (error) { setParseError(error); return }
      setParsedRows(rows)
      setSourceRows(srcs)
      runValidation(rows)
    }
    if (/\.xlsx$/i.test(file.name)) {
      file.arrayBuffer().then(parseXlsx).then(finish).catch(() =>
        setParseError('Could not read this Excel file. Make sure it is a valid .xlsx.'),
      )
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        try { finish(parseCsv(String(reader.result ?? ''))) }
        catch { setParseError('Could not read this file. Make sure it is a valid CSV.') }
      }
      reader.onerror = () => setParseError('Could not read this file.')
      reader.readAsText(file)
    }
  }

  // ─── Failed-rows export ───────────────────────────────────────────────────────

  async function exportRows(
    entries: { payload: Record<string, any>; status: string; reason: string }[],
    filename: string,
  ) {
    if (entries.length === 0) return
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Fix these')
      ws.addRow([...COLUMNS.map((c) => HEADER_LABEL[c]), 'failure_status', 'reason_for_failure'])
      const hr = ws.getRow(1)
      hr.eachCell((cell: any, col: number) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        const fg = col === COLUMNS.length + 1 ? 'FFB45309' : col === COLUMNS.length + 2 ? 'FFDC2626' : 'FF475569'
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } }
      })
      for (const e of entries) {
        ws.addRow([...COLUMNS.map((c) => (e.payload as any)[c] ?? ''), e.status, e.reason])
      }
      ws.columns.forEach((c: any) => (c.width = 20))
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length + 2 } }
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('Could not build the file.', 'error')
    }
  }

  function downloadFailures() {
    if (!validation) return
    const entries = validation.rows
      .filter((r) => r.status !== 'ready')
      .map((vr) => ({
        payload: parsedRows[vr.row - 2] ?? {},
        status: failureStatusesFromRow(vr).join(', '),
        reason: vr.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '),
      }))
    void exportRows(entries, 'task-import-failures.xlsx')
  }

  function downloadResultFailures() {
    if (!commitResult) return
    const entries = commitResult.results
      .filter((r) => r.status === 'failed')
      .map((r) => ({ payload: parsedRows[r.row - 2] ?? {}, status: 'Failed', reason: r.error || 'Failed to import' }))
    void exportRows(entries, 'task-import-fixes.xlsx')
  }

  async function openBatch(batchId: string, origin: 'history' | 'import' = 'history') {
    setDetailOrigin(origin)
    setPhase('batch-detail')
    setBatchDetail(null)
    setLoadingDetail(true)
    try {
      setBatchDetail(await getTaskImportBatchDetail(orgId, batchId))
    } catch {
      addToast('Could not load this import’s details.', 'error')
      if (origin === 'history') setPhase('history')
    } finally {
      setLoadingDetail(false)
    }
  }

  // ─── Commit ───────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!validation) return
    setConfirmOpen(false)
    setImporting(true)
    try {
      const res = await commitTaskImport(orgId, parsedRows, fileName)
      // Upload matched attachments to each created task (best-effort, sequential).
      let attachFailures = 0
      if (attachmentFiles.length > 0) {
        const byName = new Map(attachmentFiles.map((f) => [normName(f.name), f]))
        for (const r of res.results) {
          if (r.status !== 'created' || !r.task_id || !r.attachment_names?.length) continue
          for (const nm of r.attachment_names) {
            const file = byName.get(normName(nm))
            if (!file) continue
            try { await tasksApi.uploadTaskAttachment(orgId, r.task_id, file) }
            catch { attachFailures++ }
          }
        }
      }
      setCommitResult(res)
      if (res.created > 0) {
        addToast(
          `Imported ${res.created} task${res.created !== 1 ? 's' : ''}` +
            (attachFailures > 0 ? ` — ${attachFailures} attachment${attachFailures !== 1 ? 's' : ''} failed to upload` : ''),
          res.failed > 0 || attachFailures > 0 ? 'warning' : 'success',
        )
        onImported()
      } else {
        addToast('No tasks were imported', 'error')
      }
      setPhase('result')
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Import failed. Please try again.'
      addToast(Array.isArray(msg) ? msg.join(', ') : msg, 'error')
    } finally {
      setImporting(false)
    }
  }

  // ─── History + undo ───────────────────────────────────────────────────────────

  async function openHistory() {
    setPhase('history')
    setUndoResult(null)
    try { setBatches(await listTaskImportBatches(orgId)) } catch { setBatches([]) }
  }

  async function handleUndo(batchId: string) {
    setUndoingId(batchId)
    try {
      const res = await undoTaskImport(orgId, batchId)
      setUndoResult(res)
      addToast(
        res.undone > 0 ? `Removed ${res.undone} imported task${res.undone !== 1 ? 's' : ''}` : 'Nothing was removed',
        res.kept.length > 0 ? 'warning' : 'success',
      )
      onImported()
      setBatches(await listTaskImportBatches(orgId))
      if (batchDetail?.id === batchId) {
        try { setBatchDetail(await getTaskImportBatchDetail(orgId, batchId)) } catch { /* keep stale */ }
      }
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
    setParsedRows([])
    setSourceRows([])
    setAttachmentFiles([])
    setAttachErrors([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Map a backend row number (index+2) back to the real spreadsheet row for display.
  const excelRow = (rowNum: number) => sourceRows[rowNum - 2] ?? rowNum

  // A row's resolved tags as chips: colours from the shared tag list, names falling back
  // to the import options (unknown names are row errors, listed under Issues).
  const { tags: orgTags } = useTaskTags(orgId, { includeInactive: true })
  const resolvedTags = useCallback(
    (resolved: TaskImportResolved): TaskTagRef[] => {
      const ids = resolved.tag_ids ?? []
      const names = resolved.tags ?? []
      return ids.map((id, i) => {
        const known = orgTags.find((t) => t.id === id)
        if (known) return known
        const name = names[i] ?? options?.tags?.find((t) => t.id === id)?.name ?? 'Tag'
        return { id, name, color: 'slate', is_active: true }
      })
    },
    [orgTags, options],
  )

  const visibleRows = useMemo(() => {
    if (!validation) return []
    const rows = validation.rows
    switch (chipFilter) {
      case 'ready': return rows.filter((r) => r.status === 'ready')
      case 'error': return rows.filter((r) => r.status === 'error')
      case 'warning': return rows.filter((r) => r.status === 'ready' && r.issues.some((i) => i.severity === 'warning'))
      default: return rows
    }
  }, [validation, chipFilter])

  if (!mounted) return null

  // Full-page preview only makes sense as a standalone overlay; when embedded the host
  // modal owns the frame, so the preview stays within it and scrolls internally.
  const isFullPage = phase === 'preview' && !embedded

  const shell = (
    <>
      <div className={embedded
        ? 'flex flex-col flex-1 min-h-0 bg-white'
        : `bg-white shadow-xl flex flex-col ${isFullPage ? 'w-full h-full max-h-none rounded-none' : 'w-full sm:max-w-3xl sm:rounded-[12px] rounded-t-[16px] max-h-[92vh]'}`}>
        {/* Header — hidden on the upload step when embedded (the host modal's "Create
            task" header + the Bulk-upload tab already frame it, and History now lives in
            the Step 1 card), so it doesn't waste a whole row. */}
        {!(embedded && phase === 'upload') && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
            <div className="flex items-center gap-3">
              {(phase === 'history' || phase === 'batch-detail') && (
                <button
                  onClick={phase === 'history' ? resetToUpload : detailOrigin === 'import' ? resetToUpload : openHistory}
                  className="p-1.5 rounded-[6px] text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <h2 className="text-[18px] font-semibold text-[#0F172A]">
                {phase === 'preview' ? 'Review before importing'
                  : phase === 'history' ? 'Import history'
                  : phase === 'batch-detail' ? 'Import details'
                  : 'Import Tasks'}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              {/* Standalone upload keeps History here; embedded upload hides this whole
                  header, so History is surfaced in the Step 1 card instead. */}
              {phase === 'upload' && !embedded && (
                <button
                  onClick={openHistory}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
                >
                  <History size={15} /> History
                </button>
              )}
              {!embedded && (
                <button onClick={onClose} className="p-1.5 rounded-[6px] text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors" aria-label="Close">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className={`px-6 py-5 overflow-y-auto space-y-5 ${isFullPage || embedded ? 'flex-1 min-h-0' : ''}`}>
          {/* ── Upload ── */}
          {phase === 'upload' && (
            <>
              <div className="flex items-start gap-3 p-4 rounded-[10px] bg-[#EFF6FF] border border-[#BFDBFE]">
                <FileText size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A]">Step 1 — Download the Excel template</p>
                  <p className="text-[13px] text-[#475569] mt-0.5">
                    Required columns (<span className="font-semibold text-[#2563EB]">blue header, marked *</span>): title,
                    deadline_date, assignee_1. <strong>Priority</strong>, <strong>category</strong>, <strong>assignees</strong>,{' '}
                    <strong>CC</strong>, <strong>escalation</strong>, <strong>goal</strong> and <strong>checklist template</strong>{' '}
                    are <strong>dropdowns</strong>. The assignee / CC / escalation dropdowns only list people you’re allowed to
                    assign to. Checklist items, <strong>tags</strong> and attachment filenames are pipe-separated (<code>a | b | c</code>);
                    each tag must match one on the template’s Tags sheet. The
                    template’s <strong>second row spells out each column’s rule</strong> — it’s ignored on upload, so you can leave or delete it.
                  </p>
                  {optionsError ? (
                    <div className="mt-3 flex items-start gap-2 p-3 rounded-[8px] bg-[#FEF2F2] border border-[#FECACA]">
                      <AlertCircle size={15} className="text-[#DC2626] mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[#DC2626]">{optionsError}</p>
                        <button
                          onClick={loadOptions}
                          disabled={loadingOptions}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
                        >
                          {loadingOptions ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                          {loadingOptions ? 'Retrying…' : 'Retry'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={downloadTemplate}
                      disabled={building || loadingOptions || !options}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
                    >
                      {building || loadingOptions ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                      {loadingOptions ? 'Loading options…' : building ? 'Building…' : 'Download Excel template'}
                    </button>
                  )}
                </div>
              </div>

              <div>
                {/* Step 2 heading row — History sits on the right (embedded only; the
                    standalone modal keeps History in its own header). */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-[#0F172A]">Step 2 — Upload the filled file to review</p>
                  {embedded && (
                    <button
                      onClick={openHistory}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[13px] font-medium text-[#2563EB] hover:bg-[#DBEAFE] transition-colors"
                    >
                      <History size={15} /> History
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-[10px] border-2 border-dashed border-[#CBD5E1] hover:border-[#2563EB] hover:bg-[#F8FAFC] transition-colors"
                >
                  {validating ? <Loader2 size={26} className="text-[#2563EB] animate-spin" /> : <UploadCloud size={26} className="text-[#94A3B8]" />}
                  <span className="text-sm font-medium text-[#475569]">
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
                <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] text-sm text-[#DC2626]">{parseError}</div>
              )}
            </>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && validation && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip color="slate" label={`${validation.total} total`} active={chipFilter === 'total'} onClick={() => setChipFilter('total')} />
                <FilterChip color="green" label={`${validation.ready} ready`} active={chipFilter === 'ready'} onClick={() => setChipFilter('ready')} />
                {validation.errors > 0 && (
                  <FilterChip color="red" label={`${validation.errors} error`} active={chipFilter === 'error'} onClick={() => setChipFilter('error')} />
                )}
                {validation.warnings > 0 && (
                  <FilterChip color="amber" label={`${validation.warnings} warning`} active={chipFilter === 'warning'} onClick={() => setChipFilter('warning')} />
                )}
                <span className="ml-auto text-xs text-[#64748B]">from {fileName}</span>
              </div>

              {/* Row table */}
              <div className="border border-[#E2E8F0] rounded-[10px] overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#F8FAFC] sticky top-0 z-10">
                      <tr className="text-left text-[#64748B]">
                        <th className="px-3 py-2 font-semibold">#</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Title</th>
                        <th className="px-3 py-2 font-semibold">Assignees</th>
                        <th className="px-3 py-2 font-semibold">Deadline</th>
                        <th className="px-3 py-2 font-semibold">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {visibleRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-[13px] text-[#94A3B8]">No rows in this category.</td></tr>
                      ) : (
                        visibleRows.map((r, i) => {
                          const s = STATUS_STYLES[r.status]
                          const rowBg = r.status !== 'ready'
                            ? 'bg-[#FEF2F2] hover:bg-[#FEE2E2]'
                            : `${i % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} hover:bg-[#EEF2F8]`
                          return (
                            <tr key={r.row} className={`${rowBg} transition-colors`}>
                              <td className="px-3 py-2 text-[#94A3B8]">{excelRow(r.row)}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center gap-1.5 font-semibold ${s.text}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-[#0F172A]">{r.title || '—'}</div>
                                {r.resolved.checklist_item_count ? (
                                  <div className="text-[#94A3B8]">{r.resolved.checklist_item_count} checklist item{r.resolved.checklist_item_count !== 1 ? 's' : ''}</div>
                                ) : null}
                                {r.resolved.tag_ids?.length ? (
                                  <TagList tags={resolvedTags(r.resolved)} max={3} className="mt-1" />
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-[#475569]">
                                {r.resolved.assignees?.length ? r.resolved.assignees.join(', ') : '—'}
                                {r.resolved.cc?.length ? <span className="text-[#94A3B8]"> · CC {r.resolved.cc.length}</span> : null}
                              </td>
                              <td className="px-3 py-2 text-[#475569]">{r.resolved.deadline || '—'}</td>
                              <td className="px-3 py-2">
                                {r.issues.length === 0 ? <span className="text-[#94A3B8]">—</span> : (
                                  <ul className="space-y-0.5">
                                    {r.issues.map((iss, k) => (
                                      <li key={k} className={`flex items-start gap-1 ${iss.severity === 'error' ? 'text-[#DC2626]' : 'text-[#B45309]'}`}>
                                        {iss.severity === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
                                        <span>{iss.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Attachments — shared pool matched to rows by filename */}
              {referencedFileNames.size > 0 && (
                <div className="rounded-[10px] border border-[#E2E8F0] bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Paperclip size={16} className="text-[#2563EB]" />
                    <p className="text-sm font-semibold text-[#0F172A]">Attachments</p>
                    <span className="text-xs text-[#475569]">
                      {referencedFileNames.size} file{referencedFileNames.size !== 1 ? 's' : ''} referenced ·{' '}
                      {referencedFileNames.size - missingFileNames.length} matched
                    </span>
                  </div>
                  <p className="text-[13px] text-[#475569]">
                    Your sheet references files in the <strong>attachments</strong> column. Drop those exact files here — each
                    is matched to its row by filename and uploaded to the created task.
                  </p>
                  <FileDropzone onFiles={(fs) => setAttachmentFiles((prev) => [...prev, ...fs])} onReject={setAttachErrors} disabled={importing} />
                  {(attachErrors.length > 0 || attachmentFiles.length > 0) && (
                    <div className="max-h-[180px] overflow-y-auto space-y-2">
                      {attachErrors.length > 0 && <AttachmentErrorBox errors={attachErrors} onDismiss={() => setAttachErrors([])} />}
                      {attachmentFiles.length > 0 && (
                        <PendingFileList files={attachmentFiles} onRemove={(idx) => setAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))} />
                      )}
                    </div>
                  )}
                  {missingFileNames.length > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-[8px] bg-[#FEF3C7] border border-[#FDE68A]">
                      <AlertTriangle size={15} className="text-[#B45309] mt-0.5 shrink-0" />
                      <p className="text-[13px] text-[#92400E]">
                        {missingFileNames.length} referenced file{missingFileNames.length !== 1 ? 's are' : ' is'} not uploaded yet
                        and will be skipped: <strong>{missingFileNames.join(', ')}</strong>. The tasks still import.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Fix-loop guidance + download */}
              {(() => {
                const notReady = validation.rows.filter((r) => r.status !== 'ready').length
                if (notReady === 0) return null
                const rowWord = notReady === 1 ? 'row' : 'rows'
                return (
                  <div className="flex items-start gap-3 p-3.5 rounded-[10px] bg-[#EFF6FF] border border-[#BFDBFE]">
                    <Wrench size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1E3A8A]">
                        <strong>{validation.ready} of {validation.total} rows are ready</strong> and will be imported now.
                        The other <strong>{notReady} {rowWord}</strong> {notReady === 1 ? 'has a problem' : 'have problems'} and
                        will be skipped.
                      </p>
                      <button
                        onClick={downloadFailures}
                        className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
                      >
                        <Download size={14} /> Download {notReady} {rowWord} to fix
                      </button>
                    </div>
                  </div>
                )
              })()}
            </>
          )}

          {/* ── Result ── */}
          {phase === 'result' && commitResult && (
            <ResultView
              result={commitResult}
              onUndo={() => commitResult.batch_id && setUndoConfirm(commitResult.batch_id)}
              undoing={undoingId === commitResult.batch_id}
              undoResult={undoResult}
              onDownloadFailures={downloadResultFailures}
              rowLabel={excelRow}
            />
          )}

          {/* ── History ── */}
          {phase === 'history' && (
            <HistoryView batches={batches} onUndo={(id) => setUndoConfirm(id)} onOpen={openBatch} undoingId={undoingId} />
          )}

          {/* ── Batch detail ── */}
          {phase === 'batch-detail' && (
            <BatchDetailView detail={batchDetail} loading={loadingDetail} onUndo={(id) => setUndoConfirm(id)} undoing={!!batchDetail && undoingId === batchDetail.id} />
          )}
        </div>

        {/* Footer — preview */}
        {phase === 'preview' && validation && (
          <div className="flex items-center gap-4 px-6 py-4 border-t border-[#E2E8F0]">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <ShieldAlert size={16} className="text-[#B45309] mt-0.5 shrink-0" />
              <p className="text-[12px] leading-snug text-[#92400E]">
                Importing creates live tasks and notifies assignees. Only the <strong>{validation.ready} ready</strong> row
                {validation.ready !== 1 ? 's' : ''} import; the rest are skipped. A short-lived undo is available right after.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPhase('upload')}
              className="shrink-0 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
            >
              Choose another file
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={validation.ready === 0 || importing}
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
            >
              {importing && <Loader2 size={15} className="animate-spin" />}
              {importing ? 'Importing…' : `Import ${validation.ready} ready`}
            </button>
          </div>
        )}

        {/* Footer — result */}
        {phase === 'result' && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0]">
            <button onClick={resetToUpload} className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] hover:bg-[#EFF6FF] transition-colors">
              Import another file
            </button>
            <button onClick={onClose} className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors">
              Done
            </button>
          </div>
        )}
      </div>

      {/* Confirm popup */}
      {confirmOpen && validation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-[12px] shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} className="text-[#2563EB]" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-[#0F172A]">Import {validation.ready} task{validation.ready !== 1 ? 's' : ''}?</h3>
                <p className="text-[13px] text-[#475569] mt-1">
                  This creates live tasks and notifies each assignee. A guarded undo is available for a short window afterward
                  (it can only remove tasks nobody has acted on yet).
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 rounded-[8px] text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors">
                Go back
              </button>
              <button onClick={handleImport} className="px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors">
                Yes, import now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo confirmation */}
      {undoConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-[12px] shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center shrink-0">
                <Undo2 size={20} className="text-[#DC2626]" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-[#0F172A]">Undo this import?</h3>
                <p className="text-[13px] text-[#475569] mt-1">
                  This removes the tasks created by this import. Any task that has already been acted on — worked on, commented,
                  or completed — is <strong>kept</strong> and listed afterward. This can’t be reversed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setUndoConfirm(null)} className="px-4 py-2 rounded-[8px] text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors">
                Go back
              </button>
              <button
                onClick={() => { const id = undoConfirm; setUndoConfirm(null); handleUndo(id) }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] transition-colors"
              >
                <Undo2 size={14} /> Yes, undo import
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (embedded) return shell
  return createPortal(
    <div className={`fixed inset-0 z-[60] flex justify-center bg-black/40 ${isFullPage ? 'items-stretch p-0' : 'items-end sm:items-center p-0 sm:p-4'}`}>
      {shell}
    </div>,
    document.body,
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────────

function FilterChip({ color, label, active, onClick }: { color: 'slate' | 'green' | 'red' | 'amber'; label: string; active: boolean; onClick: () => void }) {
  const palette = {
    slate: { on: 'bg-[#0F172A] text-white border-[#0F172A]', off: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0] hover:bg-[#E2E8F0]' },
    green: { on: 'bg-[#16A34A] text-white border-[#16A34A]', off: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0] hover:bg-[#BBF7D0]' },
    red: { on: 'bg-[#DC2626] text-white border-[#DC2626]', off: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA] hover:bg-[#FECACA]' },
    amber: { on: 'bg-[#B45309] text-white border-[#B45309]', off: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A] hover:bg-[#FDE68A]' },
  }[color]
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`inline-flex items-center px-2.5 py-1 rounded-[8px] border text-xs font-semibold transition-colors ${active ? palette.on : palette.off}`}>
      {label}
    </button>
  )
}

function ResultView({
  result, onUndo, undoing, undoResult, onDownloadFailures, rowLabel,
}: {
  result: TaskImportResult
  onUndo: () => void
  undoing: boolean
  undoResult: TaskUndoImportResult | null
  onDownloadFailures: () => void
  rowLabel: (rowNum: number) => number
}) {
  const failed = result.results.filter((r) => r.status === 'failed')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#DCFCE7] text-[#166534] text-sm font-semibold border border-[#BBF7D0]">
          <CheckCircle2 size={15} /> {result.created} created
        </span>
        {result.failed > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FEE2E2] text-[#991B1B] text-sm font-semibold border border-[#FECACA]">
            <AlertCircle size={15} /> {result.failed} failed
          </span>
        )}
      </div>

      {undoResult && (
        <div className="p-3.5 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] text-[13px] text-[#475569]">
          Undo removed <strong className="text-[#0F172A]">{undoResult.undone}</strong> task{undoResult.undone !== 1 ? 's' : ''}.
          {undoResult.kept.length > 0 && (
            <> <strong className="text-[#0F172A]">{undoResult.kept.length}</strong> kept because they’ve been acted on:
              <ul className="mt-1.5 space-y-1">
                {undoResult.kept.map((k, i) => (
                  <li key={i} className="text-[#475569]"><strong className="text-[#0F172A]">{k.title}</strong> — {k.reason}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#0F172A]">Rows that didn’t import</p>
            <button onClick={onDownloadFailures} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors">
              <Download size={13} /> Download to fix
            </button>
          </div>
          <div className="border border-[#E2E8F0] rounded-[10px] max-h-[280px] overflow-auto divide-y divide-[#E2E8F0]">
            {failed.map((r) => (
              <div key={r.row} className="px-3 py-2 text-[13px] bg-[#FEF2F2]">
                <span className="text-[#94A3B8]">Row {rowLabel(r.row)}</span> · <span className="font-medium text-[#0F172A]">{r.title || '—'}</span>
                <div className="text-[#DC2626]">{r.error}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.batch_id && result.created > 0 && !undoResult && (
        <button
          onClick={onUndo}
          disabled={undoing}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-[#DC2626] bg-white border-2 border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-60 transition-colors"
        >
          {undoing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Undo this import
        </button>
      )}
    </div>
  )
}

function HistoryView({
  batches, onUndo, onOpen, undoingId,
}: {
  batches: TaskImportBatchSummary[]
  onUndo: (id: string) => void
  onOpen: (id: string, origin?: 'history' | 'import') => void
  undoingId: string | null
}) {
  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-12 h-12 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-3"><History size={20} className="text-[#94A3B8]" /></div>
        <p className="text-sm font-medium text-[#0F172A]">No imports yet</p>
        <p className="text-[13px] text-[#475569] mt-1">Task imports you run will appear here.</p>
      </div>
    )
  }
  const statusBadge = (s: TaskImportBatchSummary['status']) => {
    const map = {
      committed: 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]',
      undone: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
      partially_undone: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    }[s]
    const label = s === 'partially_undone' ? 'Partly undone' : s === 'undone' ? 'Undone' : 'Committed'
    return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${map}`}>{label}</span>
  }
  return (
    <div className="space-y-2">
      {batches.map((b) => (
        <div key={b.id} className="flex items-center gap-3 p-3 rounded-[10px] border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors">
          <button onClick={() => onOpen(b.id, 'history')} className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[#0F172A] truncate">{b.file_name || 'Task import'}</p>
              {statusBadge(b.status)}
            </div>
            <p className="text-[12px] text-[#475569] mt-0.5">
              {b.created_count} created{b.failed_count > 0 ? ` · ${b.failed_count} failed` : ''} · {b.remaining} present · by {b.imported_by} · {new Date(b.created_at).toLocaleString()}
            </p>
          </button>
          {b.can_undo && (
            <button
              onClick={() => onUndo(b.id)}
              disabled={undoingId === b.id}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-[#DC2626] bg-white border border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-60 transition-colors"
            >
              {undoingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function BatchDetailView({
  detail, loading, onUndo, undoing,
}: {
  detail: TaskImportBatchDetail | null
  loading: boolean
  onUndo: (id: string) => void
  undoing: boolean
}) {
  if (loading || !detail) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="text-[#2563EB] animate-spin" /></div>
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#DCFCE7] text-[#166534] text-sm font-semibold border border-[#BBF7D0]">{detail.created_count} created</span>
        {detail.failed_count > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FEE2E2] text-[#991B1B] text-sm font-semibold border border-[#FECACA]">{detail.failed_count} failed</span>}
        <span className="text-[13px] text-[#475569]">{detail.remaining} still present</span>
        {detail.can_undo && (
          <button
            onClick={() => onUndo(detail.id)}
            disabled={undoing}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-[#DC2626] bg-white border border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-60 transition-colors"
          >
            {undoing ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Undo import
          </button>
        )}
      </div>
      <div className="border border-[#E2E8F0] rounded-[10px] max-h-[52vh] overflow-auto divide-y divide-[#E2E8F0]">
        {detail.rows.map((r) => (
          <div key={r.row} className={`px-3 py-2 text-[13px] ${r.status === 'failed' ? 'bg-[#FEF2F2]' : 'bg-white'}`}>
            <div className="flex items-center gap-2">
              <span className="text-[#94A3B8]">Row {r.row}</span>
              <span className="font-medium text-[#0F172A]">{r.title || '—'}</span>
              {r.status === 'created' ? (
                <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full border ${r.still_present ? 'bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]' : 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]'}`}>
                  {r.still_present ? 'Present' : 'Removed'}
                </span>
              ) : (
                <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]">Failed</span>
              )}
            </div>
            {r.error && <div className="text-[#DC2626] mt-0.5">{r.error}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
