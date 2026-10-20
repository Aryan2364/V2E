'use client'

import { Info } from 'lucide-react'
import type { HolidayOnTaskAction } from '@/lib/types/holidays'

const ACTIONS: { value: HolidayOnTaskAction; label: string; desc: string }[] = [
  { value: 'move_to_next_working_day', label: 'Move forward', desc: 'Shift deadline to next working day' },
  { value: 'move_to_prev_working_day', label: 'Move backward', desc: 'Shift deadline to previous working day' },
  { value: 'create_anyway', label: 'Create anyway', desc: 'Create task even on holidays' },
  { value: 'skip_create', label: 'Skip', desc: 'Do not create tasks on holidays' },
]

interface Props {
  action: HolidayOnTaskAction
  onActionChange: (a: HolidayOnTaskAction) => void
  disabled?: boolean
}

export default function HolidayConfigCard({ action, onActionChange, disabled }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-body font-medium text-text-primary mb-2">When a deadline falls on a holiday…</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              disabled={disabled}
              onClick={() => onActionChange(a.value)}
              className={[
                'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring rounded-xl border px-3 py-3 text-left transition-colors',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                action === a.value
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border-light bg-surface hover:border-primary/40',
              ].join(' ')}
            >
              <p className={`text-body font-medium ${action === a.value ? 'text-primary-text' : 'text-text-primary'}`}>{a.label}</p>
              <p className="text-meta text-text-secondary mt-0.5">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg bg-surface-sunken border border-border-light p-3">
        <Info size={16} className="text-primary-text mt-0.5 shrink-0" />
        <p className="text-body text-text-secondary">
          Holidays now cascade automatically: <span className="font-medium text-text-primary">org holidays apply to every department and employee</span>,
          departments and individuals add their own on top, and any level can remove the ones it doesn&apos;t observe.
          There is no priority setting to configure.
        </p>
      </div>
    </div>
  )
}
