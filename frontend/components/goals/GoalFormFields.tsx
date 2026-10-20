'use client'

import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import {
  CADENCE_META,
  CADENCE_OPTIONS,
  FOCUS_AREA_META,
  FOCUS_AREA_OPTIONS,
  MANUAL_STATUSES,
  STATUS_META,
  type GoalCadence,
  type GoalFocusArea,
  type GoalStatus,
} from '@/lib/types/goals'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'

export const inputClass =
  'w-full border border-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
export const labelClass = 'block text-label font-medium text-text-secondary mb-1'

const todayISO = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface EmployeeOption {
  user_id: string
  name: string
  role_title?: string | null
  /** The person's own department — a goal has none of its own, so its
   *  department is simply its owner's (see the Goals list filter). */
  department_id?: string | null
  department_name?: string | null
}

export interface DeptOption {
  id: string
  name: string
  parent_department_id?: string | null
}

/** Field errors, keyed by the field they belong under (kit 11.3 rule 6). */
export type GoalFormErrors = Partial<Record<'title' | 'ownerUserId' | 'dueDate' | 'checkInDate' | 'targetValue', string>>

/** The id of each validated field, so a failed save can focus the first wrong one (kit 39.3). */
export const GOAL_FIELD_ID: Record<keyof GoalFormErrors, string> = {
  title: 'goal-field-title',
  ownerUserId: 'goal-field-owner',
  dueDate: 'goal-field-due',
  checkInDate: 'goal-field-checkin',
  targetValue: 'goal-field-target',
}

export interface GoalFormState {
  title: string
  description: string
  ownerUserId: string
  focusArea: GoalFocusArea | ''
  dueDate: string
  targetValue: string
  unit: string
  cadence: GoalCadence
  /** When the FIRST (or next) check-in falls due. Empty when cadence is none. */
  checkInDate: string
  status: GoalStatus
}

