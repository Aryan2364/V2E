// Step timing — which "Starts" / "Due" kinds a workflow's frequency allows, sensible
// defaults, the words for each rule, and the checks Save makes. Mirrors the server's
// approved rule table exactly (workflows step-timing spec):
//
//   Manually (no schedule)            → N days after only
//   Daily                             → time of day, or N days after
//   Weekly (every 1)                  → weekday, or N days after
//   Monthly (every 1)                 → day of month (1–31 / last day), or N days after
//   Yearly (every 1)                  → date (day + month), or N days after
//   Every 2+ weeks / months / years   → cycle position, or N days after
//   Schedules that repeat differently → N days after only

import type { RecurringScheduleType } from '@/lib/types/tasks'
import type { CalendarRuleKind, DueRule, DueRuleKind, RuleMonthDay, StartRule, StartRuleKind } from '@/lib/types/workflows'
import { MONTHS_LONG, WEEKDAYS_LONG, WEEKDAYS_SHORT, fmtTime, ordinal, plural } from './shared'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const DEFAULT_START_TIME = '09:00'
export const DEFAULT_DUE_TIME = '18:00'
export const MAX_RULE_DAYS = 365
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const DEFAULT_START_RULE: StartRule = { kind: 'immediate' }
export const DEFAULT_DUE_RULE: DueRule = { kind: 'days_after_start', days: 1, time: DEFAULT_DUE_TIME }

// ─── Frequency ───────────────────────────────────────────────────────────────

/** How the workflow repeats, from the schedules being edited. */
export type Frequency =
  | { type: 'manual' }
  | { type: 'mixed' }
  | { type: RecurringScheduleType; every: number }

/** The schedule fields frequency and defaults need. */
export interface ScheduleShape {
  schedule_type: RecurringScheduleType
  every: number
  days?: number[]
  month_days?: number[]
  yearly_dates?: { month: number; day: number }[]
}

/**
 * The workflow's frequency (same rule as the server's): no schedule → manual; every
 * schedule repeating the same way (type and interval) → that; otherwise mixed.
 */
export function frequencyOf(schedules: ScheduleShape[]): Frequency {
  if (!schedules.length) return { type: 'manual' }
  const norm = schedules.map((s) => ({
    type: s.schedule_type,
    every: typeof s.every === 'number' && Number.isInteger(s.every) && s.every >= 1 ? s.every : 1,
  }))
  const first = norm[0]
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(first.type)) return { type: 'mixed' }
  if (norm.some((n) => n.type !== first.type || n.every !== first.every)) return { type: 'mixed' }
  return first
}

export const sameFrequency = (a: Frequency, b: Frequency) =>
  a.type === b.type && ('every' in a ? a.every : 0) === ('every' in b ? b.every : 0)

/** The one calendar kind the frequency allows (null = relative kinds only). */
export function calendarKindFor(f: Frequency): CalendarRuleKind | null {
  switch (f.type) {
    case 'daily':
      return 'time_of_day'
    case 'weekly':
      return f.every >= 2 ? 'cycle_weekday' : 'weekday'
    case 'monthly':
      return f.every >= 2 ? 'cycle_month_day' : 'month_day'
    case 'yearly':
      return f.every >= 2 ? 'cycle_year_date' : 'year_date'
    default:
      return null
  }
}

const RELATIVE_START: StartRuleKind[] = ['immediate', 'days_after_previous', 'days_after_run_start']

export function allowedStartKinds(f: Frequency): StartRuleKind[] {
  const cal = calendarKindFor(f)
  return cal ? [...RELATIVE_START, cal] : RELATIVE_START
}

export function allowedDueKinds(f: Frequency): DueRuleKind[] {
  const cal = calendarKindFor(f)
  return cal ? ['days_after_start', cal] : ['days_after_start']
}

