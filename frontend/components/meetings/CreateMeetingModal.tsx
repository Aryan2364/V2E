'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles, AlertTriangle, Video, MapPin, Bell, Link2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi, type CreateMeetingInput, type CreateRhythmInput, type RhythmScheduleInput } from '@/lib/api/meetings'
import { listEligibleSubjects } from '@/lib/api/permissions'
import { useAuth } from '@/lib/auth/context'
import { goalsApi } from '@/lib/api/goals'
import type { BusyView, Meeting, MeetingLinkType, MeetingType } from '@/lib/types/meetings'
import StyledSelect from '@/components/ui/StyledSelect'
import ScheduleEntryRow, { type ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import SkipHolidaysField from './SkipHolidaysField'
import MeetingAttendeeSelector, { type PersonOption } from './MeetingAttendeeSelector'
import FindTimeDialog from './FindTimeDialog'
import { DurationField } from './shared'

const inputClass =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
const labelClass = 'block text-sm font-medium text-[#374151] mb-1'
const sectionLabel = 'text-[13px] font-semibold text-[#475569]'

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  people: PersonOption[]
  initialStart?: string // ISO — prefill when created from a calendar slot click
  onCreated: (m: Meeting) => void
}

type CallMode = 'fixed' | 'log_past'
type RecurMode = 'one_time' | 'recurring'

