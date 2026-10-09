import {
  PlanStepInput,
  TimingContext,
  nextCalendarOccurrence,
  planOrder,
  planRun,
  resolveDue,
  resolveStart,
  sameTimeNextDay,
  weekStartOf,
} from './plan'
import { CalendarRule, DueRule, StartRule } from './timing'
import { localDateOf, weekdayOf, zonedTimeToUtc } from './tz'

const IST = 'Asia/Kolkata'
/** That wall-clock moment in the org time zone (IST unless given). */
const at = (y: number, m: number, d: number, h = 9, mi = 0, tz = IST) => zonedTimeToUtc({ year: y, month: m, day: d }, h, mi, tz)
const ctx = (runStart: Date, every = 1, tz = IST): TimingContext => ({ tz, runStart, every })
const iso = (d: Date) => d.toISOString()

/** A plan step: `deps` are keys. Legacy defaults (immediate, due 1 day at 18:00). */
const step = (key: string, over: Partial<PlanStepInput> = {}): PlanStepInput => ({
  key,
  deps: [],
  start_rule: null,
  due_rule: null,
  due_days: 1,
  due_time: '18:00',
  ...over,
})
const startOn = (rule: StartRule) => ({ start_rule: rule })
const dueOn = (rule: DueRule) => ({ due_rule: rule })
/** Planned start/due of `key` as ISO strings. */
const of = (res: Awaited<ReturnType<typeof planRun>>, key: string) => {
  const s = res.steps.find((x) => x.key === key)!
  return [iso(s.planned_start_at), iso(s.planned_due_at)]
}

// 2026-10-07 is a Wednesday; 2026-10-01 a Thursday.
const WED_7_OCT_0900 = at(2026, 10, 7, 9)

describe('time zone frame', () => {
  it('a 09:00 rule is 09:00 in the org time zone (IST = UTC+5:30)', () => {
    const r = nextCalendarOccurrence({ kind: 'time_of_day', time: '09:00' }, at(2026, 10, 7, 8), ctx(WED_7_OCT_0900))
    expect(iso(r)).toBe('2026-10-07T03:30:00.000Z')
  })

  it('follows DST in zones that have it (New York, across the November change)', () => {
    const tz = 'America/New_York'
    const fri = at(2026, 10, 30, 12, 0, tz)
    const mon = nextCalendarOccurrence({ kind: 'weekday', weekday: 1, time: '09:00' }, fri, ctx(fri, 1, tz))
    expect(iso(mon)).toBe('2026-11-02T14:00:00.000Z') // EST (UTC-5)
    const thu = nextCalendarOccurrence({ kind: 'weekday', weekday: 4, time: '09:00' }, fri, ctx(fri, 1, tz))
    expect(iso(thu)).toBe('2026-11-05T14:00:00.000Z')
    const before = nextCalendarOccurrence({ kind: 'time_of_day', time: '09:00' }, at(2026, 10, 30, 8, 0, tz), ctx(fri, 1, tz))
    expect(iso(before)).toBe('2026-10-30T13:00:00.000Z') // EDT (UTC-4)
  })

  it('the calendar day is the org’s, not UTC’s (late evening IST is the next UTC day boundary)', () => {
    // 23:30 IST on Wed = 18:00Z Wed; "Thursday 09:00" is the next morning, not a week later.
    const lateWed = at(2026, 10, 7, 23, 30)
    expect(iso(nextCalendarOccurrence({ kind: 'weekday', weekday: 4, time: '09:00' }, lateWed, ctx(lateWed)))).toBe(
      iso(at(2026, 10, 8, 9)),
    )
    // 01:00 IST Thu = 19:30Z Wed: "Wednesday" means next week's Wednesday.
    const earlyThu = at(2026, 10, 8, 1)
    expect(iso(nextCalendarOccurrence({ kind: 'weekday', weekday: 3, time: '09:00' }, earlyThu, ctx(earlyThu)))).toBe(
      iso(at(2026, 10, 14, 9)),
    )
  })
})

