'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Repeat, Pause, Play, Square, Clock, Users, CalendarClock, Pencil } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import type { MeetingRhythm } from '@/lib/types/meetings'
import { useMeetingPermissions } from '@/components/meetings/shared'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import CreateRhythmModal from '@/components/meetings/CreateRhythmModal'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import Tooltip from '@/components/ui/tooltip'
import { PageHeader } from '@/components/shell/page-header'
import { formatWeekday, formatDayMonth } from '@/lib/format'

function cadence(r: MeetingRhythm): string {
  const e = r.schedule_entries?.[0]
  if (!e) return '—'
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const every = e.every > 1 ? `every ${e.every} ` : ''
  if (e.schedule_type === 'daily') return `${every ? every + 'days' : 'Daily'} at ${e.time}`
  if (e.schedule_type === 'weekly') return `${every ? 'Every ' + e.every + ' weeks' : 'Weekly'} · ${(e.days ?? []).map((d) => DOW[d]).join(', ')} at ${e.time}`
  if (e.schedule_type === 'monthly') return `Monthly · day ${(e.month_days ?? []).join(', ')} at ${e.time}`
  return `Yearly at ${e.time}`
}

function fmt(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : `${formatWeekday(d)}, ${formatDayMonth(d)}`
}

export default function RhythmsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const { perms, loading: permsLoading } = useMeetingPermissions(orgId)

  const [rhythms, setRhythms] = useState<MeetingRhythm[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [stopping, setStopping] = useState<MeetingRhythm | null>(null)
  const [editing, setEditing] = useState<MeetingRhythm | null>(null)

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([meetingsApi.listRhythms(orgId).catch(() => []), getEmployees(orgId).catch(() => [])])
      .then(([rs, emps]: any[]) => {
        setRhythms(rs)
        setPeople((emps as any[]).map((e) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown', email: e.user?.email })))
      })
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  const active = useMemo(() => rhythms.filter((r) => r.is_active).length, [rhythms])

  async function toggle(r: MeetingRhythm) {
    try {
      const updated = r.is_active ? await meetingsApi.pauseRhythm(orgId, r.id) : await meetingsApi.resumeRhythm(orgId, r.id)
      setRhythms((rs) => rs.map((x) => (x.id === r.id ? updated : x)))
      addToast(r.is_active ? 'Rhythm paused' : 'Rhythm resumed', 'success')
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }

  async function stop(mode: 'stop' | 'delete-future') {
    if (!stopping) return
    try {
      await meetingsApi.removeRhythm(orgId, stopping.id, mode)
      addToast('Rhythm stopped', 'success')
      setStopping(null)
      load()
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Rhythms"
        meta="Recurring meetings — a daily huddle, an every-Thursday review. Occurrences appear 60 days ahead."
        trail={[
          { label: 'Meetings', href: '/dashboard/governance/meetings' },
          { label: 'Rhythms', href: '/dashboard/governance/meetings/rhythms' },
        ]}
        actions={perms.write ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New rhythm
          </Button>
        ) : undefined}
      />

      {!permsLoading && !perms.read ? (
        <AccessHiddenState orgId={orgId} leaf="meetings" moduleLabel="Meetings" />
      ) : loading ? (
        <div className="p-8 text-center text-body text-text-secondary">Loading…</div>
      ) : rhythms.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-xl p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-surface-control flex items-center justify-center text-text-secondary mx-auto mb-3"><Repeat size={26} /></div>
          <h3 className="text-[18px] font-medium text-text-primary">No rhythms yet</h3>
          <p className="text-body text-text-secondary mt-1">Set up a recurring meeting to build a cadence.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rhythms.map((r) => (
            <div key={r.id} className="bg-surface border border-border-light rounded-xl p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/dashboard/governance/meetings/rhythms/${r.id}`} className="text-[16px] font-medium text-text-primary hover:text-primary-text hover:underline">{r.title}</Link>
                <span className="inline-flex items-center font-medium text-[12px] rounded-full px-2.5 py-0.5 border shrink-0"
                  style={r.is_active ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' } : { backgroundColor: 'var(--surface-control)', color: 'var(--text-secondary)', borderColor: 'var(--border-light)' }}>
                  {r.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mt-3 text-body text-text-secondary">
                <span className="inline-flex items-center gap-1.5"><Clock size={14} /> {cadence(r)}</span>
                <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} /> Next: {fmt(r.next_run)}</span>
                <span className="inline-flex items-center gap-1.5"><Users size={14} /> {(r.attendee_user_ids ?? []).length} attendee(s) · {r.occurrences ?? 0} held</span>
              </div>
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-light">
                <Link href={`/dashboard/governance/meetings/rhythms/${r.id}`} className="text-body font-medium text-primary-text hover:underline">View details &amp; history</Link>
                {r.can_manage && (
                  <div className="ml-auto flex items-center gap-1">
                    <Tooltip label="Edit"><button onClick={() => setEditing(r)} aria-label="Edit" className="p-1.5 text-text-secondary hover:bg-surface-control rounded-lg"><Pencil size={16} /></button></Tooltip>
                    <Tooltip label={r.is_active ? 'Pause' : 'Resume'}>
                    <button onClick={() => toggle(r)} aria-label={r.is_active ? 'Pause' : 'Resume'} className="p-1.5 text-text-secondary hover:bg-surface-control rounded-lg">
                      {r.is_active ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    </Tooltip>
                    <Tooltip label="Stop"><button onClick={() => setStopping(r)} aria-label="Stop" className="p-1.5 text-danger hover:bg-danger-bg rounded-lg"><Square size={16} /></button></Tooltip>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateRhythmModal isOpen={createOpen} onClose={() => setCreateOpen(false)} orgId={orgId} people={people} onCreated={() => load()} />
      <CreateRhythmModal isOpen={!!editing} onClose={() => setEditing(null)} orgId={orgId} people={people} rhythm={editing} onCreated={() => { setEditing(null); load() }} />

      <Modal isOpen={!!stopping} onClose={() => setStopping(null)} title="Stop rhythm" size="sm">
        <p className="text-body text-text-primary">Stop “{stopping?.title}”? No new occurrences will be created. Past meetings are kept.</p>
        <div className="flex flex-col gap-2 mt-4">
          <Button variant="primary" onClick={() => stop('stop')}>Stop — keep upcoming meetings</Button>
          <Button variant="danger" onClick={() => stop('delete-future')}>Stop &amp; remove upcoming (still-scheduled) meetings</Button>
          <Button variant="secondary" onClick={() => setStopping(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
