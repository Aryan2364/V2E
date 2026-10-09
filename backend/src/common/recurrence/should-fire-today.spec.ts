import { entryOccursOn, shouldEntryFireToday, type RecurrenceEntry } from './should-fire-today'

// Local-time constructors keep these independent of the machine's time zone, exactly
// like the recurring-task scheduler (which reads the server's local calendar day).
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

const entry = (over: Partial<RecurrenceEntry> = {}): RecurrenceEntry => ({
  start_date: day(2026, 1, 1),
  schedule_type: 'daily',
  every: 1,
  days: [],
  month_days: [],
  yearly_dates: [],
  end_condition: 'never',
  end_date: null,
  end_after: null,
  occurrence_count: 0,
  ...over,
})

describe('shouldEntryFireToday (recurring tasks, work logs, rhythms)', () => {
  it('never fires before the start date', () => {
    expect(shouldEntryFireToday(entry({ start_date: day(2026, 3, 10) }), day(2026, 3, 9))).toBe(false)
    expect(shouldEntryFireToday(entry({ start_date: day(2026, 3, 10) }), day(2026, 3, 10))).toBe(true)
  })

  it('daily every N counts days from the start date', () => {
    const e = entry({ every: 3, start_date: day(2026, 3, 1) })
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => shouldEntryFireToday(e, day(2026, 3, d)))).toEqual([
      true, false, false, true, false, false, true,
    ])
  })

  it('weekly: chosen weekdays, every N weeks from the start', () => {
    // 2026-03-02 is a Monday.
    const e = entry({ schedule_type: 'weekly', every: 2, days: [1, 3], start_date: day(2026, 3, 2) })
    expect(shouldEntryFireToday(e, day(2026, 3, 2))).toBe(true) // Mon, week 0
    expect(shouldEntryFireToday(e, day(2026, 3, 4))).toBe(true) // Wed, week 0
    expect(shouldEntryFireToday(e, day(2026, 3, 9))).toBe(false) // Mon, week 1
    expect(shouldEntryFireToday(e, day(2026, 3, 16))).toBe(true) // Mon, week 2
    expect(shouldEntryFireToday(e, day(2026, 3, 17))).toBe(false) // Tue
  })

  it('monthly: exact days, and negative days fall back to the last day of short months', () => {
    const exact = entry({ schedule_type: 'monthly', month_days: [31], start_date: day(2026, 1, 1) })
    expect(shouldEntryFireToday(exact, day(2026, 1, 31))).toBe(true)
    expect(shouldEntryFireToday(exact, day(2026, 2, 28))).toBe(false) // no 31st in Feb → missed
    const fallback = entry({ schedule_type: 'monthly', month_days: [-31], start_date: day(2026, 1, 1) })
    expect(shouldEntryFireToday(fallback, day(2026, 2, 28))).toBe(true)
    expect(shouldEntryFireToday(fallback, day(2026, 4, 30))).toBe(true)
    expect(shouldEntryFireToday(fallback, day(2026, 4, 29))).toBe(false)
    const every2 = entry({ schedule_type: 'monthly', every: 2, month_days: [1], start_date: day(2026, 1, 1) })
    expect(shouldEntryFireToday(every2, day(2026, 2, 1))).toBe(false)
    expect(shouldEntryFireToday(every2, day(2026, 3, 1))).toBe(true)
  })

  it('yearly: listed dates, every N years', () => {
    const e = entry({ schedule_type: 'yearly', every: 2, yearly_dates: [{ month: 4, day: 1 }], start_date: day(2026, 1, 1) })
    expect(shouldEntryFireToday(e, day(2026, 4, 1))).toBe(true)
    expect(shouldEntryFireToday(e, day(2027, 4, 1))).toBe(false)
    expect(shouldEntryFireToday(e, day(2028, 4, 1))).toBe(true)
    expect(shouldEntryFireToday(e, day(2028, 4, 2))).toBe(false)
  })

  it('end conditions: on a date (inclusive) and after N occurrences', () => {
    const onDate = entry({ end_condition: 'on_date', end_date: day(2026, 3, 5) })
    expect(shouldEntryFireToday(onDate, day(2026, 3, 5))).toBe(true)
    expect(shouldEntryFireToday(onDate, day(2026, 3, 6))).toBe(false)
    const afterN = entry({ end_condition: 'after_n', end_after: 3, occurrence_count: 2 })
    expect(shouldEntryFireToday(afterN, day(2026, 3, 5))).toBe(true)
    expect(shouldEntryFireToday({ ...afterN, occurrence_count: 3 }, day(2026, 3, 5))).toBe(false)
  })
})

describe('entryOccursOn (calendar-date form, used by workflow schedules)', () => {
  it('agrees with shouldEntryFireToday on the same calendar days', () => {
    const e = entry({ schedule_type: 'monthly', month_days: [-30, 15], every: 1, start_date: day(2026, 1, 1) })
    const start = { year: 2026, month: 1, day: 1 }
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const probe = new Date(2026, m - 1, d, 12)
        if (probe.getMonth() !== m - 1) continue
        expect(entryOccursOn(e, { year: 2026, month: m, day: d }, start, null)).toBe(shouldEntryFireToday(e, probe))
      }
    }
  })
})
