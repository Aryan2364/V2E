// The builder's copy of the engine's planning (backend engine/plan.ts), without the
// holiday shifts, run on the SAMPLE RUN: the next run on the schedules' run start day
// (`sampleRunDay` — the server plans the very same run for Save's order check, so the
// calendar's greyed days and Save's messages agree). It drives the timing calendar (every
// step's planned start → due, what each day holds, which days are too early), the "(next
// month)" labels of legacy rules, and the card summaries.
//
// Explicit day rules (with `cycle`) land exactly on their day — never before the step
// may start (order wins). Legacy rules (no cycle; cycle_* kinds) are inferred as before: a
// day before the previous step's dates resolves to the next cycle.
//
// Dates are in a floating wall-clock frame: a Date whose UTC fields are the org's wall
// clock, so no time zone is involved. The exact dates of real runs (holidays included)
// are what the example run shows.

import type { DueRule, RuleMonthDay, StartRule } from '@/lib/types/workflows'
import {
  DEFAULT_DUE_RULE,
  DEFAULT_START_RULE,
  allowedDueKinds,
  allowedStartKinds,
  dayMonthWords,
  dueBeforeStartText,
  isCalendarKind,
  isCycleKind,
  isExplicitRule,
  minutesOf,
  predecessorName,
  sampleRunDay,
  startBeforePredecessorText,
  timingProblems,
  weekPosition,
  type DayDate,
  type Frequency,
  type NextCycleFlags,
  type RunStart,
  type ScheduleShape,
  type TimingProblem,
} from './timing'

const DAY_MS = 86_400_000

export interface PlanContext {
  f: Frequency
  /** The representative run's start (floating wall clock). */
  runStart: Date
  /** The cycle length cycle_* rules count in (1 when not cyclic). */
  every: number
}

export interface PlannedDates {
  start: Date
  due: Date
}

// ─── Floating dates ──────────────────────────────────────────────────────────

const wall = (y: number, m: number, d: number, minutes: number) => new Date(Date.UTC(y, m - 1, d) + minutes * 60_000)
const dayIndex = (d: Date) => Math.floor(d.getTime() / DAY_MS)
/** Monday-first week number (1 Jan 1970 was a Thursday). */
const weekIndex = (d: Date) => Math.floor((dayIndex(d) + 3) / 7)
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const fromDayIndex = (i: number, minutes: number) => new Date(i * DAY_MS + minutes * 60_000)
const atMonth = (idx: number, day: RuleMonthDay | undefined, minutes: number) => {
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  const dim = daysIn(y, m)
  return wall(y, m, day === 'last' || day === undefined ? dim : Math.min(day, dim), minutes)
}
const atYear = (y: number, month: number | undefined, day: RuleMonthDay | undefined, minutes: number) =>
  atMonth(y * 12 + (month ?? 1) - 1, day, minutes)

/**
 * The representative run start: a run on the run start day at its time — in Mon 6 Jan
 * 2025's week, in January 2025 (31 days), or in 2025 for a yearly date.
 */
export function referenceRunStart(rs: RunStart | null): Date {
  if (!rs) return wall(2025, 1, 6, 9 * 60)
  const t = minutesOf(rs.time)
  switch (rs.type) {
    case 'daily':
      return wall(2025, 1, 6, t)
    case 'weekly':
      return wall(2025, 1, 6 + weekPosition(rs.weekday), t)
    case 'monthly':
      return wall(2025, 1, rs.day, t)
    case 'yearly':
      return atYear(2025, rs.month, rs.day, t)
  }
}

/**
 * The plan's context. With `sample` (the schedules being edited and the org clock's
 * "now"), the run is the SAMPLE RUN — the next run on the run start day, as the server
 * plans it for Save's order check. Without it, a fixed representative run (Jan 2025),
 * which is all the "(next month)" labels need. Manual / mixed workflows: a run now.
 */