describe('nextCalendarOccurrence — every kind', () => {
  const c = ctx(WED_7_OCT_0900)

  it('time_of_day: today if the time has not passed (the exact instant counts), else tomorrow', () => {
    const rule: CalendarRule = { kind: 'time_of_day', time: '14:00' }
    expect(iso(nextCalendarOccurrence(rule, at(2026, 10, 7, 9), c))).toBe(iso(at(2026, 10, 7, 14)))
    expect(iso(nextCalendarOccurrence(rule, at(2026, 10, 7, 14), c))).toBe(iso(at(2026, 10, 7, 14)))
    expect(iso(nextCalendarOccurrence(rule, at(2026, 10, 7, 14), c, true))).toBe(iso(at(2026, 10, 8, 14)))
    expect(iso(nextCalendarOccurrence(rule, at(2026, 10, 7, 15), c))).toBe(iso(at(2026, 10, 8, 14)))
  })

  it('weekday: the next such weekday; the same day counts until its time; strictly-after skips a week', () => {
    const thu: CalendarRule = { kind: 'weekday', weekday: 4, time: '09:00' }
    expect(iso(nextCalendarOccurrence(thu, at(2026, 10, 7, 9), c))).toBe(iso(at(2026, 10, 8, 9)))
    expect(iso(nextCalendarOccurrence(thu, at(2026, 10, 8, 8), c))).toBe(iso(at(2026, 10, 8, 9)))
    expect(iso(nextCalendarOccurrence(thu, at(2026, 10, 8, 9), c, true))).toBe(iso(at(2026, 10, 15, 9)))
    expect(iso(nextCalendarOccurrence(thu, at(2026, 10, 8, 10), c))).toBe(iso(at(2026, 10, 15, 9)))
    const sun: CalendarRule = { kind: 'weekday', weekday: 0, time: '09:00' }
    expect(iso(nextCalendarOccurrence(sun, at(2026, 10, 7, 9), c))).toBe(iso(at(2026, 10, 11, 9)))
  })

  it('month_day: this month if still ahead, else next month', () => {
    const fifth: CalendarRule = { kind: 'month_day', day: 5, time: '09:00' }
    expect(iso(nextCalendarOccurrence(fifth, at(2026, 10, 1, 9), c))).toBe(iso(at(2026, 10, 5, 9)))
    expect(iso(nextCalendarOccurrence(fifth, at(2026, 10, 5, 10), c))).toBe(iso(at(2026, 11, 5, 9)))
    expect(iso(nextCalendarOccurrence(fifth, at(2026, 12, 20, 9), c))).toBe(iso(at(2027, 1, 5, 9)))
  })

  it('month_day 31 in a shorter month is that month’s last day; “last” is always the last day', () => {
    const d31: CalendarRule = { kind: 'month_day', day: 31, time: '09:00' }
    expect(iso(nextCalendarOccurrence(d31, at(2026, 11, 2, 9), c))).toBe(iso(at(2026, 11, 30, 9)))
    expect(iso(nextCalendarOccurrence(d31, at(2027, 2, 1, 9), c))).toBe(iso(at(2027, 2, 28, 9)))
    expect(iso(nextCalendarOccurrence(d31, at(2026, 12, 2, 9), c))).toBe(iso(at(2026, 12, 31, 9)))
    const last: CalendarRule = { kind: 'month_day', day: 'last', time: '18:00' }
    expect(iso(nextCalendarOccurrence(last, at(2028, 2, 3, 9), c))).toBe(iso(at(2028, 2, 29, 18))) // leap year
    expect(iso(nextCalendarOccurrence(last, at(2027, 2, 3, 9), c))).toBe(iso(at(2027, 2, 28, 18)))
    expect(iso(nextCalendarOccurrence(last, at(2026, 4, 30, 19), c))).toBe(iso(at(2026, 5, 31, 18)))
    const d30: CalendarRule = { kind: 'month_day', day: 30, time: '09:00' }
    expect(iso(nextCalendarOccurrence(d30, at(2027, 2, 1, 9), c))).toBe(iso(at(2027, 2, 28, 9)))
  })

  it('year_date: this year if ahead, else next year; 29 Feb clamps to 28 Feb in a non-leap year', () => {
    const jun5: CalendarRule = { kind: 'year_date', month: 6, day: 5, time: '09:00' }
    expect(iso(nextCalendarOccurrence(jun5, at(2026, 3, 1, 9), c))).toBe(iso(at(2026, 6, 5, 9)))
    expect(iso(nextCalendarOccurrence(jun5, at(2026, 12, 21, 18), c))).toBe(iso(at(2027, 6, 5, 9)))
    const feb29: CalendarRule = { kind: 'year_date', month: 2, day: 29, time: '09:00' }
    expect(iso(nextCalendarOccurrence(feb29, at(2026, 10, 1, 9), c))).toBe(iso(at(2027, 2, 28, 9)))
    expect(iso(nextCalendarOccurrence(feb29, at(2027, 3, 1, 9), c))).toBe(iso(at(2028, 2, 29, 9)))
  })

  describe('cycles (cycle 1 = the week / month / year containing the run start)', () => {
    it('weeks run Monday–Sunday', () => {
      expect(weekStartOf({ year: 2026, month: 10, day: 7 })).toEqual({ year: 2026, month: 10, day: 5 })
      expect(weekStartOf({ year: 2026, month: 10, day: 11 })).toEqual({ year: 2026, month: 10, day: 5 }) // Sunday
      expect(weekStartOf({ year: 2026, month: 10, day: 12 })).toEqual({ year: 2026, month: 10, day: 12 })
    })

    it('cycle_weekday: “Week 1 Thu” and “Week 2 Mon” every 2 weeks from a Wednesday run', () => {
      const c2 = ctx(WED_7_OCT_0900, 2)
      const w1thu: CalendarRule = { kind: 'cycle_weekday', cycle: 1, weekday: 4, time: '09:00' }
      const w2mon: CalendarRule = { kind: 'cycle_weekday', cycle: 2, weekday: 1, time: '09:00' }
      expect(iso(nextCalendarOccurrence(w1thu, WED_7_OCT_0900, c2))).toBe(iso(at(2026, 10, 8, 9)))
      expect(iso(nextCalendarOccurrence(w2mon, WED_7_OCT_0900, c2))).toBe(iso(at(2026, 10, 12, 9)))
      // After week 2's Monday has passed, the next "Week 2 Mon" is two weeks later.
      expect(iso(nextCalendarOccurrence(w2mon, at(2026, 10, 12, 10), c2))).toBe(iso(at(2026, 10, 26, 9)))
      // Week 1's Sunday is the last day of the run's week.
      const w1sun: CalendarRule = { kind: 'cycle_weekday', cycle: 1, weekday: 0, time: '09:00' }
      expect(iso(nextCalendarOccurrence(w1sun, WED_7_OCT_0900, c2))).toBe(iso(at(2026, 10, 11, 9)))
    })

    it('cycle_weekday already past in cycle 1 → the same position in the next cycle', () => {
      const c2 = ctx(WED_7_OCT_0900, 2)
      const w1mon: CalendarRule = { kind: 'cycle_weekday', cycle: 1, weekday: 1, time: '09:00' }
      expect(iso(nextCalendarOccurrence(w1mon, WED_7_OCT_0900, c2))).toBe(iso(at(2026, 10, 19, 9)))
      const c3 = ctx(WED_7_OCT_0900, 3)
      expect(iso(nextCalendarOccurrence(w1mon, WED_7_OCT_0900, c3))).toBe(iso(at(2026, 10, 26, 9)))
    })

    it('cycle_month_day: “Month 2, 5th” every 2 months; clamped; next cycle when passed', () => {
      const run = at(2026, 10, 1, 9)
      const c2 = ctx(run, 2)
      const m2d5: CalendarRule = { kind: 'cycle_month_day', cycle: 2, day: 5, time: '09:00' }
      expect(iso(nextCalendarOccurrence(m2d5, run, c2))).toBe(iso(at(2026, 11, 5, 9)))
      expect(iso(nextCalendarOccurrence(m2d5, at(2026, 11, 6, 9), c2))).toBe(iso(at(2027, 1, 5, 9)))
      const m1last: CalendarRule = { kind: 'cycle_month_day', cycle: 1, day: 'last', time: '18:00' }
      expect(iso(nextCalendarOccurrence(m1last, run, c2))).toBe(iso(at(2026, 10, 31, 18)))
      const jan = at(2027, 1, 10, 9)
      const m2d31: CalendarRule = { kind: 'cycle_month_day', cycle: 2, day: 31, time: '09:00' }
      expect(iso(nextCalendarOccurrence(m2d31, jan, ctx(jan, 3)))).toBe(iso(at(2027, 2, 28, 9)))
      // Every 3 months from January: cycle 2 is Feb, May, Aug…
      expect(iso(nextCalendarOccurrence(m2d31, at(2027, 3, 1, 9), ctx(jan, 3)))).toBe(iso(at(2027, 5, 31, 9)))
    })

    it('cycle_year_date: “Year 2, 5 Jun” every 2 years', () => {
      const run = at(2026, 11, 1, 9)
      const c2 = ctx(run, 2)
      const y2: CalendarRule = { kind: 'cycle_year_date', cycle: 2, month: 6, day: 5, time: '09:00' }
      expect(iso(nextCalendarOccurrence(y2, run, c2))).toBe(iso(at(2027, 6, 5, 9)))
      expect(iso(nextCalendarOccurrence(y2, at(2027, 6, 6, 9), c2))).toBe(iso(at(2029, 6, 5, 9)))
      const y1: CalendarRule = { kind: 'cycle_year_date', cycle: 1, month: 3, day: 1, time: '09:00' }
      // Year 1's 1 March is before the November run → the next year-1 (2028).
      expect(iso(nextCalendarOccurrence(y1, run, c2))).toBe(iso(at(2028, 3, 1, 9)))
      const leap: CalendarRule = { kind: 'cycle_year_date', cycle: 1, month: 2, day: 29, time: '09:00' }
      expect(iso(nextCalendarOccurrence(leap, at(2027, 1, 1, 9), ctx(at(2027, 1, 1, 9), 2)))).toBe(iso(at(2027, 2, 28, 9)))
    })
  })
})

