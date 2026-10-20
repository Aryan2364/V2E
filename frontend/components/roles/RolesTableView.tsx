'use client'

import { useMemo } from 'react'
import { ChevronRight, Pencil, Briefcase } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { flattenTree } from '@/lib/dept-tree'
import { levelColors, rankOfLevel } from '@/lib/role-levels'
import { computeNodeColors } from '@/lib/org-chart-colors'
import type { Department, Role } from '@/lib/types'

interface Props {
  roles: Role[]
  departments: Department[]
  query: string
  canEdit: boolean
  onSelect: (r: Role) => void
  onEdit: (r: Role) => void
}

/**
 * Flat, sortable table of every role in the org. Default order follows the
 * department tree, then seniority (head → junior), then title — so the table
 * reads top-down like the org without losing scan-ability.
 */
export default function RolesTableView({
  roles,
  departments,
  query,
  canEdit,
  onSelect,
  onEdit,
}: Props) {
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const colors = useMemo(() => computeNodeColors(departments), [departments])
  // Department position in tree order, for the primary sort key.
  const deptOrder = useMemo(() => {
    const m = new Map<string, number>()
    flattenTree(departments).forEach(({ dept }, i) => m.set(dept.id, i))
    return m
  }, [departments])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...roles].sort((a, b) => {
      const da = deptOrder.get(a.department_id) ?? 999
      const db = deptOrder.get(b.department_id) ?? 999
      if (da !== db) return da - db
      const ra = rankOfLevel(a.level)
      const rb = rankOfLevel(b.level)
      if (ra !== rb) return ra - rb
      return a.title.localeCompare(b.title)
    })
    if (!q) return sorted
    return sorted.filter((r) => {
      const dept = deptById.get(r.department_id)?.name ?? ''
      return (
        r.title.toLowerCase().includes(q) ||
        dept.toLowerCase().includes(q) ||
        r.level.toLowerCase().includes(q)
      )
    })
  }, [roles, query, deptOrder, deptById])

  const columns: ResponsiveColumn<Role>[] = [
    {
      key: 'title',
      header: 'Job Role',
      primary: true,
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => <span className="font-medium text-text-primary">{r.title}</span>,
    },
    {
      key: 'level',
      header: 'Level',
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => (
        <span
          className={[
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium capitalize',
            levelColors[r.level],
          ].join(' ')}
        >
          {r.level}
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      desktopHiddenBelow: 'md',
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => {
        const dept = deptById.get(r.department_id)
        const base = colors[r.department_id]?.base ?? 'var(--text-muted)'
        return (
          <span className="inline-flex items-center gap-2 text-text-secondary">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: base }} />
            {dept?.name ?? '—'}
          </span>
        )
      },
    },
    {
      key: 'kra',
      header: 'KRAs',
      align: 'right',
      desktopHiddenBelow: 'lg',
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => <span className="text-text-secondary">{r.kra?.length ?? 0}</span>,
    },
    {
      key: 'kpi',
      header: 'KPIs',
      align: 'right',
      desktopHiddenBelow: 'lg',
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => <span className="text-text-secondary">{r.kpi?.length ?? 0}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      hideOnMobile: true,
      cellClassName: 'px-4 py-3.5',
      headerClassName: 'px-4 py-3.5',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(r)
              }}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
              aria-label={`Edit ${r.title}`}
            >
              <Pencil size={14} />
            </button>
          )}
          <ChevronRight size={16} className="text-text-muted" />
        </div>
      ),
    },
  ]

  return (
    <ResponsiveTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      fill
      onRowClick={(r) => onSelect(r)}
      emptyState={
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Briefcase size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">
            {query.trim() ? 'No job roles match your search' : 'No job roles yet'}
          </p>
          <p className="text-text-secondary text-body mt-1">
            {query.trim() ? 'Try a different name, level, or department.' : 'Add a job role to get started.'}
          </p>
        </div>
      }
    />
  )
}
