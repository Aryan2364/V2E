'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import { Search, Plus, Upload, Building2 } from 'lucide-react'
import ViewToggle, { type ViewMode } from '@/components/ui/ViewToggle'
import RolesTableView from '@/components/roles/RolesTableView'
import RolesTreeView from '@/components/roles/RolesTreeView'
import RoleInfoPanel from '@/components/roles/RoleInfoPanel'
import RoleFormDrawer, { type RoleFormTarget } from '@/components/roles/RoleFormDrawer'
import ImportJobRolesModal from '@/components/roles/ImportJobRolesModal'
import type { Department, Role } from '@/lib/types'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const canEdit = !!user?.is_admin

  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Role | null>(null)
  const [formTarget, setFormTarget] = useState<RoleFormTarget | null>(null)
  const [showImport, setShowImport] = useState(false)

  const reloadRoles = useCallback(async () => {
    if (!orgId) return
    try {
      setRoles(await getRoles(orgId))
    } catch {
      setRoles([])
    }
  }, [orgId])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    Promise.all([
      getDepartments(orgId).catch(() => [] as Department[]),
      getRoles(orgId).catch(() => [] as Role[]),
    ])
      .then(([depts, rls]) => {
        setDepartments(depts)
        setRoles(rls)
      })
      .finally(() => setLoading(false))
  }, [orgId])

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  // Keep the open read panel in sync with refreshed data.
  const selectedLive = selected ? roles.find((r) => r.id === selected.id) ?? null : null

  const matchCount = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return roles.length
    return roles.filter((r) => {
      const dept = deptById.get(r.department_id)?.name ?? ''
      return (
        r.title.toLowerCase().includes(q) ||
        r.level.toLowerCase().includes(q) ||
        dept.toLowerCase().includes(q)
      )
    }).length
  }, [query, roles, deptById])

  const openEdit = useCallback((role: Role) => {
    setSelected(null)
    setFormTarget({ mode: 'edit', role })
  }, [])

  const handleSaved = useCallback(() => {
    setFormTarget(null)
    reloadRoles()
  }, [reloadRoles])

  const handleDeleted = useCallback(() => {
    setFormTarget(null)
    setSelected(null)
    reloadRoles()
  }, [reloadRoles])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const noDepartments = departments.length === 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight">Job Roles</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Every job role across the organisation, with its KRAs and KPIs.
          </p>
        </div>
        {canEdit && !noDepartments && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-primary-text bg-white border-2 border-primary hover:bg-primary-subtle transition-colors"
            >
              <Upload size={16} />
              Import
            </button>
            <button
              onClick={() => setFormTarget({ mode: 'create' })}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition-colors"
            >
              <Plus size={16} />
              Add Job Role
            </button>
          </div>
        )}
      </div>

      {noDepartments ? (
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Building2 size={24} className="text-text-muted" />
          </div>
          <p className="font-semibold text-text-primary">No departments yet</p>
          <p className="text-text-secondary text-sm mt-1">
            Create departments in the org chart first — job roles live inside them.
          </p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search job roles, levels, departments…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-[10px] text-sm rounded-[8px] border border-border focus:border-primary focus:outline-hidden bg-white text-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* Count + view toggle */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {query.trim()
                ? `${matchCount} of ${roles.length} job roles`
                : `${roles.length} job role${roles.length !== 1 ? 's' : ''}`}
            </p>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {/* Table / Tree */}
          {view === 'table' ? (
            <RolesTableView
              roles={roles}
              departments={departments}
              query={query}
              canEdit={canEdit}
              onSelect={setSelected}
              onEdit={openEdit}
            />
          ) : (
            <RolesTreeView
              roles={roles}
              departments={departments}
              query={query}
              canEdit={canEdit}
              onSelect={setSelected}
              onEdit={openEdit}
              onAddRole={(deptId) => setFormTarget({ mode: 'create', deptId })}
            />
          )}
        </>
      )}

      {/* Read-only detail panel */}
      <RoleInfoPanel
        role={selectedLive}
        departmentName={selectedLive ? deptById.get(selectedLive.department_id)?.name : undefined}
        canEdit={canEdit}
        onEdit={openEdit}
        onClose={() => setSelected(null)}
      />

      {/* Create / edit drawer */}
      {canEdit && (
        <RoleFormDrawer
          target={formTarget}
          orgId={orgId}
          departments={departments}
          roles={roles}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {/* Bulk import */}
      {canEdit && showImport && (
        <ImportJobRolesModal
          orgId={orgId}
          departments={departments}
          onClose={() => setShowImport(false)}
          onImported={reloadRoles}
        />
      )}
    </div>
  )
}
