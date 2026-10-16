'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectTemplate } from '@/lib/types/projects'
import CreateProjectWizard from '@/components/projects/CreateProjectWizard'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export default function NewProjectPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [templates, setTemplates] = useState<ProjectTemplate[]>([])

  useEffect(() => {
    if (!orgId) return
    projectsApi.listTemplates(orgId).catch(() => []).then(setTemplates)
  }, [orgId])

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Back to Projects
        </Link>
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">New Project</h1>
        <p className="mt-1 text-[15px] text-text-secondary">Set up a new project for your team.</p>
      </div>

      <CreateProjectWizard templates={templates} />
    </div>
  )
}
