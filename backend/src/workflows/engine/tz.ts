/**
 * Minimal, dependency-free time-zone arithmetic for the workflow engine.
 *
 * Every workflow time ("HH:mm" deadlines, date-trigger times) is a wall-clock time
 * in the ORG's time zone, while instants are stored as UTC `Date`s. These helpers
 * convert between the two with `Intl` only, so they are correct regardless of the
 * server's own TZ (and across DST for zones that have it).
 */

export const DEFAULT_ORG_TIMEZONE = 'Asia/Kolkata'

/** A calendar date with no time or zone. month is 1–12. */
export interface LocalDate {
  year: number
  month: number
  day: number
}

export interface LocalDateTime extends LocalDate {
  hour: number
  minute: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Falls back to the default zone for empty/unknown zone ids instead of throwing. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_ORG_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_ORG_TIMEZONE
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Wall-clock parts of `instant` in `tz`. */
export function zonedParts(instant: Date, tz: string): LocalDateTime & { second: number } {
  const parts: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(instant)) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  }
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (IST → +19 800 000). */
function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The UTC instant at which the wall clock in `tz` reads date + hh:mm. */
export function zonedTimeToUtc(date: LocalDate, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0)
  // Two passes settle DST transitions (the offset at the guess may differ from the
  // offset at the true instant by the DST delta).
  let result = guess - offsetMs(new Date(guess), tz)
  const second = guess - offsetMs(new Date(result), tz)
  if (second !== result) result = second
  return new Date(result)
}

/** The local calendar date of `instant` in `tz`. */
export function localDateOf(instant: Date, tz: string): LocalDate {
  const p = zonedParts(instant, tz)
  return { year: p.year, month: p.month, day: p.day }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Calendar arithmetic on a zone-less date. */
export function addLocalDays(d: LocalDate, n: number): LocalDate {
  const x = new Date(Date.UTC(d.year, d.month - 1, d.day + n))
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() }
}

/** 0 = Sunday … 6 = Saturday, for a zone-less date. */
export function weekdayOf(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/** "YYYY-MM-DD" → LocalDate, or null when malformed / not a real date. */
export function parseLocalDate(s: unknown): LocalDate | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  if (!m) return null
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > daysInMonth(d.year, d.month)) return null
  return d
}

/** "HH:mm" (24h) → {hour, minute}, or null when malformed. */
export function parseTime(s: unknown): { hour: number; minute: number } | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function formatLocalDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "08 Oct 2026" for `instant` as seen in `tz` (instance names). */
export function formatHumanDate(instant: Date, tz: string): string {
  const d = localDateOf(instant, tz)
  return `${String(d.day).padStart(2, '0')} ${MONTHS[d.month - 1]} ${d.year}`
}
