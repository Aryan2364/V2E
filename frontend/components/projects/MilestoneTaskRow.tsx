'use client'

import { ExternalLink } from 'lucide-react'
import PendingTaskBadge from './PendingTaskBadge'
import DependencyWarning from './DependencyWarning'
import type { ProjectTask, DependencyWarning as DWType } from '@/lib/types/projects'
import { formatDate } from '@/lib/format'

interface MilestoneTaskRowProps {
  pt: ProjectTask
  warnings: DWType[]
  onSetup: () => void
}

export default function MilestoneTaskRow({ pt, warnings, onSetup }: MilestoneTaskRowProps) {
  const task = pt.task

  if (!task) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border-light last:border-0 bg-warning-bg">
        <div className="flex-1 min-w-0">
          <p className="text-body text-text-secondary italic">Pending task from template</p>
          <PendingTaskBadge onClick={onSetup} />
        </div>
      </div>
    )
  }

  const statusColor = task.status?.color ?? 'var(--text-muted)'
  const completed = task.status?.type === 'completed'

  return (
    <div className="flex items-start gap-3 py-2.5 px-4 border-b border-border-light last:border-0">
      <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: statusColor }} />
      <div className="flex-1 min-w-0">
        <p className={`text-body font-medium ${completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>
          {task.title}
        </p>
        {task.deadline && (
          <p className="text-meta text-text-muted mt-0.5">
            Due {formatDate(task.deadline)}
          </p>
        )}
        <DependencyWarning warnings={warnings} />
      </div>
      {task.status && (
        <span
          className="text-meta font-medium px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0"
          style={{ backgroundColor: statusColor + '20', color: statusColor, borderColor: statusColor + '40' }}
        >
          {task.status.label}
        </span>
      )}
      {task.id && (
        <a
          href={`/dashboard/tasks/${task.id}`}
          className="p-1 rounded-xs hover:bg-surface-control text-text-secondary shrink-0 transition-colors"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  )
}
