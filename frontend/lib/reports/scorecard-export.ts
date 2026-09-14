import ExcelJS from 'exceljs'
import type { Scorecard, ScorecardMetrics } from '@/lib/types/reports'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Percent as a 0–1 fraction for cells formatted with a % number format. */
function frac(v: number | null): number | string {
  return v === null || v === undefined ? '' : v / 100
}

const HEADER_FILL = 'FF2563EB'
const TOTAL_FILL = 'FFEFF6FF'

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
}

/** Sum a set of scorecards into an Overall / Total row, recomputing every ratio. */
function totalsOf(cards: Scorecard[]): Omit<ScorecardMetrics, 'grade' | 'recurring_unique'> {
  let different = 0, total = 0, completed = 0, pending = 0, overdue = 0, ongoing = 0
  let onTime = 0, withDate = 0, noDate = 0, delaySum = 0, longest: number | null = null
  let ageSum = 0, oldest: number | null = null
  let withdrawn = 0, handedOver = 0, revised = 0
  for (const c of cards) {
    const m = c.metrics
    different += m.different_tasks
    total += m.total_given
    completed += m.completed
    pending += m.pending
    overdue += m.overdue
    ongoing += m.ongoing
    onTime += m.completed_on_time
    withDate += m.completed_with_date
    noDate += m.completed_no_date
    // Withdrawn stays its own total — never folded into total_given / completed /
    // on-time, so the Overall row reads "N entries graded, plus M withdrawn".
    withdrawn += m.withdrawn
    handedOver += m.handed_over
    revised += m.revised_entries
    if (m.completed_with_date > 0 && m.avg_delay_days !== null) delaySum += m.avg_delay_days * m.completed_with_date
    if (m.longest_delay_days !== null && (longest === null || m.longest_delay_days > longest)) longest = m.longest_delay_days
    if (m.overdue > 0 && m.avg_pending_age_days !== null) ageSum += m.avg_pending_age_days * m.overdue
    if (m.longest_pending_age_days !== null && (oldest === null || m.longest_pending_age_days > oldest)) oldest = m.longest_pending_age_days
  }
  return {
    different_tasks: different,
    total_given: total,
    avg_repeat: different > 0 ? Math.round((total / different) * 100) / 100 : null,
    completed,
    pending,
    overdue,
    ongoing,
    completion_pct: total > 0 ? Math.round((completed / total) * 100) : null,
    completed_on_time: onTime,
    completed_with_date: withDate,
    completed_no_date: noDate,
    on_time_pct: withDate > 0 ? Math.round((onTime / withDate) * 100) : null,
    avg_delay_days: withDate > 0 ? Math.round((delaySum / withDate) * 100) / 100 : null,
    longest_delay_days: longest,
    avg_pending_age_days: overdue > 0 ? Math.round((ageSum / overdue) * 100) / 100 : null,
    longest_pending_age_days: oldest,
    withdrawn,
    handed_over: handedOver,
    revised_entries: revised,
  }
}

/**
 * Build + download an .xlsx that mirrors the client's "Person Wise Task Compliance
 * Scorecard": a Scorecard sheet (13 columns + an Overall row + a How-to-read block)
 * and a Task Data sheet (one row per task entry — the live detail behind the metrics).
 */
