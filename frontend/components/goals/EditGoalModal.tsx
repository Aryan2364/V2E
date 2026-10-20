'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import type { Goal } from '@/lib/types/goals'
import GoalFormFields, {
  type EmployeeOption,
  GOAL_FIELD_ID,
  type GoalFormErrors,
  type GoalFormState,
} from './GoalFormFields'
import { toDateInput } from './shared'
import { useGuardedClose } from '@/lib/use-guarded-close'

export default function EditGoalModal({
  isOpen,
  onClose,
  orgId,
  goal,
  employees,
  onSaved,
  onRequestDelete,
  canDelete,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  goal: Goal
  employees: EmployeeOption[]
  onSaved: (goal: Goal) => void
  /** Opens the delete confirm — Delete lives in this footer per DESIGN_RULES Part 4. */
  onRequestDelete?: () => void
  canDelete?: boolean
}) {
  const { addToast } = useToast()
  const [form, setForm] = useState<GoalFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<GoalFormErrors>({})
  const guarded = useGuardedClose({
    open: isOpen && !!form,
    values: form,
    noun: 'goal',
    mode: 'edit',
    onClose,
  })

  useEffect(() => {
    if (!isOpen) return
    setForm({
      title: goal.title,
      description: goal.description ?? '',
      ownerUserId: goal.owner_user_id,
      focusArea: goal.focus_area ?? '',
      dueDate: toDateInput(goal.due_date),
      targetValue: goal.target_value === null ? '' : String(goal.target_value),
      unit: goal.unit ?? '',
      cadence: goal.review_cadence,
      checkInDate: toDateInput(goal.next_review_date),
      status: goal.status,
    })
  }, [isOpen, goal])

  const patch = (p: Partial<GoalFormState>) => {
    setForm((f) => (f ? { ...f, ...p } : f))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(p)) delete next[k as keyof GoalFormErrors]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return

    const errs: GoalFormErrors = {}
    if (!form.title.trim()) errs.title = 'Enter a title for the goal.'
    if (!form.ownerUserId) errs.ownerUserId = 'Choose the one person accountable for this goal.'
    if (!form.dueDate) errs.dueDate = 'Choose a deadline for the goal.'
    if (form.cadence !== 'none' && !form.checkInDate) errs.checkInDate = 'Choose when the next check-in is due.'
    const target = form.targetValue.trim()
    if (target && isNaN(parseFloat(target.replace(/,/g, '')))) errs.targetValue = 'Enter the target as a number, like 50.'
    setErrors(errs)
    const firstBad = (Object.keys(GOAL_FIELD_ID) as (keyof GoalFormErrors)[]).find((k) => errs[k])
    if (firstBad) {
      requestAnimationFrame(() => {
        const el = document.getElementById(GOAL_FIELD_ID[firstBad])
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
    }

    setSaving(true)
    try {
      const updated = await goalsApi.update(orgId, goal.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        owner_user_id: form.ownerUserId,
        // null clears it back to unset.
        focus_area: form.focusArea || null,
        due_date: new Date(`${form.dueDate}T00:00:00`).toISOString(),
        // null clears the target (and the recorded number with it).
        target_value: target ? parseFloat(target.replace(/,/g, '')) : null,
        unit: form.unit.trim() || null,
        review_cadence: form.cadence,
        next_review_date:
          form.cadence === 'none' || !form.checkInDate
            ? null
            : new Date(`${form.checkInDate}T00:00:00`).toISOString(),
        status: form.status,
      })
      addToast('Goal saved', 'success')
      onSaved(updated)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not save the goal. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!form) return null

  const clearingTarget = goal.target_value !== null && !form.targetValue.trim()

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={() => !saving && guarded.requestClose()} title="Edit goal" size="lg">
      <form onSubmit={handleSubmit}>
        <GoalFormFields
          state={form}
          onChange={patch}
          employees={employees}
          showStatus
          firstCheckInLabel="Next check-in due"
          disabled={saving}
          errors={errors}
        />

        {clearingTarget && (
          <p className="mt-4 rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-label text-warning">
            Removing the target also clears this goal’s recorded number. The check-in history stays
            exactly as it is.
          </p>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border-light">
          {/* Destructive action on the left, opposite the primary — DESIGN_RULES Part 4. */}
          {canDelete && onRequestDelete ? (
            <button
              type="button"
              onClick={onRequestDelete}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-label font-medium text-danger hover:text-danger disabled:text-text-muted transition-colors"
            >
              <Trash2 size={15} /> Delete goal
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
              {saving ? 'Saving…' : 'Save goal'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
    </>
  )
}
