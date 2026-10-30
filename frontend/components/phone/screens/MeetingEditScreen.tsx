'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CalendarClock, Repeat } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting, MeetingRhythm } from '@/lib/types/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { MEETINGS_HREF, meetingHref, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { PhoneFailedState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import { MeetingSeriesEditSheet } from '../MeetingSeriesEditSheet'
import {
  EMPTY_MEETING_FORM,
  MeetingFormFields,
  toIso,
  useInvitees,
  validateMeetingForm,
  type MeetingFormValues,
} from '../MeetingFormFields'

/*
 * Edit / reschedule a meeting. Mirrors desktop's EditMeetingModal
 * (components/meetings/EditMeetingModal.tsx ~131-142): title, type, link,
 * password, location, date, start, end, attendees (some optional), saved with
 * PATCH meetings/:id. Same gate as desktop's Edit button
 * (meetings/[meetingId]/page.tsx ~149): the viewer can manage the meeting
 * (can_manage) and it is scheduled or in progress.
 * A meeting that belongs to a recurring series first asks "this one or the
 * whole series" as desktop does (~202-213): this one is the form below, the
 * whole series is MeetingSeriesEditSheet (PATCH meetings/rhythms/:id).
 */

const pad = (n: number) => String(n).padStart(2, '0')

function formFromMeeting(m: Meeting): MeetingFormValues {
  const rows = m.attendees ?? []
  const form: MeetingFormValues = {
    ...EMPTY_MEETING_FORM,
    title: m.title,
    type: m.type,
    onlineLink: m.online_link ?? '',
    onlinePassword: m.online_password ?? '',
    location: m.location ?? '',
    attendeeIds: rows.filter((a) => !a.is_organizer).map((a) => a.user_id),
    optionalIds: rows.filter((a) => !a.is_organizer && !a.is_required).map((a) => a.user_id),
  }
  if (m.scheduled_start) {
    const d = new Date(m.scheduled_start)
    form.date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    form.startTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (m.scheduled_end) {
    const e = new Date(m.scheduled_end)
    form.endTime = `${pad(e.getHours())}:${pad(e.getMinutes())}`
  }
  return form
}

export default function MeetingEditScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ meetingId: string }>()
  const meetingId = params?.meetingId ?? ''
  const router = useRouter()
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const back = route.parent ?? (meetingId ? meetingHref(meetingId) : MEETINGS_HREF)

  const [meeting, setMeeting] = React.useState<Meeting | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [form, setForm] = React.useState<MeetingFormValues>(EMPTY_MEETING_FORM)
  // For a series meeting: null = not chosen yet, 'one' = just this one, 'series' = the sheet is open.
  const [scope, setScope] = React.useState<'one' | 'series' | null>(null)
  const [rhythm, setRhythm] = React.useState<MeetingRhythm | null>(null)
  const [loadingSeries, setLoadingSeries] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  const people = useInvitees(orgId, meeting?.organizer?.id ?? meeting?.created_by_user_id)

  const load = React.useCallback(() => {
    if (!orgId || !meetingId) return
    meetingsApi
      .get(orgId, meetingId)
      .then((m) => {
        setMeeting(m)
        setForm(formFromMeeting(m))
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [orgId, meetingId])

  React.useEffect(() => {
    load()
  }, [load])

  if (failed) {
    return (
      <PhoneScreen title={route.title} parent={back}>
        <PhoneFailedState what="This meeting" onRetry={() => { setFailed(false); load() }} />
        <PhoneLinkButton href={MEETINGS_HREF} fullWidth>
          Go to meetings
        </PhoneLinkButton>
      </PhoneScreen>
    )
  }

  if (!meeting) {
    return (
      <PhoneScreen title={route.title} parent={back}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  // Desktop shows Edit only while the viewer can manage it and it is open (page.tsx ~149).
  const canEdit = !!meeting.can_manage && (meeting.status === 'scheduled' || meeting.status === 'in_progress')
  if (!canEdit) {
    return (
      <PhoneScreen title={route.title} parent={back}>
        <div className="flex flex-col gap-[16px]">
          <p className="text-body text-text-primary">
            {meeting.can_manage
              ? 'This meeting has finished or been cancelled, so it can no longer be changed.'
              : 'Only the person who runs this meeting, or someone allowed to manage meetings, can change it.'}
          </p>
          <PhoneLinkButton href={meetingHref(meeting.id)} fullWidth>
            Back to the meeting
          </PhoneLinkButton>
        </div>
      </PhoneScreen>
    )
  }

  async function chooseSeries() {
    if (!meeting?.rhythm_id) return
    setLoadingSeries(true)
    try {
      setRhythm(await meetingsApi.getRhythm(orgId, meeting.rhythm_id))
      setScope('series')
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not load the series. Try again.'), 'error')
    } finally {
      setLoadingSeries(false)
    }
  }

  if (meeting.rhythm_id && scope !== 'one') {
    return (
      <PhoneScreen title="Edit recurring meeting" parent={back}>
        <div className="flex flex-col gap-[12px]">
          <p className="text-body text-text-secondary">This meeting repeats. What do you want to change?</p>
          <button
            type="button"
            onClick={() => setScope('one')}
            className="flex min-h-[64px] items-start gap-[12px] rounded-[12px] border border-border-strong bg-surface p-[16px] text-left active:bg-surface-control"
          >
            <CalendarClock aria-hidden className="mt-[2px] size-[20px] shrink-0 text-text-secondary" />
            <span className="flex flex-col gap-[2px]">
              <span className="text-body font-medium text-text-primary">This meeting only</span>
              <span className="text-label text-text-secondary">Change just this one. The rest of the series stays the same.</span>
            </span>
          </button>
          <button
            type="button"
            disabled={loadingSeries}
            onClick={() => void chooseSeries()}
            className="flex min-h-[64px] items-start gap-[12px] rounded-[12px] border border-border-strong bg-surface p-[16px] text-left active:bg-surface-control disabled:opacity-60"
          >
            <Repeat aria-hidden className="mt-[2px] size-[20px] shrink-0 text-text-secondary" />
            <span className="flex flex-col gap-[2px]">
              <span className="text-body font-medium text-text-primary">The whole series</span>
              <span className="text-label text-text-secondary">Change the repeat pattern or details for every future meeting.</span>
            </span>
          </button>
        </div>
        {scope === 'series' && rhythm ? (
          <MeetingSeriesEditSheet
            rhythm={rhythm}
            open
            onOpenChange={(o) => {
              if (!o) setScope(null)
            }}
            onSaved={() => router.replace(meetingHref(meeting.id))}
          />
        ) : null}
      </PhoneScreen>
    )
  }

  async function onSave() {
    if (!meeting) return
    const next = validateMeetingForm(form, { needsWhen: true })
    setErrors(next)
    if (Object.keys(next).length > 0) {
      focusFirstInvalid(formRef.current)
      return
    }
    setSaving(true)
    try {
      // The same body desktop sends (EditMeetingModal ~120-135).
      await meetingsApi.update(orgId, meeting.id, {
        title: form.title.trim(),
        type: form.type,
        location: form.type !== 'online' ? form.location.trim() : undefined,
        online_link: form.type !== 'offline' ? form.onlineLink.trim() : undefined,
        online_password: form.type !== 'offline' ? form.onlinePassword.trim() : undefined,
        scheduled_start: toIso(form.date, form.startTime),
        scheduled_end: toIso(form.date, form.endTime),
        attendee_user_ids: form.attendeeIds,
        optional_user_ids: form.optionalIds,
      })
      addToast('Meeting saved', 'success')
      router.replace(meetingHref(meeting.id))
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not save the meeting. Check your connection and try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneScreen title={route.title} parent={back}>
      <form ref={formRef} noValidate onKeyDown={enterMovesNext} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-[20px] pb-[96px]">
        {meeting.rhythm_id ? (
          <p className="flex items-start gap-[8px] rounded-[8px] border border-primary-border bg-primary-subtle px-[12px] py-[8px] text-label text-primary-text">
            <CalendarClock aria-hidden className="mt-[2px] size-[16px] shrink-0" />
            <span>
              You are changing <b>this meeting only</b>. The rest of the series stays the same.
            </span>
          </p>
        ) : null}
        <MeetingFormFields values={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors} people={people} />
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
    </PhoneScreen>
  )
}
