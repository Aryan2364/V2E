import { addLocalDays, localDateOf, parseTime, zonedTimeToUtc } from './tz'

/**
 * Step deadline (workflows v2 §A): the step's START date (in the org time zone) plus
 * `due_days`, at `due_time` ("HH:mm", org tz). Pure — the engine then passes the
 * result through HolidaysService.adjustDeadline.
 *
 * One guard: a step that would be due before (or exactly when) it starts — only
 * possible with `due_days = 0` and a due time already past on the start day — is due
 * at that time the NEXT day instead, so no task is ever born late.
 */
export function computeDueDeadline(startAt: Date, dueDays: number, dueTime: string, tz: string): Date {
  const days = Number.isFinite(dueDays) ? Math.min(365, Math.max(0, Math.trunc(dueDays))) : 1
  const { hour, minute } = parseTime(dueTime) ?? { hour: 18, minute: 0 }
  const startDay = localDateOf(startAt, tz)
  const due = zonedTimeToUtc(addLocalDays(startDay, days), hour, minute, tz)
  if (due.getTime() > startAt.getTime()) return due
  return zonedTimeToUtc(addLocalDays(startDay, days + 1), hour, minute, tz)
}
