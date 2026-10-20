'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { Project, ProjectStatus } from '@/lib/types/projects'
import ProjectCard from '@/components/projects/ProjectCard'
import ProjectStatCard from '@/components/projects/ProjectStatCard'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { usePermissions } from '@/lib/auth/use-permissions'
import { Plus, Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'

const STATUS_OPTS: { value: 'all' | ProjectStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function ProjectsPage() {
  const { user } = useAuth()
  const router = useRouter()
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
        <PageHeader title="Projects" />
        <AccessHiddenState orgId={orgId} leaf="projects.project.manage" moduleLabel="Projects" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        meta="All projects across your organization."
        actions={
          <Button render={<Link href="/dashboard/projects/new" />}>
            <Plus />
            New project
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ProjectStatCard label="Total projects" value={projects.length} color="var(--primary-text)" />
        <ProjectStatCard label="Active" value={active} color="var(--success)" />
        <ProjectStatCard label="On hold" value={onHold} color="var(--warning)" />
        <ProjectStatCard label="Avg. Progress" value={`${avgProgress}%`} color="var(--text-secondary)" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full h-9 pl-8 pr-3 rounded-control border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden"
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
        <span className="text-body text-text-secondary">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        projects.length === 0 ? (
          <EmptyState
            variant="nothing-yet"
            heading="No projects yet"
            actionLabel="New project"
            onAction={() => router.push('/dashboard/projects/new')}
          >
            Create your first project to get started.
          </EmptyState>
        ) : (
          <EmptyState variant="nothing-found" heading="No projects found" onAction={() => { setFilterStatus('all'); setSearch('') }}>
            Try adjusting your filters.
          </EmptyState>
        )
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
