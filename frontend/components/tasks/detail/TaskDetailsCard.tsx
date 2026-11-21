'use client'

import { deadlineColor } from '@/lib/tasks/format'
import { getNow } from '@/lib/clock'
import { taskWorkflow } from '@/components/tasks/WorkflowTaskBadge'
import { Calendar, User, Clock, Flag, Tag } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format'
import InlineTaskTags from '@/components/tasks/InlineTaskTags'
import WorkflowTaskBadge from '@/components/tasks/WorkflowTaskBadge'
import useCanEditTask from '@/lib/tasks/useCanEditTask'
import type { TaskDetailCtx } from './types'

export function TaskDetailsCard({ ctx }: { ctx: TaskDetailCtx }) {
  const { d, task, orgId } = ctx
  const category = d.categories.find((c) => c.id === task.category_id) ?? task.category
  const priority = d.priorities.find((p) => p.id === task.priority_id) ?? task.priority
  // Tags are edited inline, gated on the real rule the server applies to updateTask.
  // undefined = not known yet: chips without controls.
  const canEditTags = useCanEditTask(task, d.config)
  const handleTagsUpdated = d.patchTags
  return (
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-control border-b border-border-light">
            <span className="w-2 h-2 rounded-full bg-text-secondary" />
            <p className="text-meta font-medium text-text-secondary uppercase tracking-widest">Details</p>
          </div>
          <div className="p-4 space-y-4">
            {/* Status lives in its own card above — not repeated here. */}
            {category && (
              <div className="flex flex-wrap gap-2">
                <span
                  className="inline-flex items-center rounded-control px-3 py-1.5 text-body font-medium"
                  style={{ backgroundColor: category.color + '22', color: category.color, border: `1px solid ${category.color}44` }}
                >
                  {category.name}
                </span>
              </div>
            )}

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-control bg-surface-control flex items-center justify-center shrink-0">
                <Tag size={13} className="text-text-secondary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-meta font-medium text-text-muted uppercase tracking-wide mb-1">Tags</p>
                <InlineTaskTags
                  orgId={orgId}
                  taskId={task.id}
                  tags={task.tags}
                  canEdit={canEditTags}
                  onUpdated={handleTagsUpdated}
                />
              </div>
            </div>

            {priority && (
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-control flex items-center justify-center shrink-0"
                  style={{ backgroundColor: priority.color + '22' }}
                >
                  <Flag size={13} style={{ color: priority.color }} />
                </div>
                <div>
                  <p className="text-meta font-medium text-text-muted uppercase tracking-wide">Priority</p>
                  <p className="text-body font-medium" style={{ color: priority.color }}>{priority.label}</p>
                </div>
              </div>
            )}

            {task.deadline && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-control bg-warning-bg flex items-center justify-center shrink-0">
                  <Calendar size={13} className="text-warning" />
                </div>
                <div>
                  <p className="text-meta font-medium text-text-muted uppercase tracking-wide">Deadline</p>
                  <p className={`text-body ${deadlineColor(task.deadline, getNow())}`}>{formatDate(task.deadline)}</p>
                  {/* A revised deadline says so, with the date compliance actually
                      grades against — the live date can move, the baseline can't. */}
                  {(task.deadline_revision_count ?? 0) > 0 && task.original_deadline && (
                    <p className="text-meta text-text-secondary">
                      Revised {task.deadline_revision_count}
                      {task.deadline_revision_count === 1 ? ' time' : ' times'} · graded against{' '}
                      {formatDate(task.original_deadline)}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-control bg-surface-control flex items-center justify-center shrink-0">
                <Clock size={13} className="text-text-secondary" />
              </div>
              <div>
                <p className="text-meta font-medium text-text-muted uppercase tracking-wide">Created</p>
                <p className="text-body text-text-secondary">{formatDate(task.created_at)}</p>
              </div>
            </div>

            {/* Who it came from: a person, or — for a workflow step's task — the
                workflow instance, with the person who set the step up. */}
            {(() => {
              const wf = taskWorkflow(task)
              const setUpBy = wf ? wf.set_up_by_name ?? task.created_by?.name ?? null : null
              if (!wf && !task.created_by?.name) return null
              return (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-control bg-surface-control flex items-center justify-center shrink-0">
                    <User size={13} className="text-text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-meta font-medium text-text-muted uppercase tracking-wide">Assigned by</p>
                    {wf ? (
                      <>
                        <p className="text-body text-text-primary flex items-center gap-1.5 flex-wrap min-w-0">
                          <span>Workflow:</span>
                          <WorkflowTaskBadge workflow={wf} />
                        </p>
                        {setUpBy && <p className="text-meta text-text-secondary">set up by {setUpBy}</p>}
                      </>
                    ) : (
                      <p className="text-body text-text-secondary">{task.created_by?.name}</p>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
  )
}
