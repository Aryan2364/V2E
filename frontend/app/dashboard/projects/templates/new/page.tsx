'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import TemplateBuilder, { newMilestone, newTask } from '@/components/projects/TemplateBuilder'
import type { TemplateMilestone, TemplateTask } from '@/components/projects/TemplateBuilder'
import { ChevronLeft, Loader2 } from 'lucide-react'

export default function NewTemplatePage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [milestones, setMilestones] = useState<TemplateMilestone[]>([newMilestone()])
  const [directTasks, setDirectTasks] = useState<TemplateTask[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }
    setSaving(true)
    setError('')
    try {
      const template = await projectsApi.createTemplate(orgId, {
        name: name.trim(),
        description: description.trim() || undefined,
        milestones: milestones.map((ms, mi) => ({
          name: ms.name,
          description: ms.description || undefined,
          order_index: mi,
          tasks: ms.tasks.map((t, ti) => ({
            title: t.title,
            description: t.description || undefined,
            estimated_days: t.estimated_days ? Number(t.estimated_days) : undefined,
            order_index: ti,
          })),
        })),
        tasks: directTasks.map((t, ti) => ({
          title: t.title,
          description: t.description || undefined,
          estimated_days: t.estimated_days ? Number(t.estimated_days) : undefined,
          order_index: ti,
        })),
      })
      router.push(`/dashboard/projects/templates/${template.id}`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create template'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/dashboard/projects/templates"
          className="inline-flex items-center gap-1.5 text-body text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Back to Templates
        </Link>
        <h1 className="text-page-title font-medium text-text-primary leading-tight">New Template</h1>
        <p className="mt-1 text-body text-text-secondary">Define a reusable project structure.</p>
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
          className="h-10 px-6 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-body font-medium disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving...' : 'Save Template'}
        </button>
      </div>
    </div>
  )
}
