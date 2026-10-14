import type { RecurringScheduleEntry } from '@/lib/types/tasks'

/*
 * Plain-words schedule summaries for the phone's Recurring screens
 * (plan-phone-2026-10-14.md §5.6) - "Every Monday", "Monthly on the 1st".
 * Only the simple shapes the phone's own Give-task repeat control can
 * create (daily/weekly/monthly, `every: 1`) read in full; anything more
 * elaborate (custom days, yearly dates, multiple schedules) still gets a
 * readable fallback rather than nothing.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function formatTime(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

export function scheduleSummary(entry: RecurringScheduleEntry | null | undefined): string {
  if (!entry) return 'No schedule'
  const time = entry.time ? ` · ${formatTime(entry.time)}` : ''
  switch (entry.schedule_type) {
    case 'daily':
      return entry.every > 1 ? `Every ${entry.every} days${time}` : `Every day${time}`
    case 'weekly': {
      if (entry.days.length === 0) return `Weekly${time}`
      if (entry.days.length === 1) {
        const prefix = entry.every > 1 ? `Every ${entry.every} weeks on ` : 'Every '
        return `${prefix}${WEEKDAYS[entry.days[0]] ?? ''}${time}`
      }
      const names = entry.days.map((d) => WEEKDAYS[d]?.slice(0, 3) ?? '').filter(Boolean)
      return `Weekly on ${names.join(', ')}${time}`
    }
    case 'monthly': {
      if (entry.month_days.length === 1) {
        const prefix = entry.every > 1 ? `Every ${entry.every} months on the ` : 'Monthly on the '
        return `${prefix}${ordinal(entry.month_days[0])}${time}`
      }
      if (entry.month_days.length > 1) {
        return `Monthly on the ${entry.month_days.map(ordinal).join(', ')}${time}`
      }
      return `Monthly${time}`
    }
    case 'yearly':
      return `Yearly${time}`
    default:
      return 'Recurring'
  }
}

/** The template's own schedule line, from its first active (or first) schedule entry. */
export function templateScheduleSummary(entries: RecurringScheduleEntry[] | undefined): string {
  if (!entries || entries.length === 0) return 'No schedule'
  const active = entries.find((e) => e.is_active) ?? entries[0]
  const suffix = entries.length > 1 ? ' +more' : ''
  return `${scheduleSummary(active)}${suffix}`
}
