'use client'

import { Check, Loader2 } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'

const DAY_PILLS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  /** Effective working days on the pills — this entity's override, or the inherited defaults. */
  days: number[]
  /** Whether this entity overrides its parent defaults. */
  override: boolean
  status: 'idle' | 'saving' | 'saved'
  disabled?: boolean
  /** Label for the override switch — e.g. "Override org defaults". */
  overrideLabel?: string
  /** Idle hint shown when not overriding — e.g. "Following org days". */
  followingLabel?: string
  onToggleDay: (dayIndex: number) => void
  onToggleOverride: (next: boolean) => void
}

/**
 * Slim working-days strip with an "override parent defaults" switch. Pills are
 * editable only while overriding; everything auto-saves. Shared by the department
 * and individual calendars so the control feels identical across both.
 */
export default function WorkingDaysStrip({
  days,
  override,
  status,
  disabled,
  overrideLabel = 'Override org defaults',
  followingLabel = 'Following org days',
  onToggleDay,
  onToggleOverride,
}: Props) {
  const pillsDisabled = disabled || !override

  return (
    <div className="flex items-center gap-4 flex-wrap bg-white border border-border-light rounded-[12px] px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <span className="text-sm font-semibold text-text-primary shrink-0">Working Days</span>

      <div className="flex items-center gap-1.5">
        {DAY_PILLS.map((label, index) => {
          const active = days.includes(index)
          return (
            <Tooltip key={index} label={DAY_NAMES[index]}>
              <button
                type="button"
                onClick={() => onToggleDay(index)}
                disabled={pillsDisabled}
                aria-pressed={active}
                className={[
                  'h-8 w-8 rounded-full text-xs font-semibold border transition-colors duration-150',
                  pillsDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
                  active
                    ? pillsDisabled
                      ? 'bg-[#BFDBFE] text-white border-primary-border'
                      : 'bg-primary text-white border-primary'
                    : 'bg-white text-text-muted border-border-light ' + (pillsDisabled ? '' : 'hover:border-primary hover:text-primary-text'),
                ].join(' ')}
              >
                {label}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Override switch */}
      <label className={`flex items-center gap-2 select-none ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={override}
          disabled={disabled}
          onChange={(e) => onToggleOverride(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        <span className="text-sm text-text-secondary">{overrideLabel}</span>
      </label>

      <span className="ml-auto text-xs text-text-muted min-w-[60px]">
        {status === 'saving' && (
          <span className="flex items-center gap-1 text-text-secondary"><Loader2 size={12} className="animate-spin" /> Saving…</span>
        )}
        {status === 'saved' && (
          <span className="flex items-center gap-1 text-success"><Check size={12} /> Saved</span>
        )}
        {status === 'idle' && !override && (
          <span className="text-text-muted">{followingLabel}</span>
        )}
      </span>
    </div>
  )
}
