'use client'

import { useMemo } from 'react'
import { Users, ChevronRight, Pencil, Network, CornerDownRight } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { flattenDepartmentTree, type FlatDept } from '@/lib/org-chart-layout'
import type { NodeColor } from '@/lib/org-chart-colors'
import type { Department } from '@/lib/types'

interface Props {
  departments: Department[]
  colorMap: Record<string, NodeColor>
  query: string
  canEdit: boolean
  onSelect: (d: Department) => void
  onEdit: (d: Department) => void
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Tabular view of the department hierarchy. Rows are ordered depth-first
 * (parent → its subtree → next parent) and indented by depth so the structure
 * stays legible without the org chart. Clicking a row opens its detail panel.
 */
export default function DeptTableView({
  departments,
  colorMap,
  query,
  canEdit,
  onSelect,
  onEdit,
}: Props) {
  const rows = useMemo(() => {
    const flat = flattenDepartmentTree(departments)
    const q = query.trim().toLowerCase()
    if (!q) return flat
    return flat.filter(({ department, parent }) => {
      const head = department.head_user?.name ?? ''
      return (
        department.name.toLowerCase().includes(q) ||
        head.toLowerCase().includes(q) ||
        (parent?.name ?? '').toLowerCase().includes(q)
      )
    })
  }, [departments, query])

  const columns: ResponsiveColumn<FlatDept>[] = [
    {
      key: 'name',
      header: 'Department',
      primary: true,
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ department, depth }) => {
        const base = colorMap[department.id]?.base ?? '#94A3B8'
        return (
          <div className="flex items-center min-w-0" style={{ paddingLeft: depth * 20 }}>
            {depth > 0 && (
              <CornerDownRight size={13} className="text-[#CBD5E1] mr-1.5 shrink-0" />
            )}
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 mr-2.5"
              style={{ backgroundColor: base }}
            />
            <span className="font-medium text-text-primary truncate">{department.name}</span>
          </div>
        )
      },
    },
    {
      key: 'head',
      header: 'Dept. Head',
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ department }) => {
        const name = department.head_user?.name
        if (!name) return <span className="text-text-muted">—</span>
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-full bg-surface-control-pressed text-text-secondary flex items-center justify-center text-[11px] font-bold shrink-0">
              {initials(name)}
            </span>
            <span className="text-text-primary truncate">{name}</span>
          </div>
        )
      },
    },
    {
      key: 'parent',
      header: 'Parent Dept.',
      desktopHiddenBelow: 'md',
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ parent }) =>
        parent ? (
          <span className="text-text-secondary">{parent.name}</span>
        ) : (
          <span className="inline-flex items-center rounded-[999px] bg-surface-control px-2.5 py-0.5 text-xs font-medium text-text-secondary">
            Top level
          </span>
        ),
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      desktopHiddenBelow: 'lg',
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ department }) => (
        <span className="inline-flex items-center gap-1.5 text-text-secondary">
          <Users size={13} className="text-text-muted" />
          {department._count?.employee_profiles ?? 0}
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      align: 'right',
      desktopHiddenBelow: 'lg',
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ department }) => (
        <span className="text-text-secondary">{department._count?.roles ?? 0}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      hideOnMobile: true,
      cellClassName: 'px-5 py-3.5',
      headerClassName: 'px-5 py-3.5',
      render: ({ department }) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(department)
              }}
              className="p-1.5 rounded-[6px] text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
              aria-label={`Edit ${department.name}`}
            >
              <Pencil size={14} />
            </button>
          )}
          <ChevronRight size={16} className="text-[#CBD5E1]" />
        </div>
      ),
    },
  ]

  return (
    <ResponsiveTable
      columns={columns}
      rows={rows}
      rowKey={({ department }) => department.id}
      onRowClick={({ department }) => onSelect(department)}
      emptyState={
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Network size={24} className="text-text-muted" />
          </div>
          <p className="font-semibold text-text-primary">No departments match your search</p>
          <p className="text-text-secondary text-sm mt-1">Try a different name.</p>
        </div>
      }
    />
  )
}
