// Unit tests for the builder's step-timing logic: first-step checks (the server's exact
// words), the "(next month)" labelling and the card summaries.
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DueRule, StartRule } from '@/lib/types/workflows'
import {
  LATER_STEP_TRIGGER_PROBLEM,
  calendarKindFor,
  cleanRule,
  dayBeforeRunStart,
  dueKindsFor,
  dueRuleOfKind,
  frequencyOf,
  maxCycleOf,
  runStartOf,
  sampleRunDay,
  startKindsFor,
  startRuleOfKind,
  timingProblems,
  timingSummary,
  type Frequency,
  type RunStart,
  type ScheduleShape,
} from '../timing'
import {
  anchorFor,
  calendarOccurrence,
  calendarSpans,
  cycleOfDay,
  dayNumber,
  dueBeforeStartSameDay,
  dueMinDay,
  eventsOn,
  explicitOccurrence,
  latestPredecessor,
  nextCycleFlagsFor,
  orderProblemsFor,
  planContext,
  planSteps,
  ruleDay,
  startMinDay,
  startsBeforePredecessorDue,
  stepNextCycle,
  type PlanStep,
} from '../timingPlan'

const monthly = (month_days: number[], time = '09:00'): ScheduleShape => ({ schedule_type: 'monthly', every: 1, month_days, time })
const at = (time = '09:00') => ({ time })
const md = (day: number | 'last', time = '09:00'): StartRule => ({ kind: 'month_day', day, ...at(time) })
const mdDue = (day: number | 'last', time = '18:00'): DueRule => ({ kind: 'month_day', day, ...at(time) })
const IMMEDIATE: StartRule = { kind: 'immediate' }
const DUE_1: DueRule = { kind: 'days_after_start', days: 1, time: '18:00' }

function setup(schedules: ScheduleShape[]) {
  const f = frequencyOf(schedules)
  const rs = runStartOf(schedules, f)
  return { f, rs, ctx: planContext(f, rs) }
}

