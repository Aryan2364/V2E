import { BadRequestException } from '@nestjs/common'
import { DefinitionScheduleDto, EscalationMode, IfLate, MAX_ESCALATION_CONTACTS } from './dto/definition.dto'
import { Frequency, RunStartPoint, RunStartScheduleLike, cycleLengthOf, dayMonthWords, dueBeforeStartText, firstStepTimingProblem, isExplicitRule, laterStepTimingProblem, predecessorName, readDueRule, readStartRule, sampleRunDay, startBeforePredecessorText, timingProblem } from './engine/timing'
import { MONTHS_SHORT, OrderCheckStep, ProposedStep, StepState, Tx } from './workflow-template.types'
import { PlanStepInput, orderProblems, planRun, sampleRunContext } from './engine/plan'
import { Prisma, WorkflowAccessType, WorkflowScheduleEntry, WorkflowStep } from '@prisma/client'
import { ScheduleEntryLike, calendarDateToStored, nextScheduleOccurrence, scheduleExhausted } from './engine/schedule'
import { TrackProblem, stepErrorLabel } from './tracks'

import { localDateOf, zonedParts } from './engine/tz'
import { unique } from './workflow-view.formatter'

/**
 * "Runs will overlap: this run ends 5 Dec, the next starts 3 Dec." when a run's last
 * planned date (start or due) is after the next scheduled run starts; null otherwise.
 * Dates in the org's time zone; the year is added when they differ. `runStart` names a
 * run that isn't the first example ("the run on 3 Dec ends …"), which the builder shows
 * first and which "this run" means.
 */
export function overlapWarning(
  steps: { planned_start_at: Date; planned_due_at: Date }[],
  nextStart: Date,
  tz: string,
  runStart: Date | null = null,
): string | null {
  let last = 0
  for (const s of steps) last = Math.max(last, s.planned_start_at.getTime(), s.planned_due_at.getTime())
  if (!steps.length || last <= nextStart.getTime()) return null
  const end = localDateOf(new Date(last), tz)
  const next = localDateOf(nextStart, tz)
  const from = runStart ? localDateOf(runStart, tz) : null
  const years = new Set([end.year, next.year, ...(from ? [from.year] : [])])
  const word = (d: { year: number; month: number; day: number }) =>
    `${d.day} ${MONTHS_SHORT[d.month - 1]}${years.size > 1 ? ` ${d.year}` : ''}`
  const which = from ? `the instance on ${word(from)}` : 'this instance'
  return `Instances will overlap: ${which} ends ${word(end)}, the next starts ${word(next)}.`
}

export function escalationModeOf(v: unknown): EscalationMode {
  return v === 'people' ? 'people' : 'manager'
}

export function ifLateOf(v: unknown): IfLate {
  return v === 'move_on' ? 'move_on' : 'wait'
}

/**
 * A step-specific 400 the builder can scroll to: `step_key` is the key the step was
 * sent with (a new step has no id yet), `step_id` its id when it has one.
 */
export function stepError(message: string, stepId: string | null, stepKey: string | null = stepId) {
  return new BadRequestException({ message, code: 'step_invalid', step_id: stepId, step_key: stepKey })
}

/** A 400 about "How it starts" (`schedule_index` names the schedule entry, when it is one). */
export function startsError(message: string, scheduleIndex: number | null = null) {
  return new BadRequestException({ message, code: 'starts_invalid', schedule_index: scheduleIndex })
}

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** A 400 about a track (`track_key` names it) — e.g. a split point that no longer exists. */
export function trackError(message: string, trackKey: string) {
  return new BadRequestException({ message, code: 'track_invalid', track_key: trackKey })
}

/** "Step B2 “Review”" (or "Step B2" while it has no title) — how errors name a step. */
export const stepLabel = stepErrorLabel

/**
 * Save's order check on the SAMPLE run — the run the builder's calendar shows, planned
 * without holidays in the same floating frame, so the builder's greyed days and messages
 * match these exactly: an explicit start day before the day the step it waits for is due
 * (`pick a day on or after 5 Nov, when 1 “Collect documents” is due.`), or an explicit
 * due day before the step's own start day. The same day is fine. Steps whose timing has
 * another problem are planned with their legacy defaults and not checked. Returns step
 * key → message (completing "Step 2 “X”: …").
 */
