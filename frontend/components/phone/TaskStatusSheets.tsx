'use client'

import React from 'react'
import { Check } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { TERMINAL_STATUS_PHASES, type Task, type TaskStatus } from '@/lib/types/tasks'
import { PhoneButton, ROW, ROW_BLOCK, cx } from './primitives'
import { PhoneSheet } from './PhoneSheet'

/*
 * The record-level status controls the computer's task page offers
 * (app/dashboard/tasks/[taskId]/page.tsx), as two small sheets opened from the
 * ... menu:
 *
 *   - StatusSheet: move the shared status (any_can_complete, ~1581) or my own
 *     status track (all_must_complete, ~1480). Open statuses only; "Incomplete"
 *     stays in "Can't complete" / "Mark whole task incomplete".
 *   - CompletionModeSheet: any assignee can complete / all must complete
 *     (~2148), saved through updateTask({ completion_mode }) as on the computer.
 *
 * The gates live on the screen (it already has the roles); the server still
 * refuses anything not allowed and its sentence is shown inline.
 */

/** Open (non-closing) statuses, as the computer's page lists them. */
function useOpenStatuses(orgId: string, open: boolean) {
  const [statuses, setStatuses] = React.useState<TaskStatus[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    if (!open || statuses) return
    tasksApi
      .getStatuses(orgId)
      .then((all) => setStatuses(all.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))))
      .catch(() => setFailed(true))
  }, [open, orgId, statuses])
  return { statuses, failed }
}

export function StatusSheet({
  open,
  onOpenChange,
  orgId,
  task,
  mine,
  forUserId,
  title,
  currentStatusId,
  onTaskUpdate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  task: Task
  /** all_must_complete: this moves only the viewer's own part. */
  mine: boolean
  /** The owner moving one person's track (all_must_complete): that person's user id. */
  forUserId?: string
  title?: string
  currentStatusId: string | null | undefined
  onTaskUpdate: (t: Task) => void
}) {
  const { statuses, failed } = useOpenStatuses(orgId, open)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function pick(s: TaskStatus) {
    if (pending || s.id === currentStatusId) return
    setPending(s.id)
    setError(null)
    try {
      onTaskUpdate(mine || forUserId ? await tasksApi.setAssigneeStatus(orgId, task.id, s.id, forUserId) : await tasksApi.setSharedStatus(orgId, task.id, s.id))
      onOpenChange(false)
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not change the status. Try again.'))
    } finally {
      setPending(null)
    }
  }

  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} title={title ?? (mine ? 'Your status' : 'Change status')}>
      <div className="flex flex-col gap-[12px]">
        <p className="text-body text-text-secondary">
          {mine ? 'This is your status. Everyone’s progress shows on the task.' : forUserId ? 'This moves only this person’s part.' : 'One status for everyone on this task.'}
        </p>
        {failed ? <p className="text-body text-danger">Statuses could not be loaded. Close this and try again.</p> : null}
        {!statuses && !failed ? <span aria-hidden className="h-[48px] rounded-[8px] bg-surface-control" /> : null}
        {statuses ? (
          <ul className={ROW_BLOCK}>
            {statuses.map((s) => (
              <li key={s.id}>
                <button type="button" disabled={!!pending} onClick={() => void pick(s)} className={cx(ROW, 'disabled:text-text-muted')}>
                  <span aria-hidden className="size-[10px] shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.id === currentStatusId ? <Check aria-hidden className="size-[20px] shrink-0 text-primary-text" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="text-label text-danger">{error}</p> : null}
      </div>
    </PhoneSheet>
  )
}

export function CompletionModeSheet({
  open,
  onOpenChange,
  orgId,
  task,
  onTaskUpdate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  task: Task
  onTaskUpdate: (t: Task) => void
}) {
  return open ? <ModeBody open={open} onOpenChange={onOpenChange} orgId={orgId} task={task} onTaskUpdate={onTaskUpdate} /> : null
}

const MODES = [
  { value: 'any_can_complete', label: 'Any assignee can complete' },
  { value: 'all_must_complete', label: 'All assignees must complete' },
] as const

function ModeBody({
  open,
  onOpenChange,
  orgId,
  task,
  onTaskUpdate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  task: Task
  onTaskUpdate: (t: Task) => void
}) {
  const [draft, setDraft] = React.useState<'any_can_complete' | 'all_must_complete'>(
    task.completion_mode === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete',
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    if (draft === task.completion_mode) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await tasksApi.updateTask(orgId, task.id, { completion_mode: draft })
      // Same as the computer: reload, because status and checklist counts change with the mode.
      onTaskUpdate(await tasksApi.getTask(orgId, task.id))
      onOpenChange(false)
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not change the completion mode. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Completion mode"
      footer={
        <PhoneButton variant="primary" fullWidth loading={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[12px]">
        <ul className={ROW_BLOCK} role="radiogroup" aria-label="Completion mode">
          {MODES.map((m) => (
            <li key={m.value}>
              <button type="button" role="radio" aria-checked={draft === m.value} onClick={() => setDraft(m.value)} className={ROW}>
                <span className="min-w-0 flex-1">{m.label}</span>
                {draft === m.value ? <Check aria-hidden className="size-[20px] shrink-0 text-primary-text" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {error ? <p className="text-label text-danger">{error}</p> : null}
      </div>
    </PhoneSheet>
  )
}
