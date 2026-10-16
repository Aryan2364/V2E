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
import { DraftBanner } from '../DraftBanner'
import PhoneScreen from '../PhoneScreen'
import { PhoneButton, cx } from '../primitives'
import { PhoneDateField, PhoneTimeField } from '../PhoneDateTimeField'
import { AttendeePickerSheet } from '../AttendeePickerSheet'

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

  const [people, setPeople] = React.useState<PersonOption[]>([])
  const [attendeeIds, setAttendeeIds] = React.useState<string[]>([])
  const [optionalIds, setOptionalIds] = React.useState<string[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

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
            .map((e: any) => ({ user_id: e.user_id, name: e.user?.name ?? e.name ?? e.email ?? 'Unknown', email: e.user?.email })),
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
    if (!title.trim()) next.title = 'Title is required.'
    if (date && startTime && endTime) {
      const s = toIso(date, startTime)
      const e = toIso(date, endTime)
      if (s && e && new Date(e).getTime() <= new Date(s).getTime()) next.endTime = 'End time must be after the start time.'
    }
    setErrors(next)
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
      draft.clear()
      addToast('Meeting created', 'success')
      router.replace(`/dashboard/governance/meetings/${meeting.id}`)
    } catch {
      addToast('Could not create the meeting. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const selectedPeople = people.filter((p) => attendeeIds.includes(p.user_id))

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? MEETINGS_HREF}>
      <div className="flex flex-col gap-[20px] pb-[96px]">
        <DraftBanner draft={draft} onUse={restoreDraft} />

        <Field label="Title" required error={errors.title}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={250}
            enterKeyHint="next"
            placeholder="e.g. Weekly sync"
            className="min-h-(--h-control) w-full rounded-[8px] border border-border bg-surface px-[12px] text-body text-text-primary outline-hidden focus-visible:border-primary"
          />
        </Field>

        <div className="flex flex-col gap-[6px]">
          <span className="text-label font-medium text-text-secondary">Type</span>
          <div className="flex gap-[8px]">
            {(['online', 'offline'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cx(
                  'flex-1 min-h-(--h-control) rounded-[8px] border-2 text-body font-semibold',
                  type === t ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-text-secondary',
                )}
              >
                {t === 'online' ? 'Online' : 'In person'}
              </button>
            ))}
          </div>
        </div>

        {type === 'online' ? (
          <Field label="Meeting link">
            <input
              type="url"
              value={onlineLink}
              onChange={(e) => setOnlineLink(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="min-h-(--h-control) w-full rounded-[8px] border border-border bg-surface px-[12px] text-body text-text-primary outline-hidden focus-visible:border-primary"
            />
          </Field>
        ) : (
          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Conference room 2"
              className="min-h-(--h-control) w-full rounded-[8px] border border-border bg-surface px-[12px] text-body text-text-primary outline-hidden focus-visible:border-primary"
            />
          </Field>
        )}

        <PhoneDateField id="meeting-date" label="Date" value={date} onChange={setDate} />

        <div className="grid grid-cols-2 gap-[12px]">
          <PhoneTimeField id="meeting-start" label="Start time" value={startTime} onChange={setStartTime} />
          <PhoneTimeField id="meeting-end" label="End time" value={endTime} onChange={setEndTime} />
        </div>
        {errors.endTime ? <p className="text-meta text-danger">{errors.endTime}</p> : null}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-light bg-surface px-[12px] text-left active:bg-surface-control"
        >
          <span className="text-body text-text-primary">
            Attendees{selectedPeople.length > 0 ? ` · ${selectedPeople.length}` : ''}
          </span>
          <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
        </button>
        {selectedPeople.length > 0 ? (
          <p className="text-meta text-text-secondary">{selectedPeople.map((p) => p.name).join(', ')}</p>
        ) : null}

        {agendaOpen ? (
          <Field label="Agenda">
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={4}
              placeholder="What this meeting will cover"
              className="w-full rounded-[8px] border border-border bg-surface px-[12px] py-[10px] text-body text-text-primary outline-hidden focus-visible:border-primary"
            />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setAgendaOpen(true)}
            className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-light bg-surface px-[12px] text-left active:bg-surface-control"
          >
            <span className="text-body text-text-primary">Add agenda</span>
            <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
          </button>
        )}
      </div>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-30 border-t border-border-light bg-surface px-[16px] py-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton variant="primary" fullWidth disabled={saving} onClick={() => void onSave()}>
          {saving ? 'Creating…' : 'Create meeting'}
        </PhoneButton>
      </div>

      <AttendeePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        people={people}
        selected={attendeeIds}
        optional={optionalIds}
        onApply={(sel, opt) => {
          setAttendeeIds(sel)
          setOptionalIds(opt)
        }}
      />
    </PhoneScreen>
  )
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label className="text-label font-medium text-text-secondary">
        {label} {required ? <span aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? <p className="text-meta text-danger">{error}</p> : null}
    </div>
  )
}
