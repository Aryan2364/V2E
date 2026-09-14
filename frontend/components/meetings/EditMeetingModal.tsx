'use client'

import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import StyledSelect from '@/components/ui/StyledSelect'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting, MeetingType } from '@/lib/types/meetings'
import MeetingAttendeeSelector, { type PersonOption } from './MeetingAttendeeSelector'
import { DurationField } from './shared'

const labelClass = 'block text-sm font-medium text-[#334155] mb-1.5'
const inputClass =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2.5 text-[15px] text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'

function pad(n: number) { return String(n).padStart(2, '0') }
function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function minutesBetween(start: string, end: string): number {
  const diff = timeToMin(end) - timeToMin(start)
  return diff > 0 ? diff : diff + 1440
}
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

// Focused single-meeting editor. For a rhythm occurrence, editing this one meeting
// updates ONLY that occurrence (the backend maps it to a Google instance exception);
// changing the whole series is done from the rhythm Edit flow instead.
export default function EditMeetingModal({
  isOpen,
  onClose,
  orgId,
  meeting,
  people,
  isOccurrence,
  onSaved,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  meeting: Meeting | null
  people: PersonOption[]
  isOccurrence?: boolean
  onSaved: (m: Meeting) => void
}) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<MeetingType>('online')
  const [onlineLink, setOnlineLink] = useState('')
  const [onlinePassword, setOnlinePassword] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')
  const [durationMin, setDurationMin] = useState(60)
  const [attendees, setAttendees] = useState<string[]>([])
  const [optional, setOptional] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !meeting) return
    setError(''); setSaving(false)
    setTitle(meeting.title)
    setType(meeting.type)
    setOnlineLink(meeting.online_link ?? '')
    setOnlinePassword(meeting.online_password ?? '')
    setLocation(meeting.location ?? '')
    const rows = meeting.attendees ?? []
    setAttendees(rows.filter((a) => !a.is_organizer).map((a) => a.user_id))
    setOptional(rows.filter((a) => !a.is_organizer && !a.is_required).map((a) => a.user_id))
    if (meeting.scheduled_start) {
      const d = new Date(meeting.scheduled_start)
      setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      setStartTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    }
    if (meeting.scheduled_end) {
      const e = new Date(meeting.scheduled_end)
      setEndTime(`${pad(e.getHours())}:${pad(e.getMinutes())}`)
      if (meeting.scheduled_start) {
        setDurationMin(Math.max(5, Math.round((e.getTime() - new Date(meeting.scheduled_start).getTime()) / 60000)))
      }
    }
  }, [isOpen, meeting])

  function toggleOptional(id: string) {
    setOptional((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!meeting) return
    setError('')
    if (!title.trim()) { setError('Give the meeting a title.'); return }
    if (!date) { setError('Pick a date.'); return }
    const startAt = new Date(`${date}T${startTime}:00`)
    const endAt = new Date(`${date}T${endTime}:00`)
    if (endAt <= startAt) { setError('End time must be after the start time.'); return }
    setSaving(true)
    try {
      const dto: Record<string, unknown> = {
        title: title.trim(),
        type,
        location: type !== 'online' ? location : undefined,
        online_link: type !== 'offline' ? onlineLink : undefined,
        online_password: type !== 'offline' ? onlinePassword : undefined,
        scheduled_start: startAt.toISOString(),
        scheduled_end: endAt.toISOString(),
        attendee_user_ids: attendees,
        optional_user_ids: optional,
      }
      const updated = await meetingsApi.update(orgId, meeting.id, dto)
      addToast('Meeting updated', 'success')
      onSaved(updated)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit meeting" size="lg" closeOnEscape={false}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        {isOccurrence && (
          <div className="flex items-start gap-2 text-xs text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] px-3 py-2">
            <CalendarClock size={15} className="mt-0.5 shrink-0" />
            <span>You’re editing <b>this occurrence only</b>. The rest of the series is unchanged. It updates just this event on Google Calendar too.</span>
          </div>
        )}

        <div>
          <label className={labelClass}>Title <span className="text-[#DC2626]">*</span></label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <StyledSelect value={type} onChange={(v) => setType(v as MeetingType)} options={[
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'Offline' },
              { value: 'hybrid', label: 'Hybrid' },
            ]} />
          </div>
          {type !== 'offline' && (
            <div>
              <label className={labelClass}>Meeting link</label>
              <input className={inputClass} value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {type !== 'offline' && (
            <div>
              <label className={labelClass}>Password <span className="text-[#94A3B8] font-normal">(optional)</span></label>
              <input className={inputClass} value={onlinePassword} onChange={(e) => setOnlinePassword(e.target.value)} />
            </div>
          )}
          {type !== 'online' && (
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / address" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <div>
            <label className={labelClass}>Date <span className="text-[#DC2626]">*</span></label>
            <DatePicker value={date} onChange={setDate} placeholder="Select date" />
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

        <DurationField
          value={durationMin}
          onChange={(min) => { setDurationMin(min); setEndTime(addMinutes(startTime, min)) }}
        />

        <div>
          <label className={labelClass}>Attendees</label>
          <MeetingAttendeeSelector options={people} value={attendees} onChange={setAttendees} optional={optional} onToggleOptional={toggleOptional} />
          <p className="text-xs text-[#64748B] mt-1">Everyone is on it by default. Toggle who’s optional.</p>
        </div>

        {error && <p className="text-sm text-[#DC2626]">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#E2E8F0] mt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] hover:bg-[#F8FAFC]">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
