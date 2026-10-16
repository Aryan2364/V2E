/*
 * Dates and times on phone screens, in the one product format
 * (FRONTEND_RULES section 18): "15 Jul 2026", "5:00 PM", "15 Jul 2026, 5:00 PM".
 * Never toLocaleString(): that follows the phone's own locale and gives
 * "15/07/2026, 23:59:00" on one phone and "7/15/2026" on the next.
 *
 * fmtTime/fmtDate/fmtDateTime delegate to lib/format.ts (the kit's one
 * implementation, section 18) — the output strings are identical ("D Mon
 * YYYY", "h:mm A"). fmtShortDate is phone-only (no kit equivalent) and
 * stays local.
 */
import { formatDate, formatTime, formatDateTime } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/** "5:00 PM" */
export function fmtTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  return formatTime(value)
}

/** "15 Jul 2026" */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  return formatDate(value)
}

/** "15 Jul" this year, "15 Jul 2025" otherwise. */
export function fmtShortDate(value: string | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`
}

/** "15 Jul 2026, 5:00 PM" */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  return formatDateTime(value)
}

/** A due date: the time is left out when the task is due at end of day (23:59, the desktop default for a bare date). */
export function fmtDue(value: string | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  return d.getHours() === 23 && d.getMinutes() === 59 ? fmtDate(d) : fmtDateTime(d)
}
