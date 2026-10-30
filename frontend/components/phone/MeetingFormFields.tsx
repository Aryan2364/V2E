'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import { getEmployees } from '@/lib/api/employees'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import type { MeetingType } from '@/lib/types/meetings'
import { PhoneField, PHONE_INPUT, cx } from './primitives'
import { PhoneDateField, PhoneTimeField } from './PhoneDateTimeField'
import { PeoplePickerSheet, SelectedPeopleList, type PickerSection } from './PeoplePickerSheet'

/*
 * The fields the phone's Create meeting and Edit meeting screens share, so the
 * two cannot drift apart. They mirror desktop's CreateMeetingModal and
 * EditMeetingModal: title, type (online / in person / hybrid), link and
 * password for anything that is not in person, location for anything that is
 * not online, date and times, and who is invited (some optional).
 */

export type MeetingFormValues = {
  title: string
  type: MeetingType
  date: string
  startTime: string
  endTime: string
  onlineLink: string
  onlinePassword: string
  location: string
  attendeeIds: string[]
  optionalIds: string[]
}

export const EMPTY_MEETING_FORM: MeetingFormValues = {
  title: '',
  type: 'online',
  date: '',
  startTime: '',
  endTime: '',
  onlineLink: '',
  onlinePassword: '',
  location: '',
  attendeeIds: [],
  optionalIds: [],
}

export type AttendeeOption = PersonOption & { department?: string | null; role?: string | null }

