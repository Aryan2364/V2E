'use client'

import { ExternalLink } from 'lucide-react'
import PendingTaskBadge from './PendingTaskBadge'
import DependencyWarning from './DependencyWarning'
import type { ProjectTask, DependencyWarning as DWType } from '@/lib/types/projects'

interface MilestoneTaskRowProps {
  pt: ProjectTask
  warnings: DWType[]
  onSetup: () => void
}

export default function MilestoneTaskRow({ pt, warnings, onSetup }: MilestoneTaskRowProps) {
  const task = pt.task

  if (!task) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-4 border-b border-[#F1F5F9] last:border-0 bg-[#FFFBEB]">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#475569] italic">Pending task from template</p>
          <PendingTaskBadge onClick={onSetup} />
        </div>
      </div>
    )
  }

  const statusColor = task.status?.color ?? '#94A3B8'
  const completed = task.status?.type === 'completed'

  return (
    <div className="flex items-start gap-3 py-2.5 px-4 border-b border-[#F1F5F9] last:border-0">
      <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: statusColor }} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${completed ? 'line-through text-[#94A3B8]' : 'text-[#0F172A]'}`}>
          {task.title}
        </p>
        {task.deadline && (
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Due {new Date(task.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        )}
        <DependencyWarning warnings={warnings} />
      </div>
      {task.status && (
        <span
          className="text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0"
          style={{ backgroundColor: statusColor + '20', color: statusColor, borderColor: statusColor + '40' }}
        >
          {task.status.label}
        </span>
      )}
      {task.id && (
        <a
          href={`/dashboard/tasks/${task.id}`}
          className="p-1 rounded-xs hover:bg-[#F1F5F9] text-[#475569] shrink-0 transition-colors"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  )
}
