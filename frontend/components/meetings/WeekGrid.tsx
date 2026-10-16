'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Video, MapPin, Users, Repeat, ExternalLink, ArrowUpRight, X } from 'lucide-react'
import type { Meeting } from '@/lib/types/meetings'
import type { TimeBlock } from '@/lib/api/time-blocks'
import { getNow } from '@/lib/clock'
import { useHoverTip } from '@/components/ui/useHoverTip'
import { fmtTime } from './shared'

// ── geometry ───────────────────────────────────────────────────────────────────
const PX_PER_HOUR = 56
const DAY_PX = PX_PER_HOUR * 24
const SNAP_MIN = 15
const MIN_BLOCK_PX = 22
const SCROLL_TO_HOUR = 7.5 // where the scroll body rests on open

// ── date helpers ─────────────────────────────────────────────────────────────
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function mondayOf(d: Date): Date {
  const x = startOfDay(d)
  const off = (x.getDay() + 6) % 7 // 0 = Monday
  return addDays(x, -off)
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

// ── colour by meaning ────────────────────────────────────────────────────────
interface BlockLook {
  fill: string
  stripe: string
  text: string
  strike: boolean
  live: boolean
  rhythm: boolean
}
function look(m: Meeting): BlockLook {
  if (m.status === 'cancelled') return { fill: '#F1F5F9', stripe: '#CBD5E1', text: '#94A3B8', strike: true, live: false, rhythm: false }
  if (m.status === 'closed') return { fill: '#F1F5F9', stripe: '#94A3B8', text: '#475569', strike: true, live: false, rhythm: false }
  if (m.status === 'in_progress') return { fill: '#DCFCE7', stripe: '#16A34A', text: '#166534', strike: false, live: true, rhythm: false }
  if (m.rhythm_id) return { fill: '#F5F3FF', stripe: '#7C3AED', text: '#6D28D9', strike: false, live: false, rhythm: true }
  return { fill: '#EFF6FF', stripe: '#2563EB', text: '#1D4ED8', strike: false, live: false, rhythm: false }
}

// ── per-day overlap layout ───────────────────────────────────────────────────
interface Positioned {
  m: Meeting
  startMs: number
  endMs: number
  col: number
  cols: number
}
function layoutDay(items: { m: Meeting; startMs: number; endMs: number }[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const out: Positioned[] = []
  let cluster: typeof sorted = []
  let clusterMaxEnd = -Infinity
  const flush = () => {
    if (!cluster.length) return
    const colEnds: number[] = []
    const colOf = new Map<(typeof cluster)[number], number>()
    for (const ev of cluster) {
      let c = colEnds.findIndex((end) => end <= ev.startMs)
      if (c === -1) { c = colEnds.length; colEnds.push(ev.endMs) } else { colEnds[c] = ev.endMs }
      colOf.set(ev, c)
    }
    const cols = colEnds.length
    for (const ev of cluster) out.push({ ...ev, col: colOf.get(ev)!, cols })
    cluster = []
    clusterMaxEnd = -Infinity
  }
  for (const ev of sorted) {
    if (cluster.length && ev.startMs >= clusterMaxEnd) flush()
    cluster.push(ev)
    clusterMaxEnd = Math.max(clusterMaxEnd, ev.endMs)
  }
  flush()
  return out
}

// ── component ────────────────────────────────────────────────────────────────
export default function WeekGrid({
  meetings,
  blocks,
  anchor,
  view,
  weekDays,
  onSelect,
  onCreateAt,
  onSelectDay,
  onBlockSelect,
}: {
  meetings: Meeting[]
  blocks?: TimeBlock[]
  anchor: Date
  view: 'day' | 'week'
  weekDays: 5 | 7
  onSelect: (id: string) => void
  onCreateAt?: (startIso: string) => void
  onSelectDay?: (d: Date) => void
  onBlockSelect?: (b: TimeBlock) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const tip = useHoverTip()
  const [now, setNow] = useState<Date>(() => getNow())

  // live "now" line — tick every minute
  useEffect(() => {
    const t = setInterval(() => setNow(getNow()), 60_000)
    return () => clearInterval(t)
  }, [])

  // rest the scroll body around working hours on first paint / view change
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * PX_PER_HOUR
  }, [view, weekDays])

  const days = useMemo<Date[]>(() => {
    if (view === 'day') return [startOfDay(anchor)]
    const start = mondayOf(anchor)
    return Array.from({ length: weekDays }, (_, i) => addDays(start, i))
  }, [anchor, view, weekDays])

  // meetings positioned per visible day
  const perDay = useMemo(() => {
    return days.map((day) => {
      const items = meetings
        .filter((m) => m.scheduled_start && sameDay(new Date(m.scheduled_start), day))
        .map((m) => {
          const s = new Date(m.scheduled_start!)
          const e = m.scheduled_end ? new Date(m.scheduled_end) : new Date(s.getTime() + 30 * 60000)
          return { m, startMs: minutesFromMidnight(s), endMs: Math.max(minutesFromMidnight(s) + SNAP_MIN, minutesFromMidnight(e)) }
        })
      return layoutDay(items)
    })
  }, [days, meetings])

  // Time-blocks (the user's own availability) positioned per visible day. Shown
  // muted and behind meetings; display-only here (manage from the list/Google).
  const perDayBlocks = useMemo(() => {
    return days.map((day) => {
      return (blocks ?? [])
        .filter((b) => {
          const s = new Date(b.start_at)
          const e = new Date(b.end_at)
          return sameDay(s, day) || (s < day && e > day)
        })
        .map((b) => {
          const s = new Date(b.start_at)
          const e = new Date(b.end_at)
          const startMs = b.all_day ? 0 : sameDay(s, day) ? minutesFromMidnight(s) : 0
          const endMs = b.all_day ? 24 * 60 : sameDay(e, day) ? Math.max(startMs + SNAP_MIN, minutesFromMidnight(e)) : 24 * 60
          return { b, startMs, endMs }
        })
    })
  }, [days, blocks])

  const openMeeting = useMemo(() => meetings.find((m) => m.id === openId) ?? null, [meetings, openId])

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (!onCreateAt) return
    // ignore clicks that land on a block (blocks stopPropagation), this is bare background
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    let mins = Math.round((y / PX_PER_HOUR) * 60 / SNAP_MIN) * SNAP_MIN
    mins = Math.max(0, Math.min(23 * 60 + 45, mins))
    const start = new Date(day)
    start.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
    onCreateAt(start.toISOString())
  }

  const hourLabels = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] overflow-hidden">
      {/* Header sits ABOVE the scroll body (not inside it) so the scrollbar starts
          BELOW the header, never cutting through the blue band. Both the header and
          the scroll body reserve a stable scrollbar gutter, so their columns still
          line up (no drift). Full-width 7 columns match the month grid. */}
      <div className="flex border-b border-[#1D4ED8] bg-[#2563EB] overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
        <div className="w-[52px] shrink-0 border-r border-white/20" />
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
        {days.map((day) => {
          const today = sameDay(day, now)
          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDay?.(day)}
              className="py-2 text-center border-r border-white/20 last:border-r-0 transition-colors hover:bg-white/10"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white">
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              <div className="mt-0.5 flex items-center justify-center">
                <span className={['w-8 h-8 flex items-center justify-center rounded-full text-[18px] font-bold leading-none', today ? 'bg-white text-[#2563EB]' : 'text-white'].join(' ')}>
                  {day.getDate()}
                </span>
              </div>
            </button>
          )
        })}
        </div>
      </div>

      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)', minHeight: 420, scrollbarGutter: 'stable' }}>
        {/* time body */}
        <div className="flex relative" style={{ height: DAY_PX }}>
          {/* time rail — dedicated gutter so hour labels never overlap events */}
          <div className="w-[52px] shrink-0 border-r border-[#E2E8F0] relative">
            {hourLabels.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] font-medium text-[#475569]" style={{ top: h * PX_PER_HOUR }}>
                {h === 0 ? '' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {/* day columns */}
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
            {days.map((day, di) => {
              const today = sameDay(day, now)
              return (
                <div
                  key={day.toISOString()}
                  className={['relative border-r border-[#E2E8F0] last:border-r-0', onCreateAt ? 'cursor-pointer' : ''].join(' ')}
                  style={{ height: DAY_PX, background: today ? 'rgba(239,246,255,0.4)' : undefined }}
                  onClick={(e) => handleColumnClick(day, e)}
                >
                  {/* hour lines */}
                  {hourLabels.map((h) => (
                    <div key={h}>
                      <div className="absolute left-0 right-0 border-t border-[#CBD5E1]" style={{ top: h * PX_PER_HOUR }} />
                      <div className="absolute left-0 right-0 border-t border-[#E9EEF4]" style={{ top: h * PX_PER_HOUR + PX_PER_HOUR / 2 }} />
                    </div>
                  ))}

                  {/* now line */}
                  {today && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: (minutesFromMidnight(now) / 60) * PX_PER_HOUR }}>
                      <div className="h-[2px] bg-[#EF4444]" />
                      <div className="absolute left-[-3px] top-[-3px] w-2 h-2 rounded-full bg-[#EF4444]" />
                    </div>
                  )}

                  {/* time-blocks (own availability) — muted, behind meetings */}
                  {perDayBlocks[di].map(({ b, startMs, endMs }) => {
                    const top = (startMs / 60) * PX_PER_HOUR
                    const height = Math.max(MIN_BLOCK_PX, ((endMs - startMs) / 60) * PX_PER_HOUR - 2)
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onBlockSelect?.(b) }}
                        className="absolute rounded-[6px] overflow-hidden px-1.5 py-1 border-l-[3px] border-dashed text-left cursor-pointer hover:brightness-95"
                        style={{ top, height, left: '2px', right: '2px', background: 'repeating-linear-gradient(45deg,#F1F5F9,#F1F5F9 6px,#E2E8F0 6px,#E2E8F0 12px)', borderLeftColor: '#94A3B8', color: '#475569', zIndex: 6 }}
                        {...tip.bind(<div><div className="font-semibold">{b.title}</div><div className="text-white/70">{b.all_day ? 'All day' : `${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}`} · Time-block</div></div>)}
                      >
                        <div className="text-[12px] font-semibold truncate flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] shrink-0" />
                          <span className="truncate">{b.title}</span>
                        </div>
                        {height >= 40 && (
                          <div className="text-[11px] opacity-90 truncate">
                            {b.all_day ? 'All day' : `${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}`}
                          </div>
                        )}
                      </button>
                    )
                  })}

                  {/* blocks */}
                  {perDay[di].map(({ m, startMs, endMs, col, cols }) => {
                    const lk = look(m)
                    const top = (startMs / 60) * PX_PER_HOUR
                    const height = Math.max(MIN_BLOCK_PX, ((endMs - startMs) / 60) * PX_PER_HOUR - 2)
                    const widthPct = 100 / cols
                    const compact = height < 40
                    return (
                      <button
                        key={m.id}
                        onClick={(e) => { e.stopPropagation(); setOpenId((id) => (id === m.id ? null : m.id)) }}
                        className="absolute rounded-[6px] text-left overflow-hidden px-1.5 py-1 border-l-[3px] shadow-xs hover:shadow-md transition-shadow"
                        style={{
                          top,
                          height,
                          left: `calc(${col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: lk.fill,
                          borderLeftColor: lk.stripe,
                          color: lk.text,
                          zIndex: openId === m.id ? 30 : 10,
                        }}
                        {...tip.bind(<div><div className="font-semibold">{m.title}</div><div className="text-white/70">{fmtTime(m.scheduled_start)}{m.scheduled_end ? ` – ${fmtTime(m.scheduled_end)}` : ''}</div></div>)}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          {lk.live && <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse shrink-0" />}
                          {lk.rhythm && <Repeat size={10} className="shrink-0" />}
                          <span className={['text-[12px] font-semibold truncate', lk.strike ? 'line-through' : ''].join(' ')}>{m.title}</span>
                        </div>
                        {!compact && (
                          <div className="text-[11px] opacity-90 truncate">
                            {lk.live ? 'Live now' : `${fmtTime(m.scheduled_start)}${m.scheduled_end ? ` – ${fmtTime(m.scheduled_end)}` : ''}`}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* in-place popover */}
      {openMeeting && (
        <MeetingPopover meeting={openMeeting} onClose={() => setOpenId(null)} onOpen={() => { onSelect(openMeeting.id); setOpenId(null) }} />
      )}
      {tip.portal}
    </div>
  )
}

// ── block popover ────────────────────────────────────────────────────────────
function MeetingPopover({ meeting, onClose, onOpen }: { meeting: Meeting; onClose: () => void; onOpen: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const lk = look(meeting)
  const attendees = meeting._count?.attendees ?? meeting.attendees?.length ?? 0
  const decisions = meeting._count?.decisions ?? 0
  const actionItems = meeting._count?.action_items ?? 0
  const online = meeting.type !== 'offline'

  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-55" onClick={onClose} />
      {/* centered card — avoids scroll-drift; keeps the "no navigation" promise */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-56 w-[320px] bg-white border border-[#E2E8F0] rounded-[12px] shadow-xl p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: lk.stripe }} />
            <h4 className="text-[16px] font-semibold text-[#0F172A] leading-tight truncate">{meeting.title}</h4>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#475569] shrink-0"><X size={16} /></button>
        </div>

        <div className="text-sm text-[#475569] flex items-center gap-2 mb-1">
          {lk.live ? <span className="text-[#16A34A] font-medium">Live now</span>
            : <span>{fmtTime(meeting.scheduled_start)}{meeting.scheduled_end ? ` – ${fmtTime(meeting.scheduled_end)}` : ''}</span>}
        </div>
        <div className="text-sm text-[#475569] flex items-center gap-2 mb-3">
          {online ? <Video size={14} className="text-[#94A3B8]" /> : <MapPin size={14} className="text-[#94A3B8]" />}
          <span className="truncate">{online ? (meeting.location ? `Online · ${meeting.location}` : 'Online') : (meeting.location || 'In person')}</span>
        </div>

        {/* governance summary */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748B] border-t border-[#F1F5F9] pt-2 mb-3">
          <span className="inline-flex items-center gap-1"><Users size={12} /> {attendees} {attendees === 1 ? 'person' : 'people'}</span>
          {meeting.rhythm_id && <span className="inline-flex items-center gap-1 text-[#7C3AED]"><Repeat size={12} /> Rhythm</span>}
          {decisions > 0 && <span>{decisions} decision{decisions === 1 ? '' : 's'}</span>}
          {actionItems > 0 && <span>{actionItems} action item{actionItems === 1 ? '' : 's'}</span>}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onOpen} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px]">
            <ArrowUpRight size={15} /> Open meeting
          </button>
          {online && meeting.online_link && (
            <a href={meeting.online_link} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#EFF6FF] rounded-[8px]">
              <ExternalLink size={15} /> Join
            </a>
          )}
        </div>
      </div>
    </>
  )
}
