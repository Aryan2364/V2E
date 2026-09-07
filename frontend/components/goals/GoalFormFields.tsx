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

export const inputClass =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
export const labelClass = 'block text-sm font-medium text-[#374151] mb-1'

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
}: {
  state: GoalFormState
  onChange: (patch: Partial<GoalFormState>) => void
  employees: EmployeeOption[]
  /** Status is set by hand only when editing — a new goal starts Not started. */
  showStatus?: boolean
  disabled?: boolean
  /** "First check-in" when creating; "Next check-in" when editing. */
  firstCheckInLabel?: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Goal *</label>
        <input
          className={inputClass}
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Reach ₹50 Cr revenue"
          disabled={disabled}
          maxLength={300}
        />
      </div>

      <div>
        <label className={labelClass}>Description</label>
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
        <label className={labelClass}>Focus area</label>
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
        <p className="text-[11px] text-[#475569] mt-1">
          Which part of the business this goal moves. One only — it’s what lets you see whether the
          company is starving one area.
        </p>
      </div>

      {/* Who owns it and when it's due — the two facts that make a goal real. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div>
          <label className={labelClass}>Owner *</label>
          <EmployeePicker
            employees={employees}
            value={state.ownerUserId}
            onChange={(id) => onChange({ ownerUserId: id })}
            placeholder="Who is accountable for this?"
            disabled={disabled}
          />
          <p className="text-[11px] text-[#475569] mt-1">
            One accountable person — who gets asked for the check-in. It doesn’t change who can see
            or edit the goal.
          </p>
        </div>
        <div>
          <label className={labelClass}>Deadline *</label>
          <DatePicker
            value={state.dueDate}
            onChange={(iso) => onChange({ dueDate: iso })}
            placeholder="Select a date"
            disabled={disabled}
          />
        </div>
      </div>

      {/* The rhythm and its first date belong together — a rhythm without a
          concrete date is meaningless, so they're asked side by side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <div>
          <label className={labelClass}>Check-in rhythm</label>
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
          <p className="text-[11px] text-[#475569] mt-1">
            {state.cadence === 'none'
              ? 'No rhythm — the owner is nudged only after a month of silence.'
              : 'The owner is reminded each time a check-in comes due.'}
          </p>
        </div>
        {state.cadence !== 'none' && (
          <div>
            <label className={labelClass}>{firstCheckInLabel} *</label>
            <DatePicker
              value={state.checkInDate}
              onChange={(iso) => onChange({ checkInDate: iso })}
              min={todayISO()}
              placeholder="Select a date"
              disabled={disabled}
            />
            <p className="text-[11px] text-[#475569] mt-1">
              After that, the next one falls{' '}
              {CADENCE_META[state.cadence].label.toLowerCase()} from each check-in.
            </p>
          </div>
        )}
      </div>

      {/* Optional target number. A goal with no number is normal — its check-in
          is just the traffic light and the note. */}
      <div className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
        <p className="text-sm font-medium text-[#374151]">Target number (optional)</p>
        <p className="text-[11px] text-[#475569] mt-0.5 mb-3">
          Leave blank if this goal isn’t measured by a number. Values are always typed in by a
          person at each check-in — nothing is pulled from anywhere.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Target</label>
            <input
              className={inputClass}
              value={state.targetValue}
              onChange={(e) => onChange({ targetValue: e.target.value })}
              placeholder="e.g. 50"
              inputMode="decimal"
              disabled={disabled}
            />
          </div>
          <div>
            <label className={labelClass}>Unit</label>
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
          <label className={labelClass}>Status</label>
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
          <p className="text-[11px] text-[#475569] mt-1">
            On track / At risk / Off track are set by check-ins, not here.
          </p>
        </div>
      )}
    </div>
  )
}
