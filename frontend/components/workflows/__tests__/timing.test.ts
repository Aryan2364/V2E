// Unit tests for the builder's step-timing logic: first-step checks (the server's exact
// words), the "(next month)" labelling and the card summaries.
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DueRule, StartRule } from '@/lib/types/workflows'
import {
  LATER_STEP_TRIGGER_PROBLEM,
  dayBeforeRunStart,
  frequencyOf,
  runStartOf,
  startKindsFor,
  timingProblems,
  timingSummary,
  type Frequency,
  type RunStart,
  type ScheduleShape,
} from '../timing'
import { anchorFor, calendarOccurrence, nextCycleFlagsFor, planContext, planSteps, stepNextCycle, type PlanStep } from '../timingPlan'

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
      { part: 'start', message: 'pick a day on or after the 3rd, when the run starts.' },
    ])
    assert.deepEqual(timingProblems(IMMEDIATE, mdDue(2), f, first), [
      { part: 'due', message: 'pick a day on or after the 3rd, when the run starts.' },
    ])
    assert.deepEqual(timingProblems(md(3), mdDue(20), f, first), [])
    assert.deepEqual(timingProblems(md(3, '08:00'), DUE_1, f, first), [
      { part: 'start', message: 'pick a time at or after 9:00 AM on the 3rd, when the run starts.' },
    ])
    // Later steps may use any day.
    assert.deepEqual(timingProblems(md(1), DUE_1, f, { first: false, runStart: rs }), [])
  })

  it('weekly, yearly, daily and cycles use their own words', () => {
    const weekly = setup([{ schedule_type: 'weekly', every: 1, days: [3], time: '09:00' }])
    assert.equal(
      timingProblems({ kind: 'weekday', weekday: 1, time: '09:00' }, DUE_1, weekly.f, { first: true, runStart: weekly.rs })[0]?.message,
      'pick a day on or after Wednesday, when the run starts.',
    )
    const yearly = setup([{ schedule_type: 'yearly', every: 1, yearly_dates: [{ month: 4, day: 1 }], time: '09:00' }])
    assert.equal(
      timingProblems({ kind: 'year_date', month: 3, day: 1, time: '09:00' }, DUE_1, yearly.f, { first: true, runStart: yearly.rs })[0]?.message,
      'pick a date on or after 1 Apr, when the run starts.',
    )
    const daily = setup([{ schedule_type: 'daily', every: 1, time: '09:00' }])
    assert.equal(
      timingProblems(IMMEDIATE, { kind: 'time_of_day', time: '08:00' }, daily.f, { first: true, runStart: daily.rs })[0]?.message,
      'pick a time at or after 9:00 AM, when the run starts.',
    )
    const cycle = setup([{ schedule_type: 'weekly', every: 2, days: [3], time: '09:00' }])
    const place = { first: true, runStart: cycle.rs }
    assert.equal(
      timingProblems({ kind: 'cycle_weekday', cycle: 1, weekday: 1, time: '09:00' }, DUE_1, cycle.f, place)[0]?.message,
      'pick a day on or after Wednesday in Week 1, when the run starts.',
    )
    assert.deepEqual(timingProblems({ kind: 'cycle_weekday', cycle: 2, weekday: 1, time: '09:00' }, DUE_1, cycle.f, place), [])
  })

  it('several trigger days: the latest one counts (monthly on the 3rd and the 20th)', () => {
    const { f, rs } = setup([monthly([3, 20])])
    assert.deepEqual(rs, { type: 'monthly', every: 1, day: 20, time: '09:00' })
    assert.equal(timingProblems(md(10), DUE_1, f, { first: true, runStart: rs })[0]?.message, 'pick a day on or after the 20th, when the run starts.')
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
