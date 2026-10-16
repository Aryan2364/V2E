'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/types/projects'
import ProjectCard from '@/components/projects/ProjectCard'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'

export default function ManagingProjectsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    projectsApi.listManaging(orgId).catch(() => []).then(setProjects).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Managing"
        meta="Projects where you are the project manager."
        actions={
          <Button render={<Link href="/dashboard/projects/new" />}>
            <Plus />
            New project
          </Button>
        }
      />

      <p className="text-body text-text-secondary">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>

      {projects.length === 0 ? (
        <EmptyState
          variant="nothing-yet"
          heading="No projects to manage"
          actionLabel="New project"
          onAction={() => router.push('/dashboard/projects/new')}
        >
          Projects where you are the manager will appear here.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  )
}
