import {
  allowedDueKinds,
  allowedStartKinds,
  calendarKindFor,
  cycleLengthOf,
  effectiveDueRule,
  effectiveStartRule,
  firstStepTimingProblem,
  frequencyOf,
  laterStepTimingProblem,
  looseRule,
  parseDueRule,
  parseStartRule,
  readDueRule,
  readStartRule,
  runStartPointOf,
  timingProblem,
  type RunStartPoint,
} from './timing'

describe('parseStartRule / parseDueRule', () => {
  it('accepts every start kind in its canonical shape (extra keys dropped)', () => {
    const cases = [
      { kind: 'immediate' },
      { kind: 'days_after_previous', days: 1, time: '09:00' },
      { kind: 'days_after_run_start', days: 0, time: '09:00' },
      { kind: 'time_of_day', time: '10:30' },
      { kind: 'weekday', weekday: 0, time: '09:00' },
      { kind: 'month_day', day: 31, time: '09:00' },
      { kind: 'month_day', day: 'last', time: '09:00' },
      { kind: 'year_date', month: 2, day: 29, time: '09:00' },
      { kind: 'cycle_weekday', cycle: 2, weekday: 6, time: '09:00' },
      { kind: 'cycle_month_day', cycle: 3, day: 'last', time: '09:00' },
      { kind: 'cycle_year_date', cycle: 2, month: 6, day: 5, time: '09:00' },
    ]
    for (const c of cases) expect(parseStartRule({ ...c, junk: 1 })).toEqual({ ok: true, rule: c })
    expect(parseStartRule({ kind: 'immediate', time: '09:00' })).toEqual({ ok: true, rule: { kind: 'immediate' } })
  })

  it('accepts every due kind; immediate / days_after_* are start-only', () => {
    expect(parseDueRule({ kind: 'days_after_start', days: 0, time: '18:00' }).ok).toBe(true)
    expect(parseDueRule({ kind: 'days_after_start', days: 365, time: '18:00' }).ok).toBe(true)
    expect(parseDueRule({ kind: 'weekday', weekday: 5, time: '18:00' }).ok).toBe(true)
    expect(parseDueRule({ kind: 'immediate' })).toEqual({ ok: false, problem: 'choose when it is due.' })
    expect(parseDueRule({ kind: 'days_after_previous', days: 1, time: '09:00' }).ok).toBe(false)
    expect(parseStartRule({ kind: 'days_after_start', days: 1, time: '09:00' })).toEqual({
      ok: false,
      problem: 'choose when it starts.',
    })
  })

  it('validates every param with a plain message', () => {
    const bad = (raw: unknown) => {
      const p = parseStartRule(raw)
      return p.ok ? null : p.problem
    }
    expect(bad(null)).toBe('choose when it starts.')
    expect(bad({ kind: 'weekday', weekday: 7, time: '09:00' })).toBe('choose a day of the week for the start.')
    expect(bad({ kind: 'weekday', weekday: 1.5, time: '09:00' })).toBe('choose a day of the week for the start.')
    expect(bad({ kind: 'weekday', weekday: 1, time: '9:00' })).toBe('enter a start time.')
    expect(bad({ kind: 'weekday', weekday: 1, time: '24:00' })).toBe('enter a start time.')
    expect(bad({ kind: 'month_day', day: 0, time: '09:00' })).toBe('choose a day of the month for the start.')
    expect(bad({ kind: 'month_day', day: 32, time: '09:00' })).toBe('choose a day of the month for the start.')
    expect(bad({ kind: 'month_day', day: 'first', time: '09:00' })).toBe('choose a day of the month for the start.')
    expect(bad({ kind: 'year_date', month: 13, day: 1, time: '09:00' })).toBe('choose a month for the start.')
    expect(bad({ kind: 'year_date', month: 2, day: 30, time: '09:00' })).toBe('choose a valid date for the start.')
    expect(bad({ kind: 'year_date', month: 4, day: 31, time: '09:00' })).toBe('choose a valid date for the start.')
    expect(bad({ kind: 'cycle_weekday', cycle: 0, weekday: 1, time: '09:00' })).toBe(
      'choose a cycle for the start.',
    )
    expect(bad({ kind: 'days_after_previous', days: 0, time: '09:00' })).toBe(
      'start days must be 1 to 365.',
    )
    expect(bad({ kind: 'days_after_run_start', days: 366, time: '09:00' })).toBe(
      'start days must be 0 to 365.',
    )
    expect(bad({ kind: 'days_after_run_start', days: 1 })).toBe('enter a start time.')
    const due = parseDueRule({ kind: 'days_after_start', days: -1, time: '18:00' })
    expect(due).toEqual({ ok: false, problem: 'due days must be 0 to 365.' })
    expect(parseDueRule({ kind: 'month_day', day: 3 })).toEqual({ ok: false, problem: 'enter a due time.' })
  })

  it('read* returns null for legacy / garbled rules (the engine then runs the legacy behaviour)', () => {
    expect(readStartRule(null)).toBeNull()
    expect(readStartRule(undefined)).toBeNull()
    expect(readStartRule({ kind: 'weekday' })).toBeNull()
    expect(readDueRule('x')).toBeNull()
    expect(readStartRule({ kind: 'weekday', weekday: 3, time: '09:00' })).toEqual({ kind: 'weekday', weekday: 3, time: '09:00' })
  })

  it('looseRule keeps a draft’s partial rule (known keys, primitive values only)', () => {
    expect(looseRule({ kind: 'weekday', time: '09', weekday: 'x', evil: { a: 1 } })).toEqual({ kind: 'weekday', time: '09' })
    expect(looseRule({ kind: 'month_day', day: 'last', days: 3 })).toEqual({ kind: 'month_day', day: 'last', days: 3 })
    expect(looseRule({ kind: 5 })).toBeNull()
    expect(looseRule([])).toBeNull()
  })

  it('effective rules fill in the legacy defaults', () => {
    expect(effectiveStartRule(null)).toEqual({ kind: 'immediate' })
    expect(effectiveDueRule(null, 2, '17:00')).toEqual({ kind: 'days_after_start', days: 2, time: '17:00' })
    expect(effectiveDueRule({ kind: 'weekday', weekday: 1, time: '09:00' }, 2, '17:00')).toEqual({
      kind: 'weekday',
      weekday: 1,
      time: '09:00',
    })
  })
})

