'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MEETING_STATUS_META, type Meeting } from '@/lib/types/meetings'
import { meetingsApi, type ExternalGEvent } from '@/lib/api/meetings'
import { fmtTime } from './shared'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MeetingCalendarView({
  meetings,
  onSelect,
  orgId,
  googleEnabled,
}: {
  meetings: Meeting[]
  onSelect: (id: string) => void
  orgId?: string
  googleEnabled?: boolean
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  // Reverse view: the user's own external Google events for the visible month.
  const [external, setExternal] = useState<ExternalGEvent[]>([])
  useEffect(() => {
    if (!googleEnabled || !orgId) {
      setExternal([])
      return
    }
    let alive = true
    const from = new Date(cursor.year, cursor.month, 1, 0, 0, 0).toISOString()
    const to = new Date(cursor.year, cursor.month + 1, 0, 23, 59, 59).toISOString()
    meetingsApi
      .googleEvents(orgId, from, to)
      .then((r) => { if (alive) setExternal(r.events ?? []) })
      .catch(() => { if (alive) setExternal([]) })
    return () => { alive = false }
  }, [googleEnabled, orgId, cursor.year, cursor.month])

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

  const externalByDate = useMemo(() => {
    const map = new Map<string, ExternalGEvent[]>()
    for (const e of external) {
      let d: Date
      if (e.allDay) {
        const [y, mo, da] = e.start.slice(0, 10).split('-').map(Number)
        d = new Date(y, (mo ?? 1) - 1, da ?? 1)
      } else {
        d = new Date(e.start)
      }
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return map
  }, [external])

  const firstDay = new Date(cursor.year, cursor.month, 1).getDay()
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const today = new Date()
  const isToday = (day: number) => today.getFullYear() === cursor.year && today.getMonth() === cursor.month && today.getDate() === day

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.month + delta
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
    })
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[18px] font-semibold text-[#0F172A]">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-[6px] hover:bg-[#F1F5F9] text-[#475569]"><ChevronLeft size={18} /></button>
          <button onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })} className="px-3 py-1.5 text-sm font-medium rounded-[6px] hover:bg-[#F1F5F9] text-[#475569]">Today</button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-[6px] hover:bg-[#F1F5F9] text-[#475569]"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px bg-[#E2E8F0] border border-[#E2E8F0] rounded-[8px] overflow-hidden">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-[#F8FAFC] text-center text-xs font-semibold text-[#475569] py-2">{w}</div>
        ))}
        {cells.map((day, i) => {
          const items = day ? byDate.get(`${cursor.year}-${cursor.month}-${day}`) ?? [] : []
          const ext = day ? externalByDate.get(`${cursor.year}-${cursor.month}-${day}`) ?? [] : []
          const meetingCap = ext.length ? 2 : 3
          return (
            <div key={i} className="bg-white min-h-[96px] p-1.5 align-top">
              {day && (
                <>
                  <div className={['text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full', isToday(day) ? 'bg-[#2563EB] text-white' : 'text-[#475569]'].join(' ')}>{day}</div>
                  <div className="flex flex-col gap-1">
                    {items.slice(0, meetingCap).map((m) => {
                      const meta = MEETING_STATUS_META[m.status]
                      return (
                        <button
                          key={m.id}
                          onClick={() => onSelect(m.id)}
                          className="w-full text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate"
                          style={{ backgroundColor: meta.bg, color: meta.text }}
                          title={m.title}
                        >
                          {fmtTime(m.scheduled_start)} {m.title}
                        </button>
                      )
                    })}
                    {items.length > meetingCap && <span className="text-[11px] text-[#94A3B8] px-1">+{items.length - meetingCap} more</span>}
                    {/* External Google events — read-only, muted; click opens Google. */}
                    {ext.slice(0, 2).map((e) => (
                      <button
                        key={e.googleEventId}
                        onClick={() => { if (e.htmlLink) window.open(e.htmlLink, '_blank', 'noopener') }}
                        className="w-full text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[#64748B] flex items-center gap-1"
                        title={`Google Calendar: ${e.title}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] shrink-0" />
                        <span className="truncate">{e.allDay ? '' : `${fmtTime(e.start)} `}{e.title}</span>
                      </button>
                    ))}
                    {ext.length > 2 && <span className="text-[11px] text-[#94A3B8] px-1">+{ext.length - 2} more from Google</span>}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {googleEnabled && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[#64748B]">
          <span className="w-2.5 h-2.5 rounded-full border border-dashed border-[#CBD5E1] bg-[#F8FAFC]" />
          Dashed items are your Google Calendar events (read-only). Meetings created here are mirrored to Google automatically.
        </div>
      )}
    </div>
  )
}