describe('resolveStart / resolveDue', () => {
  const c = ctx(WED_7_OCT_0900)

  it('immediate = the moment it may start', () => {
    expect(iso(resolveStart({ kind: 'immediate' }, at(2026, 10, 8, 13), c))).toBe(iso(at(2026, 10, 8, 13)))
  })

  it('days_after_previous: N days after the moment it may start, at the time', () => {
    expect(iso(resolveStart({ kind: 'days_after_previous', days: 2, time: '10:00' }, at(2026, 10, 9, 18), c))).toBe(
      iso(at(2026, 10, 11, 10)),
    )
  })

  it('days_after_run_start: run start day + N at the time — never before it may start', () => {
    const rule: StartRule = { kind: 'days_after_run_start', days: 3, time: '09:00' }
    expect(iso(resolveStart(rule, WED_7_OCT_0900, c))).toBe(iso(at(2026, 10, 10, 9)))
    // The steps before it finish later → order wins.
    expect(iso(resolveStart(rule, at(2026, 10, 12, 18), c))).toBe(iso(at(2026, 10, 12, 18)))
    // Day 0 at a time before the run started → when the run starts.
    expect(iso(resolveStart({ kind: 'days_after_run_start', days: 0, time: '08:00' }, WED_7_OCT_0900, c))).toBe(
      iso(WED_7_OCT_0900),
    )
  })

  it('a relative due is the start day + N at the time (never before the start); a calendar due is strictly after', () => {
    const start = at(2026, 10, 8, 9)
    expect(iso(resolveDue({ kind: 'days_after_start', days: 2, time: '18:00' }, start, c))).toBe(iso(at(2026, 10, 10, 18)))
    expect(iso(resolveDue({ kind: 'days_after_start', days: 0, time: '08:00' }, start, c))).toBe(iso(at(2026, 10, 9, 8)))
    expect(iso(resolveDue({ kind: 'weekday', weekday: 4, time: '09:00' }, start, c))).toBe(iso(at(2026, 10, 15, 9)))
    expect(iso(resolveDue({ kind: 'weekday', weekday: 4, time: '18:00' }, start, c))).toBe(iso(at(2026, 10, 8, 18)))
  })

  it('sameTimeNextDay keeps the wall-clock time', () => {
    expect(iso(sameTimeNextDay(at(2026, 10, 10, 9, 15), IST))).toBe(iso(at(2026, 10, 11, 9, 15)))
  })
})

