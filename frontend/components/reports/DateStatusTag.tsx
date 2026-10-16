import React from 'react'
import type { EntryDateStatus, HandoverInfo } from '@/lib/types/reports'
import { formatDate } from '@/lib/format'

// Where a task stands TODAY, from the dates — a coloured tag next to the work stage.
// A task past its due date and not finished always carries the red Overdue tag, no
// matter what stage the person left it in.
const STYLE: Record<EntryDateStatus, { label: string; bg: string; fg: string; border: string }> = {
  completed: { label: 'Completed', bg: 'var(--success-bg)', fg: 'var(--success)', border: 'var(--success-border)' },
  overdue: { label: 'Overdue', bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'var(--danger-border)' },
  in_progress: { label: 'In Progress', bg: 'var(--primary-subtle)', fg: 'var(--primary-text)', border: 'var(--primary-border)' },
  not_yet_due: { label: 'Not Yet Due', bg: 'var(--surface-control)', fg: 'var(--text-muted)', border: 'var(--border-light)' },
  closed: { label: 'Closed', bg: 'var(--surface-control)', fg: 'var(--text-muted)', border: 'var(--border-light)' },
  // Deliberately NOT red. The work left this person; showing it in the overdue colour
  // is what made readers chase the wrong name. Slate = "closed on them, look elsewhere",
  // with the frozen lateness and the new owner spelled out beside it.
  handed_over: { label: 'Handed over', bg: 'var(--surface-control)', fg: 'var(--text-secondary)', border: 'var(--border)' },
}

export function DateStatusTag({
  status,
  daysLate,
  handover,
}: {
  status: EntryDateStatus
  daysLate?: number | null
  handover?: HandoverInfo | null
}) {
  const s = STYLE[status] ?? STYLE.not_yet_due
  const showDays = status === 'overdue' && daysLate != null && daysLate > 0

  // A handed-over entry has to answer two questions in the tag itself, or the reader
  // is left chasing someone who no longer has the work: how late was it when they let
  // it go, and who holds it now.
  if (status === 'handed_over' && handover) {
    const late = handover.days_late_at_handover
    const to = handover.to.length ? handover.to.join(', ') : 'no one'
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap"
        style={{ backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
        title={
          `Taken off this person on ${fmt(handover.at)}` +
          (late != null && late > 0
            ? `, ${late} ${late === 1 ? 'day' : 'days'} late at that point — the delay stays on their record, frozen at the handover`
            : ', before it came due — not counted against them') +
          `. Now with ${to}. It is no longer pending on this person, so it is excluded from their pending and overdue figures.`
        }
      >
        {late != null && late > 0 ? `Was ${late} ${late === 1 ? 'day' : 'days'} late` : 'Handed over'}
        <span className="font-normal">· now with {to}</span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
    >
      {s.label}
      {showDays && <span className="font-medium">· {daysLate} {daysLate === 1 ? 'day' : 'days'} late</span>}
    </span>
  )
}

function fmt(iso: string): string {
  return formatDate(iso) || iso
}
