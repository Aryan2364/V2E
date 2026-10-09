// Where a step's calendar dates land relative to the step before it — for the "(next
// month)" labels in the timing pickers and the card summaries. A day that falls before
// the previous step's dates (or, for a due date, before the step's own start) resolves
// to the next cycle; the engine plans it there, and the builder says so.
//
// This is the engine's planning (backend engine/plan.ts) without the holiday shifts, run
// on one representative run that starts on the schedules' run start day. Dates are in a
// floating wall-clock frame: a Date whose UTC fields are the org's wall clock, so no time
// zone is involved. The exact dates of real runs are what the example run shows.

import type { DueRule, RuleMonthDay, StartRule } from '@/lib/types/workflows'
import {
  DEFAULT_DUE_RULE,
  DEFAULT_START_RULE,
  allowedDueKinds,
  allowedStartKinds,
  isCalendarKind,
  isCycleKind,
  minutesOf,
  timingProblems,
  weekPosition,
  type Frequency,
  type NextCycleFlags,
  type RunStart,
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

export function planContext(f: Frequency, rs: RunStart | null): PlanContext {
  const every = f.type === 'weekly' || f.type === 'monthly' || f.type === 'yearly' ? Math.max(1, f.every) : 1
  return { f, runStart: referenceRunStart(rs), every }
}

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
      return calendarOccurrence(rule, anchor, ctx, false).at
  }
}

/** When a step that starts at `start` is due (never at or before its start). */
export function resolveDue(rule: DueRule, start: Date, ctx: PlanContext): Date {
  if (rule.kind === 'days_after_start') {
    const t = minutesOf(rule.time)
    const due = fromDayIndex(dayIndex(start) + (rule.days ?? 1), t)
    return due.getTime() > start.getTime() ? due : fromDayIndex(dayIndex(start) + (rule.days ?? 1) + 1, t)
  }
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
  return {
    plannedStart,
    start: isCalendarKind(sr.kind) && sr === start ? calendarOccurrence(sr, anchor, ctx, false).next : false,
    due: isCalendarKind(dr.kind) && dr === due ? calendarOccurrence(dr, plannedStart, ctx, true).next : false,
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