describe('first steps: on or after the run start (the server’s words)', () => {
  it('monthly on the 3rd: the 1st and 2nd are refused for the start and the due; the 3rd is fine', () => {
    const { f, rs } = setup([monthly([3])])
    const first = { first: true, runStart: rs }
    assert.deepEqual(timingProblems(md(1), DUE_1, f, first), [
      { part: 'start', message: 'pick a day on or after the 3rd, when the instance starts.' },
    ])
    assert.deepEqual(timingProblems(IMMEDIATE, mdDue(2), f, first), [
      { part: 'due', message: 'pick a day on or after the 3rd, when the instance starts.' },
    ])
    assert.deepEqual(timingProblems(md(3), mdDue(20), f, first), [])
    assert.deepEqual(timingProblems(md(3, '08:00'), DUE_1, f, first), [
      { part: 'start', message: 'pick a time at or after 9:00 AM on the 3rd, when the instance starts.' },
    ])
    // Later steps may use any day.
    assert.deepEqual(timingProblems(md(1), DUE_1, f, { first: false, runStart: rs }), [])
  })

  it('weekly, yearly, daily and cycles use their own words', () => {
    const weekly = setup([{ schedule_type: 'weekly', every: 1, days: [3], time: '09:00' }])
    assert.equal(
      timingProblems({ kind: 'weekday', weekday: 1, time: '09:00' }, DUE_1, weekly.f, { first: true, runStart: weekly.rs })[0]?.message,
      'pick a day on or after Wednesday, when the instance starts.',
    )
    const yearly = setup([{ schedule_type: 'yearly', every: 1, yearly_dates: [{ month: 4, day: 1 }], time: '09:00' }])
    assert.equal(
      timingProblems({ kind: 'year_date', month: 3, day: 1, time: '09:00' }, DUE_1, yearly.f, { first: true, runStart: yearly.rs })[0]?.message,
      'pick a date on or after 1 Apr, when the instance starts.',
    )
    const daily = setup([{ schedule_type: 'daily', every: 1, time: '09:00' }])
    assert.equal(
      timingProblems(IMMEDIATE, { kind: 'time_of_day', time: '08:00' }, daily.f, { first: true, runStart: daily.rs })[0]?.message,
      'pick a time at or after 9:00 AM, when the instance starts.',
    )
    const cycle = setup([{ schedule_type: 'weekly', every: 2, days: [3], time: '09:00' }])
    const place = { first: true, runStart: cycle.rs }
    assert.equal(
      timingProblems({ kind: 'cycle_weekday', cycle: 1, weekday: 1, time: '09:00' }, DUE_1, cycle.f, place)[0]?.message,
      'pick a day on or after Wednesday in Week 1, when the instance starts.',
    )
    assert.deepEqual(timingProblems({ kind: 'cycle_weekday', cycle: 2, weekday: 1, time: '09:00' }, DUE_1, cycle.f, place), [])
  })

  it('several trigger days: the latest one counts (monthly on the 3rd and the 20th)', () => {
    const { f, rs } = setup([monthly([3, 20])])
    assert.deepEqual(rs, { type: 'monthly', every: 1, day: 20, time: '09:00' })
    assert.equal(timingProblems(md(10), DUE_1, f, { first: true, runStart: rs })[0]?.message, 'pick a day on or after the 20th, when the instance starts.')
  })

  it('greys out the days before the run start (Cycle 1 only)', () => {
    const rs: RunStart = { type: 'monthly', every: 1, day: 3, time: '09:00' }
    assert.equal(dayBeforeRunStart(rs, { day: 2 }), true)
    assert.equal(dayBeforeRunStart(rs, { day: 3 }), false)
    assert.equal(dayBeforeRunStart(rs, { day: 'last' }), false)
    const weeks: RunStart = { type: 'weekly', every: 2, weekday: 3, time: '09:00' }
    assert.equal(dayBeforeRunStart(weeks, { weekday: 1, cycle: 1 }), true)
    assert.equal(dayBeforeRunStart(weeks, { weekday: 1, cycle: 2 }), false)
    assert.equal(dayBeforeRunStart(weeks, { weekday: 0, cycle: 1 }), false) // Sunday ends the week
  })

  it('“Days after workflow is triggered” is offered to first steps only; a later step with it is flagged', () => {
    const f: Frequency = { type: 'monthly', every: 1 }
    assert.deepEqual(startKindsFor(f, false), ['immediate', 'days_after_run_start', 'month_day'])
    assert.deepEqual(startKindsFor(f, true), ['immediate', 'days_after_previous', 'month_day'])
    const trigger: StartRule = { kind: 'days_after_run_start', days: 2, time: '09:00' }
    assert.deepEqual(timingProblems(trigger, DUE_1, f, { first: false, runStart: null }), [{ part: 'start', message: LATER_STEP_TRIGGER_PROBLEM }])
    assert.equal(LATER_STEP_TRIGGER_PROBLEM, '“Days after workflow is triggered” is only for the first step — pick another start.')
    assert.deepEqual(timingProblems(trigger, DUE_1, f, { first: true, runStart: null }), [])
  })
})

