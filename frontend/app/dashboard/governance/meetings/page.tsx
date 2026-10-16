'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, Plus, Search, Video, MapPin, Users, Repeat, BarChart3, ChevronLeft, ChevronRight, Columns3, CalendarClock, MoreHorizontal, Calendar } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi, type GoogleSyncStatus } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import GoogleCalendarConnect from '@/components/meetings/GoogleCalendarConnect'
import {
  TYPE_LABEL,
  type Meeting,
  type MeetingStatus,
  type MeetingType,
} from '@/lib/types/meetings'
import { StatusBadge, fmtDateTime, useMeetingPermissions } from '@/components/meetings/shared'
import MeetingCalendarView from '@/components/meetings/MeetingCalendarView'
import WeekGrid from '@/components/meetings/WeekGrid'
import CreateMeetingModal from '@/components/meetings/CreateMeetingModal'
import CreateTimeBlockModal from '@/components/meetings/CreateTimeBlockModal'
import { timeBlocksApi, type TimeBlock } from '@/lib/api/time-blocks'
import { getNow, isSimActive } from '@/lib/clock'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/Tooltip'
import StyledSelect from '@/components/ui/StyledSelect'
import AccessHiddenState from '@/components/ui/AccessHiddenState'

const selectClass =
  'border border-border rounded-[8px] px-3 py-2 text-sm text-text-primary bg-white focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'

type View = 'day' | 'week' | 'month' | 'list'
const VIEWS: { key: View; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'list', label: 'List' },
]

// ── date helpers ─────────────────────────────────────────────────────────────
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function mondayOf(d: Date) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)) }

function rangeFor(anchor: Date, view: View, weekDays: 5 | 7): { start: Date; end: Date } | null {
  if (view === 'day') return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) }
  if (view === 'week') { const s = mondayOf(anchor); return { start: s, end: addDays(s, weekDays) } }
  return null // month/list scope to everything loaded
}

function rangeLabel(anchor: Date, view: View, weekDays: 5 | 7): string {
  if (view === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  if (view === 'day') return anchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const s = mondayOf(anchor)
  const e = addDays(s, weekDays - 1)
  const sameMonth = s.getMonth() === e.getMonth()
  const sameYear = s.getFullYear() === e.getFullYear()
  const sTxt = s.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? undefined : 'short' })
  const eTxt = e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return sameYear ? `${sTxt} – ${eTxt}` : `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${eTxt}`
}

