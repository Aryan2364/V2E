'use client'

import React from 'react'
import { Send } from 'lucide-react'
import type { WorkFlow } from '@/lib/types/tasks'
import TimingMiniBar from './TimingMiniBar'
import TimingLegend from './TimingLegend'

/**
 * Delegation accountability — "work you / your team handed to others". If delegated work
 * slips, it comes back on you, so Open and Overdue are the numbers to chase. Each stat opens
 * the matching task slice. `kind` distinguishes "by you" (Own) vs "by your team" (Team).
 */
export default function DelegationPanel({
  delegated,
  outgoing,
  scopeLabel,
  onSelect,
}: {
  delegated: WorkFlow['delegated']
  outgoing?: WorkFlow['outgoing']
  scopeLabel: string // e.g. "you" / "your team"
  onSelect?: (kind: 'all' | 'open' | 'overdue') => void
}) {
  const Stat = ({ label, value, kind, danger }: { label: string; value: number; kind: 'all' | 'open' | 'overdue'; danger?: boolean }) => {
    const Tag = onSelect ? 'button' : 'div'
    return (
      <Tag
        {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(kind) } : {})}
        className={`text-left rounded-lg border px-4 py-3 transition-colors ${onSelect ? 'hover:border-primary hover:bg-surface' : ''}`}
        style={{ borderColor: danger && value > 0 ? 'var(--danger-bg)' : 'var(--border-light)', background: danger && value > 0 ? 'var(--danger-bg)' : 'var(--surface)' }}
      >
        <div className="text-2xl font-medium tabular-nums leading-none" style={{ color: danger && value > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{value}</div>
        <div className="text-[13px] text-text-secondary mt-1">{label}</div>
      </Tag>
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-primary-subtle text-primary-text grid place-items-center"><Send size={15} /></span>
        <h3 className="text-[15px] font-medium text-text-primary">Work {scopeLabel} delegated</h3>
      </div>
      <div className="grid grid-cols-3 gap-2.5 mb-3">
        <Stat label="Assigned out" value={delegated.total} kind="all" />
        <Stat label="Still open" value={delegated.open} kind="open" />
        <Stat label="Overdue" value={delegated.overdue} kind="overdue" danger />
      </div>
      <TimingMiniBar timing={delegated.timing} />
      <TimingLegend className="mt-3" />
      {outgoing && outgoing.by_dept.length > 0 && (
        <p className="text-xs text-text-secondary mt-3">
          Pushed outside your control to {outgoing.by_dept.length} department{outgoing.by_dept.length > 1 ? 's' : ''} —
          <span className="font-medium text-danger"> {outgoing.overdue} overdue</span>. If these stall, they block your team.
        </p>
      )}
    </div>
  )
}
