'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Video, MapPin, Crown, CalendarDays, Plus } from 'lucide-react'
import type { Meeting } from '@/lib/types/meetings'
import { MEETING_STATUS_META } from '@/lib/types/meetings'
import { fmtTime } from './shared'

// ── initials avatar helpers (meeting-flavoured; host + declined aware) ──────────
const AVATAR_COLORS = ['bg-[#2563EB]', 'bg-[#7C3AED]', 'bg-[#059669]', 'bg-[#D97706]', 'bg-[#DC2626]', 'bg-[#0891B2]', 'bg-[#BE185D]']
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
function initials(name: string): string {
  const i = name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  return i || '?'
}

interface Person { id: string; name: string; isHost: boolean; declined: boolean }

function ParticipantAvatars({ people, max = 6 }: { people: Person[]; max?: number }) {
  if (people.length === 0) return null
  const visible = people.slice(0, max)
  const extra = people.length - visible.length
  return (
    <div className="flex -space-x-1.5">
      {visible.map((p) => (
        <div key={p.id} className="relative group/av">
          <div
            className={[
              'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 border-white',
              p.declined ? 'bg-[#F1F5F9] text-[#94A3B8] ring-1 ring-[#E2E8F0]' : `${avatarColor(p.name)} text-white`,
              p.isHost ? 'ring-2 ring-[#F59E0B]' : '',
            ].join(' ')}
          >
            {initials(p.name)}
          </div>
          {/* hover tooltip: full name + role in this meeting */}
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/av:block z-80">
            <div className="rounded-[8px] bg-[#0F172A] px-2.5 py-1.5 shadow-lg w-max max-w-[220px]">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-white whitespace-nowrap">{p.name}</p>
                <span
                  className={[
                    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    p.isHost ? 'bg-[#F59E0B] text-white' : p.declined ? 'bg-[#334155] text-[#CBD5E1]' : 'bg-[#2563EB] text-white',
                  ].join(' ')}
                >
                  {p.isHost ? 'Host' : p.declined ? "Won't make it" : 'Attending'}
                </span>
              </div>
            </div>
            <div className="mx-auto w-2 h-2 -mt-1 rotate-45 bg-[#0F172A]" />
          </div>
        </div>
      ))}
      {extra > 0 && (
        <div className="w-6 h-6 rounded-full bg-[#E2E8F0] flex items-center justify-center text-[9px] font-bold text-[#475569] border-2 border-white">+{extra}</div>
      )}
    </div>
  )
}

function peopleFor(m: Meeting): Person[] {
  const list: Person[] = (m.attendees ?? []).map((a) => ({
    id: a.user_id,
    name: a.user?.name ?? 'Unknown',
    isHost: a.is_organizer,
    declined: a.response === 'declined',
  }))
  // Ensure the host is present even if not in the attendee roster.
  if (m.organizer && !list.some((p) => p.isHost)) {
    list.unshift({ id: m.organizer.id, name: m.organizer.name, isHost: true, declined: false })
  }
  // Host first.
  return list.sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1))
}

export default function MonthDayPanel({
  day, meetings, onClose, onSelect, onCreate,
}: {
  day: Date
  meetings: Meeting[]
  onClose: () => void
  onSelect: (id: string) => void
  onCreate?: (dayIso: string) => void
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => { setMounted(true); const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t) }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  // Lock the page scroll while the card is open — the drawer body scrolls on its own,
  // but wheel/touch over the calendar behind must not scroll the whole page. Compensate
  // for the removed scrollbar so the layout doesn't jump.
  useEffect(() => {
    const html = document.documentElement
    const scrollbarW = window.innerWidth - html.clientWidth
    const prevOverflow = html.style.overflow
    const prevPad = document.body.style.paddingRight
    html.style.overflow = 'hidden'
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`
    return () => { html.style.overflow = prevOverflow; document.body.style.paddingRight = prevPad }
  }, [])

  function close() { setVisible(false); setTimeout(onClose, 200) }

  const dateLabel = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const sorted = [...meetings].sort((a, b) => (a.scheduled_start ?? '').localeCompare(b.scheduled_start ?? ''))

  if (!mounted) return null

  return createPortal(
    // Non-modal: the wrapper ignores pointer events so the calendar stays live —
    // clicking another day switches the card instead of closing it. Only the drawer
    // itself captures clicks. Close via X, Escape, or picking another day.
    <div className="fixed inset-0 z-70 pointer-events-none">
      {/* right drawer */}
      <div
        className={['pointer-events-auto absolute top-0 right-0 h-full w-[380px] max-w-[92vw] bg-white shadow-2xl border-l border-[#E2E8F0] flex flex-col transition-transform duration-200 ease-in-out', visible ? 'translate-x-0' : 'translate-x-full'].join(' ')}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-[#E2E8F0]">
          <div>
            <h3 className="text-[17px] font-semibold text-[#0F172A] leading-tight">{dateLabel}</h3>
            <p className="text-sm text-[#64748B] mt-0.5">{meetings.length} meeting{meetings.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={close} className="p-1 -mr-1 text-[#94A3B8] hover:text-[#475569]"><X size={18} /></button>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <div className="w-12 h-12 rounded-[14px] bg-[#EFF6FF] flex items-center justify-center text-[#2563EB] mb-3"><CalendarDays size={22} /></div>
              <p className="text-sm font-medium text-[#0F172A]">No meetings this day</p>
              {onCreate && (
                <button
                  onClick={() => { const d = new Date(day); d.setHours(10, 0, 0, 0); onCreate(d.toISOString()) }}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px]"
                >
                  <Plus size={14} /> Schedule a meeting
                </button>
              )}
            </div>
          ) : (
            sorted.map((m) => {
              const meta = MEETING_STATUS_META[m.status]
              const people = peopleFor(m)
              const host = people.find((p) => p.isHost)
              const online = m.type !== 'offline'
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  className="w-full text-left rounded-[10px] border border-[#E2E8F0] hover:border-[#2563EB] hover:shadow-xs transition-all p-3 bg-white"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.text }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-[#0F172A] leading-snug">{m.title}</p>
                      <p className="text-sm text-[#475569] mt-0.5 flex items-center gap-1.5">
                        {online ? <Video size={13} className="text-[#94A3B8]" /> : <MapPin size={13} className="text-[#94A3B8]" />}
                        {m.scheduled_start ? `${fmtTime(m.scheduled_start)}${m.scheduled_end ? ` – ${fmtTime(m.scheduled_end)}` : ''}` : 'No time set'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2.5">
                    <ParticipantAvatars people={people} />
                    {host && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#B45309] font-medium shrink-0">
                        <Crown size={12} /> {host.name.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