/** The date one interval from `from` — the sensible default first check-in. */
export function defaultCheckInDate(from: Date, cadence: GoalCadence): string {
  if (cadence === 'none') return ''
  const d = new Date(from)
  if (cadence === 'weekly') d.setDate(d.getDate() + 7)
  else if (cadence === 'biweekly') d.setDate(d.getDate() + 14)
  else if (cadence === 'monthly') d.setMonth(d.getMonth() + 1)
  else if (cadence === 'quarterly') d.setMonth(d.getMonth() + 3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The goal form, shared by Create and Edit so the two can never drift.
 * A goal is only ever: a title, a description, one owner, a deadline, an
 * optional target number with a unit, and a check-in rhythm.
 */
export default function GoalFormFields({
  state,
  onChange,
  employees,
  showStatus = false,
  disabled = false,
  firstCheckInLabel = 'First check-in due',
  errors = {},
}: {
  state: GoalFormState
  onChange: (patch: Partial<GoalFormState>) => void
  employees: EmployeeOption[]
  /** Status is set by hand only when editing — a new goal starts Not started. */
  showStatus?: boolean
  disabled?: boolean
  /** "First check-in" when creating; "Next check-in" when editing. */
  firstCheckInLabel?: string
  errors?: GoalFormErrors
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-2" htmlFor={GOAL_FIELD_ID.title} required>Goal</Label>
        <input
          id={GOAL_FIELD_ID.title}
          className={`${inputClass} aria-invalid:border-danger`}
          aria-invalid={errors.title ? true : undefined}
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="For example, Reach ₹50 Cr revenue"
          disabled={disabled}
          maxLength={300}
        />
        <InlineFieldError>{errors.title}</InlineFieldError>
      </div>

      <div>
        <Label className="mb-2">Description</Label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          disabled={disabled}
          maxLength={5000}
        />
      </div>

      <div>
        <Label className="mb-2">Focus area</Label>
        <StyledSelect
          value={state.focusArea}
          onChange={(v) => onChange({ focusArea: v as GoalFocusArea | '' })}
          placeholder="Not set"
          options={[
            { value: '', label: 'Not set' },
            ...FOCUS_AREA_OPTIONS.map((f) => ({
              value: f,
              label: FOCUS_AREA_META[f].label,
              color: FOCUS_AREA_META[f].dot,
            })),
          ]}
          disabled={disabled}
        />
        <p className="text-meta text-text-secondary mt-1">
          Which part of the business this goal moves. One only — it’s what lets you see whether the
          company is starving one area.
        </p>
      </div>

      {/* Who owns it and when it's due — the two facts that make a goal real. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div>
          <Label className="mb-2" required>Owner</Label>
          <div id={GOAL_FIELD_ID.ownerUserId}>
          <EmployeePicker
            employees={employees}
            value={state.ownerUserId}
            onChange={(id) => onChange({ ownerUserId: id })}
            placeholder="Select owner"
            disabled={disabled}
          />
          </div>
          <InlineFieldError>{errors.ownerUserId}</InlineFieldError>
          <p className="text-meta text-text-secondary mt-1">
            One accountable person — who gets asked for the check-in. It doesn’t change who can see
            or edit the goal.
          </p>
        </div>
        <div>
          <Label className="mb-2" htmlFor={GOAL_FIELD_ID.dueDate} required>Deadline</Label>
          <DatePicker
            id={GOAL_FIELD_ID.dueDate}
            invalid={!!errors.dueDate}
            value={state.dueDate}
            onChange={(iso) => onChange({ dueDate: iso })}
            placeholder="Select a date"
            disabled={disabled}
          />
          <InlineFieldError>{errors.dueDate}</InlineFieldError>
        </div>
      </div>

      {/* The rhythm and its first date belong together — a rhythm without a
          concrete date is meaningless, so they're asked side by side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div>
          <Label className="mb-2">Check-in rhythm</Label>
          <StyledSelect
            value={state.cadence}
            onChange={(v) => {
              const cadence = v as GoalCadence
              // Picking a rhythm proposes a concrete first date rather than
              // silently anchoring to "one interval from whenever this was
              // created" — which nobody could see or choose.
              onChange({
                cadence,
                checkInDate: cadence === 'none' ? '' : defaultCheckInDate(new Date(), cadence),
              })
            }}
            options={CADENCE_OPTIONS.map((c) => ({ value: c, label: CADENCE_META[c].label }))}
            disabled={disabled}
          />
          <p className="text-meta text-text-secondary mt-1">
            {state.cadence === 'none'
              ? 'No rhythm — the owner is nudged only after a month of silence.'
              : 'The owner is reminded each time a check-in comes due.'}
          </p>
        </div>
        {state.cadence !== 'none' && (
          <div>
            <Label className="mb-2" htmlFor={GOAL_FIELD_ID.checkInDate} required>{firstCheckInLabel}</Label>
            <DatePicker
              id={GOAL_FIELD_ID.checkInDate}
              invalid={!!errors.checkInDate}
              value={state.checkInDate}
              onChange={(iso) => onChange({ checkInDate: iso })}
              min={todayISO()}
              placeholder="Select a date"
              disabled={disabled}
            />
            <InlineFieldError>{errors.checkInDate}</InlineFieldError>
            <p className="text-meta text-text-secondary mt-1">
              After that, the next one falls{' '}
              {CADENCE_META[state.cadence].label.toLowerCase()} from each check-in.
            </p>
          </div>
        )}
      </div>

      {/* Optional target number. A goal with no number is normal — its check-in
          is just the traffic light and the note. */}
      <div className="rounded-card border border-border-light bg-surface-sunken p-4">
        <p className="text-label font-medium text-text-secondary">Target number</p>
        <p className="text-meta text-text-secondary mt-0.5 mb-3">
          Leave blank if this goal isn’t measured by a number. Values are always typed in by a
          person at each check-in — nothing is pulled from anywhere.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2" htmlFor={GOAL_FIELD_ID.targetValue}>Target</Label>
            <input
              id={GOAL_FIELD_ID.targetValue}
              className={`${inputClass} aria-invalid:border-danger`}
              aria-invalid={errors.targetValue ? true : undefined}
              value={state.targetValue}
              onChange={(e) => onChange({ targetValue: e.target.value })}
              placeholder="For example, 50"
              inputMode="decimal"
              disabled={disabled}
            />
            <InlineFieldError>{errors.targetValue}</InlineFieldError>
          </div>
          <div>
            <Label className="mb-2">Unit</Label>
            <input
              className={inputClass}
              value={state.unit}
              onChange={(e) => onChange({ unit: e.target.value })}
              placeholder="e.g. Cr, dealers, %"
              disabled={disabled}
              maxLength={30}
            />
          </div>
        </div>
      </div>

      {showStatus && (
        <div className="sm:w-1/2 sm:pr-2">
          <Label className="mb-2">Status</Label>
          <StyledSelect
            value={state.status}
            onChange={(v) => onChange({ status: v as GoalStatus })}
            // A goal sitting on a check-in status (on/at-risk/off track) must
            // still show its current value, so it joins the manual options.
            options={(MANUAL_STATUSES.includes(state.status)
              ? MANUAL_STATUSES
              : [state.status, ...MANUAL_STATUSES]
            ).map((s) => ({
              value: s,
              label: STATUS_META[s].label,
              color: STATUS_META[s].dot,
            }))}
            disabled={disabled}
          />
          <p className="text-meta text-text-secondary mt-1">
            On track / At risk / Off track are set by check-ins, not here. On hold pauses
            check-in reminders without closing the goal.
          </p>
        </div>
      )}
    </div>
  )
}