export async function sampleOrderMessages(
  steps: OrderCheckStep[],
  schedules: RunStartScheduleLike[],
  frequency: Frequency,
  runStart: RunStartPoint | null,
  tz: string,
  now: Date,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!runStart) return out
  const skip = new Set<string>()
  const inputs: PlanStepInput[] = steps.map((s) => {
    const problem =
      timingProblem(s.start_rule, s.due_rule, frequency) ??
      (s.deps.length === 0 ? firstStepTimingProblem(s.start_rule, s.due_rule, runStart) : laterStepTimingProblem(s.start_rule))
    if (problem) skip.add(s.key)
    return {
      key: s.key,
      deps: s.deps,
      start_rule: !problem && s.start_rule ? readStartRule(s.start_rule) : null,
      due_rule: !problem && s.due_rule ? readDueRule(s.due_rule) : null,
      due_days: s.due_days,
      due_time: s.due_time,
    }
  })
  if (!inputs.some((i) => isExplicitRule(i.start_rule) || isExplicitRule(i.due_rule))) return out
  const p = zonedParts(now, tz)
  const day = sampleRunDay(schedules, runStart, { year: p.year, month: p.month, day: p.day }, p.hour * 60 + p.minute)
  const ctx = sampleRunContext(day, runStart.time, cycleLengthOf(frequency))
  const plan = await planRun(inputs, ctx)
  const byKey = new Map(steps.map((s) => [s.key, s]))
  for (const o of orderProblems(inputs, plan.steps, ctx)) {
    if (skip.has(o.key) || out.has(o.key)) continue
    const words = dayMonthWords(o.day, day.year)
    const pred = o.predecessor_key ? byKey.get(o.predecessor_key) : null
    out.set(
      o.key,
      o.part === 'start' && pred ? startBeforePredecessorText(words, predecessorName(pred.label, pred.title)) : dueBeforeStartText(words),
    )
  }
  return out
}

/** A track/merge/loop problem of a definition request as the 400 the builder points at. */
export function throwTrackProblem(problem: TrackProblem, idOf: Map<string, string>, existingById: Map<string, WorkflowStep>): never {
  if (problem.kind === 'track') throw trackError(problem.message, problem.track_key)
  if (problem.kind === 'step') {
    const id = idOf.get(problem.step_key)
    throw stepError(problem.message, id && existingById.has(id) ? id : null, problem.step_key)
  }
  throw new BadRequestException(problem.message)
}

/** The next `n` occurrences (strictly after now) across the schedules, earliest first. */
export function upcomingOccurrences(entries: ScheduleEntryLike[], now: Date, tz: string, n: number): Date[] {
  const all: number[] = []
  for (const e of entries) {
    let after = now
    for (let i = 0; i < n; i++) {
      const next = nextScheduleOccurrence(e, after, tz)
      if (!next) break
      all.push(next.getTime())
      after = next
    }
  }
  return unique(all)
    .sort((a, b) => a - b)
    .slice(0, n)
    .map((t) => new Date(t))
}

/** A schedule entry's columns from the DTO (dates normalised to UTC midnight of the day). */
export function scheduleData(e: DefinitionScheduleDto, index: number, existing: WorkflowScheduleEntry | null) {
  const start = calendarDateToStored(e.start_date) ?? existing?.start_date ?? new Date(Date.UTC(1970, 0, 1))
  const endCondition = e.end_condition ?? 'never'
  const endDate = endCondition === 'on_date' ? calendarDateToStored(e.end_date) : null
  const endAfter = endCondition === 'after_n' ? e.end_after ?? null : null
  const occurrenceCount = existing?.occurrence_count ?? 0
  return {
    id: existing?.id ?? null,
    data: {
      schedule_type: e.schedule_type,
      every: e.every ?? 1,
      days: e.schedule_type === 'weekly' ? unique(e.days ?? []).sort((a, b) => a - b) : [],
      month_days: e.schedule_type === 'monthly' ? unique(e.month_days ?? []) : [],
      yearly_dates:
        e.schedule_type === 'yearly'
          ? (e.yearly_dates ?? []).map((d) => ({ month: d.month, day: d.day }))
          : ([] as { month: number; day: number }[]),
      time: e.time,
      start_date: start,
      end_condition: endCondition,
      end_date: endDate,
      end_after: endAfter,
      order_index: index,
      // Spent once an "after N" count is reached; raising N brings it back.
      is_active: !scheduleExhausted({ end_condition: endCondition, end_after: endAfter, occurrence_count: occurrenceCount }),
    },
  }
}

