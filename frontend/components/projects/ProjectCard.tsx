'use client'

import { useRouter } from 'next/navigation'
import type { Project, ProjectStatus } from '@/lib/types/projects'
import { formatDate } from '@/lib/format'
import ProjectProgressBar from './ProjectProgressBar'
import Tooltip from '@/components/ui/tooltip'

const STATUS_BADGE: Record<ProjectStatus, { bg: string; text: string; border: string; label: string }> = {
  active:    { bg: 'var(--success-bg)', text: 'var(--success)', border: 'var(--success-border)', label: 'Active' },
  on_hold:   { bg: 'var(--warning-bg)', text: 'var(--warning)', border: 'var(--warning-border)', label: 'On Hold' },
  completed: { bg: 'var(--primary-subtle)', text: 'var(--primary-text)', border: 'var(--primary-border)', label: 'Completed' },
  cancelled: { bg: 'var(--danger-bg)', text: 'var(--danger)', border: 'var(--danger-border)', label: 'Cancelled' },
}

interface ProjectCardProps {
  project: Project
  orgId: string
}

export default function ProjectCard({ project, orgId }: ProjectCardProps) {
  const router = useRouter()
  const badge = STATUS_BADGE[project.status]

  function fmtDate(d?: string) {
    if (!d) return null
    return formatDate(d)
  }

  function fmtCurrency(n: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: project.currency ?? 'INR', maximumFractionDigits: 0 }).format(n)
  }

  return (
    <div
      className="bg-surface border border-border-light rounded-card shadow-card p-6 cursor-pointer hover:shadow-menu hover:border-border transition-all"
      onClick={() => router.push(`/dashboard/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-card-heading font-medium text-text-primary leading-tight">{project.name}</h3>
        <span
          className="text-meta font-medium px-2.5 py-0.5 rounded-full border shrink-0"
          style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
        >
          {badge.label}
        </span>
      </div>

      {project.description && (
        <p className="text-body text-text-secondary line-clamp-2 mb-3">{project.description}</p>
      )}

      <ProjectProgressBar percentage={project.completion_percentage} height={6} />

      <div className="flex gap-4 mt-3 text-meta text-text-secondary">
        <span>{project.achieved_milestones}/{project.total_milestones} milestones</span>
        <span>{project.completed_tasks}/{project.total_tasks} tasks</span>
      </div>

      <div className="mt-3 pt-3 border-t border-border-light flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {(project.members ?? []).slice(0, 5).map((m, i) => (
            <Tooltip key={m.id} label={m.user_id}>
            <div
              className="w-6 h-6 rounded-full bg-primary-subtle border-2 border-white flex items-center justify-center text-meta font-medium text-primary-text"
              style={{ marginLeft: i > 0 ? -6 : 0 }}
            >
              {m.user_id.charAt(0).toUpperCase()}
            </div>
            </Tooltip>
          ))}
          {(project._count?.members ?? 0) > 5 && (
            <span className="text-meta text-text-muted ml-1">+{(project._count?.members ?? 0) - 5}</span>
          )}
        </div>

        {project.start_date && (
          <p className="text-meta text-text-muted">
            {fmtDate(project.start_date)}
            {project.end_date ? ` → ${fmtDate(project.end_date)}` : ''}
          </p>
        )}
      </div>

      {(project.planned_budget || project.actual_spent) && (
        <div className="mt-2 pt-2 border-t border-border-light flex justify-between text-meta text-text-secondary">
          <span>Budget: {project.planned_budget ? fmtCurrency(project.planned_budget) : '—'}</span>
          {project.actual_spent && <span className="text-warning">Spent: {fmtCurrency(project.actual_spent)}</span>}
        </div>
      )}
    </div>
  )
}
