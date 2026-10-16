'use client'

import { AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react'
import type { HolidayCheckResult } from '@/lib/types/holidays'
import { formatDate } from '@/lib/format'

interface Props {
  check: HolidayCheckResult | null
  /**
   * When the deadline lands on a non-working day the system SUGGESTS an
   * adjustment (move forward/back) or blocks it (skip_create). The user may
   * override and keep their chosen date. `overridden` reflects that choice;
   * `onToggleOverride` (when provided) renders the inline override control.
   */
  overridden?: boolean
  onToggleOverride?: (next: boolean) => void
}

export default function HolidayWarningBadge({ check, overridden = false, onToggleOverride }: Props) {
  if (!check || check.is_working_day) return null

  const { action, reason, adjusted_date } = check

  // `create_anyway` already keeps the chosen date — nothing to override.
  const canOverride = action === 'skip_create'
    || action === 'move_to_next_working_day'
    || action === 'move_to_prev_working_day'

  // When the user has chosen to keep their date, show a calm confirming state.
  if (overridden && canOverride) {
    return (
      <div className="mt-1.5">
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary-subtle border border-primary-border">
          <CheckCircle2 size={14} className="text-primary-text shrink-0 mt-0.5" />
          <p className="text-xs text-primary-text font-medium">
            {reason ? `${reason} — ` : ''}Keeping your chosen date. The system’s suggestion has been overridden.
          </p>
        </div>
        <OverrideToggle overridden={overridden} onToggleOverride={onToggleOverride} />
      </div>
    )
  }

  if (action === 'create_anyway') {
    return (
      <div className="flex items-start gap-2 mt-1.5 px-3 py-2 rounded-lg bg-warning-bg border border-warning-border">
        <Info size={14} className="text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-warning font-medium">
          {reason ? `${reason} — ` : ''}This is a non-working day, but the task will still be created.
        </p>
      </div>
    )
  }

  if (action === 'skip_create') {
    return (
      <div className="mt-1.5">
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-danger-border">
          <XCircle size={14} className="text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger font-medium">
            {reason ? `${reason} — ` : ''}Your organization normally blocks tasks on this date. Change the deadline, or keep it anyway below.
          </p>
        </div>
        <OverrideToggle overridden={overridden} onToggleOverride={onToggleOverride} />
      </div>
    )
  }

  const label = action === 'move_to_next_working_day' ? 'moved forward' : 'moved back'
  const formattedDate = adjusted_date
    ? formatDate(new Date(adjusted_date))
    : null

  return (
    <div className="mt-1.5">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-bg border border-warning-border">
        <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-warning font-medium">
          {reason ? `${reason} — ` : ''}Suggested: deadline {label}
          {formattedDate ? ` to ${formattedDate}` : ''}.
        </p>
      </div>
      <OverrideToggle overridden={overridden} onToggleOverride={onToggleOverride} />
    </div>
  )
}

function OverrideToggle({
  overridden,
  onToggleOverride,
}: {
  overridden: boolean
  onToggleOverride?: (next: boolean) => void
}) {
  if (!onToggleOverride) return null
  return (
    <label className="flex items-center gap-2 mt-1.5 px-1 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={overridden}
        onChange={(e) => onToggleOverride(e.target.checked)}
        className="h-3.5 w-3.5 rounded-xs border-border text-primary-text focus:ring-primary cursor-pointer"
      />
      <span className="text-xs text-text-secondary">Keep my chosen date (override the suggestion)</span>
    </label>
  )
}
