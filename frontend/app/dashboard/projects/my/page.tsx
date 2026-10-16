'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/types/projects'
import ProjectCard from '@/components/projects/ProjectCard'
import { Briefcase, Plus } from 'lucide-react'

export default function MyProjectsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    projectsApi.listMy(orgId).catch(() => []).then(setProjects).finally(() => setLoading(false))
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
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-page-title font-medium text-text-primary leading-tight">My Projects</h1>
          <p className="mt-1 text-body text-text-secondary">Projects you are a member of.</p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 px-6 py-[10px] bg-primary text-white rounded-[8px] text-body font-medium hover:bg-primary-hover transition-colors shrink-0"
        >
          <Plus size={16} />
          New Project
        </Link>
      </div>

      <p className="text-body text-text-secondary">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>

      {projects.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Briefcase size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">Not a member of any project yet</p>
          <p className="text-body text-text-secondary mt-1">Projects you join will appear here.</p>
        </div>
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
