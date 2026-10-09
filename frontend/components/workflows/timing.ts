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
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, fmtTime, ordinal, plural } from './format'

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
  /** 'HH:mm' — when its runs start. */
  time?: string
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

/** The ⓘ note on a step's "Timing": what this frequency lets steps use, in one line. */
export function frequencyNote(f: Frequency): string {
  switch (f.type) {
    case 'manual':
      return 'Manual workflows use days, not dates.'
    case 'mixed':
      return 'The schedules repeat differently, so steps use days, not dates.'
    case 'daily':
      return f.every >= 2 ? `Repeats every ${f.every} days, so steps can also use a time of day.` : 'Daily workflows can also use a time of day.'
    case 'weekly':
      return f.every >= 2 ? `Repeats every ${f.every} weeks. Week 1 is when the run starts.` : 'Weekly workflows can also use a day of the week.'
    case 'monthly':
      return f.every >= 2 ? `Repeats every ${f.every} months. Month 1 is when the run starts.` : 'Monthly workflows can also use a day of the month.'
    case 'yearly':
      return f.every >= 2 ? `Repeats every ${f.every} years. Year 1 is when the run starts.` : 'Yearly workflows can also use a date.'
  }
}

/**
 * Why a kind does not fit this frequency — the server's own words, so the step shows the
 * message Save would give: "the workflow repeats monthly. Choose “Day of the month” or a
 * “Days after” option."
 */
