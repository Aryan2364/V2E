'use client'

import { Button } from '@/components/ui/button'
import { useMemo } from 'react'
import { Plus, ChevronRight, Pencil, Briefcase } from 'lucide-react'
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
  onAddRole: (deptId: string) => void
}

/**
 * Roles grouped under the department hierarchy — the real tree this data has.
 * Each department row is indented by its depth (parent → child → grandchild),
 * with its roles nested one level deeper, ordered by seniority. This is the
 * full-width, uncramped successor to the old narrow master-detail rail.
 */
export default function RolesTreeView({
  roles,
  departments,
  query,
  canEdit,
  onSelect,
  onEdit,
  onAddRole,
}: Props) {
  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const flat = useMemo(() => flattenTree(departments), [departments])

  const rolesByDept = useMemo(() => {
    const m = new Map<string, Role[]>()
    for (const r of roles) {
      const arr = m.get(r.department_id)
      if (arr) arr.push(r)
      else m.set(r.department_id, [r])
    }
    m.forEach((arr) =>
      arr.sort((a, b) => rankOfLevel(a.level) - rankOfLevel(b.level) || a.title.localeCompare(b.title)),
    )
    return m
  }, [roles])

  const q = query.trim().toLowerCase()

  // Resolve which roles to show for a department under the current search.
  const visibleRoles = (dept: Department): Role[] => {
    const all = rolesByDept.get(dept.id) ?? []
    if (!q) return all
    if (dept.name.toLowerCase().includes(q)) return all
    return all.filter(
      (r) => r.title.toLowerCase().includes(q) || r.level.toLowerCase().includes(q),
    )
  }

  // When searching, hide departments that contribute no matching roles.
  const blocks = flat
    .map(({ dept, depth }) => ({ dept, depth, roles: visibleRoles(dept) }))
    .filter((b) => !q || b.roles.length > 0)

  if (blocks.length === 0) {
    return (
      <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
          <Briefcase size={24} className="text-text-muted" />
        </div>
        <p className="font-medium text-text-primary">
          {q ? 'No job roles match your search' : 'No job roles yet'}
        </p>
        <p className="text-text-secondary text-body mt-1">
          {q ? 'Try a different name, level, or department.' : 'Add a job role to get started.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden divide-y divide-surface-control">
      {blocks.map(({ dept, depth, roles: deptRoles }) => {
        const base = colors[dept.id]?.base ?? 'var(--text-muted)'
        return (
          <div key={dept.id}>
            {/* Department header */}
            <div
              className="flex items-center gap-2 px-4 py-2.5 bg-surface-sunken"
              style={{ paddingLeft: 16 + depth * 18 }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: base }} />
              <span className="text-body font-medium text-text-primary truncate">{dept.name}</span>
              <span className="text-meta text-text-muted">
                {deptRoles.length} job role{deptRoles.length !== 1 ? 's' : ''}
              </span>
              {canEdit && (
                <Button
                  type="button"
                  onClick={() => onAddRole(dept.id)}
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                >
                  <Plus size={13} /> Add job role
                </Button>
              )}
            </div>

            {/* Roles in this department */}
            {deptRoles.length === 0 ? (
              <p
                className="text-meta text-text-muted italic py-2.5"
                style={{ paddingLeft: 16 + (depth + 1) * 18 + 18 }}
              >
                No job roles in this department.
              </p>
            ) : (
              deptRoles.map((role) => (
                <button
                  key={role.id}
                  onClick={() => onSelect(role)}
                  style={{ paddingLeft: 16 + (depth + 1) * 18 + 18 }}
                  className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring group w-full flex items-center gap-3 pr-4 py-2.5 text-left hover:bg-surface-sunken transition-colors"
                >
                  <span className="font-medium text-body text-text-primary truncate">{role.title}</span>
                  <span
                    className={[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium capitalize shrink-0',
                      levelColors[role.level],
                    ].join(' ')}
                  >
                    {role.level}
                  </span>
                  <span className="text-meta text-text-muted shrink-0 hidden sm:inline">
                    {role.kra?.length ?? 0} KRA · {role.kpi?.length ?? 0} KPI
                  </span>
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    {canEdit && (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(role)
                        }}
                        className="p-1.5 rounded-md text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-surface-control transition-all"
                        aria-label={`Edit ${role.title}`}
                      >
                        <Pencil size={13} />
                      </span>
                    )}
                    <ChevronRight size={15} className="text-text-muted" />
                  </span>
                </button>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}