describe('frequencyOf and the allowed kinds (the approved table)', () => {
  const S = (schedule_type: string, every = 1) => ({ schedule_type, every })

  it('derives the frequency from the schedules', () => {
    expect(frequencyOf([])).toEqual({ kind: 'manual' })
    expect(frequencyOf([S('daily')])).toEqual({ kind: 'daily', every: 1 })
    expect(frequencyOf([S('weekly'), S('weekly')])).toEqual({ kind: 'weekly', every: 1 })
    expect(frequencyOf([S('monthly', 2)])).toEqual({ kind: 'monthly', every: 2 })
    expect(frequencyOf([S('weekly'), S('monthly')])).toEqual({ kind: 'mixed' })
    expect(frequencyOf([S('weekly', 1), S('weekly', 2)])).toEqual({ kind: 'mixed' })
    expect(frequencyOf([{ schedule_type: 'weekly', every: null }])).toEqual({ kind: 'weekly', every: 1 })
  })

  it('maps each frequency to exactly its calendar kind', () => {
    expect(calendarKindFor({ kind: 'manual' })).toBeNull()
    expect(calendarKindFor({ kind: 'mixed' })).toBeNull()
    expect(calendarKindFor({ kind: 'daily', every: 1 })).toBe('time_of_day')
    expect(calendarKindFor({ kind: 'daily', every: 3 })).toBe('time_of_day')
    expect(calendarKindFor({ kind: 'weekly', every: 1 })).toBe('weekday')
    expect(calendarKindFor({ kind: 'weekly', every: 2 })).toBe('cycle_weekday')
    expect(calendarKindFor({ kind: 'monthly', every: 1 })).toBe('month_day')
    expect(calendarKindFor({ kind: 'monthly', every: 3 })).toBe('cycle_month_day')
    expect(calendarKindFor({ kind: 'yearly', every: 1 })).toBe('year_date')
    expect(calendarKindFor({ kind: 'yearly', every: 2 })).toBe('cycle_year_date')
    expect(cycleLengthOf({ kind: 'weekly', every: 2 })).toBe(2)
    expect(cycleLengthOf({ kind: 'daily', every: 2 })).toBe(1)
    expect(cycleLengthOf({ kind: 'manual' })).toBe(1)
  })

  it('relative kinds are always allowed', () => {
    for (const f of [{ kind: 'manual' as const }, { kind: 'mixed' as const }, { kind: 'monthly' as const, every: 1 }]) {
      expect(allowedStartKinds(f)).toEqual(expect.arrayContaining(['immediate', 'days_after_previous', 'days_after_run_start']))
      expect(allowedDueKinds(f)).toContain('days_after_start')
    }
    expect(allowedStartKinds({ kind: 'manual' })).toHaveLength(3)
    expect(allowedDueKinds({ kind: 'mixed' })).toEqual(['days_after_start'])
  })
})