export function frequencyHint(f: Frequency): string {
  switch (f.type) {
    case 'manual':
      return 'the workflow starts manually. Choose a “Days after” option.'
    case 'mixed':
      return 'the schedules repeat differently. Choose a “Days after” option.'
    case 'daily':
      return `the workflow repeats ${f.every >= 2 ? `every ${f.every} days` : 'daily'}. Choose “Time of day” or a “Days after” option.`
    case 'weekly':
      return f.every >= 2
        ? `the workflow repeats every ${f.every} weeks. Choose “Day in ${f.every}-week cycle” or a “Days after” option.`
        : 'the workflow repeats weekly. Choose “Day of the week” or a “Days after” option.'
    case 'monthly':
      return f.every >= 2
        ? `the workflow repeats every ${f.every} months. Choose “Day in ${f.every}-month cycle” or a “Days after” option.`
        : 'the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.'
    case 'yearly':
      return f.every >= 2
        ? `the workflow repeats every ${f.every} years. Choose “Day in ${f.every}-year cycle” or a “Days after” option.`
        : 'the workflow repeats yearly. Choose “Date” or a “Days after” option.'
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function startKindLabel(kind: StartRuleKind, f: Frequency, hasPredecessors: boolean): string {
  switch (kind) {
    case 'immediate':
      return hasPredecessors ? 'When previous step is done' : 'Immediately'
    case 'days_after_previous':
      return hasPredecessors ? 'Days after previous step' : 'Days after start'
    case 'days_after_run_start':
      return TRIGGER_KIND_LABEL
    default:
      return calendarKindLabel(kind, f)
  }
}

/** The `days_after_run_start` start kind — first steps only. */
export const TRIGGER_KIND_LABEL = 'Days after workflow is triggered'

/**
 * The start kinds a step is offered: a first step (no steps before it) "Immediately",
 * "Days after workflow is triggered" and the frequency's calendar kind; a later step
 * "When previous step is done", "Days after previous step" and the calendar kind.
 */
export function startKindsFor(f: Frequency, hasPredecessors: boolean): StartRuleKind[] {
  return allowedStartKinds(f).filter((k) => (hasPredecessors ? k !== 'days_after_run_start' : k !== 'days_after_previous'))
}

/** Why a later step can't start "Days after workflow is triggered" — Save's words. */
export const LATER_STEP_TRIGGER_PROBLEM = `“${TRIGGER_KIND_LABEL}” is only for the first step — pick another start.`

export function dueKindLabel(kind: DueRuleKind, f: Frequency): string {
  return kind === 'days_after_start' ? 'Days after step starts' : calendarKindLabel(kind, f)
}

/** "Time of day", "Day of the week", "Day of the month", "Date", "Day in 2-week cycle". */
function calendarKindLabel(kind: StartRuleKind | DueRuleKind, f: Frequency): string {
  const unit = cycleUnit(f)
  const every = 'every' in f ? f.every : 1
  switch (kind) {
    case 'time_of_day':
      return 'Time of day'
    case 'weekday':
      return 'Day of the week'
    case 'month_day':
      return 'Day of the month'
    case 'year_date':
      return 'Date'
    default:
      return unit ? `Day in ${every}-${unit.toLowerCase()} cycle` : 'Day in cycle'
  }
}

/** Kinds that need the "Week / Month / Year N" selector. */
export const isCycleKind = (k: StartRuleKind | DueRuleKind) => k.startsWith('cycle_')

export function cycleLabel(f: Frequency, n: number): string {
  return `${cycleUnit(f) ?? 'Cycle'} ${n}`
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * The day runs start (the latest trigger day in the cycle), for a calendar default that
 * matches it — so a new rule on a first step is valid as it is.
 */
function scheduleHints(schedules: ScheduleShape[]) {
  const rs = runStartOf(schedules, frequencyOf(schedules))
  return {
    weekday: rs?.type === 'weekly' ? rs.weekday : 1,
    monthDay: rs?.type === 'monthly' ? rs.day : 1,
    yearly: rs?.type === 'yearly' ? { month: rs.month, day: rs.day } : { month: 1, day: 1 },
  }
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
 * A calendar rule's day in words, said as landing in the next cycle: "1st of next month",
 * "Mon next week", "1 Mar next year", "Week 1, Mon (next cycle)".
 */
function calendarNext(r: StartRule | DueRule, f: Frequency): string {
  const short = calendarShort(r, f)
  switch (r.kind) {
    case 'month_day':
      return `${short} of next month`
    case 'weekday':
      return `${short} next week`
    case 'year_date':
      return `${short} next year`
    default:
      return `${short} (next cycle)`
  }
}

/** Which of a step's dates land in the next cycle (see `stepNextCycle`). */
export interface NextCycleFlags {
  start: boolean
  due: boolean
}

/**
 * The timing in a few words for a collapsed card: "Starts Thu 9:00 AM · due Fri 6:00 PM",
 * "Due in 2 days, 6:00 PM", "Starts 1st of next month, 9:00 AM". A step that starts right
 * away says only when it is due. `next` says which calendar dates fall before the previous
 * step's (or, for the due date, before this step's start) and so land in the next cycle.
 */
export function timingSummary(start: StartRule, due: DueRule, f: Frequency, hasPredecessors = true, next?: NextCycleFlags | null): string {
  const parts: string[] = []
  const at = (t?: string) => fmtTime(t || DEFAULT_START_TIME)
  switch (start.kind) {
    case 'immediate':
      break
    case 'days_after_previous':
      parts.push(`starts ${plural(start.days ?? 1, 'day')} after ${hasPredecessors ? 'previous step' : 'run start'}, ${at(start.time)}`)
      break
    case 'days_after_run_start':
      parts.push(
        (start.days ?? 0) === 0 ? `starts the day it’s triggered, ${at(start.time)}` : `starts ${plural(start.days ?? 0, 'day')} after trigger, ${at(start.time)}`,
      )
      break
    case 'time_of_day':
      parts.push(next?.start ? `starts ${at(start.time)} next day` : `starts ${at(start.time)}`)
      break
    default:
      parts.push(next?.start ? `starts ${calendarNext(start, f)}, ${at(start.time)}` : `starts ${calendarShort(start, f)} ${at(start.time)}`)
  }
  const dueAt = fmtTime(due.time || DEFAULT_DUE_TIME)
  switch (due.kind) {
    case 'days_after_start': {
      const d = due.days ?? 1
      parts.push(d === 0 ? `due same day, ${dueAt}` : `due in ${plural(d, 'day')}, ${dueAt}`)
      break
    }
    case 'time_of_day':
      parts.push(next?.due ? `due ${dueAt} next day` : `due ${dueAt}`)
      break
    default:
      parts.push(next?.due ? `due ${calendarNext(due, f)}, ${dueAt}` : `due ${calendarShort(due, f)} ${dueAt}`)
  }
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
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
      if (!validDays(r.days, 1)) return `start days must be 1 to ${MAX_RULE_DAYS}.`
      break
    case 'days_after_run_start':
      if (!validDays(r.days, 0)) return `start days must be 0 to ${MAX_RULE_DAYS}.`
      break
    case 'days_after_start':
      if (!validDays(r.days, 0)) return `due days must be 0 to ${MAX_RULE_DAYS}.`
      break
  }
  if (!validTime(r.time)) return `enter a ${which} time.`
  if (isCycleKind(r.kind)) {
    const every = 'every' in f ? f.every : 1
    if (!(typeof r.cycle === 'number' && Number.isInteger(r.cycle) && r.cycle >= 1)) return `choose a cycle for the ${field}.`
    const unit = cycleUnit(f)
    if (unit && r.cycle > every) return `the workflow repeats every ${every} ${unit.toLowerCase()}s. Choose ${unit} 1 to ${unit} ${every}.`
  }
  switch (r.kind) {
    case 'weekday':
    case 'cycle_weekday':
      if (!(typeof r.weekday === 'number' && r.weekday >= 0 && r.weekday <= 6)) return `choose a day of the week for the ${field}.`
      break
    case 'month_day':
    case 'cycle_month_day':
      if (!validMonthDay(r.day)) return `choose a day of the month for the ${field}.`
      break
    case 'year_date':
    case 'cycle_year_date':
      if (!(typeof r.month === 'number' && r.month >= 1 && r.month <= 12)) return `choose a month for the ${field}.`
      if (!(typeof r.day === 'number' && Number.isInteger(r.day) && r.day >= 1 && r.day <= DAYS_IN_MONTH[r.month - 1])) return `choose a valid date for the ${field}.`
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
 * ("the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.").
 * With `place` (where the step sits): a later step can't start "Days after workflow is
 * triggered"; a FIRST step (nothing before it) must have its start and due on or after the
 * run start in its cycle ("pick a day on or after the 3rd, when the run starts.").
 * Ordered as Save checks them, so `[0]` is the message Save gives.
 */
export function timingProblems(start: StartRule, due: DueRule, f: Frequency, place?: StepPlace | null): TimingProblem[] {
  const out: TimingProblem[] = []
  const s = paramProblem(start, f, 'start') ?? (allowedStartKinds(f).includes(start.kind) ? null : frequencyHint(f))
  if (s) out.push({ part: 'start', message: s })
  const d = paramProblem(due, f, 'due') ?? (allowedDueKinds(f).includes(due.kind) ? null : frequencyHint(f))
  if (d) out.push({ part: 'due', message: d })
  if (place && !place.first && !s && start.kind === 'days_after_run_start') out.push({ part: 'start', message: LATER_STEP_TRIGGER_PROBLEM })
  const runStart = place?.first ? place.runStart : null
  if (runStart) {
    const early = !s ? beforeRunStartProblem(start, runStart) : null
    if (early) out.push({ part: 'start', message: early })
    const dueEarly = !d ? beforeRunStartProblem(due, runStart) : null
    if (dueEarly) out.push({ part: 'due', message: dueEarly })
  }
  return out
}

/** Where a step sits: first (waits for nothing) or later, and where runs start. */
export interface StepPlace {
  first: boolean
  runStart: RunStart | null
}

// ─── First steps: on or after the run start ──────────────────────────────────

/**
 * Where a run starts inside its cycle (the server's `RunStartPoint`): the time (daily),
 * weekday (weekly, Sun = 0), day of the month (monthly) or date (yearly), at the
 * schedule's time. With several trigger days in a cycle it is the LATEST of them.
 */
export type RunStart =
  | { type: 'daily'; time: string }
  | { type: 'weekly'; every: number; weekday: number; time: string }
  | { type: 'monthly'; every: number; day: number; time: string }
  | { type: 'yearly'; every: number; month: number; day: number; time: string }

/** Monday-first position of a weekday (Mon = 0 … Sun = 6). */
export const weekPosition = (weekday: number) => (weekday + 6) % 7

export function minutesOf(time: string | null | undefined): number {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return 0
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const isIntIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** The run start from the schedules being edited (null: manual / mixed / no trigger day yet). */
export function runStartOf(schedules: ScheduleShape[], f: Frequency): RunStart | null {
  if (f.type === 'manual' || f.type === 'mixed') return null
  let best: { pos: number; time: string; point: RunStart } | null = null
  const consider = (pos: number, time: string, point: RunStart) => {
    if (!best || pos > best.pos || (pos === best.pos && minutesOf(time) > minutesOf(best.time))) best = { pos, time, point }
  }
  for (const s of schedules) {
    const time = typeof s.time === 'string' && TIME_RE.test(s.time) ? s.time : '00:00'
    if (f.type === 'daily') consider(0, time, { type: 'daily', time })
    if (f.type === 'weekly') {
      for (const d of s.days ?? []) if (isIntIn(d, 0, 6)) consider(weekPosition(d), time, { type: 'weekly', every: f.every, weekday: d, time })
    }
    if (f.type === 'monthly') {
      for (const raw of s.month_days ?? []) {
        const d = Math.abs(raw)
        if (isIntIn(d, 1, 31)) consider(d, time, { type: 'monthly', every: f.every, day: d, time })
      }
    }
    if (f.type === 'yearly') {
      for (const y of s.yearly_dates ?? []) {
        if (isIntIn(y?.month, 1, 12) && isIntIn(y?.day, 1, 31)) {
          consider(y.month * 100 + y.day, time, { type: 'yearly', every: f.every, month: y.month, day: y.day, time })
        }
      }
    }
  }
  return (best as { point: RunStart } | null)?.point ?? null
}

/** The run start day in words: "the 3rd", "Wednesday", "1 Apr" (null for daily). */
export function runStartDayWords(rs: RunStart): string | null {
  switch (rs.type) {
    case 'daily':
      return null
    case 'weekly':
      return WEEKDAYS_LONG[rs.weekday]
    case 'monthly':
      return `the ${ordinal(rs.day)}`
    case 'yearly':
      return `${rs.day} ${MONTHS_SHORT[rs.month - 1]}`
  }
}

/** The run start, short, for the greyed-out days: "3rd", "Wed", "1 Apr", "9:00 AM". */
export function runStartShort(rs: RunStart): string {
  switch (rs.type) {
    case 'daily':
      return fmtTime(rs.time)
    case 'weekly':
      return WEEKDAYS_SHORT[rs.weekday]
    case 'monthly':
      return ordinal(rs.day)
    case 'yearly':
      return `${rs.day} ${MONTHS_SHORT[rs.month - 1]}`
  }
}

/** The tooltip on a day a first step can't use: "Before the run starts (3rd)". */
export const beforeRunStartText = (rs: RunStart) => `Before the run starts (${runStartShort(rs)})`

/**
 * Is this calendar position before the run start (a first step can't use it)? Day level
 * only — the pickers grey these out. `cycle` is the rule's Week / Month / Year (1 when
 * not cyclic); only cycle 1 holds days before the run.
 */
export function dayBeforeRunStart(
  rs: RunStart | null,
  pos: { weekday?: number; day?: RuleMonthDay; month?: number; cycle?: number },
): boolean {
  if (!rs || rs.type === 'daily' || (pos.cycle ?? 1) !== 1) return false
  if (rs.type === 'weekly') return typeof pos.weekday === 'number' && weekPosition(pos.weekday) < weekPosition(rs.weekday)
  if (rs.type === 'monthly') return typeof pos.day === 'number' && pos.day < rs.day
  return typeof pos.month === 'number' && typeof pos.day === 'number' && pos.month * 100 + pos.day < rs.month * 100 + rs.day
}

/**
 * Why a FIRST step's calendar rule falls before the run start in its cycle, or null —
 * the server's exact words (completes "Step 1 “X”: …"). Cycle rules in Week / Month /
 * Year 2+ are fine. A rule on the run start day must not be before the run's time.
 */
export function beforeRunStartProblem(rule: StartRule | DueRule, rs: RunStart): string | null {
  if (!isCalendarKind(rule.kind)) return null
  const at = fmtTime(rs.time)
  const earlierTime = minutesOf(rule.time) < minutesOf(rs.time)
  if (rs.type === 'daily') return rule.kind === 'time_of_day' && earlierTime ? `pick a time at or after ${at}, when the run starts.` : null
  const cyclic = isCycleKind(rule.kind)
  if (cyclic && rule.cycle !== 1) return null
  const unit = rs.type === 'weekly' ? 'Week' : rs.type === 'monthly' ? 'Month' : 'Year'
  const inCycle = cyclic ? ` in ${unit} 1` : ''
  let cmp: number
  switch (rule.kind) {
    case 'weekday':
    case 'cycle_weekday':
      if (rs.type !== 'weekly' || typeof rule.weekday !== 'number') return null
      cmp = weekPosition(rule.weekday) - weekPosition(rs.weekday)
      break
    case 'month_day':
    case 'cycle_month_day':
      if (rs.type !== 'monthly' || rule.day === undefined) return null
      cmp = (rule.day === 'last' ? 31 : rule.day) - rs.day
      break
    case 'year_date':
    case 'cycle_year_date':
      if (rs.type !== 'yearly' || typeof rule.month !== 'number' || typeof rule.day !== 'number') return null
      cmp = rule.month * 100 + rule.day - (rs.month * 100 + rs.day)
      break
    default:
      return null
  }
  const day = runStartDayWords(rs)
  const what = rs.type === 'yearly' ? 'a date' : 'a day'
  if (cmp < 0) return `pick ${what} on or after ${day}${inCycle}, when the run starts.`
  if (cmp === 0 && earlierTime) return `pick a time at or after ${at} on ${day}${inCycle}, when the run starts.`
  return null
}

/** "Step 2 “Review”: the workflow repeats monthly. …" */
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
