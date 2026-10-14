/*
 * The short due label a one-line phone task row shows at its right edge.
 * Keeps rows on one line, Google Tasks style: the date says only what the
 * row's context does not already say.
 *
 *   - Today / Tomorrow: the time ("5:00 PM"), or "Today" / "Tomorrow" when
 *     the task is due at end of day (23:59, the desktop default for a bare
 *     date). Under a "Today" or "Tomorrow" heading the day word is dropped,
 *     so an end-of-day task there shows no date at all.
 *   - Any other day: "18 Oct" (DD Mon, FRONTEND_RULES section 18), plus the
 *     year when it is not this year.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function time(d: Date): string {
  const h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

export function shortDue(iso: string | null | undefined, opts: { dayKnown?: boolean } = {}): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59

  const dayWord = sameDay(d, now) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow' : null
  if (dayWord) {
    if (endOfDay) return opts.dayKnown ? null : dayWord
    return time(d)
  }
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`
}