/** Departments A-Z, people A-Z inside each, people without a department last (like the task assignee picker). */
function groupByDepartment(people: AttendeeOption[]): PickerSection[] {
  const byName = (a: AttendeeOption, b: AttendeeOption) => a.name.localeCompare(b.name)
  const groups = new Map<string, AttendeeOption[]>()
  for (const p of people) {
    const key = p.department?.trim() || ''
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const toSection = (name: string, list: AttendeeOption[]): PickerSection => ({
    id: name || 'none',
    name: name || 'No department',
    people: [...list].sort(byName).map((p) => ({ user_id: p.user_id, name: p.name, role: p.role ?? null, department: p.department ?? null })),
  })
  const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((k) => toSection(k, groups.get(k)!))
  const none = groups.get('')
  return none ? [...named, toSection('', none)] : named
}

type EmployeeRow = {
  user_id: string
  name?: string
  email?: string
  user?: { name?: string; email?: string }
  department?: { name?: string } | null
  role?: { name?: string } | null
}

/** Everyone who can be invited, except the person who runs the meeting (they are always on it). */
export function useInvitees(orgId: string, excludeUserId?: string): AttendeeOption[] {
  const [people, setPeople] = React.useState<AttendeeOption[]>([])
  React.useEffect(() => {
    if (!orgId) return
    getEmployees(orgId)
      .then((emps) =>
        setPeople(
          emps
            .filter((e) => e.user_id !== excludeUserId)
            .map((e) => {
              const emp = e as unknown as EmployeeRow
              return {
                user_id: emp.user_id,
                name: emp.user?.name ?? emp.name ?? emp.email ?? 'Unknown',
                email: emp.user?.email,
                department: emp.department?.name ?? null,
                role: emp.role?.name ?? null,
              }
            }),
        ),
      )
      .catch(() => setPeople([]))
  }, [orgId, excludeUserId])
  return people
}

export function toIso(dateStr: string, timeStr: string): string | undefined {
  if (!dateStr || !timeStr) return undefined
  const d = new Date(`${dateStr}T${timeStr}:00`)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Desktop's checks (CreateMeetingModal / EditMeetingModal): a title, a date, a start, and an end after the start. */
export function validateMeetingForm(v: MeetingFormValues, opts: { needsWhen: boolean }): Record<string, string> {
  const next: Record<string, string> = {}
  if (!v.title.trim()) next.title = 'Enter a title.'
  if (opts.needsWhen) {
    if (!v.date) next.date = 'Choose a date.'
    if (!v.startTime) next.startTime = 'Choose a start time.'
    if (v.date && v.startTime && v.endTime) {
      const s = toIso(v.date, v.startTime)
      const e = toIso(v.date, v.endTime)
      if (s && e && new Date(e).getTime() <= new Date(s).getTime()) next.endTime = 'End time must be after the start time.'
    }
  }
  return next
}

const TYPES: { value: MeetingType; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'In person' },
  { value: 'hybrid', label: 'Hybrid' },
]

export function MeetingFormFields({
  values,
  onChange,
  errors,
  people,
  whenSlot,
  dateLabel = 'Date',
}: {
  values: MeetingFormValues
  onChange: (patch: Partial<MeetingFormValues>) => void
  errors: Record<string, string>
  people: AttendeeOption[]
  /** Replaces the date and time fields (a recurring meeting asks for its own schedule instead). */
  whenSlot?: React.ReactNode
  dateLabel?: string
}) {
  const [titleTouched, setTitleTouched] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const selectedPeople = people.filter((p) => values.attendeeIds.includes(p.user_id))
  const { type } = values
  const showLink = type !== 'offline'
  const showLocation = type !== 'online'

  return (
    <>
      <PhoneField label="Title" htmlFor="meeting-title" required error={errors.title ?? (titleTouched && !values.title.trim() ? 'Enter a title.' : null)}>
        <input
          id="meeting-title"
          type="text"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={() => setTitleTouched(true)}
          maxLength={250}
          enterKeyHint="next"
          autoComplete="off"
          placeholder="For example, Weekly sync"
          aria-invalid={errors.title || (titleTouched && !values.title.trim()) ? true : undefined}
          className={PHONE_INPUT}
        />
      </PhoneField>

      <PhoneField label="Type">
        <div role="group" aria-label="Type" className="flex gap-[8px]">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={type === t.value}
              onClick={() => onChange({ type: t.value })}
              className={cx(
                'flex-1 min-h-(--h-control) rounded-[8px] border-2 text-body font-medium',
                type === t.value ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-text-secondary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PhoneField>

      {showLink ? (
        <>
          <PhoneField label="Meeting link" htmlFor="meeting-link">
            <input
              id="meeting-link"
              type="url"
              value={values.onlineLink}
              onChange={(e) => onChange({ onlineLink: e.target.value })}
              placeholder="https://meet.example.com/abc"
              enterKeyHint="next"
              autoComplete="off"
              inputMode="url"
              className={PHONE_INPUT}
            />
          </PhoneField>
          <PhoneField label="Password" htmlFor="meeting-password">
            <input
              id="meeting-password"
              type="text"
              value={values.onlinePassword}
              onChange={(e) => onChange({ onlinePassword: e.target.value })}
              enterKeyHint="next"
              autoComplete="off"
              autoCapitalize="off"
              className={PHONE_INPUT}
            />
          </PhoneField>
        </>
      ) : null}

      {showLocation ? (
        <PhoneField label="Location" htmlFor="meeting-location">
          <input
            id="meeting-location"
            type="text"
            value={values.location}
            onChange={(e) => onChange({ location: e.target.value })}
            placeholder="For example, Conference room 2"
            enterKeyHint="next"
            className={PHONE_INPUT}
          />
        </PhoneField>
      ) : null}

      {whenSlot ?? (
        <>
          <PhoneDateField id="meeting-date" label={dateLabel} required value={values.date} onChange={(date) => onChange({ date })} error={errors.date} />
          <div className="grid grid-cols-2 gap-[12px]">
            <PhoneTimeField id="meeting-start" label="Start time" required value={values.startTime} onChange={(startTime) => onChange({ startTime })} error={errors.startTime} />
            <PhoneTimeField id="meeting-end" label="End time" value={values.endTime} onChange={(endTime) => onChange({ endTime })} error={errors.endTime} />
          </div>
        </>
      )}

      <PhoneField label="Attendees" htmlFor="meeting-attendees">
        <button
          id="meeting-attendees"
          type="button"
          data-field
          onClick={() => setPickerOpen(true)}
          className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-strong bg-surface px-[12px] text-left active:bg-surface-control"
        >
          <span className={cx('text-body', selectedPeople.length > 0 ? 'text-text-primary' : 'text-text-secondary')}>
            {selectedPeople.length > 0 ? `${selectedPeople.length} chosen` : 'Choose who is invited'}
          </span>
          <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
        </button>
      </PhoneField>
      <SelectedPeopleList
        people={selectedPeople}
        onRemove={(id) =>
          onChange({
            attendeeIds: values.attendeeIds.filter((x) => x !== id),
            optionalIds: values.optionalIds.filter((x) => x !== id),
          })
        }
      />

      <PeoplePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Invite"
        sections={groupByDepartment(people)}
        selected={selectedPeople}
        optionalIds={values.optionalIds}
        allowOptional
        onDone={(sel, opt) => onChange({ attendeeIds: sel.map((p) => p.user_id), optionalIds: opt })}
      />
    </>
  )
}