export async function applySteps(
  tx: Tx,
  orgId: string,
  templateId: string,
  userId: string,
  proposed: ProposedStep[],
  existing: WorkflowStep[],
  assignersActive: Set<string>,
) {
  const keep = new Set(proposed.filter((s) => s.existing).map((s) => s.id))
  const removed = existing.filter((s) => !keep.has(s.id)).map((s) => s.id)
  if (removed.length) {
    // Legacy escalation references (old model) to the deleted steps.
    await tx.workflowStep.updateMany({
      where: { workflow_template_id: templateId, organization_id: orgId, branch_step_id: { in: removed } },
      data: { branch_step_id: null, if_overdue_action: 'block_next' },
    })
    await tx.workflowStep.deleteMany({
      where: { id: { in: removed }, workflow_template_id: templateId, organization_id: orgId },
    })
  }
  for (const s of proposed) {
    if (s.existing) {
      // Keep the task creator valid without asking: one who left hands over to this editor.
      const handOver = !assignersActive.has(s.existing.assigner_user_id)
      await tx.workflowStep.updateMany({
        where: { id: s.id, workflow_template_id: templateId, organization_id: orgId },
        data: {
          ...stepColumns(s.state, s.deps),
          order_index: s.order_index,
          track_key: s.track_key,
          merge_step_ids: s.merges,
          ...(handOver ? { assigner_user_id: userId } : {}),
        },
      })
    } else {
      await tx.workflowStep.create({
        data: {
          id: s.id,
          organization_id: orgId,
          workflow_template_id: templateId,
          order_index: s.order_index,
          track_key: s.track_key,
          merge_step_ids: s.merges,
          is_branch_step: false,
          // The step's tasks are created by the person who added the step.
          assigner_user_id: userId,
          ...stepColumns(s.state, s.deps),
        },
      })
    }
  }
}

/**
 * Replace the schedules. A new entry's last-fired marker is "now" (it never fires an
 * occurrence from before it existed); kept entries keep theirs and their counts.
 * Going Live sets every marker to now, so nothing missed while it was a draft fires.
 */
export async function applySchedules(
  tx: Tx,
  orgId: string,
  templateId: string,
  schedules: ReturnType<typeof scheduleData>[],
  existing: WorkflowScheduleEntry[],
  orgNow: Date,
  goingLive: boolean,
) {
  const keep = new Set(schedules.map((x) => x.id).filter(Boolean))
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id)
  if (removed.length) {
    await tx.workflowScheduleEntry.deleteMany({
      where: { id: { in: removed }, workflow_template_id: templateId, organization_id: orgId },
    })
  }
  for (const x of schedules) {
    const data = { ...x.data, yearly_dates: x.data.yearly_dates as unknown as Prisma.InputJsonArray }
    if (x.id) {
      await tx.workflowScheduleEntry.updateMany({
        where: { id: x.id, workflow_template_id: templateId, organization_id: orgId },
        data,
      })
    } else {
      await tx.workflowScheduleEntry.create({
        data: { ...data, organization_id: orgId, workflow_template_id: templateId, last_fired_at: orgNow },
      })
    }
  }
  if (goingLive) await markSchedulesFiredUpTo(tx, orgId, templateId, orgNow)
}

/** "Nothing before `at` is due" — used when a workflow goes live or is resumed. */
export async function markSchedulesFiredUpTo(tx: Tx, orgId: string, templateId: string, at: Date) {
  await tx.workflowScheduleEntry.updateMany({
    where: {
      workflow_template_id: templateId,
      organization_id: orgId,
      OR: [{ last_fired_at: null }, { last_fired_at: { lt: at } }],
    },
    data: { last_fired_at: at },
  })
}

