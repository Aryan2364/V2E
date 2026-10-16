'use client'

import type { Leave } from '@/lib/types/leave'

// Severity/label derived from state + origin + overridden, matching the design-system
// status palette. "Effective" leaves (counted as on-leave) read amber/green; rejected
// and cancelled read red/gray.
function describe(l: Pick<Leave, 'state' | 'origin' | 'overridden'>): { label: string; cls: string } {
  if (l.state === 'cancelled') return { label: 'Cancelled', cls: 'bg-surface-control text-text-secondary border-border-light' }
  if (l.state === 'rejected') {
    return l.overridden
      ? { label: 'Taken despite rejection', cls: 'bg-surface-control text-text-secondary border-border-light' }
      : { label: 'Rejected', cls: 'bg-danger-bg text-danger border-danger-border' }
  }
  if (l.state === 'pending') return { label: 'Pending', cls: 'bg-warning-bg text-warning border-warning-border' }
  // approved
  if (l.origin === 'self_declared') return { label: 'Self-declared', cls: 'bg-warning-bg text-warning border-warning-border' }
  return { label: 'Approved', cls: 'bg-success-bg text-success border-success-border' }
}

export default function LeaveStateBadge({ leave }: { leave: Pick<Leave, 'state' | 'origin' | 'overridden'> }) {
  const { label, cls } = describe(leave)
  return (
    <span className={`text-meta font-medium rounded-full px-2 py-0.5 border whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}
