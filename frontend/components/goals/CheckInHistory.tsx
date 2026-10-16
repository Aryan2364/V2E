'use client'

import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import { formatValue, type Goal, type GoalCheckIn } from '@/lib/types/goals'
import { GoalStatusBadge, formatDate } from './shared'
import { inputClass, labelClass } from './GoalFormFields'

/**
 * The dated record. Rows are never edited or deleted — a wrong entry is VOIDED
 * (kept, struck through, with the reason on show) and superseded by the next
 * check-in, the way a reversal works in accounting. That is what makes this
 * history worth trusting years later.
 */
export default function CheckInHistory({
  orgId,
  goal,
  checkIns,
  canEdit,
  onChanged,
}: {
  orgId: string
  goal: Goal
  checkIns: GoalCheckIn[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [voiding, setVoiding] = useState<GoalCheckIn | null>(null)

  if (checkIns.length === 0) {
    return (
      <p className="text-label text-text-secondary py-2">
        No check-ins yet. The first one starts this goal’s record.
      </p>
    )
  }

  return (
    <>
      <ol className="space-y-3">
        {checkIns.map((c) => (
          <li
            key={c.id}
            className={[
              'rounded-card border px-4 py-3',
              c.is_voided ? 'border-border-light bg-surface-sunken' : 'border-border-light bg-surface',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                <span
                  className={[
                    'text-body font-medium',
                    c.is_voided ? 'text-text-muted line-through' : 'text-text-primary',
                  ].join(' ')}
                >
                  {formatDate(c.check_in_date)}
                </span>
                {c.is_voided ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border-light bg-surface px-2 py-0.5 text-meta font-medium text-text-secondary">
                    <Ban size={11} /> Voided
                  </span>
                ) : (
                  <GoalStatusBadge status={c.status} />
                )}
                {c.recorded_value !== null && c.recorded_value !== undefined && (
                  <span
                    className={[
                      'text-label tabular-nums',
                      c.is_voided ? 'text-text-muted line-through' : 'text-text-primary',
                    ].join(' ')}
                  >
                    {formatValue(c.recorded_value, goal.unit)}
                    {c.target_value_at_check_in !== null &&
                      c.target_value_at_check_in !== undefined && (
                        <span className="text-text-secondary">
                          {' '}
                          of {formatValue(c.target_value_at_check_in, goal.unit)}
                        </span>
                      )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-meta text-text-secondary">{c.created_by?.name ?? '—'}</span>
                {canEdit && !c.is_voided && (
                  <button
                    onClick={() => setVoiding(c)}
                    title="Void this check-in"
                    className="inline-flex items-center gap-1 text-meta font-medium text-text-secondary hover:text-danger transition-colors"
                  >
                    <Ban size={12} /> Void
                  </button>
                )}
              </div>
            </div>

            {c.status_note && (
              <p
                className={[
                  'mt-2 text-label leading-relaxed whitespace-pre-wrap',
                  c.is_voided ? 'text-text-muted' : 'text-text-primary',
                ].join(' ')}
              >
                {c.status_note}
              </p>
            )}

            {c.is_voided && c.void_reason && (
              <p className="mt-2 rounded-control border border-danger-border bg-danger-bg px-2.5 py-1.5 text-meta text-danger">
                <span className="font-medium">Voided:</span> {c.void_reason}
              </p>
            )}
          </li>
        ))}
      </ol>

      {voiding && (
        <VoidModal
          orgId={orgId}
          checkIn={voiding}
          goal={goal}
          onClose={() => setVoiding(null)}
          onDone={onChanged}
        />
      )}
    </>
  )
}

function VoidModal({
  orgId,
  checkIn,
  goal,
  onClose,
  onDone,
}: {
  orgId: string
  checkIn: GoalCheckIn
  goal: Goal
  onClose: () => void
  onDone: () => void
}) {
  const { addToast } = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return addToast('Say briefly why this is being voided', 'error')

    setSaving(true)
    try {
      await goalsApi.voidCheckIn(orgId, checkIn.id, reason.trim())
      addToast('Check-in voided', 'success')
      onDone()
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not void the check-in', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title="Void this check-in" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-card bg-surface-sunken border border-border-light px-3 py-2.5">
          <p className="text-body font-medium text-text-primary">
            {formatDate(checkIn.check_in_date)}
          </p>
          {checkIn.recorded_value !== null && checkIn.recorded_value !== undefined && (
            <p className="text-label text-text-secondary mt-0.5">
              Recorded {formatValue(checkIn.recorded_value, goal.unit)}
            </p>
          )}
        </div>

        <p className="text-label text-text-primary">
          The row stays in the history, struck through, with your reason attached — nothing is
          erased. The goal’s current number falls back to the newest surviving check-in.
        </p>

        <div>
          <label className={labelClass}>Why is it being voided? *</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Typed 31 crore instead of 31 lakh."
            disabled={saving}
            maxLength={500}
            autoFocus
          />
        </div>

        <div className="flex justify-end pt-4 border-t border-border-light">
          <Button type="submit" variant="danger" disabled={saving}>
            {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
            {saving ? 'Voiding…' : 'Void check-in'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