describe('planRun — the approved table’s examples', () => {
  it('Manually: Step 1 day 0 → 2 days; Step 2 day 3 → day 5', async () => {
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'days_after_run_start', days: 0, time: '09:00' }), ...dueOn({ kind: 'days_after_start', days: 2, time: '18:00' }) }),
        step('s2', {
          deps: ['s1'],
          ...startOn({ kind: 'days_after_run_start', days: 3, time: '09:00' }),
          ...dueOn({ kind: 'days_after_start', days: 2, time: '18:00' }),
        }),
      ],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 10, 7, 9)), iso(at(2026, 10, 9, 18))])
    expect(of(res, 's2')).toEqual([iso(at(2026, 10, 10, 9)), iso(at(2026, 10, 12, 18))])
    expect(res.warnings).toEqual([])
  })

  it('Daily: Step 1 10:00 → 13:00; Step 2 14:00 → 17:00', async () => {
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'time_of_day', time: '10:00' }), ...dueOn({ kind: 'time_of_day', time: '13:00' }) }),
        step('s2', { deps: ['s1'], ...startOn({ kind: 'time_of_day', time: '14:00' }), ...dueOn({ kind: 'time_of_day', time: '17:00' }) }),
      ],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 10, 7, 10)), iso(at(2026, 10, 7, 13))])
    expect(of(res, 's2')).toEqual([iso(at(2026, 10, 7, 14)), iso(at(2026, 10, 7, 17))])
  })

  it('Weekly (runs Wed): Step 1 Thu → Fri; Step 2 Mon → Tue of the following week', async () => {
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'weekday', weekday: 4, time: '09:00' }), ...dueOn({ kind: 'weekday', weekday: 5, time: '18:00' }) }),
        step('s2', {
          deps: ['s1'],
          ...startOn({ kind: 'weekday', weekday: 1, time: '09:00' }),
          ...dueOn({ kind: 'weekday', weekday: 2, time: '18:00' }),
        }),
      ],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 10, 8, 9)), iso(at(2026, 10, 9, 18))])
    expect(of(res, 's2')).toEqual([iso(at(2026, 10, 12, 9)), iso(at(2026, 10, 13, 18))])
  })

  it('Monthly (on the 1st): Step 1 2nd → 4th; Step 2 5th → 10th', async () => {
    const run = at(2026, 10, 1, 9)
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'month_day', day: 2, time: '09:00' }), ...dueOn({ kind: 'month_day', day: 4, time: '18:00' }) }),
        step('s2', { deps: ['s1'], ...startOn({ kind: 'month_day', day: 5, time: '09:00' }), ...dueOn({ kind: 'month_day', day: 10, time: '18:00' }) }),
      ],
      ctx(run),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 10, 2, 9)), iso(at(2026, 10, 4, 18))])
    expect(of(res, 's2')).toEqual([iso(at(2026, 10, 5, 9)), iso(at(2026, 10, 10, 18))])
  })

  it('Yearly: Step 1 3 Dec → 21 Dec; Step 2 5 Jun → 30 Jun of the next year', async () => {
    const run = at(2026, 11, 1, 9)
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'year_date', month: 12, day: 3, time: '09:00' }), ...dueOn({ kind: 'year_date', month: 12, day: 21, time: '18:00' }) }),
        step('s2', {
          deps: ['s1'],
          ...startOn({ kind: 'year_date', month: 6, day: 5, time: '09:00' }),
          ...dueOn({ kind: 'year_date', month: 6, day: 30, time: '18:00' }),
        }),
      ],
      ctx(run),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 12, 3, 9)), iso(at(2026, 12, 21, 18))])
    expect(of(res, 's2')).toEqual([iso(at(2027, 6, 5, 9)), iso(at(2027, 6, 30, 18))])
  })

  it('Every 2 weeks: Step 1 Week 1 Thu; Step 2 Week 2 Mon', async () => {
    const res = await planRun(
      [
        step('s1', { ...startOn({ kind: 'cycle_weekday', cycle: 1, weekday: 4, time: '09:00' }) }),
        step('s2', { deps: ['s1'], ...startOn({ kind: 'cycle_weekday', cycle: 2, weekday: 1, time: '09:00' }) }),
      ],
      ctx(WED_7_OCT_0900, 2),
    )
    expect(of(res, 's1')).toEqual([iso(at(2026, 10, 8, 9)), iso(at(2026, 10, 9, 18))])
    expect(of(res, 's2')).toEqual([iso(at(2026, 10, 12, 9)), iso(at(2026, 10, 13, 18))])
  })

  it('Every 2 months / years: “Month 2, 5th” and “Year 2, 5 Jun”', async () => {
    const monthly = await planRun(
      [step('s1', startOn({ kind: 'cycle_month_day', cycle: 2, day: 5, time: '09:00' }))],
      ctx(at(2026, 10, 1, 9), 2),
    )
    expect(of(monthly, 's1')[0]).toBe(iso(at(2026, 11, 5, 9)))
    const yearly = await planRun(
      [step('s1', startOn({ kind: 'cycle_year_date', cycle: 2, month: 6, day: 5, time: '09:00' }))],
      ctx(at(2026, 11, 1, 9), 2),
    )
    expect(of(yearly, 's1')[0]).toBe(iso(at(2027, 6, 5, 9)))
  })
})