export const isCalendarKind = (k: StartRuleKind | DueRuleKind): k is CalendarRuleKind =>
  k === 'time_of_day' || k === 'weekday' || k === 'month_day' || k === 'year_date' || k.startsWith('cycle_')

function cycleUnit(f: Frequency): 'Week' | 'Month' | 'Year' | null {
  if (f.type === 'weekly') return 'Week'
  if (f.type === 'monthly') return 'Month'
  if (f.type === 'yearly') return 'Year'
  return null
}

/** The short note above a step's timing: what this frequency lets steps use. */
export function frequencyNote(f: Frequency): string {
  switch (f.type) {
    case 'manual':
      return 'This workflow is only started by hand, so steps are timed in days — after the run starts or after the steps before them.'
    case 'mixed':
      return 'This workflow’s schedules repeat in different ways, so steps are timed in days — after the run starts or after the steps before them.'
    case 'daily':
      return `This workflow repeats ${f.every >= 2 ? `every ${f.every} days` : 'daily'}, so steps can also start or be due at a time of day.`
    case 'weekly':
      return f.every >= 2
        ? `This workflow repeats every ${f.every} weeks, so steps can use a day in the ${f.every}-week cycle. Week 1 is the week the run starts.`
        : 'This workflow repeats weekly, so steps can use days of the week.'
    case 'monthly':
      return f.every >= 2
        ? `This workflow repeats every ${f.every} months, so steps can use a day in the ${f.every}-month cycle. Month 1 is the month the run starts.`
        : 'This workflow repeats monthly, so steps can use days of the month.'
    case 'yearly':
      return f.every >= 2
        ? `This workflow repeats every ${f.every} years, so steps can use a date in the ${f.every}-year cycle. Year 1 is the year the run starts.`
        : 'This workflow repeats yearly, so steps can use dates.'
  }
}

/**
 * Why a kind does not fit this frequency — the server's own words, so the step shows the
 * message Save would give: "this workflow repeats monthly — pick a day of the month or
 * “days after”."
 */
