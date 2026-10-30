'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { tasksApi } from '@/lib/api/tasks'
import { useCanEditTask } from '@/lib/tasks/useCanEditTask'
import { TERMINAL_STATUS_PHASES, type Task, type TaskPriority } from '@/lib/types/tasks'
import { PHONE_HOME, taskHref, type PhoneRoute } from '@/lib/phone-routes'
import { buildChecklistItems, groupsFromChecklistItems } from '@/components/tasks/ChecklistBuilderField'
import PhoneScreen from '../PhoneScreen'
import { PhoneFailedState } from '../PhoneEmptyState'
import { PhoneButton, PhoneField, PhoneLinkButton, GrowTextarea, PHONE_INPUT, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import {
  TaskFormFields,
  HolidayKeepDialog,
  TITLE_MAX,
  DESCRIPTION_MAX,
  checklistPayload,
  cleanChecklist,
  deadlineToIso,
  isHolidayRefusal,
  isoToLocalDeadline,
  type TaskFormValues,
} from '../TaskFormFields'

/*
 * "Edit task" - phone only (the computer edits in a dialog on the record, so
 * /dashboard/tasks/:id/edit forwards there). plan-phone-2026-10-14.md §5.4,
 * kit §41.7.
 *
 *   - The same fields as Give task (components/phone/TaskFormFields.tsx),
 *     minus repeat and files: files are handled on the task screen.
 *   - Who may edit is decided by useCanEditTask, which mirrors the backend
 *     rule. While that is not known the form is not shown; if the person
 *     may not edit they get a plain message saying who can, and a way back.
 *   - Save sends only what changed, through the same PATCH the computer's
 *     edit dialog uses. Moving an existing due date offers an optional "why"
 *     note (deadline_reason), and a non-working day asks "keep this date
 *     anyway?" - both as on the computer.
 *   - A checklist item that already exists keeps its `id`, so ticks survive.
 *   - A closed task (completed / incomplete) cannot be edited here.
 */

const REASON_MAX = 500

/** Order-independent signature of a list of ids. */
const sig = (ids: string[]) => [...ids].sort().join(',')

function valuesFromTask(task: Task): TaskFormValues {
  const people = (task.assignees ?? []).map((a) => ({
    user_id: a.user_id,
    name: a.user_name ?? a.user?.name ?? 'Someone',
    is_cc: a.is_cc,
  }))
  return {
    title: task.title,
    description: task.description ?? '',
    deadline: isoToLocalDeadline(task.deadline),
    priorityId: task.priority_id ?? '',
    assignees: people.filter((p) => !p.is_cc).map(({ user_id, name }) => ({ user_id, name })),
    cc: people.filter((p) => p.is_cc).map(({ user_id, name }) => ({ user_id, name })),
    tags: (task.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, is_active: t.is_active })),
    checklist: groupsFromChecklistItems(task.checklist),
    proofRequired: task.proof_required ?? false,
    completionMode: task.completion_mode ?? 'any_can_complete',
  }
}