export async function exportScorecardsXlsx(cards: Scorecard[], filename: string, windowLabel: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'V2E'
  wb.created = new Date()

  // ── Scorecard ──────────────────────────────────────────────────────────────────
  const sc = wb.addWorksheet('Scorecard', { views: [{ state: 'frozen', ySplit: 3 }] })
  // The client's 13 columns, then the two integrity columns APPENDED after Grade —
  // never inserted, so every signed-off column keeps its exact position.
  const SC_WIDTH = 15
  sc.columns = [
    { width: 7 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 11 },
    { width: 11 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 18 },
    { width: 12 }, { width: 13 },
  ]
  const title = sc.addRow(['Person Wise Task Compliance Scorecard'])
  title.font = { bold: true, size: 15, color: { argb: 'FF0F172A' } }
  sc.mergeCells(1, 1, 1, SC_WIDTH)
  const sub = sc.addRow([`Window: ${windowLabel}`])
  sub.font = { italic: true, color: { argb: 'FF64748B' } }
  sc.mergeCells(2, 1, 2, SC_WIDTH)

  styleHeader(sc.addRow([
    'Sr. No.', 'Person Name', 'Different Tasks Handled', 'Total Task Entries', 'Average Times Each Task Repeats',
    'Tasks Completed', 'Tasks Still Pending', 'Completion Rate', 'Finished On or Before Due Date', 'On Time Rate',
    'Average Delay in Days', 'Longest Delay in Days', 'Grade',
    'Withdrawn (Removed Before Due)', 'Handed Over (Late, Given to Someone Else)', 'Due Dates Revised',
  ]))

  cards.forEach((c, i) => {
    const m = c.metrics
    const row = sc.addRow([
      i + 1, c.employee.name, m.different_tasks, m.total_given, m.avg_repeat ?? '',
      m.completed, m.pending, frac(m.completion_pct), m.completed_on_time, frac(m.on_time_pct),
      m.avg_delay_days ?? '', m.longest_delay_days ?? '', m.grade,
      m.withdrawn, m.handed_over, m.revised_entries,
    ])
    row.getCell(8).numFmt = '0.0%'
    row.getCell(10).numFmt = '0.0%'
    row.getCell(11).numFmt = '0.00'
    row.alignment = { vertical: 'middle' }
  })

  // Overall / Total row.
  const t = totalsOf(cards)
  const totalRow = sc.addRow([
    '', 'Total / Overall', t.different_tasks, t.total_given, t.avg_repeat ?? '',
    t.completed, t.pending, frac(t.completion_pct), t.completed_on_time, frac(t.on_time_pct),
    t.avg_delay_days ?? '', t.longest_delay_days ?? '', '',
    t.withdrawn, t.handed_over, t.revised_entries,
  ])
  totalRow.font = { bold: true }
  totalRow.getCell(8).numFmt = '0.0%'
  totalRow.getCell(10).numFmt = '0.0%'
  totalRow.getCell(11).numFmt = '0.00'
  totalRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } } })

  // How to read.
  sc.addRow([])
  const howHead = sc.addRow(['How to read this Report'])
  howHead.font = { bold: true, size: 12, color: { argb: 'FF0F172A' } }
  const notes: string[] = [
    '1. Different Tasks Handled — how many different task names that person is responsible for. This is their real scope of work.',
    '2. Total Task Entries — how many times those tasks came up during the period. Example: 3 daily tasks over a year create about 840 entries.',
    '3. Average Times Each Task Repeats — Total Task Entries ÷ Different Tasks Handled. High = few tasks repeating often; low = wide, varied work.',
    '4. Tasks Still Pending — tasks whose status is Overdue or Ongoing, i.e. not yet closed.',
    '5. Completion Rate — Tasks Completed ÷ Total Task Entries.',
    '6. Finished On or Before Due Date — completed tasks whose completion date is on or before the due date.',
    '7. On Time Rate — On-Time tasks ÷ tasks that have a completion date. Pending work is kept out, otherwise heavy pending work shows a wrongly low figure.',
    '8. Average Delay in Days — average of (Completion Date − Due Date). A minus figure means the task was finished early.',
    '9. Longest Delay in Days — the single worst delay for that person.',
    '10. Grade — checked in this order, first match wins: under 25 Total Task Entries → Too Few Tasks to Judge | On Time Rate 60%+ → Very Good | 30%+ → Good | 15%+ → Average | below 15% but Completion Rate 90%+ → Late but Closing | everything else → Needs Attention.',
    '11. All on-time / late / delay figures are measured against the ORIGINAL due date — the date the task was first committed to. Changing a due date later can never turn a late task on time. Due Dates Revised shows how many of that person\'s tasks have had their due date changed at least once; the Task Data sheet gives the original and current date for each one.',
    '12. Withdrawn (Removed Before Due) — tasks the person was taken off BEFORE the original due date, without finishing. They were released while still in good standing, so these are left out of every figure above, including Total Task Entries and the Grade. They are shown here only so the removal is visible.',
    '13. Handed Over (Late, Given to Someone Else) — tasks that were ALREADY LATE when this person was taken off them. The delay was real and stays on their record: it is counted in Total Task Entries and reported as the days they were late on the day they handed it over. It is deliberately NOT counted as Pending or Overdue, and it stops ageing at the handover, because the work is no longer theirs to finish. The Task Data sheet names who holds each one now under "Now With" — so nobody has to chase the wrong person to find that out.',
  ]
  notes.forEach((n) => {
    const r = sc.addRow([n])
    sc.mergeCells(r.number, 1, r.number, SC_WIDTH)
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    r.height = 28
    r.font = { color: { argb: 'FF334155' } }
  })

  // ── Task Data ────────────────────────────────────────────────────────────────--
  const td = wb.addWorksheet('Task Data', { views: [{ state: 'frozen', ySplit: 1 }] })
  // Four integrity columns appended after the ten signed-off ones.
  const TD_HEADERS = [
    'Task Name', 'Assigned To', 'Assigned By', 'Department', 'Frequency',
    'Due Date', 'Completion Date', 'Status', 'Delay in Days', 'Finished On Time',
    'Original Due Date', 'Times Due Date Revised', 'Withdrawn', 'Taken Off On', 'Days Late At Handover', 'Now With',
  ]
  styleHeader(td.addRow(TD_HEADERS))
  td.columns = [
    { width: 40 }, { width: 22 }, { width: 20 }, { width: 20 }, { width: 12 },
    { width: 14 }, { width: 15 }, { width: 12 }, { width: 12 }, { width: 15 },
    { width: 16 }, { width: 12 }, { width: 11 }, { width: 14 }, { width: 18 }, { width: 24 },
  ]
  td.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TD_HEADERS.length } }
  for (const c of cards) {
    for (const e of c.entries) {
      td.addRow([
        // Due Date is the LIVE date (what is expected now); Original Due Date is what
        // Delay in Days and Finished On Time were actually measured against. Both are
        // present so a moved goalpost is visible rather than hidden behind one column.
        e.title, c.employee.name, e.assigned_by ?? '', e.department ?? '', e.frequency,
        fmtDate(e.due_date), fmtDate(e.completion_date), e.status ?? '',
        e.delay_days ?? '', e.on_time,
        fmtDate(e.original_deadline), e.deadline_revision_count,
        e.is_withdrawn ? 'Yes' : '', fmtDate(e.handover?.at ?? null),
        e.handover?.days_late_at_handover ?? '', (e.handover?.to ?? []).join(', '),
      ])
    }
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
