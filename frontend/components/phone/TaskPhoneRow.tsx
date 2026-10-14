'use client'

import React from 'react'
import Link from 'next/link'
import { Paperclip } from 'lucide-react'
import type { Task } from '@/lib/types/tasks'
import { rowMarker } from '@/lib/tasks/finish-rules'
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
 *   - Line 2 marker: a paperclip for outstanding proof and/or "n/N" for an
 *     unfinished checklist (KIT-PENDING item 3), so the Finish sheet is never
 *     a surprise.
 */

export type RowPhase = 'idle' | 'done' | 'collapsed'

export function TaskPhoneRow({
  task,
  userId,
  phase,
  onTapCircle,
  href,
}: {
  task: Task
  userId: string | undefined
  phase: RowPhase
  onTapCircle: () => void
  href: string
}) {
  const filled = phase === 'done' || phase === 'collapsed'
  const marker = rowMarker(task, userId)
  const deadline = task.deadline ? formatDeadline(task.deadline) : null

  return (
    <div
      data-slot="task-phone-row-collapse"
      className={cx(
        'grid transition-[grid-template-rows] duration-[var(--duration-slow)] ease-in-out',
        phase === 'collapsed' ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
      )}
    >
      <div className="overflow-hidden">
        <div className="flex min-h-[48px] w-full items-start gap-[4px] px-[16px] py-[10px]">
          <button
            type="button"
            aria-label={filled ? 'Mark not complete' : 'Mark complete'}
            aria-pressed={filled}
            onClick={onTapCircle}
            disabled={phase !== 'idle'}
            className="flex size-[44px] shrink-0 items-center justify-center outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phone-primary-ring"
          >
            <span
              aria-hidden
              className={cx(
                'flex size-[22px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-[var(--duration-fast)]',
                filled
                  ? 'bg-phone-primary border-2 border-phone-primary'
                  : 'border-2 border-phone-border-strong bg-transparent',
              )}
            >
              {filled ? (
                <svg viewBox="0 0 16 16" className="size-[12px] text-phone-primary-foreground" fill="none">
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

          <Link href={href} className="flex min-w-0 flex-1 flex-col gap-[2px] py-[2px]">
            <span
              className={cx(
                'truncate text-phone-body font-medium text-phone-text-primary transition-[color] duration-[var(--duration-fast)]',
                filled && 'text-phone-text-muted line-through',
              )}
            >
              {task.title}
            </span>
            <span className="flex min-h-[18px] items-center gap-[8px] text-phone-meta text-phone-text-secondary">
              {deadline ? <span className="truncate">{deadline}</span> : null}
              {marker.proof ? (
                <span className="inline-flex items-center gap-[2px]" aria-label="Proof needed">
                  <Paperclip aria-hidden className="size-[12px]" />
                </span>
              ) : null}
              {marker.checklist ? <span aria-label={`Checklist ${marker.checklist}`}>{marker.checklist}</span> : null}
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function formatDeadline(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** A skeleton row while the list loads (plan §5.1 "skeleton rows"). */
export function TaskPhoneRowSkeleton() {
  return (
    <div className="flex min-h-[48px] items-center gap-[4px] px-[16px] py-[10px]" aria-hidden>
      <span className="flex size-[44px] shrink-0 items-center justify-center">
        <span className="size-[22px] rounded-full bg-phone-surface-control" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[6px] py-[4px]">
        <span className="h-[14px] w-3/4 rounded-full bg-phone-surface-control" />
        <span className="h-[10px] w-1/3 rounded-full bg-phone-surface-control" />
      </div>
    </div>
  )
}