describe('“(next month)”: a day before the previous step’s dates lands in the next cycle', () => {
  it('monthly: step 2 on the 1st after step 1 is due on the 20th → next month; the 25th → same month', () => {
    const { f, ctx } = setup([monthly([3])])
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: md(3), due: mdDue(20) },
      { id: 'b', deps: ['a'], start: md(1), due: mdDue(4) },
      { id: 'c', deps: ['a'], start: md(25), due: mdDue(28) },
    ]
    const flags = nextCycleFlagsFor(steps, ctx)
    assert.deepEqual(flags.get('a'), { start: false, due: false })
    assert.deepEqual(flags.get('b'), { start: true, due: false }) // 1st (next month), due 4th after it
    assert.deepEqual(flags.get('c'), { start: false, due: false })
    assert.equal(
      timingSummary(md(1), mdDue(4), f, true, flags.get('b')),
      'Starts 1st of next month, 9:00 AM · due 4th 6:00 PM',
    )
  })

  it('a due day before the step’s own start → next month ("Due 1st of next month")', () => {
    const { f, ctx } = setup([monthly([3])])
    const planned = planSteps([{ id: 'a', deps: [], start: md(10), due: mdDue(1) }], ctx)
    const flags = stepNextCycle(md(10), mdDue(1), anchorFor([], planned, ctx), ctx)
    assert.equal(flags.start, false)
    assert.equal(flags.due, true)
    assert.equal(timingSummary(IMMEDIATE, mdDue(1), f, false, { start: false, due: true }), 'Due 1st of next month, 6:00 PM')
  })

  it('joins use the LATEST predecessor', () => {
    const { ctx } = setup([monthly([3])])
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: md(3), due: mdDue(10) },
      { id: 'b', deps: [], start: md(3), due: mdDue(25) },
      { id: 'c', deps: ['a', 'b'], start: md(15), due: mdDue(18) },
    ]
    assert.deepEqual(nextCycleFlagsFor(steps, ctx).get('c'), { start: true, due: false })
  })

  it('weekly: Mon after a step due Fri → next week; yearly: 5 Jun after 21 Dec → next year', () => {
    const weekly = setup([{ schedule_type: 'weekly', every: 1, days: [3], time: '09:00' }])
    const w = nextCycleFlagsFor(
      [
        { id: 'a', deps: [], start: { kind: 'weekday', weekday: 4, time: '09:00' }, due: { kind: 'weekday', weekday: 5, time: '18:00' } },
        { id: 'b', deps: ['a'], start: { kind: 'weekday', weekday: 1, time: '09:00' }, due: DUE_1 },
      ],
      weekly.ctx,
    )
    assert.deepEqual(w.get('b'), { start: true, due: false })
    assert.equal(
      timingSummary({ kind: 'weekday', weekday: 1, time: '09:00' }, DUE_1, weekly.f, true, w.get('b')),
      'Starts Mon next week, 9:00 AM · due in 1 day, 6:00 PM',
    )

    const yearly = setup([{ schedule_type: 'yearly', every: 1, yearly_dates: [{ month: 4, day: 1 }], time: '09:00' }])
    const y = nextCycleFlagsFor(
      [
        { id: 'a', deps: [], start: { kind: 'year_date', month: 12, day: 3, time: '09:00' }, due: { kind: 'year_date', month: 12, day: 21, time: '18:00' } },
        { id: 'b', deps: ['a'], start: { kind: 'year_date', month: 6, day: 5, time: '09:00' }, due: { kind: 'year_date', month: 6, day: 30, time: '18:00' } },
      ],
      yearly.ctx,
    )
    assert.deepEqual(y.get('b'), { start: true, due: false })
  })

  it('cycles (every 2 weeks): Week 1 Mon after a step due in Week 2 → next cycle; Week 2 Sat → same cycle', () => {
    const { ctx } = setup([{ schedule_type: 'weekly', every: 2, days: [3], time: '09:00' }])
    const a: PlanStep = {
      id: 'a',
      deps: [],
      start: { kind: 'cycle_weekday', cycle: 1, weekday: 4, time: '09:00' },
      due: { kind: 'cycle_weekday', cycle: 2, weekday: 5, time: '18:00' },
    }
    const planned = planSteps([a], ctx)
    const anchor = anchorFor(['a'], planned, ctx)
    assert.equal(calendarOccurrence({ kind: 'cycle_weekday', cycle: 1, weekday: 1, time: '09:00' }, anchor, ctx, false).next, true)
    assert.equal(calendarOccurrence({ kind: 'cycle_weekday', cycle: 2, weekday: 6, time: '09:00' }, anchor, ctx, false).next, false)
  })

  it('a day equal to the previous due counts by the time; a month end clamps', () => {
    const { ctx } = setup([monthly([3])])
    const planned = planSteps([{ id: 'a', deps: [], start: md(3), due: mdDue(20, '18:00') }], ctx)
    const anchor = anchorFor(['a'], planned, ctx)
    assert.equal(calendarOccurrence(md(20, '09:00'), anchor, ctx, false).next, true)
    assert.equal(calendarOccurrence(md(20, '18:00'), anchor, ctx, false).next, false)
    assert.equal(calendarOccurrence(md('last'), anchor, ctx, false).next, false)
  })
})

