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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

const labelClass = 'block text-body font-medium text-text-secondary mb-1.5'
const inputClass =
  'w-full border border-border rounded-[8px] px-3 py-2.5 text-[15px] text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'

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
  // Field errors sit under the field that is wrong (kit 11.3 rule 6).
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; date?: string; time?: string }>({})
  const clearErr = (k: 'title' | 'date' | 'time') => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))
  function failField(key: 'title' | 'date' | 'time', message: string, focusId: string) {
    setFieldErrors({ [key]: message })
    requestAnimationFrame(() => {
      const el = document.getElementById(focusId)
      ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
    })
  }
  const guarded = useGuardedClose({
    open: isOpen && !!meeting,
    values: { title, type, onlineLink, onlinePassword, location, date, startTime, endTime, attendees, optional },
    noun: 'meeting',
    mode: 'edit',
    onClose,
  })

  useEffect(() => {
    if (!isOpen || !meeting) return
    setError(''); setFieldErrors({}); setSaving(false)
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
    if (!title.trim()) return failField('title', 'Enter a title for the meeting.', 'edit-meeting-title')
    if (!date) return failField('date', 'Choose the date of the meeting.', 'edit-meeting-date')
    const startAt = new Date(`${date}T${startTime}:00`)
    const endAt = new Date(`${date}T${endTime}:00`)
    if (endAt <= startAt) return failField('time', 'Choose an end time after the start time.', 'edit-meeting-end')
    setFieldErrors({})
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
      addToast('Meeting saved', 'success')
      onSaved(updated)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not save the meeting. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={guarded.requestClose} title="Edit meeting" size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        {isOccurrence && (
          <div className="flex items-start gap-2 text-meta text-primary-text bg-primary-subtle border border-primary-border rounded-[8px] px-3 py-2">
            <CalendarClock size={15} className="mt-0.5 shrink-0" />
            <span>You’re editing <b>this occurrence only</b>. The rest of the series is unchanged. It updates just this event on Google Calendar too.</span>
          </div>
        )}

        <div>
          <Label className="mb-2" htmlFor="edit-meeting-title" required>Title</Label>
          <input id="edit-meeting-title" className={`${inputClass} aria-invalid:border-danger`} aria-invalid={fieldErrors.title ? true : undefined} value={title} onChange={(e) => { setTitle(e.target.value); clearErr('title') }} autoFocus />
          <InlineFieldError>{fieldErrors.title}</InlineFieldError>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="mb-2">Type</Label>
            <StyledSelect value={type} onChange={(v) => setType(v as MeetingType)} options={[
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'Offline' },
              { value: 'hybrid', label: 'Hybrid' },
            ]} />
          </div>
          {type !== 'offline' && (
            <div>
              <Label className="mb-2">Meeting link</Label>
              <input className={inputClass} value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {type !== 'offline' && (
            <div>
              <Label className="mb-2">Password</Label>
              <input className={inputClass} value={onlinePassword} onChange={(e) => setOnlinePassword(e.target.value)} />
            </div>
          )}
          {type !== 'online' && (
            <div>
              <Label className="mb-2">Location</Label>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / address" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <div>
            <Label className="mb-2" htmlFor="edit-meeting-date" required>Date</Label>
            <DatePicker id="edit-meeting-date" invalid={!!fieldErrors.date} value={date} onChange={(v) => { setDate(v); clearErr('date') }} placeholder="Select date" />
            <InlineFieldError>{fieldErrors.date}</InlineFieldError>
          </div>
          <div>
            <Label className="mb-2">Start</Label>
            <TimeField value={startTime} onChange={(t) => { setStartTime(t); setEndTime(addMinutes(t, durationMin)) }} />
          </div>
          <div>
            <Label className="mb-2">End</Label>
            <div id="edit-meeting-end"><TimeField value={endTime} onChange={(t) => { setEndTime(t); setDurationMin(minutesBetween(startTime, t)); clearErr('time') }} /></div>
            <InlineFieldError>{fieldErrors.time}</InlineFieldError>
          </div>
        </div>

        <DurationField
          value={durationMin}
          onChange={(min) => { setDurationMin(min); setEndTime(addMinutes(startTime, min)) }}
        />

        <div>
          <Label className="mb-2">Attendees</Label>
          <MeetingAttendeeSelector options={people} value={attendees} onChange={setAttendees} optional={optional} onToggleOptional={toggleOptional} />
          <p className="text-meta text-text-muted mt-1">Everyone is on it by default. Toggle who’s optional.</p>
        </div>

        {error && <p role="alert" className="text-label text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-light mt-1">
          <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving} loadingLabel="Saving" disabled={saving}>Save meeting</Button>
        </div>
      </form>
    </Modal>
    </>
  )
}
