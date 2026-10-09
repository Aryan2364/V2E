import { computeDueDeadline } from './deadline'
import { CalendarRule, DueRule, ExplicitRule, MonthDay, StartRule, isExplicitRule } from './timing'
import {
  LocalDate,
  addLocalDays,
  compareLocalDates,
  daysInMonth,
  localDateOf,
  parseTime,
  weekdayOf,
  zonedParts,
  zonedTimeToUtc,
} from './tz'

/**
 * Step timing resolution and run planning (workflow step timing spec). Pure — the
 * holiday rules come in as callbacks, so the engine (run creation, activation) and the
 * builder's example timeline run exactly this code.
 *
 * Frame: every wall-clock time is in the ORG's time zone. "Next occurrence on/after
 * an anchor" = the first matching day at `time` that is ≥ the anchor (the same day
 * counts while its time hasn't passed); "strictly after" excludes the anchor itself.
 *
 * Explicit cycles (a weekday / month_day / year_date rule with `cycle` — what the
 * builder's calendar writes): cycle 1 is the week (Monday–Sunday) / month / year
 * containing the run start, cycle 2 the next one, and so on. The rule resolves to that
 * exact day (`resolveExplicit`), never before the step may start — order wins: when
 * the steps before it finish later (the same day at a later hour, a holiday shift, a
 * run started by hand mid-cycle) it starts when they are done; it never jumps a cycle.
 *
 * Legacy rules (no `cycle`, and the cycle_* kinds) are inferred, as they always were:
 * cycle_* positions ("Week 2, Mon" every 2 weeks) count from the run's week / month /
 * year and repeat every `every` of them; the next one on/after the anchor wins. Day 31
 * (or "last") in a shorter month is that month's last day; 29 Feb in a non-leap year is
 * 28 Feb.
 */

export interface TimingContext {
  /** Org time zone. */
  tz: string
  /** The run's start instant (cycle 1 contains it; days_after_run_start counts from it). */
  runStart: Date
  /** The cycle length for cycle_* rules (the schedules' "every"); 1 otherwise. */
  every: number
}

function hm(time: string): { hour: number; minute: number } {
  return parseTime(time) ?? { hour: 9, minute: 0 }
}

function at(d: LocalDate, time: string, tz: string): Date {
  const t = hm(time)
  return zonedTimeToUtc(d, t.hour, t.minute, tz)
}

/** Monday of the (Monday–Sunday) week containing `d`. */
export function weekStartOf(d: LocalDate): LocalDate {
  return addLocalDays(d, -((weekdayOf(d) + 6) % 7))
}

function serialDays(d: LocalDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)
}

/** Day `day` (or the last day) of a month, clamped to the month's length. */
function monthDate(year: number, month: number, day: MonthDay): LocalDate {
  const dim = daysInMonth(year, month)
  return { year, month, day: day === 'last' ? dim : Math.min(day, dim) }
}

function fromMonthIndex(idx: number): { year: number; month: number } {
  return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1 }
}

/**
 * The candidate days of a calendar rule, in increasing order, starting at or before
 * the anchor's day (enough of them that one is always past the anchor).
 */
function candidateDays(rule: CalendarRule, anchorDay: LocalDate, ctx: TimingContext): LocalDate[] {
  const every = Math.max(1, Math.trunc(ctx.every) || 1)
  const runDay = localDateOf(ctx.runStart, ctx.tz)
  switch (rule.kind) {
    case 'time_of_day':
      return [anchorDay, addLocalDays(anchorDay, 1)]
    case 'weekday': {
      const out: LocalDate[] = []
      for (let i = 0; i <= 7; i++) {
        const d = addLocalDays(anchorDay, i)
        if (weekdayOf(d) === rule.weekday) out.push(d)
      }
      return out
    }
    case 'month_day': {
      const base = anchorDay.year * 12 + anchorDay.month - 1
      return [0, 1, 2].map((i) => {
        const { year, month } = fromMonthIndex(base + i)
        return monthDate(year, month, rule.day)
      })
    }
    case 'year_date':
      return [0, 1, 2].map((i) => monthDate(anchorDay.year + i, rule.month, rule.day))
    case 'cycle_weekday': {
      const base = weekStartOf(runDay)
      const position = 7 * (rule.cycle - 1) + ((rule.weekday + 6) % 7)
      const period = 7 * every
      const k0 = Math.max(0, Math.floor((serialDays(anchorDay) - serialDays(base) - position) / period))
      return [0, 1, 2].map((i) => addLocalDays(base, position + (k0 + i) * period))
    }
    case 'cycle_month_day': {
      const base = runDay.year * 12 + runDay.month - 1
      const anchorIdx = anchorDay.year * 12 + anchorDay.month - 1
      const position = rule.cycle - 1
      const k0 = Math.max(0, Math.floor((anchorIdx - base - position) / every))
      return [0, 1, 2].map((i) => {
        const { year, month } = fromMonthIndex(base + position + (k0 + i) * every)
        return monthDate(year, month, rule.day)
      })
    }
    case 'cycle_year_date': {
      const position = rule.cycle - 1
      const k0 = Math.max(0, Math.floor((anchorDay.year - runDay.year - position) / every))
      return [0, 1, 2].map((i) => monthDate(runDay.year + position + (k0 + i) * every, rule.month, rule.day))
    }
  }
}

