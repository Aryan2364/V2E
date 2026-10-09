'use client'

import React, { useMemo } from 'react'
import { AlertTriangle, Clock, Users } from 'lucide-react'
import type { WorkflowStep } from '@/lib/types/workflows'
import FlowDiagram, { type FlowDiagramNode } from './FlowDiagram'
import { namesSummary } from './shared'
import { dueRuleOf, startRuleOf, timingProblems, timingSummary, type Frequency } from './timing'

const MANUAL: Frequency = { type: 'manual' }

/** Steps in display order, numbered from 1. */
export function orderSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.slice().sort((a, b) => a.order_index - b.order_index || a.created_at.localeCompare(b.created_at))
}

export function stepNumbers(steps: WorkflowStep[]): Map<string, number> {
  return new Map(orderSteps(steps).map((s, i) => [s.id, i + 1]))
}

/** Names of a step's assignees, from the server's resolved list or the member list. */
export function assigneeNames(step: Pick<WorkflowStep, 'assignee_user_ids' | 'assignees'>, memberName?: (id: string) => string | undefined): string[] {
  if (step.assignees?.length) return step.assignees.map((a) => a.name)
  return (step.assignee_user_ids ?? []).map((id) => memberName?.(id) ?? 'Someone no longer active')
}

/**
 * The workflow's steps as a flow: steps on the same level run side by side, arrows show
 * what each step starts after. Read-only; `onOpen` makes each box a button.
 */
export default function StepFlow({
  steps,
  onOpen,
  memberName,
  compact = false,
  frequency,
}: {
  steps: WorkflowStep[]
  onOpen?: (step: WorkflowStep) => void
  memberName?: (id: string) => string | undefined
  compact?: boolean
  /** How the workflow repeats (for the words of cycle timing). */
  frequency?: Frequency
}) {
  const nums = useMemo(() => stepNumbers(steps), [steps])
  const nodes: FlowDiagramNode[] = useMemo(
    () =>
      orderSteps(steps).map((s) => {
        const n = nums.get(s.id) ?? 0
        const names = assigneeNames(s, memberName)
        const timingOff = !!frequency && timingProblems(startRuleOf(s), dueRuleOf(s), frequency).length > 0
        const missing = !s.title?.trim() || names.length === 0 || timingOff
        return {
          id: s.id,
          deps: s.depends_on_step_ids ?? [],
          order: s.order_index,
          label: `Step ${n}: ${s.title || 'Untitled step'}`,
          tone: missing ? 'attention' : 'default',
          onClick: onOpen ? () => onOpen(s) : undefined,
          content: (
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <span className="mt-0.5 min-w-[22px] h-[22px] px-1 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {n}
                </span>
                <span className="text-[14px] font-semibold text-[#0F172A] leading-snug line-clamp-2 break-words">{s.title || 'Untitled step'}</span>
              </div>
              <span className="flex items-center gap-1.5 text-[12px] text-[#334155] min-w-0">
                <Users size={12} className="shrink-0 text-[#475569]" />
                <span className="truncate">{names.length ? namesSummary(names.map((name) => ({ name })), 2) : 'No one assigned yet'}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-[#334155]">
                <Clock size={12} className="shrink-0 text-[#475569]" />
                {timingSummary(startRuleOf(s), dueRuleOf(s), frequency ?? MANUAL, (s.depends_on_step_ids ?? []).length > 0)}
                {s.if_late === 'move_on' && <span className="text-[#475569]">· moves on if late</span>}
              </span>
              {missing && (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#B91C1C]">
                  <AlertTriangle size={12} className="shrink-0" />
                  {!s.title?.trim() ? 'Needs a title' : names.length === 0 ? 'Needs an assignee' : 'Timing needs a change'}
                </span>
              )}
            </div>
          ),
        }
      }),
    [steps, nums, onOpen, memberName, frequency],
  )
  return <FlowDiagram nodes={nodes} compact={compact} />
}