// ─── Explicit cycles: the timing calendar ────────────────────────────────────

/** Floating wall clock (UTC fields = the org's wall clock). */
const wall = (y: number, m: number, d: number, h = 9, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi))
const iso = (d: Date | undefined) => d?.toISOString()
const emd = (cycle: number, day: number | 'last', time = '09:00'): StartRule => ({ kind: 'month_day', cycle, day, time })
const emdDue = (cycle: number, day: number | 'last', time = '18:00'): DueRule => ({ kind: 'month_day', cycle, day, time })

/** Monthly on the 3rd from 1 Jan 2026; today Fri 9 Oct 2026 10:00 → the sample run is Tue 3 Nov 2026, 9:00. */
function sample(schedules: ScheduleShape[] = [{ ...monthly([3]), start_date: '2026-01-01' }]) {
  const f = frequencyOf(schedules)
  const rs = runStartOf(schedules, f)
  return { f, rs, ctx: planContext(f, rs, { schedules, now: new Date(2026, 9, 9, 10, 0) }) }
}

describe('the sample run (the server’s sampleRunDay, exactly)', () => {
  it('the next trigger day from today; today only before the run time; the latest trigger day; every N in step', () => {
    const s = [{ ...monthly([3]), start_date: '2026-01-01' }]
    const rs = runStartOf(s, frequencyOf(s))!
    assert.deepEqual(sampleRunDay(s, rs, { year: 2026, month: 10, day: 9 }, 600), { year: 2026, month: 11, day: 3 })
    assert.deepEqual(sampleRunDay(s, rs, { year: 2026, month: 11, day: 3 }, 8 * 60), { year: 2026, month: 11, day: 3 })
    assert.deepEqual(sampleRunDay(s, rs, { year: 2026, month: 11, day: 3 }, 9 * 60), { year: 2026, month: 12, day: 3 })
    const two = [{ ...monthly([3, 20]), start_date: '2026-01-01' }]
    assert.deepEqual(sampleRunDay(two, runStartOf(two, frequencyOf(two))!, { year: 2026, month: 10, day: 9 }, 0), { year: 2026, month: 10, day: 20 })
    const every2: ScheduleShape[] = [{ ...monthly([3]), every: 2, start_date: '2026-01-01' }]
    assert.deepEqual(sampleRunDay(every2, runStartOf(every2, frequencyOf(every2))!, { year: 2026, month: 10, day: 9 }, 0), {
      year: 2026,
      month: 11,
      day: 3,
    })
    const later = [{ ...monthly([3]), start_date: '2027-02-10' }]
    assert.deepEqual(sampleRunDay(later, rs, { year: 2026, month: 10, day: 9 }, 0), { year: 2027, month: 3, day: 3 })
  })

  it('planContext with the schedules and now starts the plan on the sample run', () => {
    assert.equal(iso(sample().ctx.runStart), iso(wall(2026, 11, 3, 9)))
  })
})

