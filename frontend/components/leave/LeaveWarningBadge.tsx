'use client'

import { CalendarOff } from 'lucide-react'
import type { LeaveAvailability, LeaveWindow } from '@/lib/types/leave'

interface Props {
  availability: LeaveAvailability | null
  /** The chosen deadline (ISO yyyy-mm-dd). */
  deadline: string
  /** Today (ISO yyyy-mm-dd); defaults to the local date. */
  today?: string
}

// ISO yyyy-mm-dd strings compare correctly with < / >.
const covers = (w: LeaveWindow, d: string) => w.start_date <= d && w.end_date >= d
const overlaps = (w: LeaveWindow, a: string, b: string) => w.start_date <= b && w.end_date >= a
const isPending = (w: LeaveWindow) => w.state === 'pending' && !w.overridden

/**
 * Soft, non-blocking notice that one or more selected assignees are on leave on the
 * deadline, or between now and the deadline. Mirrors HolidayWarningBadge styling but
 * never disables submission — the assigner can always go ahead.
 */
export default function LeaveWarningBadge({ availability, deadline, today }: Props) {
  if (!availability || !deadline || availability.results.length === 0) return null
  const now = today ?? new Date().toISOString().slice(0, 10)

  const onDeadline: string[] = []
  const before: string[] = []
  let anyPending = false

  for (const r of availability.results) {
    const coveringDeadline = r.windows.filter((w) => covers(w, deadline))
    const overlappingWindow = r.windows.filter((w) => overlaps(w, now, deadline))
    if (coveringDeadline.length > 0) {
      onDeadline.push(r.name)
      if (coveringDeadline.some(isPending)) anyPending = true
    } else if (overlappingWindow.length > 0) {
      before.push(r.name)
      if (overlappingWindow.some(isPending)) anyPending = true
    }
  }

  if (onDeadline.length === 0 && before.length === 0) return null

  return (
    <div className="flex items-start gap-2 mt-1.5 px-3 py-2 rounded-[8px] bg-warning-bg border border-warning-border">
      <CalendarOff size={14} className="text-warning shrink-0 mt-0.5" />
      <div className="text-xs text-warning font-medium space-y-0.5">
        {onDeadline.length > 0 && (
          <p>
            On the deadline: <span className="font-semibold">{onDeadline.join(', ')}</span>
            {onDeadline.length === 1 ? ' is' : ' are'} on leave.
          </p>
        )}
        {before.length > 0 && (
          <p>
            Before the deadline: <span className="font-semibold">{before.join(', ')}</span>
            {before.length === 1 ? ' is' : ' are'} on leave for part of the window.
          </p>
        )}
        <p className="font-normal text-warning">
          {anyPending ? 'Some leave is still pending approval. ' : ''}You can still assign — this is just a heads-up.
        </p>
      </div>
    </div>
  )
}
