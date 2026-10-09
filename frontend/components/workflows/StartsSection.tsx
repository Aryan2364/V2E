'use client'

import React from 'react'
import { CalendarClock, Check, Hand } from 'lucide-react'
import ScheduleEntryList from '@/components/tasks/ScheduleEntryList'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { getNow } from '@/lib/clock'
import type { PersonRef, WorkflowSchedule } from '@/lib/types/workflows'
import type { WorkflowLookups } from './useWorkflowLookups'
import { ErrorBanner, InfoTip, Reveal, describeSchedule, fmtDateTime } from './shared'
import PeoplePicker, { personNames } from './PeoplePicker'

/** A schedule entry being edited: the recurring-task draft, plus its id once saved. */
export type ScheduleDraft = ScheduleEntryDraft & { id?: string }

export interface StartsValue {
  manual: boolean
  starterIds: string[]
  scheduleOn: boolean
  schedules: ScheduleDraft[]
}

/** The recurring-task form's default entry (daily at 09:00 from today). */
export function defaultScheduleEntry(): ScheduleDraft {
  return {
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: getNow().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

/** A saved schedule → the form's draft. */
export function scheduleToDraft(s: WorkflowSchedule): ScheduleDraft {
  return {
    id: s.id,
    schedule_type: s.schedule_type,
    every: s.every || 1,
    days: s.days ?? [],
    month_days: s.month_days ?? [],
    yearly_dates: s.yearly_dates ?? [],
    time: s.time || '09:00',
    start_date: s.start_date,
    end_condition: s.end_condition,
    end_date: s.end_date ?? '',
    end_after: s.end_after ?? 10,
  }
}

/** One "Manually" / "On a schedule" choice: a tick box as a card, its ⓘ beside the box (never inside it). */
function StartChoice({
  checked,
  onChange,
  disabled,
  icon: Icon,
  label,
  tip,
  invalid,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  icon: typeof Hand
  label: string
  tip: string
  invalid?: boolean
}) {
  return (
    <div
      className={`w-full flex items-center rounded-[10px] border transition-colors ${
        invalid ? 'border-[#FCA5A5]' : checked ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#CBD5E1] bg-white hover:bg-[#F8FAFC]'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex-1 min-w-0 text-left flex items-center gap-3 rounded-[10px] pl-3.5 pr-1 py-3 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-not-allowed"
      >
        <span
          aria-hidden
          className={`w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center shrink-0 transition-colors ${
            checked ? 'bg-[#2563EB] border-[#2563EB]' : 'bg-white border-[#64748B]'
          }`}
        >
          {checked && <Check size={12} strokeWidth={3} className="text-white" />}
        </span>
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${checked ? 'text-[#1D4ED8]' : 'text-[#0F172A]'}`}>
          <Icon size={15} aria-hidden /> {label}
        </span>
      </button>
      <InfoTip label={label} text={tip} className="mr-3" />
    </div>
  )
}

/**
 * "How it starts": by hand (only by the people picked here) and/or on a schedule in the
 * recurring-task format. Part of the workflow being edited — nothing saves on its own.
 */
export default function StartsSection({
  orgId,
  currentUser,
  value,
  onChange,
  editable,
  reason,
  lookups,
  knownStarters,
  savedSchedules,
  live,
  error,
  errorScheduleIndex,
}: {
  orgId: string
  /** Offered as the picker's "Add me" shortcut. */
  currentUser?: { user_id: string; name: string }
  value: StartsValue
  onChange: (next: StartsValue) => void
  editable: boolean | undefined
  reason: string
  lookups: WorkflowLookups
  /** Starters already on the workflow (named even if they have left). */
  knownStarters: PersonRef[]
  /** The saved schedules (for their next run). */
  savedSchedules: WorkflowSchedule[]
  /** Live and not paused: schedules are firing. */
  live: boolean
  /** Why the last save was refused, when it was about how it starts. */
  error: string | null
  errorScheduleIndex: number | null
}) {
  const disabled = editable !== true
  const set = (patch: Partial<StartsValue>) => onChange({ ...value, ...patch })

  const names = personNames(lookups, knownStarters)
  const startersMissing = !!error && value.manual && value.starterIds.length === 0

  const savedById = new Map(savedSchedules.map((s) => [s.id, s]))
  const nextRuns = value.scheduleOn
    ? value.schedules
        .map((d) => (d.id ? savedById.get(d.id) : undefined))
        .filter((s): s is WorkflowSchedule => !!s && !!s.next_fire_at)
    : []

  const body = (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <div className="flex flex-col gap-3 min-w-0">
          <StartChoice
            checked={value.manual}
            onChange={(v) => set({ manual: v })}
            disabled={disabled}
            icon={Hand}
            label="Manually"
            tip="Started with the Run button."
            invalid={startersMissing}
          />
          <Reveal open={value.manual}>
            <div className="pl-1">
              <span className="block text-sm font-medium text-[#374151] mb-2">
                Who can start it <span className="text-[#DC2626]">*</span>{' '}
                <InfoTip label="Who can start it" text="Only the people listed here can run it by hand." />
              </span>
              <PeoplePicker
                orgId={orgId}
                ids={value.starterIds}
                onChange={(ids) => set({ starterIds: ids })}
                names={names}
                loading={lookups.status === 'loading'}
                title="Who can start it"
                disabled={disabled}
                invalid={startersMissing}
                currentUser={currentUser}
              />
            </div>
          </Reveal>
        </div>
        <StartChoice
          checked={value.scheduleOn}
          onChange={(v) =>
            set({ scheduleOn: v, schedules: v && value.schedules.length === 0 ? [defaultScheduleEntry()] : value.schedules })
          }
          disabled={disabled}
          icon={CalendarClock}
          label="On a schedule"
          tip="Starts by itself, like a recurring task."
        />
      </div>

      <Reveal open={value.scheduleOn}>
        <div className="flex flex-col gap-3">
          <fieldset disabled={disabled} className="min-w-0 border-0 p-0 m-0">
            <ScheduleEntryList entries={value.schedules} onChange={(entries) => set({ schedules: entries as ScheduleDraft[] })} />
          </fieldset>
          {errorScheduleIndex !== null && value.schedules[errorScheduleIndex] && (
            <p className="text-[13px] text-[#B91C1C]">Check schedule #{errorScheduleIndex + 1}.</p>
          )}
          <div className="rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-2.5 text-[13px] text-[#334155] flex flex-col gap-1">
            {value.schedules.map((d, i) => (
              <span key={d.id ?? `new-${i}`}>
                <span className="font-medium text-[#0F172A]">#{i + 1}</span> {describeSchedule(d)}
              </span>
            ))}
            {(live ? nextRuns.length > 0 : true) && (
              <span className="text-[#475569]">
                {live ? `Next start: ${fmtDateTime(nextRuns.map((s) => s.next_fire_at!).sort()[0])}` : 'Runs only while the workflow is live.'}
              </span>
            )}
          </div>
        </div>
      </Reveal>
    </div>
  )

  return (
    <section
      id="starts-section"
      aria-labelledby="starts-heading"
      className={`bg-white border rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-4 scroll-mt-40 ${
        error ? 'border-[#FCA5A5] ring-1 ring-[#FECACA]' : 'border-[#E2E8F0]'
      }`}
    >
      <div>
        <h2 id="starts-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
          How it starts <InfoTip label="How it starts" text="Choose one or both. Times use your organisation’s time zone." />
        </h2>
      </div>
      {editable === false && reason && (
        <p className="text-[13px] text-[#334155] rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">{reason}</p>
      )}
      {body}
    </section>
  )
}
