'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, Plus } from 'lucide-react'
import ProjectProgressBar from './ProjectProgressBar'
import MilestoneTaskRow from './MilestoneTaskRow'
import type { ProjectMilestone, ProjectTask, DependencyWarning } from '@/lib/types/projects'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  pending: { bg: 'var(--surface-sunken)', text: 'var(--text-muted)', border: 'var(--border-light)', label: 'Pending' },
  in_progress: { bg: 'var(--primary-subtle)', text: 'var(--primary-text)', border: 'var(--primary-border)', label: 'In progress' },
  achieved: { bg: 'var(--success-bg)', text: 'var(--success)', border: 'var(--success-border)', label: 'Achieved' },
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
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
      <div
        className="px-6 py-4 flex items-start gap-3 cursor-pointer hover:bg-surface-sunken transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-expanded={expanded} aria-label={expanded ? 'Collapse milestone' : 'Expand milestone'}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-body font-medium text-text-primary">{milestone.name}</h3>
            <span
              className="text-meta font-medium px-2.5 py-0.5 rounded-full border"
              style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
            >
              {milestone.status === 'achieved' && <CheckCircle2 size={10} className="inline mr-1" />}
              {badge.label}
            </span>
          </div>
          {milestone.due_date && (
            <p className="text-meta text-text-muted mb-2">
              Due {formatDate(milestone.due_date)}
            </p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <ProjectProgressBar percentage={milestone.completion_percentage} showLabel={false} height={5} />
            </div>
            <span className="text-meta text-text-secondary shrink-0 whitespace-nowrap">
              {milestone.completed_tasks}/{milestone.total_tasks} tasks
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <>
          {tasks.length === 0 ? (
            <div className="px-6 py-3 text-body text-text-muted border-t border-border-light">No tasks yet.</div>
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
            <div className="px-6 py-2.5 border-t border-border-light">
              <Button type="button" variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onAddTask(milestone.id) }}>
                <Plus size={13} /> Add task
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