/**
 * The next occurrence of a calendar rule on/after `anchor` (or strictly after, for a
 * due date "after the step's start"). Always returns an instant ≥ (or >) the anchor.
 */
export function nextCalendarOccurrence(rule: CalendarRule, anchor: Date, ctx: TimingContext, strict = false): Date {
  let day = localDateOf(anchor, ctx.tz)
  // A few passes always suffice (each candidate list spans more than one period); the
  // loop only guards against pathological inputs.
  for (let pass = 0; pass < 4; pass++) {
    let last: LocalDate | null = null
    for (const d of candidateDays(rule, day, ctx)) {
      last = d
      const t = at(d, rule.time, ctx.tz)
      if (strict ? t.getTime() > anchor.getTime() : t.getTime() >= anchor.getTime()) return t
    }
    day = last && compareLocalDates(last, day) > 0 ? addLocalDays(last, 1) : addLocalDays(day, 1)
  }
  // Unreachable for valid rules; never return something before the anchor.
  return new Date(anchor.getTime() + (strict ? 60_000 : 0))
}

/**
 * The day an explicit rule names, at its time: the run's own week / month / year plus
 * `cycle - 1` (plus `extra` more).
 */
export function explicitOccurrence(rule: ExplicitRule, ctx: TimingContext, extra = 0): Date {
  const runDay = localDateOf(ctx.runStart, ctx.tz)
  const off = Math.max(1, Math.trunc(rule.cycle)) - 1 + extra
  let d: LocalDate
  switch (rule.kind) {
    case 'weekday':
      d = addLocalDays(weekStartOf(runDay), 7 * off + ((rule.weekday + 6) % 7))
      break
    case 'month_day': {
      const { year, month } = fromMonthIndex(runDay.year * 12 + runDay.month - 1 + off)
      d = monthDate(year, month, rule.day)
      break
    }
    case 'year_date':
      d = monthDate(runDay.year + off, rule.month, rule.day)
      break
  }
  return at(d, rule.time, ctx.tz)
}

/**
 * Where an explicit rule lands given the anchor (the moment the step may start, or —
 * for a due date — the step's start). Its own day when that is on/after the anchor
 * (strictly after, for a due date). Otherwise order wins, and it never jumps a whole
 * cycle (a holiday that moves the step before by a day must not push this one a month):
 * a start begins with the anchor (once the steps before it are done); a due date is its
 * time on the start's day, or the next day when that has passed (never due before it
 * starts — as `computeDueDeadline`).
 */
export function resolveExplicit(rule: ExplicitRule, anchor: Date, ctx: TimingContext, strict: boolean): Date {
  const e = explicitOccurrence(rule, ctx)
  if (strict ? e.getTime() > anchor.getTime() : e.getTime() >= anchor.getTime()) return e
  if (!strict) return anchor
  const sameDay = at(localDateOf(anchor, ctx.tz), rule.time, ctx.tz)
  return sameDay.getTime() > anchor.getTime() ? sameDay : sameTimeNextDay(sameDay, ctx.tz)
}

/**
 * Where a start rule lands given the moment the step may start (`anchor`), BEFORE the
 * holiday shift. `immediate` → the anchor itself.
 *  - days_after_previous: anchor's day + N days, at time;
 *  - days_after_run_start: run start's day + N days at time, never before the anchor;
 *  - explicit day rules: that day (`resolveExplicit`);
 *  - time_of_day / legacy calendar kinds: the next occurrence on/after the anchor.
 */
