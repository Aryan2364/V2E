'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDepartments } from '@/lib/api/departments'
import { flattenTree } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import type { Department } from '@/lib/types'
import { ChevronRight } from 'lucide-react'
import DepartmentCalendarPanel from '@/components/holidays/DepartmentCalendarPanel'
import { PageHeader } from '@/components/shell/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department calendars"
        meta="Override working days and add department-specific holidays."
      />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : departments.length === 0 ? (
        <EmptyState variant="nothing-yet" heading="No departments found">
          Create departments first in Org Chart.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
          {/* Dept list */}
          <div className="bg-surface border border-border-light rounded-card overflow-hidden shadow-card">
            <div className="px-4 py-3 border-b border-border-light bg-surface-sunken">
              <p className="text-meta font-medium text-text-secondary uppercase tracking-wide">Departments</p>
            </div>
            <div className="divide-y divide-surface-control-pressed max-h-[calc(100vh-260px)] overflow-y-auto">
              {flat.map(({ dept, depth }) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelected(dept)}
                  style={{ paddingLeft: 16 + depth * 16 }}
                  className={[
                    'w-full flex items-center justify-between gap-2 pr-4 py-3 text-body text-left transition-colors',
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
