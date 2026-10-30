'use client'

import React from 'react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi, type RhythmScheduleInput } from '@/lib/api/meetings'
import type { MeetingRhythm } from '@/lib/types/meetings'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { defaultScheduleEntry, scheduleEntryError } from '@/lib/tasks/recurring-payload'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, PhoneField, GrowTextarea, PHONE_INPUT, cx, focusFirstInvalid } from './primitives'
import { RepeatFields } from './RepeatFields'
import { EMPTY_MEETING_FORM, MeetingFormFields, useInvitees, validateMeetingForm, type MeetingFormValues } from './MeetingFormFields'

/*
 * Edit a whole recurring meeting (the series) - desktop's CreateRhythmModal in
 * edit mode (components/meetings/CreateRhythmModal.tsx ~100-250), PATCH
 * meetings/rhythms/:id. Same fields as the create form's "Repeats" option.
 * Used from Edit meeting ("The whole series") and from the series screen.
 * Mount it only while open so it reads the series fresh each time.
 */

const LENGTHS = [15, 30, 45, 60, 90, 120]

function hydrateSched(r: MeetingRhythm): ScheduleEntryDraft {
  const e = r.schedule_entries?.[0]
  if (!e) return { ...defaultScheduleEntry(), schedule_type: 'weekly', time: '10:00' }
  return {
    schedule_type: e.schedule_type,
    every: e.every ?? 1,
    days: e.days ?? [],
    month_days: e.month_days ?? [],
    yearly_dates: e.yearly_dates ?? [],
    time: e.time ?? '10:00',
    start_date: e.start_date ? e.start_date.slice(0, 10) : defaultScheduleEntry().start_date,
    end_condition: e.end_condition,
    end_date: e.end_date ? e.end_date.slice(0, 10) : '',
    end_after: e.end_after ?? 10,
  }
}

export function MeetingSeriesEditSheet({
  rhythm,
  open,
  onOpenChange,
  onSaved,
}: {
  rhythm: MeetingRhythm
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (r: MeetingRhythm) => void
}) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const people = useInvitees(orgId, rhythm.created_by_user_id)

  const [form, setForm] = React.useState<MeetingFormValues>(() => ({
    ...EMPTY_MEETING_FORM,
    title: rhythm.title,
    type: rhythm.type,
    onlineLink: rhythm.online_link ?? '',
    onlinePassword: rhythm.online_password ?? '',
    location: rhythm.location ?? '',
    attendeeIds: rhythm.attendee_user_ids ?? [],
    optionalIds: rhythm.optional_user_ids ?? [],
  }))
  const [sched, setSched] = React.useState<ScheduleEntryDraft>(() => hydrateSched(rhythm))
  const [durationMin, setDurationMin] = React.useState(rhythm.duration_min ?? 30)
  const [skipHolidays, setSkipHolidays] = React.useState(() => (rhythm.schedule_entries?.[0] as { skip_holidays?: boolean } | undefined)?.skip_holidays ?? true)
  const [agenda, setAgenda] = React.useState(rhythm.agenda ?? '')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [showSchedErrors, setShowSchedErrors] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)

  async function save() {
    const next = validateMeetingForm(form, { needsWhen: false })
    setErrors(next)
    setShowSchedErrors(true)
    if (Object.keys(next).length > 0 || scheduleEntryError(sched)) {
      focusFirstInvalid(bodyRef.current)
      return
    }
    const schedule: RhythmScheduleInput = {
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
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await meetingsApi.updateRhythm(orgId, rhythm.id, {
        title: form.title.trim(),
        type: form.type,
        duration_min: durationMin,
        attendee_user_ids: form.attendeeIds,
        optional_user_ids: form.optionalIds,
        online_link: form.type !== 'offline' ? form.onlineLink.trim() : undefined,
        online_password: form.type !== 'offline' ? form.onlinePassword.trim() : undefined,
        location: form.type !== 'online' ? form.location.trim() : undefined,
        agenda: agenda.trim() || undefined,
        schedule,
      })
      addToast('Recurring meeting saved', 'success')
      onSaved(updated)
      onOpenChange(false)
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save the recurring meeting. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o)
      }}
      title="Edit whole series"
      fullHeight
      footer={
        <>
          <PhoneButton disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </PhoneButton>
          <PhoneButton variant="primary" loading={saving} onClick={() => void save()}>
            Save series
          </PhoneButton>
        </>
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-[20px] pb-[16px]">
        <p className="text-body text-text-secondary">Changes apply to every future meeting in this series. Meetings already held are not changed.</p>
        <MeetingFormFields
          values={form}
          onChange={(p) => setForm((f) => ({ ...f, ...p }))}
          errors={errors}
          people={people}
          whenSlot={
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
          }
        />
        <PhoneField label="Standing agenda" htmlFor="series-agenda">
          <GrowTextarea id="series-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} className={cx(PHONE_INPUT, 'py-[10px]')} />
        </PhoneField>
        {error ? (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </PhoneSheet>
  )
}
