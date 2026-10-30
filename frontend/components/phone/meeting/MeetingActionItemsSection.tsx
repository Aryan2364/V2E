'use client'

import React from 'react'
import { CheckCircle2, ChevronRight, Circle, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { fmtDate } from '@/lib/phone-format'
import { taskHref } from '@/lib/phone-routes'
import type { Meeting, MeetingActionItem } from '@/lib/types/meetings'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneDateField } from '../PhoneDateTimeField'
import { PhoneButton, PhoneField, PhoneLinkButton, PHONE_INPUT, ROW, ROW_BLOCK, cx } from '../primitives'
import { ConfirmSheet, EDIT_REASON, PersonField, useMeetingPeople } from './meetingShared'

/*
 * Action items - the computer's ActionItemsTab (meetings/[meetingId]/page.tsx
 * 410-469). Tick done, add (text, owner, due), delete, and create a task from
 * an item (linkTask with create: { title, assignee_user_ids, deadline }, line
 * 453). All of it stops when the meeting is closed or cancelled (line 417).
 * Beyond the computer: the text, owner and due date of an item can be edited
 * (PATCH :id/action-items/:itemId already accepts them). Attaching an
 * existing task by pasting its ID (line 484) is not drawn: nobody has a task
 * ID on a phone.
 */