describe('timingProblem (Save)', () => {
  const weekday = { kind: 'weekday', weekday: 4, time: '09:00' }
  const monthDay = { kind: 'month_day', day: 5, time: '09:00' }

  it('legacy (null) rules and relative rules are valid for every frequency', () => {
    expect(timingProblem(null, null, { kind: 'manual' })).toBeNull()
    expect(timingProblem({ kind: 'days_after_previous', days: 2, time: '09:00' }, { kind: 'days_after_start', days: 1, time: '18:00' }, { kind: 'mixed' })).toBeNull()
  })

  it('names what to pick for the frequency', () => {
    expect(timingProblem(weekday, null, { kind: 'monthly', every: 1 })).toBe(
      'the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.',
    )
    expect(timingProblem(monthDay, null, { kind: 'weekly', every: 1 })).toBe(
      'the workflow repeats weekly. Choose “Day of the week” or a “Days after” option.',
    )
    expect(timingProblem(null, weekday, { kind: 'daily', every: 1 })).toBe(
      'the workflow repeats daily. Choose “Time of day” or a “Days after” option.',
    )
    expect(timingProblem(weekday, null, { kind: 'manual' })).toBe(
      'the workflow starts manually. Choose a “Days after” option.',
    )
    expect(timingProblem(weekday, null, { kind: 'mixed' })).toBe(
      'the schedules repeat differently. Choose a “Days after” option.',
    )
    expect(timingProblem({ kind: 'year_date', month: 6, day: 5, time: '09:00' }, null, { kind: 'monthly', every: 1 })).toBe(
      'the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.',
    )
    expect(timingProblem(monthDay, null, { kind: 'yearly', every: 1 })).toBe('the workflow repeats yearly. Choose “Date” or a “Days after” option.')
  })

  it('every 2+: a plain weekday/date is ambiguous; the cycle must be within the interval', () => {
    expect(timingProblem(weekday, null, { kind: 'weekly', every: 2 })).toBe(
      'the workflow repeats every 2 weeks. Choose “Day in 2-week cycle” or a “Days after” option.',
    )
    expect(timingProblem(monthDay, null, { kind: 'monthly', every: 3 })).toBe(
      'the workflow repeats every 3 months. Choose “Day in 3-month cycle” or a “Days after” option.',
    )
    expect(timingProblem({ kind: 'year_date', month: 6, day: 5, time: '09:00' }, null, { kind: 'yearly', every: 2 })).toBe(
      'the workflow repeats every 2 years. Choose “Day in 2-year cycle” or a “Days after” option.',
    )
    expect(timingProblem({ kind: 'cycle_weekday', cycle: 3, weekday: 1, time: '09:00' }, null, { kind: 'weekly', every: 2 })).toBe(
      'the workflow repeats every 2 weeks. Choose Week 1 to Week 2.',
    )
    expect(timingProblem({ kind: 'cycle_weekday', cycle: 2, weekday: 1, time: '09:00' }, null, { kind: 'weekly', every: 2 })).toBeNull()
    expect(timingProblem({ kind: 'cycle_weekday', cycle: 1, weekday: 1, time: '09:00' }, null, { kind: 'weekly', every: 1 })).toBe(
      'the workflow repeats weekly. Choose “Day of the week” or a “Days after” option.',
    )
  })

  it('param problems come before frequency problems; the due rule is checked too', () => {
    expect(timingProblem({ kind: 'weekday', weekday: 9, time: '09:00' }, null, { kind: 'monthly', every: 1 })).toBe(
      'choose a day of the week for the start.',
    )
    expect(timingProblem(null, { kind: 'month_day', day: 40, time: '18:00' }, { kind: 'monthly', every: 1 })).toBe(
      'choose a day of the month for the due date.',
    )
    expect(timingProblem(monthDay, { kind: 'month_day', day: 10, time: '18:00' }, { kind: 'monthly', every: 1 })).toBeNull()
  })
})

