import { entryOccursOn, type RecurrenceEntry } from '../../common/recurrence/should-fire-today'
import { LocalDate, addLocalDays, compareLocalDates, localDateOf, parseLocalDate, parseTime, zonedTimeToUtc } from './tz'

/**
 * Workflow schedules ("On a schedule"). A schedule entry has EXACTLY the recurring-task
 * shape (`RecurringScheduleEntry`: Repeat daily/weekly/monthly/yearly, every N,
 * weekdays, month days incl. the "fall back to the last day" option, yearly dates,
 * time, starting date, ends never / on a date / after N), and which days it falls on
 * is decided by the SAME evaluator recurring tasks use (`entryOccursOn`).
 *
 * The one difference is the frame: a workflow occurrence is "that day at `time`" in
 * the ORG's time zone (recurring tasks read the server's local day). Start and end
 * dates are stored as UTC midnight of the chosen calendar day, so their calendar date
 * is read in UTC.
 */

/** `WorkflowInstance.trigger_type` of a run started by a schedule. */
export const SCHEDULE_START = 'schedule'
/** `WorkflowInstance.trigger_type` of a run started by hand (value kept from v1). */
export const MANUAL_START = 'manual_trigger'

export interface ScheduleEntryLike extends RecurrenceEntry {
  time: string
}

/** The calendar day a stored date-only DateTime stands for (UTC midnight of that day). */
export function storedCalendarDate(d: Date | string): LocalDate {
  const x = new Date(d)
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() }
}

/** "YYYY-MM-DD…" → the UTC-midnight DateTime stored for that calendar day, or null. */
export function calendarDateToStored(s: unknown): Date | null {
  const d = parseLocalDate(s)
  return d ? new Date(Date.UTC(d.year, d.month - 1, d.day)) : null
}

/** Does the entry fall on calendar day `d` (org frame)? End conditions included. */
export function scheduleOccursOn(e: ScheduleEntryLike, d: LocalDate): boolean {
  return entryOccursOn(e, d, storedCalendarDate(e.start_date), e.end_date ? storedCalendarDate(e.end_date) : null)
}

/** An entry is spent once its "after N" count is reached. */
export function scheduleExhausted(e: Pick<RecurrenceEntry, 'end_condition' | 'end_after' | 'occurrence_count'>): boolean {
  return e.end_condition === 'after_n' && e.end_after !== null && e.end_after !== undefined && e.occurrence_count >= e.end_after
}

// Every N up to 10 years apart (yearly "every 10"), so a forward scan of ~10 years always
// finds the next occurrence if there is one.
const MAX_FORWARD_DAYS = 366 * 10 + 31
const MAX_BACKWARD_DAYS = 366 * 10 + 31

/**
 * The first occurrence strictly AFTER `after` (org clock instant), or null when there is
 * none (ended, spent, or invalid time). For the "next run" shown in the UI pass
 * `after = max(now, last_fired_at)`.
 */
export function nextScheduleOccurrence(e: ScheduleEntryLike, after: Date, tz: string): Date | null {
  const t = parseTime(e.time)
  if (!t || scheduleExhausted(e)) return null
  const start = storedCalendarDate(e.start_date)
  const end = e.end_condition === 'on_date' && e.end_date ? storedCalendarDate(e.end_date) : null
  let d = localDateOf(after, tz)
  if (compareLocalDates(d, start) < 0) d = start
  for (let i = 0; i < MAX_FORWARD_DAYS; i++) {
    if (end && compareLocalDates(d, end) > 0) return null
    if (scheduleOccursOn(e, d)) {
      const at = zonedTimeToUtc(d, t.hour, t.minute, tz)
      if (at.getTime() > after.getTime()) return at
    }
    d = addLocalDays(d, 1)
  }
  return null
}

/**
 * The occurrence a tick at `now` should fire: the LATEST occurrence ≤ now that is
 * strictly after `lowerBound` (the entry's last-fired marker, or just before it was
 * created). Missed occurrences collapse into this one — an engine that was down for a
 * week fires once, not seven times. Null = nothing due.
 */