const meetingColumns: ResponsiveColumn<Meeting>[] = [
  {
    key: 'meeting',
    header: 'Meeting',
    primary: true,
    render: (m) => (
      <>
        <div className="flex items-center gap-2">
          {m.type === 'offline' ? <MapPin size={14} className="text-text-muted" /> : <Video size={14} className="text-text-muted" />}
          <span className="font-medium text-text-primary text-[15px]">{m.title}</span>
        </div>
        <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
          <span>{TYPE_LABEL[m.type]}</span>
          <span className="inline-flex items-center gap-1"><Users size={11} /> {m._count?.attendees ?? 0}</span>
          {m.rhythm_id && <span className="inline-flex items-center gap-1 text-text-secondary"><Repeat size={11} /> rhythm</span>}
        </div>
      </>
    ),
  },
  {
    key: 'when',
    header: 'When',
    desktopHiddenBelow: 'md',
    render: (m) => <span className="text-sm text-text-secondary">{fmtDateTime(m.scheduled_start)}</span>,
  },
  { key: 'organizer', header: 'Organizer', render: (m) => <span className="text-sm text-text-primary">{m.organizer?.name ?? '—'}</span> },
  { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
]

const LEGEND: { label: string; fill: string; stripe: string }[] = [
  { label: 'Meeting', fill: '#EFF6FF', stripe: '#2563EB' },
  { label: 'Rhythm', fill: '#F5F3FF', stripe: '#7C3AED' },
  { label: 'Live', fill: '#DCFCE7', stripe: '#16A34A' },
  { label: 'Closed', fill: '#F1F5F9', stripe: '#94A3B8' },
]

export default function MeetingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgId = user?.organizationId ?? ''
  const { perms, loading: permsLoading } = useMeetingPermissions(orgId)

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStart, setCreateStart] = useState<string | undefined>(undefined)
  const [blocks, setBlocks] = useState<TimeBlock[]>([])
  const [tbOpen, setTbOpen] = useState(false)
  const [tbStart, setTbStart] = useState<string | undefined>(undefined)
  const [editBlock, setEditBlock] = useState<TimeBlock | null>(null)
  // Header overflow menu (Governance, Google Calendar) + the Google modal it opens.
  const [menuOpen, setMenuOpen] = useState(false)
  const [gcalOpen, setGcalOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<MeetingStatus | ''>('')
  const [type, setType] = useState<MeetingType | ''>('')
  const [who, setWho] = useState<'all' | 'organizing' | 'attending'>('all')

  // Google Calendar connection (per-user). Owned here so the header button reflects status.
  const [gcal, setGcal] = useState<GoogleSyncStatus | null>(null)
  const refreshGcal = useCallback(() => {
    meetingsApi.googleStatus().then(setGcal).catch(() => setGcal({ connected: false, configured: false }))
  }, [])
  useEffect(() => { refreshGcal() }, [refreshGcal])
  // Handle the OAuth return (?gcal=connected|error): refresh status and clean the URL.
  useEffect(() => {
    const p = searchParams.get('gcal')
    if (!p) return
    if (p === 'connected') refreshGcal()
    const params = new URLSearchParams(searchParams.toString())
    params.delete('gcal')
    const qs = params.toString()
    router.replace('/dashboard/governance/meetings' + (qs ? '?' + qs : ''))
  }, [searchParams, refreshGcal, router])

  const [anchor, setAnchor] = useState<Date>(() => getNow())
  // The global sim clock (TimeTravelBar) syncs a beat AFTER first render, so the
  // calendar can briefly open on real time. Snap the anchor to the sim clock once
  // it becomes known — unless the user has already navigated (userMovedRef).
  const userMovedRef = useRef(false)
  useEffect(() => {
    if (userMovedRef.current) return
    const id = setInterval(() => {
      if (isSimActive()) { if (!userMovedRef.current) setAnchor(getNow()); clearInterval(id) }
    }, 200)
    const stop = setTimeout(() => clearInterval(id), 3000) // real-time orgs never activate
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [])
  const [weekDays, setWeekDays] = useState<5 | 7>(5)
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('meetings.weekDays') : null
    if (saved === '7') setWeekDays(7)
  }, [])
  function setWeekDaysPersist(v: 5 | 7) { setWeekDays(v); try { window.localStorage.setItem('meetings.weekDays', String(v)) } catch {} }

  const viewParam = searchParams.get('view')
  const view: View = (['day', 'week', 'month', 'list'] as View[]).includes(viewParam as View) ? (viewParam as View) : 'week'
  function setView(v: View) {
    const p = new URLSearchParams(searchParams.toString())
    if (v === 'week') p.delete('view')
    else p.set('view', v)
    router.replace(`/dashboard/governance/meetings?${p.toString()}`)
  }

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([meetingsApi.list(orgId).catch(() => []), getEmployees(orgId).catch(() => [])])
      .then(([ms, emps]: any[]) => {
        setMeetings(ms)
        setPeople((emps as any[]).map((e) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown', email: e.user?.email })))
      })
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  // Time-blocks for a generous window around the anchor (covers any view). The
  // backend also imports fresh Google events into blocks on this call.
  const loadBlocks = useCallback(() => {
    if (!orgId) return
    const from = startOfDay(addDays(anchor, -7))
    const to = addDays(startOfDay(anchor), 45)
    timeBlocksApi.list(orgId, from.toISOString(), to.toISOString()).then(setBlocks).catch(() => setBlocks([]))
  }, [orgId, anchor])
  useEffect(() => { loadBlocks() }, [loadBlocks])

  const filtered = useMemo(() => meetings.filter((m) => {
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
    if (status && m.status !== status) return false
    if (type && m.type !== type) return false
    if (who === 'organizing' && m.created_by_user_id !== user?.id) return false
    if (who === 'attending' && !(m.attendees ?? []).some((a) => a.user_id === user?.id)) return false
    return true
  }), [meetings, search, status, type, who, user?.id])

  // meetings within the visible calendar range (day/week); month & list see everything
  const rangeMeetings = useMemo(() => {
    const r = rangeFor(anchor, view, weekDays)
    if (!r) return filtered
    return filtered.filter((m) => {
      if (!m.scheduled_start) return false
      const t = new Date(m.scheduled_start).getTime()
      return t >= r.start.getTime() && t < r.end.getTime()
    })
  }, [filtered, anchor, view, weekDays])

  const stats = useMemo(() => {
    const src = view === 'month' || view === 'list' ? filtered : rangeMeetings
    const s = { total: src.length, scheduled: 0, live: 0, closed: 0 }
    for (const m of src) {
      if (m.status === 'scheduled') s.scheduled++
      else if (m.status === 'in_progress') s.live++
      else if (m.status === 'closed') s.closed++
    }
    return s
  }, [filtered, rangeMeetings, view])

  function navShift(dir: -1 | 1) {
    userMovedRef.current = true
    setAnchor((a) => {
      if (view === 'day') return addDays(a, dir)
      if (view === 'week') return addDays(a, dir * 7)
      const x = new Date(a); x.setMonth(x.getMonth() + dir); return x
    })
  }

  function openCreate(startIso?: string) { setCreateStart(startIso); setCreateOpen(true) }

  const showNav = view !== 'list'

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[26px] font-bold text-text-primary leading-tight">Meetings</h1>
          <p className="text-sm text-text-secondary mt-1">Schedule, run and record meetings — with action items and decisions.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Frequent actions grouped as a segmented control; occasional ones live under "More". */}
          <div className="relative" ref={menuRef}>
            <div className="inline-flex items-center border border-border-light rounded-[8px] overflow-hidden">
              <Link href="/dashboard/governance/meetings/rhythms" className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-sunken">
                <Repeat size={16} /> Rhythms
              </Link>
              <span className="w-px self-stretch bg-surface-control-pressed" aria-hidden />
              <Tooltip label="Block your time (only you see the name; colleagues see Busy)">
              <button onClick={() => { setEditBlock(null); setTbStart(undefined); setTbOpen(true) }} className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-sunken">
                <CalendarClock size={16} /> Time-Block
              </button>
              </Tooltip>
              <span className="w-px self-stretch bg-surface-control-pressed" aria-hidden />
              <button onClick={() => setMenuOpen((o) => !o)} aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} className={`px-2.5 py-2.5 text-text-secondary hover:bg-surface-sunken ${menuOpen ? 'bg-surface-control' : ''}`}>
                <MoreHorizontal size={18} />
              </button>
            </div>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full mt-2 w-56 bg-white border border-border-light rounded-[10px] shadow-lg p-1.5 z-50">
                <Link href="/dashboard/governance/meetings/reports" onClick={() => setMenuOpen(false)} role="menuitem" className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm text-text-secondary rounded-[6px] hover:bg-surface-control">
                  <BarChart3 size={16} className="text-text-muted" /> Governance
                </Link>
                {gcal?.configured && (
                  <button onClick={() => { setMenuOpen(false); setGcalOpen(true) }} role="menuitem" className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm text-text-secondary rounded-[6px] hover:bg-surface-control">
                    <Calendar size={16} className="text-text-muted" />
                    <span className="flex-1 text-left">Google Calendar</span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: gcal.connected ? '#22C55E' : '#CBD5E1' }} />
                  </button>
                )}
              </div>
            )}
          </div>
          {perms.write && (
            <button onClick={() => openCreate()} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px]">
              <Plus size={16} /> New Meeting
            </button>
          )}
          {/* Google Calendar modal — trigger is the "More" menu item; this only renders the dialog. */}
          <GoogleCalendarConnect status={gcal} onChanged={refreshGcal} renderTrigger={false} open={gcalOpen} onOpenChange={setGcalOpen} />
        </div>
      </div>

      {/* Toolbar: nav + range label (left) · view toggle (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {showNav && (
            <>
              <button aria-label="Previous" onClick={() => navShift(-1)} className="p-1.5 rounded-[6px] text-text-secondary hover:bg-surface-control"><ChevronLeft size={20} /></button>
              <button onClick={() => setAnchor(new Date())} className="px-1.5 text-[16px] font-semibold text-text-primary hover:text-primary-text transition-colors">Today</button>
              <button aria-label="Next" onClick={() => navShift(1)} className="p-1.5 rounded-[6px] text-text-secondary hover:bg-surface-control"><ChevronRight size={20} /></button>
              <span className="text-[16px] font-semibold text-text-primary ml-1.5">{rangeLabel(anchor, view, weekDays)}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view === 'week' && (
            <Tooltip label="Toggle work week / full week">
            <button
              onClick={() => setWeekDaysPersist(weekDays === 5 ? 7 : 5)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-secondary border border-border-light rounded-[8px] hover:bg-surface-sunken"
            >
              <Columns3 size={15} /> {weekDays === 5 ? '5-day' : '7-day'}
            </button>
            </Tooltip>
          )}
          <div className="flex rounded-[8px] border border-border-light overflow-hidden">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={['px-3 py-2 text-sm font-medium', view === v.key ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-surface-sunken'].join(' ')}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Thin stat strip + filter chips (no card wrapper) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-primary font-semibold">{stats.total} <span className="font-normal text-text-muted">{view === 'month' || view === 'list' ? 'total' : 'this ' + view}</span></span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-success" /> {stats.live} live</span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-primary" /> {stats.scheduled} scheduled</span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-[#94A3B8]" /> {stats.closed} closed</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input className={`${selectClass} pl-8 py-1.5 w-[180px]`} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <StyledSelect
            wrapperClassName="w-40" triggerClassName="py-1.5!"
            value={status} onChange={(v) => setStatus(v as any)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'closed', label: 'Closed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <StyledSelect
            wrapperClassName="w-36" triggerClassName="py-1.5!"
            value={type} onChange={(v) => setType(v as any)}
            options={[
              { value: '', label: 'All types' },
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'Offline' },
              { value: 'hybrid', label: 'Hybrid' },
            ]}
          />
          <StyledSelect
            wrapperClassName="w-44" triggerClassName="py-1.5!"
            value={who} onChange={(v) => setWho(v as any)}
            options={[
              { value: 'all', label: 'All meetings' },
              { value: 'organizing', label: 'Organized by me' },
              { value: 'attending', label: "I'm attending" },
            ]}
          />
        </div>
      </div>

      {/* Content */}
      {!permsLoading && !perms.read ? (
        <AccessHiddenState orgId={orgId} leaf="meetings" moduleLabel="Meetings" />
      ) : loading && (view === 'day' || view === 'week') ? (
        <div className="bg-white border border-border-light rounded-[12px] p-10 text-center text-sm text-text-secondary">Loading…</div>
      ) : view === 'day' || view === 'week' ? (
        <>
          <WeekGrid
            meetings={rangeMeetings}
            blocks={blocks}
            anchor={anchor}
            view={view}
            weekDays={weekDays}
            onSelect={(id) => router.push(`/dashboard/governance/meetings/${id}`)}
            onCreateAt={perms.write ? openCreate : undefined}
            onSelectDay={(d) => { setAnchor(d); setView('day') }}
            onBlockSelect={(b) => { setEditBlock(b); setTbStart(undefined); setTbOpen(true) }}
          />
          {/* legend */}
          <div className="flex flex-wrap items-center gap-4 mt-3 px-1 text-xs text-text-muted">
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-[3px] border-l-[3px]" style={{ background: l.fill, borderLeftColor: l.stripe }} />
                {l.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] border-l-[3px] border-dashed border-border-strong bg-surface-control" /> Your time-blocks</span>
            <span className="text-text-muted">Click an empty slot to schedule</span>
          </div>
        </>
      ) : view === 'month' ? (
        <MeetingCalendarView anchor={anchor} meetings={filtered} blocks={blocks} onSelect={(id) => router.push(`/dashboard/governance/meetings/${id}`)} onCreate={perms.write ? openCreate : undefined} onBlockSelect={(b) => { setEditBlock(b); setTbStart(undefined); setTbOpen(true) }} />
      ) : (
        <ResponsiveTable
          columns={meetingColumns}
          rows={filtered}
          rowKey={(m) => m.id}
          loading={loading}
          headerRowClassName="bg-primary border-b border-primary-hover"
          headerCellClassName="text-white bg-primary"
          maxBodyHeight="calc(100vh - 320px)"
          onRowClick={(m) => router.push(`/dashboard/governance/meetings/${m.id}`)}
          emptyState={
            <div className="bg-white border border-border-light rounded-[12px] p-12 text-center">
              <div className="w-14 h-14 rounded-[16px] bg-primary-subtle flex items-center justify-center text-primary-text mx-auto mb-3"><CalendarDays size={26} /></div>
              <h3 className="text-[18px] font-semibold text-text-primary">No meetings</h3>
              <p className="text-sm text-text-secondary mt-1">Create one to get started.</p>
            </div>
          }
        />
      )}

      <CreateMeetingModal isOpen={createOpen} onClose={() => setCreateOpen(false)} orgId={orgId} people={people} initialStart={createStart} onCreated={() => load()} />
      <CreateTimeBlockModal isOpen={tbOpen} onClose={() => { setTbOpen(false); setEditBlock(null) }} orgId={orgId} initialStart={tbStart} block={editBlock} onSaved={() => loadBlocks()} onDeleted={() => loadBlocks()} />
    </div>
  )
}
