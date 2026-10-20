'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2 } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'

// S M T W T F S — index 0 = Sunday … 6 = Saturday
const DAY_PILLS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  value: number[]
  /** Persist the new working-week selection. Should resolve once saved. */
  onSave: (days: number[]) => Promise<void>
  disabled?: boolean
}

/**
 * A slim, set-once working-week control: seven round day pills that auto-save the
 * moment one is toggled (no separate Save button). A small "Saved" note confirms it.
 */
export default function WorkingWeekStrip({ value, onSave, disabled }: Props) {
  const [days, setDays] = useState<number[]>(value)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Keep local pills in sync if the parent reloads the value.
  useEffect(() => { setDays(value) }, [value])

  // Drop the "Saved" note after a moment.
  useEffect(() => {
    if (status !== 'saved') return
    const t = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [status])

  async function toggle(day: number) {
    if (disabled || status === 'saving') return
    const next = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day].sort((a, b) => a - b)
    setDays(next) // optimistic
    setStatus('saving')
    try {
      await onSave(next)
      setStatus('saved')
    } catch {
      setDays(value) // roll back on failure
      setStatus('idle')
    }
  }

  return (
    <div className="flex items-center gap-4 bg-surface border border-border-light rounded-card px-4 py-3 shadow-card">
      <span className="text-body font-medium text-text-primary shrink-0">Working days</span>
      <div className="flex items-center gap-1.5">
        {DAY_PILLS.map((label, index) => {
          const active = days.includes(index)
          return (
            <Tooltip key={index} label={DAY_NAMES[index]}>
              <button
                type="button"
                onClick={() => toggle(index)}
                disabled={disabled}
                aria-pressed={active}
                className={[
                  'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring h-8 w-8 rounded-full text-meta font-medium border transition-colors duration-150',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface text-text-muted border-border-light hover:border-primary hover:text-primary-text',
                ].join(' ')}
              >
                {label}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Auto-save status */}
      <span className="ml-auto text-meta text-text-muted min-w-[60px]">
        {status === 'saving' && (
          <span className="flex items-center gap-1 text-text-secondary">
            <Loader2 size={12} className="animate-spin" /> Saving…
          </span>
        )}
        {status === 'saved' && (
          <span className="flex items-center gap-1 text-success">
            <Check size={12} /> Saved
          </span>
        )}
      </span>
    </div>
  )
}
