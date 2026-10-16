'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectTemplate } from '@/lib/types/projects'
import TemplateBuilder from '@/components/projects/TemplateBuilder'
import type { TemplateMilestone, TemplateTask } from '@/components/projects/TemplateBuilder'
import { ChevronLeft, Loader2 } from 'lucide-react'

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
    }).catch(() => setError('Failed to load template')).finally(() => setLoading(false))
  }, [orgId, id])

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }
    setSaving(true)
    setError('')
    try {
      await projectsApi.updateTemplate(orgId, id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      router.push('/dashboard/projects/templates')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save template'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">Template not found</p>
        <Link href="/dashboard/projects/templates" className="mt-2 text-sm text-primary-text hover:underline">
          Back to Templates
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/dashboard/projects/templates"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Back to Templates
        </Link>
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">Edit Template</h1>
        <p className="mt-1 text-[15px] text-text-secondary">{template.name}</p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-[8px] border border-danger-border bg-danger-bg text-sm text-danger">
          {error}
        </div>
      )}

      <div className="bg-surface border border-border-light rounded-card p-6 shadow-card">
        <TemplateBuilder
          name={name}
          description={description}
          milestones={milestones}
          directTasks={directTasks}
          onNameChange={setName}
          onDescChange={setDescription}
          onMilestonesChange={setMilestones}
          onDirectTasksChange={setDirectTasks}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="h-10 px-6 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-sm font-medium disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