describe('first steps: on or after the run start, inside its cycle', () => {
  const monthly = (month_days: number[], time = '09:00') => ({ schedule_type: 'monthly', every: 1, month_days, time })
  const start = (r: Record<string, unknown>) => ({ ...r, time: (r.time as string) ?? '09:00' })

  it('the run start point is the LATEST trigger day in the cycle (and its time)', () => {
    expect(runStartPointOf([monthly([3])], frequencyOf([monthly([3])]))).toEqual({ kind: 'monthly', every: 1, day: 3, time: '09:00' })
    // Monthly on the 3rd and the 20th → the 20th; "-31" (31st or the last day) counts as 31.
    const two = [monthly([20, 3])]
    expect(runStartPointOf(two, frequencyOf(two))).toMatchObject({ day: 20 })
    const many = [monthly([3], '10:00'), monthly([-31], '08:00')]
    expect(runStartPointOf(many, frequencyOf(many))).toMatchObject({ day: 31, time: '08:00' })
    // Weekly Mon and Thu → Thu; Sunday is the END of the week (Monday first).
    const weekly = [{ schedule_type: 'weekly', every: 1, days: [4, 1], time: '09:00' }]
    expect(runStartPointOf(weekly, frequencyOf(weekly))).toMatchObject({ kind: 'weekly', weekday: 4 })
    const withSun = [{ schedule_type: 'weekly', every: 1, days: [0, 3], time: '09:00' }]
    expect(runStartPointOf(withSun, frequencyOf(withSun))).toMatchObject({ weekday: 0 })
    // Yearly 1 Apr and 15 Jan → 1 Apr; daily 09:00 and 14:30 → 14:30.
    const yearly = [{ schedule_type: 'yearly', every: 1, yearly_dates: [{ month: 4, day: 1 }, { month: 1, day: 15 }], time: '09:00' }]
    expect(runStartPointOf(yearly, frequencyOf(yearly))).toMatchObject({ kind: 'yearly', month: 4, day: 1 })
    const daily = [
      { schedule_type: 'daily', every: 1, time: '09:00' },
      { schedule_type: 'daily', every: 1, time: '14:30' },
    ]
    expect(runStartPointOf(daily, frequencyOf(daily))).toEqual({ kind: 'daily', time: '14:30' })
    // Manual, mixed, or no trigger day yet → none.
    expect(runStartPointOf([], frequencyOf([]))).toBeNull()
    const mixed = [monthly([3]), { schedule_type: 'weekly', every: 1, days: [1], time: '09:00' }]
    expect(runStartPointOf(mixed, frequencyOf(mixed))).toBeNull()
    expect(runStartPointOf([monthly([])], frequencyOf([monthly([])]))).toBeNull()
  })

  it('monthly (run on the 3rd): start and due only on the 3rd or later', () => {
    const rs: RunStartPoint = { kind: 'monthly', every: 1, day: 3, time: '09:00' }
    const msg = 'pick a day on or after the 3rd, when the run starts.'
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 1 }), null, rs)).toBe(msg)
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 2 }), null, rs)).toBe(msg)
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 3 }), null, rs)).toBeNull()
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 'last' }), null, rs)).toBeNull()
    // The due date is held to the same rule (start "immediately").
    expect(firstStepTimingProblem({ kind: 'immediate' }, { kind: 'month_day', day: 1, time: '18:00' }, rs)).toBe(msg)
    expect(firstStepTimingProblem({ kind: 'immediate' }, { kind: 'month_day', day: 10, time: '18:00' }, rs)).toBeNull()
    // On the run day itself, not before the time the run starts.
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 3, time: '08:00' }), null, rs)).toBe(
      'pick a time at or after 9:00 AM on the 3rd, when the run starts.',
    )
    // Relative kinds and legacy rules are unaffected; no run start point → nothing to check.
    expect(
      firstStepTimingProblem({ kind: 'days_after_run_start', days: 0, time: '08:00' }, { kind: 'days_after_start', days: 1, time: '18:00' }, rs),
    ).toBeNull()
    expect(firstStepTimingProblem(null, null, rs)).toBeNull()
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 1 }), null, null)).toBeNull()
  })

  it('weekly (run on Wednesday): Wednesday or later that week', () => {
    const rs: RunStartPoint = { kind: 'weekly', every: 1, weekday: 3, time: '09:00' }
    const msg = 'pick a day on or after Wednesday, when the run starts.'
    expect(firstStepTimingProblem(start({ kind: 'weekday', weekday: 1 }), null, rs)).toBe(msg)
    expect(firstStepTimingProblem(start({ kind: 'weekday', weekday: 2 }), null, rs)).toBe(msg)
    expect(firstStepTimingProblem(start({ kind: 'weekday', weekday: 3 }), null, rs)).toBeNull()
    expect(firstStepTimingProblem(start({ kind: 'weekday', weekday: 0 }), null, rs)).toBeNull() // Sunday ends the week
  })

  it('yearly (run on 1 Apr): on or after 1 Apr that year', () => {
    const rs: RunStartPoint = { kind: 'yearly', every: 1, month: 4, day: 1, time: '09:00' }
    expect(firstStepTimingProblem(start({ kind: 'year_date', month: 3, day: 31 }), null, rs)).toBe(
      'pick a date on or after 1 Apr, when the run starts.',
    )
    expect(firstStepTimingProblem(start({ kind: 'year_date', month: 4, day: 1 }), null, rs)).toBeNull()
    expect(firstStepTimingProblem({ kind: 'immediate' }, { kind: 'year_date', month: 12, day: 31, time: '18:00' }, rs)).toBeNull()
  })

  it('daily (runs at 9:00 AM): a time at or after the run start, for the start and the due', () => {
    const rs: RunStartPoint = { kind: 'daily', time: '09:00' }
    const msg = 'pick a time at or after 9:00 AM, when the run starts.'
    expect(firstStepTimingProblem({ kind: 'time_of_day', time: '08:30' }, null, rs)).toBe(msg)
    expect(firstStepTimingProblem({ kind: 'time_of_day', time: '09:00' }, null, rs)).toBeNull()
    expect(firstStepTimingProblem({ kind: 'immediate' }, { kind: 'time_of_day', time: '08:00' }, rs)).toBe(msg)
    expect(firstStepTimingProblem({ kind: 'immediate' }, { kind: 'time_of_day', time: '17:00' }, rs)).toBeNull()
  })

  it('every 2+ (cycles): only Cycle 1 positions before the run start are refused', () => {
    const weeks: RunStartPoint = { kind: 'weekly', every: 2, weekday: 3, time: '09:00' }
    expect(firstStepTimingProblem(start({ kind: 'cycle_weekday', cycle: 1, weekday: 1 }), null, weeks)).toBe(
      'pick a day on or after Wednesday in Week 1, when the run starts.',
    )
    expect(firstStepTimingProblem(start({ kind: 'cycle_weekday', cycle: 2, weekday: 1 }), null, weeks)).toBeNull()
    const months: RunStartPoint = { kind: 'monthly', every: 3, day: 10, time: '09:00' }
    expect(firstStepTimingProblem(start({ kind: 'cycle_month_day', cycle: 1, day: 5 }), null, months)).toBe(
      'pick a day on or after the 10th in Month 1, when the run starts.',
    )
    expect(firstStepTimingProblem(start({ kind: 'cycle_month_day', cycle: 3, day: 1 }), null, months)).toBeNull()
    const years: RunStartPoint = { kind: 'yearly', every: 2, month: 6, day: 5, time: '09:00' }
    expect(
      firstStepTimingProblem({ kind: 'immediate' }, { kind: 'cycle_year_date', cycle: 1, month: 1, day: 1, time: '18:00' }, years),
    ).toBe('pick a date on or after 5 Jun in Year 1, when the run starts.')
  })

  it('several trigger days: first steps go on or after the latest one', () => {
    const schedules = [monthly([3, 20])]
    const rs = runStartPointOf(schedules, frequencyOf(schedules))
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 10 }), null, rs)).toBe(
      'pick a day on or after the 20th, when the run starts.',
    )
    expect(firstStepTimingProblem(start({ kind: 'month_day', day: 20 }), null, rs)).toBeNull()
  })
})

describe('later steps: no “Days after workflow is triggered”', () => {
  it('refuses days_after_run_start on a step with steps before it; anything else is fine', () => {
    expect(laterStepTimingProblem({ kind: 'days_after_run_start', days: 2, time: '09:00' })).toBe(
      '“Days after workflow is triggered” is only for the first step — pick another start.',
    )
    expect(laterStepTimingProblem({ kind: 'days_after_previous', days: 1, time: '09:00' })).toBeNull()
    expect(laterStepTimingProblem({ kind: 'immediate' })).toBeNull()
    expect(laterStepTimingProblem(null)).toBeNull()
  })
})