export default function EditTaskScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ taskId: string }>()
  const taskId = params?.taskId
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const parent = route.parent ?? PHONE_HOME

  const [task, setTask] = React.useState<Task | null>(null)
  const [error, setError] = React.useState(false)
  const canEdit = useCanEditTask(task)

  const load = React.useCallback(() => {
    if (!orgId || !taskId) return
    tasksApi
      .getTask(orgId, taskId)
      .then(setTask)
      .catch(() => setError(true))
  }, [orgId, taskId])
  React.useEffect(load, [load])

  if (error) {
    return (
      <PhoneScreen title="Edit task" parent={parent}>
        <PhoneFailedState what="This task" onRetry={() => { setError(false); load() }} />
        <PhoneLinkButton href={PHONE_HOME} fullWidth>
          Go to home
        </PhoneLinkButton>
      </PhoneScreen>
    )
  }

  if (!task || canEdit === undefined) {
    return (
      <PhoneScreen title="Edit task" parent={parent}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  const closed = !!task.status && TERMINAL_STATUS_PHASES.includes(task.status.type)
  if (!canEdit || closed) {
    return (
      <PhoneScreen title="Edit task" parent={parent}>
        <div className="flex flex-col gap-[16px]">
          <p className="text-body text-text-primary">
            {closed
              ? 'This task is closed, so it can no longer be edited. Reopen it from the task first.'
              : 'You cannot edit this task. It can be edited by the person who gave it, an admin, or the roles your organisation allows to edit tasks.'}
          </p>
          <PhoneLinkButton href={taskHref(task.id)} fullWidth>
            Back to the task
          </PhoneLinkButton>
        </div>
      </PhoneScreen>
    )
  }

  return <EditTaskForm task={task} orgId={orgId} parent={parent} />
}

function EditTaskForm({ task, orgId, parent }: { task: Task; orgId: string; parent: string }) {
  const router = useRouter()
  const { addToast } = useToast()
  const initial = React.useMemo(() => valuesFromTask(task), [task])
  const [values, setValues] = React.useState<TaskFormValues>(initial)
  const [reason, setReason] = React.useState('')
  const [priorities, setPriorities] = React.useState<TaskPriority[]>([])
  const [saving, setSaving] = React.useState(false)
  const [attempted, setAttempted] = React.useState(false)
  const [holidayMessage, setHolidayMessage] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    tasksApi.getPriorities(orgId).then(setPriorities).catch(() => {})
  }, [orgId])

  const titleError =
    values.title.length > TITLE_MAX
      ? `Shorten the title to ${TITLE_MAX} characters or fewer.`
      : attempted && values.title.trim().length === 0
        ? 'Enter a title.'
        : null
  const descriptionError = values.description.length > DESCRIPTION_MAX ? `Shorten the description to ${DESCRIPTION_MAX} characters or fewer.` : null
  const assigneesError =
    attempted && values.assignees.length === 0 ? 'Choose at least one assignee, or move someone from CC to assignees.' : null

  const newDeadline = deadlineToIso(values.deadline)
  const oldDeadline = task.deadline ? new Date(task.deadline).getTime() : null
  const deadlineChanged = (newDeadline ? new Date(newDeadline).getTime() : null) !== oldDeadline
  // Same rule as the computer: a task that has a due date keeps one.
  const deadlineError = attempted && oldDeadline !== null && !newDeadline ? 'Choose a due date. A task that has one keeps one.' : null
  const askReason = oldDeadline !== null && !!newDeadline && deadlineChanged

  /** Only what changed, so a stale form never undoes someone else's edit. */
  function buildChanges(holidayOverride: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const title = values.title.trim()
    if (title !== task.title) out.title = title
    const description = values.description.trim()
    if (description !== (task.description ?? '').trim()) out.description = description
    if (values.priorityId && values.priorityId !== (task.priority_id ?? '')) out.priority_id = values.priorityId
    if (deadlineChanged && newDeadline) {
      out.deadline = newDeadline
      out.holiday_override = holidayOverride
      if (askReason && reason.trim()) out.deadline_reason = reason.trim()
    }
    const ids = (list: { user_id: string }[]) => list.map((p) => p.user_id)
    if (sig(ids(values.assignees)) !== sig(ids(initial.assignees)) || sig(ids(values.cc)) !== sig(ids(initial.cc))) {
      out.assignee_user_ids = ids(values.assignees)
      out.cc_user_ids = ids(values.cc)
    }
    if (sig(values.tags.map((t) => t.id)) !== sig(initial.tags.map((t) => t.id))) out.tag_ids = values.tags.map((t) => t.id)
    const list = (g: TaskFormValues['checklist']) => JSON.stringify(buildChecklistItems(cleanChecklist(g)) ?? [])
    if (list(values.checklist) !== list(initial.checklist)) {
      const payload = checklistPayload(values.checklist)
      out.checklist_items = payload.checklist_items ?? []
      out.checklist_template_ids = payload.checklist_template_ids
    }
    if (values.proofRequired !== initial.proofRequired) {
      out.proof_required = values.proofRequired
      out.proof_allowed_extensions = values.proofRequired ? (task.proof_allowed_extensions ?? []) : []
    }
    if (values.completionMode !== initial.completionMode) out.completion_mode = values.completionMode
    return out
  }

  async function onSave(holidayOverride = false) {
    if (saving) return
    setAttempted(true)
    const invalid =
      values.title.trim().length === 0 ||
      values.title.length > TITLE_MAX ||
      !!descriptionError ||
      values.assignees.length === 0 ||
      (oldDeadline !== null && !newDeadline)
    if (invalid) {
      focusFirstInvalid(formRef.current)
      return
    }
    const changes = buildChanges(holidayOverride)
    if (Object.keys(changes).length === 0) {
      router.replace(taskHref(task.id))
      return
    }
    setSaving(true)
    try {
      await tasksApi.updateTask(orgId, task.id, changes as Parameters<typeof tasksApi.updateTask>[2])
      addToast('Task updated', 'success')
      router.replace(taskHref(task.id))
    } catch (e) {
      const message = apiErrorMessage(e, '')
      // The holiday rule never forces itself - offer to keep the chosen date.
      if (isHolidayRefusal(message)) setHolidayMessage(message)
      else addToast(message || 'Could not save the changes. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneScreen title="Edit task" parent={parent}>
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-[20px] pb-[80px]"
        onKeyDown={enterMovesNext}
        onSubmit={(e) => e.preventDefault()}
      >
        <TaskFormFields
          values={values}
          setValues={setValues}
          priorities={priorities}
          orgId={orgId}
          idPrefix="edit-task"
          titleError={titleError}
          descriptionError={descriptionError}
          assigneesError={assigneesError}
          allowNoPriority={!task.priority_id}
        />
        {deadlineError ? (
          <p tabIndex={-1} data-field-error className="-mt-[12px] text-meta text-danger">
            {deadlineError}
          </p>
        ) : null}
        {askReason ? (
          <PhoneField label="Why is the date changing? (optional)" htmlFor="edit-task-reason">
            <GrowTextarea
              id="edit-task-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              rows={2}
              className={cx(PHONE_INPUT, 'py-[10px]')}
            />
          </PhoneField>
        ) : null}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-(--z-shell) flex gap-[8px] border-t border-border-light bg-surface px-[16px] pt-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton type="button" variant="primary" fullWidth loading={saving} onClick={() => void onSave()}>
          Save changes
        </PhoneButton>
      </div>

      <HolidayKeepDialog
        message={holidayMessage}
        onCancel={() => setHolidayMessage(null)}
        onKeep={() => {
          setHolidayMessage(null)
          void onSave(true)
        }}
      />
    </PhoneScreen>
  )
}