describe('planRun — order, anchors and warnings', () => {
  it('legacy steps (null rules): start when the steps before are due, due N days later (as today)', async () => {
    const res = await planRun([step('a', { due_days: 2, due_time: '17:00' }), step('b', { deps: ['a'] })], ctx(WED_7_OCT_0900))
    expect(of(res, 'a')).toEqual([iso(WED_7_OCT_0900), iso(at(2026, 10, 9, 17))])
    expect(of(res, 'b')).toEqual([iso(at(2026, 10, 9, 17)), iso(at(2026, 10, 10, 18))])
  })

  it('a join starts after the LATEST planned due of its predecessors', async () => {
    const res = await planRun(
      [
        step('a', { due_days: 1 }),
        step('b', { due_days: 3 }),
        step('c', { deps: ['a', 'b'], ...startOn({ kind: 'days_after_previous', days: 1, time: '10:00' }) }),
      ],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 'c')[0]).toBe(iso(at(2026, 10, 11, 10))) // b due Sat 10 Oct 18:00 → +1 day 10:00
  })

  it('days_after_previous for a first step counts from the run start', async () => {
    const res = await planRun([step('a', startOn({ kind: 'days_after_previous', days: 1, time: '11:00' }))], ctx(WED_7_OCT_0900))
    expect(of(res, 'a')[0]).toBe(iso(at(2026, 10, 8, 11)))
  })

  it('a calendar start before its predecessor is due lands in the next cycle — no warning (the builder labels it)', async () => {
    const res = await planRun(
      [
        step('a', dueOn({ kind: 'month_day', day: 10, time: '18:00' })),
        step('b', { deps: ['a'], ...startOn({ kind: 'month_day', day: 5, time: '09:00' }) }),
      ],
      ctx(at(2026, 10, 1, 9)),
    )
    expect(of(res, 'b')[0]).toBe(iso(at(2026, 11, 5, 9)))
    expect(res.warnings).toEqual([])
  })

  it('days_after_run_start before a predecessor is due waits for it — and warns', async () => {
    const res = await planRun(
      [step('a', { due_days: 3 }), step('b', { deps: ['a'], ...startOn({ kind: 'days_after_run_start', days: 1, time: '09:00' }) })],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 'b')[0]).toBe(iso(at(2026, 10, 10, 18)))
    expect(res.warnings).toEqual([{ key: 'b', predecessor_key: 'a' }])
  })

  it('no warning when the rule naturally falls after its predecessor (weekly Mon after Fri)', async () => {
    const res = await planRun(
      [
        step('a', { ...startOn({ kind: 'weekday', weekday: 4, time: '09:00' }), ...dueOn({ kind: 'weekday', weekday: 5, time: '18:00' }) }),
        step('b', { deps: ['a'], ...startOn({ kind: 'weekday', weekday: 1, time: '09:00' }) }),
        step('c', { deps: ['b'], ...startOn({ kind: 'days_after_previous', days: 1, time: '09:00' }) }),
        step('d', { deps: ['c'] }),
      ],
      ctx(WED_7_OCT_0900),
    )
    expect(res.warnings).toEqual([])
  })

  it('a calendar due that falls before the start resolves strictly after the start', async () => {
    // Starts Fri 9 Oct; "due Thursday" = the following Thursday.
    const res = await planRun(
      [step('a', { ...startOn({ kind: 'weekday', weekday: 5, time: '09:00' }), ...dueOn({ kind: 'weekday', weekday: 4, time: '18:00' }) })],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 'a')).toEqual([iso(at(2026, 10, 9, 9)), iso(at(2026, 10, 15, 18))])
  })

  it('start and due may mix (weekday start, relative due)', async () => {
    const res = await planRun(
      [step('a', { ...startOn({ kind: 'weekday', weekday: 1, time: '10:00' }), ...dueOn({ kind: 'days_after_start', days: 3, time: '12:00' }) })],
      ctx(WED_7_OCT_0900),
    )
    expect(of(res, 'a')).toEqual([iso(at(2026, 10, 12, 10)), iso(at(2026, 10, 15, 12))])
  })

  it('plans in dependency order whatever the input order; loops never hang', () => {
    const order = planOrder([step('c', { deps: ['b'] }), step('b', { deps: ['a'] }), step('a'), step('x', { deps: ['missing'] })])
    expect(order.map((s) => s.key)).toEqual(['a', 'x', 'b', 'c'])
    const loop = planOrder([step('a', { deps: ['b'] }), step('b', { deps: ['a'] }), step('c')])
    expect(loop.map((s) => s.key)).toEqual(['c', 'a', 'b'])
  })

  it('returns the steps in input order', async () => {
    const res = await planRun([step('b', { deps: ['a'] }), step('a')], ctx(WED_7_OCT_0900))
    expect(res.steps.map((s) => s.key)).toEqual(['b', 'a'])
    expect(of(res, 'b')[0]).toBe(of(res, 'a')[1])
  })
})