export function dueScheduleOccurrence(e: ScheduleEntryLike, lowerBound: Date, now: Date, tz: string): Date | null {
  const t = parseTime(e.time)
  if (!t || scheduleExhausted(e) || now.getTime() <= lowerBound.getTime()) return null
  const start = storedCalendarDate(e.start_date)
  const end = e.end_condition === 'on_date' && e.end_date ? storedCalendarDate(e.end_date) : null
  let d = localDateOf(now, tz)
  if (end && compareLocalDates(d, end) > 0) d = end
  const floor = localDateOf(lowerBound, tz)
  for (let i = 0; i < MAX_BACKWARD_DAYS; i++) {
    if (compareLocalDates(d, start) < 0 || compareLocalDates(d, floor) < 0) return null
    if (scheduleOccursOn(e, d)) {
      const at = zonedTimeToUtc(d, t.hour, t.minute, tz)
      if (at.getTime() <= now.getTime()) return at.getTime() > lowerBound.getTime() ? at : null
    }
    d = addLocalDays(d, -1)
  }
  return null
}

/** An entry repeats unless it is a one-off ("ends after 1"). */
export function scheduleRepeats(e: Pick<RecurrenceEntry, 'end_condition' | 'end_after'>): boolean {
  return !(e.end_condition === 'after_n' && e.end_after === 1)
}

export type ScheduleKind = 'daily' | 'weekly' | 'monthly' | 'yearly'

/**
 * The workflow's nature, derived from its schedules: `recurring` when any entry repeats,
 * with the repeat when every repeating entry shares it ("Repeats monthly"), else null
 * ("Repeats on a schedule").
 */
export function natureOfSchedules(entries: Pick<RecurrenceEntry, 'schedule_type' | 'end_condition' | 'end_after'>[]): {
  workflow_nature: 'one_time' | 'recurring'
  recurring_type: ScheduleKind | null
} {
  const repeating = entries.filter(scheduleRepeats)
  if (!repeating.length) return { workflow_nature: 'one_time', recurring_type: null }
  const kinds = new Set(repeating.map((e) => e.schedule_type))
  const only = kinds.size === 1 ? ([...kinds][0] as ScheduleKind) : null
  return { workflow_nature: 'recurring', recurring_type: only }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * What a schedule entry is missing before it can run (Save / a live workflow), or null.
 * Mirrors the recurring-task form's checks, in plain words.
 */
export function scheduleEntryProblem(e: {
  schedule_type: string
  every?: number | null
  days?: unknown
  month_days?: unknown
  yearly_dates?: unknown
  time?: string | null
  start_date?: unknown
  end_condition?: string | null
  end_date?: unknown
  end_after?: number | null
}): string | null {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(e.schedule_type)) {
    return 'Choose how often it repeats: daily, weekly, monthly or yearly.'
  }
  if (e.every !== undefined && e.every !== null && (!Number.isInteger(e.every) || e.every < 1)) {
    return '“Every” must be a whole number of 1 or more.'
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  if (e.schedule_type === 'weekly' && list(e.days).length === 0) return 'Pick at least one day of the week.'
  if (e.schedule_type === 'monthly' && list(e.month_days).length === 0) return 'Pick at least one day of the month.'
  if (e.schedule_type === 'yearly' && list(e.yearly_dates).length === 0) return 'Pick at least one date in the year.'
  if (!e.time || !HHMM.test(e.time)) return 'Set the time it starts, like 09:00.'
  const start = e.start_date instanceof Date ? storedCalendarDate(e.start_date) : parseLocalDate(e.start_date)
  if (!start) return 'Pick the date it starts from.'
  if (e.end_condition === 'on_date') {
    const end = e.end_date instanceof Date ? storedCalendarDate(e.end_date) : parseLocalDate(e.end_date)
    if (!end) return 'Pick the date it ends on, or choose another way for it to end.'
    if (compareLocalDates(end, start) < 0) return 'The end date can’t be before the start date.'
  }
  if (e.end_condition === 'after_n' && (!Number.isInteger(e.end_after) || (e.end_after as number) < 1)) {
    return 'Say after how many runs it ends (1 or more).'
  }
  return null
}
