'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { Project, ProjectStatus } from '@/lib/types/projects'
import ProjectCard from '@/components/projects/ProjectCard'
import ProjectStatCard from '@/components/projects/ProjectStatCard'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { usePermissions } from '@/lib/auth/use-permissions'
import { Plus, Briefcase, Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const STATUS_OPTS: { value: 'all' | ProjectStatus; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function ProjectsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { can, loading: permsLoading } = usePermissions()

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | ProjectStatus>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    projectsApi.list(orgId).catch(() => []).then(setProjects).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = projects.filter((p) => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const active = projects.filter((p) => p.status === 'active').length
  const onHold = projects.filter((p) => p.status === 'on_hold').length
  const completed = projects.filter((p) => p.status === 'completed').length
  const avgProgress = projects.length
    ? Math.round(projects.reduce((s, p) => s + p.completion_percentage, 0) / projects.length)
    : 0

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  if (!permsLoading && !can('projects.project.manage', 'read')) {
    return (
      <div className="space-y-6">
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">Projects</h1>
        <AccessHiddenState orgId={orgId} leaf="projects.project.manage" moduleLabel="Projects" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary leading-tight">Projects</h1>
          <p className="mt-1 text-[15px] text-text-secondary">All projects across your organization.</p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 px-6 py-[10px] bg-primary text-white rounded-[8px] text-sm font-medium hover:bg-primary-hover transition-colors shrink-0"
        >
          <Plus size={16} />
          New Project
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ProjectStatCard label="Total Projects" value={projects.length} color="var(--primary-text)" />
        <ProjectStatCard label="Active" value={active} color="var(--success)" />
        <ProjectStatCard label="On Hold" value={onHold} color="var(--warning)" />
        <ProjectStatCard label="Avg. Progress" value={`${avgProgress}%`} color="var(--text-secondary)" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full h-9 pl-8 pr-3 rounded-control border border-border text-sm text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as 'all' | ProjectStatus)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-text-secondary">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Briefcase size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">No projects found</p>
          <p className="text-sm text-text-secondary mt-1">
            {projects.length === 0 ? 'Create your first project to get started.' : 'Try adjusting your filters.'}
          </p>
          {projects.length === 0 && (
            <Link
              href="/dashboard/projects/new"
              className="mt-4 px-4 py-2 bg-primary text-white text-sm font-medium rounded-[8px] hover:bg-primary-hover transition-colors"
            >
              New Project
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  )
}