describe('planRun — holidays', () => {
  /** Sundays are off: move to Monday at the same time. */
  const shiftStart = (d: Date) => {
    let cur = d
    while (weekdayOf(localDateOf(cur, IST)) === 0) cur = sameTimeNextDay(cur, IST)
    return cur
  }

  it('a computed start on a weekly off moves to the next working day at the same time', async () => {
    const res = await planRun(
      [step('a', startOn({ kind: 'weekday', weekday: 0, time: '09:00' }))],
      ctx(WED_7_OCT_0900),
      { shiftStart },
    )
    expect(of(res, 'a')).toEqual([iso(at(2026, 10, 12, 9)), iso(at(2026, 10, 13, 18))])
  })

  it('every non-immediate kind is shifted (days after the run start / previous, time of day)', async () => {
    const res = await planRun(
      [
        step('a', startOn({ kind: 'days_after_run_start', days: 4, time: '09:00' })), // Sun 11 Oct
        step('b', startOn({ kind: 'days_after_previous', days: 4, time: '10:00' })), // Sun 11 Oct
      ],
      ctx(WED_7_OCT_0900),
      { shiftStart },
    )
    expect(of(res, 'a')[0]).toBe(iso(at(2026, 10, 12, 9)))
    expect(of(res, 'b')[0]).toBe(iso(at(2026, 10, 12, 10)))
    const tod = await planRun([step('a', startOn({ kind: 'time_of_day', time: '10:00' }))], ctx(at(2026, 10, 11, 8)), { shiftStart })
    expect(of(tod, 'a')[0]).toBe(iso(at(2026, 10, 12, 10)))
  })

  it('an immediate start is never shifted (as today); dues go through the deadline adjustment', async () => {
    const sunday = at(2026, 10, 11, 9)
    const adjustDue = jest.fn((d: Date) => new Date(d.getTime() + 3_600_000))
    const res = await planRun([step('a')], ctx(sunday), { shiftStart, adjustDue })
    expect(of(res, 'a')).toEqual([iso(sunday), iso(at(2026, 10, 12, 19))])
    expect(adjustDue).toHaveBeenCalledWith(at(2026, 10, 12, 18), 'a')
  })

  it('the due resolves from the shifted start', async () => {
    const res = await planRun(
      [step('a', { ...startOn({ kind: 'weekday', weekday: 0, time: '09:00' }), ...dueOn({ kind: 'weekday', weekday: 1, time: '08:00' }) })],
      ctx(WED_7_OCT_0900),
      { shiftStart },
    )
    // Start moves Sun → Mon 09:00; "due Monday 08:00" strictly after that = the next Monday.
    expect(of(res, 'a')).toEqual([iso(at(2026, 10, 12, 9)), iso(at(2026, 10, 19, 8))])
  })
})
