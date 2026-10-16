'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StyledSelect from '@/components/ui/StyledSelect'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import type { Goal, GoalCandidate } from '@/lib/types/goals'
import CreateGoalModal from './CreateGoalModal'
import { inputClass, labelClass, type EmployeeOption } from './GoalFormFields'
import { formatDate } from './shared'

export type LinkDirection = 'supported_by' | 'supports'

/**
 * Links this goal to another, in either direction. The candidate list comes
 * pre-filtered by the server (the goal itself, duplicates and anything that
 * would close a circle are already gone), so a valid-looking choice never
 * fails on save. A brand-new goal can be created inline and linked in one go.
 */
export default function LinkGoalModal({
  isOpen,
  onClose,
  orgId,
  goal,
  direction,
  employees,
  onLinked,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  goal: Goal
  direction: LinkDirection
  employees: EmployeeOption[]
  onLinked: () => void
}) {
  const { addToast } = useToast()
  const [candidates, setCandidates] = useState<GoalCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const isSupportedBy = direction === 'supported_by'

  useEffect(() => {
    if (!isOpen) return
    setSelected('')
    setNote('')
    setLoading(true)
    goalsApi
      .linkCandidates(orgId, goal.id, direction)
      .then(setCandidates)
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false))
  }, [isOpen, orgId, goal.id, direction])

  async function link(otherGoalId: string, linkNote: string) {
    // The route always names the goal being SUPPORTED, so the two directions
    // differ only in which id goes where.
    if (isSupportedBy) {
      await goalsApi.createLink(orgId, goal.id, { supporting_goal_id: otherGoalId, note: linkNote })
    } else {
      await goalsApi.createLink(orgId, otherGoalId, { supporting_goal_id: goal.id, note: linkNote })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return addToast('Pick a goal to link', 'error')

    setSaving(true)
    try {
      await link(selected, note.trim())
      addToast('Goals linked', 'success')
      onLinked()
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not link the goals', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreated(created: Goal) {
    try {
      await link(created.id, note.trim())
      addToast('Goal created and linked', 'success')
      onLinked()
      onClose()
    } catch (err: any) {
      addToast(
        err?.response?.data?.message ?? 'The goal was created but could not be linked',
        'error',
      )
      onLinked()
    }
  }

  return (
    <>
      <Modal
        isOpen={isOpen && !createOpen}
        onClose={() => !saving && onClose()}
        title={isSupportedBy ? 'Add a goal that supports this' : 'Add a goal this supports'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-[10px] bg-surface-sunken border border-border-light px-3 py-2.5">
            <p className="text-[13px] text-text-secondary">
              {isSupportedBy ? 'Helping' : 'This goal helps'}
            </p>
            <p className="text-[15px] font-semibold text-text-primary leading-snug">{goal.title}</p>
          </div>

          <div>
            <label className={labelClass}>Goal *</label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
                <Loader2 size={15} className="animate-spin" /> Loading goals…
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-text-secondary py-2">
                No other goal can be linked here yet — every existing goal is either already
                linked or would create a circle. Create a new one below.
              </p>
            ) : (
              <StyledSelect
                value={selected}
                onChange={setSelected}
                placeholder="Choose an existing goal…"
                options={candidates.map((c) => ({
                  value: c.id,
                  label: `${c.title} — due ${formatDate(c.due_date)}`,
                }))}
                disabled={saving}
              />
            )}
          </div>

          <div>
            <label className={labelClass}>Why does this link exist?</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. North and West cap out at ₹38 Cr — South-West is the only path to 50."
              disabled={saving}
              maxLength={1000}
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Optional, but this is the assumption you’ll want to re-read at review — most plans
              fail because an unwritten assumption quietly stopped being true.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-4 border-t border-border-light">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={saving}
              className="text-sm font-medium text-primary-text hover:text-primary-text disabled:text-text-muted transition-colors"
            >
              Create a new goal instead
            </button>
            <Button type="submit" disabled={saving || !selected}>
              {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
              {saving ? 'Linking…' : 'Link goal'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Creating inline links the new goal immediately, so the user never has to
          go and find it afterwards. */}
      <CreateGoalModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        orgId={orgId}
        employees={employees}
        onCreated={handleCreated}
      />
    </>
  )
}