export function frequencyHint(f: Frequency): string {
  switch (f.type) {
    case 'manual':
      return 'this workflow only starts by hand — pick “days after” instead of a calendar date.'
    case 'mixed':
      return 'this workflow’s schedules repeat in different ways — pick “days after” instead of a calendar date.'
    case 'daily':
      return `this workflow repeats ${f.every >= 2 ? `every ${f.every} days` : 'daily'} — pick a time of day or “days after”.`
    case 'weekly':
      return f.every >= 2
        ? `this workflow repeats every ${f.every} weeks — pick a week and day (like “Week 2, Mon”) or “days after”.`
        : 'this workflow repeats weekly — pick a day of the week or “days after”.'
    case 'monthly':
      return f.every >= 2
        ? `this workflow repeats every ${f.every} months — pick a month and day (like “Month 2, 5th”) or “days after”.`
        : 'this workflow repeats monthly — pick a day of the month or “days after”.'
    case 'yearly':
      return f.every >= 2
        ? `this workflow repeats every ${f.every} years — pick a year and date (like “Year 2, 5 Jun”) or “days after”.`
        : 'this workflow repeats yearly — pick a date or “days after”.'
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function startKindLabel(kind: StartRuleKind, f: Frequency, hasPredecessors: boolean): string {
  const unit = cycleUnit(f)
  const every = 'every' in f ? f.every : 1
  switch (kind) {
    case 'immediate':
      return hasPredecessors ? 'As soon as the steps before it are done' : 'As soon as the run starts'
    case 'days_after_previous':
      return hasPredecessors ? 'Some days after the steps before it are done' : 'Some days after the run starts'
    case 'days_after_run_start':
      return 'A number of days into the run'
    case 'time_of_day':
      return 'At a time of day'
    case 'weekday':
      return 'On a day of the week'
    case 'month_day':
      return 'On a day of the month'
    case 'year_date':
      return 'On a date'
    case 'cycle_weekday':
    case 'cycle_month_day':
    case 'cycle_year_date':
      return unit ? `On a day in the ${every}-${unit.toLowerCase()} cycle` : 'On a day in the cycle'
  }
}

export function dueKindLabel(kind: DueRuleKind, f: Frequency): string {
  const unit = cycleUnit(f)
  const every = 'every' in f ? f.every : 1
  switch (kind) {
    case 'days_after_start':
      return 'A number of days after it starts'
    case 'time_of_day':
      return 'At a time of day'
    case 'weekday':
      return 'On a day of the week'
    case 'month_day':
      return 'On a day of the month'
    case 'year_date':
      return 'On a date'
    default:
      return unit ? `On a day in the ${every}-${unit.toLowerCase()} cycle` : 'On a day in the cycle'
  }
}

/** Kinds that need the "Week / Month / Year N" selector. */
export const isCycleKind = (k: StartRuleKind | DueRuleKind) => k.startsWith('cycle_')

export function cycleLabel(f: Frequency, n: number): string {
  return `${cycleUnit(f) ?? 'Cycle'} ${n}`
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** The day the schedule fires, for a calendar default that matches it. */
function scheduleHints(schedules: ScheduleShape[]) {
  const s = schedules[0]
  const weekday = s?.days?.length ? [...s.days].sort((a, b) => a - b)[0] : 1
  const md = s?.month_days?.length ? Math.abs([...s.month_days].sort((a, b) => Math.abs(a) - Math.abs(b))[0]) : 1
  const yd = s?.yearly_dates?.[0] ?? { month: 1, day: 1 }
  return { weekday, monthDay: md, yearly: yd }
}

/** A fresh rule of this kind, with the params filled in (carrying over what still fits). */
export function startRuleOfKind(kind: StartRuleKind, prev: StartRule, schedules: ScheduleShape[]): StartRule {
  return ruleOfKind(kind, prev, schedules, DEFAULT_START_TIME) as StartRule
}

export function dueRuleOfKind(kind: DueRuleKind, prev: DueRule, schedules: ScheduleShape[], start?: StartRule): DueRule {
  // A calendar due of the same kind as the start defaults to the same day — due that
  // evening, since a due date is always after the start.
  const seed = start && start.kind === kind ? { ...start, time: DEFAULT_DUE_TIME } : prev
  return ruleOfKind(kind, seed as DueRule, schedules, DEFAULT_DUE_TIME) as DueRule
}

function ruleOfKind(
  kind: StartRuleKind | DueRuleKind,
  prev: StartRule | DueRule,
  schedules: ScheduleShape[],
  defaultTime: string,
): StartRule | DueRule {
  const hints = scheduleHints(schedules)
  const time = prev.time && TIME_RE.test(prev.time) ? prev.time : defaultTime
  const cycle = typeof prev.cycle === 'number' && prev.cycle >= 1 ? prev.cycle : 1
  switch (kind) {
    case 'immediate':
      return { kind }
    case 'days_after_previous':
      return { kind, days: typeof prev.days === 'number' && prev.days >= 1 ? prev.days : 1, time }
    case 'days_after_run_start':
    case 'days_after_start':
      return { kind, days: typeof prev.days === 'number' && prev.days >= 0 ? prev.days : kind === 'days_after_start' ? 1 : 0, time }
    case 'time_of_day':
      return { kind, time }
    case 'weekday':
      return { kind, weekday: typeof prev.weekday === 'number' ? prev.weekday : hints.weekday, time }
    case 'cycle_weekday':
      return { kind, cycle, weekday: typeof prev.weekday === 'number' ? prev.weekday : hints.weekday, time }
    case 'month_day':
      return { kind, day: prev.day ?? hints.monthDay, time }
    case 'cycle_month_day':
      return { kind, cycle, day: prev.day ?? hints.monthDay, time }
    case 'year_date':
      return { kind, month: prev.month ?? hints.yearly.month, day: typeof prev.day === 'number' ? prev.day : hints.yearly.day, time }
    case 'cycle_year_date':
      return {
        kind,
        cycle,
        month: prev.month ?? hints.yearly.month,
        day: typeof prev.day === 'number' ? prev.day : hints.yearly.day,
        time,
      }
  }
}

/** A saved step's rules (null = legacy: starts right away, due = due_days / due_time). */
export function startRuleOf(s: { start_rule?: StartRule | null }): StartRule {
  return s.start_rule && s.start_rule.kind ? s.start_rule : DEFAULT_START_RULE
}

export function dueRuleOf(s: { due_rule?: DueRule | null; due_days?: number | null; due_time?: string | null }): DueRule {
  if (s.due_rule && s.due_rule.kind) return s.due_rule
  return { kind: 'days_after_start', days: typeof s.due_days === 'number' ? s.due_days : 1, time: s.due_time || DEFAULT_DUE_TIME }
}

// ─── Words ───────────────────────────────────────────────────────────────────

function monthDayWord(d: RuleMonthDay | undefined): string {
  if (d === 'last') return 'last day'
  return typeof d === 'number' ? ordinal(d) : '—'
}

function yearDateWord(day: RuleMonthDay | undefined, month: number | undefined): string {
  return `${typeof day === 'number' ? day : '—'} ${MONTHS_SHORT[(month ?? 1) - 1] ?? ''}`.trim()
}

/** The calendar part of a rule, short: "Thu", "2nd", "last day", "3 Dec", "Week 2, Mon". */
function calendarShort(r: StartRule | DueRule, f: Frequency): string {
  switch (r.kind) {
    case 'weekday':
      return WEEKDAYS_SHORT[r.weekday ?? 1] ?? '—'
    case 'month_day':
      return monthDayWord(r.day)
    case 'year_date':
      return yearDateWord(r.day, r.month)
    case 'cycle_weekday':
      return `${cycleLabel(f, r.cycle ?? 1)}, ${WEEKDAYS_SHORT[r.weekday ?? 1] ?? '—'}`
    case 'cycle_month_day':
      return `${cycleLabel(f, r.cycle ?? 1)}, ${monthDayWord(r.day)}`
    case 'cycle_year_date':
      return `${cycleLabel(f, r.cycle ?? 1)}, ${yearDateWord(r.day, r.month)}`
    default:
      return ''
  }
}

/**
 * The timing in a few words for a collapsed card: "starts Thu 9:00 AM · due Fri 6:00 PM",
 * "due in 2 days". A step that starts right away says only when it is due.
 */
export function timingSummary(start: StartRule, due: DueRule, f: Frequency, hasPredecessors = true): string {
  const parts: string[] = []
  const at = (t?: string) => fmtTime(t || DEFAULT_START_TIME)
  switch (start.kind) {
    case 'immediate':
      break
    case 'days_after_previous':
      parts.push(`starts ${plural(start.days ?? 1, 'day')} after ${hasPredecessors ? 'the steps before it' : 'the run starts'}, ${at(start.time)}`)
      break
    case 'days_after_run_start':
      parts.push(
        (start.days ?? 0) === 0 ? `starts the day the run starts, ${at(start.time)}` : `starts ${plural(start.days ?? 0, 'day')} into the run, ${at(start.time)}`,
      )
      break
    case 'time_of_day':
      parts.push(`starts ${at(start.time)}`)
      break
    default:
      parts.push(`starts ${calendarShort(start, f)} ${at(start.time)}`)
  }
  const dueAt = fmtTime(due.time || DEFAULT_DUE_TIME)
  switch (due.kind) {
    case 'days_after_start': {
      const d = due.days ?? 1
      parts.push(d === 0 ? `due the day it starts, ${dueAt}` : `due ${plural(d, 'day')} after it starts, ${dueAt}`)
      break
    }
    case 'time_of_day':
      parts.push(`due ${dueAt}`)
      break
    default:
      parts.push(`due ${calendarShort(due, f)} ${dueAt}`)
  }
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A sentence for under the Starts control. */
export function describeStart(r: StartRule, f: Frequency, hasPredecessors: boolean): string {
  const at = fmtTime(r.time || DEFAULT_START_TIME)
  const after = hasPredecessors ? 'once the steps before it are done' : 'once the run starts'
  switch (r.kind) {
    case 'immediate':
      return hasPredecessors ? 'Starts the moment the steps before it are done.' : 'Starts the moment the run starts.'
    case 'days_after_previous':
      return `Starts ${plural(r.days ?? 1, 'day')} after ${hasPredecessors ? 'the steps before it are done' : 'the run starts'}, at ${at}.`
    case 'days_after_run_start':
      return (r.days ?? 0) === 0
        ? `Starts on the day the run starts, at ${at}${hasPredecessors ? ' — but never before the steps before it are done' : ''}.`
        : `Starts ${plural(r.days ?? 0, 'day')} after the run starts, at ${at}${hasPredecessors ? ' — but never before the steps before it are done' : ''}.`
    case 'time_of_day':
      return `Starts at ${at} ${after} — the next day if ${at} has already passed.`
    case 'weekday':
      return `Starts on the next ${WEEKDAYS_LONG[r.weekday ?? 1]} at ${at}, ${after}.`
    case 'month_day':
      return r.day === 'last'
        ? `Starts on the last day of the month at ${at}, ${after}.`
        : `Starts on the ${ordinal(Number(r.day) || 1)} at ${at}, ${after}.${Number(r.day) > 28 ? ' In a shorter month, the last day.' : ''}`
    case 'year_date':
      return `Starts on ${r.day} ${MONTHS_LONG[(r.month ?? 1) - 1]} at ${at}, ${after}.`
    default:
      return `Starts in ${calendarShort(r, f)} at ${at}, ${after}.`
  }
}

/** A sentence for under the Due control. */
export function describeDueRule(r: DueRule, f: Frequency): string {
  const at = fmtTime(r.time || DEFAULT_DUE_TIME)
  switch (r.kind) {
    case 'days_after_start': {
      const d = r.days ?? 1
      return `${d === 0 ? `Due the day it starts, at ${at}` : `Due ${plural(d, 'day')} after it starts, at ${at}`}. Holidays and weekly offs are skipped.`
    }
    case 'time_of_day':
      return `Due at the next ${at} after it starts.`
    case 'weekday':
      return `Due on the next ${WEEKDAYS_LONG[r.weekday ?? 1]} at ${at} after it starts.`
    case 'month_day':
      return r.day === 'last'
        ? `Due on the next last day of a month at ${at} after it starts.`
        : `Due on the next ${ordinal(Number(r.day) || 1)} at ${at} after it starts.`
    case 'year_date':
      return `Due on the next ${r.day} ${MONTHS_LONG[(r.month ?? 1) - 1]} at ${at} after it starts.`
    default:
      return `Due in ${calendarShort(r, f)} at ${at}, after it starts.`
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

const validTime = (t: unknown) => typeof t === 'string' && TIME_RE.test(t)
const validDays = (d: unknown, min: number) => typeof d === 'number' && Number.isInteger(d) && d >= min && d <= MAX_RULE_DAYS
const validMonthDay = (d: unknown) => d === 'last' || (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31)

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Why this rule's params are wrong (null = fine) — the server's wording. */
function paramProblem(r: StartRule | DueRule, f: Frequency, which: 'start' | 'due'): string | null {
  const field = which === 'start' ? 'start' : 'due date'
  switch (r.kind) {
    case 'immediate':
      return null
    case 'days_after_previous':
      if (!validDays(r.days, 1)) return `“days after the steps before it are done” must be a whole number from 1 to ${MAX_RULE_DAYS}.`
      break
    case 'days_after_run_start':
      if (!validDays(r.days, 0)) return `“days after the run starts” must be a whole number from 0 to ${MAX_RULE_DAYS}.`
      break
    case 'days_after_start':
      if (!validDays(r.days, 0)) return `“days after it starts” must be a whole number from 0 to ${MAX_RULE_DAYS}.`
      break
  }
  if (!validTime(r.time)) return `the ${field} needs a 24-hour time like ${which === 'start' ? '09:00' : '18:00'}.`
  if (isCycleKind(r.kind)) {
    const every = 'every' in f ? f.every : 1
    if (!(typeof r.cycle === 'number' && Number.isInteger(r.cycle) && r.cycle >= 1)) return `pick which part of the repeat cycle the ${field} falls in.`
    const unit = cycleUnit(f)
    if (unit && r.cycle > every) return `this workflow repeats every ${every} ${unit.toLowerCase()}s — pick ${unit} 1 to ${unit} ${every}.`
  }
  switch (r.kind) {
    case 'weekday':
    case 'cycle_weekday':
      if (!(typeof r.weekday === 'number' && r.weekday >= 0 && r.weekday <= 6)) return `pick a day of the week for the ${field}.`
      break
    case 'month_day':
    case 'cycle_month_day':
      if (!validMonthDay(r.day)) return `pick a day of the month (1–31 or “Last day”) for the ${field}.`
      break
    case 'year_date':
    case 'cycle_year_date':
      if (!(typeof r.month === 'number' && r.month >= 1 && r.month <= 12)) return `pick a month for the ${field}.`
      if (!(typeof r.day === 'number' && Number.isInteger(r.day) && r.day >= 1 && r.day <= DAYS_IN_MONTH[r.month - 1])) return `pick a real date for the ${field}.`
      break
  }
  return null
}

export interface TimingProblem {
  /** Which control it is about. */
  part: 'start' | 'due'
  /** Without the step's name — shown on the step itself. */
  message: string
}

/**
 * What is wrong with a step's timing for this frequency, in the server's words
 * ("this workflow repeats monthly — pick a day of the month or “days after”").
 */
export function timingProblems(start: StartRule, due: DueRule, f: Frequency): TimingProblem[] {
  const out: TimingProblem[] = []
  const s = paramProblem(start, f, 'start') ?? (allowedStartKinds(f).includes(start.kind) ? null : frequencyHint(f))
  if (s) out.push({ part: 'start', message: s })
  const d = paramProblem(due, f, 'due') ?? (allowedDueKinds(f).includes(due.kind) ? null : frequencyHint(f))
  if (d) out.push({ part: 'due', message: d })
  return out
}

/** "Step 2 “Review”: this workflow repeats monthly — …" */
export function stepTimingMessage(stepLabel: string, problem: TimingProblem): string {
  return `${stepLabel}: ${problem.message}`
}

/** The rule as saved: only the params its kind uses. */
export function cleanRule<R extends StartRule | DueRule>(r: R): R {
  const out: Record<string, unknown> = { kind: r.kind }
  const keep = (k: keyof StartRule) => {
    if (r[k] !== undefined) out[k] = r[k]
  }
  switch (r.kind) {
    case 'immediate':
      break
    case 'days_after_previous':
    case 'days_after_run_start':
    case 'days_after_start':
      keep('days')
      keep('time')
      break
    case 'time_of_day':
      keep('time')
      break
    case 'weekday':
      keep('weekday')
      keep('time')
      break
    case 'month_day':
      keep('day')
      keep('time')
      break
    case 'year_date':
      keep('month')
      keep('day')
      keep('time')
      break
    case 'cycle_weekday':
      keep('cycle')
      keep('weekday')
      keep('time')
      break
    case 'cycle_month_day':
      keep('cycle')
      keep('day')
      keep('time')
      break
    case 'cycle_year_date':
      keep('cycle')
      keep('month')
      keep('day')
      keep('time')
      break
  }
  return out as R
}
