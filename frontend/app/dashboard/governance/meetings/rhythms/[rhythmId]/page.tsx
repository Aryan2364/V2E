'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Repeat, Pause, Play, Square, Clock, Users, CalendarClock, Pencil,
  CalendarDays, CheckCircle2, CalendarX2, ChevronRight, Video, MapPin,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import type { Meeting, MeetingRhythm } from '@/lib/types/meetings'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import CreateRhythmModal from '@/components/meetings/CreateRhythmModal'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import Tooltip from '@/components/ui/tooltip'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function cadence(r: MeetingRhythm): string {
  const e = r.schedule_entries?.[0]
  if (!e) return '—'
  const every = e.every > 1 ? `every ${e.every} ` : ''
  if (e.schedule_type === 'daily') return `${every ? every + 'days' : 'Daily'} at ${e.time}`
  if (e.schedule_type === 'weekly') return `${every ? 'Every ' + e.every + ' weeks' : 'Weekly'} · ${(e.days ?? []).map((d) => DOW[d]).join(', ')} at ${e.time}`
  if (e.schedule_type === 'monthly') return `Monthly · day ${(e.month_days ?? []).join(', ')} at ${e.time}`
  return `Yearly at ${e.time}`
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// The visible lifecycle of a single spawned occurrence.
type Bucket = 'upcoming' | 'in_progress' | 'held' | 'missed' | 'cancelled'
function bucketOf(m: Meeting, now: number): Bucket {
  if (m.status === 'cancelled') return 'cancelled'
  if (m.status === 'in_progress') return 'in_progress'
  if (m.status === 'closed') return 'held'
  // scheduled
  const start = m.scheduled_start ? new Date(m.scheduled_start).getTime() : 0
  return start && start < now ? 'missed' : 'upcoming'
}
const BUCKET_META: Record<Bucket, { label: string; bg: string; fg: string; border: string }> = {
  upcoming: { label: 'Upcoming', bg: 'var(--primary-subtle)', fg: 'var(--primary-text)', border: 'var(--primary-border)' },
  in_progress: { label: 'In progress', bg: 'var(--warning-bg)', fg: 'var(--warning)', border: 'var(--warning-border)' },
  held: { label: 'Held', bg: 'var(--success-bg)', fg: 'var(--success)', border: 'var(--success-border)' },
  missed: { label: 'Missed', bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'var(--danger-border)' },
  cancelled: { label: 'Cancelled', bg: 'var(--surface-control)', fg: 'var(--text-muted)', border: 'var(--border-light)' },
}

const STATUS_FILTERS: { key: 'all' | Bucket; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'held', label: 'Held' },
  { key: 'missed', label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
]

function StatCard({ icon, value, label, tint }: { icon: React.ReactNode; value: React.ReactNode; label: string; tint: string }) {
  return (
    <div className="bg-surface border border-border-light rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{ backgroundColor: tint }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[20px] font-medium text-text-primary leading-none">{value}</div>
        <div className="text-meta text-text-muted mt-1 truncate">{label}</div>
      </div>
    </div>
  )
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-xl p-4">
      <h3 className="text-[13px] font-medium text-text-secondary uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )
}

const AVATAR_COLORS = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i); return AVATAR_COLORS[h % AVATAR_COLORS.length] }
function initials(name: string) { return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?' }

export default function RhythmDetailPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const rhythmId = String(params?.rhythmId ?? '')
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()

  const [rhythm, setRhythm] = useState<MeetingRhythm | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [filter, setFilter] = useState<'all' | Bucket>('all')

  const load = useCallback(() => {
    if (!orgId || !rhythmId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      meetingsApi.getRhythm(orgId, rhythmId).catch(() => null),
      meetingsApi.list(orgId, { rhythm_id: rhythmId }).catch(() => [] as Meeting[]),
      getEmployees(orgId).catch(() => [] as any[]),
    ])
      .then(([r, ms, emps]) => {
        if (!r) { setNotFound(true); return }
        setRhythm(r)
        setMeetings(ms)
        setPeople((emps as any[]).map((e) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown', email: e.user?.email })))
      })
      .finally(() => setLoading(false))
  }, [orgId, rhythmId])

  useEffect(() => { load() }, [load])

  const nameOf = useMemo(() => new Map(people.map((p) => [p.user_id, p.name])), [people])
  const now = Date.now()

  const buckets = useMemo(() => {
    const counts: Record<Bucket, number> = { upcoming: 0, in_progress: 0, held: 0, missed: 0, cancelled: 0 }
    for (const m of meetings) counts[bucketOf(m, now)]++
    return counts
  }, [meetings, now])

  // Upcoming first (soonest at top), then past (most recent first).
  const sorted = useMemo(() => {
    const withBucket = meetings.map((m) => ({ m, b: bucketOf(m, now) }))
    const filtered = filter === 'all' ? withBucket : withBucket.filter((x) => x.b === filter)
    return filtered.sort((a, b) => {
      const ta = a.m.scheduled_start ? new Date(a.m.scheduled_start).getTime() : 0
      const tb = b.m.scheduled_start ? new Date(b.m.scheduled_start).getTime() : 0
      const aFuture = ta >= now, bFuture = tb >= now
      if (aFuture !== bFuture) return aFuture ? -1 : 1
      return aFuture ? ta - tb : tb - ta
    })
  }, [meetings, filter, now])

  async function toggleActive() {
    if (!rhythm) return
    try {
      const updated = rhythm.is_active ? await meetingsApi.pauseRhythm(orgId, rhythm.id) : await meetingsApi.resumeRhythm(orgId, rhythm.id)
      setRhythm(updated)
      addToast(rhythm.is_active ? 'Rhythm paused' : 'Rhythm resumed', 'success')
      load()
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }
  async function stop(mode: 'stop' | 'delete-future') {
    if (!rhythm) return
    try {
      await meetingsApi.removeRhythm(orgId, rhythm.id, mode)
      addToast('Rhythm stopped', 'success')
      setStopping(false)
      load()
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }

  if (loading) return <div className="p-8 text-center text-body text-text-secondary">Loading…</div>
  if (notFound || !rhythm) {
    return (
      <div className="max-w-2xl">
        <Link href="/dashboard/governance/meetings/rhythms" className="inline-flex items-center gap-1.5 text-body font-medium text-text-secondary hover:text-text-primary mb-4"><ArrowLeft size={15} /> Rhythms</Link>
        <div className="bg-surface border border-border-light rounded-xl p-12 text-center">
          <h3 className="text-[18px] font-medium text-text-primary">Rhythm not found</h3>
          <p className="text-body text-text-secondary mt-1">It may have been removed, or you don’t have access to it.</p>
        </div>
      </div>
    )
  }

  const attendeeIds = rhythm.attendee_user_ids ?? []
  const e = rhythm.schedule_entries?.[0]

  return (
    <div className="max-w-[1200px]">
      <Link href="/dashboard/governance/meetings/rhythms" className="inline-flex items-center gap-1.5 text-body font-medium text-text-secondary hover:text-text-primary w-fit mb-4"><ArrowLeft size={15} /> Rhythms</Link>

      {/* Sticky header: title + cadence + actions */}
      <div className="sticky top-0 z-10 bg-surface-sunken -mx-1 px-1 pb-4 mb-1">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[26px] font-medium text-text-primary leading-tight flex items-center gap-2">
              <Repeat size={22} className="text-text-secondary shrink-0" /> {rhythm.title}
              <span className="inline-flex items-center font-medium text-[12px] rounded-full px-2.5 py-0.5 border shrink-0"
                style={rhythm.is_active ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' } : { backgroundColor: 'var(--surface-control)', color: 'var(--text-secondary)', borderColor: 'var(--border-light)' }}>
                {rhythm.is_active ? 'Active' : 'Paused'}
              </span>
            </h1>
            <p className="text-body text-text-secondary mt-1 flex items-center gap-1.5"><Clock size={14} /> {cadence(rhythm)}</p>
          </div>
          {rhythm.can_manage && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg"><Pencil size={15} /> Edit</button>
              <Tooltip label={rhythm.is_active ? 'Pause' : 'Resume'}>
              <button onClick={toggleActive} className="inline-flex items-center gap-1.5 px-3 py-2 text-body font-medium text-text-secondary border border-border-light hover:bg-surface-control rounded-lg">
                {rhythm.is_active ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}
              </button>
              </Tooltip>
              <Tooltip label="Stop"><button onClick={() => setStopping(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-body font-medium text-danger border border-danger-border hover:bg-danger-bg rounded-lg"><Square size={15} /> Stop</button></Tooltip>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<CalendarDays size={18} className="text-primary-text" />} value={meetings.length} label="Total occurrences" tint="var(--primary-subtle)" />
        <StatCard icon={<CheckCircle2 size={18} className="text-success" />} value={buckets.held} label="Held" tint="var(--success-bg)" />
        <StatCard icon={<CalendarClock size={18} className="text-text-secondary" />} value={buckets.upcoming} label="Upcoming" tint="var(--surface-control)" />
        <StatCard icon={<CalendarX2 size={18} className="text-danger" />} value={buckets.missed + buckets.cancelled} label="Missed / cancelled" tint="var(--danger-bg)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
        {/* Instances list */}
        <div className="bg-surface border border-border-light rounded-xl flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-light flex-wrap">
            <h2 className="text-[15px] font-medium text-text-primary">Meetings <span className="text-text-muted font-normal">({sorted.length})</span></h2>
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 text-meta font-medium rounded-[6px] border transition-colors ${filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-surface text-text-secondary border-border-light hover:border-border'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-[14px] bg-surface-control flex items-center justify-center text-text-secondary mx-auto mb-3"><CalendarDays size={22} /></div>
              <p className="text-body font-medium text-text-primary">No meetings {filter === 'all' ? 'yet' : `in “${STATUS_FILTERS.find((f) => f.key === filter)?.label}”`}</p>
              <p className="text-meta text-text-muted mt-1">Occurrences spawn automatically up to 60 days ahead.</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-control max-h-[640px] overflow-y-auto">
              {sorted.map(({ m, b }) => {
                const meta = BUCKET_META[b]
                return (
                  <button key={m.id} onClick={() => router.push(`/dashboard/governance/meetings/${m.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken transition-colors">
                    <div className="w-11 shrink-0 text-center">
                      <div className="text-meta font-medium text-text-muted uppercase">{m.scheduled_start ? new Date(m.scheduled_start).toLocaleDateString(undefined, { month: 'short' }) : '—'}</div>
                      <div className="text-[18px] font-medium text-text-primary leading-none">{m.scheduled_start ? new Date(m.scheduled_start).getDate() : '·'}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-medium text-text-primary truncate">{m.title}</p>
                      <p className="text-meta text-text-muted flex items-center gap-1.5 mt-0.5">
                        <span>{fmtDate(m.scheduled_start)}{fmtTime(m.scheduled_start) ? ` · ${fmtTime(m.scheduled_start)}` : ''}</span>
                        <span className="inline-flex items-center gap-1">· {m.type === 'offline' ? <MapPin size={11} /> : <Video size={11} />} {m._count?.attendees ?? (m.attendees?.length ?? 0)}</span>
                      </p>
                    </div>
                    <span className="inline-flex items-center font-medium text-meta rounded-full px-2.5 py-0.5 border shrink-0" style={{ backgroundColor: meta.bg, color: meta.fg, borderColor: meta.border }}>{meta.label}</span>
                    <ChevronRight size={16} className="text-muted shrink-0" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <SidebarCard title="Schedule">
            <div className="flex flex-col gap-2 text-body text-text-secondary">
              <div className="flex items-center gap-2"><Clock size={14} className="text-text-muted" /> {cadence(rhythm)}</div>
              <div className="flex items-center gap-2"><CalendarClock size={14} className="text-text-muted" /> Next: {rhythm.is_active ? fmtDate(rhythm.next_run) : 'Paused'}</div>
              {e?.start_date && <div className="flex items-center gap-2 text-text-muted"><CalendarDays size={14} className="text-text-muted" /> Since {fmtDate(e.start_date)}</div>}
              {e && e.end_condition === 'on_date' && e.end_date && <div className="text-meta text-text-muted">Ends {fmtDate(e.end_date)}</div>}
              {e && e.end_condition === 'after_n' && e.end_after != null && <div className="text-meta text-text-muted">Ends after {e.end_after} occurrences</div>}
            </div>
          </SidebarCard>

          <SidebarCard title="Format">
            <div className="flex flex-col gap-2 text-body text-text-secondary">
              <div className="flex items-center gap-2">
                {rhythm.type === 'offline' ? <MapPin size={14} className="text-text-muted" /> : <Video size={14} className="text-text-muted" />}
                {rhythm.type === 'offline' ? 'In person' : rhythm.type === 'hybrid' ? 'Hybrid' : 'Online'} · {rhythm.duration_min} min
              </div>
              {rhythm.type !== 'offline' && rhythm.online_link && <a href={rhythm.online_link} target="_blank" rel="noreferrer" className="text-body text-primary-text hover:underline truncate">{rhythm.online_link}</a>}
              {rhythm.type !== 'online' && rhythm.location && <div className="text-body text-text-muted">{rhythm.location}</div>}
            </div>
          </SidebarCard>

          <SidebarCard title={`Attendees · ${attendeeIds.length + 1}`}>
            <div className="flex flex-col gap-2">
              {/* Host is always in. */}
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(rhythm.created_by_name ?? 'Host')}`}>{initials(rhythm.created_by_name ?? 'H')}</div>
                <span className="text-body text-text-primary truncate">{rhythm.created_by_user_id === user?.id ? 'You' : (rhythm.created_by_name ?? 'Host')}</span>
                <span className="text-meta font-medium rounded-[4px] px-1.5 py-0.5 bg-primary-subtle text-primary-text border border-primary-border ml-auto shrink-0">Host</span>
              </div>
              {attendeeIds.map((id) => {
                const name = nameOf.get(id) ?? 'Unknown'
                const opt = (rhythm.optional_user_ids ?? []).includes(id)
                return (
                  <div key={id} className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(name)}`}>{initials(name)}</div>
                    <span className="text-body text-text-secondary truncate">{name}</span>
                    {opt && <span className="text-meta font-medium rounded-[4px] px-1.5 py-0.5 bg-surface-control text-text-muted ml-auto shrink-0">Optional</span>}
                  </div>
                )
              })}
              {attendeeIds.length === 0 && <p className="text-meta text-text-muted">No other attendees — just the host.</p>}
            </div>
          </SidebarCard>

          {rhythm.agenda && (
            <SidebarCard title="Standing agenda">
              <p className="text-body text-text-secondary whitespace-pre-wrap">{rhythm.agenda}</p>
            </SidebarCard>
          )}
        </div>
      </div>

      <CreateRhythmModal isOpen={editing} onClose={() => setEditing(false)} orgId={orgId} people={people} rhythm={rhythm} onCreated={() => { setEditing(false); load() }} />

      <Modal isOpen={stopping} onClose={() => setStopping(false)} title="Stop rhythm" size="sm">
        <p className="text-body text-text-primary">Stop “{rhythm.title}”? No new occurrences will be created. Past meetings are kept.</p>
        <div className="flex flex-col gap-2 mt-4">
          <Button variant="primary" onClick={() => stop('stop')}>Stop — keep upcoming meetings</Button>
          <Button variant="danger" onClick={() => stop('delete-future')}>Stop &amp; remove upcoming (still-scheduled) meetings</Button>
          <Button variant="secondary" onClick={() => setStopping(false)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