export function resolveStart(rule: StartRule, anchor: Date, ctx: TimingContext): Date {
  switch (rule.kind) {
    case 'immediate':
      return anchor
    case 'days_after_previous':
      return at(addLocalDays(localDateOf(anchor, ctx.tz), rule.days), rule.time, ctx.tz)
    case 'days_after_run_start': {
      const t = at(addLocalDays(localDateOf(ctx.runStart, ctx.tz), rule.days), rule.time, ctx.tz)
      return t.getTime() >= anchor.getTime() ? t : anchor
    }
    default:
      return isExplicitRule(rule) ? resolveExplicit(rule, anchor, ctx, false) : nextCalendarOccurrence(rule, anchor, ctx, false)
  }
}

/**
 * The raw (pre-holiday) due instant for a step that starts at `start`: an explicit day
 * rule's own day (`resolveExplicit`); a legacy calendar rule's next occurrence strictly
 * after the start; a relative rule's start day + N days at time (`computeDueDeadline`,
 * which never makes a step due before it starts).
 */
export function resolveDue(rule: DueRule, start: Date, ctx: TimingContext): Date {
  if (rule.kind === 'days_after_start') return computeDueDeadline(start, rule.days, rule.time, ctx.tz)
  if (isExplicitRule(rule)) return resolveExplicit(rule, start, ctx, true)
  return nextCalendarOccurrence(rule, start, ctx, true)
}

/** The same wall-clock time on the next calendar day (org tz). */
export function sameTimeNextDay(instant: Date, tz: string): Date {
  const p = zonedParts(instant, tz)
  return zonedTimeToUtc(addLocalDays({ year: p.year, month: p.month, day: p.day }, 1), p.hour, p.minute, tz)
}

// ═══ Planning a run ══════════════════════════════════════════════════════════

export interface PlanStepInput {
  /** Identifies the step within the plan (template step id, or a builder key). */
  key: string
  /** Keys of the steps it starts after (unknown keys are ignored). */
  deps: string[]
  /** NULL = legacy (immediate). */
  start_rule: StartRule | null
  /** NULL = legacy (due_days after the start at due_time). */
  due_rule: DueRule | null
  due_days: number
  due_time: string
}

export interface PlannedStep {
  key: string
  planned_start_at: Date
  planned_due_at: Date
}

/** A "days after run start" step that lands before a predecessor is due (pushed later). */
export interface PlanWarning {
  key: string
  predecessor_key: string
}

export interface PlanCallbacks {
  /** Move a computed start off holidays / weekly offs (identity when omitted). */
  shiftStart?: (at: Date, key: string) => Date | Promise<Date>
  /** The deadline holiday adjustment (identity when omitted). */
  adjustDue?: (at: Date, key: string) => Date | Promise<Date>
}

/**
 * Steps in dependency order (Kahn, stable by input order). Steps caught in a loop
 * (which Save refuses) are appended in input order so planning never hangs.
 */
export function planOrder(steps: PlanStepInput[]): PlanStepInput[] {
  const keys = new Set(steps.map((s) => s.key))
  const depsOf = new Map(steps.map((s) => [s.key, [...new Set(s.deps.filter((d) => keys.has(d) && d !== s.key))]]))
  const done = new Set<string>()
  const out: PlanStepInput[] = []
  let progressed = true
  while (progressed && out.length < steps.length) {
    progressed = false
    for (const s of steps) {
      if (done.has(s.key)) continue
      if (depsOf.get(s.key)!.every((d) => done.has(d))) {
        done.add(s.key)
        out.push(s)
        progressed = true
      }
    }
  }
  for (const s of steps) if (!done.has(s.key)) out.push(s)
  return out
}

/**
 * Plan every step's start and due for a run starting at `ctx.runStart`, in dependency
 * order:
 *  - the anchor of a step's planned start = the run start for a step with no
 *    predecessors, else the LATEST planned due of its predecessors;
 *  - the start rule resolves against that anchor (`resolveStart`); a computed start
 *    (any kind but `immediate`) is moved off holidays / weekly offs;
 *  - the due resolves against the planned start (`resolveDue`) and goes through the
 *    deadline holiday adjustment.
 * A warning is raised for a step timed "N days after the run start" that lands before
 * a predecessor's planned due (so it was pushed to a later time).
 */