const EMPTY_SCHED: ScheduleEntryDraft = {
  schedule_type: 'weekly', every: 1, days: [], month_days: [], yearly_dates: [],
  time: '10:00', start_date: '', end_condition: 'never', end_date: '', end_after: 12,
}
const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = () => new Date().toISOString().slice(0, 10)
function toISO(date: string, time: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T${time || '09:00'}`).toISOString()
}
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const t = h * 60 + m + mins
  return `${pad(Math.floor(t / 60) % 24)}:${pad(((t % 60) + 60) % 60)}`
}
function minutesBetween(start: string, end: string): number {
  const diff = timeToMin(end) - timeToMin(start)
  return diff > 0 ? diff : diff + 1440
}
function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export default function CreateMeetingModal({ isOpen, onClose, orgId, people, initialStart, onCreated }: Props) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const hostId = user?.id
  const [ineligibleReasons, setIneligibleReasons] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [type, setType] = useState<MeetingType>('online') // 'online' | 'offline' (In person)
  const [onlineLink, setOnlineLink] = useState('')
  const [location, setLocation] = useState('')
  const [callMode, setCallMode] = useState<CallMode>('fixed')
  const [attendees, setAttendees] = useState<string[]>([])
  const [optional, setOptional] = useState<string[]>([]) // subset of attendees marked optional
  const [agenda, setAgenda] = useState('')
  const [minutes, setMinutes] = useState('')
  const [durationMin, setDurationMin] = useState(30)
  const [recurMode, setRecurMode] = useState<RecurMode>('one_time')
  const [sched, setSched] = useState<ScheduleEntryDraft>(EMPTY_SCHED) // used when recurring → creates a rhythm
  const [skipHolidays, setSkipHolidays] = useState(true)
  const [remind, setRemind] = useState(true) // UI-only for now — see backend flag below
  const [showFinder, setShowFinder] = useState(false)
  const [showLinker, setShowLinker] = useState(false)

  const [linkType, setLinkType] = useState<'' | MeetingLinkType>('')
  const [linkEntityId, setLinkEntityId] = useState('')
  const [goals, setGoals] = useState<{ id: string; title: string }[]>([])

  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('10:30')
  const [actualDate, setActualDate] = useState('')
  const [actualStart, setActualStart] = useState('10:00')
  const [actualEnd, setActualEnd] = useState('11:00')

  const [saving, setSaving] = useState(false)

  const nameOf = useMemo(() => new Map(people.map((p) => [p.user_id, p.name])), [people])
  const requiredIds = useMemo(() => attendees.filter((a) => !optional.includes(a)), [attendees, optional])

  useEffect(() => {
    if (!isOpen) return
    setTitle(''); setType('online'); setOnlineLink(''); setLocation('')
    setCallMode('fixed'); setAttendees([]); setOptional([]); setAgenda(''); setMinutes('')
    setLinkType(''); setLinkEntityId(''); setShowLinker(false)
    setDurationMin(30); setRecurMode('one_time'); setSched(EMPTY_SCHED); setSkipHolidays(true); setRemind(true); setShowFinder(false)
    if (initialStart) {
      const d = new Date(initialStart)
      setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      const st = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      setStartTime(st); setEndTime(addMinutes(st, 30))
    } else {
      setDate(''); setStartTime('10:00'); setEndTime('10:30')
    }
    setActualDate(''); setActualStart('10:00'); setActualEnd('11:00')
  }, [isOpen, initialStart])

  // Who can't be invited to a meeting (org policy / per-person revoke). Greys them
  // out in the picker up-front instead of failing on submit.
  useEffect(() => {
    if (!isOpen || !orgId) return
    let active = true
    listEligibleSubjects(orgId, 'meetings.subject.invitable')
      .then((items) => {
        if (!active) return
        const map: Record<string, string> = {}
        for (const it of items) if (!it.eligible) map[it.userId] = it.reason ?? 'Not eligible to be invited'
        setIneligibleReasons(map)
      })
      .catch(() => { if (active) setIneligibleReasons({}) })
    return () => { active = false }
  }, [isOpen, orgId])

  useEffect(() => {
    if (linkType === 'goal' && goals.length === 0) {
      goalsApi.list(orgId).then((gs) => setGoals(gs.map((g) => ({ id: g.id, title: g.title })))).catch(() => {})
    }
  }, [linkType, orgId, goals.length])

  // Keep the optional set a subset of the current attendees.
  useEffect(() => { setOptional((opt) => opt.filter((id) => attendees.includes(id))) }, [attendees])

  function toggleOptional(id: string) {
    setOptional((opt) => (opt.includes(id) ? opt.filter((x) => x !== id) : [...opt, id]))
  }
  function applyDuration(dur: number) {
    setDurationMin(dur)
    setEndTime(addMinutes(startTime, dur))
  }
  function openFinder() {
    if (!date) setDate(todayStr())
    setShowFinder(true)
  }
  function setRecurring(mode: RecurMode) {
    setRecurMode(mode)
    if (mode === 'recurring') {
      // Seed the recurrence from what's already picked in the one-time fields.
      const d = date ? new Date(`${date}T00:00`) : null
      setSched((s) => ({
        ...s,
        time: startTime,
        start_date: date || s.start_date,
        days: s.schedule_type === 'weekly' && s.days.length === 0 && d ? [d.getDay()] : s.days,
        month_days: s.schedule_type === 'monthly' && s.month_days.length === 0 && d ? [d.getDate()] : s.month_days,
      }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return addToast('Title is required', 'error')

    // NOTE (backend flag): `remind` (Remind 15 min before) has no create-DTO field
    // yet, so it is intentionally NOT sent. See the summary for what the backend needs.

    // Recurring → create a rhythm (the existing rhythm engine), not a single meeting.
    if (callMode === 'fixed' && recurMode === 'recurring') {
      if (!sched.start_date) return addToast('Pick a start date for the recurrence', 'error')
      if (sched.schedule_type === 'weekly' && sched.days.length === 0) return addToast('Pick at least one weekday', 'error')
      if (sched.schedule_type === 'monthly' && sched.month_days.length === 0) return addToast('Pick at least one day of the month', 'error')
      if (sched.schedule_type === 'yearly' && sched.yearly_dates.length === 0) return addToast('Pick at least one date', 'error')
      const schedule: RhythmScheduleInput = {
        schedule_type: sched.schedule_type,
        every: sched.every,
        days: sched.schedule_type === 'weekly' ? sched.days : undefined,
        month_days: sched.schedule_type === 'monthly' ? sched.month_days : undefined,
        yearly_dates: sched.schedule_type === 'yearly' ? sched.yearly_dates : undefined,
        time: sched.time,
        start_date: new Date(`${sched.start_date}T00:00`).toISOString(),
        end_condition: sched.end_condition,
        end_date: sched.end_condition === 'on_date' && sched.end_date ? new Date(`${sched.end_date}T23:59`).toISOString() : undefined,
        end_after: sched.end_condition === 'after_n' ? sched.end_after : undefined,
        skip_holidays: skipHolidays,
      }
      const rhythmDto: CreateRhythmInput = {
        title: title.trim(),
        type,
        duration_min: durationMin,
        attendee_user_ids: attendees,
        optional_user_ids: optional,
        schedule,
      }
      if (type === 'online' && onlineLink) rhythmDto.online_link = onlineLink
      if (type === 'offline') rhythmDto.location = location
      if (agenda.trim()) rhythmDto.agenda = agenda.trim()
      if (linkType) { rhythmDto.link_type = linkType; rhythmDto.link_entity_id = linkEntityId || undefined }

      setSaving(true)
      try {
        const rhythm = await meetingsApi.createRhythm(orgId, rhythmDto)
        addToast('Rhythm created — occurrences will appear on the calendar', 'success')
        onCreated(rhythm as unknown as Meeting)
        onClose()
      } catch (err: any) {
        addToast(err?.response?.data?.message ?? 'Failed to create rhythm', 'error')
      } finally {
        setSaving(false)
      }
      return
    }

    const dto: CreateMeetingInput = {
      title: title.trim(),
      type,
      attendee_user_ids: attendees,
      optional_user_ids: optional,
    }
    if (type === 'online' && onlineLink) dto.online_link = onlineLink
    if (type === 'offline') dto.location = location
    if (agenda.trim()) dto.agenda = agenda.trim()
    if (linkType) { dto.link_type = linkType; dto.link_entity_id = linkEntityId || undefined }

    if (callMode === 'fixed') {
      if (!date) return addToast('Pick a date', 'error')
      dto.scheduled_start = toISO(date, startTime)
      dto.scheduled_end = toISO(date, endTime)
    } else {
      if (!actualDate) return addToast('Pick the date it happened', 'error')
      dto.log_past = true
      dto.actual_start = toISO(actualDate, actualStart)
      dto.actual_end = toISO(actualDate, actualEnd)
      if (minutes.trim()) dto.minutes = minutes.trim()
    }

    setSaving(true)
    try {
      const m = await meetingsApi.create(orgId, dto)
      addToast('Meeting created', 'success')
      onCreated(m)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to create meeting', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Segmented control button
  const seg = (active: boolean) =>
    ['px-3.5 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 transition-colors',
      active ? 'bg-[#2563EB] text-white' : 'bg-white text-[#475569] hover:bg-[#F8FAFC]'].join(' ')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New meeting" size="lg" closeOnEscape={false}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        {/* Title */}
        <div>
          <label className={labelClass}>Title <span className="text-[#DC2626]">*</span></label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" autoFocus />
        </div>

        {/* Attendees */}
        <div>
          <label className={labelClass}>Attendees</label>
          <MeetingAttendeeSelector options={people} value={attendees} onChange={setAttendees} optional={optional} onToggleOptional={toggleOptional} placeholder="Add attendees" hostId={hostId} hostLabel="You" ineligibleReasons={ineligibleReasons} />
          <p className="text-xs text-[#64748B] mt-1.5">You’re the host — always in the meeting. Everyone you add is attending; they can mark “can’t make it” with a reason. Toggle who’s optional.</p>
          {callMode === 'fixed' && recurMode === 'one_time' && attendees.length > 0 && (
            <button
              type="button"
              onClick={openFinder}
              className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
            >
              <Sparkles size={15} /> Find a time that works for everyone →
            </button>
          )}
        </div>

        {/* Schedule */}
        <div className="border-t border-[#E2E8F0] pt-4 flex flex-col gap-3">
          <span className={sectionLabel}>Schedule</span>

          <div className="inline-flex w-fit rounded-[8px] border border-[#CBD5E1] overflow-hidden">
            <button type="button" onClick={() => setCallMode('fixed')} className={seg(callMode === 'fixed')}>Pick a time</button>
            <button type="button" onClick={() => setCallMode('log_past')} className={seg(callMode === 'log_past')}>Log a past meeting</button>
          </div>

          {callMode === 'fixed' && (
            <>
              <DurationField value={durationMin} onChange={applyDuration} />

              {/* One-time vs recurring — recurring reuses the SAME editor as recurring tasks */}
              <div className="inline-flex w-fit rounded-[8px] border border-[#CBD5E1] overflow-hidden">
                <button type="button" onClick={() => setRecurring('one_time')} className={seg(recurMode === 'one_time')}>One-time</button>
                <button type="button" onClick={() => setRecurring('recurring')} className={seg(recurMode === 'recurring')}>Recurring</button>
              </div>

              {recurMode === 'one_time' ? (
                <>
                  <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
                    <div>
                      <label className={labelClass}>Date <span className="text-[#DC2626]">*</span></label>
                      <DatePicker value={date} onChange={setDate} min={todayStr()} placeholder="Select date" />
                    </div>
                    <div>
                      <label className={labelClass}>Start</label>
                      <TimeField value={startTime} onChange={(t) => { setStartTime(t); setEndTime(addMinutes(t, durationMin)) }} />
                    </div>
                    <div>
                      <label className={labelClass}>End</label>
                      <TimeField value={endTime} onChange={(t) => { setEndTime(t); setDurationMin(minutesBetween(startTime, t)) }} />
                    </div>
                  </div>
                  {attendees.length > 0 && date && (
                    <ClashNudge orgId={orgId} attendees={attendees} requiredIds={requiredIds} date={date} startTime={startTime} endTime={endTime} />
                  )}
                </>
              ) : (
                <div className="border border-[#E2E8F0] rounded-[10px] p-4 bg-[#FBFCFE]">
                  <ScheduleEntryRow
                    entry={sched}
                    index={0}
                    onUpdate={(patch) => setSched((s) => ({ ...s, ...patch }))}
                    onDelete={() => {}}
                    canDelete={false}
                  />
                  <SkipHolidaysField orgId={orgId} sched={sched} value={skipHolidays} onChange={setSkipHolidays} />
                  <p className="text-[11px] text-[#64748B] mt-3">Creates a rhythm — occurrences spawn automatically.</p>
                </div>
              )}
            </>
          )}

          {callMode === 'log_past' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Date <span className="text-[#DC2626]">*</span></label>
                <DatePicker value={actualDate} onChange={setActualDate} max={todayStr()} placeholder="Select date" />
              </div>
              <div>
                <label className={labelClass}>Started</label>
                <TimeField value={actualStart} onChange={setActualStart} />
              </div>
              <div>
                <label className={labelClass}>Ended</label>
                <TimeField value={actualEnd} onChange={setActualEnd} />
              </div>
              <div className="col-span-3">
                <label className={labelClass}>Minutes (what happened)</label>
                <textarea className={`${inputClass} resize-none`} rows={4} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Notes / decisions (markdown supported). The meeting will be filed as Closed — use Reopen to amend." />
              </div>
            </div>
          )}
        </div>

        {/* Format */}
        <div className="border-t border-[#E2E8F0] pt-4 flex flex-col gap-3">
          <span className={sectionLabel}>Format</span>
          <div className="inline-flex w-fit rounded-[8px] border border-[#CBD5E1] overflow-hidden">
            <button type="button" onClick={() => setType('online')} className={seg(type === 'online')}><Video size={14} /> Online</button>
            <button type="button" onClick={() => setType('offline')} className={seg(type === 'offline')}><MapPin size={14} /> In person</button>
          </div>
          {type === 'online' ? (
            <div>
              <input className={inputClass} value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://…" />
              <p className="text-[11px] text-[#64748B] mt-1.5">Leave blank to auto-generate a link.</p>
            </div>
          ) : (
            <div>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / address" />
            </div>
          )}
        </div>

        {/* Agenda */}
        <div className="border-t border-[#E2E8F0] pt-4">
          <label className={labelClass}>{callMode === 'log_past' ? 'Agenda (what was planned)' : 'Agenda'}</label>
          <textarea className={`${inputClass} resize-none`} rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="Agenda (markdown supported)" />
        </div>

        {/* Quiet actions: link (left) · reminder (right) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => setShowLinker((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#0F172A]">
            <Link2 size={14} /> Link to a goal, task, or ticket
          </button>
          <label className="inline-flex items-center gap-2 text-xs text-[#475569] cursor-pointer select-none">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="w-4 h-4 accent-[#2563EB]" />
            <Bell size={14} /> Remind 15 min before
          </label>
        </div>

        {showLinker && (
          <div className="border border-[#E2E8F0] rounded-[8px] p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Link to</label>
              <StyledSelect
                value={linkType}
                onChange={(v) => { setLinkType(v as any); setLinkEntityId('') }}
                options={[
                  { value: '', label: 'Nothing' },
                  { value: 'goal', label: 'Goal' },
                  { value: 'project', label: 'Project' },
                  { value: 'task', label: 'Task' },
                  { value: 'ticket', label: 'Ticket' },
                ]}
              />
            </div>
            {linkType === 'goal' && (
              <div>
                <label className={labelClass}>Goal</label>
                <StyledSelect
                  value={linkEntityId}
                  onChange={setLinkEntityId}
                  placeholder="Select goal…"
                  options={goals.map((g) => ({ value: g.id, label: g.title }))}
                />
              </div>
            )}
            {linkType && linkType !== 'goal' && (
              <div>
                <label className={labelClass}>{linkType[0].toUpperCase() + linkType.slice(1)} ID</label>
                <input className={inputClass} value={linkEntityId} onChange={(e) => setLinkEntityId(e.target.value)} placeholder="Entity ID" />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" isLoading={saving} disabled={saving}>Create meeting</Button>
        </div>
      </form>

      {showFinder && (
        <FindTimeDialog
          orgId={orgId}
          people={people}
          attendees={attendees}
          optional={optional}
          date={date || todayStr()}
          durationMin={durationMin}
          initialStartMin={timeToMin(startTime)}
          onChangeAttendees={setAttendees}
          onChangeOptional={setOptional}
          onChangeDate={setDate}
          onChangeDuration={setDurationMin}
          onConfirm={(startIso, endIso) => {
            const s = new Date(startIso), e = new Date(endIso)
            setDate(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`)
            setStartTime(`${pad(s.getHours())}:${pad(s.getMinutes())}`)
            setEndTime(`${pad(e.getHours())}:${pad(e.getMinutes())}`)
            setDurationMin(Math.max(15, Math.round((e.getTime() - s.getTime()) / 60000)))
            setShowFinder(false)
          }}
          onClose={() => setShowFinder(false)}
        />
      )}
    </Modal>
  )
}