/** Editors (`edit`), viewers (`view`) and starters (`trigger`) → exactly these lists. */
export async function applyGrants(
  tx: Tx,
  orgId: string,
  templateId: string,
  current: { user_id: string; access_type: WorkflowAccessType }[],
  editors: string[],
  viewers: string[],
  starters: string[],
) {
  const has = (type: WorkflowAccessType, id: string) => current.some((g) => g.access_type === type && g.user_id === id)
  const drop = current.filter(
    (g) =>
      (g.access_type === 'edit' && !editors.includes(g.user_id)) ||
      (g.access_type === 'view' && !viewers.includes(g.user_id)) ||
      (g.access_type === 'trigger' && !starters.includes(g.user_id)),
  )
  if (drop.length) {
    await tx.workflowAccess.deleteMany({
      where: {
        workflow_template_id: templateId,
        organization_id: orgId,
        OR: drop.map((g) => ({ access_type: g.access_type, user_id: g.user_id })),
      },
    })
  }
  const add = [
    ...editors.filter((id) => !has('edit', id)).map((user_id) => ({ user_id, access_type: 'edit' as WorkflowAccessType })),
    ...viewers.filter((id) => !has('view', id)).map((user_id) => ({ user_id, access_type: 'view' as WorkflowAccessType })),
    ...starters
      .filter((id) => !has('trigger', id))
      .map((user_id) => ({ user_id, access_type: 'trigger' as WorkflowAccessType })),
  ]
  if (add.length) {
    await tx.workflowAccess.createMany({
      data: add.map((r) => ({ ...r, organization_id: orgId, workflow_template_id: templateId })),
      skipDuplicates: true,
    })
  }
}

/** The rules that make one step runnable (Save, and every save while Live). */
export function stepRunnableProblem(st: StepState, activeMembers: Set<string> | null): string | null {
  if (!st.title.trim()) return 'enter a title.'
  if (!st.assignee_user_ids.length) return 'add at least one assignee.'
  if (activeMembers && st.assignee_user_ids.some((id) => !activeMembers.has(id))) {
    return 'an assignee is no longer active. Choose someone else.'
  }
  if (st.escalation_mode === 'people') {
    if (!st.escalation_user_ids.length) {
      return 'add someone to escalate to, or choose “Reporting manager”.'
    }
    if (st.escalation_user_ids.length > MAX_ESCALATION_CONTACTS) {
      return `choose at most ${MAX_ESCALATION_CONTACTS} people to escalate to.`
    }
    if (activeMembers && st.escalation_user_ids.some((id) => !activeMembers.has(id))) {
      return 'someone it escalates to is no longer active. Choose someone else.'
    }
  }
  return null
}

/** The legacy columns kept in sync for back-compat readers (never read by v2). */
export function stepColumns(st: StepState, deps: string[]) {
  return {
    title: st.title,
    description: st.description,
    assignee_user_ids: st.assignee_user_ids,
    cc_user_ids: st.cc_user_ids,
    completion_mode: st.completion_mode,
    priority_id: st.priority_id,
    category_id: st.category_id,
    tag_ids: st.tag_ids,
    checklist_items: st.checklist_items as unknown as Prisma.InputJsonArray,
    proof_required: st.proof_required,
    proof_allowed_extensions: st.proof_allowed_extensions,
    due_days: st.due_days,
    due_time: st.due_time,
    escalation_mode: st.escalation_mode,
    escalation_user_ids: st.escalation_user_ids,
    if_late: st.if_late,
    start_rule: st.start_rule ? (st.start_rule as Prisma.InputJsonObject) : Prisma.DbNull,
    due_rule: st.due_rule ? (st.due_rule as Prisma.InputJsonObject) : Prisma.DbNull,
    depends_on_step_ids: deps,
    // Legacy mirror (old readers / old snapshots): first assignee, "N days after start".
    assignee_type: 'fixed_person' as const,
    assignee_user_id: st.assignee_user_ids[0] ?? null,
    assignee_role: null,
    deadline_config: { type: 'x_days_after_start', days: st.due_days, time: st.due_time } as Prisma.InputJsonObject,
    if_overdue_action: st.if_late === 'move_on' ? ('proceed_anyway' as const) : ('block_next' as const),
    branch_step_id: null,
  }
}