export function MeetingActionItemsSection({
  orgId,
  meeting,
  locked,
  canEdit,
  onChanged,
}: {
  orgId: string
  meeting: Meeting
  locked: boolean
  canEdit: boolean
  onChanged: (m: Meeting) => void
}) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const items = meeting.action_items ?? []
  const [mode, setMode] = React.useState<{ id: string | null } | null>(null)
  const [text, setText] = React.useState('')
  const [owner, setOwner] = React.useState('')
  const [due, setDue] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [taskFor, setTaskFor] = React.useState<MeetingActionItem | null>(null)
  const [taskTitle, setTaskTitle] = React.useState('')
  const [taskAssignee, setTaskAssignee] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const needPeople = mode !== null || taskFor !== null || items.length > 0
  const { people, loading, failed, retry } = useMeetingPeople(user?.organizationId ?? orgId, needPeople)
  const nameOf = (id: string | null) => (id ? people.find((p) => p.user_id === id)?.name ?? 'Owner' : 'Unassigned')
  const editing = mode?.id ? items.find((i) => i.id === mode.id) ?? null : null
  const readOnly = locked || !canEdit

  async function run(fn: () => Promise<Meeting>, ok?: string): Promise<boolean> {
    setBusy(true)
    try {
      onChanged(await fn())
      if (ok) addToast(ok, 'success')
      return true
    } catch (e) {
      const msg = apiErrorMessage(e, 'Could not do that. Try again.')
      setError(msg)
      addToast(msg, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  function openAdd() {
    setText('')
    setOwner('')
    setDue('')
    setError(null)
    setMode({ id: null })
  }
  function openItem(it: MeetingActionItem) {
    setText(it.text)
    setOwner(it.owner_user_id ?? '')
    setDue(it.due_date ? it.due_date.slice(0, 10) : '')
    setError(null)
    setMode({ id: it.id })
  }
  const dueIso = due ? new Date(due).toISOString() : undefined

  async function save() {
    if (!text.trim()) {
      setError('Enter what needs doing.')
      return
    }
    const ok = editing
      ? await run(() => meetingsApi.updateActionItem(orgId, meeting.id, editing.id, { text: text.trim(), owner_user_id: owner || null, due_date: dueIso ?? null }))
      : await run(() => meetingsApi.addActionItem(orgId, meeting.id, { text: text.trim(), owner_user_id: owner || undefined, due_date: dueIso }), 'Action item added')
    if (ok) setMode(null)
  }

  function openCreateTask(it: MeetingActionItem) {
    setTaskTitle(it.text)
    setTaskAssignee(it.owner_user_id ?? '')
    setError(null)
    setMode(null)
    setTaskFor(it)
  }

  async function createTask() {
    if (!taskFor || !taskAssignee || !taskTitle.trim()) return
    const item = taskFor
    const ok = await run(
      () => meetingsApi.linkTask(orgId, meeting.id, item.id, { create: { title: taskTitle.trim(), assignee_user_ids: [taskAssignee], deadline: item.due_date ?? undefined } }),
      'Task created & linked',
    )
    if (ok) setTaskFor(null)
  }

  async function remove() {
    if (!editing) return
    const ok = await run(() => meetingsApi.deleteActionItem(orgId, meeting.id, editing.id), 'Action item deleted')
    if (ok) {
      setConfirmDelete(false)
      setMode(null)
    }
  }

  return (
    <section className="flex flex-col gap-[8px]">
      <h3 className="text-label font-medium text-text-secondary">Action items · {items.length}</h3>
      <div className={ROW_BLOCK}>
        {items.length === 0 ? <p className="px-[16px] py-[12px] text-body text-text-secondary">No action items yet.</p> : null}
        {items.map((it) => {
          const overdue = !!it.due_date && !it.is_done && new Date(it.due_date) < new Date()
          return (
            <div key={it.id} className="flex items-center">
              <button
                type="button"
                aria-label={it.is_done ? 'Mark not done' : 'Mark done'}
                disabled={readOnly}
                onClick={() => void run(() => meetingsApi.updateActionItem(orgId, meeting.id, it.id, { is_done: !it.is_done }))}
                className="flex size-[48px] shrink-0 items-center justify-center pl-[8px] text-text-secondary disabled:cursor-not-allowed"
              >
                {it.is_done ? <CheckCircle2 aria-hidden className="size-[22px] text-success" /> : <Circle aria-hidden className="size-[22px]" />}
              </button>
              <button type="button" className={cx(ROW, 'min-w-0 flex-1 pl-[4px]')} onClick={() => openItem(it)}>
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-body', it.is_done ? 'text-text-secondary line-through' : 'text-text-primary')}>{it.text}</span>
                  <span className="block truncate text-meta text-text-secondary">
                    {nameOf(it.owner_user_id)}
                    {it.due_date ? ` · due ${fmtDate(it.due_date)}` : ''}
                    {overdue ? ' · Overdue' : ''}
                    {it.linked_task_id ? ' · Task linked' : ''}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
              </button>
            </div>
          )
        })}
        {!locked ? (
          <div className="[&>span]:flex [&>span]:w-full">
            <PermissionTooltip allowed={canEdit} reason={EDIT_REASON}>
              <button type="button" disabled={!canEdit} className={cx(ROW, 'text-primary-text disabled:text-text-secondary disabled:cursor-not-allowed')} onClick={openAdd}>
                <Plus aria-hidden className="size-[18px]" /> Add action item
              </button>
            </PermissionTooltip>
          </div>
        ) : null}
      </div>

      <PhoneSheet
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={editing ? (readOnly ? 'Action item' : 'Edit action item') : 'Add action item'}
        footer={
          readOnly ? undefined : (
            <PhoneButton variant="primary" loading={busy} onClick={() => void save()}>
              {editing ? 'Save' : 'Add'}
            </PhoneButton>
          )
        }
      >
        <div className="flex flex-col gap-[16px]">
          {readOnly && editing ? (
            <dl className="flex flex-col gap-[12px]">
              <div>
                <dt className="text-meta text-text-secondary">Action</dt>
                <dd className="whitespace-pre-wrap text-body text-text-primary">{editing.text}</dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Owner</dt>
                <dd className="text-body text-text-primary">{nameOf(editing.owner_user_id)}</dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Due</dt>
                <dd className="text-body text-text-primary">{editing.due_date ? fmtDate(editing.due_date) : 'No date'}</dd>
              </div>
            </dl>
          ) : (
            <>
              <PhoneField label="Action" htmlFor="ai-text" required error={error}>
                <textarea id="ai-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder="What needs doing?" aria-invalid={error ? true : undefined} className={`${PHONE_INPUT} min-h-[72px] py-[10px]`} />
              </PhoneField>
              <PersonField label="Owner" htmlFor="ai-owner" value={owner} onChange={setOwner} people={people} loading={loading} failed={failed} onRetry={retry} placeholder="Nobody yet" />
              <PhoneDateField id="ai-due" label="Due date" value={due} onChange={setDue} />
            </>
          )}
          {editing?.linked_task_id ? (
            <PhoneLinkButton href={taskHref(editing.linked_task_id)} fullWidth>
              Open linked task
            </PhoneLinkButton>
          ) : editing && !locked ? (
            <div className="[&>span]:flex [&>span]:w-full">
              <PermissionTooltip allowed={canEdit} reason={EDIT_REASON}>
                <PhoneButton fullWidth disabled={!canEdit} onClick={() => openCreateTask(editing)}>
                  Create a task from this
                </PhoneButton>
              </PermissionTooltip>
            </div>
          ) : null}
          {editing && !locked ? (
            <div className="[&>span]:flex [&>span]:w-full">
              <PermissionTooltip allowed={canEdit} reason={EDIT_REASON}>
                <PhoneButton fullWidth disabled={!canEdit} className="border-danger text-danger active:bg-danger-bg" onClick={() => setConfirmDelete(true)}>
                  Delete action item
                </PhoneButton>
              </PermissionTooltip>
            </div>
          ) : null}
        </div>
      </PhoneSheet>

      <PhoneSheet
        open={taskFor !== null}
        onOpenChange={(o) => !o && setTaskFor(null)}
        title="Create a task"
        footer={
          <PhoneButton variant="primary" loading={busy} disabled={!taskAssignee || !taskTitle.trim()} onClick={() => void createTask()}>
            Create &amp; link
          </PhoneButton>
        }
      >
        <div className="flex flex-col gap-[16px]">
          <p className="text-body text-text-secondary">The task is created and linked to this action item{taskFor?.due_date ? `, due ${fmtDate(taskFor.due_date)}` : ''}.</p>
          <PhoneField label="Task title" htmlFor="ai-task-title" required error={error}>
            <input id="ai-task-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className={PHONE_INPUT} />
          </PhoneField>
          <PersonField label="Executor" htmlFor="ai-task-exec" required clearable={false} value={taskAssignee} onChange={setTaskAssignee} people={people} loading={loading} failed={failed} onRetry={retry} />
        </div>
      </PhoneSheet>

      <ConfirmSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete action item"
        body="This removes the action item. A task already created from it stays."
        confirmLabel="Delete"
        busy={busy}
        destructive
        onConfirm={() => void remove()}
      />
    </section>
  )
}
