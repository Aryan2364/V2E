'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import type { Goal } from '@/lib/types/goals'
import GoalFormFields, {
  type EmployeeOption,
  type GoalFormState,
} from './GoalFormFields'
import { toDateInput } from './shared'

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

  const patch = (p: Partial<GoalFormState>) => setForm((f) => (f ? { ...f, ...p } : f))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.title.trim()) return addToast('Give the goal a title', 'error')
    if (!form.ownerUserId) return addToast('Every goal needs one accountable owner', 'error')
    if (!form.dueDate) return addToast('Set a deadline', 'error')
    if (form.cadence !== 'none' && !form.checkInDate) {
      return addToast('Pick when the next check-in is due', 'error')
    }

    const target = form.targetValue.trim()
    if (target && isNaN(parseFloat(target.replace(/,/g, '')))) {
      return addToast('The target must be a number', 'error')
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
      addToast('Goal updated', 'success')
      onSaved(updated)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not save the goal', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!form) return null

  const clearingTarget = goal.target_value !== null && !form.targetValue.trim()

  return (
    <Modal isOpen={isOpen} onClose={() => !saving && onClose()} title="Edit goal" size="lg">
      <form onSubmit={handleSubmit}>
        <GoalFormFields
          state={form}
          onChange={patch}
          employees={employees}
          showStatus
          firstCheckInLabel="Next check-in due"
          disabled={saving}
        />

        {clearingTarget && (
          <p className="mt-4 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#92400E]">
            Removing the target also clears this goal’s recorded number. The check-in history stays
            exactly as it is.
          </p>
        )}

        <div className="flex items-center justify-between pt-5 mt-5 border-t border-[#E2E8F0]">
          {/* Destructive action on the left, opposite the primary — DESIGN_RULES Part 4. */}
          {canDelete && onRequestDelete ? (
            <button
              type="button"
              onClick={onRequestDelete}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#DC2626] hover:text-[#B91C1C] disabled:text-[#94A3B8] transition-colors"
            >
              <Trash2 size={15} /> Delete goal
            </button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
