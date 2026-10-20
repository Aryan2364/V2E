'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  ShieldAlert,
  Wrench,
  ChevronRight,
} from 'lucide-react'
import {
  validateImport,
  commitImport,
  listImportBatches,
  undoImport,
  getImportBatchDetail,
  type BulkImportRow,
  type ImportValidationResult,
  type ImportValidationRow,
  type BulkImportResult,
  type ImportBatchSummary,
  type ImportBatchDetail,
  type UndoImportResult,
} from '@/lib/api/employees'
import { listSystemRoles, type SystemRoleLite } from '@/lib/api/permissions'
import { toast } from '@/components/ui/sonner'
import Tooltip from '@/components/ui/tooltip'
import type { Department, Role, EmployeeProfile } from '@/lib/types'
import { formatDateTime } from '@/lib/format'

interface Props {
  orgId: string
  departments: Department[]
  roles: Role[]
  employees: EmployeeProfile[]
  onClose: () => void
  onImported: () => void
}

/** Glue for combined dropdown values, e.g. "Backend Engineer · Backend". Must match the backend. */
const VALUE_SEPARATOR = ' · '

// Machine column keys, in template order.
const COLUMNS = [
  'name',
  'email',
  'password',
  'department',
  'is_department_head',
  'role',
  'system_role',
  'employment_type',
  'employee_code',
  'reporting_to',
  'date_of_joining',
  'date_of_birth',
  'marriage_date',
] as const

type Column = (typeof COLUMNS)[number]

const REQUIRED: Column[] = ['name', 'email', 'department', 'role', 'system_role']

const HEADER_LABEL: Record<Column, string> = {
  name: 'name *',
  email: 'email *',
  password: 'password',
  department: 'department *',
  is_department_head: 'is_department_head',
  role: 'role *',
  system_role: 'system_role *',
  employment_type: 'employment_type',
  employee_code: 'employee_code',
  reporting_to: 'reporting_to',
  date_of_joining: 'date_of_joining',
  date_of_birth: 'date_of_birth',
  marriage_date: 'marriage_date',
}

const COLUMN_ALIASES: Record<string, Column> = {
  name: 'name',
  full_name: 'name',
  email: 'email',
  password: 'password',
  department: 'department',
  dept: 'department',
  is_department_head: 'is_department_head',
  is_head: 'is_department_head',
  head_of_department: 'is_department_head',
  dept_head: 'is_department_head',
  department_head: 'is_department_head',
  role: 'role',
  job_role: 'role',
  system_role: 'system_role',
  access_role: 'system_role',
  employment_type: 'employment_type',
  employee_code: 'employee_code',
  code: 'employee_code',
  reporting_to: 'reporting_to',
  reports_to: 'reporting_to',
  manager: 'reporting_to',
  date_of_joining: 'date_of_joining',
  date_of_birth: 'date_of_birth',
  marriage_date: 'marriage_date',
}

function normalizeHeader(h: string): string {
  return h
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((v) => v && v.trim() !== '')))
}

// ─── CSV helpers (fallback when a .csv is uploaded) ─────────────────────────────

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

const STATUS_STYLES: Record<ImportValidationRow['status'], { dot: string; text: string; label: string }> = {
  ready: { dot: 'bg-success', text: 'text-success', label: 'Ready' },
  duplicate: { dot: 'bg-danger', text: 'text-danger', label: 'Duplicate' },
  error: { dot: 'bg-danger', text: 'text-danger', label: 'Error' },
}

/**
 * Fixed vocabulary for the exported "failure_status" column. The same categories
 * are used for every file so the column is reliably sortable/filterable in Excel
 * — never a new label invented per import.
 */
const FIELD_FAILURE_LABEL: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  password: 'Password',
  department: 'Department',
  is_department_head: 'Department Head',
  role: 'Role',
  system_role: 'System Role',
  employment_type: 'Employment Type',
  employee_code: 'Employee Code',
  reporting_to: 'Manager',
  date_of_joining: 'Date',
  date_of_birth: 'Date',
  marriage_date: 'Date',
}

/** Categorise a validation row's blocking problems into the fixed vocabulary. */
function failureStatusesFromRow(row: ImportValidationRow): string[] {
  const set = new Set<string>()
  if (row.status === 'duplicate') set.add('Duplicate')
  for (const iss of row.issues) {
    if (iss.severity !== 'error') continue
    set.add(FIELD_FAILURE_LABEL[iss.field ?? ''] ?? 'Other')
  }
  if (set.size === 0) set.add('Other')
  return Array.from(set)
}

/** Best-effort category when only a commit/undo error message is available. */
function failureStatusFromMessage(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('already exists') || m.includes('already a member') || m.includes('duplicate')) return 'Duplicate'
  if (m.includes('system role')) return 'System Role'
  if (m.includes('department head') || m.includes('head for') || m.includes('head of')) return 'Department Head'
  if (m.includes('department')) return 'Department'
  if (m.includes('role')) return 'Role'
  if (m.includes('manager') || m.includes('report')) return 'Manager'
  if (m.includes('email')) return 'Email'
  if (m.includes('employment')) return 'Employment Type'
  if (m.includes('code')) return 'Employee Code'
  if (m.includes('date') || m.includes('birth') || m.includes('joining') || m.includes('marriage')) return 'Date'
  if (m.includes('password')) return 'Password'
  if (m.includes('name')) return 'Name'
  return 'Other'
}

