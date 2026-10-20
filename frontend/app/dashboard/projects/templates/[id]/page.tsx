'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectTemplate } from '@/lib/types/projects'
import TemplateBuilder from '@/components/projects/TemplateBuilder'
import type { TemplateMilestone, TemplateTask } from '@/components/projects/TemplateBuilder'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

export default function EditTemplatePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [template, setTemplate] = useState<ProjectTemplate | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [milestones, setMilestones] = useState<TemplateMilestone[]>([])
  const [directTasks, setDirectTasks] = useState<TemplateTask[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')

  useEffect(() => {
    if (!orgId || !id) return
    projectsApi.getTemplate(orgId, id).then((t) => {
      setTemplate(t)
      setName(t.name)
      setDescription(t.description ?? '')
      setMilestones((t.milestones ?? []).map((ms) => ({
        id: ms.id,
        name: ms.name,
        description: ms.description ?? '',
        expanded: false,
        tasks: (ms.tasks ?? []).map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description ?? '',
          estimated_days: task.estimated_days?.toString() ?? '',
        })),
      })))
      const direct = (t.tasks ?? []).filter((task) => !task.milestone_id).map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description ?? '',
        estimated_days: task.estimated_days?.toString() ?? '',
      }))
      setDirectTasks(direct)
    }).catch(() => setError('Could not load the template. Refresh the page to try again.')).finally(() => setLoading(false))
  }, [orgId, id])

  async function handleSave() {
    if (!name.trim()) {
      setNameError('Enter a name for the template.')
      requestAnimationFrame(() => document.getElementById('template-name')?.focus())
      return
    }
    setNameError('')
    setSaving(true)
    setError('')
    try {
      await projectsApi.updateTemplate(orgId, id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      router.push('/dashboard/projects/templates')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save the template. Try again.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">Template not found</p>
        <Link href="/dashboard/projects/templates" className="mt-2 text-body text-primary-text hover:underline">
          Back to templates
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/dashboard/projects/templates"
          className="inline-flex items-center gap-1.5 text-body text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Back to templates
        </Link>
        <h1 className="text-page-title font-medium text-text-primary leading-tight">Edit template</h1>
        <p className="mt-1 text-body text-text-secondary">{template.name}</p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-[8px] border border-danger-border bg-danger-bg text-body text-danger">
          {error}
        </div>
      )}

      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
        <TemplateBuilder
          name={name}
          description={description}
          milestones={milestones}
          directTasks={directTasks}
          onNameChange={(v) => { setName(v); if (nameError) setNameError('') }}
          nameError={nameError}
          onDescChange={setDescription}
          onMilestonesChange={setMilestones}
          onDirectTasksChange={setDirectTasks}
        />
      </div>

      <div className="flex justify-end">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push('/dashboard/projects/templates')} disabled={saving}>Cancel</Button>
          <Button type="button" disabled={saving} loading={saving} loadingLabel="Saving" onClick={handleSave}>Save template</Button>
        </div>
      </div>
    </div>
  )
}
