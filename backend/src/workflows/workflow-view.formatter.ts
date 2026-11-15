import { InstanceRow, InstanceStepRow, NoteOut, NoteRow, SendBackEvent, SendBackInfo, StepState, StoredChecklistItem, UserRef } from './workflow-template.types'
import { NotFoundException } from '@nestjs/common'
import { Principal } from '../access-rights/permissions.service'
import { Prisma, WorkflowScheduleEntry, WorkflowStep } from '@prisma/client'
import { effectiveDueRule, effectiveStartRule, looseRule, parseDueRule, parseStartRule } from './engine/timing'
import { escalationModeOf, ifLateOf } from './workflow-definition.validation'
import { formatLocalDate } from './engine/tz'
import { isLegacyBranchRow, rowDependencyMap, stringIds } from './step-graph'
import { nextScheduleOccurrence, scheduleExhausted, storedCalendarDate } from './engine/schedule'
import { readSnapshot } from './engine/snapshot'
import { resolveStoredTracks, runTracks, trackLabel } from './tracks'

export function idsFromJson(v: Prisma.JsonValue | null | undefined): string[] {
  return stringIds(v)
}

export function unique<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}

/** The tracks of a run and each flow row's track and number, from the frozen snapshots. */
export function runLanes(rows: InstanceStepRow[], deps: Map<string, string[]>) {
  return runTracks(
    rows
      .filter((s) => !isLegacyBranchRow(s))
      .map((s) => {
        const sn = readSnapshot(s.step_snapshot)
        return {
          id: s.id,
          order_index: s.order_index,
          created_at: s.created_at,
          track_key: sn?.track_key ?? null,
          track_name: sn?.track_name ?? null,
          number_label: sn?.number_label ?? null,
        }
      }),
    deps,
  )
}

export function ref(id: string | null | undefined, names: Map<string, string>): UserRef | null {
  if (!id) return null
  return { id, name: names.get(id) ?? 'Unknown user' }
}

export function refs(ids: string[], names: Map<string, string>): UserRef[] {
  return ids.map((id) => ref(id, names)!)
}

/**
 * Schedules as the builder edits them (the recurring-task schedule shape, dates as
 * "YYYY-MM-DD") + `next_fire_at`: the entry's next occurrence after now (org clock,
 * org tz) and after its last-fired marker. It only actually fires while Live.
 */
export function formatSchedules(entries: WorkflowScheduleEntry[], ctx: { tz: string; now: Date } | null) {
  return entries.map((e) => {
    let next: string | null = null
    if (ctx) {
      const marker = e.last_fired_at ?? new Date(e.created_at.getTime() - 1)
      const after = marker.getTime() > ctx.now.getTime() ? marker : ctx.now
      try {
        next = nextScheduleOccurrence(e, after, ctx.tz)?.toISOString() ?? null
      } catch {
        next = null
      }
    }
    return {
      id: e.id,
      schedule_type: e.schedule_type,
      every: e.every,
      days: Array.isArray(e.days) ? (e.days as number[]) : [],
      month_days: Array.isArray(e.month_days) ? (e.month_days as number[]) : [],
      yearly_dates: Array.isArray(e.yearly_dates) ? (e.yearly_dates as { month: number; day: number }[]) : [],
      time: e.time,
      start_date: formatLocalDate(storedCalendarDate(e.start_date)),
      end_condition: e.end_condition,
      end_date: e.end_date ? formatLocalDate(storedCalendarDate(e.end_date)) : null,
      end_after: e.end_after,
      occurrence_count: e.occurrence_count,
      /** False once an "after N" schedule has run N times. */
      is_active: e.is_active && !scheduleExhausted(e),
      order_index: e.order_index,
      next_fire_at: next,
    }
  })
}

/** The v2 editable state stored on a step row. */
export function stateOf(s: WorkflowStep): StepState {
  return {
    title: s.title,
    description: s.description,
    assignee_user_ids: idsFromJson(s.assignee_user_ids),
    cc_user_ids: idsFromJson(s.cc_user_ids),
    completion_mode: s.completion_mode,
    priority_id: s.priority_id,
    category_id: s.category_id,
    tag_ids: idsFromJson(s.tag_ids),
    checklist_items: (Array.isArray(s.checklist_items) ? s.checklist_items : []) as unknown as StoredChecklistItem[],
    proof_required: s.proof_required,
    proof_allowed_extensions: s.proof_allowed_extensions ?? [],
    due_days: s.due_days,
    due_time: s.due_time,
    escalation_mode: escalationModeOf(s.escalation_mode),
    escalation_user_ids: idsFromJson(s.escalation_user_ids),
    if_late: ifLateOf(s.if_late),
    start_rule: looseRule(s.start_rule),
    due_rule: looseRule(s.due_rule),
  }
}

