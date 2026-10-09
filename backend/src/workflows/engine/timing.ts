import { daysInMonth } from './tz'

/**
 * Step timing rules (workflow step timing spec). Pure.
 *
 * Every step has a START rule and a DUE rule, each `{ kind, ...params, time: 'HH:mm' }`
 * (`immediate` has no params). Which kinds a step may use depends on how the workflow
 * repeats — its schedules ("frequency"):
 *
 *   Manually (no schedule)       → relative kinds only
 *   Daily                        → time_of_day, or relative
 *   Weekly (every 1)             → weekday, or relative
 *   Monthly (every 1)            → month_day (1–31 | 'last'), or relative
 *   Yearly (every 1)             → year_date (month + day), or relative
 *   Every 2+ weeks/months/years  → cycle_weekday / cycle_month_day / cycle_year_date
 *                                  (cycle 1..every), or relative
 *   Several schedules that repeat differently → relative only
 *
 * Relative kinds — start: immediate, days_after_previous, days_after_run_start; due:
 * days_after_start — are always allowed.
 *
 * Stored on `WorkflowStep.start_rule` / `due_rule` (NULL = legacy: start immediate, due
 * = due_days/due_time) and frozen into every run's step snapshot.
 */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const MAX_RULE_DAYS = 365
/** The longest repeat interval a schedule can have (DefinitionScheduleDto.every). */
export const MAX_CYCLE = 365

export type MonthDay = number | 'last'

export type CalendarRule =
  | { kind: 'time_of_day'; time: string }
  | { kind: 'weekday'; weekday: number; time: string }
  | { kind: 'month_day'; day: MonthDay; time: string }
  | { kind: 'year_date'; month: number; day: number; time: string }
  | { kind: 'cycle_weekday'; cycle: number; weekday: number; time: string }
  | { kind: 'cycle_month_day'; cycle: number; day: MonthDay; time: string }
  | { kind: 'cycle_year_date'; cycle: number; month: number; day: number; time: string }

export type CalendarKind = CalendarRule['kind']

export type StartRule =
  | { kind: 'immediate' }
  | { kind: 'days_after_previous'; days: number; time: string }
  | { kind: 'days_after_run_start'; days: number; time: string }
  | CalendarRule

export type DueRule = { kind: 'days_after_start'; days: number; time: string } | CalendarRule

export type StartKind = StartRule['kind']
export type DueKind = DueRule['kind']

export const CALENDAR_KINDS: readonly CalendarKind[] = [
  'time_of_day',
  'weekday',
  'month_day',
  'year_date',
  'cycle_weekday',
  'cycle_month_day',
  'cycle_year_date',
]
export const RELATIVE_START_KINDS = ['immediate', 'days_after_previous', 'days_after_run_start'] as const
export const RELATIVE_DUE_KINDS = ['days_after_start'] as const
export const START_KINDS: readonly StartKind[] = [...RELATIVE_START_KINDS, ...CALENDAR_KINDS]
export const DUE_KINDS: readonly DueKind[] = [...RELATIVE_DUE_KINDS, ...CALENDAR_KINDS]

export const DEFAULT_START_RULE: StartRule = { kind: 'immediate' }

export function isCalendarKind(kind: string): kind is CalendarKind {
  return (CALENDAR_KINDS as readonly string[]).includes(kind)
}

export function isCalendarRule(rule: StartRule | DueRule | null | undefined): rule is CalendarRule {
  return !!rule && isCalendarKind(rule.kind)
}

export function isCycleKind(kind: string): boolean {
  return kind === 'cycle_weekday' || kind === 'cycle_month_day' || kind === 'cycle_year_date'
}

// ═══ Parsing ═════════════════════════════════════════════════════════════════

