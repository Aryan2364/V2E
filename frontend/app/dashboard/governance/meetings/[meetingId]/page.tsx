'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Play, Square, Lock, Unlock, Trash2, Video, MapPin, Users, CalendarClock,
  Plus, CheckCircle2, Circle, Link2, AlertTriangle, Gavel, Copy, Check, X, Eye, EyeOff,
  CalendarSearch, History, BarChart3, RotateCcw, ChevronDown, Clock, ListChecks, KeyRound, Pencil,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { LINK_TYPE_LABEL, TYPE_LABEL, type Meeting, type MeetingAnalytics, type MeetingRhythm } from '@/lib/types/meetings'
import { StatusBadge, ResponseBadge, fmtDate, fmtDateTime, fmtTime, useMeetingPermissions } from '@/components/meetings/shared'
import Tooltip from '@/components/ui/Tooltip'
import MeetingRecordTab from '@/components/meetings/MeetingRecordTab'
import BusyTimesPanel from '@/components/meetings/BusyTimesPanel'
import EditMeetingModal from '@/components/meetings/EditMeetingModal'
import CreateRhythmModal from '@/components/meetings/CreateRhythmModal'

const inputClass = 'border border-[#CBD5E1] rounded-[8px] px-3 py-2.5 text-[15px] text-[#0F172A] focus:outline-none focus:border-[#2563EB]'
const cardCls = 'bg-white border border-[#E2E8F0] rounded-[12px]'
const SIDE_TINTS: Record<string, string> = {
  blue: 'bg-[#EFF6FF] text-[#2563EB]',
  indigo: 'bg-[#EEF2FF] text-[#4F46E5]',
  emerald: 'bg-[#ECFDF5] text-[#059669]',
  amber: 'bg-[#FEF3C7] text-[#B45309]',
}
function SideHeader({ icon, label, tint }: { icon: ReactNode; label: string; tint: keyof typeof SIDE_TINTS }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 ${SIDE_TINTS[tint]}`}>{icon}</span>
      <h3 className="text-[15px] font-semibold text-[#0F172A]">{label}</h3>
    </div>
  )
}

export default function MeetingDetailPage({ params }: { params: { meetingId: string } }) {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id ?? ''
  const { perms } = useMeetingPermissions(orgId)
  const { addToast } = useToast()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [people, setPeople] = useState<{ user_id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [choiceOpen, setChoiceOpen] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [seriesRhythm, setSeriesRhythm] = useState<MeetingRhythm | null>(null)

  const nameOf = useMemo(() => new Map(people.map((p) => [p.user_id, p.name])), [people])

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    const [m, emps] = await Promise.all([
      meetingsApi.get(orgId, params.meetingId).catch(() => null),
      getEmployees(orgId).catch(() => []),
    ])
    setMeeting(m)
    setPeople((emps as any[]).map((e) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown' })))
    setLoading(false)
  }, [orgId, params.meetingId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-10 text-center text-sm text-[#475569]">Loading…</div>
  if (!meeting) return (
    <div className="p-12 text-center">
      <h2 className="text-[18px] font-semibold text-[#0F172A]">Meeting not found</h2>
      <Link href="/dashboard/governance/meetings" className="text-sm text-[#2563EB] hover:underline mt-2 inline-block">Back to meetings</Link>
    </div>
  )

  const m = meeting
  const canManage = m.can_manage ?? false
  const onChanged = (updated: Meeting) => setMeeting(updated)
  const act = async (fn: () => Promise<Meeting>, msg?: string) => {
    try { setMeeting(await fn()); if (msg) addToast(msg, 'success') } catch (e: any) { addToast(e?.response?.data?.message ?? 'Action failed', 'error') }
  }

  async function copySummary() {
    const lines = [
      `# ${m.title}`,
      `When: ${fmtDateTime(m.scheduled_start)}`,
      `Organizer: ${m.organizer?.name ?? '—'}`,
      `Type: ${TYPE_LABEL[m.type]}${m.location ? ` · ${m.location}` : ''}`,
      '',
      '## Attendees',
      ...(m.attendees ?? []).map((a) => `- ${a.user?.name ?? nameOf.get(a.user_id) ?? 'Unknown'} (${a.response})${a.attended ? ' ✓ attended' : ''}`),
      '',
      '## Agenda',
      m.agenda || '—',
      '',
      '## Minutes',
      m.minutes || '—',
      '',
      '## Decisions',
      ...((m.decisions ?? []).length ? (m.decisions ?? []).map((d) => `- ${d.decision}${d.reason ? ` (${d.reason})` : ''}`) : ['—']),
      '',
      '## Action items',
      ...((m.action_items ?? []).length ? (m.action_items ?? []).map((it) => `- [${it.is_done ? 'x' : ' '}] ${it.text}${it.owner_user_id ? ` — ${nameOf.get(it.owner_user_id) ?? 'owner'}` : ''}${it.due_date ? ` (due ${fmtDate(it.due_date)})` : ''}`) : ['—']),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      addToast('Summary copied to clipboard', 'success')
    } catch {
      addToast('Could not copy', 'error')
    }
  }

  const ghostBtn = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] hover:bg-[#F8FAFC]'

  return (
    <div className="flex flex-col gap-5">
      {/* Back mirrors forward: return to wherever the user came from. */}
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#475569] hover:text-[#0F172A] w-fit"><ArrowLeft size={15} /> Back</button>

      {/* Header — the single identity + lifecycle actions surface. */}
      <div className={`${cardCls} p-6`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <StatusBadge status={m.status} />
              <span className="inline-flex items-center gap-1 text-xs text-[#64748B]">{m.type === 'offline' ? <MapPin size={12} /> : <Video size={12} />} {TYPE_LABEL[m.type]}</span>
              {m.link_type && <span className="text-xs text-[#2563EB] bg-[#EFF6FF] rounded-full px-2 py-0.5">{LINK_TYPE_LABEL[m.link_type]}</span>}
            </div>
            <h1 className="text-[24px] font-bold text-[#0F172A] leading-tight">{m.title}</h1>
            <div className="flex items-center gap-3 text-sm text-[#475569] mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1"><CalendarClock size={14} /> {fmtDateTime(m.scheduled_start)}{m.scheduled_end ? ` – ${fmtTime(m.scheduled_end)}` : ''}</span>
              <span className="inline-flex items-center gap-1"><Users size={14} /> {m.organizer?.name}</span>
              {m.type !== 'offline' && m.online_link && <a href={m.online_link} target="_blank" rel="noreferrer" className="text-[#2563EB] hover:underline">Join link</a>}
              {m.location && <span className="inline-flex items-center gap-1"><MapPin size={14} /> {m.location}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {canManage && (m.status === 'scheduled' || m.status === 'in_progress') && <button onClick={() => { if (m.rhythm_id) setChoiceOpen(true); else setEditOpen(true) }} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] hover:bg-[#F8FAFC]"><Pencil size={14} /> Edit</button>}
            {canManage && m.status === 'scheduled' && <button onClick={() => act(() => meetingsApi.start(orgId, m.id), 'Meeting started')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#16A34A] rounded-[8px]"><Play size={14} /> Start</button>}
            {canManage && m.status === 'in_progress' && <button onClick={() => act(() => meetingsApi.end(orgId, m.id), 'Marked ended')} className={ghostBtn}><Square size={14} /> End</button>}
            {canManage && (m.status === 'in_progress' || m.status === 'scheduled') && <button onClick={() => act(() => meetingsApi.close(orgId, m.id), 'Meeting closed')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-[8px]"><Lock size={14} /> Close</button>}
            {canManage && m.status === 'closed' && <button onClick={() => act(() => meetingsApi.reopen(orgId, m.id), 'Meeting reopened')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#CA8A04] border border-[#FDE68A] rounded-[8px]"><Unlock size={14} /> Reopen</button>}
            {perms.delete && <button onClick={() => setDeleteOpen(true)} aria-label="Delete meeting" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#DC2626] border border-[#FECACA] rounded-[8px]"><Trash2 size={14} /></button>}
          </div>
        </div>

        {(m.conflicts?.length ?? 0) > 0 && (
          <div className="mt-4 flex items-start gap-2 bg-[#FEF9C3] border border-[#FDE68A] rounded-[8px] px-3 py-2 text-sm text-[#854D0E]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Scheduling conflict: {m.conflicts!.map((c) => `${nameOf.get(c.user_id) ?? 'Someone'} (${c.title})`).join(', ')}. Not blocked — attendees decide.</span>
          </div>
        )}

        {/* Utility row — copy + demoted views (log / insights) as small buttons. */}
        <div className="mt-4 pt-4 border-t border-[#E2E8F0] flex flex-wrap items-center gap-2">
          <button onClick={copySummary} className={ghostBtn}><Copy size={14} /> Copy summary</button>
          <button onClick={() => setLogOpen(true)} className={ghostBtn}><History size={14} /> Edit log</button>
          <button onClick={() => setInsightsOpen(true)} className={ghostBtn}><BarChart3 size={14} /> Insights</button>
        </div>
      </div>

      {/* Body: the record (main) + logistics (sidebar). One page, no tabs. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 order-2 lg:order-1 flex flex-col gap-5">
          <MeetingRecordTab key={m.id} orgId={orgId} meeting={m} canEdit={true} onSaved={load} />
          <ActionItemsTab meeting={m} orgId={orgId} people={people} nameOf={nameOf} onChanged={onChanged} />
          <DecisionsTab meeting={m} orgId={orgId} people={people} nameOf={nameOf} onChanged={onChanged} />
        </div>

        <div className="order-1 lg:order-2 flex flex-col gap-5">
          <RsvpCard meeting={m} orgId={orgId} userId={userId} onChanged={onChanged} />
          <WhenCard meeting={m} orgId={orgId} canManage={canManage} />
          <PeopleCard meeting={m} orgId={orgId} canManage={canManage} onChanged={onChanged} nameOf={nameOf} />
          <AccessCard meeting={m} />
          <NotesCard orgId={orgId} meeting={m} />
        </div>
      </div>

      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete meeting" size="sm">
        <p className="text-sm text-[#1E293B]">Are you sure? This can&apos;t be undone.</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await meetingsApi.remove(orgId, m.id); addToast('Meeting deleted', 'success'); router.push('/dashboard/governance/meetings') }}>Delete</Button>
        </div>
      </Modal>

      <EditMeetingModal isOpen={editOpen} onClose={() => setEditOpen(false)} orgId={orgId} meeting={m} people={people} isOccurrence={!!m.rhythm_id} onSaved={() => load()} />

      <CreateRhythmModal isOpen={seriesOpen} onClose={() => setSeriesOpen(false)} orgId={orgId} people={people} rhythm={seriesRhythm} onCreated={() => { setSeriesOpen(false); load() }} />

      <Modal isOpen={choiceOpen} onClose={() => setChoiceOpen(false)} title="Edit recurring meeting" size="sm">
        <p className="text-sm text-[#475569] mb-3">This meeting repeats. What do you want to change?</p>
        <div className="flex flex-col gap-2">
          <button onClick={() => { setChoiceOpen(false); setEditOpen(true) }} className="text-left border border-[#E2E8F0] rounded-[10px] px-4 py-3 hover:border-[#2563EB] hover:bg-[#F8FAFC]">
            <div className="text-[15px] font-semibold text-[#0F172A]">This occurrence only</div>
            <div className="text-xs text-[#64748B] mt-0.5">Change just this one meeting. The rest of the series stays the same.</div>
          </button>
          <button onClick={async () => { setChoiceOpen(false); try { const r = await meetingsApi.getRhythm(orgId, m.rhythm_id!); setSeriesRhythm(r); setSeriesOpen(true) } catch { addToast('Could not load the series', 'error') } }} className="text-left border border-[#E2E8F0] rounded-[10px] px-4 py-3 hover:border-[#2563EB] hover:bg-[#F8FAFC]">
            <div className="text-[15px] font-semibold text-[#0F172A]">Whole series</div>
            <div className="text-xs text-[#64748B] mt-0.5">Change the recurring pattern or details for all future occurrences.</div>
          </button>
        </div>
      </Modal>

      <Modal isOpen={logOpen} onClose={() => setLogOpen(false)} title="Edit log" size="lg">
        <EditLogPanel orgId={orgId} meetingId={m.id} />
      </Modal>

      <Modal isOpen={insightsOpen} onClose={() => setInsightsOpen(false)} title="Insights" size="lg">
        <AnalyticsPanel orgId={orgId} meetingId={m.id} />
      </Modal>
    </div>
  )
}

// ─── Sidebar: Your RSVP (opt-out — decline / undo) ─────────────────────────────
function RsvpCard({ meeting, orgId, userId, onChanged }: { meeting: Meeting; orgId: string; userId: string; onChanged: (m: Meeting) => void }) {
  const { addToast } = useToast()
  const attendees = meeting.attendees ?? []
  const me = attendees.find((a) => a.user_id === userId)
  const open = meeting.status === 'scheduled' || meeting.status === 'in_progress'
  const [mode, setMode] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (fn: () => Promise<Meeting>, ok: string) => {
    setBusy(true)
    try { onChanged(await fn()); addToast(ok, 'success'); setMode(false); setText('') }
    catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
    finally { setBusy(false) }
  }

  if (!me || me.is_organizer || !open) return null
  const declined = me.response === 'declined'

  if (declined) {
    return (
      <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-[12px] p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-[#991B1B]">You can’t make it{me.reject_reason ? `: “${me.reject_reason}”` : ''}.</p>
        <button onClick={() => submit(() => meetingsApi.undoDecline(orgId, meeting.id), 'You’re back on the meeting')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#2563EB] bg-white border border-[#BFDBFE] rounded-[8px] shrink-0"><RotateCcw size={14} /> I can make it</button>
      </div>
    )
  }

  return (
    <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-[12px] p-4">
      <p className="text-sm font-medium text-[#1E293B] mb-2">You’re on this meeting.</p>
      {!mode ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setMode(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#DC2626] border border-[#FECACA] bg-white rounded-[8px]"><X size={15} /> Can’t make it</button>
          <span className="text-xs text-[#64748B]">A reason is required.</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="flex-1 border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm bg-white" placeholder="Reason (required)" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <Button variant="danger" disabled={!text.trim() || busy} onClick={() => submit(() => meetingsApi.decline(orgId, meeting.id, text.trim()), 'You declined')}>Submit</Button>
        </div>
      )}
    </div>
  )
}

// ─── Sidebar: When (time + reschedule hint + busy-times peek) ───────────────────
function WhenCard({ meeting, orgId, canManage }: { meeting: Meeting; orgId: string; canManage: boolean }) {
  const [showBusy, setShowBusy] = useState(false)
  const attendees = meeting.attendees ?? []
  const open = meeting.status === 'scheduled' || meeting.status === 'in_progress'
  const nonDeclinedIds = useMemo(() => attendees.filter((a) => a.response !== 'declined').map((a) => a.user_id), [attendees])
  const requiredIds = useMemo(() => attendees.filter((a) => a.is_required && a.response !== 'declined').map((a) => a.user_id), [attendees])

  return (
    <div className={`${cardCls} p-4`}>
      <SideHeader icon={<Clock size={15} />} label="When" tint="blue" />
      <p className="text-[15px] text-[#0F172A] font-medium mt-1.5">{fmtDateTime(meeting.scheduled_start)}{meeting.scheduled_end ? ` – ${fmtTime(meeting.scheduled_end)}` : ''}</p>
      <p className="text-xs text-[#64748B] mt-1">The organiser sets the time. If it changes, everyone on the meeting is notified.</p>
      {canManage && open && (
        <div className="mt-3 pt-3 border-t border-[#E2E8F0]">
          <button type="button" onClick={() => setShowBusy((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB]">
            <CalendarSearch size={15} /> {showBusy ? 'Hide' : 'Check'} busy times
          </button>
          {showBusy && meeting.scheduled_start && (
            <div className="mt-2">
              <BusyTimesPanel
                orgId={orgId}
                userIds={nonDeclinedIds}
                requiredIds={requiredIds}
                from={new Date(new Date(meeting.scheduled_start).setHours(0, 0, 0, 0)).toISOString()}
                to={new Date(new Date(meeting.scheduled_start).setHours(23, 59, 0, 0)).toISOString()}
              />
              <p className="text-xs text-[#94A3B8] mt-1">To move it, use Edit on the meeting header — you pick the new time.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar: People (attendees + responses + attendance marking) ───────────────
function PeopleCard({ meeting, orgId, canManage, onChanged, nameOf }: { meeting: Meeting; orgId: string; canManage: boolean; onChanged: (m: Meeting) => void; nameOf: Map<string, string> }) {
  const { addToast } = useToast()
  const attendees = meeting.attendees ?? []
  const canMarkAttendance = canManage && (meeting.status === 'in_progress' || meeting.status === 'closed')

  async function toggleAttended(uid: string, attended: boolean) {
    try { onChanged(await meetingsApi.markAttendance(orgId, meeting.id, [{ user_id: uid, attended }])) }
    catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }

  return (
    <div className={`${cardCls} p-4`}>
      <SideHeader icon={<Users size={15} />} label={`People (${attendees.length})`} tint="indigo" />
      <div className="flex flex-col gap-2 mt-2.5 max-h-[360px] overflow-y-auto">
        {attendees.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 border border-[#E2E8F0] rounded-[8px] px-2.5 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {canMarkAttendance ? (
                <Tooltip label="Mark attended"><button onClick={() => toggleAttended(a.user_id, !a.attended)} className="text-[#475569] shrink-0" aria-label="Toggle attended">{a.attended ? <CheckCircle2 size={17} className="text-[#16A34A]" /> : <Circle size={17} className="text-[#CBD5E1]" />}</button></Tooltip>
              ) : a.attended ? <CheckCircle2 size={17} className="text-[#16A34A] shrink-0" /> : null}
              <div className="min-w-0">
                <span className="text-[14px] text-[#0F172A]">
                  {a.user?.name ?? nameOf.get(a.user_id) ?? 'Unknown'}
                  {a.is_organizer && <span className="text-[11px] text-[#94A3B8] ml-1">(organizer)</span>}
                  {!a.is_organizer && !a.is_required && <span className="text-[10px] font-medium text-[#64748B] bg-[#F1F5F9] rounded-full px-1.5 py-0.5 ml-1.5">Optional</span>}
                </span>
                {a.response === 'declined' && a.reject_reason && (
                  <p className="text-[11px] text-[#DC2626] mt-0.5 truncate">“{a.reject_reason}”{a.is_required ? <span className="text-[#B45309]"> · was required</span> : null}</p>
                )}
              </div>
            </div>
            <ResponseBadge response={a.response} />
          </div>
        ))}
      </div>
      {canMarkAttendance && <p className="text-[11px] text-[#94A3B8] mt-2">Tap the circle to mark who attended.</p>}
    </div>
  )
}

// ─── Sidebar: Access (join link + password) ─────────────────────────────────────
function AccessCard({ meeting }: { meeting: Meeting }) {
  const [showPw, setShowPw] = useState(false)
  if (meeting.type === 'offline' || (!meeting.online_link && !meeting.online_password)) return null
  return (
    <div className={`${cardCls} p-4`}>
      <SideHeader icon={<KeyRound size={15} />} label="Access" tint="emerald" />
      <div className="flex flex-col gap-2 mt-2.5 text-sm">
        {meeting.online_link && <a href={meeting.online_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#2563EB] font-medium hover:underline w-fit"><Video size={15} /> Join link</a>}
        {meeting.online_password && (
          <span className="inline-flex items-center gap-2 text-[#475569]">
            Password: <code className="bg-[#F1F5F9] px-2 py-0.5 rounded">{showPw ? meeting.online_password : '••••••••'}</code>
            <button onClick={() => setShowPw((v) => !v)} className="text-[#94A3B8] hover:text-[#475569]" aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Sidebar: Your private notes (collapsible; never part of the record) ─────────
function NotesCard({ orgId, meeting }: { orgId: string; meeting: Meeting }) {
  const { addToast } = useToast()
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState(meeting.my_note ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const hasNote = (meeting.my_note ?? '').trim().length > 0

  async function save() {
    setSaving(true)
    try {
      await meetingsApi.saveMyNote(orgId, meeting.id, body)
      addToast('Notes saved', 'success')
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch { addToast('Failed', 'error') } finally { setSaving(false) }
  }

  return (
    <div className={`${cardCls} p-4`}>
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-2">
        <SideHeader icon={<Lock size={14} />} label={`Your private notes${hasNote && !expanded ? ' •' : ''}`} tint="amber" />
        <ChevronDown size={16} className={`text-[#64748B] transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-2.5">
          <p className="text-[11px] text-[#64748B] mb-2">Only you can see these — never part of the official record.</p>
          <textarea className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-[#2563EB] resize-y" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end items-center gap-3 mt-2">
            {saved && <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A34A]"><Check size={14} /> Saved</span>}
            <Button variant="primary" isLoading={saving} disabled={saving} onClick={save}>Save notes</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Action items ───────────────────────────────────────────────────────────────
function ActionItemsTab({ meeting, orgId, people, nameOf, onChanged }: { meeting: Meeting; orgId: string; people: { user_id: string; name: string }[]; nameOf: Map<string, string>; onChanged: (m: Meeting) => void }) {
  const { addToast } = useToast()
  const items = meeting.action_items ?? []
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const locked = meeting.status === 'closed' || meeting.status === 'cancelled'

  const run = async (fn: () => Promise<Meeting>, ok?: string) => {
    try { onChanged(await fn()); if (ok) addToast(ok, 'success') } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
  }

  return (
    <div className={`${cardCls} p-6`}>
      <h3 className="text-[16px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2"><span className="w-7 h-7 rounded-[8px] bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center"><ListChecks size={16} /></span> Action items</h3>
      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-0.5">
        {items.length === 0 && <p className="text-sm text-[#64748B]">No action items yet.</p>}
        {items.map((it) => (
          <div key={it.id} className="border border-[#E2E8F0] rounded-[8px] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <button disabled={locked} onClick={() => run(() => meetingsApi.updateActionItem(orgId, meeting.id, it.id, { is_done: !it.is_done }))}>{it.is_done ? <CheckCircle2 size={18} className="text-[#16A34A]" /> : <Circle size={18} className="text-[#CBD5E1]" />}</button>
                <div className="min-w-0">
                  <p className={['text-[15px]', it.is_done ? 'text-[#94A3B8] line-through' : 'text-[#0F172A]'].join(' ')}>{it.text}</p>
                  <p className="text-xs text-[#64748B] flex items-center gap-1.5 flex-wrap">
                    <span>{it.owner_user_id ? nameOf.get(it.owner_user_id) ?? 'Owner' : 'Unassigned'}{it.due_date ? ` · due ${fmtDate(it.due_date)}` : ''}</span>
                    {it.due_date && !it.is_done && new Date(it.due_date) < new Date() && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-full px-1.5 py-0"><AlertTriangle size={10} /> Overdue</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {it.linked_task_id ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[#16A34A] bg-[#DCFCE7] rounded-full px-2 py-0.5"><Link2 size={11} /> Task linked</span>
                ) : (
                  <button disabled={locked} onClick={() => setLinkingId(linkingId === it.id ? null : it.id)} className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB]"><Link2 size={12} /> Link task</button>
                )}
                {!locked && <button onClick={() => run(() => meetingsApi.deleteActionItem(orgId, meeting.id, it.id))} className="text-[#94A3B8] hover:text-[#DC2626]"><Trash2 size={14} /></button>}
              </div>
            </div>
            {linkingId === it.id && !it.linked_task_id && (
              <LinkTaskRow item={it} people={people} onAttachId={(tid) => run(() => meetingsApi.linkTask(orgId, meeting.id, it.id, { task_id: tid }), 'Task linked').then(() => setLinkingId(null))} onCreate={(title, assignee, deadline) => run(() => meetingsApi.linkTask(orgId, meeting.id, it.id, { create: { title, assignee_user_ids: [assignee], deadline } }), 'Task created & linked').then(() => setLinkingId(null))} />
            )}
          </div>
        ))}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-[#E2E8F0]">
          <input className={`${inputClass} flex-1 min-w-[200px]`} placeholder="New action item…" value={text} onChange={(e) => setText(e.target.value)} />
          <StyledSelect wrapperClassName="w-48" value={owner} onChange={setOwner} placeholder="Owner" searchable searchPlaceholder="Search people…" options={people.map((p) => ({ value: p.user_id, label: p.name }))} />
          <DatePicker value={due} onChange={setDue} placeholder="Select date" />
          <button onClick={() => { if (!text.trim()) return; run(() => meetingsApi.addActionItem(orgId, meeting.id, { text: text.trim(), owner_user_id: owner || undefined, due_date: due ? new Date(due).toISOString() : undefined })); setText(''); setOwner(''); setDue('') }} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px]"><Plus size={15} /> Add</button>
        </div>
      )}
    </div>
  )
}

function LinkTaskRow({ item, people, onAttachId, onCreate }: { item: { text: string; owner_user_id: string | null; due_date: string | null }; people: { user_id: string; name: string }[]; onAttachId: (id: string) => void; onCreate: (title: string, assignee: string, deadline?: string) => void }) {
  const [title, setTitle] = useState(item.text)
  const [assignee, setAssignee] = useState(item.owner_user_id ?? '')
  const [taskId, setTaskId] = useState('')
  return (
    <div className="mt-2 pt-2 border-t border-[#F1F5F9] flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${inputClass} flex-1 min-w-[160px]`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
        <StyledSelect wrapperClassName="w-48" value={assignee} onChange={setAssignee} placeholder="Executor" searchable searchPlaceholder="Search people…" options={people.map((p) => ({ value: p.user_id, label: p.name }))} />
        <button onClick={() => assignee && onCreate(title, assignee, item.due_date ?? undefined)} disabled={!assignee || !title.trim()} className="px-3 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-[8px] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]">Create &amp; link</button>
      </div>
      <div className="flex items-center gap-2">
        <input className={`${inputClass} flex-1`} value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="…or paste an existing task ID" />
        <button onClick={() => taskId && onAttachId(taskId)} disabled={!taskId} className="px-3 py-2 text-sm font-medium text-[#2563EB] border border-[#2563EB] rounded-[8px] disabled:opacity-50">Attach</button>
      </div>
    </div>
  )
}

// ─── Decisions ──────────────────────────────────────────────────────────────────
function DecisionsTab({ meeting, orgId, people, nameOf, onChanged }: { meeting: Meeting; orgId: string; people: { user_id: string; name: string }[]; nameOf: Map<string, string>; onChanged: (m: Meeting) => void }) {
  const { addToast } = useToast()
  const decisions = meeting.decisions ?? []
  const [decision, setDecision] = useState('')
  const [owner, setOwner] = useState('')
  const [reason, setReason] = useState('')
  const locked = meeting.status === 'closed' || meeting.status === 'cancelled'
  const run = async (fn: () => Promise<Meeting>, ok?: string) => { try { onChanged(await fn()); if (ok) addToast(ok, 'success') } catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') } }

  return (
    <div className={`${cardCls} p-6`}>
      <h3 className="text-[16px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2"><span className="w-7 h-7 rounded-[8px] bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center"><Gavel size={16} /></span> Decisions</h3>
      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-0.5">
        {decisions.length === 0 && <p className="text-sm text-[#64748B]">No decisions logged.</p>}
        {decisions.map((d) => (
          <div key={d.id} className="border border-[#E2E8F0] rounded-[8px] px-3 py-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] text-[#0F172A] font-medium">{d.decision}</p>
              <p className="text-xs text-[#64748B] mt-0.5">{d.owner_user_id ? nameOf.get(d.owner_user_id) ?? 'Owner' : '—'} · {fmtDate(d.decided_on)}{d.reason ? ` · ${d.reason}` : ''}</p>
            </div>
            {!locked && <button onClick={() => run(() => meetingsApi.deleteDecision(orgId, meeting.id, d.id))} className="text-[#94A3B8] hover:text-[#DC2626] shrink-0"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      {!locked && (
        <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-[#E2E8F0]">
          <input className={inputClass} placeholder="Decision…" value={decision} onChange={(e) => setDecision(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <StyledSelect wrapperClassName="w-48" value={owner} onChange={setOwner} placeholder="Owner" searchable searchPlaceholder="Search people…" options={people.map((p) => ({ value: p.user_id, label: p.name }))} />
            <input className={`${inputClass} flex-1 min-w-[160px]`} placeholder="One-line reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button onClick={() => { if (!decision.trim()) return; run(() => meetingsApi.addDecision(orgId, meeting.id, { decision: decision.trim(), owner_user_id: owner || undefined, reason: reason || undefined })); setDecision(''); setOwner(''); setReason('') }} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px]"><Plus size={15} /> Log decision</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Popups: Edit log + Analytics (demoted from tabs) ───────────────────────────
function EditLogPanel({ orgId, meetingId }: { orgId: string; meetingId: string }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { meetingsApi.editLog(orgId, meetingId).then((r) => setItems(r.items)).catch(() => setItems([])).finally(() => setLoading(false)) }, [orgId, meetingId])
  return (
    <div>
      {loading ? <p className="text-sm text-[#475569]">Loading…</p> : items.length === 0 ? <p className="text-sm text-[#94A3B8]">No changes recorded yet.</p> : (
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {items.map((e) => (
            <div key={e.id} className="flex items-center gap-3 text-sm border-b border-[#F1F5F9] pb-2">
              <span className="text-[#475569] w-40 shrink-0">{fmtDateTime(e.created_at)}</span>
              <span className="text-[#0F172A]">{e.actor?.name ?? '—'}</span>
              <span className="text-[#64748B]">{e.changes ? Object.keys(e.changes).map((k) => k.replace(/_/g, ' ')).join(', ') : e.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AnalyticsPanel({ orgId, meetingId }: { orgId: string; meetingId: string }) {
  const [data, setData] = useState<MeetingAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { meetingsApi.analytics(orgId, meetingId).then(setData).catch(() => setData(null)).finally(() => setLoading(false)) }, [orgId, meetingId])
  if (loading) return <div className="p-2 text-sm text-[#475569]">Loading…</div>
  if (!data) return <div className="p-2 text-sm text-[#94A3B8]">No analytics.</div>
  const stat = (label: string, value: string | number, color = '#0F172A') => (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-4">
      <p className="text-[24px] font-bold leading-none" style={{ color }}>{value}</p>
      <p className="text-sm text-[#475569] mt-1">{label}</p>
    </div>
  )
  const att = data.attendance
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stat('Planned (min)', data.planned_minutes ?? '—')}
        {stat('Actual (min)', data.actual_minutes ?? '—', (data.overrun_minutes ?? 0) > 0 ? '#D97706' : '#16A34A')}
        {stat('Expected', att.expected)}
        {stat('Attended', att.attendance_recorded ? `${att.attended}/${att.expected}` : '—')}
        {stat('No-shows', att.no_show === null ? '—' : att.no_show, att.no_show ? '#DC2626' : '#16A34A')}
        {stat('Declined', att.declined, att.declined ? '#DC2626' : '#0F172A')}
        {stat('Declined (required)', att.declined_required, att.declined_required ? '#DC2626' : '#16A34A')}
        {stat('Action items', data.action_items.created)}
        {stat('Linked to tasks', data.action_items.linked)}
        {stat('Done', data.action_items.done, '#16A34A')}
        {stat('Decisions', data.decisions, data.decisions ? '#16A34A' : '#DC2626')}
      </div>
      {!att.attendance_recorded && (
        <div className="flex items-start gap-2 bg-[#F1F5F9] border border-[#E2E8F0] rounded-[8px] px-3 py-2 text-sm text-[#475569]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#94A3B8]" />
          <span>Attendance hasn’t been recorded, so no-shows aren’t counted. Mark it in the People panel.</span>
        </div>
      )}
    </div>
  )
}
