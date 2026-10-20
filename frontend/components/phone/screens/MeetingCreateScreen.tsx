'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import type { MeetingType } from '@/lib/types/meetings'
import { MEETINGS_HREF, type PhoneRoute } from '@/lib/phone-routes'
import { useDraft } from '@/lib/drafts'
import { isChanged, useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { DraftBanner } from '../DraftBanner'
import PhoneScreen from '../PhoneScreen'
import { PhoneButton, PhoneField, GrowTextarea, PHONE_INPUT, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import { PhoneDateField, PhoneTimeField } from '../PhoneDateTimeField'
import { PeoplePickerSheet, SelectedPeopleList, type PickerSection } from '../PeoplePickerSheet'

/*
 * Create meeting - plan-phone-2026-10-14.md §5.9, grounded in
 * CreateMeetingDto. One column, Save fixed at the bottom (§41.7 rule 3).
 * "Log a past meeting" and rhythms stay computer-only (owner scope, D11).
 *
 * Draft: lib/drafts.ts (kit §41.7 rules 12-15), form id "meeting-create",
 * record "new". Offered back with a banner, never restored silently;
 * cleared on a successful save and on sign-out (lib/auth's logout calls
 * clearDrafts).
 */

type MeetingCreateValues = {
  title: string
  type: MeetingType
  date: string
  startTime: string
  endTime: string
  onlineLink: string
  location: string
  agenda: string
}
type AttendeeOption = PersonOption & { department?: string | null; role?: string | null }

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

export default function MeetingCreateScreen({ route }: { route: PhoneRoute }) {
  const router = useRouter()
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [title, setTitle] = React.useState('')
  const [type, setType] = React.useState<MeetingType>('online')
  const [date, setDate] = React.useState('')
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')
  const [onlineLink, setOnlineLink] = React.useState('')
  const [location, setLocation] = React.useState('')
  const [agendaOpen, setAgendaOpen] = React.useState(false)
  const [agenda, setAgenda] = React.useState('')

  const [people, setPeople] = React.useState<AttendeeOption[]>([])
  const [attendeeIds, setAttendeeIds] = React.useState<string[]>([])
  const [optionalIds, setOptionalIds] = React.useState<string[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [titleTouched, setTitleTouched] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  const draftValues: MeetingCreateValues = {
    title,
    type,
    date,
    startTime,
    endTime,
    onlineLink,
    location,
    agenda,
  }
  const draft = useDraft<MeetingCreateValues>({
    person: user?.id,
    form: 'meeting-create',
    record: 'new',
    values: draftValues,
  })

  const [saved, setSaved] = React.useState(false)
  const unsaved = useUnsavedChanges({
    changed:
      !saved &&
      (isChanged(draftValues, { title: '', type: 'online', date: '', startTime: '', endTime: '', onlineLink: '', location: '', agenda: '' }) ||
        attendeeIds.length > 0 ||
        optionalIds.length > 0),
    noun: 'meeting',
    mode: 'create',
    onLeave: () => draft.clear(),
  })

  function restoreDraft(kept: Partial<MeetingCreateValues>) {
    if (kept.title !== undefined) setTitle(kept.title)
    if (kept.type !== undefined) setType(kept.type)
    if (kept.date !== undefined) setDate(kept.date)
    if (kept.startTime !== undefined) setStartTime(kept.startTime)
    if (kept.endTime !== undefined) setEndTime(kept.endTime)
    if (kept.onlineLink !== undefined) setOnlineLink(kept.onlineLink)
    if (kept.location !== undefined) setLocation(kept.location)
    if (kept.agenda !== undefined) {
      setAgenda(kept.agenda)
      if (kept.agenda) setAgendaOpen(true)
    }
  }

  React.useEffect(() => {
    if (!orgId) return
    getEmployees(orgId)
      .then((emps) =>
        setPeople(
          emps
            .filter((e) => e.user_id !== user?.id)
            .map((e: any) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown', email: e.user?.email, department: e.department?.name ?? null, role: e.role?.name ?? null })),
        ),
      )
      .catch(() => setPeople([]))
  }, [orgId, user?.id])

  function toIso(dateStr: string, timeStr: string): string | undefined {
    if (!dateStr || !timeStr) return undefined
    const d = new Date(`${dateStr}T${timeStr}:00`)
    return isNaN(d.getTime()) ? undefined : d.toISOString()
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = 'Enter a title.'
    if (!date) next.date = 'Choose a date.'
    if (!startTime) next.startTime = 'Choose a start time.'
    if (date && startTime && endTime) {
      const s = toIso(date, startTime)
      const e = toIso(date, endTime)
      if (s && e && new Date(e).getTime() <= new Date(s).getTime()) next.endTime = 'End time must be after the start time.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) focusFirstInvalid(formRef.current)
    return Object.keys(next).length === 0
  }

  async function onSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const meeting = await meetingsApi.create(orgId, {
        title: title.trim(),
        type,
        online_link: type === 'online' ? onlineLink.trim() || undefined : undefined,
        location: type === 'offline' ? location.trim() || undefined : undefined,
        scheduled_start: toIso(date, startTime),
        scheduled_end: toIso(date, endTime),
        attendee_user_ids: attendeeIds,
        optional_user_ids: optionalIds,
        agenda: agenda.trim() || undefined,
      })
      setSaved(true)
      draft.clear()
      addToast('Meeting created', 'success')
      router.replace(`/dashboard/governance/meetings/${meeting.id}`)
    } catch {
      addToast('Could not create the meeting. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const selectedPeople = people.filter((p) => attendeeIds.includes(p.user_id))

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? MEETINGS_HREF}>
      {unsaved.warning}
      <form ref={formRef} noValidate onKeyDown={enterMovesNext} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-[20px] pb-[96px]">
        <DraftBanner draft={draft} onUse={restoreDraft} />

        <PhoneField label="Title" htmlFor="meeting-title" required error={errors.title ?? (titleTouched && !title.trim() ? 'Enter a title.' : null)}>
          <input
            id="meeting-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleTouched(true)}
            maxLength={250}
            enterKeyHint="next"
            autoComplete="off"
            autoFocus
            placeholder="For example, Weekly sync"
            aria-invalid={errors.title || (titleTouched && !title.trim()) ? true : undefined}
            className={PHONE_INPUT}
          />
        </PhoneField>

        <PhoneField label="Type">
          <div role="group" aria-label="Type" className="flex gap-[8px]">
            {(['online', 'offline'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={cx(
                  'flex-1 min-h-(--h-control) rounded-[8px] border-2 text-body font-medium',
                  type === t ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-text-secondary',
                )}
              >
                {t === 'online' ? 'Online' : 'In person'}
              </button>
            ))}
          </div>
        </PhoneField>

        {type === 'online' ? (
          <PhoneField label="Meeting link" htmlFor="meeting-link">
            <input
              id="meeting-link"
              type="url"
              value={onlineLink}
              onChange={(e) => setOnlineLink(e.target.value)}
              placeholder="https://meet.example.com/abc"
              enterKeyHint="next"
              autoComplete="off"
              inputMode="url"
              className={PHONE_INPUT}
            />
          </PhoneField>
        ) : (
          <PhoneField label="Location" htmlFor="meeting-location">
            <input
              id="meeting-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="For example, Conference room 2"
              enterKeyHint="next"
              className={PHONE_INPUT}
            />
          </PhoneField>
        )}

        <PhoneDateField id="meeting-date" label="Date" required value={date} onChange={setDate} error={errors.date} />

        <div className="grid grid-cols-2 gap-[12px]">
          <PhoneTimeField id="meeting-start" label="Start time" required value={startTime} onChange={setStartTime} error={errors.startTime} />
          <PhoneTimeField id="meeting-end" label="End time" value={endTime} onChange={setEndTime} error={errors.endTime} />
        </div>

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
          onRemove={(id) => {
            setAttendeeIds((cur) => cur.filter((x) => x !== id))
            setOptionalIds((cur) => cur.filter((x) => x !== id))
          }}
        />

        {agendaOpen ? (
          <PhoneField label="Agenda" htmlFor="meeting-agenda">
            <GrowTextarea
              id="meeting-agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={4}
              placeholder="For example, Review last week's actions"
              className={cx(PHONE_INPUT, 'py-[10px]')}
            />
          </PhoneField>
        ) : (
          <button
            type="button"
            onClick={() => setAgendaOpen(true)}
            className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-strong bg-surface px-[12px] text-left active:bg-surface-control"
          >
            <span className="text-body text-text-primary">Add agenda</span>
            <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
          </button>
        )}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-(--z-shell) border-t border-border-light bg-surface px-[16px] py-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton variant="primary" fullWidth loading={saving} onClick={() => void onSave()}>
          Save meeting
        </PhoneButton>
      </div>

      <PeoplePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Invite"
        sections={groupByDepartment(people)}
        selected={selectedPeople}
        optionalIds={optionalIds}
        allowOptional
        onDone={(sel, opt) => {
          setAttendeeIds(sel.map((p) => p.user_id))
          setOptionalIds(opt)
        }}
      />
    </PhoneScreen>
  )
}