type Which = 'start' | 'due'
export type Parsed<R> = { ok: true; rule: R } | { ok: false; problem: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

function field(which: Which): string {
  return which === 'start' ? 'start' : 'due date'
}

/** The largest day a month can have (Feb → 29), for `year_date` (clamped per year). */
function maxDayOf(month: number): number {
  return daysInMonth(2024, month)
}

function parseCalendar(r: Record<string, unknown>, which: Which): Parsed<CalendarRule> {
  const f = field(which)
  if (typeof r.kind !== 'string' || !isCalendarKind(r.kind)) {
    return { ok: false, problem: which === 'start' ? 'choose when it starts.' : 'choose when it is due.' }
  }
  const time = r.time
  if (typeof time !== 'string' || !TIME_RE.test(time)) {
    return { ok: false, problem: `enter a ${which === 'start' ? 'start' : 'due'} time.` }
  }
  const weekday = (): Parsed<number> =>
    isInt(r.weekday, 0, 6) ? { ok: true, rule: r.weekday } : { ok: false, problem: `choose a day of the week for the ${f}.` }
  const monthDay = (): Parsed<MonthDay> =>
    r.day === 'last' || isInt(r.day, 1, 31)
      ? { ok: true, rule: r.day as MonthDay }
      : { ok: false, problem: `choose a day of the month for the ${f}.` }
  const yearDate = (): Parsed<{ month: number; day: number }> => {
    if (!isInt(r.month, 1, 12)) return { ok: false, problem: `choose a month for the ${f}.` }
    if (!isInt(r.day, 1, maxDayOf(r.month))) return { ok: false, problem: `choose a valid date for the ${f}.` }
    return { ok: true, rule: { month: r.month, day: r.day } }
  }
  const cycle = (): Parsed<number> =>
    isInt(r.cycle, 1, MAX_CYCLE)
      ? { ok: true, rule: r.cycle }
      : { ok: false, problem: `choose a cycle for the ${f}.` }

  switch (r.kind) {
    case 'time_of_day':
      return { ok: true, rule: { kind: 'time_of_day', time } }
    case 'weekday': {
      const w = weekday()
      return w.ok ? { ok: true, rule: { kind: 'weekday', weekday: w.rule, time } } : w
    }
    case 'month_day': {
      const d = monthDay()
      return d.ok ? { ok: true, rule: { kind: 'month_day', day: d.rule, time } } : d
    }
    case 'year_date': {
      const y = yearDate()
      return y.ok ? { ok: true, rule: { kind: 'year_date', month: y.rule.month, day: y.rule.day, time } } : y
    }
    case 'cycle_weekday': {
      const c = cycle()
      if (!c.ok) return c
      const w = weekday()
      return w.ok ? { ok: true, rule: { kind: 'cycle_weekday', cycle: c.rule, weekday: w.rule, time } } : w
    }
    case 'cycle_month_day': {
      const c = cycle()
      if (!c.ok) return c
      const d = monthDay()
      return d.ok ? { ok: true, rule: { kind: 'cycle_month_day', cycle: c.rule, day: d.rule, time } } : d
    }
    case 'cycle_year_date': {
      const c = cycle()
      if (!c.ok) return c
      const y = yearDate()
      return y.ok
        ? { ok: true, rule: { kind: 'cycle_year_date', cycle: c.rule, month: y.rule.month, day: y.rule.day, time } }
        : y
    }
    default:
      return { ok: false, problem: which === 'start' ? 'choose when it starts.' : 'choose when it is due.' }
  }
}

/** Strict parse of a start rule (canonical shape, params validated). */
export function parseStartRule(raw: unknown): Parsed<StartRule> {
  if (!isObj(raw)) return { ok: false, problem: 'choose when it starts.' }
  switch (raw.kind) {
    case 'immediate':
      return { ok: true, rule: { kind: 'immediate' } }
    case 'days_after_previous':
    case 'days_after_run_start': {
      const min = raw.kind === 'days_after_previous' ? 1 : 0
      if (!isInt(raw.days, min, MAX_RULE_DAYS)) {
        return {
          ok: false,
          problem:
            raw.kind === 'days_after_previous'
              ? `start days must be 1 to ${MAX_RULE_DAYS}.`
              : `start days must be 0 to ${MAX_RULE_DAYS}.`,
        }
      }
      if (typeof raw.time !== 'string' || !TIME_RE.test(raw.time)) {
        return { ok: false, problem: 'enter a start time.' }
      }
      return { ok: true, rule: { kind: raw.kind, days: raw.days, time: raw.time } }
    }
    default:
      return parseCalendar(raw, 'start')
  }
}

/** Strict parse of a due rule (canonical shape, params validated). */
export function parseDueRule(raw: unknown): Parsed<DueRule> {
  if (!isObj(raw)) return { ok: false, problem: 'choose when it is due.' }
  if (raw.kind === 'days_after_start') {
    if (!isInt(raw.days, 0, MAX_RULE_DAYS)) {
      return { ok: false, problem: `due days must be 0 to ${MAX_RULE_DAYS}.` }
    }
    if (typeof raw.time !== 'string' || !TIME_RE.test(raw.time)) {
      return { ok: false, problem: 'enter a due time.' }
    }
    return { ok: true, rule: { kind: 'days_after_start', days: raw.days, time: raw.time } }
  }
  return parseCalendar(raw, 'due')
}

/** A stored/snapshotted start rule, or null (legacy / garbled → legacy behaviour). */
export function readStartRule(raw: unknown): StartRule | null {
  const p = parseStartRule(raw)
  return p.ok ? p.rule : null
}

/** A stored/snapshotted due rule, or null (legacy / garbled → due_days/due_time). */
export function readDueRule(raw: unknown): DueRule | null {
  const p = parseDueRule(raw)
  return p.ok ? p.rule : null
}

const LOOSE_KEYS = ['days', 'weekday', 'month', 'cycle'] as const

/**
 * What a DRAFT stores for a rule that may be half filled in: only the known keys with
 * primitive values (so the builder gets back what was entered). Engines read rules
 * through the strict parser, and Save validates fully, so a loose rule never runs.
 */
export function looseRule(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw) || typeof raw.kind !== 'string' || raw.kind.length > 40) return null
  const out: Record<string, unknown> = { kind: raw.kind }
  for (const k of LOOSE_KEYS) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = raw[k]
  if (raw.day === 'last' || (typeof raw.day === 'number' && Number.isFinite(raw.day))) out.day = raw.day
  if (typeof raw.time === 'string' && raw.time.length <= 5) out.time = raw.time
  return out
}

