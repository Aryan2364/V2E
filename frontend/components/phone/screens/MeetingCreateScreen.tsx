'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi, type RhythmScheduleInput } from '@/lib/api/meetings'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { defaultScheduleEntry, scheduleEntryError } from '@/lib/tasks/recurring-payload'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { MEETINGS_HREF, meetingHref, meetingRhythmHref, type PhoneRoute } from '@/lib/phone-routes'
import { useDraft } from '@/lib/drafts'
import { DraftBanner } from '../DraftBanner'
import PhoneScreen from '../PhoneScreen'
import { PhoneButton, PhoneField, GrowTextarea, PHONE_INPUT, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import { RepeatFields } from '../RepeatFields'
import {
  EMPTY_MEETING_FORM,
  MeetingFormFields,
  toIso,
  useInvitees,
  validateMeetingForm,
  type MeetingFormValues,
} from '../MeetingFormFields'

/*
 * Create meeting - plan-phone-2026-10-14.md section 5.9, grounded in
 * CreateMeetingDto. One column, Save fixed at the bottom (41.7 rule 3).
 * The fields are shared with Edit meeting (MeetingFormFields). A meeting can
 * repeat: that creates a recurring meeting (POST meetings/rhythms) exactly as
 * desktop's CreateMeetingModal does (~173-235), with the same schedule fields
 * recurring tasks use. Not on phone yet: linking to a goal, task or ticket,
 * logging a past meeting, and Find a time.
 *
 * Draft: lib/drafts.ts (kit 41.7 rules 12-15), form id "meeting-create",
 * record "new". Offered back with a banner, never restored silently;
 * cleared on a successful save and on sign-out (lib/auth's logout calls
 * clearDrafts).
 */

type MeetingCreateDraft = Omit<MeetingFormValues, 'attendeeIds' | 'optionalIds'> & { agenda: string }

const LENGTHS = [15, 30, 45, 60, 90, 120]

export default function MeetingCreateScreen({ route }: { route: PhoneRoute }) {
  const router = useRouter()
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [form, setForm] = React.useState<MeetingFormValues>(EMPTY_MEETING_FORM)
  const [agendaOpen, setAgendaOpen] = React.useState(false)
  const [agenda, setAgenda] = React.useState('')
  const [repeats, setRepeats] = React.useState(false)
  const [sched, setSched] = React.useState<ScheduleEntryDraft>(() => ({ ...defaultScheduleEntry(), schedule_type: 'weekly', time: '10:00' }))
  const [durationMin, setDurationMin] = React.useState(30)
  const [skipHolidays, setSkipHolidays] = React.useState(true)
  const [showSchedErrors, setShowSchedErrors] = React.useState(false)

  const people = useInvitees(orgId, user?.id)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const formRef = React.useRef<HTMLFormElement>(null)

  const patch = (p: Partial<MeetingFormValues>) => setForm((f) => ({ ...f, ...p }))

  const draftValues: MeetingCreateDraft = {
    title: form.title,
    type: form.type,
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    onlineLink: form.onlineLink,
    onlinePassword: form.onlinePassword,
    location: form.location,
    agenda,
  }
  const draft = useDraft<MeetingCreateDraft>({
    person: user?.id,
    form: 'meeting-create',
    record: 'new',
    values: draftValues,
  })

  function restoreDraft(kept: Partial<MeetingCreateDraft>) {
    const { agenda: keptAgenda, ...rest } = kept
    setForm((f) => ({ ...f, ...rest }))
    if (keptAgenda !== undefined) {
      setAgenda(keptAgenda)
      if (keptAgenda) setAgendaOpen(true)
    }
  }

  function validate(): boolean {
    const next = validateMeetingForm(form, { needsWhen: !repeats })
    const schedError = repeats ? scheduleEntryError(sched) : null
    setShowSchedErrors(repeats)
    setErrors(next)
    const ok = Object.keys(next).length === 0 && !schedError
    if (!ok) focusFirstInvalid(formRef.current)
    return ok
  }

  async function onSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const link = form.type !== 'offline' ? form.onlineLink.trim() || undefined : undefined
      const password = form.type !== 'offline' ? form.onlinePassword.trim() || undefined : undefined
      const location = form.type !== 'online' ? form.location.trim() || undefined : undefined
      if (repeats) {
        // Desktop CreateMeetingModal ~173-235: a repeating meeting is a rhythm.
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
        const rhythm = await meetingsApi.createRhythm(orgId, {
          title: form.title.trim(),
          type: form.type,
          online_link: link,
          online_password: password,
          location,
          agenda: agenda.trim() || undefined,
          duration_min: durationMin,
          attendee_user_ids: form.attendeeIds,
          optional_user_ids: form.optionalIds,
          schedule,
        })
        draft.clear()
        addToast('Recurring meeting added. Its meetings will appear in your list.', 'success')
        router.replace(meetingRhythmHref(rhythm.id))
        return
      }
      const meeting = await meetingsApi.create(orgId, {
        title: form.title.trim(),
        type: form.type,
        online_link: link,
        online_password: password,
        location,
        scheduled_start: toIso(form.date, form.startTime),
        scheduled_end: toIso(form.date, form.endTime),
        attendee_user_ids: form.attendeeIds,
        optional_user_ids: form.optionalIds,
        agenda: agenda.trim() || undefined,
      })
      draft.clear()
      addToast('Meeting created', 'success')
      router.replace(meetingHref(meeting.id))
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not create the meeting. Check your connection and try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const repeatSlot = (
    <div className="flex flex-col gap-[16px]">
      <RepeatFields entry={sched} onChange={setSched} showErrors={showSchedErrors} />
      <PhoneField label="How long">
        <div role="group" aria-label="How long" className="flex flex-wrap gap-[8px]">
          {LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={durationMin === m}
              onClick={() => setDurationMin(m)}
              className={cx(
                'min-h-(--h-control) min-w-[64px] flex-1 rounded-[8px] border-2 px-[8px] text-body font-medium',
                durationMin === m ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-text-secondary',
              )}
            >
              {m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`}
            </button>
          ))}
        </div>
      </PhoneField>
      <label className="flex min-h-[48px] items-start gap-[12px] py-[8px] text-body text-text-primary">
        <input
          type="checkbox"
          checked={skipHolidays}
          onChange={(e) => setSkipHolidays(e.target.checked)}
          className="mt-[2px] size-[20px] shrink-0 accent-primary"
        />
        <span>Skip company holidays</span>
      </label>
    </div>
  )

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? MEETINGS_HREF}>
      <form ref={formRef} noValidate onKeyDown={enterMovesNext} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-[20px] pb-[96px]">
        <DraftBanner draft={draft} onUse={restoreDraft} />

        <PhoneField label="Repeats">
          <div role="group" aria-label="Repeats" className="flex gap-[8px]">
            {([false, true] as const).map((r) => (
              <button
                key={String(r)}
                type="button"
                aria-pressed={repeats === r}
                onClick={() => setRepeats(r)}
                className={cx(
                  'flex-1 min-h-(--h-control) rounded-[8px] border-2 text-body font-medium',
                  repeats === r ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border bg-surface text-text-secondary',
                )}
              >
                {r ? 'Repeats' : 'Happens once'}
              </button>
            ))}
          </div>
        </PhoneField>

        <MeetingFormFields values={form} onChange={patch} errors={errors} people={people} whenSlot={repeats ? repeatSlot : undefined} />

        {agendaOpen ? (
          <PhoneField label={repeats ? 'Standing agenda' : 'Agenda'} htmlFor="meeting-agenda">
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
            <span className="text-body text-text-primary">{repeats ? 'Add standing agenda' : 'Add agenda'}</span>
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
          {repeats ? 'Save recurring meeting' : 'Save meeting'}
        </PhoneButton>
      </div>
    </PhoneScreen>
  )
}
