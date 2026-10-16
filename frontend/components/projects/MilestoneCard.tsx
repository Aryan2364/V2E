'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, Plus } from 'lucide-react'
import ProjectProgressBar from './ProjectProgressBar'
import MilestoneTaskRow from './MilestoneTaskRow'
import type { ProjectMilestone, ProjectTask, DependencyWarning } from '@/lib/types/projects'

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  pending: { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0', label: 'Pending' },
  in_progress: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE', label: 'In Progress' },
  achieved: { bg: '#DCFCE7', text: '#16A34A', border: '#BBF7D0', label: 'Achieved' },
}

interface MilestoneCardProps {
  milestone: ProjectMilestone
  tasks: ProjectTask[]
  warnings: Record<string, DependencyWarning[]>
  canEdit: boolean
  onAddTask: (milestoneId: string) => void
  onSetupTask: (projectTaskId: string, milestoneId: string) => void
}

export default function MilestoneCard({ milestone, tasks, warnings, canEdit, onAddTask, onSetupTask }: MilestoneCardProps) {
  const [expanded, setExpanded] = useState(true)
  const badge = STATUS_BADGE[milestone.status] ?? STATUS_BADGE.pending

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
      <div
        className="px-5 py-4 flex items-start gap-3 cursor-pointer hover:bg-surface-sunken transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <button type="button" className="text-text-muted mt-0.5 shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-[15px] font-semibold text-text-primary">{milestone.name}</h3>
            <span
              className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border"
              style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
            >
              {milestone.status === 'achieved' && <CheckCircle2 size={10} className="inline mr-1" />}
              {badge.label}
            </span>
          </div>
          {milestone.due_date && (
            <p className="text-xs text-text-muted mb-2">
              Due {new Date(milestone.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <ProjectProgressBar percentage={milestone.completion_percentage} showLabel={false} height={5} />
            </div>
            <span className="text-xs text-text-secondary shrink-0 whitespace-nowrap">
              {milestone.completed_tasks}/{milestone.total_tasks} tasks
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <>
          {tasks.length === 0 ? (
            <div className="px-5 py-3 text-sm text-text-muted border-t border-border-light">No tasks yet.</div>
          ) : (
            <div className="border-t border-border-light">
              {tasks.map((pt) => (
                <MilestoneTaskRow
                  key={pt.id}
                  pt={pt}
                  warnings={warnings[pt.task_id ?? pt.id] ?? []}
                  onSetup={() => onSetupTask(pt.id, milestone.id)}
                />
              ))}
            </div>
          )}
          {canEdit && (
            <div className="px-5 py-2.5 border-t border-border-light">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddTask(milestone.id) }}
                className="flex items-center gap-1.5 text-xs text-primary-text hover:text-primary-text font-medium transition-colors"
              >
                <Plus size={13} /> Add Task
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