/** The rules a step effectively runs with (legacy NULLs filled in). */
export function effectiveStartRule(rule: StartRule | null | undefined): StartRule {
  return rule ?? DEFAULT_START_RULE
}

export function effectiveDueRule(rule: DueRule | null | undefined, dueDays: number, dueTime: string): DueRule {
  return rule ?? { kind: 'days_after_start', days: dueDays, time: dueTime }
}

// ═══ Frequency (how the workflow repeats) ════════════════════════════════════

export type Frequency =
  | { kind: 'manual' }
  | { kind: 'mixed' }
  | { kind: 'daily' | 'weekly' | 'monthly' | 'yearly'; every: number }

/**
 * The workflow's frequency from its schedules: none → manual (a manual start of a
 * scheduled workflow still uses the schedules' frequency); all schedules with the same
 * repeat and interval → that; otherwise mixed.
 */
export function frequencyOf(schedules: { schedule_type: string; every?: number | null }[]): Frequency {
  if (!schedules.length) return { kind: 'manual' }
  const norm = schedules.map((s) => ({
    type: s.schedule_type,
    every: typeof s.every === 'number' && Number.isInteger(s.every) && s.every >= 1 ? s.every : 1,
  }))
  const first = norm[0]
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(first.type)) return { kind: 'mixed' }
  if (norm.some((s) => s.type !== first.type || s.every !== first.every)) return { kind: 'mixed' }
  return { kind: first.type as 'daily' | 'weekly' | 'monthly' | 'yearly', every: first.every }
}

/** The cycle length cycle_* rules count in (1 when the workflow isn't cyclic). */
export function cycleLengthOf(freq: Frequency): number {
  return freq.kind === 'weekly' || freq.kind === 'monthly' || freq.kind === 'yearly' ? freq.every : 1
}

