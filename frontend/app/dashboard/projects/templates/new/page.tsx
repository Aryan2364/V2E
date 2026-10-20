'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import TemplateBuilder, { newMilestone, newTask } from '@/components/projects/TemplateBuilder'
import type { TemplateMilestone, TemplateTask } from '@/components/projects/TemplateBuilder'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

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
  const [nameError, setNameError] = useState('')

  // A new template exists only once saved: leaving a filled-in form asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: !saving && (name.trim() !== '' || description.trim() !== '' || directTasks.length > 0 || milestones.length !== 1 || milestones.some((m) => m.name.trim() !== '' || m.tasks.length > 0)),
    noun: 'template',
    mode: 'create',
  })

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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save the template. Try again.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {unsaved.warning}
      <div>
        <Link
          href="/dashboard/projects/templates"
          className="inline-flex items-center gap-1.5 text-body text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ChevronLeft size={15} />
          Back to templates
        </Link>
        <h1 className="text-page-title font-medium text-text-primary leading-tight">New template</h1>
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
          onNameChange={(v) => { setName(v); if (nameError) setNameError('') }}
          nameError={nameError}
          onDescChange={setDescription}
          onMilestonesChange={setMilestones}
          onDirectTasksChange={setDirectTasks}
        />
      </div>

      <div className="flex justify-end">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" data-leaves-page onClick={() => router.push('/dashboard/projects/templates')} disabled={saving}>Cancel</Button>
          <Button type="button" disabled={saving} loading={saving} loadingLabel="Saving" onClick={handleSave}>Save template</Button>
        </div>
      </div>
    </div>
  )
}
