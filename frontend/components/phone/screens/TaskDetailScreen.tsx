'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { Task } from '@/lib/types/tasks'
import { PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { PhoneLinkButton } from '../primitives'

/*
 * A minimal, read-only task record screen - plan-phone-2026-10-14.md §5.3
 * calls for the full one-column detail (action bar, checklist, comments,
 * files...); THAT is next slice's work. This slice only needs somewhere for
 * "tap the rest of the row" (TaskPhoneRow) to land, replacing the
 * RecordComingNextScreen placeholder for 'task-record' with real data:
 * title, status, and the 4 key facts the plan names (assignee, deadline,
 * priority, category). No actions, no edit, no comments, no files here yet.
 */
export default function TaskDetailScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ taskId: string }>()
  const taskId = params?.taskId
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [task, setTask] = React.useState<Task | null>(null)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    if (!orgId || !taskId) return
    tasksApi
      .getTask(orgId, taskId)
      .then(setTask)
      .catch(() => setError(true))
  }, [orgId, taskId])

  if (error) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <PhoneEmptyState
          icon={<span aria-hidden>!</span>}
          heading="This task could not be opened"
          line="It may have been removed, or you may no longer have access to it."
        >
          <PhoneLinkButton href={route.parent ?? PHONE_HOME} fullWidth>
            Go to My work
          </PhoneLinkButton>
        </PhoneEmptyState>
      </PhoneScreen>
    )
  }

  if (!task) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-phone-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-phone-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  const assignees = (task.assignees ?? []).filter((a) => !a.is_cc)
  const assigneeLabel =
    assignees.length === 0
      ? '—'
      : assignees.length === 1
        ? assignees[0].user_name ?? assignees[0].user?.name ?? '—'
        : `${assignees[0].user_name ?? assignees[0].user?.name ?? 'Someone'} +${assignees.length - 1}`

  const facts: { label: string; value: string }[] = [
    { label: 'Assignee', value: assigneeLabel },
    { label: 'Deadline', value: task.deadline ? new Date(task.deadline).toLocaleString() : 'No deadline' },
    { label: 'Priority', value: task.priority?.label ?? '—' },
    { label: 'Category', value: task.category?.name ?? '—' },
  ]

  return (
    <PhoneScreen title={task.title} parent={route.parent ?? PHONE_HOME}>
      <div className="flex flex-col gap-[16px]">
        {task.status ? (
          <span
            className="inline-flex w-fit items-center rounded-full px-[10px] py-[2px] text-phone-label font-semibold"
            style={{ backgroundColor: `${task.status.color}22`, color: task.status.color }}
          >
            {task.status.label}
          </span>
        ) : null}

        <dl className="grid grid-cols-2 gap-y-[12px] gap-x-[12px]">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-[2px]">
              <dt className="text-phone-meta text-phone-text-secondary">{f.label}</dt>
              <dd className="truncate text-phone-body text-phone-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>

        {task.description ? (
          <div className="flex flex-col gap-[4px]">
            <h2 className="text-phone-label font-medium text-phone-text-secondary">Description</h2>
            <p className="whitespace-pre-wrap text-phone-body text-phone-text-primary">{task.description}</p>
          </div>
        ) : null}
      </div>
    </PhoneScreen>
  )
}
