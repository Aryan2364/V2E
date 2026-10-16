'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import {
  CHECK_IN_STATUSES,
  STATUS_META,
  formatValue,
  type CheckInStatus,
  type Goal,
} from '@/lib/types/goals'
import { inputClass, labelClass } from './GoalFormFields'

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The check-in. This is the module's heartbeat and the thing that has to be
 * effortless: a date (pre-filled to today), one number, one traffic light, a
 * line of context. Nothing else — it must be completable on a phone in under a
 * minute.
 */
export default function CheckInModal({
  isOpen,
  onClose,
  orgId,
  goal,
  onDone,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  goal: Goal
  onDone: () => void
}) {
  const { addToast } = useToast()
  const [date, setDate] = useState(todayStr())
  const [status, setStatus] = useState<CheckInStatus | ''>('')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const hasTarget = goal.target_value !== null && goal.target_value !== undefined

  useEffect(() => {
    if (!isOpen) return
    setDate(todayStr())
    setStatus('')
    // Pre-fill with the last recorded number so the owner edits the delta
    // rather than retyping the whole figure.
    setValue(goal.current_value === null || goal.current_value === undefined ? '' : String(goal.current_value))
    setNote('')
  }, [isOpen, goal.id, goal.current_value])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) return addToast('Pick the date this check-in is for', 'error')
    if (!status) return addToast('Choose on track, at risk or off track', 'error')

    let recorded: number | null = null
    if (hasTarget && value.trim()) {
      recorded = parseFloat(value.trim().replace(/,/g, ''))
      if (isNaN(recorded)) return addToast('The value must be a number', 'error')
    }

    setSaving(true)
    try {
      await goalsApi.createCheckIn(orgId, goal.id, {
        check_in_date: new Date(`${date}T00:00:00`).toISOString(),
        status,
        recorded_value: recorded,
        status_note: note.trim() || undefined,
      })
      addToast('Check-in recorded', 'success')
      onDone()
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not record the check-in', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={() => !saving && onClose()} title="Check in" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-card bg-surface-sunken border border-border-light px-3 py-2.5">
          <p className="text-body font-medium text-text-primary leading-snug">{goal.title}</p>
          {hasTarget && (
            <p className="text-label text-text-secondary mt-0.5">
              Target {formatValue(goal.target_value, goal.unit)}
              {goal.current_value !== null && goal.current_value !== undefined && (
                <> · last recorded {formatValue(goal.current_value, goal.unit)}</>
              )}
            </p>
          )}
        </div>

        <div>
          <label className={labelClass}>Date *</label>
          <DatePicker value={date} onChange={setDate} max={todayStr()} placeholder="Select date" disabled={saving} />
        </div>

        {hasTarget && (
          <div>
            <label className={labelClass}>Where is the number today?</label>
            <div className="flex items-stretch gap-2">
              <input
                className={inputClass}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 31"
                inputMode="decimal"
                disabled={saving}
              />
              {goal.unit && (
                <span className="flex items-center px-3 rounded-control bg-surface-control border border-border-light text-body text-text-secondary whitespace-nowrap">
                  {goal.unit}
                </span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>Your call *</label>
          <div className="grid grid-cols-3 gap-2">
            {CHECK_IN_STATUSES.map((s) => {
              const m = STATUS_META[s]
              const active = status === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  disabled={saving}
                  aria-pressed={active}
                  className={[
                    'flex flex-col items-center justify-center gap-1.5 rounded-card border-2 py-3 px-2 min-h-[64px]',
                    'text-label font-medium transition-colors',
                    active ? '' : 'border-border-light bg-surface text-text-secondary hover:bg-surface-sunken',
                  ].join(' ')}
                  style={
                    active
                      ? { backgroundColor: m.bg, borderColor: m.dot, color: m.text }
                      : undefined
                  }
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />
                  {m.label}
                </button>
              )
            })}
          </div>
          <p className="text-meta text-text-secondary mt-1.5">
            Your honest read, separate from the number — a goal can be on 60% and safe, or on 90%
            and about to slip.
          </p>
        </div>

        <div>
          <label className={labelClass}>What’s happening &amp; why</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One or two lines: the story behind the number, what’s blocking, the next step…"
            disabled={saving}
            maxLength={2000}
          />
        </div>

        <p className="text-meta text-text-secondary">
          Check-ins can’t be edited or deleted afterwards — the dated history is the whole point. A
          mistake can be voided with a reason.
        </p>

        <div className="flex justify-end pt-4 border-t border-border-light">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
            {saving ? 'Recording…' : 'Record check-in'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
