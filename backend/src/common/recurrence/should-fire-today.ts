// Shared recurrence helper — decides whether a recurrence schedule entry fires on a
// given day. Used by the recurring-task spawn engine, the Work Log demanded-log
// spawner, meeting rhythms and workflow schedules so the date math lives in exactly
// one place (`entryOccursOn`).
//
// Uses day-from-start-date modulo arithmetic (not RRULE). All end conditions are
// checked before the schedule itself.

export interface RecurrenceEntry {
  start_date: Date;
  schedule_type: string; // 'daily' | 'weekly' | 'monthly' | 'yearly'
  every: number;
  days: unknown; // number[]   (weekly: 0-6)
  month_days: unknown; // number[]   (monthly: 1-31; -N = day N, or the month's last day when shorter)
  yearly_dates: unknown; // { month: number; day: number }[]
  end_condition: string; // 'never' | 'on_date' | 'after_n'
  end_date: Date | null;
  end_after: number | null;
  occurrence_count: number;
}

/** A zone-less calendar date. month is 1–12. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;

function serial(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function compare(a: CalendarDate, b: CalendarDate): number {
  return serial(a) - serial(b);
}

/**
 * Does `entry` fire on calendar day `today`? `start` / `end` are the entry's start and
 * end dates as calendar days in the SAME frame as `today` (the caller decides the
 * frame: server-local for tasks, the org's time zone for workflows). `end` is only
 * read when the entry ends on a date.
 */
export function entryOccursOn(
  entry: RecurrenceEntry,
  today: CalendarDate,
  start: CalendarDate,
  end: CalendarDate | null,
): boolean {
  if (compare(today, start) < 0) return false;

  if (entry.end_condition === 'on_date' && end) {
    if (compare(today, end) > 0) return false;
  }
  if (entry.end_condition === 'after_n' && entry.end_after !== null && entry.end_after !== undefined) {
    if (entry.occurrence_count >= entry.end_after) return false;
  }

  const daysDiff = Math.round((serial(today) - serial(start)) / DAY_MS);
  const todayDow = new Date(serial(today)).getUTCDay();
  const every = entry.every > 0 ? entry.every : 1;

  switch (entry.schedule_type) {
    case 'daily':
      return daysDiff % every === 0;

    case 'weekly': {
      const weeksDiff = Math.floor(daysDiff / 7);
      if (weeksDiff % every !== 0) return false;
      const days = entry.days as number[];
      return Array.isArray(days) && days.includes(todayDow);
    }

    case 'monthly': {
      const monthDays = entry.month_days as number[];
      if (!Array.isArray(monthDays)) return false;
      const isLastDay = today.day === daysInMonth(today.year, today.month);
      // A selected day matches today if it is exactly today's date, or (negative =
      // "fall back to the last day") today is the month's last day and the selected
      // day is past it.
      const hasMatch = monthDays.some((d) => {
        if (d < 0) {
          const targetDay = Math.abs(d);
          return today.day === targetDay || (isLastDay && targetDay > today.day);
        }
        return today.day === d;
      });
      if (!hasMatch) return false;
      const monthsDiff = (today.year - start.year) * 12 + (today.month - start.month);
      return monthsDiff % every === 0;
    }

    case 'yearly': {
      const yearlyDates = entry.yearly_dates as { month: number; day: number }[];
      if (!Array.isArray(yearlyDates)) return false;
      const matches = yearlyDates.some((d) => d.month === today.month && d.day === today.day);
      if (!matches) return false;
      return (today.year - start.year) % every === 0;
    }

    default:
      return false;
  }
}

/** The server-local calendar day of an instant (the recurring-task frame). */
function localCalendarDate(d: Date): CalendarDate {
  const x = new Date(d);
  return { year: x.getFullYear(), month: x.getMonth() + 1, day: x.getDate() };
}

/** Does `entry` fire on the server-local calendar day of `now`? */
export function shouldEntryFireToday(entry: RecurrenceEntry, now: Date = new Date()): boolean {
  return entryOccursOn(
    entry,
    localCalendarDate(now),
    localCalendarDate(entry.start_date),
    entry.end_date ? localCalendarDate(entry.end_date) : null,
  );
}
