'use client'

import React, { useMemo } from 'react'
import { AlertTriangle, Clock, Users } from 'lucide-react'
import type { WorkflowStep } from '@/lib/types/workflows'
import FlowDiagram, { type FlowDiagramNode, type FlowLane } from './FlowDiagram'
import { namesSummary } from './shared'
import { MAIN_TRACK, layoutTracks, savedMerges, stepName, trackLabel, type TrackDraft, type TrackLayout } from './tracks'
import { dueRuleOf, runStartOf, startRuleOf, timingProblems, timingSummary, type Frequency, type ScheduleShape } from './timing'
import { nextCycleFlagsFor, planContext } from './timingPlan'

const MANUAL: Frequency = { type: 'manual' }

/** Names of a step's assignees, from the server's resolved list or the member list. */
export function assigneeNames(step: Pick<WorkflowStep, 'assignee_user_ids' | 'assignees'>, memberName?: (id: string) => string | undefined): string[] {
  if (step.assignees?.length) return step.assignees.map((a) => a.name)
  return (step.assignee_user_ids ?? []).map((id) => memberName?.(id) ?? 'Someone no longer active')
}

/** The lanes of a track layout: label + where the track starts. */
export function flowLanes(layout: TrackLayout): FlowLane[] {
  return layout.tracks.map((t) => {
    const g = layout.groups.get(t.key) ?? []
    const first = g[0]
    const split = first ? layout.deps.get(first.id)?.[0] : undefined
    const splitOk = t.key !== MAIN_TRACK && !!t.split_from && split === t.split_from
    return {
      key: t.key,
      label: trackLabel(t),
      hint:
        t.key === MAIN_TRACK
          ? undefined
          : splitOk
            ? `After ${layout.labels.get(t.split_from!) ?? '?'}`
            : 'From the start',
    }
  })
}

/**
 * The workflow's steps as a flow, one lane per track: arrows show what each step waits
 * for (the step before it, the step its track splits from, and steps in other tracks it
 * also waits for). Read-only; `onOpen` makes each box a button. `steps` order decides
 * each step's position in its track.
 */
export default function StepFlow({
  steps,
  tracks,
  onOpen,
  memberName,
  compact = false,
  frequency,
  schedules,
}: {
  steps: WorkflowStep[]
  tracks: TrackDraft[]
  onOpen?: (step: WorkflowStep) => void
  memberName?: (id: string) => string | undefined
  compact?: boolean
  /** How the workflow repeats (for the words of cycle timing). */
  frequency?: Frequency
  /** Its schedules: first steps before the run start are flagged; "(next month)" is said. */
  schedules?: ScheduleShape[]
}) {
  const layout = useMemo(() => layoutTracks(tracks, steps), [tracks, steps])
  const lanes = useMemo(() => flowLanes(layout), [layout])
  const runStart = useMemo(() => (frequency && schedules ? runStartOf(schedules, frequency) : null), [frequency, schedules])
  const next = useMemo(
    () =>
      frequency
        ? nextCycleFlagsFor(
            layout.display.map((s) => ({ id: s.id, deps: layout.deps.get(s.id) ?? [], start: startRuleOf(s), due: dueRuleOf(s) })),
            planContext(frequency, runStart),
          )
        : null,
    [layout, frequency, runStart],
  )
  const nodes: FlowDiagramNode[] = useMemo(
    () =>
      layout.display.map((s) => {
        const n = layout.labels.get(s.id) ?? '?'
        const names = assigneeNames(s, memberName)
        const deps = layout.deps.get(s.id) ?? []
        const timingOff = !!frequency && timingProblems(startRuleOf(s), dueRuleOf(s), frequency, { first: deps.length === 0, runStart }).length > 0
        const missing = !s.title?.trim() || names.length === 0 || timingOff
        return {
          id: s.id,
          deps,
          order: layout.order.get(s.id) ?? 0,
          lane: layout.trackOf.get(s.id),
          alsoWaitsFor: savedMerges(layout, s.id).map((m) => layout.labels.get(m) ?? '?'),
          label: `${stepName(n, null)}: ${s.title || 'Untitled step'}`,
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
                <span className="truncate">{names.length ? namesSummary(names.map((name) => ({ name })), 2) : 'No one assigned'}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-[#334155]">
                <Clock size={12} className="shrink-0 text-[#475569]" />
                {timingSummary(startRuleOf(s), dueRuleOf(s), frequency ?? MANUAL, deps.length > 0, next?.get(s.id))}
                {s.if_late === 'move_on' && <span className="text-[#475569]">· continues if late</span>}
              </span>
              {missing && (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#B91C1C]">
                  <AlertTriangle size={12} className="shrink-0" />
                  {!s.title?.trim() ? 'Needs a title' : names.length === 0 ? 'Needs an assignee' : 'Fix timing'}
                </span>
              )}
            </div>
          ),
        }
      }),
    [layout, onOpen, memberName, frequency, runStart, next],
  )
  return <FlowDiagram nodes={nodes} lanes={lanes} compact={compact} />
}
