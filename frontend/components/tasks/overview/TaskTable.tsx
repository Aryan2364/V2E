'use client'

import React from 'react'
import { ArrowDown, ArrowUp, CheckSquare } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'
import { Button } from '@/components/ui/button'
import EmployeePicker, { type EmployeePickerOption } from '@/components/ui/EmployeePicker'
import TagList from '@/components/tasks/TagList'
import WorkflowTaskBadge, { taskWorkflow } from '@/components/tasks/WorkflowTaskBadge'
import TagSelect from './TagSelect'
import {
  TIMINGS, TIMING_META, taskTiming,
  type Task, type TaskStatus, type TaskPriority, type TaskCategory,
} from '@/lib/types/tasks'
import type { Department } from '@/lib/types'

export type TableFilterKey = 'type' | 'department_id' | 'category_id' | 'priority_id' | 'status_id' | 'timing'
export type TableFilters = Record<TableFilterKey, string>

function fmt(d?: string) {
  if (!d) return '—'
  const date = new Date(d)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

function Badge({ label, color }: { label: string; color?: string }) {
  const c = color || 'var(--text-secondary)'
  return (
    <span className="inline-block text-meta font-medium rounded-full px-2 py-0.5 whitespace-nowrap" style={{ backgroundColor: c + '22', color: c }}>
      {label}
    </span>
  )
}

/**
 * Dense, filterable task table. Column titles sit on top; a filter row sits directly under
 * them with a compact native select per filterable column, so several filters can be active
 * at once (e.g. High priority + Sales dept + Not Started). Active filters also surface as
 * removable chips above the table (rendered by the page).
 *
 * Tags take several values, so their header filter is the tag multi-select (any of the
 * chosen tags) rather than a TableFilterKey select; it writes the same page state as the
 * filter panel's Tags field.
 */
export default function TaskTable({
  orgId,
  rows,
  loading,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenTask,
  departments,
  categories,
  priorities,
  statuses,
  employees,
  currentUser,
  assigneeUserId,
  createdByUserId,
  onAssigneeFilter,
  onAssignerFilter,
  filters,
  onFilter,
  tagIds,
  onTagFilter,
  sortDir,
  onToggleDeadlineSort,
}: {
  orgId: string
  rows: Task[]
  loading: boolean
  total: number
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpenTask: (id: string) => void
  departments: Department[]
  categories: TaskCategory[]
  priorities: TaskPriority[]
  statuses: TaskStatus[]
  employees: EmployeePickerOption[]
  currentUser?: { user_id: string; name: string }
  assigneeUserId: string
  createdByUserId: string
  onAssigneeFilter: (value: string) => void
  onAssignerFilter: (value: string) => void
  filters: TableFilters
  onFilter: (key: TableFilterKey, value: string) => void
  /** Tag filter (matches any of these tags). */
  tagIds: string[]
  onTagFilter: (ids: string[]) => void
  sortDir: 'asc' | 'desc' | null
  onToggleDeadlineSort: () => void
}) {
  const deptName = new Map(departments.map((d) => [d.id, d.name]))

  const assignees = (t: Task) => (t.assignees ?? []).filter((a) => !a.is_cc)
  const assigneeLabel = (t: Task) => {
    const a = assignees(t)
    if (!a.length) return '—'
    const names = a.map((x) => x.user?.name ?? x.user_name ?? 'Unknown')
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  }

  const filterCell = (key: TableFilterKey, allLabel: string, options: { value: string; label: string; color?: string }[]) => (
    <StyledSelect
      value={filters[key]}
      onChange={(v) => onFilter(key, v)}
      placeholder={allLabel}
      wrapperClassName="w-full"
      triggerClassName="py-1! text-meta!"
      options={[{ value: '', label: allLabel }, ...options]}
    />
  )

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-body border-collapse">
          <thead>
            <tr className="bg-surface-sunken border-b border-border-light">
              <Th>Task</Th>
              <Th>Description</Th>
              <Th>Assigned To</Th>
              <Th>Assigned By</Th>
              <Th>Department</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Timing</Th>
              <Th>
                <button onClick={onToggleDeadlineSort} className="inline-flex items-center gap-1 hover:text-text-primary">
                  Deadline
                  {sortDir === 'asc' ? <ArrowUp size={12} /> : sortDir === 'desc' ? <ArrowDown size={12} /> : null}
                </button>
              </Th>
            </tr>
            {/* Filter row — multiple filters can be active simultaneously. */}
            <tr className="bg-surface border-b border-border-light">
              <td className="px-3 py-2 align-top min-w-[150px]">
                {filterCell('type', 'All types', [{ value: 'one_time', label: 'One-time' }, { value: 'recurring', label: 'Recurring' }, { value: 'workflow', label: 'From workflows' }])}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 align-top min-w-[150px]">
                <EmployeePicker
                  size="sm"
                  value={assigneeUserId}
                  onChange={onAssigneeFilter}
                  employees={employees}
                  title="Filter by assignee"
                  placeholder="Anyone"
                  currentUser={currentUser}
                  allowClear
                />
              </td>
              <td className="px-3 py-2 align-top min-w-[150px]">
                <EmployeePicker
                  size="sm"
                  value={createdByUserId}
                  onChange={onAssignerFilter}
                  employees={employees}
                  title="Filter by assigner"
                  placeholder="Anyone"
                  currentUser={currentUser}
                  allowClear
                />
              </td>
              <td className="px-3 py-2 align-top min-w-[140px]">
                {filterCell('department_id', 'All depts', departments.map((d) => ({ value: d.id, label: d.name })))}
              </td>
              <td className="px-3 py-2 align-top min-w-[130px]">
                {filterCell('category_id', 'All', categories.map((c) => ({ value: c.id, label: c.name, color: c.color })))}
              </td>
              <td className="px-3 py-2 align-top min-w-[180px]">
                <TagSelect orgId={orgId} value={tagIds} onChange={onTagFilter} placeholder="All" />
              </td>
              <td className="px-3 py-2 align-top min-w-[120px]">
                {filterCell('priority_id', 'All', priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })))}
              </td>
              <td className="px-3 py-2 align-top min-w-[130px]">
                {filterCell('status_id', 'All', statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })))}
              </td>
              <td className="px-3 py-2 align-top min-w-[130px]">
                {filterCell('timing', 'All', TIMINGS.map((t) => ({ value: t, label: TIMING_META[t].label })))}
              </td>
              <td className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-12 text-center"><div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mx-auto mb-3"><CheckSquare size={20} className="text-text-muted" /></div>
                  <p className="font-medium text-text-primary">No tasks match these filters</p>
                  <p className="text-label text-text-secondary mt-1">Clear a filter to widen the view.</p>
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const timing = taskTiming(t)
                const overdue = timing === 'overdue'
                return (
                  <tr key={t.id} onClick={() => onOpenTask(t.id)} className="border-b border-border-light hover:bg-primary-subtle cursor-pointer transition-colors">
                    <td className="px-3 py-2.5 align-top max-w-[240px]">
                      <div className="font-medium text-text-primary truncate">{t.title}</div>
                      <div className="text-meta text-text-muted">{t.type === 'recurring' ? 'Recurring' : 'One-time'}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top max-w-[260px]">
                      <div className="text-body text-text-secondary line-clamp-2">{t.description || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-text-primary whitespace-nowrap">{assigneeLabel(t)}</td>
                    <td className="px-3 py-2.5 align-top text-text-secondary whitespace-nowrap">
                      {(() => {
                        const wf = taskWorkflow(t)
                        return wf ? <WorkflowTaskBadge workflow={wf} /> : t.created_by?.name ?? '—'
                      })()}
                    </td>
                    <td className="px-3 py-2.5 align-top text-text-secondary whitespace-nowrap">{(t.department_id && deptName.get(t.department_id)) || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-text-secondary whitespace-nowrap">{t.category?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top">
                      {t.tags?.length ? <TagList tags={t.tags} max={2} /> : <span className="text-text-secondary">—</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top">{t.priority ? <Badge label={t.priority.label} color={t.priority.color} /> : '—'}</td>
                    <td className="px-3 py-2.5 align-top">{t.status ? <Badge label={t.status.label} color={t.status.color} /> : '—'}</td>
                    <td className="px-3 py-2.5 align-top whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-meta font-medium" style={{ color: TIMING_META[timing].color }}>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIMING_META[timing].color }} />
                        {TIMING_META[timing].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top whitespace-nowrap tabular-nums" style={{ color: overdue ? 'var(--danger)' : 'var(--text-secondary)' }}>{fmt(t.deadline)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-border-light bg-surface-sunken">
        <span className="text-meta text-text-secondary"><span className="font-medium text-text-primary tabular-nums">{total}</span> task{total !== 1 ? 's' : ''}</span>
        {hasMore && (
          <Button variant="secondary" size="sm" onClick={onLoadMore} loading={loadingMore}>
            {`Load more (${total - rows.length} left)`}
          </Button>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-medium text-meta text-text-secondary px-3 py-2.5 whitespace-nowrap select-none">{children}</th>
}