/**
 * The timing the builder shows for a step: a complete stored rule in its canonical
 * shape; a draft's partial rule as stored; NULL (legacy) as the defaults it runs
 * with — start as soon as the steps before it are done, due `due_days` after it
 * starts at `due_time`.
 */
export function timingOf(st: StepState) {
  const start = st.start_rule ? parseStartRule(st.start_rule) : null
  const due = st.due_rule ? parseDueRule(st.due_rule) : null
  return {
    start_rule: start ? (start.ok ? start.rule : st.start_rule) : effectiveStartRule(null),
    due_rule: due ? (due.ok ? due.rule : st.due_rule) : effectiveDueRule(null, st.due_days, st.due_time),
  }
}

/**
 * The workflow's tracks for the builder and the workflow page: main first, then the
 * others in display order, each with its label ("Main track", its name, "Track B")
 * and the step it starts after (null = when the workflow starts).
 */
export function formatTracks(rawTracks: unknown, steps: WorkflowStep[]) {
  const r = resolveStoredTracks(rawTracks, steps.filter((s) => !s.is_branch_step))
  return r.tracks.map((t) => ({
    key: t.key,
    name: t.name,
    label: trackLabel(t),
    split_from_step_id: t.split_from_step_id,
    step_count: r.display.filter((s) => r.trackOf.get(s.id) === t.key).length,
  }))
}

/** Workflows the caller edits: created it, or holds an `edit` grant. */
export function ownedWhere(orgId: string, userId: string): Prisma.WorkflowTemplateWhereInput {
  return {
    organization_id: orgId,
    OR: [
      { created_by_user_id: userId },
      { access: { some: { user_id: userId, organization_id: orgId, access_type: 'edit' } } },
    ],
  }
}

/** A row of this run (scoped by run + org), or 404. */
export function rowOf(inst: InstanceRow, rowId: string): InstanceStepRow {
  const row = inst.steps.find((s) => s.id === rowId)
  if (!row || isLegacyBranchRow(row)) throw new NotFoundException('Step not found in this instance')
  return row
}

/** Each flow row's number in its run ("1", "B2"). */
export function rowLabels(inst: InstanceRow, deps: Map<string, string[]> = rowDependencyMap(inst.steps)): Map<string, string> {
  return runLanes(inst.steps, deps).labels
}

export function stepTitle(row: InstanceStepRow): string {
  return readSnapshot(row.step_snapshot)?.title ?? 'Step'
}

/**
 * A row's open send-back (see `SendBackInfo`), or null. A row that was reopened and has
 * since sent the instance back further shows where it is waiting now (sender).
 */
export function sendBackOf(
  row: InstanceStepRow,
  byId: Map<string, InstanceStepRow>,
  events: Map<string, SendBackEvent>,
  labels: Map<string, string>,
  names: Map<string, string>,
): SendBackInfo | null {
  const label = (id: string) => {
    const r = byId.get(id)
    return `${labels.get(id) ?? ''} “${r ? stepTitle(r) : 'Step'}”`.trim()
  }
  if (row.status === 'sent_back' && row.waiting_on_row_id) {
    const ev = events.get(row.id)
    const matches = ev && (!ev.to_row_id || ev.to_row_id === row.waiting_on_row_id)
    return {
      role: 'sender',
      reason: matches ? ev!.reason : null,
      by: matches ? ref(ev!.actor_user_id, names) : null,
      at: matches ? ev!.created_at : null,
      to_row_id: row.waiting_on_row_id,
      to_label: label(row.waiting_on_row_id),
    }
  }
  if (row.returned_to_row_id) {
    const ev = events.get(row.returned_to_row_id)
    const matches = ev && (!ev.to_row_id || ev.to_row_id === row.id)
    return {
      role: 'target',
      reason: matches ? ev!.reason : null,
      by: matches ? ref(ev!.actor_user_id, names) : null,
      at: matches ? ev!.created_at : null,
      from_row_id: row.returned_to_row_id,
      from_label: label(row.returned_to_row_id),
    }
  }
  return null
}

export function noteOut(
  n: NoteRow,
  names: Map<string, string>,
  canEdit: boolean,
  p: Principal,
  forStep: NoteOut['for_step'],
): NoteOut {
  return {
    id: n.id,
    body: n.body,
    author: ref(n.author_user_id, names)!,
    created_at: n.created_at,
    for_row_id: n.for_instance_step_id,
    for_step: n.for_instance_step_id ? forStep : null,
    can_delete: n.author_user_id === p.userId || canEdit,
  }
}