export function planContext(f: Frequency, rs: RunStart | null, sample?: { schedules: ScheduleShape[]; now: Date } | null): PlanContext {
  const every = f.type === 'weekly' || f.type === 'monthly' || f.type === 'yearly' ? Math.max(1, f.every) : 1
  if (!sample) return { f, runStart: referenceRunStart(rs), every }
  const n = sample.now
  const today: DayDate = { year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate() }
  const nowMinutes = n.getHours() * 60 + n.getMinutes()
  if (!rs) return { f, runStart: wall(today.year, today.month, today.day, nowMinutes), every }
  const d = sampleRunDay(sample.schedules, rs, today, nowMinutes)
  return { f, runStart: wall(d.year, d.month, d.day, minutesOf(rs.time)), every }
}

/** A floating date's calendar day. */
export const dayOf = (d: Date): DayDate => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() })
/** Days since 1970 of a floating date (compare days with it). */
export const dayNumber = (d: Date) => dayIndex(d)
/** A floating date at midnight of a day number. */
export const dateOfDayNumber = (n: number) => fromDayIndex(n, 0)

// ─── Resolution (the engine's rules, no holidays) ────────────────────────────

type Rule = StartRule | DueRule

/** Which cycle a date is in, as the rule counts cycles (a day / week / month / year, or a period of `every`). */
function cycleOf(rule: Rule, d: Date, ctx: PlanContext): number {
  const run = ctx.runStart
  switch (rule.kind) {
    case 'time_of_day':
      return dayIndex(d)
    case 'weekday':
      return weekIndex(d)
    case 'month_day':
      return monthIndex(d)
    case 'year_date':
      return d.getUTCFullYear()
    case 'cycle_weekday':
      return Math.floor((weekIndex(d) - weekIndex(run)) / ctx.every)
    case 'cycle_month_day':
      return Math.floor((monthIndex(d) - monthIndex(run)) / ctx.every)
    case 'cycle_year_date':
      return Math.floor((d.getUTCFullYear() - run.getUTCFullYear()) / ctx.every)
    default:
      return 0
  }
}

/** The rule's occurrence in cycle `k` (the anchor's cycle numbering of `cycleOf`). */
function occurrenceIn(rule: Rule, k: number, ctx: PlanContext): Date {
  const t = minutesOf(rule.time)
  const run = ctx.runStart
  const cycle = Math.max(1, rule.cycle ?? 1) - 1
  switch (rule.kind) {
    case 'time_of_day':
      return fromDayIndex(k, t)
    case 'weekday':
      // Monday of week k is day 7k - 3.
      return fromDayIndex(7 * k - 3 + weekPosition(rule.weekday ?? 1), t)
    case 'month_day':
      return atMonth(k, rule.day, t)
    case 'year_date':
      return atYear(k, rule.month, rule.day, t)
    case 'cycle_weekday':
      return fromDayIndex(7 * (weekIndex(run) + k * ctx.every + cycle) - 3 + weekPosition(rule.weekday ?? 1), t)
    case 'cycle_month_day':
      return atMonth(monthIndex(run) + k * ctx.every + cycle, rule.day, t)
    case 'cycle_year_date':
      return atYear(run.getUTCFullYear() + k * ctx.every + cycle, rule.month, rule.day, t)
    default:
      return run
  }
}

/**
 * The next occurrence of a calendar rule on/after `anchor` (strictly after, for a due
 * date), and whether it is in a later cycle than the anchor — "(next month)".
 */
export function calendarOccurrence(rule: Rule, anchor: Date, ctx: PlanContext, strict: boolean): { at: Date; next: boolean } {
  const k0 = cycleOf(rule, anchor, ctx)
  for (let k = k0; k <= k0 + 3; k++) {
    const at = occurrenceIn(rule, k, ctx)
    if (strict ? at.getTime() > anchor.getTime() : at.getTime() >= anchor.getTime()) return { at, next: k > k0 }
  }
  return { at: anchor, next: false }
}

