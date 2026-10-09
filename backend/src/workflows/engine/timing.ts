import { LocalDate, addLocalDays, compareLocalDates, daysInMonth, parseLocalDate, weekdayOf } from './tz'

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
 *   Every 2+ weeks/months/years  → weekday / month_day / year_date WITH an explicit
 *                                  cycle (or the legacy cycle_* kinds), or relative
 *   Several schedules that repeat differently → relative only
 *
 * EXPLICIT CYCLES. A weekday / month_day / year_date rule may carry `cycle`: which
 * week / month / year of the run it falls in, counted from the run's own (cycle 1 = the
 * Monday–Sunday week, month or year containing the run start; cycle 2 = the next one…),
 * whatever the schedules' interval. The builder's calendar always writes it — "Month 2,
 * 5th" is stored as `{ kind: 'month_day', cycle: 2, day: 5 }` — so planning resolves it
 * deterministically (plan.ts `resolveExplicit`): that day, never before the step may
 * start (order wins). Limits (`maxCycleOf`): 8 weeks, 12 months, 3 years (or the
 * schedules' interval, when longer). Going past the next run start is allowed; the
 * example run then warns that runs overlap.
 *
 * BACKWARD COMPATIBILITY. Rules saved before explicit cycles keep their meaning, so no
 * saved workflow's planned dates move:
 *  - a weekday / month_day / year_date rule WITHOUT `cycle` is "inferred": the next
 *    occurrence on/after the moment the step may start (every-1 schedules, as before);
 *  - the cycle_* kinds (every 2+; `cycle` = position 1..every in the repeat) are
 *    inferred the same way — the next such position on/after the moment it may start.
 * Neither is rewritten on load or save; the builder turns a rule into an explicit one
 * only when someone picks a day for it.
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
  | { kind: 'weekday'; weekday: number; time: string; cycle?: number }
  | { kind: 'month_day'; day: MonthDay; time: string; cycle?: number }
  | { kind: 'year_date'; month: number; day: number; time: string; cycle?: number }
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

/** The legacy every-2+ kinds (`cycle` = position in the repeat, inferred). */
export function isCycleKind(kind: string): boolean {
  return kind === 'cycle_weekday' || kind === 'cycle_month_day' || kind === 'cycle_year_date'
}

/** The calendar kinds that may carry an explicit cycle. */
export function isDayKind(kind: string): kind is 'weekday' | 'month_day' | 'year_date' {
  return kind === 'weekday' || kind === 'month_day' || kind === 'year_date'
}

export type ExplicitRule = Extract<CalendarRule, { kind: 'weekday' | 'month_day' | 'year_date' }> & { cycle: number }

/** A day rule with an explicit cycle (resolved deterministically — see the header). */
export function isExplicitRule(rule: StartRule | DueRule | null | undefined): rule is ExplicitRule {
  return !!rule && isDayKind(rule.kind) && typeof (rule as { cycle?: unknown }).cycle === 'number'
}

/** How far ahead an explicit cycle may go: 8 weeks, 12 months, 3 years (or the interval). */
export const EXPLICIT_CYCLE_LIMIT = { weekly: 8, monthly: 12, yearly: 3 } as const

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
  /** An explicit cycle on a day rule: absent (legacy, inferred) or 1..MAX_CYCLE. */
  const optionalCycle = (): Parsed<{ cycle?: number }> => {
    if (r.cycle === undefined || r.cycle === null) return { ok: true, rule: {} }
    const c = cycle()
    return c.ok ? { ok: true, rule: { cycle: c.rule } } : c
  }

  switch (r.kind) {
    case 'time_of_day':
      return { ok: true, rule: { kind: 'time_of_day', time } }
    case 'weekday': {
      const c = optionalCycle()
      if (!c.ok) return c
      const w = weekday()
      return w.ok ? { ok: true, rule: { kind: 'weekday', weekday: w.rule, time, ...c.rule } } : w
    }
    case 'month_day': {
      const c = optionalCycle()
      if (!c.ok) return c
      const d = monthDay()
      return d.ok ? { ok: true, rule: { kind: 'month_day', day: d.rule, time, ...c.rule } } : d
    }
    case 'year_date': {
      const c = optionalCycle()
      if (!c.ok) return c
      const y = yearDate()
      return y.ok ? { ok: true, rule: { kind: 'year_date', month: y.rule.month, day: y.rule.day, time, ...c.rule } } : y
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

/**
 * The calendar kind this frequency allows (null = relative kinds only). Every 2+ uses
 * the same day kinds, with the explicit cycle required.
 */
export function calendarKindFor(freq: Frequency): CalendarKind | null {
  switch (freq.kind) {
    case 'daily':
      return 'time_of_day'
    case 'weekly':
      return 'weekday'
    case 'monthly':
      return 'month_day'
    case 'yearly':
      return 'year_date'
    default:
      return null
  }
}

/** The legacy cycle_* kind still accepted for an every-2+ frequency (null otherwise). */
export function legacyCycleKindFor(freq: Frequency): CalendarKind | null {
  if ((freq.kind === 'weekly' || freq.kind === 'monthly' || freq.kind === 'yearly') && freq.every >= 2) {
    return freq.kind === 'weekly' ? 'cycle_weekday' : freq.kind === 'monthly' ? 'cycle_month_day' : 'cycle_year_date'
  }
  return null
}

function calendarKindsFor(freq: Frequency): CalendarKind[] {
  return [calendarKindFor(freq), legacyCycleKindFor(freq)].filter((k): k is CalendarKind => !!k)
}

export function allowedStartKinds(freq: Frequency): StartKind[] {
  return [...RELATIVE_START_KINDS, ...calendarKindsFor(freq)]
}

export function allowedDueKinds(freq: Frequency): DueKind[] {
  return [...RELATIVE_DUE_KINDS, ...calendarKindsFor(freq)]
}

/** The furthest explicit cycle this frequency allows (1 when it has no cycles). */
export function maxCycleOf(freq: Frequency): number {
  if (freq.kind === 'weekly' || freq.kind === 'monthly' || freq.kind === 'yearly') {
    return Math.max(EXPLICIT_CYCLE_LIMIT[freq.kind], freq.every)
  }
  return 1
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

function ruleFrequencyProblem(rule: StartRule | DueRule, allowed: readonly string[], freq: Frequency, which: Which): string | null {
  if (!allowed.includes(rule.kind)) return frequencyHint(freq)
  if (freq.kind !== 'weekly' && freq.kind !== 'monthly' && freq.kind !== 'yearly') return null
  const u = CYCLE_UNIT[freq.kind]
  const cycle = (rule as { cycle?: number }).cycle
  if (isCycleKind(rule.kind) && typeof cycle === 'number' && cycle > freq.every) {
    return `the workflow repeats every ${freq.every} ${UNIT[freq.kind]}s. Choose ${u} 1 to ${u} ${freq.every}.`
  }
  if (isDayKind(rule.kind)) {
    // Every 2+ needs the cycle: a plain weekday / date would be ambiguous.
    if (cycle === undefined) return freq.every >= 2 ? frequencyHint(freq) : null
    const max = maxCycleOf(freq)
    if (cycle > max) return `choose ${u} 1 to ${u} ${max} for the ${field(which)}.`
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
    const why = ruleFrequencyProblem(s.rule, allowedStartKinds(freq), freq, 'start')
    if (why) return why
  }
  if (dueRaw !== null && dueRaw !== undefined) {
    const d = parseDueRule(dueRaw)
    if (!d.ok) return d.problem
    const why = ruleFrequencyProblem(d.rule, allowedDueKinds(freq), freq, 'due')
    if (why) return why
  }
  return null
}

// ═══ First steps: on or after the run start, inside its cycle ════════════════

/**
 * Where a run starts inside its cycle (from the schedules): the time of day (daily),
 * the weekday (weekly, Sun = 0), the day of the month (monthly) or the date (yearly),
 * at the schedule's time. With several trigger days in one cycle (monthly on the 3rd
 * and the 20th; weekly Mon and Thu) it is the LATEST of them, so a first step timed on
 * or after it lands inside its own cycle whichever trigger started the run.
 */
export type RunStartPoint =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; every: number; weekday: number; time: string }
  | { kind: 'monthly'; every: number; day: number; time: string }
  | { kind: 'yearly'; every: number; month: number; day: number; time: string }

export interface RunStartScheduleLike {
  schedule_type: string
  every?: number | null
  days?: unknown
  month_days?: unknown
  yearly_dates?: unknown
  time?: string | null
  /** When the schedule starts (a stored UTC-midnight Date, or 'YYYY-MM-DD'): every-N runs keep in step with it. */
  start_date?: unknown
}

/** Monday-first position of a weekday (Mon = 0 … Sun = 6). */
export function weekPosition(weekday: number): number {
  return (weekday + 6) % 7
}

function minutesOf(time: string | null | undefined): number {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return 0
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const intList = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x)) : []

/**
 * The run start point for a frequency that allows calendar timing (null for manual /
 * mixed, or when the schedules name no trigger day yet).
 */
export function runStartPointOf(schedules: RunStartScheduleLike[], freq: Frequency): RunStartPoint | null {
  if (freq.kind === 'manual' || freq.kind === 'mixed') return null
  let best: { pos: number; time: string; point: RunStartPoint } | null = null
  const consider = (pos: number, time: string, point: RunStartPoint) => {
    if (!best || pos > best.pos || (pos === best.pos && minutesOf(time) > minutesOf(best.time))) best = { pos, time, point }
  }
  for (const s of schedules) {
    const time = typeof s.time === 'string' && TIME_RE.test(s.time) ? s.time : '00:00'
    switch (freq.kind) {
      case 'daily':
        consider(0, time, { kind: 'daily', time })
        break
      case 'weekly':
        for (const d of intList(s.days)) {
          if (d >= 0 && d <= 6) consider(weekPosition(d), time, { kind: 'weekly', every: freq.every, weekday: d, time })
        }
        break
      case 'monthly':
        for (const raw of intList(s.month_days)) {
          const d = Math.abs(raw)
          if (d >= 1 && d <= 31) consider(d, time, { kind: 'monthly', every: freq.every, day: d, time })
        }
        break
      case 'yearly':
        for (const y of Array.isArray(s.yearly_dates) ? s.yearly_dates : []) {
          const month = (y as { month?: unknown })?.month
          const day = (y as { day?: unknown })?.day
          if (isInt(month, 1, 12) && isInt(day, 1, 31)) {
            consider(month * 100 + day, time, { kind: 'yearly', every: freq.every, month, day, time })
          }
        }
        break
    }
  }
  return (best as { point: RunStartPoint } | null)?.point ?? null
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 3 → "3rd". */
export function ordinalOf(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/** "18:00" → "6:00 PM" (the builder's own format). */
export function formatTime12(hhmm: string): string {
  const [h, m] = (TIME_RE.test(hhmm) ? hhmm : '00:00').split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// ═══ The sample run (builder calendar + Save's order check) ═══════════════════

/** A schedule's start date as a calendar day (a stored UTC-midnight Date, or 'YYYY-MM-DD…'). */
function startDayOf(v: unknown): LocalDate | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() }
  }
  return parseLocalDate(v)
}

const daySerial = (d: LocalDate) => Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)

/**
 * The SAMPLE RUN's start day: the run the builder's calendar shows and Save checks the
 * order of explicit days against (planned without holidays, so the builder — which
 * mirrors this exactly — and the server agree). It is the next day, from `today` on
 * (today only while the run start time hasn't passed — `nowMinutes` is the org clock's
 * minutes since midnight), on which the run start point's trigger falls: the latest
 * trigger day of the cycle, in step with its schedule's start date and interval (the
 * same day arithmetic as the recurrence evaluator). End conditions are ignored — it is
 * an example. Falls back to the next such day ignoring the interval, then to `today`.
 */
export function sampleRunDay(schedules: RunStartScheduleLike[], rs: RunStartPoint, today: LocalDate, nowMinutes: number): LocalDate {
  const type = rs.kind
  const hasTrigger = (s: RunStartScheduleLike): boolean => {
    if (s.schedule_type !== type) return false
    switch (rs.kind) {
      case 'daily':
        return true
      case 'weekly':
        return intList(s.days).includes(rs.weekday)
      case 'monthly':
        return intList(s.month_days).some((d) => Math.abs(d) === rs.day)
      case 'yearly':
        return (Array.isArray(s.yearly_dates) ? s.yearly_dates : []).some(
          (y) => (y as { month?: unknown })?.month === rs.month && (y as { day?: unknown })?.day === rs.day,
        )
    }
  }
  const timed = schedules.filter((s) => hasTrigger(s) && (s.time ?? '00:00') === rs.time)
  const triggers = timed.length ? timed : schedules.filter(hasTrigger)
  const onTriggerDay = (d: LocalDate): boolean => {
    switch (rs.kind) {
      case 'daily':
        return true
      case 'weekly':
        return weekdayOf(d) === rs.weekday
      case 'monthly':
        return d.day === rs.day
      case 'yearly':
        return d.month === rs.month && d.day === rs.day
    }
  }
  const inStep = (s: RunStartScheduleLike, d: LocalDate): boolean => {
    const start = startDayOf(s.start_date)
    if (!start) return true
    if (compareLocalDates(d, start) < 0) return false
    const every = typeof s.every === 'number' && Number.isInteger(s.every) && s.every >= 1 ? s.every : 1
    const daysDiff = daySerial(d) - daySerial(start)
    switch (rs.kind) {
      case 'daily':
        return daysDiff % every === 0
      case 'weekly':
        return Math.floor(daysDiff / 7) % every === 0
      case 'monthly':
        return ((d.year - start.year) * 12 + (d.month - start.month)) % every === 0
      case 'yearly':
        return (d.year - start.year) % every === 0
    }
  }
  const first = minutesOf(rs.time) > nowMinutes ? today : addLocalDays(today, 1)
  const LIMIT = 366 * 10 + 31
  for (let i = 0; i < LIMIT; i++) {
    const d = addLocalDays(first, i)
    if (onTriggerDay(d) && (!triggers.length || triggers.some((s) => inStep(s, d)))) return d
  }
  for (let i = 0; i < LIMIT; i++) {
    const d = addLocalDays(first, i)
    if (onTriggerDay(d)) return d
  }
  return first
}

const MONTH_WORD = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "5 Nov" (with the year when it isn't `refYear`'s) — the order messages' day words. */
export function dayMonthWords(d: LocalDate, refYear: number): string {
  return `${d.day} ${MONTH_WORD[d.month - 1]}${d.year !== refYear ? ` ${d.year}` : ''}`
}

/**
 * Save's order messages (completing "Step 2 “X”: …"): an explicit start day before the
 * day the step it waits for is due — `pick a day on or after 5 Nov, when 1 “Collect
 * documents” is due.` — or an explicit due day before the step's own start day. The
 * same day is always fine (a step may start later that day).
 */
export function startBeforePredecessorText(dayWords: string, predecessor: string): string {
  return `pick a day on or after ${dayWords}, when ${predecessor} is due.`
}

export function dueBeforeStartText(dayWords: string): string {
  return `pick a due day on or after ${dayWords}, when it starts.`
}

/** How the order messages name a step: `1 “Collect documents”` (or just `1`). */
export function predecessorName(label: string, title: string | null | undefined): string {
  const t = (title ?? '').trim()
  return t ? `${label} “${t}”` : label
}

/** The run start day in words: "the 3rd", "Wednesday", "1 Apr" (null for daily). */
export function runStartDayWords(rs: RunStartPoint): string | null {
  switch (rs.kind) {
    case 'daily':
      return null
    case 'weekly':
      return WEEKDAY_NAMES[rs.weekday]
    case 'monthly':
      return `the ${ordinalOf(rs.day)}`
    case 'yearly':
      return `${rs.day} ${MONTH_SHORT[rs.month - 1]}`
  }
}

/**
 * Why a FIRST step's calendar rule falls before the run start in its cycle, or null.
 * Only the run's own cycle counts: a rule in Week / Month / Year 2 or later (explicit, or
 * a legacy cycle_* position) is always fine; "in Month 1" is said for every-2+ workflows. A rule on the run start day itself must not be earlier than the
 * run's start time (it would roll into the next cycle). Completes "Step 1 “X”: …".
 */
export function beforeRunStartProblem(rule: StartRule | DueRule, rs: RunStartPoint): string | null {
  if (!isCalendarRule(rule)) return null
  const at = formatTime12(rs.time)
  const earlierTime = minutesOf(rule.time) < minutesOf(rs.time)
  if (rs.kind === 'daily') {
    return rule.kind === 'time_of_day' && earlierTime ? `pick a time at or after ${at}, when the instance starts.` : null
  }
  // Only the run's own cycle holds days before the run (explicit or legacy cycles).
  const cycle = (rule as { cycle?: number }).cycle
  if (typeof cycle === 'number' && cycle !== 1) return null
  const unit = rs.kind === 'weekly' ? 'Week' : rs.kind === 'monthly' ? 'Month' : 'Year'
  const inCycle = rs.every >= 2 ? ` in ${unit} 1` : ''
  let cmp: number
  switch (rule.kind) {
    case 'weekday':
    case 'cycle_weekday':
      if (rs.kind !== 'weekly') return null
      cmp = weekPosition(rule.weekday) - weekPosition(rs.weekday)
      break
    case 'month_day':
    case 'cycle_month_day':
      if (rs.kind !== 'monthly') return null
      cmp = (rule.day === 'last' ? 31 : rule.day) - rs.day
      break
    case 'year_date':
    case 'cycle_year_date':
      if (rs.kind !== 'yearly') return null
      cmp = rule.month * 100 + rule.day - (rs.month * 100 + rs.day)
      break
    default:
      return null
  }
  const day = runStartDayWords(rs)!
  const what = rs.kind === 'yearly' ? 'a date' : 'a day'
  if (cmp < 0) return `pick ${what} on or after ${day}${inCycle}, when the instance starts.`
  if (cmp === 0 && earlierTime) return `pick a time at or after ${at} on ${day}${inCycle}, when the instance starts.`
  return null
}

/**
 * Why a first step's timing (no steps before it) can't be saved: its start and its due
 * must both fall on or after the run start, inside the run's cycle. Null when fine,
 * when the rules are legacy / relative, or when the workflow has no run start point.
 * Call after `timingProblem` passed.
 */
export function firstStepTimingProblem(startRaw: unknown, dueRaw: unknown, rs: RunStartPoint | null): string | null {
  if (!rs) return null
  const start = startRaw !== null && startRaw !== undefined ? readStartRule(startRaw) : null
  const startWhy = start ? beforeRunStartProblem(start, rs) : null
  if (startWhy) return startWhy
  const due = dueRaw !== null && dueRaw !== undefined ? readDueRule(dueRaw) : null
  return due ? beforeRunStartProblem(due, rs) : null
}

// ═══ Later steps: no "Days after workflow is triggered" ═══════════════════════

/** The builder's name for the `days_after_run_start` start kind (first steps only). */
export const TRIGGER_KIND_LABEL = 'Days after workflow is triggered'

/**
 * Why a LATER step's start can't be saved (it has steps before it): "Days after workflow
 * is triggered" is only for first steps. Null when fine. Completes "Step 2 “X”: …".
 * Call after `timingProblem` passed.
 */
export function laterStepTimingProblem(startRaw: unknown): string | null {
  const start = startRaw !== null && startRaw !== undefined ? readStartRule(startRaw) : null
  return start?.kind === 'days_after_run_start' ? `“${TRIGGER_KIND_LABEL}” is only for the first step — pick another start.` : null
}
