'use client'

import type { ProjectActivityLog, ProjectActivityAction } from '@/lib/types/projects'

const ACTION_LABELS: Record<ProjectActivityAction, string> = {
  created: 'created this project',
  member_added: 'added a member',
  member_removed: 'removed a member',
  member_role_changed: 'changed a member role',
  status_changed: 'changed project status',
  milestone_created: 'created a milestone',
  milestone_achieved: 'achieved a milestone',
  task_added: 'added a task',
  task_completed: 'completed a task',
  task_removed: 'removed a task',
  dependency_added: 'added a task dependency',
  dependency_removed: 'removed a dependency',
  comment_added: 'added a comment',
  document_added: 'added a document',
  budget_updated: 'updated the budget',
  template_applied: 'applied a template',
  deleted: 'deleted this project',
}

const ACTION_COLORS: Partial<Record<ProjectActivityAction, string>> = {
  created: '#16A34A',
  milestone_achieved: '#16A34A',
  task_completed: '#16A34A',
  status_changed: '#D97706',
  member_removed: '#DC2626',
  task_removed: '#DC2626',
  deleted: '#DC2626',
}

interface ProjectActivityFeedProps {
  logs: ProjectActivityLog[]
}

export default function ProjectActivityFeed({ logs }: ProjectActivityFeedProps) {
  if (!logs.length) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-text-muted">No activity yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => {
        const color = ACTION_COLORS[log.action] ?? '#2563EB'
        return (
          <div key={log.id} className="flex items-start gap-3">
            <div
              className="w-2 h-2 rounded-full mt-2 shrink-0"
              style={{ backgroundColor: color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                <span className="font-medium text-text-primary">User</span>{' '}
                {ACTION_LABELS[log.action] ?? log.action}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {new Date(log.created_at).toLocaleString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
