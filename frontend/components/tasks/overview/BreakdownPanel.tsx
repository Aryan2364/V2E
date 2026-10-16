'use client'

import React from 'react'
import type { TaskDashboard, DashboardBreakdownItem } from '@/lib/types/tasks'

export type BreakdownDim = 'status' | 'priority' | 'category' | 'department' | 'type' | 'assignee' | 'assigner'

export interface BreakdownSelection {
  status_id?: string
  priority_id?: string
  category_id?: string
  department_id?: string
  type?: string
  assignee_user_id?: string
  created_by_user_id?: string
}

const DIM_KEY: Record<BreakdownDim, keyof BreakdownSelection> = {
  status: 'status_id',
  priority: 'priority_id',
  category: 'category_id',
  department: 'department_id',
  type: 'type',
  assignee: 'assignee_user_id',
  assigner: 'created_by_user_id',
}

function BreakdownCard({
  title,
  items,
  activeId,
  defaultColor,
  onToggle,
}: {
  title: string
  items: DashboardBreakdownItem[]
  activeId?: string
  defaultColor: string
  onToggle: (id: string | null) => void
}) {
  if (!items.length) return null
  const max = Math.max(...items.map((i) => i.total), 1)
  const top = items.slice(0, 7)

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4">
      <p className="text-[13px] font-medium text-text-primary mb-3">{title}</p>
      <div className="space-y-2">
        {top.map((it) => {
          const id = it.id ?? '__none__'
          const isActive = activeId != null && activeId === it.id
          const color = it.color || defaultColor
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(isActive ? null : (it.id ?? null))}
              className={`w-full text-left group rounded-lg px-2 py-1.5 transition-colors ${isActive ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[13px] truncate ${isActive ? 'font-medium text-primary-text' : 'text-text-secondary group-hover:text-text-primary'}`}>
                  {it.label}
                </span>
                <span className="text-[12px] font-medium tabular-nums text-text-secondary shrink-0">{it.total}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-control overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(it.total / max) * 100}%`, backgroundColor: color }} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Power-BI-style slicer panel. Each dimension is a clickable bar list; clicking a bar
 * sets that dimension's filter (and re-slices the whole board). The clicked dimension's
 * own bars stay visible so the selection reads clearly.
 */
export default function BreakdownPanel({
  data,
  selection,
  onChange,
}: {
  data: TaskDashboard
  selection: BreakdownSelection
  onChange: (key: keyof BreakdownSelection, value: string | null) => void
}) {
  const set = (dim: BreakdownDim) => (id: string | null) => onChange(DIM_KEY[dim], id)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <BreakdownCard title="By Status" items={data.by_status} activeId={selection.status_id} defaultColor="var(--primary-text)" onToggle={set('status')} />
      <BreakdownCard title="By Priority" items={data.by_priority} activeId={selection.priority_id} defaultColor="var(--warning)" onToggle={set('priority')} />
      <BreakdownCard title="By Category" items={data.by_category} activeId={selection.category_id} defaultColor="var(--text-secondary)" onToggle={set('category')} />
      <BreakdownCard title="By Department" items={data.by_department} activeId={selection.department_id} defaultColor="var(--text-secondary)" onToggle={set('department')} />
      <BreakdownCard title="Assigned to (workload)" items={data.by_assignee} activeId={selection.assignee_user_id} defaultColor="var(--primary-text)" onToggle={set('assignee')} />
      <BreakdownCard title="Assigned by (delegation)" items={data.by_assigner} activeId={selection.created_by_user_id} defaultColor="var(--success)" onToggle={set('assigner')} />
    </div>
  )
}
