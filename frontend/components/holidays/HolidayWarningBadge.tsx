'use client'

import { AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react'
import type { HolidayCheckResult } from '@/lib/types/holidays'

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
        <div className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[#DBEAFE] border border-[#BFDBFE]">
          <CheckCircle2 size={14} className="text-[#2563EB] shrink-0 mt-0.5" />
          <p className="text-xs text-[#2563EB] font-medium">
            {reason ? `${reason} — ` : ''}Keeping your chosen date. The system’s suggestion has been overridden.
          </p>
        </div>
        <OverrideToggle overridden={overridden} onToggleOverride={onToggleOverride} />
      </div>
    )
  }

  if (action === 'create_anyway') {
    return (
      <div className="flex items-start gap-2 mt-1.5 px-3 py-2 rounded-[8px] bg-[#FEF9C3] border border-[#FDE68A]">
        <Info size={14} className="text-[#CA8A04] shrink-0 mt-0.5" />
        <p className="text-xs text-[#CA8A04] font-medium">
          {reason ? `${reason} — ` : ''}This is a non-working day, but the task will still be created.
        </p>
      </div>
    )
  }

  if (action === 'skip_create') {
    return (
      <div className="mt-1.5">
        <div className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[#FEE2E2] border border-[#FECACA]">
          <XCircle size={14} className="text-[#DC2626] shrink-0 mt-0.5" />
          <p className="text-xs text-[#DC2626] font-medium">
            {reason ? `${reason} — ` : ''}Your organization normally blocks tasks on this date. Change the deadline, or keep it anyway below.
          </p>
        </div>
        <OverrideToggle overridden={overridden} onToggleOverride={onToggleOverride} />
      </div>
    )
  }

  const label = action === 'move_to_next_working_day' ? 'moved forward' : 'moved back'
  const formattedDate = adjusted_date
    ? new Date(adjusted_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="mt-1.5">
      <div className="flex items-start gap-2 px-3 py-2 rounded-[8px] bg-[#FEF9C3] border border-[#FDE68A]">
        <AlertTriangle size={14} className="text-[#D97706] shrink-0 mt-0.5" />
        <p className="text-xs text-[#D97706] font-medium">
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
        className="h-3.5 w-3.5 rounded-xs border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
      />
      <span className="text-xs text-[#475569]">Keep my chosen date (override the suggestion)</span>
    </label>
  )
}
