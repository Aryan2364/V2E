import ExcelJS from 'exceljs'
import type { CalendarReport, CalendarRow, DayResult } from '@/lib/types/reports'
import { RESULT_META } from '@/lib/reports/calendar-format'

const HEADER_FILL = 'FF2563EB'
const TOTAL_FILL = 'FFEFF6FF'

const CELL_FILL: Record<DayResult, string> = {
  on_time: 'FFDCFCE7', late: 'FFFEF3C7', missed: 'FFFEE2E2', future: 'FFFFFFFF', withdrawn: 'FFF1F5F9',
  handed_over: 'FFF1F5F9',
}
const CELL_FONT: Record<DayResult, string> = {
  on_time: 'FF166534', late: 'FF92400E', missed: 'FF991B1B', future: 'FF475569', withdrawn: 'FF64748B',
  handed_over: 'FF475569',
}
// `withdrawn` ranks 0: it is the absence of a verdict, so any real mark on the same
// day must beat it in the worst-mark-wins tiebreak. Mirrors the backend's SEVERITY.
const SEVERITY: Record<DayResult, number> = { withdrawn: 0, handed_over: 0, future: 1, on_time: 2, late: 3, missed: 4 }
const RESULT_LABEL: Record<DayResult, string> = {
  on_time: 'Done On Time', late: 'Done Late', missed: 'Missed', future: 'Due, date not yet arrived',
  withdrawn: 'Withdrawn (removed before due)',
  handed_over: 'Handed over to someone else',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Excel serial date from a yyyy-mm-dd(…) ISO string (1899-12-30 epoch). */
function excelSerial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

/** First (worst) mark per day for a row. */
function dayMarks(row: CalendarRow): Map<number, DayResult> {
  const m = new Map<number, DayResult>()
  for (const c of row.cells) if (!m.has(c.day)) m.set(c.day, c.result)
  return m
}

/**
 * Build + download the client's two-sheet "Monthly Task Compliance Calendar":
 * the Calendar grid (D / L / X / W per day) and the Calendar Data it is drawn from.
 */
export async function exportCalendarXlsx(report: CalendarReport, filename: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'V2E'
  wb.created = new Date()

  // ── Calendar ─────────────────────────────────────────────────────────────────--
  const cal = wb.addWorksheet('Calendar', { views: [{ state: 'frozen', xSplit: 5, ySplit: 4 }] })
  const dayCount = report.days.length
  // 5 identity columns + the day grid + the four signed-off tallies + the two
  // integrity columns appended after them (Withdrawn, Due Dates Revised).
  const TAIL_COLS = 6
  const lastCol = 5 + dayCount + TAIL_COLS

  const title = cal.addRow([`Monthly Task Compliance Calendar — ${report.month_label}`])
  title.font = { bold: true, size: 15, color: { argb: 'FF0F172A' } }
  cal.mergeCells(1, 1, 1, lastCol)
  const sub = cal.addRow([`Position as on ${fmtDate(report.as_on_date)}   ·   D = Done On Time, L = Done Late, X = Missed, W = Due (date not yet arrived), – = Withdrawn (removed before due), blank = not scheduled   ·   Every mark is judged against the task's ORIGINAL due date, so changing a due date later cannot repaint a missed day`])
  sub.font = { italic: true, color: { argb: 'FF64748B' } }
  cal.mergeCells(2, 1, 2, lastCol)
  cal.addRow([])

  const head = cal.addRow([
    'Sr. No.', 'Task Name', 'Person Name', 'Frequency', 'Brought Forward',
    ...report.days.map((d) => `${d.day} ${d.dow}`),
    'Scheduled This Month', 'Done On Time', 'Done Late', 'Missed',
    'Withdrawn (Removed Before Due)', 'Due Dates Revised',
  ])
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  cal.getColumn(1).width = 7
  cal.getColumn(2).width = 38
  cal.getColumn(3).width = 20
  cal.getColumn(4).width = 11
  cal.getColumn(5).width = 9
  for (let i = 0; i < dayCount; i++) cal.getColumn(6 + i).width = 4.5
  for (let i = 0; i < TAIL_COLS; i++) cal.getColumn(6 + dayCount + i).width = 11

  report.rows.forEach((row, i) => {
    const marks = dayMarks(row)
    const cells: (string | number)[] = [i + 1, row.title, row.person, row.frequency, row.brought_forward || '']
    for (const d of report.days) {
      const r = marks.get(d.day)
      cells.push(r ? RESULT_META[r].code : '')
    }
    // Scheduled stays graded-only (= D + L + X + W), so the client's identity holds;
    // withdrawn is reported beside it rather than folded in.
    cells.push(row.scheduled, row.on_time, row.late, row.missed, row.withdrawn, row.revised_entries)
    const xrow = cal.addRow(cells)
    xrow.alignment = { vertical: 'middle' }
    // Colour the day cells by result.
    for (let di = 0; di < dayCount; di++) {
      const r = marks.get(report.days[di].day)
      if (!r) continue
      const cell = xrow.getCell(6 + di)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELL_FILL[r] } }
      cell.font = { bold: true, color: { argb: CELL_FONT[r] } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
  })

  const t = report.totals
  const totalRow = cal.addRow(['', `Total / Overall · ${t.rows} rows`, '', '', t.brought_forward || '',
    ...report.days.map(() => ''), t.scheduled, t.on_time, t.late, t.missed, t.withdrawn, t.revised_entries])
  totalRow.font = { bold: true }
  totalRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } } })

  // ── Calendar Data ──────────────────────────────────────────────────────────────
  const data = wb.addWorksheet('Calendar Data', { views: [{ state: 'frozen', ySplit: 1 }] })
  // Row Key stays column 9 so any saved lookup against it keeps working; the three
  // integrity columns are appended after it.
  const D_HEADERS = [
    'Task Name', 'Assigned To', 'Frequency', 'Due Date', 'Completion Date', 'Status',
    'Day Result', 'Severity', 'Row Key',
    'Original Due Date', 'Times Due Date Revised', 'Taken Off On', 'Now With',
  ]
  const dHead = data.addRow(D_HEADERS)
  dHead.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  dHead.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } } })
  data.columns = [
    { width: 40 }, { width: 22 }, { width: 11 }, { width: 14 }, { width: 15 },
    { width: 12 }, { width: 22 }, { width: 9 }, { width: 40 },
    { width: 16 }, { width: 12 }, { width: 14 }, { width: 24 },
  ]
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: D_HEADERS.length } }

  const flat = report.rows
    .flatMap((row) => row.cells.map((c) => ({ row, c })))
    .sort((a, b) => b.c.due_date.localeCompare(a.c.due_date) || (SEVERITY[b.c.result] - SEVERITY[a.c.result]))
  for (const { row, c } of flat) {
    data.addRow([
      // Due Date is the LIVE date — it is also what placed the square in its day
      // column. Original Due Date is what Day Result was actually judged against.
      row.title, row.person, row.frequency, fmtDate(c.due_date), fmtDate(c.completion_date),
      c.status ?? (c.result === 'missed' || c.result === 'future' ? 'overdue' : 'complete'),
      RESULT_LABEL[c.result], SEVERITY[c.result], `${row.title}|${row.person}|${excelSerial(c.due_date)}`,
      fmtDate(c.original_deadline), c.deadline_revision_count, fmtDate(c.handover?.at ?? null),
      (c.handover?.to ?? []).join(', '),
    ])
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
