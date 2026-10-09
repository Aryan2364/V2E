import { computeDueDeadline } from './deadline'

const IST = 'Asia/Kolkata'
// Thu 08 Oct 2026, 10:00 IST
const START = new Date('2026-10-08T04:30:00Z')
const iso = (d: Date) => d.toISOString()

describe('computeDueDeadline (step start + N days at a time, org tz)', () => {
  it('adds days to the start date at the due time', () => {
    expect(iso(computeDueDeadline(START, 2, '18:00', IST))).toBe('2026-10-10T12:30:00.000Z')
  })

  it('0 days = the same day when the time is still ahead', () => {
    expect(iso(computeDueDeadline(START, 0, '18:00', IST))).toBe('2026-10-08T12:30:00.000Z')
  })

  it('0 days with the time already past rolls to the next day (never born late)', () => {
    expect(iso(computeDueDeadline(START, 0, '09:00', IST))).toBe('2026-10-09T03:30:00.000Z')
  })

  it('uses the LOCAL start date (late evening UTC is already tomorrow in IST)', () => {
    const lateUtc = new Date('2026-10-08T20:00:00Z') // 01:30 IST on 9 Oct
    expect(iso(computeDueDeadline(lateUtc, 1, '18:00', IST))).toBe('2026-10-10T12:30:00.000Z')
  })

  it('falls back to 18:00 for an unreadable time and clamps days', () => {
    expect(iso(computeDueDeadline(START, 1, 'nope', IST))).toBe('2026-10-09T12:30:00.000Z')
    expect(iso(computeDueDeadline(START, -4, '18:00', IST))).toBe('2026-10-08T12:30:00.000Z')
  })

  it('handles DST zones', () => {
    // 2026-03-08 is the US spring-forward day.
    const ny = new Date('2026-03-07T15:00:00Z') // 10:00 EST Sat
    expect(iso(computeDueDeadline(ny, 1, '09:00', 'America/New_York'))).toBe('2026-03-08T13:00:00.000Z')
  })
})
