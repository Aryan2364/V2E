'use client'

import React from 'react'
import Link from 'next/link'
import { Paperclip } from 'lucide-react'
import type { Task } from '@/lib/types/tasks'
import { rowMarker } from '@/lib/tasks/finish-rules'
import { shortDue } from '@/lib/tasks/short-due'
import { cx } from './primitives'

/*
 * One row on My work - plan-phone-2026-10-14.md §5.1, KIT-PENDING-phone-task-tick.md
 * items 1-4. A to-do's own row primitive, not the generic phone list row: it
 * carries a completion circle, which the kit's own list rows never do.
 *
 *   - Circle: 22px visible, 44px tap target. Hollow + border when not done;
 *     filled primary + white check when done. "Mark complete" / "Mark not
 *     complete" screen-reader label (item 4).
 *   - Tapping the circle completes or opens the Finish sheet (decided by the
 *     caller via `onTapCircle`, BEFORE calling any complete endpoint - see
 *     lib/tasks/finish-rules.ts). Tapping the rest of the row opens the task.
 *   - `phase` drives the tap animation: 'done' fills the circle and strikes
 *     the title (~300ms) before the caller collapses the row out of the list.
 *   - One line (owner's request, 2026-10-14): the title on the left; on the
 *     right the short due label (lib/tasks/short-due.ts - just the time under
 *     Today/Tomorrow, nothing for an end-of-day task there, "18 Oct"
 *     otherwise; red when overdue) and the markers: a paperclip for
 *     outstanding proof and/or "n/N" for an unfinished checklist (KIT-PENDING
 *     item 3), so the Finish sheet is never a surprise.
 */

export type RowPhase = 'idle' | 'done' | 'collapsed'

export function TaskPhoneRow({
  task,
  userId,
  phase,
  onTapCircle,
  href,
  dayKnown = false,
}: {
  task: Task
  userId: string | undefined
  phase: RowPhase
  onTapCircle: () => void
  href: string
  /** The row sits under a Today/Tomorrow heading, so its due label drops the day word. */
  dayKnown?: boolean
}) {
  const filled = phase === 'done' || phase === 'collapsed'
  const marker = rowMarker(task, userId)
  const due = shortDue(task.deadline, { dayKnown })

  return (
    <div
      data-slot="task-phone-row-collapse"
      className={cx(
        'grid transition-[grid-template-rows] duration-(--duration-slow) ease-in-out',
        phase === 'collapsed' ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
      )}
    >
      <div className="overflow-hidden">
        <div className="flex min-h-[56px] w-full items-center gap-[4px] pl-[8px] pr-[16px]">
          <button
            type="button"
            aria-label={filled ? 'Mark not complete' : 'Mark complete'}
            aria-pressed={filled}
            onClick={onTapCircle}
            disabled={phase !== 'idle'}
            className="flex size-[44px] shrink-0 items-center justify-center outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
          >
            <span
              aria-hidden
              className={cx(
                'flex size-[22px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-(--duration-fast)',
                filled
                  ? 'bg-primary border-2 border-primary'
                  : 'border-2 border-border-strong bg-transparent',
              )}
            >
              {filled ? (
                <svg viewBox="0 0 16 16" className="size-[12px] text-primary-foreground" fill="none">
                  <path
                    d="M3 8.5L6.2 11.5L13 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
          </button>

          <Link href={href} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-[8px]">
            <span
              className={cx(
                'min-w-0 flex-1 truncate text-body font-medium text-text-primary transition-[color] duration-(--duration-fast)',
                filled && 'text-text-muted line-through',
              )}
            >
              {task.title}
            </span>
            {due || marker.proof || marker.checklist ? (
              <span className="flex shrink-0 items-center gap-[8px] text-meta text-text-secondary">
                {marker.proof ? (
                  <span className="inline-flex items-center" aria-label="Proof needed">
                    <Paperclip aria-hidden className="size-[14px]" />
                  </span>
                ) : null}
                {marker.checklist ? <span aria-label={`Checklist ${marker.checklist}`}>{marker.checklist}</span> : null}
                {due ? (
                  <span className={cx('whitespace-nowrap', task.is_overdue && 'font-medium text-danger')}>{due}</span>
                ) : null}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </div>
  )
}

/** A skeleton row while the list loads (plan §5.1 "skeleton rows"). */
export function TaskPhoneRowSkeleton() {
  return (
    <div className="flex min-h-[56px] items-center gap-[4px] pl-[8px] pr-[16px]" aria-hidden>
      <span className="flex size-[44px] shrink-0 items-center justify-center">
        <span className="size-[22px] rounded-full bg-surface-control" />
      </span>
      <span className="h-[14px] flex-1 rounded-full bg-surface-control" />
      <span className="h-[10px] w-[48px] shrink-0 rounded-full bg-surface-control" />
    </div>
  )
}
