'use client'

import React from 'react'
import Link from 'next/link'
import type { Task } from '@/lib/types/tasks'

/*
 * One row on the Given tab (plan-phone-2026-10-14.md §5.2, D7). No
 * completion circle — the giver isn't the one who finishes it. Line 1:
 * title. Line 2: assignee(s) and progress ("2 of 3 done" for
 * all_must_complete; a plain name list for any_can_complete, which has no
 * per-person progress to count). Line 3: due/overdue.
 */

function assigneeProgress(task: Task): string {
  const assignees = (task.assignees ?? []).filter((a) => !a.is_cc)
  const names = assignees.map((a) => a.user?.name ?? a.user_name ?? 'Someone')
  if (assignees.length === 0) return 'No one assigned'
  if (task.completion_mode === 'all_must_complete' && assignees.length > 1) {
    const done = assignees.filter((a) => a.is_completed).length
    return `${names.join(', ')} · ${done} of ${assignees.length} done`
  }
  return names.join(', ')
}

function dueLine(task: Task): { text: string; overdue: boolean } | null {
  if (!task.deadline) return null
  const d = new Date(task.deadline)
  const overdue = !!task.is_overdue
  const text = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return { text: overdue ? `Overdue · ${text}` : `Due ${text}`, overdue }
}

export function GivenTaskRow({ task, href }: { task: Task; href: string }) {
  const due = dueLine(task)
  return (
    <Link
      href={href}
      className="flex min-h-[64px] w-full flex-col gap-[4px] px-[16px] py-[12px] text-left active:bg-phone-surface-control"
    >
      <span className="truncate text-phone-body font-semibold text-phone-text-primary">{task.title}</span>
      <span className="truncate text-phone-label text-phone-text-secondary">{assigneeProgress(task)}</span>
      {due ? (
        <span className={due.overdue ? 'truncate text-phone-meta font-medium text-phone-danger' : 'truncate text-phone-meta text-phone-text-secondary'}>
          {due.text}
        </span>
      ) : null}
    </Link>
  )
}

export function GivenTaskRowSkeleton() {
  return (
    <div className="flex min-h-[64px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
      <span className="h-[16px] w-3/4 rounded-full bg-phone-surface-control" />
      <span className="h-[12px] w-1/2 rounded-full bg-phone-surface-control" />
      <span className="h-[10px] w-1/3 rounded-full bg-phone-surface-control" />
    </div>
  )
}
