// Shared .xlsx helpers for the bulk-import modals. exceljs is large, so it is only ever
// loaded through a dynamic import, and only its types are imported statically.
import type { Cell, CellValue, DataValidation, Row, Workbook, Worksheet } from 'exceljs'
import { downloadBlob, toYmdLocal, toYmdUtc } from './csv'
import type { ColumnSpec, DateMode, ErrorReportEntry } from './types'

export type { Workbook, Worksheet }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function loadExcelJs(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

export async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = await loadExcelJs()
  return new ExcelJS.Workbook()
}

/** Cell text for a value: dates as YYYY-MM-DD, rich text joined, formulas as their result. */
export function cellText(value: CellValue | undefined, dateMode: DateMode): string {
  const v = value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (dateMode === 'utc') return toYmdUtc(v)
    if (dateMode === 'local') return toYmdLocal(v)
    return '' // 'none': date cells are not meaningful for this import and read as blank
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('result' in v) return v.result === null || v.result === undefined ? '' : String(v.result)
    return ''
  }
  return String(v)
}

/** Read a sheet into a grid of text cells (header row first). */
export async function readXlsxGrid(
  buffer: ArrayBuffer,
  opts: { sheetName?: string; minColumns: number; dateMode: DateMode },
): Promise<string[][]> {
  const wb = await newWorkbook()
  await wb.xlsx.load(buffer)
  const ws = (opts.sheetName ? wb.getWorksheet(opts.sheetName) : undefined) ?? wb.worksheets[0]
  if (!ws) return []
  const colCount = Math.max(ws.getRow(1).cellCount, opts.minColumns)
  const grid: string[][] = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value, opts.dateMode))
    grid.push(cells)
  }
  return grid
}

/** A, B ... Z, AA, AB ... for a 0-based column index. */
export function columnLetter(idx: number): string {
  return idx < 26
    ? String.fromCharCode(65 + idx)
    : columnLetter(Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26))
}

const HEADER_FILL_REQUIRED = 'FF1E40AF'
const HEADER_FILL_OPTIONAL = 'FF475569'

function fillCell(cell: Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/** A plain dark header row (reference sheets). */
export function writeReferenceHeader(sheet: Worksheet, headers: string[]): void {
  sheet.addRow(headers)
  const hr = sheet.getRow(1)
  hr.height = 20
  hr.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    fillCell(cell, HEADER_FILL_OPTIONAL)
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
}

/** The import sheet's header row: blue for required columns, slate for the rest. Returns the row. */
export function writeColumnHeader<K extends string>(
  ws: Worksheet,
  columns: readonly ColumnSpec<K>[],
  colWidth?: number,
): Row {
  ws.addRow(columns.map((c) => c.label))
  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell((cell, col) => {
    const required = columns[col - 1]?.required === true
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    fillCell(cell, required ? HEADER_FILL_REQUIRED : HEADER_FILL_OPTIONAL)
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
  if (colWidth !== undefined) ws.columns.forEach((c) => (c.width = colWidth))
  return headerRow
}

/** Set the width of every column of a reference sheet from a per-index rule. */
export function setColumnWidths(ws: Worksheet, widthOf: (index: number) => number): void {
  ws.columns.forEach((c, i) => (c.width = widthOf(i)))
}

/** Apply a data validation to rows 2..last of one column. */
export function addColumnValidation(
  ws: Worksheet,
  letter: string,
  last: number,
  validation: DataValidation,
  numFmt?: string,
): void {
  for (let r = 2; r <= last; r++) {
    const cell = ws.getCell(`${letter}${r}`)
    if (numFmt) cell.numFmt = numFmt
    cell.dataValidation = validation
  }
}

/** A dropdown. `strict` shows a warning when the value is not in the list. */
export function listValidation(formula: string, strict = true): DataValidation {
  return strict
    ? {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Pick from the list',
        error: 'Choose a value from the dropdown, or clear the cell.',
      }
    : { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: false }
}

/** A date constraint against today. */
export function dateValidation(operator: 'lessThanOrEqual' | 'greaterThanOrEqual', error: string): DataValidation {
  return {
    type: 'date',
    operator,
    allowBlank: true,
    formulae: ['=TODAY()'],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Check the date',
    error,
  }
}

async function downloadWorkbook(wb: Workbook, filename: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename)
}

/** Build a template workbook with the given filler and download it. */
export async function downloadTemplateXlsx(
  build: (wb: Workbook) => void | Promise<void>,
  filename: string,
): Promise<void> {
  const wb = await newWorkbook()
  await build(wb)
  await downloadWorkbook(wb, filename)
}

/**
 * Write the original cells for the given rows to an .xlsx, with two trailing columns:
 * `failure_status` (a fixed-vocabulary category, for sorting in Excel) and
 * `reason_for_failure` (the human-readable detail). Neither header is a known import
 * column, so re-uploading this exact file ignores both.
 */
export async function downloadErrorReport<K extends string>(
  columns: readonly ColumnSpec<K>[],
  entries: readonly ErrorReportEntry[],
  filename: string,
  colWidth: number,
): Promise<void> {
  if (entries.length === 0) return
  const wb = await newWorkbook()
  const ws = wb.addWorksheet('Fix these')
  ws.addRow([...columns.map((c) => c.label), 'failure_status', 'reason_for_failure'])
  const hr = ws.getRow(1)
  hr.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    fillCell(
      cell,
      col === columns.length + 1 ? 'FFB45309' : col === columns.length + 2 ? 'FFDC2626' : HEADER_FILL_OPTIONAL,
    )
  })
  for (const e of entries) {
    const payload = e.payload as Record<string, unknown>
    ws.addRow([...columns.map((c) => payload[c.key] ?? ''), e.status, e.reason])
  }
  ws.columns.forEach((c) => (c.width = colWidth))
  // AutoFilter so the user can sort/filter by failure_status right away.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + 2 } }
  await downloadWorkbook(wb, filename)
}
