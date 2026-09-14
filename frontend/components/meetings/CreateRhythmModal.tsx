'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi, type CreateRhythmInput } from '@/lib/api/meetings'
import { listEligibleSubjects } from '@/lib/api/permissions'
import { useAuth } from '@/lib/auth/context'
import type { MeetingRhythm, MeetingType } from '@/lib/types/meetings'
import StyledSelect from '@/components/ui/StyledSelect'
import ScheduleEntryRow, { type ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import SkipHolidaysField from './SkipHolidaysField'
import MeetingAttendeeSelector, { type PersonOption } from './MeetingAttendeeSelector'
import { DurationField } from './shared'

const inputClass =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
const labelClass = 'block text-sm font-medium text-[#374151] mb-1'
const todayStr = () => new Date().toISOString().slice(0, 10)
const freshSched = (): ScheduleEntryDraft => ({
  schedule_type: 'weekly', every: 1, days: [new Date().getDay()], month_days: [], yearly_dates: [],
  time: '10:00', start_date: todayStr(), end_condition: 'never', end_date: '', end_after: 10,
})

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  people: PersonOption[]
  onCreated: (r: MeetingRhythm) => void
  rhythm?: MeetingRhythm | null // present ⇒ edit mode
}

const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ordinal(n: number): string {
  const a = Math.abs(n)
  if (a % 100 >= 11 && a % 100 <= 13) return `${a}th`
  return `${a}${['th', 'st', 'nd', 'rd'][a % 10] ?? 'th'}`
}