// Live, non-blocking clash nudge for the "confident" path. Names who + severity;
// never the other meeting's title (busy/free privacy). Booking is never blocked.
function ClashNudge({
  orgId, attendees, requiredIds, date, startTime, endTime,
}: {
  orgId: string
  attendees: string[]
  requiredIds: string[]
  date: string
  startTime: string
  endTime: string
}) {
  const [data, setData] = useState<BusyView | null>(null)
  useEffect(() => {
    if (!orgId || attendees.length === 0 || !date) { setData(null); return }
    let active = true
    meetingsApi
      .busy(orgId, {
        user_ids: attendees,
        required_user_ids: requiredIds,
        from: new Date(`${date}T00:00`).toISOString(),
        to: new Date(`${date}T23:59`).toISOString(),
      })
      .then((r) => { if (active) setData(r) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [orgId, attendees.join(','), requiredIds.join(','), date])

  if (!data) return null
  const dayStartMs = new Date(`${date}T00:00`).getTime()
  const candS = timeToMin(startTime)
  const candE = Math.max(candS + 1, timeToMin(endTime))
  const hard: string[] = [], soft: string[] = []
  for (const p of data.people) {
    const conflict = p.busy.some((b) => {
      const s = Math.round((new Date(b.start).getTime() - dayStartMs) / 60000)
      const e = Math.round((new Date(b.end).getTime() - dayStartMs) / 60000)
      return candS < e && s < candE
    })
    if (conflict) (p.required ? hard : soft).push(p.name)
  }

  if (hard.length === 0 && soft.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-[#16A34A]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" /> Everyone looks free at this time.
      </p>
    )
  }
  return (
    <div className="flex items-start gap-1.5 text-xs bg-[#FFFBEB] border border-[#FDE68A] rounded-[8px] px-3 py-2">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#D97706]" />
      <span className="text-[#475569]">
        {hard.length > 0 && <span className="text-[#B45309] font-medium">{hard.join(', ')} {hard.length === 1 ? 'is' : 'are'} busy then.</span>}
        {hard.length > 0 && soft.length > 0 ? ' ' : ''}
        {soft.length > 0 && <span className="text-[#64748B]">{soft.join(', ')} (optional) busy.</span>}
        {' '}You can still book — they’ll be notified.
      </span>
    </div>
  )
}