describe('explicit cycles: picked days plan exactly; order still wins', () => {
  it('cycle 1 = the run’s own week / month / year; a day picked in Month 2 stays in Month 2', () => {
    const { ctx } = sample()
    assert.equal(iso(explicitOccurrence(emd(1, 5), ctx)), iso(wall(2026, 11, 5)))
    assert.equal(iso(explicitOccurrence(emd(2, 1), ctx)), iso(wall(2026, 12, 1)))
    assert.equal(iso(explicitOccurrence(emd(4, 31), ctx)), iso(wall(2027, 2, 28)))
    assert.equal(iso(explicitOccurrence(emd(2, 'last'), ctx)), iso(wall(2026, 12, 31)))
    assert.equal(iso(explicitOccurrence({ kind: 'weekday', cycle: 1, weekday: 1, time: '09:00' }, ctx)), iso(wall(2026, 11, 2)))
    assert.equal(iso(explicitOccurrence({ kind: 'year_date', cycle: 2, month: 6, day: 5, time: '09:00' }, ctx)), iso(wall(2027, 6, 5)))
    assert.equal(cycleOfDay('month_day', dayNumber(wall(2026, 12, 1)), ctx), 2)
    assert.equal(cycleOfDay('weekday', dayNumber(wall(2026, 11, 9)), ctx), 2)
    assert.equal(cycleOfDay('year_date', dayNumber(wall(2027, 6, 5)), ctx), 2)
  })

  it('Step 1 3rd → 5th; Step 2 on the 5th (same day) begins once step 1 is done → due next month’s 1st', () => {
    const { ctx } = sample()
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: emd(1, 3), due: emdDue(1, 5) },
      { id: 'b', deps: ['a'], start: emd(1, 5), due: emdDue(2, 1) },
    ]
    const planned = planSteps(steps, ctx)
    assert.equal(iso(planned.get('a')?.start), iso(wall(2026, 11, 3, 9)))
    assert.equal(iso(planned.get('a')?.due), iso(wall(2026, 11, 5, 18)))
    assert.equal(iso(planned.get('b')?.start), iso(wall(2026, 11, 5, 18)))
    assert.equal(iso(planned.get('b')?.due), iso(wall(2026, 12, 1, 18)))
    // The soft note: same day, earlier hour than step 1 is due.
    assert.equal(startsBeforePredecessorDue(emd(1, 5), ctx, planned.get('a')!.due), true)
    assert.equal(startsBeforePredecessorDue(emd(1, 5, '19:00'), ctx, planned.get('a')!.due), false)
    assert.equal(startsBeforePredecessorDue(emd(2, 1), ctx, planned.get('a')!.due), false)
    assert.equal(startsBeforePredecessorDue({ kind: 'month_day', day: 5, time: '09:00' }, ctx, planned.get('a')!.due), false) // legacy
    // No order problem: the same day is fine.
    assert.equal(orderProblemsFor(steps, [], planned, ctx).size, 0)
  })

  it('order wins without jumping a cycle: when the step before finishes later, it just waits (the engine’s rule)', () => {
    const { ctx } = sample()
    // Step 1 due on the 10th (later than step 2's own 5th): step 2 starts then, not next month.
    const planned = planSteps(
      [
        { id: 'a', deps: [], start: emd(1, 3), due: emdDue(1, 10) },
        { id: 'b', deps: ['a'], start: emd(1, 5), due: emdDue(1, 6, '08:00') },
      ],
      ctx,
    )
    assert.equal(iso(planned.get('b')?.start), iso(wall(2026, 11, 10, 18)))
    assert.equal(iso(planned.get('b')?.due), iso(wall(2026, 11, 11, 8)))
  })

  it('greying: a first step from the run start; a later step from the day the step it waits for is due; a due from its own start', () => {
    const { ctx } = sample()
    assert.deepEqual(startMinDay(ctx, null, 'Before the run starts (3rd)'), { minDay: dayNumber(wall(2026, 11, 3)), reason: 'Before the run starts (3rd)' })
    assert.deepEqual(startMinDay(ctx, { name: '1 “Collect documents”', due: wall(2026, 11, 5, 18) }, 'x'), {
      minDay: dayNumber(wall(2026, 11, 5)),
      reason: 'Before 1 “Collect documents” is due',
    })
    assert.deepEqual(dueMinDay(ctx, wall(2026, 11, 5, 18)), { minDay: dayNumber(wall(2026, 11, 5)), reason: 'Before this step starts (5 Nov)' })
    assert.equal(dueBeforeStartSameDay(emdDue(1, 5, '17:00'), ctx, wall(2026, 11, 5, 18)), true)
    assert.equal(dueBeforeStartSameDay(emdDue(1, 5, '19:00'), ctx, wall(2026, 11, 5, 18)), false)
  })

  it('Save’s order check, in the server’s words: before the due day is refused; the latest step-before counts', () => {
    const { ctx } = sample()
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: emd(1, 3), due: emdDue(1, 5) },
      { id: 'x', deps: [], start: emd(1, 3), due: emdDue(1, 12) },
      { id: 'b', deps: ['a'], start: emd(1, 4), due: DUE_1 },
      { id: 'j', deps: ['a', 'x'], start: emd(1, 10), due: DUE_1 },
      { id: 'd', deps: ['a'], start: emd(1, 8), due: emdDue(1, 7) },
      { id: 'l', deps: ['a'], start: md(1), due: DUE_1 }, // legacy: rolls to next month, never refused
    ]
    const names = [
      { id: 'a', label: '1', title: 'Collect documents' },
      { id: 'x', label: 'B1', title: 'Budget check' },
      { id: 'b', label: '2', title: 'Review' },
    ]
    const order = orderProblemsFor(steps, names, planSteps(steps, ctx), ctx)
    assert.deepEqual(order.get('b'), { part: 'start', message: 'pick a day on or after 5 Nov, when 1 “Collect documents” is due.' })
    assert.deepEqual(order.get('j'), { part: 'start', message: 'pick a day on or after 12 Nov, when B1 “Budget check” is due.' })
    assert.deepEqual(order.get('d'), { part: 'due', message: 'pick a due day on or after 8 Nov, when it starts.' })
    assert.equal(order.has('l'), false)
    assert.equal(order.has('a'), false)
  })

  it('the calendar: other steps as bands (the ones it waits for marked), what each day holds', () => {
    const { ctx } = sample()
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: emd(1, 3), due: emdDue(1, 5) },
      { id: 'x', deps: [], start: emd(1, 4), due: emdDue(1, 5, '12:00') },
      { id: 'b', deps: ['a'], start: emd(1, 5), due: emdDue(2, 1) },
    ]
    const planned = planSteps(steps, ctx)
    const names = [
      { id: 'a', label: '1', title: 'Collect documents' },
      { id: 'x', label: 'B1', title: 'Budget check' },
      { id: 'b', label: '2', title: 'Review' },
    ]
    const spans = calendarSpans(names, planned, 'b', ['a'])
    assert.deepEqual(
      spans.map((s) => [s.id, s.color, s.waitsFor]),
      [
        ['a', 0, true],
        ['x', 1, false],
      ],
    )
    assert.deepEqual(latestPredecessor(['a'], planned, 'b')?.id, 'a')
    const on5th = eventsOn(dayNumber(wall(2026, 11, 5)), spans, ctx.runStart)
    assert.deepEqual(
      on5th.map((e) => [e.span?.id, e.what]),
      [
        ['x', 'due'],
        ['a', 'due'],
      ],
    )
    const on3rd = eventsOn(dayNumber(wall(2026, 11, 3)), spans, ctx.runStart)
    assert.deepEqual(
      on3rd.map((e) => [e.span?.id ?? 'run', e.what]),
      [
        ['run', 'run'],
        ['a', 'start'],
      ],
    )
    assert.deepEqual(
      eventsOn(dayNumber(wall(2026, 11, 4)), spans, ctx.runStart).map((e) => [e.span?.id, e.what]),
      [
        ['x', 'start'],
        ['a', 'ongoing'],
      ],
    )
    // The selected day of a rule: an explicit one its own day; a legacy one where it is planned.
    assert.equal(ruleDay(emd(2, 1), ctx.runStart, ctx, false), dayNumber(wall(2026, 12, 1)))
    assert.equal(ruleDay(md(1), wall(2026, 11, 5, 18), ctx, false), dayNumber(wall(2026, 12, 1)))
  })
})

