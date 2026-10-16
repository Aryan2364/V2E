'use client'

import React, { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { DashboardBreakdownItem } from '@/lib/types/tasks'
import { type DeptForest, type DeptNode, rollupNode } from '@/lib/tasks/dept-tree'
import TimingMiniBar from './TimingMiniBar'
import TimingLegend from './TimingLegend'

export type BreakdownDim = 'dept' | 'role' | 'person'

/**
 * Drilled Departments view: completion timing broken out by the drilled unit's immediate
 * sub-departments (each rolled up over its own subtree), the job roles, or the individual
 * people doing the work. Sub-departments with children drill deeper; leaves, roles and
 * people open the task list for that slice.
 */
export default function DeptBreakdownChart({
  node,
  byDept,
  byRole,
  byAssignee,
  dim,
  onDim,
  onDrill,
  onSegment,
}: {
  node: DeptNode
  byDept: DashboardBreakdownItem[]
  byRole: DashboardBreakdownItem[]
  byAssignee: DashboardBreakdownItem[]
  dim: BreakdownDim
  onDim: (d: BreakdownDim) => void
  onDrill: (deptId: string) => void
  onSegment: (kind: BreakdownDim, id: string, label: string) => void
}) {
  type Row = { id: string | null; label: string; total: number; timing: typeof byRole[number]['timing']; drillable: boolean }

  const subRows = useMemo<Row[]>(() => {
    const map = new Map(byDept.map((d) => [d.id ?? '', { total: d.total, timing: d.timing }]))
    return node.children
      .map((c) => rollupNode(c, map))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({ id: r.id, label: r.name, total: r.total, timing: r.timing, drillable: r.hasChildren }))
  }, [node, byDept])

  const roleRows = useMemo<Row[]>(
    () => byRole.filter((r) => r.total > 0).slice().sort((a, b) => b.total - a.total)
      .map((r) => ({ id: r.id, label: r.label, total: r.total, timing: r.timing, drillable: false })),
    [byRole],
  )

  const personRows = useMemo<Row[]>(
    () => byAssignee.filter((r) => r.total > 0).slice().sort((a, b) => b.total - a.total)
      .map((r) => ({ id: r.id, label: r.label, total: r.total, timing: r.timing, drillable: false })),
    [byAssignee],
  )

  const hasSubDepts = node.children.length > 0
  const rows = dim === 'dept' ? subRows : dim === 'role' ? roleRows : personRows

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex flex-col h-[460px]">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0 gap-2">
        <h3 className="text-[15px] font-semibold text-text-primary truncate">
          {node.name} — {dim === 'dept' ? 'by sub-department' : dim === 'role' ? 'by job role' : 'by person'}
        </h3>
        <div className="inline-flex rounded-[6px] p-0.5 bg-surface-control border border-border-light shrink-0">
          {([['dept', 'Sub-dept'], ['role', 'Job role'], ['person', 'Person']] as [BreakdownDim, string][]).map(([key, lbl]) => {
            const disabled = key === 'dept' && !hasSubDepts
            const active = dim === key
            return (
              <button
                key={key}
                onClick={() => !disabled && onDim(key)}
                disabled={disabled}
                className={`text-xs font-semibold rounded-[5px] px-2.5 py-1 transition-colors ${
                  active ? 'bg-primary text-white' : disabled ? 'text-[#CBD5E1] cursor-not-allowed' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {lbl}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-2.5">
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary py-10 text-center">
            {dim === 'dept' ? 'No sub-department work here.' : dim === 'role' ? 'No role data for this unit.' : 'No people with work here.'}
          </p>
        ) : (
          rows.map((r) => {
            const id = r.id ?? '__none__'
            const overdueRate = r.total ? Math.round((r.timing.overdue / r.total) * 100) : 0
            const drillable = r.drillable
            const onClick = () =>
              drillable ? onDrill(id) : onSegment(dim, id, r.label)
            return (
              <button
                key={id}
                onClick={onClick}
                className="w-full text-left rounded-[10px] border border-border-light px-3.5 py-3 hover:border-primary hover:bg-surface-sunken transition-colors group"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="font-semibold text-sm text-text-primary truncate flex items-center gap-1.5">
                    {r.label}
                    {drillable && <ChevronRight size={14} className="text-text-muted group-hover:text-primary-text" />}
                  </span>
                  <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: overdueRate >= 25 ? '#DC2626' : '#475569' }}>
                    <span className="font-bold">{overdueRate}%</span> overdue · {r.total}
                  </span>
                </div>
                <TimingMiniBar timing={r.timing} />
              </button>
            )
          })
        )}
      </div>
      <div className="px-4 py-3 border-t border-border-light shrink-0">
        <TimingLegend />
      </div>
    </div>
  )
}
