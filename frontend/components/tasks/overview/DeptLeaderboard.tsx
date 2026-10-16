'use client'

import React, { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { DashboardBreakdownItem } from '@/lib/types/tasks'
import { type DeptForest, rollupNode } from '@/lib/tasks/dept-tree'
import TimingMiniBar from './TimingMiniBar'
import TimingLegend from './TimingLegend'

/**
 * Root Departments view: every top-level reporting unit, ranked by attention needed
 * (overdue share), each showing a subtree-rolled-up timing bar. Click a unit to drill in.
 */
export default function DeptLeaderboard({
  byDept,
  forest,
  onDrill,
}: {
  byDept: DashboardBreakdownItem[]
  forest: DeptForest
  onDrill: (deptId: string) => void
}) {
  const units = useMemo(() => {
    const map = new Map(byDept.map((d) => [d.id ?? '', { total: d.total, timing: d.timing }]))
    return forest.roots
      .map((n) => rollupNode(n, map))
      .filter((u) => u.total > 0)
      .map((u) => ({ ...u, overdueRate: u.total ? Math.round((u.timing.overdue / u.total) * 100) : 0 }))
      .sort((a, b) => b.overdueRate - a.overdueRate || b.total - a.total)
  }, [byDept, forest])

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card flex flex-col h-[460px]">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <h3 className="text-[15px] font-medium text-text-primary">Reporting units · completion timing</h3>
        <span className="text-xs text-text-muted">ordered by attention needed</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-2.5">
        {units.length === 0 ? (
          <p className="text-sm text-text-secondary py-12 text-center">No departmental work in this view.</p>
        ) : (
          units.map((u) => (
            <button
              key={u.id}
              onClick={() => onDrill(u.id)}
              className="w-full text-left rounded-lg border border-border-light px-3.5 py-3 hover:border-primary hover:bg-surface-sunken transition-colors group"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="font-medium text-sm text-text-primary truncate flex items-center gap-1.5">
                  {u.name}
                  <ChevronRight size={14} className="text-text-muted group-hover:text-primary-text" />
                </span>
                <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: u.overdueRate >= 25 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                  <span className="font-medium">{u.overdueRate}%</span> overdue · {u.total} tasks
                </span>
              </div>
              <TimingMiniBar timing={u.timing} />
            </button>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-border-light shrink-0">
        <TimingLegend />
      </div>
    </div>
  )
}
