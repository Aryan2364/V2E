import {
  calendarDateToStored,
  dueScheduleOccurrence,
  natureOfSchedules,
  nextScheduleOccurrence,
  scheduleEntryProblem,
  scheduleRepeats,
  storedCalendarDate,
  type ScheduleEntryLike,
} from './schedule'

const IST = 'Asia/Kolkata'
const entry = (over: Partial<ScheduleEntryLike> = {}): ScheduleEntryLike => ({
  schedule_type: 'daily',
  every: 1,
  days: [],
  month_days: [],
  yearly_dates: [],
  time: '09:00',
  start_date: new Date('2026-10-01T00:00:00Z'),
  end_condition: 'never',
  end_date: null,
  end_after: null,
  occurrence_count: 0,
  ...over,
})

describe('workflow schedules (recurring-task format)', () => {
  it('stores a calendar day as UTC midnight and reads it back unchanged', () => {
    const d = calendarDateToStored('2026-02-28')!
    expect(d.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(storedCalendarDate(d)).toEqual({ year: 2026, month: 2, day: 28 })
    expect(calendarDateToStored('2026-02-30')).toBeNull()
  })

  it('next run: every month on the 1st at 09:00 in the org time zone', () => {
    const e = entry({ schedule_type: 'monthly', month_days: [1] })
    const after = new Date('2026-10-08T04:30:00Z') // 10:00 IST
    expect(nextScheduleOccurrence(e, after, IST)?.toISOString()).toBe('2026-11-01T03:30:00.000Z')
    // The same wall-clock time in another zone is a different instant.
    expect(nextScheduleOccurrence(e, after, 'America/New_York')?.toISOString()).toBe('2026-11-01T14:00:00.000Z')
  })

  it('month days use the shared "fall back to the last day" rule', () => {
    const e = entry({ schedule_type: 'monthly', month_days: [-31] })
    const after = new Date('2026-11-01T00:00:00Z')
    expect(nextScheduleOccurrence(e, after, IST)?.toISOString()).toBe('2026-11-30T03:30:00.000Z')
    const strict = entry({ schedule_type: 'monthly', month_days: [31] })
    expect(nextScheduleOccurrence(strict, after, IST)?.toISOString()).toBe('2026-12-31T03:30:00.000Z')
  })

  it('weekly on chosen days, every N weeks from the start', () => {
    // 2026-10-05 is a Monday; every 2 weeks on Monday.
    const e = entry({ schedule_type: 'weekly', every: 2, days: [1], start_date: new Date('2026-10-05T00:00:00Z') })
    expect(nextScheduleOccurrence(e, new Date('2026-10-05T04:00:00Z'), IST)?.toISOString()).toBe('2026-10-19T03:30:00.000Z')
  })

  it('ends after N: no next run once N runs have happened', () => {
    const e = entry({ end_condition: 'after_n', end_after: 3, occurrence_count: 2 })
    expect(nextScheduleOccurrence(e, new Date('2026-10-08T04:30:00Z'), IST)).not.toBeNull()
    expect(nextScheduleOccurrence({ ...e, occurrence_count: 3 }, new Date('2026-10-08T04:30:00Z'), IST)).toBeNull()
    expect(dueScheduleOccurrence({ ...e, occurrence_count: 3 }, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T04:30:00Z'), IST)).toBeNull()
  })

  it('ends on a date (inclusive)', () => {
    const e = entry({ end_condition: 'on_date', end_date: new Date('2026-10-09T00:00:00Z') })
    expect(nextScheduleOccurrence(e, new Date('2026-10-08T04:30:00Z'), IST)?.toISOString()).toBe('2026-10-09T03:30:00.000Z')
    expect(nextScheduleOccurrence(e, new Date('2026-10-09T04:30:00Z'), IST)).toBeNull()
    // A due check after the end still sees the last occurrence, once.
    expect(
      dueScheduleOccurrence(e, new Date('2026-10-08T03:30:00Z'), new Date('2026-10-20T00:00:00Z'), IST)?.toISOString(),
    ).toBe('2026-10-09T03:30:00.000Z')
  })

  it('due: only the latest occurrence after the marker, never one from before it', () => {
    const e = entry()
    const now = new Date('2026-10-08T04:30:00Z')
    expect(dueScheduleOccurrence(e, new Date('2026-10-02T00:00:00Z'), now, IST)?.toISOString()).toBe('2026-10-08T03:30:00.000Z')
    expect(dueScheduleOccurrence(e, new Date('2026-10-08T03:30:00Z'), now, IST)).toBeNull()
    expect(dueScheduleOccurrence(e, new Date('2026-10-08T04:00:00Z'), now, IST)).toBeNull()
    // Not before the start date.
    expect(dueScheduleOccurrence(entry({ start_date: new Date('2026-10-09T00:00:00Z') }), new Date(0), now, IST)).toBeNull()
  })

  it('a one-off ("ends after 1") is not a repeating schedule; nature follows the schedules', () => {
    expect(scheduleRepeats({ end_condition: 'after_n', end_after: 1 })).toBe(false)
    expect(natureOfSchedules([])).toEqual({ workflow_nature: 'one_time', recurring_type: null })
    expect(natureOfSchedules([{ schedule_type: 'daily', end_condition: 'after_n', end_after: 1 }])).toEqual({
      workflow_nature: 'one_time',
      recurring_type: null,
    })
    expect(
      natureOfSchedules([
        { schedule_type: 'monthly', end_condition: 'never', end_after: null },
        { schedule_type: 'monthly', end_condition: 'on_date', end_after: null },
      ]),
    ).toEqual({ workflow_nature: 'recurring', recurring_type: 'monthly' })
    expect(
      natureOfSchedules([
        { schedule_type: 'monthly', end_condition: 'never', end_after: null },
        { schedule_type: 'weekly', end_condition: 'never', end_after: null },
      ]),
    ).toEqual({ workflow_nature: 'recurring', recurring_type: null })
  })

  it('says what a schedule is missing before it can run', () => {
    const base = { schedule_type: 'daily', time: '09:00', start_date: '2026-10-01', end_condition: 'never' }
    expect(scheduleEntryProblem(base)).toBeNull()
    expect(scheduleEntryProblem({ ...base, schedule_type: 'weekly', days: [] })).toBe('choose at least one day of the week.')
    expect(scheduleEntryProblem({ ...base, schedule_type: 'monthly' })).toBe('choose at least one day of the month.')
    expect(scheduleEntryProblem({ ...base, schedule_type: 'yearly', yearly_dates: [] })).toBe('choose at least one date.')
    expect(scheduleEntryProblem({ ...base, end_condition: 'on_date' })).toBe(
      'choose an end date.',
    )
    expect(scheduleEntryProblem({ ...base, end_condition: 'on_date', end_date: '2026-09-01' })).toBe(
      'the end date can’t be before the start date.',
    )
    expect(scheduleEntryProblem({ ...base, end_condition: 'after_n', end_after: 0 })).toBe(
      'enter how many instances it ends after (1 or more).',
    )
  })
})