export async function planRun(
  steps: PlanStepInput[],
  ctx: TimingContext,
  callbacks: PlanCallbacks = {},
): Promise<{ steps: PlannedStep[]; warnings: PlanWarning[] }> {
  const shift = callbacks.shiftStart ?? ((d: Date) => d)
  const adjust = callbacks.adjustDue ?? ((d: Date) => d)
  const planned = new Map<string, PlannedStep>()
  const warnings: PlanWarning[] = []

  for (const s of planOrder(steps)) {
    const preds = s.deps.map((d) => planned.get(d)).filter((x): x is PlannedStep => !!x && x.key !== s.key)
    let anchor = ctx.runStart
    let latest: PlannedStep | null = null
    for (const p of preds) {
      if (!latest || p.planned_due_at.getTime() > latest.planned_due_at.getTime()) latest = p
    }
    if (latest && latest.planned_due_at.getTime() > anchor.getTime()) anchor = latest.planned_due_at

    const rule = s.start_rule ?? { kind: 'immediate' as const }
    let start = resolveStart(rule, anchor, ctx)
    if (rule.kind !== 'immediate') start = await shift(start, s.key)

    // A calendar day before the predecessor is due is no warning: it simply lands in the
    // next cycle, which the builder labels ("1st (next month)").
    if (latest && rule.kind === 'days_after_run_start') {
      const naive = resolveStart(rule, ctx.runStart, ctx)
      if (naive.getTime() < latest.planned_due_at.getTime()) warnings.push({ key: s.key, predecessor_key: latest.key })
    }

    const dueRule: DueRule = s.due_rule ?? { kind: 'days_after_start', days: s.due_days, time: s.due_time }
    const due = await adjust(resolveDue(dueRule, start, ctx), s.key)
    planned.set(s.key, { key: s.key, planned_start_at: start, planned_due_at: due })
  }
  return { steps: steps.map((s) => planned.get(s.key)!), warnings }
}

// ═══ The sample run: order of explicit days ══════════════════════════════════

/**
 * The sample run's timing context in a FLOATING frame (time zone 'UTC', so instants'
 * UTC fields are the org's wall clock) — exactly the frame the builder plans in, so
 * both sides find the same days. `day` from `sampleRunDay`, at the run start time.
 */
export function sampleRunContext(day: LocalDate, time: string, every: number): TimingContext {
  const t = hm(time)
  return { tz: 'UTC', runStart: new Date(Date.UTC(day.year, day.month - 1, day.day, t.hour, t.minute)), every }
}

/** An explicit day that comes before what it waits for (see `orderProblems`). */
export interface OrderProblem {
  key: string
  part: 'start' | 'due'
  /** The day it may not be before: the step-before's due day, or its own start day. */
  day: LocalDate
  /** For a start: the step it waits for that is due last. */
  predecessor_key: string | null
}

/**
 * Explicit days that fall before what they wait for in a planned run (the sample run,
 * planned without holidays): a later step's start day before the LATEST planned due
 * day of the steps it waits for, or a due day before the step's own planned start day.
 * The same day is fine — the step starts once the one before is done, later that day.
 * Legacy (inferred) rules never count: they move to the next cycle by themselves. First
 * steps' starts are checked by the run-start rule instead.
 */
export function orderProblems(steps: PlanStepInput[], planned: PlannedStep[], ctx: TimingContext): OrderProblem[] {
  const byKey = new Map(planned.map((p) => [p.key, p]))
  const out: OrderProblem[] = []
  for (const s of planOrder(steps)) {
    const me = byKey.get(s.key)
    if (!me) continue
    let latest: PlannedStep | null = null
    for (const d of s.deps) {
      const p = byKey.get(d)
      if (p && p.key !== s.key && (!latest || p.planned_due_at.getTime() > latest.planned_due_at.getTime())) latest = p
    }
    if (latest && isExplicitRule(s.start_rule)) {
      const day = localDateOf(explicitOccurrence(s.start_rule, ctx), ctx.tz)
      const due = localDateOf(latest.planned_due_at, ctx.tz)
      if (compareLocalDates(day, due) < 0) {
        out.push({ key: s.key, part: 'start', day: due, predecessor_key: latest.key })
        continue
      }
    }
    if (isExplicitRule(s.due_rule)) {
      const day = localDateOf(explicitOccurrence(s.due_rule, ctx), ctx.tz)
      const start = localDateOf(me.planned_start_at, ctx.tz)
      if (compareLocalDates(day, start) < 0) out.push({ key: s.key, part: 'due', day: start, predecessor_key: null })
    }
  }
  return out
}
