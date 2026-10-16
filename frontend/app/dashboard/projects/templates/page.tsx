'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TextLink } from '@/components/ui/text-link'
import Tooltip from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'

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
        <Tooltip label="Delete template">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete template"
          >
            <Trash2 />
          </Button>
        </Tooltip>
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
        <Badge variant={template.is_active ? 'success' : 'neutral'}>
          {template.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <TextLink render={<Link href={`/dashboard/projects/templates/${template.id}`} />}>
          Edit
        </TextLink>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const { user } = useAuth()
  const router = useRouter()
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
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project templates"
        meta="Reusable project structures with predefined milestones and tasks."
        actions={
          <Button render={<Link href="/dashboard/projects/templates/new" />}>
            <Plus />
            New template
          </Button>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          variant="nothing-yet"
          heading="No templates yet"
          actionLabel="New template"
          onAction={() => router.push('/dashboard/projects/templates/new')}
        >
          Create a template to speed up project setup.
        </EmptyState>
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
