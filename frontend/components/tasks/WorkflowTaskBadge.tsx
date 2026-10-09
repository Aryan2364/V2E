'use client'

import React from 'react'
import Link from 'next/link'
import { RotateCw } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { getNow } from '@/lib/clock'
import type { Task, TaskWorkflowRef } from '@/lib/types/tasks'
import { workflowBadgeTip, workflowBadgeText } from '@/components/workflows/instanceLabel'

const instanceHref = (w: TaskWorkflowRef) => `/dashboard/tasks/workflows/${w.template_id}/instances/${w.instance_id}`

/**
 * The workflow instance a step task came from, as the task's source: "⟳ ACME Ltd
 * onboarding · 3 Nov" (a scheduled instance shows the workflow's name). Its tooltip says
 * which instance and step, and who started it; it opens the instance page when the viewer
 * may see it. Workflow tasks aren't handed out by a person, so this replaces "Self" /
 * "by <assigner>" in task lists.
 */
export default function WorkflowTaskBadge({
  workflow,
  size = 'sm',
  className = '',
}: {
  workflow: TaskWorkflowRef
  size?: 'xs' | 'sm'
  className?: string
}) {
  const text = workflowBadgeText(workflow, getNow())
  const tip = workflowBadgeTip(workflow)
  const cls = `inline-flex items-center gap-1 min-w-0 max-w-[220px] rounded-[999px] border border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8] font-medium ${
    size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  } ${className}`
  const body = (
    <>
      <RotateCw size={size === 'xs' ? 9 : 11} aria-hidden className="shrink-0" />
      <span className="truncate">{text}</span>
    </>
  )
  const label = `Workflow: ${text}. ${tip}`

  if (workflow.can_open !== false) {
    return (
      <Tooltip label={tip}>
        <Link
          href={instanceHref(workflow)}
          aria-label={`${label}. Open instance`}
          // Inside clickable rows and cards: open the instance, not the task.
          onClick={(e) => e.stopPropagation()}
          className={`${cls} hover:bg-[#DBEAFE] hover:border-[#93C5FD] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]`}
        >
          {body}
        </Link>
      </Tooltip>
    )
  }
  return (
    <Tooltip label={tip} openOnTap>
      <span
        tabIndex={0}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]`}
      >
        {body}
      </span>
    </Tooltip>
  )
}

/**
 * The workflow a task came from, when it did: the server's compact `workflow` ref, or —
 * for an older response — what the task's own `workflow_step` says.
 */
export function taskWorkflow(task: Pick<Task, 'workflow' | 'workflow_step' | 'workflow_instance_step_id'>): TaskWorkflowRef | null {
  if (task.workflow) return task.workflow
  if (!task.workflow_instance_step_id || !task.workflow_step) return null
  return {
    instance_id: task.workflow_step.instance_id,
    template_id: '',
    label: task.workflow_step.instance_name || task.workflow_step.template_name,
    instance_number: null,
    step_label: task.workflow_step.step_order ? String(task.workflow_step.step_order) : null,
    total_steps: null,
    started_by_name: null,
    trigger_type: 'manual',
    instance_name: task.workflow_step.instance_name,
    template_name: task.workflow_step.template_name,
    // Without the workflow's id there is no instance link to make.
    can_open: false,
  }
}

/** "Workflow: <label>" for plain-text places (tables, search, exports). */
export function workflowSourceText(w: TaskWorkflowRef): string {
  return `Workflow: ${workflowBadgeText(w, getNow())}`
}
