'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDepartments } from '@/lib/api/departments'
import { flattenTree } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import type { Department } from '@/lib/types'
import { Loader2, ChevronRight } from 'lucide-react'
import DepartmentCalendarPanel from '@/components/holidays/DepartmentCalendarPanel'

export default function DepartmentsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Department | null>(null)

  // Render the list as the department tree — children indented under their parent.
  const flat = useMemo(() => flattenTree(departments), [departments])
  const colors = useMemo(() => computeNodeColors(departments), [departments])

  useEffect(() => {
    if (!orgId) return
    getDepartments(orgId).then((depts) => {
      setDepartments(depts)
      if (depts.length > 0) setSelected(depts[0])
    }).finally(() => setLoading(false))
  }, [orgId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-medium text-text-primary">Department Calendars</h1>
        <p className="text-[15px] text-text-secondary mt-1">Override working days and add department-specific holidays.</p>
      </div>

      {departments.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card p-8 text-center shadow-card">
          <p className="text-text-muted text-sm">No departments found. Create departments first in Org Chart.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
          {/* Dept list */}
          <div className="bg-surface border border-border-light rounded-card overflow-hidden shadow-card">
            <div className="px-4 py-3 border-b border-border-light bg-surface-sunken">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Departments</p>
            </div>
            <div className="divide-y divide-surface-control-pressed max-h-[calc(100vh-260px)] overflow-y-auto">
              {flat.map(({ dept, depth }) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelected(dept)}
                  style={{ paddingLeft: 16 + depth * 16 }}
                  className={[
                    'w-full flex items-center justify-between gap-2 pr-4 py-3 text-sm text-left transition-colors',
                    selected?.id === dept.id
                      ? 'bg-primary-subtle text-primary-text font-medium'
                      : 'text-text-primary hover:bg-surface-sunken',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: colors[dept.id]?.base || 'var(--text-muted)' }}
                    />
                    <span className="truncate">{dept.name}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-text-muted" />
                </button>
              ))}
            </div>
          </div>

          {/* Panel */}
          {selected && (
            <DepartmentCalendarPanel
              key={selected.id}
              orgId={orgId}
              deptId={selected.id}
              deptName={selected.name}
            />
          )}
        </div>
      )}
    </div>
  )
}