export default function ImportEmployeesModal({
  orgId,
  departments,
  roles,
  employees,
  onClose,
  onImported,
}: Props) {
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

  const [systemRoles, setSystemRoles] = useState<SystemRoleLite[]>([])
  useEffect(() => {
    listSystemRoles(orgId)
      .then(({ systemRoles }) => setSystemRoles(systemRoles))
      .catch(() => setSystemRoles([]))
  }, [orgId])

  type Phase = 'upload' | 'preview' | 'result' | 'history' | 'batch-detail'
  const [phase, setPhase] = useState<Phase>('upload')
  const [fileName, setFileName] = useState('')
  const [parsedRows, setParsedRows] = useState<BulkImportRow[]>([])
  const [validation, setValidation] = useState<ImportValidationResult | null>(null)
  const [commitResult, setCommitResult] = useState<BulkImportResult | null>(null)
  const [parseError, setParseError] = useState('')
  const [building, setBuilding] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [chipFilter, setChipFilter] = useState<'total' | 'ready' | 'duplicate' | 'error' | 'warning'>('total')

  const [batches, setBatches] = useState<ImportBatchSummary[]>([])
  const [undoResult, setUndoResult] = useState<UndoImportResult | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null)
  const [batchDetail, setBatchDetail] = useState<ImportBatchDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailOrigin, setDetailOrigin] = useState<'history' | 'import'>('history')

  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  )

  // ─── Template (.xlsx with 4 reference sheets + dropdowns) ─────────────────────
  async function downloadTemplate() {
    setBuilding(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Employees')
      const wsDept = wb.addWorksheet('Departments')
      const wsRole = wb.addWorksheet('Roles')
      const wsMgr = wb.addWorksheet('Reports To')
      const wsSys = wb.addWorksheet('System Roles')

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

      // Departments — Sr. No. | Department | Parent Department (sorted by name).
      refHeader(wsDept, ['Sr. No.', 'Department', 'Parent Department'])
      const deptSorted = [...departments].sort((a, b) => a.name.localeCompare(b.name))
      deptSorted.forEach((d, i) =>
        wsDept.addRow([i + 1, d.name, d.parent_department_id ? deptNameById.get(d.parent_department_id) ?? '' : '']),
      )
      wsDept.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 28))

      // Roles — Sr. No. | Role | Department | Value (sorted by dept, then role).
      refHeader(wsRole, ['Sr. No.', 'Role', 'Department', 'Value (pick this in Employees)'])
      const roleRows = [...roles]
        .map((r) => ({ title: r.title, dept: deptNameById.get(r.department_id) ?? '' }))
        .sort((a, b) => a.dept.localeCompare(b.dept) || a.title.localeCompare(b.title))
      roleRows.forEach((r, i) =>
        wsRole.addRow([i + 1, r.title, r.dept, `${r.title}${VALUE_SEPARATOR}${r.dept}`]),
      )
      wsRole.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : i === 3 ? 36 : 26))

      // Reports To — Sr. No. | Name | Department | Role | Value (sorted by dept, then name).
      refHeader(wsMgr, ['Sr. No.', 'Name', 'Department', 'Role', 'Value (pick this in Employees)'])
      const mgrRows = employees
        .map((e) => ({
          name: e.user?.name ?? '',
          dept: deptNameById.get(e.department_id) ?? '',
          role: e.role?.title ?? '',
        }))
        .filter((m) => m.name)
        .sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name))
      mgrRows.forEach((m, i) =>
        wsMgr.addRow([
          i + 1,
          m.name,
          m.dept,
          m.role,
          `${m.name}${VALUE_SEPARATOR}${m.dept}${VALUE_SEPARATOR}${m.role}`,
        ]),
      )
      wsMgr.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : i === 4 ? 40 : 24))

      // System Roles — Sr. No. | System Role. Preserve the API order
      // (Employee, Manager, Leadership, …, Administrator) rather than re-sorting.
      refHeader(wsSys, ['Sr. No.', 'System Role'])
      systemRoles.forEach((s, i) => wsSys.addRow([i + 1, s.name]))
      wsSys.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 8 : 30))

      // Main sheet header.
      ws.addRow(COLUMNS.map((c) => HEADER_LABEL[c]))
      const headerRow = ws.getRow(1)
      headerRow.height = 22
      headerRow.eachCell((cell: any, col: number) => {
        const key = COLUMNS[col - 1]
        const required = REQUIRED.includes(key)
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: required ? 'FF1E40AF' : 'FF475569' },
        }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      ws.columns.forEach((c: any) => (c.width = 22))

      // Example rows.
      const sampleDept = deptSorted[0]
      const sampleRole = roleRows[0]
      const deptName = sampleDept?.name ?? 'Engineering'
      const roleValue = sampleRole ? `${sampleRole.title}${VALUE_SEPARATOR}${sampleRole.dept}` : 'Software Engineer · Engineering'
      const sysName = systemRoles[0]?.name ?? 'Member'
      const mgrValue = mgrRows[0]
        ? `${mgrRows[0].name}${VALUE_SEPARATOR}${mgrRows[0].dept}${VALUE_SEPARATOR}${mgrRows[0].role}`
        : ''
      ws.addRow(['Jane Doe', 'jane.doe@company.com', '', deptName, 'Yes', roleValue, sysName, 'full_time', 'EMP-001', '', '2024-01-15', '1995-06-20', ''])
      ws.addRow(['John Smith', 'john.smith@company.com', '', deptName, 'No', roleValue, sysName, 'part_time', 'EMP-002', mgrValue, '2024-03-01', '1990-11-02', '2019-12-10'])

      // Dropdowns + date constraints for rows 2..LAST.
      const LAST = 500
      const colLetter: Record<Column, string> = {
        name: 'A',
        email: 'B',
        password: 'C',
        department: 'D',
        is_department_head: 'E',
        role: 'F',
        system_role: 'G',
        employment_type: 'H',
        employee_code: 'I',
        reporting_to: 'J',
        date_of_joining: 'K',
        date_of_birth: 'L',
        marriage_date: 'M',
      }
      const addListDV = (col: Column, formula: string) => {
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${colLetter[col]}${r}`).dataValidation = {
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
      const addDateDV = (col: Column) => {
        for (let r = 2; r <= LAST; r++) {
          ws.getCell(`${colLetter[col]}${r}`).numFmt = 'yyyy-mm-dd'
          ws.getCell(`${colLetter[col]}${r}`).dataValidation = {
            type: 'date',
            operator: 'lessThanOrEqual',
            allowBlank: true,
            formulae: ['=TODAY()'],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Check the date',
            error: 'Enter a real date that is not in the future (YYYY-MM-DD).',
          }
        }
      }
      addListDV('department', `'Departments'!$B$2:$B$${deptSorted.length + 1}`)
      // Department Head is a Yes/No choice; No is the default (listed first, and
      // a blank cell is treated as No by the importer).
      addListDV('is_department_head', '"No,Yes"')
      addListDV('role', `'Roles'!$D$2:$D$${roleRows.length + 1}`)
      addListDV('system_role', `'System Roles'!$B$2:$B$${systemRoles.length + 1}`)
      addListDV('reporting_to', `'Reports To'!$E$2:$E$${mgrRows.length + 1}`)
      addListDV('employment_type', '"full_time,part_time,contract"')
      addDateDV('date_of_joining')
      addDateDV('date_of_birth')
      addDateDV('marriage_date')

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'employee-import-template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not build the template. Please try again.')
    } finally {
      setBuilding(false)
    }
  }

  // ─── Parsing ──────────────────────────────────────────────────────────────────

  function gridToRows(grid: string[][]): { rows: BulkImportRow[]; error?: string } {
    if (grid.length === 0) return { rows: [], error: 'The file is empty.' }
    const header = grid[0].map(normalizeHeader)
    const idx: Partial<Record<Column, number>> = {}
    header.forEach((h, i) => {
      const col = COLUMN_ALIASES[h]
      if (col && idx[col] === undefined) idx[col] = i
    })
    if (idx.name === undefined || idx.email === undefined) {
      return {
        rows: [],
        error:
          'Could not find the required "name" and "email" columns. Download the template to see the expected format.',
      }
    }

    const parsed: BulkImportRow[] = []
    for (let r = 1; r < grid.length; r++) {
      const cells = grid[r]
      if (!cells || cells.every((c) => (c ?? '').trim() === '')) continue
      const get = (c: Column) => {
        const i = idx[c]
        return i !== undefined ? (cells[i] ?? '').trim() : ''
      }
      parsed.push({
        name: get('name'),
        email: get('email'),
        password: get('password'),
        department: get('department'),
        is_department_head: get('is_department_head'),
        role: get('role'),
        system_role: get('system_role'),
        employment_type: get('employment_type'),
        employee_code: get('employee_code'),
        reporting_to: get('reporting_to'),
        date_of_joining: get('date_of_joining'),
        date_of_birth: get('date_of_birth'),
        marriage_date: get('marriage_date'),
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
    const ws = wb.getWorksheet('Employees') ?? wb.worksheets[0]
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

  async function runValidation(rows: BulkImportRow[]) {
    setValidating(true)
    try {
      const res = await validateImport(orgId, rows)
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
      if (error) {
        setParseError(error)
        return
      }
      setParsedRows(parsed)
      runValidation(parsed)
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

  // ─── Failed-rows export ───────────────────────────────────────────────────────

  /**
   * Write the original cells for the given rows to an .xlsx, with two trailing
   * columns: `failure_status` (a fixed-vocabulary category — Duplicate, Role,
   * Department, … — for sorting/filtering in Excel) and `reason_for_failure`
   * (the human-readable detail). Neither header is a known import column, so
   * re-uploading this exact file ignores both — the user fixes the cells and
   * uploads again without stripping anything.
   */
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
        const fg =
          col === COLUMNS.length + 1 ? 'FFB45309' : col === COLUMNS.length + 2 ? 'FFDC2626' : 'FF475569'
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } }
      })
      for (const e of entries) {
        ws.addRow([...COLUMNS.map((c) => (e.payload as any)[c] ?? ''), e.status, e.reason])
      }
      ws.columns.forEach((c: any) => (c.width = 22))
      // AutoFilter so the user can sort/filter by failure_status right away.
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length + 2 } }
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not build the file.')
    }
  }

  /** Preview step: the rows the validator flagged as not-ready. */
  function downloadFailures() {
    if (!validation) return
    const entries = validation.rows
      .filter((r) => r.status !== 'ready')
      .map((vr) => ({
        payload: parsedRows[vr.row - 2] ?? {},
        status: failureStatusesFromRow(vr).join(', '),
        reason: vr.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '),
      }))
    void exportRows(entries, 'employee-import-failures.xlsx')
  }

  /**
   * Result step: rows that failed to import, plus — once an undo has run — the
   * rows that were removed. The user gets one file with the full correctable
   * set (failed + removed) so they can fix and re-upload in a single pass.
   */
  function downloadResultRows() {
    if (!commitResult) return
    const keptEmails = new Set((undoResult?.kept ?? []).map((k) => k.email.toLowerCase()))
    const entries: { payload: Record<string, any>; status: string; reason: string }[] = []
    for (const r of commitResult.results) {
      const payload = parsedRows[r.row - 2] ?? {}
      if (r.status === 'failed') {
        entries.push({ payload, status: failureStatusFromMessage(r.error || ''), reason: r.error || 'Failed to import' })
      } else if (undoResult && !keptEmails.has(r.email.toLowerCase())) {
        entries.push({ payload, status: 'Removed', reason: 'Removed by undo — re-upload this row to re-create the employee' })
      }
    }
    void exportRows(entries, 'employee-import-fixes.xlsx')
  }

  /** History detail: failed rows + rows removed by an undo, from stored payloads. */
  function downloadBatchDetailRows(detail: ImportBatchDetail) {
    const entries: { payload: Record<string, any>; status: string; reason: string }[] = []
    for (const r of detail.rows) {
      if (r.status === 'failed') {
        entries.push({ payload: r.data, status: failureStatusFromMessage(r.error || ''), reason: r.error || 'Failed to import' })
      } else if (!r.still_present) {
        entries.push({ payload: r.data, status: 'Removed', reason: 'Removed by undo — re-upload this row to re-create the employee' })
      }
    }
    void exportRows(entries, 'employee-import-fixes.xlsx')
  }

  async function openBatch(batchId: string, origin: 'history' | 'import' = 'history') {
    setDetailOrigin(origin)
    setPhase('batch-detail')
    setBatchDetail(null)
    setLoadingDetail(true)
    try {
      setBatchDetail(await getImportBatchDetail(orgId, batchId))
    } catch {
      toast.error('Could not load this import’s details.')
      if (origin === 'history') setPhase('history')
    } finally {
      setLoadingDetail(false)
    }
  }

  // ─── Commit ───────────────────────────────────────────────────────────────────

  async function handleImport() {
    setConfirmOpen(false)
    setImporting(true)
    try {
      const res = await commitImport(orgId, parsedRows, fileName)
      setCommitResult(res)
      if (res.created > 0) {
        const importedMsg = `Imported ${res.created} employee${res.created !== 1 ? 's' : ''}`
        if (res.failed > 0) toast.warning(importedMsg)
        else toast.success(importedMsg)
        onImported()
        // Land on the full Import details page for the batch just created.
        if (res.batch_id) {
          await openBatch(res.batch_id, 'import')
        } else {
          setPhase('result')
        }
      } else {
        // Nothing created (every row failed) — no batch exists; show the result
        // screen so the failed rows and their reasons are still visible.
        setPhase('result')
        toast.error('No employees were imported')
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
    try {
      setBatches(await listImportBatches(orgId))
    } catch {
      setBatches([])
    }
  }

  async function handleUndo(batchId: string) {
    setUndoingId(batchId)
    try {
      const res = await undoImport(orgId, batchId)
      setUndoResult(res)
      const undoMsg = res.undone > 0 ? `Removed ${res.undone} imported employee${res.undone !== 1 ? 's' : ''}` : 'Nothing was removed'
      if (res.kept.length > 0) toast.warning(undoMsg)
      else toast.success(undoMsg)
      onImported()
      setBatches(await listImportBatches(orgId))
      // If a detail view is open for this batch, refresh it to reflect removals.
      if (batchDetail?.id === batchId) {
        try {
          setBatchDetail(await getImportBatchDetail(orgId, batchId))
        } catch {
          /* keep the stale detail rather than blanking the view */
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Undo failed.'
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg)
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
    const rows = validation.rows
    switch (chipFilter) {
      case 'ready':
        return rows.filter((r) => r.status === 'ready')
      case 'duplicate':
        return rows.filter((r) => r.status === 'duplicate')
      case 'error':
        return rows.filter((r) => r.status === 'error')
      case 'warning':
        return rows.filter((r) => r.status === 'ready' && r.issues.some((i) => i.severity === 'warning'))
      default:
        return rows
    }
  }, [validation, chipFilter])

  if (!mounted) return null

  // The review step ("Review before importing") is a full-page workspace so the
  // whole row table is visible at once; every other phase stays a compact modal.
  const isFullPage = phase === 'preview'

  return createPortal(
    <div
      className={`fixed inset-0 z-60 flex justify-center bg-backdrop ${
        isFullPage ? 'items-stretch p-0' : 'items-end sm:items-center p-0 sm:p-4'
      }`}
    >
      <div
        className={`bg-surface shadow-xl flex flex-col ${
          isFullPage
            ? 'w-full h-full max-h-none rounded-none'
            : 'w-full sm:max-w-3xl sm:rounded-card rounded-t-xl max-h-[92vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div className="flex items-center gap-3">
            {(phase === 'history' || phase === 'batch-detail') && (
              <button
                onClick={
                  phase === 'history'
                    ? resetToUpload
                    : detailOrigin === 'import'
                      ? resetToUpload
                      : openHistory
                }
                className="p-1.5 rounded-md text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
                aria-label="Back"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="text-section font-medium text-text-primary">
              {phase === 'preview'
                ? 'Review before importing'
                : phase === 'history'
                  ? 'Import history'
                  : phase === 'batch-detail'
                    ? 'Import details'
                    : 'Import Employees'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {phase === 'upload' && (
              <button
                onClick={openHistory}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-label font-medium text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
              >
                <History size={15} /> History
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body — in full-page review this is the single scroll region so the
            whole content (summary + table) scrolls under a pinned header/footer. */}
        <div
          className={`px-6 py-4 overflow-y-auto space-y-4 ${isFullPage ? 'flex-1 min-h-0' : ''}`}
        >
          {/* ── Upload ── */}
          {phase === 'upload' && (
            <>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-subtle border border-primary-border">
                <FileText size={18} className="text-primary-text mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-body font-medium text-text-primary">Step 1 — Download the Excel template</p>
                  <p className="text-label text-text-secondary mt-0.5">
                    Required columns (<span className="font-medium text-primary-text">blue header, marked *</span>): name,
                    email, department, role, system_role. The <strong>department</strong>, <strong>role</strong>,{' '}
                    <strong>system role</strong>, <strong>manager</strong> and <strong>employment type</strong> columns
                    are <strong>dropdowns</strong> sourced from the reference sheets. Dates use a date picker and can’t be
                    in the future. Leave password blank to default to <strong>Welcome@123</strong>.
                  </p>
                  <button
                    onClick={downloadTemplate}
                    disabled={building}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
                  >
                    {building ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {building ? 'Building…' : 'Download Excel template'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-body font-medium text-text-primary mb-2">Step 2 — Upload the filled file to review</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-surface-sunken transition-colors"
                >
                  {validating ? (
                    <Loader2 size={26} className="text-primary-text animate-spin" />
                  ) : (
                    <UploadCloud size={26} className="text-text-muted" />
                  )}
                  <span className="text-body font-medium text-text-secondary">
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
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">
                  {parseError}
                </div>
              )}
            </>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && validation && (
            <>
              {/* Clickable filter chips — click a category to show only those
                  rows below; "total" (default) shows everything. */}
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip color="slate" label={`${validation.total} total`} active={chipFilter === 'total'} onClick={() => setChipFilter('total')} />
                <FilterChip color="green" label={`${validation.ready} ready`} active={chipFilter === 'ready'} onClick={() => setChipFilter('ready')} />
                {validation.duplicates > 0 && (
                  <FilterChip color="red" label={`${validation.duplicates} duplicate`} active={chipFilter === 'duplicate'} onClick={() => setChipFilter('duplicate')} />
                )}
                {validation.errors > 0 && (
                  <FilterChip color="red" label={`${validation.errors} error`} active={chipFilter === 'error'} onClick={() => setChipFilter('error')} />
                )}
                {validation.warnings > 0 && (
                  <FilterChip color="amber" label={`${validation.warnings} warning`} active={chipFilter === 'warning'} onClick={() => setChipFilter('warning')} />
                )}
                <span className="ml-auto text-meta text-text-muted">from {fileName}</span>
              </div>

              {/* Row table — bounded height with its own scroll so the list never
                  stretches the page; the outer body still scrolls normally. */}
              <div className="border border-border-light rounded-xl overflow-hidden">
                <div className="max-h-[72vh] overflow-auto">
                  <table className="w-full text-label">
                    <thead className="bg-surface-sunken sticky top-0 z-10">
                      <tr className="text-left text-text-muted">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Department</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">System role</th>
                        <th className="px-3 py-2 font-medium">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-control-pressed">
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-label text-text-muted">
                            No rows in this category.
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((r, i) => {
                        const s = STATUS_STYLES[r.status]
                        // Zebra striping + a clearly visible divider so two
                        // adjacent rows never blur together; problem rows keep a
                        // solid (not faded) red tint, with red preserved on hover.
                        const rowBg =
                          r.status !== 'ready'
                            ? 'bg-danger-bg hover:bg-danger-bg'
                            : `${i % 2 === 1 ? 'bg-surface-sunken' : 'bg-surface'} hover:bg-surface-control`
                        return (
                          <tr key={r.row} className={`${rowBg} transition-colors`}>
                            <td className="px-3 py-2 text-text-muted">{r.row}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1.5 font-medium ${s.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                                {s.label}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-text-primary">{r.name || '—'}</div>
                              <div className="text-text-muted">{r.email || '—'}</div>
                            </td>
                            <td className="px-3 py-2 text-text-secondary">{r.resolved.department || '—'}</td>
                            <td className="px-3 py-2 text-text-secondary">{r.resolved.role || '—'}</td>
                            <td className="px-3 py-2 text-text-secondary">{r.resolved.system_role || '—'}</td>
                            <td className="px-3 py-2">
                              {r.issues.length === 0 ? (
                                <span className="text-text-muted">—</span>
                              ) : (
                                <ul className="space-y-0.5">
                                  {r.issues.map((iss, k) => (
                                    <li
                                      key={k}
                                      className={`flex items-start gap-1 ${iss.severity === 'error' ? 'text-danger' : 'text-warning'}`}
                                    >
                                      {iss.severity === 'error' ? (
                                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                                      ) : (
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                      )}
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

              {/* Fix-loop guidance + download — below the table. */}
              {(() => {
                const notReady = validation.rows.filter((r) => r.status !== 'ready').length
                if (notReady === 0) return null
                const rowWord = notReady === 1 ? 'row' : 'rows'
                return (
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-primary-subtle border border-primary-border">
                    <Wrench size={18} className="text-primary-text mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-label text-primary-text">
                        <strong>{validation.ready} of {validation.total} rows are ready</strong> and will be imported now.
                        The other <strong>{notReady} {rowWord}</strong> {notReady === 1 ? 'has a problem' : 'have problems'} and
                        will be skipped — your ready rows aren’t affected.
                      </p>
                      <p className="text-label text-primary-text mt-1">
                        Download a file with <strong>only those {notReady} {rowWord}</strong> (each tagged with the reason it
                        failed), fix them there, and re-upload just that file — no need to touch the rows that already passed.
                      </p>
                      <button
                        onClick={downloadFailures}
                        className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-label font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
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
              onDownload={downloadResultRows}
            />
          )}

          {/* ── History ── */}
          {phase === 'history' && (
            <HistoryView
              batches={batches}
              onUndo={(id) => setUndoConfirm(id)}
              onOpen={openBatch}
              undoingId={undoingId}
              undoResult={undoResult}
            />
          )}

          {/* ── Batch detail (after import, or reopened from history) ── */}
          {phase === 'batch-detail' && (
            <BatchDetailView
              detail={batchDetail}
              loading={loadingDetail}
              origin={detailOrigin}
              onUndo={(id) => setUndoConfirm(id)}
              undoing={!!batchDetail && undoingId === batchDetail.id}
              onDownload={() => batchDetail && downloadBatchDetailRows(batchDetail)}
            />
          )}
        </div>

        {/* Footer */}
        {phase === 'preview' && validation && (
          <div className="flex items-center gap-4 px-6 py-4 border-t border-border-light">
            {/* Warning fills the empty space on the left of the button bar. */}
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <ShieldAlert size={16} className="text-warning mt-0.5 shrink-0" />
              <p className="text-meta leading-snug text-warning">
                Importing creates live user accounts and is <strong>not automatically reversible</strong> — please check the
                rows above thoroughly. Only the <strong>{validation.ready} ready</strong> row
                {validation.ready !== 1 ? 's' : ''} will be imported; the rest are skipped (download them to fix and
                re-upload). A short-lived undo is available right after import.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPhase('upload')}
              className="shrink-0 px-4 py-2.5 rounded-lg text-body font-medium text-primary-text bg-surface border-2 border-primary hover:bg-primary-subtle transition-colors"
            >
              Choose another file
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={validation.ready === 0 || importing}
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
            >
              {importing && <Loader2 size={15} className="animate-spin" />}
              {importing ? 'Importing…' : `Import ${validation.ready} ready`}
            </button>
          </div>
        )}

        {phase === 'result' && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
            <button
              onClick={resetToUpload}
              className="px-4 py-2.5 rounded-lg text-body font-medium text-primary-text bg-surface border-2 border-primary hover:bg-primary-subtle transition-colors"
            >
              Import another file
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* Footer only after a fresh import (finish actions). When opened from
            history, the top-left back arrow is the only affordance needed. */}
        {phase === 'batch-detail' && detailOrigin === 'import' && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
            <button
              onClick={resetToUpload}
              className="px-4 py-2.5 rounded-lg text-body font-medium text-primary-text bg-surface border-2 border-primary hover:bg-primary-subtle transition-colors"
            >
              Import another file
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Confirm popup */}
      {confirmOpen && validation && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-backdrop p-4">
          <div className="bg-surface rounded-card shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center shrink-0">
                <ShieldAlert size={20} className="text-danger" />
              </div>
              <div>
                <h3 className="text-card-heading font-medium text-text-primary">Import {validation.ready} employees?</h3>
                <p className="text-label text-text-secondary mt-1">
                  This creates live accounts and <strong>cannot be undone automatically</strong>. A guarded undo is
                  available for a short window afterward, but it can only remove people who haven’t started accumulating
                  data. Make sure you’ve reviewed the rows.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg text-body font-medium text-text-secondary bg-surface border border-border-light hover:bg-surface-sunken transition-colors"
              >
                Go back
              </button>
              <button
                onClick={handleImport}
                className="px-4 py-2 rounded-lg text-body font-medium text-on-danger bg-danger hover:bg-danger-hover transition-colors"
              >
                Yes, import now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo confirmation */}
      {undoConfirm && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-backdrop p-4">
          <div className="bg-surface rounded-card shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center shrink-0">
                <Undo2 size={20} className="text-danger" />
              </div>
              <div>
                <h3 className="text-card-heading font-medium text-text-primary">Undo this import?</h3>
                <p className="text-label text-text-secondary mt-1">
                  This removes the employee accounts created by this import. Anyone who already has activity — heads a
                  department, owns data, or has people reporting to them — is <strong>kept</strong> and listed afterward.
                  This can’t be reversed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setUndoConfirm(null)}
                className="px-4 py-2 rounded-lg text-body font-medium text-text-secondary bg-surface border border-border-light hover:bg-surface-sunken transition-colors"
              >
                Go back
              </button>
              <button
                onClick={() => {
                  const id = undoConfirm
                  setUndoConfirm(null)
                  handleUndo(id)
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-body font-medium text-on-danger bg-danger hover:bg-danger-hover transition-colors"
              >
                <Undo2 size={14} /> Yes, undo import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────────

function FilterChip({
  color,
  label,
  active,
  onClick,
}: {
  color: 'slate' | 'green' | 'red' | 'amber'
  label: string
  active: boolean
  onClick: () => void
}) {
  const palette = {
    slate: { on: 'bg-text-primary text-surface border-text-primary', off: 'bg-surface-control text-text-secondary border-border-light hover:bg-surface-control-pressed' },
    green: { on: 'bg-success text-primary-foreground border-success', off: 'bg-success-bg text-success border-success-border hover:bg-success-bg' },
    red: { on: 'bg-danger text-on-danger border-danger', off: 'bg-danger-bg text-danger border-danger-border hover:bg-danger-bg' },
    amber: { on: 'bg-warning text-primary-foreground border-warning-border', off: 'bg-warning-bg text-warning border-warning-border hover:bg-warning-bg' },
  }[color]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-meta font-medium transition-colors ${active ? palette.on : palette.off}`}
    >
      {label}
    </button>
  )
}

function ResultView({
  result,
  onUndo,
  undoing,
  undoResult,
  onDownload,
}: {
  result: BulkImportResult
  onUndo: () => void
  undoing: boolean
  undoResult: UndoImportResult | null
  onDownload: () => void
}) {
  const failed = result.results.filter((r) => r.status === 'failed')
  const keptEmails = new Set((undoResult?.kept ?? []).map((k) => k.email.toLowerCase()))
  // After undo, the removed people are the ones this import created minus the
  // ones the undo had to keep — derivable here, no extra round-trip.
  const removed = undoResult
    ? result.results.filter((r) => r.status === 'created' && !keptEmails.has(r.email.toLowerCase()))
    : []
  const downloadCount = failed.length + removed.length
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {undoResult ? (
          // After an undo, the import counts are stale — show what the undo did.
          <>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-control border border-border-light">
              <Undo2 size={16} className="text-text-secondary" />
              <span className="text-body font-medium text-text-secondary">{undoResult.undone} removed</span>
            </div>
            {undoResult.kept.length > 0 && (
              <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-warning-bg border border-warning-border">
                <AlertTriangle size={16} className="text-warning" />
                <span className="text-body font-medium text-warning">{undoResult.kept.length} kept</span>
              </div>
            )}
            {failed.length > 0 && (
              <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-danger-bg border border-danger-border">
                <AlertCircle size={16} className="text-danger" />
                <span className="text-body font-medium text-danger">{failed.length} failed</span>
              </div>
            )}
          </>
        ) : (
          <>
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
            {result.batch_id && result.created > 0 && (
              <button
                onClick={onUndo}
                disabled={undoing}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-body font-medium text-danger bg-surface border border-danger-border hover:bg-danger-bg disabled:opacity-60 transition-colors"
              >
                {undoing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                Undo this import
              </button>
            )}
          </>
        )}
      </div>

      {downloadCount > 0 && (
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-label font-medium text-primary-text bg-primary-subtle border border-primary-border hover:bg-primary-subtle transition-colors"
        >
          <Download size={14} />
          {removed.length > 0
            ? `Download ${downloadCount} rows to fix & re-upload (${failed.length} failed + ${removed.length} removed)`
            : `Download ${failed.length} ${failed.length === 1 ? 'row' : 'rows'} to fix & re-upload`}
        </button>
      )}

      {undoResult && undoResult.kept.length > 0 && <UndoSummary undoResult={undoResult} compact />}

      {removed.length > 0 && (
        <div className="border border-border-light rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
            <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">Removed ({removed.length})</p>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-surface-control">
            {removed.map((r) => (
              <div key={r.row} className="px-4 py-2">
                <p className="text-label text-text-primary">
                  <span className="font-medium">{r.name || `Row ${r.row}`}</span>
                  {r.email && <span className="text-text-muted"> · {r.email}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="border border-border-light rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
            <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">Rows that need fixing</p>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-surface-control">
            {failed.map((r) => (
              <div key={r.row} className="px-4 py-2.5">
                <p className="text-body font-medium text-text-primary">
                  Row {r.row}
                  {r.email ? ` · ${r.email}` : r.name ? ` · ${r.name}` : ''}
                </p>
                <p className="text-body text-danger mt-0.5">{r.error}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!undoResult && (
        <p className="text-label text-text-secondary">
          New accounts use the password from the sheet, or{' '}
          <span className="font-medium text-text-primary">Welcome@123</span> when the password column is blank. Ask staff to
          change it after first sign-in.
        </p>
      )}
    </div>
  )
}

function UndoSummary({ undoResult, compact = false }: { undoResult: UndoImportResult; compact?: boolean }) {
  return (
    <div className="border border-border-light rounded-xl p-4 space-y-2">
      {!compact && (
        <p className="text-body font-medium text-text-primary">
          Removed {undoResult.undone} employee{undoResult.undone !== 1 ? 's' : ''}.
        </p>
      )}
      {undoResult.kept.length > 0 && (
        <>
          <p className="text-label text-warning">
            Kept {undoResult.kept.length} — they already had activity and were left untouched:
          </p>
          <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
            {undoResult.kept.map((k) => (
              <li key={k.email} className="text-label text-text-secondary">
                <span className="font-medium text-text-primary">{k.name}</span> — {k.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function HistoryView({
  batches,
  onUndo,
  onOpen,
  undoingId,
  undoResult,
}: {
  batches: ImportBatchSummary[]
  onUndo: (batchId: string) => void
  onOpen: (batchId: string) => void
  undoingId: string | null
  undoResult: UndoImportResult | null
}) {
  if (batches.length === 0) {
    return <p className="text-body text-text-muted py-8 text-center">No imports yet.</p>
  }
  return (
    <div className="space-y-3">
      {undoResult && <UndoSummary undoResult={undoResult} />}
      <div className="border border-border-light rounded-xl divide-y divide-surface-control">
        {batches.map((b) => {
          return (
            <div key={b.id} className="px-4 py-3 flex items-center gap-3">
              <Tooltip label="Open this import’s details">
              <button
                type="button"
                onClick={() => onOpen(b.id)}
                className="flex-1 min-w-0 flex items-center gap-2 text-left group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-text-primary truncate group-hover:text-primary-text transition-colors">
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
                <ChevronRight
                  size={16}
                  className="shrink-0 text-text-muted group-hover:text-primary-text transition-colors"
                />
              </button>
              </Tooltip>
              {b.can_undo ? (
                <button
                  onClick={() => onUndo(b.id)}
                  disabled={undoingId === b.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label font-medium text-danger bg-surface border border-danger-border hover:bg-danger-bg disabled:opacity-60 transition-colors shrink-0"
                >
                  {undoingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                  Undo
                </button>
              ) : (
                <span className="text-meta text-text-muted shrink-0">
                  {b.status === 'committed' ? 'Undo window passed' : 'Undone'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BatchDetailView({
  detail,
  loading,
  origin,
  onUndo,
  undoing,
  onDownload,
}: {
  detail: ImportBatchDetail | null
  loading: boolean
  origin: 'history' | 'import'
  onUndo: (batchId: string) => void
  undoing: boolean
  onDownload: () => void
}) {
  if (loading || !detail) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading import details…
      </div>
    )
  }

  const createdPresent = detail.rows.filter((r) => r.status === 'created' && r.still_present)
  const removed = detail.rows.filter((r) => r.status === 'created' && !r.still_present)
  const failed = detail.rows.filter((r) => r.status === 'failed')
  const downloadCount = failed.length + removed.length
  const noRowDetail = detail.rows.length === 0
  // For reconstructed (pre-persistence) batches the removed rows aren't stored,
  // but the undo summary still records how many were removed.
  const removedCount = removed.length || (detail.rows_reconstructed ? detail.undo_summary?.undone ?? 0 : 0)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-body font-medium text-text-primary">{detail.file_name || 'Untitled import'}</p>
        <p className="text-meta text-text-muted mt-0.5">
          {formatDateTime(new Date(detail.created_at))} · by {detail.imported_by}
          {detail.status !== 'committed' && (
            <span className="ml-2 text-meta font-medium text-text-muted uppercase">{detail.status.replace('_', ' ')}</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-success-bg border border-success-border">
          <CheckCircle2 size={16} className="text-success" />
          <span className="text-body font-medium text-success">{createdPresent.length} present</span>
        </div>
        {removedCount > 0 && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-control border border-border-light">
            <Undo2 size={16} className="text-text-secondary" />
            <span className="text-body font-medium text-text-secondary">{removedCount} removed</span>
          </div>
        )}
        {failed.length > 0 && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-danger-bg border border-danger-border">
            <AlertCircle size={16} className="text-danger" />
            <span className="text-body font-medium text-danger">{failed.length} failed</span>
          </div>
        )}
        {detail.can_undo && (
          <button
            onClick={() => onUndo(detail.id)}
            disabled={undoing}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-body font-medium text-danger bg-surface border border-danger-border hover:bg-danger-bg disabled:opacity-60 transition-colors"
          >
            {undoing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
            Undo this import
          </button>
        )}
      </div>

      {noRowDetail ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-sunken border border-border-light">
          <AlertTriangle size={16} className="text-text-muted mt-0.5 shrink-0" />
          <p className="text-label text-text-muted">
            Row-level details weren’t recorded for this import (it predates detailed history). The summary above still
            applies: {detail.created_count} created, {detail.failed_count} failed, {detail.remaining} still present.
          </p>
        </div>
      ) : (
        <>
          {detail.rows_reconstructed && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-sunken border border-border-light">
              <AlertTriangle size={16} className="text-text-muted mt-0.5 shrink-0" />
              <p className="text-label text-text-muted">
                This import predates detailed history, so the list below is rebuilt from the employees still in the
                system. Original cell values and any failed rows weren’t recorded, so re-export isn’t available for this
                one. New imports keep full row-level detail.
              </p>
            </div>
          )}

          {downloadCount > 0 && (
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-label font-medium text-primary-text bg-primary-subtle border border-primary-border hover:bg-primary-subtle transition-colors"
            >
              <Download size={14} />
              {removed.length > 0
                ? `Download ${downloadCount} rows to fix & re-upload (${failed.length} failed + ${removed.length} removed)`
                : `Download ${failed.length} ${failed.length === 1 ? 'row' : 'rows'} to fix & re-upload`}
            </button>
          )}

          {detail.undo_summary && detail.undo_summary.kept.length > 0 && (
            <div className="border border-border-light rounded-xl p-4 space-y-2">
              <p className="text-label text-warning">
                Kept {detail.undo_summary.kept.length} on undo — they already had activity and were left untouched:
              </p>
              <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {detail.undo_summary.kept.map((k) => (
                  <li key={k.email} className="text-label text-text-secondary">
                    <span className="font-medium text-text-primary">{k.name}</span> — {k.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {removed.length > 0 && (
            <div className="border border-border-light rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
                <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">Removed ({removed.length})</p>
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-surface-control">
                {removed.map((r) => (
                  <div key={r.row} className="px-4 py-2">
                    <p className="text-label text-text-primary">
                      <span className="font-medium">{r.name || `Row ${r.row}`}</span>
                      {r.email && <span className="text-text-muted"> · {r.email}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {createdPresent.length > 0 && (
            <div className="border border-border-light rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
                <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">Imported &amp; present ({createdPresent.length})</p>
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-surface-control">
                {createdPresent.map((r) => (
                  <div key={r.row} className="px-4 py-2">
                    <p className="text-label text-text-primary">
                      <span className="font-medium">{r.name || `Row ${r.row}`}</span>
                      {r.email && <span className="text-text-muted"> · {r.email}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div className="border border-border-light rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-sunken border-b border-border-light">
                <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">Rows that need fixing ({failed.length})</p>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-surface-control">
                {failed.map((r) => (
                  <div key={r.row} className="px-4 py-2.5">
                    <p className="text-body font-medium text-text-primary">
                      Row {r.row}
                      {r.email ? ` · ${r.email}` : r.name ? ` · ${r.name}` : ''}
                    </p>
                    <p className="text-body text-danger mt-0.5">{r.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {origin === 'import' && (
        <>
          {createdPresent.length > 0 && (
            <p className="text-label text-text-secondary">
              New accounts use the password from the sheet, or{' '}
              <span className="font-medium text-text-primary">Welcome@123</span> when the password column is blank. Ask staff
              to change it after first sign-in.
            </p>
          )}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-sunken border border-border-light">
            <History size={15} className="text-text-muted mt-0.5 shrink-0" />
            <p className="text-label text-text-muted">
              You can reopen this import anytime from <span className="font-medium text-text-primary">Import → History</span>.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