// Day-of-month, honouring the "from the end" convention (negative = counted back
// from the last day; -1 = the last day).
function monthDayLabel(d: number): string {
  if (d > 0) return `the ${ordinal(d)}`
  if (d === -1) return 'the last day'
  return `the ${ordinal(-d)}-to-last day`
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// A plain-English description of the recurrence, e.g.
// "Your event will occur every 2 months on the 21st at 17:30, for 10 occurrences."
function recurrenceSummary(sched: ScheduleEntryDraft): string {
  const every = Math.max(1, sched.every || 1)
  const time = sched.time || ''
  let core = ''

  switch (sched.schedule_type) {
    case 'daily':
      core = every === 1 ? 'every day' : `every ${every} days`
      break
    case 'weekly': {
      const base = every === 1 ? 'every week' : `every ${every} weeks`
      const dayNames = (sched.days ?? []).slice().sort((a, b) => a - b).map((d) => WEEKDAY_FULL[d])
      core = dayNames.length ? `${base} on ${joinList(dayNames)}` : base
      break
    }
    case 'monthly': {
      const base = every === 1 ? 'every month' : `every ${every} months`
      const days = (sched.month_days ?? []).slice().sort((a, b) => a - b).map(monthDayLabel)
      core = days.length ? `${base} on ${joinList(days)}` : base
      break
    }
    case 'yearly': {
      const dates = (sched.yearly_dates ?? []).map((yd) => `${MONTH_FULL[(yd.month ?? 1) - 1]} ${ordinal(yd.day ?? 1)}`)
      core = dates.length ? `every year on ${joinList(dates)}` : 'every year'
      break
    }
    default:
      core = 'on a schedule'
  }

  let end = ''
  if (sched.end_condition === 'after_n' && sched.end_after) end = `, for ${sched.end_after} occurrence${sched.end_after === 1 ? '' : 's'}`
  else if (sched.end_condition === 'on_date' && sched.end_date) {
    const d = new Date(`${sched.end_date}T00:00`)
    end = `, until ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
  }

  return `Your event will occur ${core}${time ? ` at ${time}` : ''}${end}.`
}

export default function CreateRhythmModal({ isOpen, onClose, orgId, people, onCreated, rhythm }: Props) {
  const isEditing = !!rhythm
  const { addToast } = useToast()
  const { user } = useAuth()
  // The host is the rhythm's creator (current user for a new rhythm).
  const hostId = rhythm?.created_by_user_id ?? user?.id
  const [ineligibleReasons, setIneligibleReasons] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [type, setType] = useState<MeetingType>('online')
  const [onlineLink, setOnlineLink] = useState('')
  const [location, setLocation] = useState('')
  const [attendees, setAttendees] = useState<string[]>([])
  const [optional, setOptional] = useState<string[]>([])
  const [agenda, setAgenda] = useState('')
  const [durationMin, setDurationMin] = useState(30)

  const [sched, setSched] = useState<ScheduleEntryDraft>(freshSched)
  const [skipHolidays, setSkipHolidays] = useState(true)

  const [saving, setSaving] = useState(false)
  const nameOf = useMemo(() => new Map(people.map((p) => [p.user_id, p.name])), [people])

  useEffect(() => {
    if (!isOpen) return
    if (rhythm) {
      // Edit mode — hydrate every field from the existing rhythm + its schedule.
      setTitle(rhythm.title); setType(rhythm.type)
      setOnlineLink(rhythm.online_link ?? ''); setLocation(rhythm.location ?? '')
      setAttendees(rhythm.attendee_user_ids ?? []); setOptional(rhythm.optional_user_ids ?? [])
      setAgenda(rhythm.agenda ?? ''); setDurationMin(rhythm.duration_min ?? 30)
      const e = rhythm.schedule_entries?.[0]
      if (e) {
        setSched({
          schedule_type: e.schedule_type,
          every: e.every ?? 1,
          days: e.days ?? [],
          month_days: e.month_days ?? [],
          yearly_dates: e.yearly_dates ?? [],
          time: e.time ?? '10:00',
          start_date: e.start_date ? e.start_date.slice(0, 10) : todayStr(),
          end_condition: e.end_condition,
          end_date: e.end_date ? e.end_date.slice(0, 10) : '',
          end_after: e.end_after ?? 10,
        })
        setSkipHolidays((e as any).skip_holidays ?? true)
      } else {
        setSched(freshSched()); setSkipHolidays(true)
      }
      return
    }
    setTitle(''); setType('online'); setOnlineLink(''); setLocation(''); setAttendees([]); setOptional([]); setAgenda(''); setDurationMin(30)
    setSched(freshSched()); setSkipHolidays(true)
  }, [isOpen, rhythm])

  useEffect(() => { setOptional((opt) => opt.filter((id) => attendees.includes(id))) }, [attendees])

  // Grey out anyone who can't be invited to a meeting, up-front (vs failing on submit).
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

  function toggleOptional(id: string) { setOptional((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id])) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return addToast('Title is required', 'error')
    if (sched.schedule_type === 'weekly' && sched.days.length === 0) return addToast('Pick at least one weekday', 'error')
    if (sched.schedule_type === 'monthly' && sched.month_days.length === 0) return addToast('Pick at least one day of the month', 'error')
    if (sched.schedule_type === 'yearly' && sched.yearly_dates.length === 0) return addToast('Pick at least one date', 'error')
    if (!sched.start_date) return addToast('Pick a start date', 'error')

    const dto: CreateRhythmInput = {
      title: title.trim(),
      type,
      duration_min: durationMin,
      attendee_user_ids: attendees,
      optional_user_ids: optional,
      schedule: {
        schedule_type: sched.schedule_type,
        every: sched.schedule_type === 'daily' || sched.schedule_type === 'weekly' ? sched.every : 1,
        days: sched.schedule_type === 'weekly' ? sched.days : [],
        month_days: sched.schedule_type === 'monthly' ? sched.month_days : [],
        yearly_dates: sched.schedule_type === 'yearly' ? sched.yearly_dates : [],
        time: sched.time,
        start_date: new Date(`${sched.start_date}T00:00`).toISOString(),
        end_condition: sched.end_condition,
        end_date: sched.end_condition === 'on_date' && sched.end_date ? new Date(`${sched.end_date}T23:59`).toISOString() : undefined,
        end_after: sched.end_condition === 'after_n' ? sched.end_after : undefined,
        skip_holidays: skipHolidays,
      },
    }
    if (type !== 'offline' && onlineLink) dto.online_link = onlineLink
    if (type !== 'online') dto.location = location
    if (agenda.trim()) dto.agenda = agenda.trim()

    setSaving(true)
    try {
      const r = rhythm
        ? await meetingsApi.updateRhythm(orgId, rhythm.id, dto)
        : await meetingsApi.createRhythm(orgId, dto)
      addToast(rhythm ? 'Rhythm updated' : 'Rhythm created', 'success')
      onCreated(r)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? (rhythm ? 'Failed to update rhythm' : 'Failed to create rhythm'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Rhythm' : 'New Rhythm'} size="lg" closeOnEscape={false}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Daily huddle, Thursday review" autoFocus />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <StyledSelect
              value={type}
              onChange={(v) => setType(v as MeetingType)}
              options={[
                { value: 'online', label: 'Online' },
                { value: 'offline', label: 'Offline' },
                { value: 'hybrid', label: 'Hybrid' },
              ]}
            />
          </div>
          {type !== 'offline' && (
            <div>
              <label className={labelClass}>Meeting link</label>
              <input className={inputClass} value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {type !== 'online' && (
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / address" />
            </div>
          )}
        </div>

        <DurationField value={durationMin} onChange={setDurationMin} />

        {/* Attendees */}
        <div>
          <label className={labelClass}>Attendees</label>
          <MeetingAttendeeSelector
            options={people}
            value={attendees}
            onChange={setAttendees}
            optional={optional}
            onToggleOptional={toggleOptional}
            hostId={hostId}
            hostLabel={hostId === user?.id ? 'You' : rhythm?.created_by_name}
            ineligibleReasons={ineligibleReasons}
          />
          <p className="text-xs text-[#64748B] mt-1">The host is on every occurrence by default. Everyone you add is too — toggle who is optional.</p>
        </div>

        {/* Recurrence — the SAME shared editor as recurring tasks and meetings */}
        <div>
          <label className={labelClass}>Recurrence <span className="text-[#DC2626]">*</span></label>
          <div className="border border-[#E2E8F0] rounded-[12px] p-4">
            <ScheduleEntryRow
              entry={sched}
              index={0}
              onUpdate={(patch) => setSched((s) => ({ ...s, ...patch }))}
              onDelete={() => {}}
              canDelete={false}
            />
            <SkipHolidaysField orgId={orgId} sched={sched} value={skipHolidays} onChange={setSkipHolidays} />
          </div>
          <p className="mt-2 flex items-start gap-2 text-sm text-[#1D4ED8] font-medium bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] px-3 py-2">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2563EB] shrink-0" />
            <span>{recurrenceSummary(sched)}</span>
          </p>
        </div>

        <div>
          <label className={labelClass}>Agenda (optional)</label>
          <textarea className={`${inputClass} resize-none`} rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="Standing agenda, copied to every occurrence" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" isLoading={saving} disabled={saving}>Create rhythm</Button>
        </div>
      </form>
    </Modal>
  )
}