/**
 * The day an explicit rule names, at its time: the run's own week / month / year plus
 * `cycle - 1` (plus `extra`) — the engine's `explicitOccurrence`.
 */
export function explicitOccurrence(rule: Rule, ctx: PlanContext, extra = 0): Date {
  const t = minutesOf(rule.time)
  const run = ctx.runStart
  const off = Math.max(1, Math.trunc(rule.cycle ?? 1)) - 1 + extra
  switch (rule.kind) {
    case 'weekday':
      return fromDayIndex(7 * (weekIndex(run) + off) - 3 + weekPosition(rule.weekday ?? 1), t)
    case 'month_day':
      return atMonth(monthIndex(run) + off, rule.day, t)
    default:
      return atYear(run.getUTCFullYear() + off, rule.month, rule.day, t)
  }
}

/**
 * Where an explicit rule lands (the engine's `resolveExplicit`): its own day when that
 * is on/after the anchor (strictly after, for a due date). Otherwise order wins and it
 * never jumps a cycle: a start begins with the anchor; a due date is its time on the
 * start's day, or the next day when that has passed.
 */
export function resolveExplicit(rule: Rule, anchor: Date, ctx: PlanContext, strict: boolean): Date {
  const e = explicitOccurrence(rule, ctx)
  if (strict ? e.getTime() > anchor.getTime() : e.getTime() >= anchor.getTime()) return e
  if (!strict) return anchor
  const sameDay = fromDayIndex(dayIndex(anchor), minutesOf(rule.time))
  return sameDay.getTime() > anchor.getTime() ? sameDay : new Date(sameDay.getTime() + DAY_MS)
}

/** When a step starts, given when it may start (`anchor`). */
export function resolveStart(rule: StartRule, anchor: Date, ctx: PlanContext): Date {
  switch (rule.kind) {
    case 'immediate':
      return anchor
    case 'days_after_previous':
      return fromDayIndex(dayIndex(anchor) + (rule.days ?? 1), minutesOf(rule.time))
    case 'days_after_run_start': {
      const t = fromDayIndex(dayIndex(ctx.runStart) + (rule.days ?? 0), minutesOf(rule.time))
      return t.getTime() >= anchor.getTime() ? t : anchor
    }
    default:
      return isExplicitRule(rule) ? resolveExplicit(rule, anchor, ctx, false) : calendarOccurrence(rule, anchor, ctx, false).at
  }
}

/** When a step that starts at `start` is due (never at or before its start). */
export function resolveDue(rule: DueRule, start: Date, ctx: PlanContext): Date {
  if (rule.kind === 'days_after_start') {
    const t = minutesOf(rule.time)
    const due = fromDayIndex(dayIndex(start) + (rule.days ?? 1), t)
    return due.getTime() > start.getTime() ? due : fromDayIndex(dayIndex(start) + (rule.days ?? 1) + 1, t)
  }
  if (isExplicitRule(rule)) return resolveExplicit(rule, start, ctx, true)
  return calendarOccurrence(rule, start, ctx, true).at
}

// ─── Planning ────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string
  deps: string[]
  start: StartRule
  due: DueRule
}

/**
 * A step's rules as the engine would plan them: a timing this frequency doesn't allow
 * plans with the defaults (as the example run does).
 */
export function plannableRules(start: StartRule, due: DueRule, f: Frequency): { start: StartRule; due: DueRule } {
  const problems = timingProblems(start, due, f)
  const startOk = allowedStartKinds(f).includes(start.kind) && !problems.some((p) => p.part === 'start')
  const dueOk = allowedDueKinds(f).includes(due.kind) && !problems.some((p) => p.part === 'due')
  return { start: startOk ? start : DEFAULT_START_RULE, due: dueOk ? due : DEFAULT_DUE_RULE }
}

/** The latest planned due among `deps`, or null. */
export function latestDue(deps: string[], planned: Map<string, PlannedDates>): Date | null {
  let out: Date | null = null
  for (const d of deps) {
    const p = planned.get(d)
    if (p && (!out || p.due.getTime() > out.getTime())) out = p.due
  }
  return out
}

