'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectTemplate } from '@/lib/types/projects'
import CreateProjectWizard from '@/components/projects/CreateProjectWizard'
import { PageHeader } from '@/components/shell/page-header'

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
      <PageHeader
        title="New project"
        meta="Set up a new project for your team."
        trail={[{ label: 'Projects', href: '/dashboard/projects' }]}
      />

      <CreateProjectWizard templates={templates} />
    </div>
  )
}
