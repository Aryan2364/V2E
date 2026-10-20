'use client'

import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'

interface TemplateTask {
  id: string
  title: string
  description: string
  estimated_days: string
}

interface TemplateMilestone {
  id: string
  name: string
  description: string
  tasks: TemplateTask[]
  expanded: boolean
}

interface TemplateBuilderProps {
  name: string
  description: string
  milestones: TemplateMilestone[]
  directTasks: TemplateTask[]
  onNameChange: (v: string) => void
  /** Validation message shown under the name field (kit 11.3 rule 6). */
  nameError?: string
  onDescChange: (v: string) => void
  onMilestonesChange: (v: TemplateMilestone[]) => void
  onDirectTasksChange: (v: TemplateTask[]) => void
}

function newTask(): TemplateTask {
  return { id: crypto.randomUUID(), title: '', description: '', estimated_days: '' }
}

function newMilestone(): TemplateMilestone {
  return { id: crypto.randomUUID(), name: '', description: '', tasks: [], expanded: true }
}

export { newTask, newMilestone }
export type { TemplateMilestone, TemplateTask }

export default function TemplateBuilder({
  name, description, milestones, directTasks,
  onNameChange, nameError, onDescChange, onMilestonesChange, onDirectTasksChange,
}: TemplateBuilderProps) {
  function addMilestone() {
    onMilestonesChange([...milestones, newMilestone()])
  }

  function updateMilestone(id: string, patch: Partial<TemplateMilestone>) {
    onMilestonesChange(milestones.map((m) => m.id === id ? { ...m, ...patch } : m))
  }

  function removeMilestone(id: string) {
    onMilestonesChange(milestones.filter((m) => m.id !== id))
  }

  function addTaskToMilestone(milestoneId: string) {
    onMilestonesChange(milestones.map((m) => m.id === milestoneId ? { ...m, tasks: [...m.tasks, newTask()] } : m))
  }

  function updateMilestoneTask(milestoneId: string, taskId: string, patch: Partial<TemplateTask>) {
    onMilestonesChange(milestones.map((m) => m.id === milestoneId
      ? { ...m, tasks: m.tasks.map((t) => t.id === taskId ? { ...t, ...patch } : t) }
      : m
    ))
  }

  function removeTaskFromMilestone(milestoneId: string, taskId: string) {
    onMilestonesChange(milestones.map((m) => m.id === milestoneId
      ? { ...m, tasks: m.tasks.filter((t) => t.id !== taskId) }
      : m
    ))
  }

  function addDirectTask() {
    onDirectTasksChange([...directTasks, newTask()])
  }

  function updateDirectTask(id: string, patch: Partial<TemplateTask>) {
    onDirectTasksChange(directTasks.map((t) => t.id === id ? { ...t, ...patch } : t))
  }

  function removeDirectTask(id: string) {
    onDirectTasksChange(directTasks.filter((t) => t.id !== id))
  }

  const inputCls = 'w-full h-9 px-3 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden'
  const labelCls = 'block text-meta font-medium text-text-secondary mb-1'

  function TaskRow({ task, onChange, onRemove }: { task: TemplateTask; onChange: (p: Partial<TemplateTask>) => void; onRemove: () => void }) {
    return (
      <div className="flex items-start gap-2 bg-surface-sunken rounded-[8px] p-3 mb-2">
        <div className="flex-1 space-y-2">
          <input value={task.title} onChange={(e) => onChange({ title: e.target.value })} aria-label="Task title" placeholder="For example, Draft the project plan" className={inputCls} />
          <input value={task.estimated_days} onChange={(e) => onChange({ estimated_days: e.target.value })} aria-label="Estimated days" placeholder="For example, 3" type="number" min="1" className={inputCls} />
        </div>
        <Tooltip label="Remove task">
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove task" className="mt-0.5">
            <Trash2 size={13} />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Template info */}
      <div className="space-y-3">
        <div>
          <Label className="mb-2" htmlFor="template-name" required>Template name</Label>
          <input id="template-name" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="For example, Software development sprint" aria-invalid={nameError ? true : undefined} className={`${inputCls} max-w-[480px] aria-invalid:border-danger`} />
          <InlineFieldError>{nameError}</InlineFieldError>
        </div>
        <div>
          <Label className="mb-2">Description</Label>
          <textarea value={description} onChange={(e) => onDescChange(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-[8px] border border-border text-body text-text-primary placeholder:text-text-muted bg-surface focus:border-primary focus:outline-hidden resize-none" />
        </div>
      </div>

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-body font-medium text-text-primary">Milestones</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addMilestone}>
            <Plus size={13} /> Add milestone
          </Button>
        </div>

        {milestones.length === 0 && (
          <p className="text-body text-text-muted py-2">No milestones yet.</p>
        )}

        <div className="space-y-3">
          {milestones.map((ms) => (
            <div key={ms.id} className="border border-border-light rounded-[10px] overflow-hidden">
              <div
                className="flex items-center gap-2 px-4 py-3 bg-surface-sunken cursor-pointer hover:bg-surface-control transition-colors"
                onClick={() => updateMilestone(ms.id, { expanded: !ms.expanded })}
              >
                {ms.expanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                <input
                  value={ms.name}
                  onChange={(e) => { e.stopPropagation(); updateMilestone(ms.id, { name: e.target.value }) }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Milestone name"
                  placeholder="For example, Design"
                  className="flex-1 bg-transparent text-body font-medium text-text-primary placeholder:text-text-muted focus:outline-hidden"
                />
                <Tooltip label="Remove milestone">
                  <Button type="button" variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); removeMilestone(ms.id) }} aria-label="Remove milestone">
                    <Trash2 size={13} />
                  </Button>
                </Tooltip>
              </div>
              {ms.expanded && (
                <div className="px-4 py-3 space-y-3">
                  <input value={ms.description} onChange={(e) => updateMilestone(ms.id, { description: e.target.value })} aria-label="Milestone description" placeholder="For example, Wireframes and sign-off" className={inputCls} />
                  <div>
                    <p className="text-meta font-medium text-text-secondary mb-2">Tasks</p>
                    {ms.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onChange={(p) => updateMilestoneTask(ms.id, t.id, p)}
                        onRemove={() => removeTaskFromMilestone(ms.id, t.id)}
                      />
                    ))}
                    <Button type="button" variant="secondary" size="sm" onClick={() => addTaskToMilestone(ms.id)}>
                      <Plus size={12} /> Add task
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Direct tasks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-body font-medium text-text-primary">Direct tasks (no milestone)</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addDirectTask}>
            <Plus size={13} /> Add task
          </Button>
        </div>
        {directTasks.length === 0 && (
          <p className="text-body text-text-muted">No direct tasks.</p>
        )}
        {directTasks.map((t) => (
          <TaskRow key={t.id} task={t} onChange={(p) => updateDirectTask(t.id, p)} onRemove={() => removeDirectTask(t.id)} />
        ))}
      </div>
    </div>
  )
}
