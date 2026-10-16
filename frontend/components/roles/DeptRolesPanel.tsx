'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Briefcase, ChevronRight, Building2 } from 'lucide-react'
import { getRoles } from '@/lib/api/roles'
import { flattenTree, ancestorsOf } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import Button from '@/components/ui/button'
import { levelColors } from '@/lib/role-levels'
import RoleFormDrawer, { type RoleFormTarget } from './RoleFormDrawer'
import type { Department, Role } from '@/lib/types'

// ─── Role card ──────────────────────────────────────────────────────────────────
// Clickable (button) when editable; a plain div for read-only viewers.

function RoleCard({ role, onClick }: { role: Role; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="font-medium text-body text-text-primary">{role.title}</h4>
        <span
          className={[
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium capitalize',
            levelColors[role.level],
          ].join(' ')}
        >
          {role.level}
        </span>
      </div>
      {role.job_description && (
        <p className="text-meta text-text-secondary mt-1.5 line-clamp-2">{role.job_description}</p>
      )}
      <div className="flex gap-3 mt-2">
        {role.kra && role.kra.length > 0 && (
          <span className="text-meta text-text-muted">
            {role.kra.length} KRA{role.kra.length !== 1 ? 's' : ''}
          </span>
        )}
        {role.kpi && role.kpi.length > 0 && (
          <span className="text-meta text-text-muted">
            {role.kpi.length} KPI{role.kpi.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </>
  )

  if (!onClick) {
    return (
      <div className="bg-surface border border-border-light rounded-xl p-4">{body}</div>
    )
  }
  return (
    <button
      onClick={onClick}
      className="text-left bg-surface border border-border-light rounded-xl p-4 hover:border-border hover:shadow-xs transition-all"
    >
      {body}
    </button>
  )
}

interface DeptRolesPanelProps {
  departments: Department[]
  orgId: string
  canEdit: boolean
}

/**
 * Master-detail Roles view, shared by the settings page and the setup wizard.
 * Left: the department hierarchy as an indented, color-coded tree (so a role's
 * parent department — and that department's own parent — are always visible).
 * Right: the selected department's ancestor breadcrumb and its role cards.
 * Clicking a card (or "Add Role") opens the create/edit drawer.
 */
export default function DeptRolesPanel({ departments, orgId, canEdit }: DeptRolesPanelProps) {
  const flat = useMemo(() => flattenTree(departments), [departments])
  const colors = useMemo(() => computeNodeColors(departments), [departments])

  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loadingRoles, setLoadingRoles] = useState(false)
  const [drawerTarget, setDrawerTarget] = useState<RoleFormTarget | null>(null)

  // Default to the first department in tree order.
  useEffect(() => {
    if (selectedDeptId && departments.some((d) => d.id === selectedDeptId)) return
    setSelectedDeptId(flat[0]?.dept.id ?? null)
  }, [flat, departments, selectedDeptId])

  const loadRoles = useCallback(async () => {
    if (!orgId || !selectedDeptId) {
      setRoles([])
      return
    }
    setLoadingRoles(true)
    try {
      setRoles(await getRoles(orgId, selectedDeptId))
    } catch {
      setRoles([])
    } finally {
      setLoadingRoles(false)
    }
  }, [orgId, selectedDeptId])

  useEffect(() => {
    loadRoles()
  }, [loadRoles])

  const selectedDept = departments.find((d) => d.id === selectedDeptId) ?? null
  const breadcrumb = useMemo(
    () => (selectedDeptId ? ancestorsOf(departments, selectedDeptId) : []),
    [departments, selectedDeptId],
  )

  if (departments.length === 0) {
    return (
      <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
          <Building2 size={24} className="text-text-muted" />
        </div>
        <p className="font-medium text-text-primary">No departments yet</p>
        <p className="text-text-secondary text-body mt-1">
          Create departments in the org chart first — job roles live inside them.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col md:flex-row gap-4 min-h-[500px]">
        {/* Left: department tree */}
        <div className="md:w-[260px] shrink-0 bg-surface border border-border-light rounded-card overflow-hidden self-start w-full">
          <div className="px-4 py-3 border-b border-border-light">
            <p className="text-meta font-medium text-text-secondary uppercase tracking-wider">
              Departments
            </p>
          </div>
          <div className="flex flex-col py-1 max-h-[600px] overflow-y-auto">
            {flat.map(({ dept, depth }) => {
              const active = dept.id === selectedDeptId
              const swatch = colors[dept.id]?.base ?? 'var(--text-muted)'
              return (
                <button
                  key={dept.id}
                  onClick={() => setSelectedDeptId(dept.id)}
                  style={{ paddingLeft: 12 + depth * 16 }}
                  className={[
                    'flex items-center gap-2 pr-3 py-2.5 text-left transition-colors',
                    active ? 'bg-primary-subtle text-primary-text' : 'text-text-secondary hover:bg-surface-sunken',
                  ].join(' ')}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: swatch }}
                  />
                  <span className="text-body font-medium truncate flex-1">{dept.name}</span>
                  {typeof dept._count?.roles === 'number' && (
                    <span className="text-meta text-text-muted">{dept._count.roles}</span>
                  )}
                  {active && <ChevronRight size={14} className="shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: roles for the selected department */}
        <div className="flex-1 bg-surface border border-border-light rounded-card flex flex-col overflow-hidden">
          {!selectedDept ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
              <Briefcase size={28} className="text-text-muted" />
              <p className="text-body text-text-muted">Select a department to manage its job roles.</p>
            </div>
          ) : (
            <>
              {/* Header + breadcrumb */}
              <div className="flex items-start justify-between gap-3 px-4 py-4 border-b border-border-light">
                <div className="min-w-0">
                  {breadcrumb.length > 1 && (
                    <nav className="flex items-center flex-wrap gap-1 text-meta text-text-muted mb-1">
                      {breadcrumb.slice(0, -1).map((a) => (
                        <span key={a.id} className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedDeptId(a.id)}
                            className="hover:text-primary-text transition-colors"
                          >
                            {a.name}
                          </button>
                          <ChevronRight size={11} />
                        </span>
                      ))}
                      <span className="text-text-secondary font-medium">{selectedDept.name}</span>
                    </nav>
                  )}
                  <h3 className="font-medium text-text-primary truncate">{selectedDept.name}</h3>
                  <p className="text-meta text-text-muted mt-0.5">
                    {roles.length} job role{roles.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setDrawerTarget({ mode: 'create', deptId: selectedDept.id })}
                  >
                    <Plus size={14} /> Add Job Role
                  </Button>
                )}
              </div>

              {/* Role cards */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {loadingRoles ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-24 bg-surface-control-pressed rounded-xl animate-pulse" />
                  ))
                ) : roles.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12">
                    <Briefcase size={28} className="text-text-muted" />
                    <p className="text-body text-text-muted">No job roles in this department yet.</p>
                    {canEdit && (
                      <button
                        onClick={() => setDrawerTarget({ mode: 'create', deptId: selectedDept.id })}
                        className="text-body text-primary-text font-medium hover:text-primary-text"
                      >
                        Add the first job role
                      </button>
                    )}
                  </div>
                ) : (
                  roles.map((role) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      onClick={
                        canEdit ? () => setDrawerTarget({ mode: 'edit', role }) : undefined
                      }
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {canEdit && (
        <RoleFormDrawer
          target={drawerTarget}
          orgId={orgId}
          roles={roles}
          onClose={() => setDrawerTarget(null)}
          onSaved={() => {
            setDrawerTarget(null)
            loadRoles()
          }}
          onDeleted={() => {
            setDrawerTarget(null)
            loadRoles()
          }}
        />
      )}
    </>
  )
}
