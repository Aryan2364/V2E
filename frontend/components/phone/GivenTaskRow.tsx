'use client'

import React from 'react'
import Link from 'next/link'
import type { Task } from '@/lib/types/tasks'
import { shortDue } from '@/lib/tasks/short-due'

/*
 * One row on the Given tab (plan-phone-2026-10-14.md §5.2, D7). No
 * completion circle — the giver isn't the one who finishes it. Two lines
 * (owner's request, 2026-10-14): line 1 the title, with the short due label
 * on its right (lib/tasks/short-due.ts, red when overdue); line 2 the
 * assignee(s) and progress ("2 of 3 done" for all_must_complete; a plain name
 * list for any_can_complete, which has no per-person progress to count).
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

export function GivenTaskRow({ task, href }: { task: Task; href: string }) {
  const due = shortDue(task.deadline)
  return (
    <Link
      href={href}
      className="flex min-h-[64px] w-full flex-col justify-center gap-[2px] px-[16px] py-[10px] text-left active:bg-phone-surface-control"
    >
      <span className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-phone-body font-semibold text-phone-text-primary">{task.title}</span>
        {due ? (
          <span
            className={
              task.is_overdue
                ? 'shrink-0 whitespace-nowrap text-phone-meta font-medium text-phone-danger'
                : 'shrink-0 whitespace-nowrap text-phone-meta text-phone-text-secondary'
            }
          >
            {task.is_overdue ? `Overdue · ${due}` : due}
          </span>
        ) : null}
      </span>
      <span className="truncate text-phone-label text-phone-text-secondary">{assigneeProgress(task)}</span>
    </Link>
  )
}

export function GivenTaskRowSkeleton() {
  return (
    <div className="flex min-h-[64px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
      <span className="h-[16px] w-3/4 rounded-full bg-phone-surface-control" />
      <span className="h-[12px] w-1/2 rounded-full bg-phone-surface-control" />
    </div>
  )
}
