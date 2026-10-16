'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { holidaysApi } from '@/lib/api/holidays'
import { getNow } from '@/lib/clock'
import type { NonWorkingDate } from '@/lib/types/holidays'
import Tooltip from '@/components/ui/tooltip'

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface Props {
  orgId: string
  deptId?: string
  userId?: string
  refreshKey?: number
}

export default function HolidayCalendar({ orgId, deptId, userId, refreshKey }: Props) {
  const today = getNow()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [nonWorking, setNonWorking] = useState<NonWorkingDate[]>([])

  const fetchRange = useCallback(async () => {
    const from = new Date(year, month, 1).toISOString().slice(0, 10)
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10)
    try {
      const res = await holidaysApi.getRange(orgId, from, to, { deptId, userId })
      setNonWorking(res?.non_working_dates ?? (Array.isArray(res) ? res : []))
    } catch {
      setNonWorking([])
    }
  }, [orgId, deptId, userId, year, month])

  useEffect(() => { fetchRange() }, [fetchRange, refreshKey])

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

  const nonWorkingMap = new Map<string, NonWorkingDate>()
  for (const d of (nonWorking ?? [])) nonWorkingMap.set(d.date, d)

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
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-text-primary">
          {MONTHS[month]} {year}
        </span>
        <button
          type="button"
          onClick={next}
          className="p-1.5 rounded-md hover:bg-surface-control text-text-secondary transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-text-muted py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const nw = nonWorkingMap.get(dateStr)
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          return (
            <Tooltip key={i} label={nw ? nw.name : undefined}>
              <div
                className={[
                  'relative flex items-center justify-center h-8 rounded-md text-xs cursor-default transition-colors',
                  nw ? 'bg-danger-bg text-danger font-medium' : 'text-text-secondary hover:bg-surface-sunken',
                  isToday ? 'ring-2 ring-primary ring-inset' : '',
                ].join(' ')}
              >
                {day}
                {nw && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-danger" />
                )}
              </div>
            </Tooltip>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-danger-bg border border-danger-border" />
          Non-working
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-primary" />
          Today
        </span>
      </div>
    </div>
  )
}
