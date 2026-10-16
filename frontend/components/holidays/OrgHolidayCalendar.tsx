'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getNow } from '@/lib/clock'
import { parseLocalDate } from '@/lib/date'
import type { CalendarHoliday } from '@/lib/types/holidays'
import Tooltip from '@/components/ui/tooltip'

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface Props {
  /** Org working days as day-of-week indexes (0 = Sun … 6 = Sat). */
  workingDays: number[]
  holidays: CalendarHoliday[]
}

/**
 * Org-calendar month grid. Weekends (days of week outside the working days) and
 * holidays render in distinct styles with a legend. Use the arrows to navigate months.
 */
export default function OrgHolidayCalendar({ workingDays, holidays }: Props) {
  const today = getNow()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  function prev() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function next() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Holidays keyed by YYYY-MM-DD. Ranges (end_date) paint every day they cover.
  const iso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const holidayMap = new Map<string, CalendarHoliday>()
  for (const h of holidays) {
    const cur = parseLocalDate(h.date)
    // Distinct object — must not alias `cur`, or mutating cur below also moves last.
    const last = parseLocalDate(h.end_date ?? h.date)
    for (let guard = 0; cur <= last && guard < 400; guard++) {
      holidayMap.set(iso(cur), h)
      cur.setDate(cur.getDate() + 1)
    }
  }

  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="bg-surface border border-border-light rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prev}
          className="p-1.5 rounded-md hover:bg-surface-control text-text-secondary transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-body font-medium text-text-primary">
          {MONTHS[month]} {year}
        </span>
        <button
          type="button"
          onClick={next}
          className="p-1.5 rounded-md hover:bg-surface-control text-text-secondary transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-meta font-medium text-text-muted py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dow = new Date(year, month, day).getDay()
          const isWeekend = !workingDays.includes(dow)
          const holiday = holidayMap.get(dateStr)
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

          return (
            <Tooltip key={i} label={holiday ? holiday.name : isWeekend ? 'Weekend' : undefined}>
              <div
                className={[
                  'relative flex items-center justify-center h-8 rounded-md text-meta cursor-default transition-colors',
                  holiday
                    ? 'bg-danger-bg text-danger font-medium'
                    : isWeekend
                      ? 'bg-surface-control text-text-muted'
                      : 'text-text-secondary hover:bg-surface-sunken',
                  isToday ? 'ring-2 ring-primary ring-inset' : '',
                ].join(' ')}
              >
                {day}
                {holiday && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-danger" />
                )}
              </div>
            </Tooltip>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-danger-bg border border-danger-border" />
          Holiday
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-surface-control border border-border-light" />
          Weekend
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-primary" />
          Today
        </span>
      </div>
    </div>
  )
}
