/**
 * Step deadline config (`WorkflowStep.deadline_config`) — the API side of the
 * workflows contract §2. The ENGINE computes the actual deadline; this module only
 * decides whether a config is complete and well-formed, and normalizes it to the
 * exact field list for its type (unknown keys never reach the database).
 *
 * All times are "HH:mm" 24h in the org's time zone.
 */

export const DEADLINE_TYPES = [
  'x_days_after_start',
  'x_days_after_prev_completed',
  'x_days_after_prev_deadline',
  'fixed_date',
  'daily',
  'weekly',
  'monthly',
  'yearly',
] as const

export type DeadlineType = (typeof DEADLINE_TYPES)[number]

export type DeadlineConfig =
  | { type: 'x_days_after_start' | 'x_days_after_prev_completed' | 'x_days_after_prev_deadline'; days: number; time: string }
  | { type: 'fixed_date'; date: string; time: string }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; day: number; time: string }
  | { type: 'monthly'; day_of_month: number; time: string }
  | { type: 'yearly'; month: number; day: number; time: string }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "HH:mm" 24-hour clock time. */
export function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

/** A real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isValidDateOnly(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return false
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return d <= daysInMonth
}

/** Whole number within [min, max]; tolerates numeric strings ("3"). */
export function intInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return null
  return n
}

/**
 * Validate + normalize a deadline config. Returns a readable message (for a 400)
 * when the config is incomplete or invalid for its type.
 */
export function parseDeadlineConfig(raw: unknown): ParseResult<DeadlineConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Choose when this step is due.' }
  }
  const c = raw as Record<string, unknown>
  const type = c.type
  if (typeof type !== 'string' || !(DEADLINE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'Choose when this step is due.' }
  }
  if (!isValidTime(c.time)) {
    return { ok: false, error: 'The due time must be a 24-hour time like 18:00.' }
  }
  const time = c.time

  switch (type as DeadlineType) {
    case 'x_days_after_start':
    case 'x_days_after_prev_completed':
    case 'x_days_after_prev_deadline': {
      const days = intInRange(c.days, 0, 365)
      if (days === null) return { ok: false, error: 'The number of days must be a whole number from 0 to 365.' }
      return { ok: true, value: { type: type as 'x_days_after_start', days, time } }
    }
    case 'fixed_date': {
      if (!isValidDateOnly(c.date)) return { ok: false, error: 'Pick a valid due date.' }
      return { ok: true, value: { type: 'fixed_date', date: c.date, time } }
    }
    case 'daily':
      return { ok: true, value: { type: 'daily', time } }
    case 'weekly': {
      const day = intInRange(c.day, 0, 6)
      if (day === null) return { ok: false, error: 'Pick the weekday this step is due on.' }
      return { ok: true, value: { type: 'weekly', day, time } }
    }
    case 'monthly': {
      const dom = intInRange(c.day_of_month, 1, 31)
      if (dom === null) return { ok: false, error: 'The day of the month must be from 1 to 31.' }
      return { ok: true, value: { type: 'monthly', day_of_month: dom, time } }
    }
    case 'yearly': {
      const month = intInRange(c.month, 1, 12)
      if (month === null) return { ok: false, error: 'Pick the month this step is due in.' }
      const day = intInRange(c.day, 1, 31)
      if (day === null) return { ok: false, error: 'The day must be from 1 to 31.' }
      return { ok: true, value: { type: 'yearly', month, day, time } }
    }
  }
  return { ok: false, error: 'Choose when this step is due.' }
}