/** The calendar kind this frequency allows (null = relative kinds only). */
export function calendarKindFor(freq: Frequency): CalendarKind | null {
  switch (freq.kind) {
    case 'daily':
      return 'time_of_day'
    case 'weekly':
      return freq.every >= 2 ? 'cycle_weekday' : 'weekday'
    case 'monthly':
      return freq.every >= 2 ? 'cycle_month_day' : 'month_day'
    case 'yearly':
      return freq.every >= 2 ? 'cycle_year_date' : 'year_date'
    default:
      return null
  }
}

export function allowedStartKinds(freq: Frequency): StartKind[] {
  const cal = calendarKindFor(freq)
  return cal ? [...RELATIVE_START_KINDS, cal] : [...RELATIVE_START_KINDS]
}

export function allowedDueKinds(freq: Frequency): DueKind[] {
  const cal = calendarKindFor(freq)
  return cal ? [...RELATIVE_DUE_KINDS, cal] : [...RELATIVE_DUE_KINDS]
}

const UNIT = { weekly: 'week', monthly: 'month', yearly: 'year', daily: 'day' } as const
const CYCLE_UNIT = { weekly: 'Week', monthly: 'Month', yearly: 'Year' } as const

/** "the workflow repeats monthly. Choose “Day of the month” or a “Days after” option." */
export function frequencyHint(freq: Frequency): string {
  switch (freq.kind) {
    case 'manual':
      return 'the workflow starts manually. Choose a “Days after” option.'
    case 'mixed':
      return 'the schedules repeat differently. Choose a “Days after” option.'
    case 'daily':
      return `the workflow repeats ${freq.every >= 2 ? `every ${freq.every} days` : 'daily'}. Choose “Time of day” or a “Days after” option.`
    case 'weekly':
      return freq.every >= 2
        ? `the workflow repeats every ${freq.every} weeks. Choose “Day in ${freq.every}-week cycle” or a “Days after” option.`
        : 'the workflow repeats weekly. Choose “Day of the week” or a “Days after” option.'
    case 'monthly':
      return freq.every >= 2
        ? `the workflow repeats every ${freq.every} months. Choose “Day in ${freq.every}-month cycle” or a “Days after” option.`
        : 'the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.'
    case 'yearly':
      return freq.every >= 2
        ? `the workflow repeats every ${freq.every} years. Choose “Day in ${freq.every}-year cycle” or a “Days after” option.`
        : 'the workflow repeats yearly. Choose “Date” or a “Days after” option.'
  }
}

function ruleFrequencyProblem(rule: StartRule | DueRule, allowed: readonly string[], freq: Frequency): string | null {
  if (!allowed.includes(rule.kind)) return frequencyHint(freq)
  if ('cycle' in rule && (freq.kind === 'weekly' || freq.kind === 'monthly' || freq.kind === 'yearly')) {
    if (rule.cycle > freq.every) {
      const u = CYCLE_UNIT[freq.kind]
      return `the workflow repeats every ${freq.every} ${UNIT[freq.kind]}s. Choose ${u} 1 to ${u} ${freq.every}.`
    }
  }
  return null
}

/**
 * Why a step's timing can't be saved, or null. NULL rules are legacy (always valid).
 * The message completes "Step 2 “Review”: …".
 */
export function timingProblem(startRaw: unknown, dueRaw: unknown, freq: Frequency): string | null {
  if (startRaw !== null && startRaw !== undefined) {
    const s = parseStartRule(startRaw)
    if (!s.ok) return s.problem
    const why = ruleFrequencyProblem(s.rule, allowedStartKinds(freq), freq)
    if (why) return why
  }
  if (dueRaw !== null && dueRaw !== undefined) {
    const d = parseDueRule(dueRaw)
    if (!d.ok) return d.problem
    const why = ruleFrequencyProblem(d.rule, allowedDueKinds(freq), freq)
    if (why) return why
  }
  return null
}
