'use client'

import { useMemo, useState } from 'react'
import { MEETING_STATUS_META, type Meeting } from '@/lib/types/meetings'
import MonthDayPanel from './MonthDayPanel'
import type { TimeBlock } from '@/lib/api/time-blocks'
import { getNow } from '@/lib/clock'
import { fmtTime } from './shared'
import { useHoverTip } from '@/components/ui/useHoverTip'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MeetingCalendarView({
  anchor, meetings, blocks, onSelect, onCreate, onBlockSelect,
}: {
  anchor: Date
  meetings: Meeting[]
  blocks?: TimeBlock[]
  onSelect: (id: string) => void
  onCreate?: (dayIso: string) => void
  onBlockSelect?: (b: TimeBlock) => void
}) {
  // Month + year are driven by the shared page toolbar (‹ Today ›), so all views
  // share one navigation control rather than the calendar owning its own.
  const cursor = { year: anchor.getFullYear(), month: anchor.getMonth() }
  const [openDay, setOpenDay] = useState<Date | null>(null)
  const tip = useHoverTip()

  const byDate = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of meetings) {
      if (!m.scheduled_start) continue
      const d = new Date(m.scheduled_start)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return map
  }, [meetings])

  const blocksByDate = useMemo(() => {
    const map = new Map<string, TimeBlock[]>()
    for (const b of blocks ?? []) {
      const d = new Date(b.start_at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return map
  }, [blocks])

  const firstDay = new Date(cursor.year, cursor.month, 1).getDay()
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const today = getNow()
  const isToday = (day: number) => today.getFullYear() === cursor.year && today.getMonth() === cursor.month && today.getDate() === day

  const openDayMeetings = openDay ? byDate.get(`${openDay.getFullYear()}-${openDay.getMonth()}-${openDay.getDate()}`) ?? [] : []

  return (
    <div className="bg-white border border-border-light rounded-[12px] overflow-hidden">
      {/* Weekday header — outside the scroll body so the scrollbar starts BELOW it
          (like Day/Week). Both header and body reserve a stable scrollbar gutter so
          their columns stay aligned. */}
      <div className="grid grid-cols-7 gap-px bg-surface-control-pressed border-b border-primary-hover overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-primary text-center text-xs font-semibold uppercase tracking-wide text-white py-2.5">{w}</div>
        ))}
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)', minHeight: 420, scrollbarGutter: 'stable' }}>
        <div className="grid grid-cols-7 gap-px bg-surface-control-pressed">
        {cells.map((day, i) => {
          const items = day ? byDate.get(`${cursor.year}-${cursor.month}-${day}`) ?? [] : []
          const isOpen = day != null && openDay != null &&
            openDay.getFullYear() === cursor.year && openDay.getMonth() === cursor.month && openDay.getDate() === day
          return (
            <div
              key={i}
              // The WHOLE day block opens the side card — clicks on the events inside
              // bubble up here too (they're plain divs, not buttons), so anywhere works.
              onClick={day ? () => setOpenDay(new Date(cursor.year, cursor.month, day)) : undefined}
              className={[
                'bg-white min-h-[96px] p-1.5 align-top transition-colors',
                day ? 'cursor-pointer hover:bg-surface-sunken' : '',
                isOpen ? 'ring-2 ring-inset ring-primary' : '',
              ].join(' ')}
            >
              {day && (
                <>
                  <div className={['text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full', isToday(day) ? 'bg-primary text-white' : 'text-text-secondary'].join(' ')}>{day}</div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, 3).map((m) => {
                      const meta = MEETING_STATUS_META[m.status]
                      return (
                        <div
                          key={m.id}
                          className="w-full text-[11px] leading-tight rounded-xs px-1.5 py-1 truncate"
                          style={{ backgroundColor: meta.bg, color: meta.text }}
                          {...tip.bind(<div><div className="font-semibold">{m.title}</div><div className="text-white/70">{fmtTime(m.scheduled_start)}{m.scheduled_end ? ` – ${fmtTime(m.scheduled_end)}` : ''}</div></div>)}
                        >
                          {m.title}
                        </div>
                      )
                    })}
                    {items.length > 3 && <span className="text-[11px] text-primary-text font-medium px-1">+{items.length - 3} more</span>}
                    {(blocksByDate.get(`${cursor.year}-${cursor.month}-${day}`) ?? []).slice(0, 2).map((b) => (
                      <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); onBlockSelect?.(b) }} className="w-full text-left text-[11px] leading-tight rounded-xs px-1.5 py-1 truncate border border-dashed border-border bg-surface-sunken text-text-muted flex items-center gap-1 hover:brightness-95" {...tip.bind(<div><div className="font-semibold">{b.title}</div><div className="text-white/70">{b.all_day ? 'All day' : `${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}`} · Time-block</div></div>)}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] shrink-0" />
                        <span className="truncate">{b.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
        </div>
      </div>

      {openDay && (
        <MonthDayPanel
          day={openDay}
          meetings={openDayMeetings}
          onClose={() => setOpenDay(null)}
          onSelect={onSelect}
          onCreate={onCreate}
        />
      )}
      {tip.portal}
    </div>
  )
}
