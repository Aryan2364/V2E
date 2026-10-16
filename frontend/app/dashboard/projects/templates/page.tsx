'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { projectsApi } from '@/lib/api/projects'
import type { ProjectTemplate } from '@/lib/types/projects'
import { Plus, BookTemplate, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function TemplateCard({ template, onDelete }: { template: ProjectTemplate; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const msCount = template._count?.milestones ?? template.milestones?.length ?? 0
  const taskCount = template._count?.tasks ?? template.tasks?.length ?? 0

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="w-9 h-9 rounded-control bg-primary-subtle border border-primary-border flex items-center justify-center shrink-0">
          <BookTemplate size={18} className="text-primary-text" />
        </div>
        <button
          type="button"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
          className="p-1.5 rounded-xs hover:bg-danger-bg text-text-muted hover:text-danger transition-colors"
        >
          <Trash2 size={14} />
        </button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete template</AlertDialogTitle>
              <AlertDialogDescription>This will permanently delete &ldquo;{template.name}&rdquo;.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setDeleting(true)
                  try { await onDelete() } finally { setDeleting(false) }
                }}
              >
                Delete template
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div>
        <h3 className="text-body font-medium text-text-primary leading-snug">{template.name}</h3>
        {template.description && (
          <p className="text-meta text-text-secondary mt-0.5 line-clamp-2">{template.description}</p>
        )}
      </div>

      <div className="flex items-center gap-3 text-meta text-text-muted">
        <span>{msCount} milestone{msCount !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="pt-1 border-t border-border-light flex items-center justify-between">
        <span className={`text-meta font-medium px-2 py-0.5 rounded-full ${
          template.is_active
            ? 'bg-success-bg text-success'
            : 'bg-surface-control text-text-muted'
        }`}>
          {template.is_active ? 'Active' : 'Inactive'}
        </span>
        <Link
          href={`/dashboard/projects/templates/${template.id}`}
          className="text-meta font-medium text-primary-text hover:text-primary-text transition-colors"
        >
          Edit
        </Link>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    projectsApi.listTemplates(orgId).catch(() => []).then(setTemplates).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function handleDelete(templateId: string) {
    await projectsApi.deleteTemplate(orgId, templateId)
    load()
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
          <h1 className="text-page-title font-medium text-text-primary leading-tight">Project Templates</h1>
          <p className="mt-1 text-body text-text-secondary">Reusable project structures with predefined milestones and tasks.</p>
        </div>
        <Link
          href="/dashboard/projects/templates/new"
          className="flex items-center gap-2 px-6 py-[10px] bg-primary text-white rounded-[8px] text-body font-medium hover:bg-primary-hover transition-colors shrink-0"
        >
          <Plus size={16} />
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <BookTemplate size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">No templates yet</p>
          <p className="text-body text-text-secondary mt-1">Create a template to speed up project setup.</p>
          <Link
            href="/dashboard/projects/templates/new"
            className="mt-4 px-4 py-2 bg-primary text-white text-body font-medium rounded-[8px] hover:bg-primary-hover transition-colors"
          >
            New Template
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} onDelete={() => handleDelete(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
