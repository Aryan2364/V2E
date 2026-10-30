'use client'

import React from 'react'
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import type { Task, TaskAssigneeUser } from '@/lib/types/tasks'
import { PhoneButton, PhoneField, PHONE_INPUT, ROW_BLOCK, cx } from './primitives'
import { PhoneSheet } from './PhoneSheet'
import { StatusSheet } from './TaskStatusSheets'

/*
 * "People" on an all_must_complete task: everyone's part at a glance, and for
 * the creator/admin the same per-person controls as the computer's Assignees
 * card (app/dashboard/tasks/[taskId]/page.tsx ~1940-2075):
 *
 *   - Reopen (~1979, ~1998): canEdit and that person's part is finished OR
 *     flagged can't-complete; an optional note; POST assignees/:userId/reopen.
 *     The answer to a "part flagged" notification. The desktop does not hide it
 *     on a closed task, so neither does this.
 *   - Status + Done (~2028-2050): canEdit, per-person mode, part still open;
 *     PATCH assignee-status (with that user) and POST assignees/:userId/complete.
 *
 * `canEdit` is the desktop's creator-or-admin, not on a simulated-future task.
 */

export function TaskPartsSection({
  orgId,
  task,
  canEdit,
  onTaskUpdate,
}: {
  orgId: string
  task: Task
  canEdit: boolean
  onTaskUpdate: (t: Task) => void
}) {
  const { addToast } = useToast()
  const people = (task.assignees ?? []).filter((a) => !a.is_cc)
  const [reopening, setReopening] = React.useState<TaskAssigneeUser | null>(null)
  const [statusFor, setStatusFor] = React.useState<TaskAssigneeUser | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  if (task.completion_mode !== 'all_must_complete' || people.length === 0) return null

  async function markDone(a: TaskAssigneeUser) {
    setBusyId(a.user_id)
    try {
      onTaskUpdate(await tasksApi.completeAssignee(orgId, task.id, a.user_id))
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not mark that part done. Try again.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="text-label font-medium text-text-secondary">
        People · {people.filter((a) => a.is_completed).length}/{people.length} done
      </h2>
      <ul className={ROW_BLOCK}>
        {people.map((a) => {
          const name = a.user?.name ?? a.user_name ?? 'Someone'
          // Desktop `editable` (~1949): canEdit, per-person mode, part still open.
          const editable = canEdit && !a.is_completed && !a.cannot_complete
          const canReopen = canEdit && (a.is_completed || !!a.cannot_complete)
          return (
            <li key={a.id} className="flex flex-col gap-[4px] px-[16px] py-[10px]">
              <div className="flex items-center gap-[12px]">
                <span className="min-w-0 flex-1 truncate text-body text-text-primary">{name}</span>
                {a.is_completed ? (
                  <span className="inline-flex shrink-0 items-center gap-[4px] text-label font-medium text-success">
                    <CheckCircle2 aria-hidden className="size-[14px]" /> Completed
                  </span>
                ) : a.cannot_complete ? (
                  <span className="inline-flex shrink-0 items-center gap-[4px] text-label font-medium text-danger">
                    <XCircle aria-hidden className="size-[14px]" /> Incomplete
                  </span>
                ) : (
                  <span className="shrink-0 text-label font-medium" style={{ color: a.status?.color ?? 'var(--text-muted)' }}>
                    {a.status?.label ?? 'Not started'}
                  </span>
                )}
              </div>
              {a.cannot_complete && !a.is_completed && a.cannot_complete_reason ? (
                <p className="whitespace-pre-wrap text-meta text-danger">{a.cannot_complete_reason}</p>
              ) : null}
              {editable || canReopen ? (
                <div className="flex flex-wrap gap-[8px]">
                  {editable ? (
                    <>
                      <PhoneButton variant="secondary" onClick={() => setStatusFor(a)}>
                        Status
                      </PhoneButton>
                      <PhoneButton variant="secondary" loading={busyId === a.user_id} onClick={() => void markDone(a)}>
                        <CheckCircle2 aria-hidden /> Done
                      </PhoneButton>
                    </>
                  ) : null}
                  {canReopen ? (
                    <PhoneButton variant="secondary" onClick={() => setReopening(a)}>
                      <RotateCcw aria-hidden /> Reopen
                    </PhoneButton>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {reopening ? (
        <ReopenPartSheet
          name={reopening.user?.name ?? reopening.user_name ?? 'this person'}
          onClose={() => setReopening(null)}
          onConfirm={async (note) => {
            onTaskUpdate(await tasksApi.reopenAssigneePart(orgId, task.id, reopening.user_id, note || undefined))
          }}
        />
      ) : null}

      <StatusSheet
        open={!!statusFor}
        onOpenChange={(o) => !o && setStatusFor(null)}
        orgId={orgId}
        task={task}
        mine={false}
        forUserId={statusFor?.user_id}
        title={`${statusFor?.user?.name ?? statusFor?.user_name ?? 'Person'}'s status`}
        currentStatusId={statusFor?.status_id}
        onTaskUpdate={onTaskUpdate}
      />
    </section>
  )
}

/** Mounted only while open, so each opening starts with an empty note. */
function ReopenPartSheet({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await onConfirm(note.trim())
      onClose()
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not reopen that part. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reopen ${name}'s part`}
      footer={
        <PhoneButton variant="primary" fullWidth loading={saving} onClick={() => void submit()}>
          {saving ? 'Reopening…' : 'Reopen part'}
        </PhoneButton>
      }
    >
      <PhoneField label="Note (optional)" htmlFor="reopen-part-note" error={error}>
        <textarea
          id="reopen-part-note"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="What would you like them to do?"
          className={cx(PHONE_INPUT, 'min-h-[88px] py-[10px]')}
        />
      </PhoneField>
    </PhoneSheet>
  )
}