describe('explicit cycles: rules, words and back-compat', () => {
  it('every 2+ uses the day kinds with a cycle (the legacy cycle_* kinds stay valid); limits', () => {
    const f2: Frequency = { type: 'monthly', every: 2 }
    assert.equal(calendarKindFor(f2), 'month_day')
    assert.deepEqual(startKindsFor(f2, true), ['immediate', 'days_after_previous', 'month_day'])
    assert.deepEqual(dueKindsFor(f2), ['days_after_start', 'month_day'])
    assert.deepEqual(timingProblems(emd(3, 5), DUE_1, f2), [])
    assert.deepEqual(timingProblems({ kind: 'cycle_month_day', cycle: 2, day: 5, time: '09:00' }, DUE_1, f2), [])
    assert.equal(
      timingProblems(md(5), DUE_1, f2)[0]?.message,
      'the workflow repeats every 2 months. Choose “Day in 2-month cycle” or a “Days after” option.',
    )
    const f1: Frequency = { type: 'monthly', every: 1 }
    assert.equal(maxCycleOf(f1), 12)
    assert.equal(maxCycleOf({ type: 'weekly', every: 1 }), 8)
    assert.equal(maxCycleOf({ type: 'yearly', every: 1 }), 3)
    assert.deepEqual(timingProblems(emd(13, 5), DUE_1, f1), [{ part: 'start', message: 'choose Month 1 to Month 12 for the start.' }])
    assert.deepEqual(timingProblems(IMMEDIATE, { kind: 'weekday', cycle: 9, weekday: 1, time: '18:00' }, { type: 'weekly', every: 1 }), [
      { part: 'due', message: 'choose Week 1 to Week 8 for the due date.' },
    ])
    // First steps: Month 1 before the run start is refused (same words as before); Month 2 is fine.
    const { rs } = setup([monthly([3])])
    assert.deepEqual(timingProblems(emd(1, 1), DUE_1, f1, { first: true, runStart: rs }), [
      { part: 'start', message: 'pick a day on or after the 3rd, when the instance starts.' },
    ])
    assert.deepEqual(timingProblems(emd(2, 1), DUE_1, f1, { first: true, runStart: rs }), [])
  })

  it('a new day rule starts where the step may start (the seed); a due of the same kind defaults to the start’s day', () => {
    const schedules = [monthly([3])]
    const seed = { cycle: 2, weekday: 2, day: 1, month: 12 }
    assert.deepEqual(startRuleOfKind('month_day', IMMEDIATE, schedules, seed), { kind: 'month_day', cycle: 2, day: 1, time: '09:00' })
    assert.deepEqual(startRuleOfKind('month_day', IMMEDIATE, schedules), { kind: 'month_day', cycle: 1, day: 3, time: '09:00' })
    assert.deepEqual(dueRuleOfKind('month_day', DUE_1, schedules, emd(2, 4)), { kind: 'month_day', cycle: 2, day: 4, time: '18:00' })
    assert.deepEqual(cleanRule({ kind: 'month_day', cycle: 2, day: 4, time: '18:00', days: 3 }), { kind: 'month_day', cycle: 2, day: 4, time: '18:00' })
  })

  it('summaries say the explicit cycle: Month 1 plain, Month 2 “of next month”, further “Month 3”; every 2+ “Month 2, 5th”', () => {
    const f1: Frequency = { type: 'monthly', every: 1 }
    assert.equal(timingSummary(emd(1, 5), emdDue(2, 1), f1, true), 'Starts 5th 9:00 AM · due 1st of next month, 6:00 PM')
    assert.equal(timingSummary(emd(3, 5), DUE_1, f1, true), 'Starts Month 3, 5th, 9:00 AM · due in 1 day, 6:00 PM')
    assert.equal(
      timingSummary({ kind: 'weekday', cycle: 2, weekday: 1, time: '09:00' }, DUE_1, { type: 'weekly', every: 1 }, true),
      'Starts Mon next week, 9:00 AM · due in 1 day, 6:00 PM',
    )
    assert.equal(timingSummary(emd(2, 5), DUE_1, { type: 'monthly', every: 2 }, true), 'Starts Month 2, 5th, 9:00 AM · due in 1 day, 6:00 PM')
  })

  it('back-compat: rules saved without a cycle still read “(next month)” from where they are planned; flags never touch explicit ones', () => {
    const { ctx } = setup([monthly([3])])
    const steps: PlanStep[] = [
      { id: 'a', deps: [], start: md(3), due: mdDue(20) },
      { id: 'b', deps: ['a'], start: md(1), due: mdDue(4) },
      { id: 'c', deps: ['a'], start: emd(2, 1), due: emdDue(2, 4) },
    ]
    const flags = nextCycleFlagsFor(steps, ctx)
    assert.deepEqual(flags.get('b'), { start: true, due: false })
    assert.deepEqual(flags.get('c'), { start: false, due: false })
    const planned = planSteps(steps, ctx)
    // The legacy step and the explicit one land on the same day here.
    assert.equal(iso(planned.get('b')?.start), iso(planned.get('c')?.start))
  })
})