/** When a step may start: the run start, or the latest due of the steps before it. */
export function anchorFor(deps: string[], planned: Map<string, PlannedDates>, ctx: PlanContext): Date {
  const latest = latestDue(deps, planned)
  return latest && latest.getTime() > ctx.runStart.getTime() ? latest : ctx.runStart
}

/** Plan every step of the representative run, in dependency order (joins wait for the latest). */
export function planSteps(steps: PlanStep[], ctx: PlanContext): Map<string, PlannedDates> {
  const planned = new Map<string, PlannedDates>()
  const ids = new Set(steps.map((s) => s.id))
  const pending = steps.map((s) => ({ ...s, deps: s.deps.filter((d) => ids.has(d) && d !== s.id) }))
  let progressed = true
  while (progressed && planned.size < steps.length) {
    progressed = false
    for (const s of pending) {
      if (planned.has(s.id) || !s.deps.every((d) => planned.has(d))) continue
      const { start: sr, due: dr } = plannableRules(s.start, s.due, ctx.f)
      const start = resolveStart(sr, anchorFor(s.deps, planned, ctx), ctx)
      planned.set(s.id, { start, due: resolveDue(dr, start, ctx) })
      progressed = true
    }
  }
  return planned
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** "next month", "next week", "next year", "next day", "next cycle". */
export function nextCycleWord(kind: string): string {
  if (isCycleKind(kind as StartRule['kind'])) return 'next cycle'
  switch (kind) {
    case 'month_day':
      return 'next month'
    case 'weekday':
      return 'next week'
    case 'year_date':
      return 'next year'
    case 'time_of_day':
      return 'next day'
    default:
      return 'next cycle'
  }
}

/**
 * Where a step's dates land: the anchor its start resolves from, its planned start, and
 * whether its calendar start / due fall in the next cycle (before the previous step's
 * due, or before its own start).
 */
export function stepNextCycle(start: StartRule, due: DueRule, anchor: Date, ctx: PlanContext): NextCycleFlags & { plannedStart: Date } {
  const { start: sr, due: dr } = plannableRules(start, due, ctx.f)
  const plannedStart = resolveStart(sr, anchor, ctx)
  // Explicit days say their own cycle; only legacy (inferred) days get "next" flags.
  return {
    plannedStart,
    start: isCalendarKind(sr.kind) && sr === start && !isExplicitRule(sr) ? calendarOccurrence(sr, anchor, ctx, false).next : false,
    due: isCalendarKind(dr.kind) && dr === due && !isExplicitRule(dr) ? calendarOccurrence(dr, plannedStart, ctx, true).next : false,
  }
}

/** Every step's next-cycle flags (for summaries outside the step card). */
export function nextCycleFlagsFor(steps: PlanStep[], ctx: PlanContext): Map<string, NextCycleFlags> {
  const planned = planSteps(steps, ctx)
  const out = new Map<string, NextCycleFlags>()
  for (const s of steps) {
    const { start, due } = stepNextCycle(s.start, s.due, anchorFor(s.deps, planned, ctx), ctx)
    out.set(s.id, { start, due })
  }
  return out
}

// ─── Order of explicit days (Save's check, on the sample run) ────────────────

/** A step as the order check reads it. */
export interface OrderStep extends PlanStep {
  /** "1", "B2". */
  label: string
  title: string
}

/** The step-before that is due last (the one a step's start waits for), or null. */
export function latestPredecessor(deps: string[], planned: Map<string, PlannedDates>, selfId?: string | null): { id: string; due: Date } | null {
  let latest: { id: string; due: Date } | null = null
  for (const d of deps) {
    const p = planned.get(d)
    if (p && d !== selfId && (!latest || p.due.getTime() > latest.due.getTime())) latest = { id: d, due: p.due }
  }
  return latest
}

/**
 * An explicit day that comes before what it waits for — the server's `orderProblems` +
 * `sampleOrderMessages`, word for word: a later step's start day before the LATEST
 * planned due day of the steps it waits for (`pick a day on or after 5 Nov, when 1
 * “Collect documents” is due.`), or a due day before its own planned start day. The same
 * day is fine. Legacy (inferred) rules never count. `ctx` must be the sample run;
 * `nameOf` names a step-before (`predecessorName`). Call only when the step's timing has
 * no other problem (Save checks this last).
 */
export function orderProblemOf(s: PlanStep, planned: Map<string, PlannedDates>, ctx: PlanContext, nameOf: (id: string) => string): TimingProblem | null {
  const { start, due } = plannableRules(s.start, s.due, ctx.f)
  const refYear = ctx.runStart.getUTCFullYear()
  const latest = latestPredecessor(s.deps, planned, s.id)
  if (latest && start === s.start && isExplicitRule(start) && dayIndex(explicitOccurrence(start, ctx)) < dayIndex(latest.due)) {
    return { part: 'start', message: startBeforePredecessorText(dayMonthWords(dayOf(latest.due), refYear), nameOf(latest.id)) }
  }
  const plannedStart = resolveStart(start, anchorFor(s.deps.filter((d) => d !== s.id), planned, ctx), ctx)
  if (due === s.due && isExplicitRule(due) && dayIndex(explicitOccurrence(due, ctx)) < dayIndex(plannedStart)) {
    return { part: 'due', message: dueBeforeStartText(dayMonthWords(dayOf(plannedStart), refYear)) }
  }
  return null
}

/** A step as the order check names it. */
export interface NamedStep {
  id: string
  /** "1", "B2". */
  label: string
  title: string
}

/** `orderProblemOf` for every step (skipping those `skip` says have another problem). */
export function orderProblemsFor(
  steps: PlanStep[],
  names: NamedStep[],
  planned: Map<string, PlannedDates>,
  ctx: PlanContext,
  skip: (id: string) => boolean = () => false,
): Map<string, TimingProblem> {
  const byId = new Map(names.map((n) => [n.id, n]))
  const nameOf = (id: string) => predecessorName(byId.get(id)?.label ?? '?', byId.get(id)?.title)
  const out = new Map<string, TimingProblem>()
  for (const s of steps) {
    if (skip(s.id)) continue
    const p = orderProblemOf(s, planned, ctx, nameOf)
    if (p) out.set(s.id, p)
  }
  return out
}

// ─── The calendar: what each day holds ───────────────────────────────────────

/** One step's planned span on the calendar. */
export interface CalendarSpan {
  id: string
  /** "1", "B2". */
  label: string
  title: string
  start: Date
  due: Date
  /** Its colour (index into the band palette). */
  color: number
  /** This step waits for it (emphasised). */
  waitsFor: boolean
}

/**
 * Every OTHER step's planned span in the sample run, in display order, each with its own
 * colour; the steps this one waits for (its predecessors incl. "Also waits for") marked.
 */
export function calendarSpans(
  steps: { id: string; label: string; title: string }[],
  planned: Map<string, PlannedDates>,
  selfId: string | null,
  deps: string[],
): CalendarSpan[] {
  const waits = new Set(deps)
  const out: CalendarSpan[] = []
  steps.forEach((s, i) => {
    const p = planned.get(s.id)
    if (!p || s.id === selfId) return
    out.push({ id: s.id, label: s.label, title: s.title, start: p.start, due: p.due, color: i, waitsFor: waits.has(s.id) })
  })
  return out
}

/** What happens on a day: "1 Collect documents — due 6:00 PM" lines (time order). */
export interface DayEvent {
  span: CalendarSpan | null
  what: 'run' | 'start' | 'due' | 'start_due' | 'ongoing'
  /** Minutes since midnight (sorting / the time word); null for "ongoing". */
  minutes: number | null
}

export function eventsOn(dayNo: number, spans: CalendarSpan[], runStart: Date): DayEvent[] {
  const out: DayEvent[] = []
  const mins = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes()
  if (dayIndex(runStart) === dayNo) out.push({ span: null, what: 'run', minutes: mins(runStart) })
  for (const sp of spans) {
    const a = dayIndex(sp.start)
    const b = dayIndex(sp.due)
    if (dayNo < a || dayNo > b) continue
    if (a === dayNo && b === dayNo) out.push({ span: sp, what: 'start_due', minutes: mins(sp.start) })
    else if (a === dayNo) out.push({ span: sp, what: 'start', minutes: mins(sp.start) })
    else if (b === dayNo) out.push({ span: sp, what: 'due', minutes: mins(sp.due) })
    else out.push({ span: sp, what: 'ongoing', minutes: null })
  }
  return out.sort((x, y) => (x.minutes ?? 24 * 60) - (y.minutes ?? 24 * 60))
}

/**
 * The cycle a day is in, counted from the run's own (1 = the run's Mon–Sun week / month
 * / year) — what an explicit rule picked on that day stores.
 */
export function cycleOfDay(kind: 'weekday' | 'month_day' | 'year_date', dayNo: number, ctx: PlanContext): number {
  const d = fromDayIndex(dayNo, 0)
  const run = ctx.runStart
  if (kind === 'weekday') return weekIndex(d) - weekIndex(run) + 1
  if (kind === 'month_day') return monthIndex(d) - monthIndex(run) + 1
  return d.getUTCFullYear() - run.getUTCFullYear() + 1
}

/** The day number (floating) the rule stands on in the sample run — its own day, or for a legacy rule where it is planned. */
export function ruleDay(rule: Rule, anchor: Date, ctx: PlanContext, strict: boolean): number | null {
  if (!isCalendarKind(rule.kind) || rule.kind === 'time_of_day') return null
  if (isExplicitRule(rule)) return dayIndex(explicitOccurrence(rule, ctx))
  return dayIndex(calendarOccurrence(rule, anchor, ctx, strict).at)
}

// ─── The calendar's greyed days and soft notes ───────────────────────────────

/**
 * The first day a step's START may use, and why the days before it are greyed: a first
 * step — the run start day ("Before the run starts (3rd)", `runStartText`); a later step —
 * the day the step it waits for (due last) is due ("Before 1 “Collect documents” is due").
 * That same day stays selectable.
 */
export function startMinDay(
  ctx: PlanContext,
  pred: { name: string; due: Date } | null,
  runStartText: string,
): { minDay: number; reason: string } {
  if (!pred) return { minDay: dayIndex(ctx.runStart), reason: runStartText }
  return { minDay: dayIndex(pred.due), reason: `Before ${pred.name} is due` }
}

/** The first day a DUE date may use: the step's own planned start day ("Before this step starts (5 Nov)"). */
export function dueMinDay(ctx: PlanContext, plannedStart: Date): { minDay: number; reason: string } {
  return { minDay: dayIndex(plannedStart), reason: `Before this step starts (${dayMonthWords(dayOf(plannedStart), ctx.runStart.getUTCFullYear())})` }
}

/**
 * An explicit start on the very day the step it waits for is due, at an earlier hour —
 * allowed (it begins once that step is done), worth a soft note.
 */
export function startsBeforePredecessorDue(rule: StartRule, ctx: PlanContext, predDue: Date | null): boolean {
  if (!predDue || !isExplicitRule(rule)) return false
  const e = explicitOccurrence(rule, ctx)
  return dayIndex(e) === dayIndex(predDue) && e.getTime() < predDue.getTime()
}

/** An explicit due on the step's own start day, at or before its start hour — it moves to the next day. */
export function dueBeforeStartSameDay(rule: DueRule, ctx: PlanContext, plannedStart: Date): boolean {
  if (!isExplicitRule(rule)) return false
  const e = explicitOccurrence(rule, ctx)
  return dayIndex(e) === dayIndex(plannedStart) && e.getTime() <= plannedStart.getTime()
}
