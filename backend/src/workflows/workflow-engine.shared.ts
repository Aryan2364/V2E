import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common'
import { LiveChecklistTemplate, StepSnapshot, applyChecklistTemplates, buildStepSnapshot, readSnapshot, snapshotTemplateIds } from './engine/snapshot'
import { OPEN_STATUSES, flowRows, rowDependencies, upstreamOf } from './engine/dag'
import { PlanStepInput, TimingContext } from './engine/plan'
import { Prisma } from '@prisma/client'
import { dayMonthYear } from './instance-label'
import { instanceNameKey, tidyInstanceName } from './run-access'
import { zonedParts } from './engine/tz'

export type Tx = Prisma.TransactionClient

export type Effect = () => Promise<unknown>

/** Instance states a run may move in. */
export const ADVANCEABLE: ('running' | 'stuck')[] = ['running', 'stuck']

/** Row states with a live task the run waits on (or is paused on). */
export const OPEN_ROW = [...OPEN_STATUSES] as ('active' | 'overdue' | 'moved_on' | 'sent_back')[]

/** Row states a step may send the run back from. */
export const SENDABLE_ROW: ('active' | 'overdue')[] = ['active', 'overdue']

export const TERMINAL_TASK_TYPES = ['completed', 'partially_completed', 'incomplete']

export const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 }

export const REASON_MIN = 5

export const REASON_MAX = 2000

/** Every `WorkflowInstanceEvent.type` (run history). */
export type WorkflowEventType =
  | 'run_started'
  | 'step_waiting'
  | 'step_started'
  | 'step_completed'
  | 'step_late'
  | 'step_moved_on'
  | 'step_escalated'
  | 'sent_back'
  | 'returned'
  | 'step_skipped'
  | 'run_completed'
  | 'run_cancelled'
  | 'run_stuck'
  | 'retried'
  | 'file_added'
  | 'file_removed'
  | 'note_added'

export type WorkflowNotifEvent =
  | 'workflow_triggered'
  | 'workflow_step_assigned'
  | 'workflow_step_overdue'
  | 'workflow_upstream_delay'
  | 'workflow_completed'
  | 'workflow_stuck'
  | 'workflow_task_withdrawn'
  | 'workflow_sent_back'
  | 'workflow_step_late'
  | 'workflow_step_upcoming'
  | 'workflow_note_added'

/** The Run dialog's (and the engine's) answer to a name already used in the workflow. */
export const MSG_INSTANCE_NAME_TAKEN = 'An instance with this name already exists in this workflow.'

export const INSTANCE_NAME_MAX = 80

/** 400 for a typed instance name already used in the workflow (the Run dialog shows it inline). */
export function instanceNameTaken(): BadRequestException {
  return new BadRequestException({ message: MSG_INSTANCE_NAME_TAKEN, code: 'instance_name_taken', field: 'name' })
}

/** Does a P2002 (unique violation) name `field`? (Prisma reports the target differently per driver.) */
export function uniqueViolationOn(err: Prisma.PrismaClientKnownRequestError, field: string): boolean {
  try {
    return JSON.stringify(err.meta ?? {}).includes(field) || String(err.message ?? '').includes(field)
  } catch {
    return false
  }
}

/** Template columns the engine reads for its editors (creator + `edit` grants). */
export const EDITORS_SELECT = {
  created_by_user_id: true,
  access: { where: { access_type: 'edit' as const }, select: { user_id: true } },
} satisfies Prisma.WorkflowTemplateSelect

export interface InstanceCtx {
  id: string
  organization_id: string
  workflow_template_id: string
  name: string
  started_at: Date
  templateName: string
  /** The workflow's editors: the creator first, then `edit` grants (late/stuck alerts go here). */
  editorIds: string[]
}

export type StepRow = Prisma.WorkflowInstanceStepGetPayload<object>

/** A step of a plan (run creation / builder example) plus whose calendar it follows. */
export interface TimelineStepInput extends PlanStepInput {
  /** The person whose holidays / weekly offs apply (the step's first assignee). */
  holiday_user_id?: string | null
}

/** A pending row whose steps-before are done, waiting for its start time. */
export function isWaitingRow(row: { status: string; start_at?: Date | null }): boolean {
  return row.status === 'pending' && !!row.start_at
}

export const DAY_MS = 86_400_000

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 18 Oct, 9:00 AM" in the org time zone. */
export function formatStartMoment(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz)
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  const mm = String(p.minute).padStart(2, '0')
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day} ${MONTH_SHORT[p.month - 1]}, ${h12}:${mm} ${p.hour < 12 ? 'AM' : 'PM'}`
}

/** Who a step's task goes to, resolved at activation. */
export interface StepPeople {
  assignees: string[]
  ccs: string[]
  /** TaskEscalation levels (index 0 = level 1); several users may share level 1. */
  escalationLevels: string[][]
  escalationSource: 'manager' | 'people' | 'owners_fallback' | 'none'
  warning: string | null
}

/** The workflow's editors: the creator (permanent) first, then everyone with an `edit` grant. */
export function editorsOf(template: { created_by_user_id: string; access?: { user_id: string }[] }): string[] {
  return Array.from(new Set([template.created_by_user_id, ...(template.access ?? []).map((a) => a.user_id)].filter(Boolean)))
}

export function instanceLink(templateId: string, instanceId: string): string {
  return `/dashboard/tasks/workflows/${templateId}/instances/${instanceId}`
}

/** A readable message for `last_error` from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse() as { message?: unknown } | string
    const msg = typeof res === 'string' ? res : Array.isArray(res?.message) ? res.message.join(' ') : res?.message
    if (typeof msg === 'string' && msg) return msg
  }
  const raw = (err as Error)?.message ?? String(err)
  const short = raw.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `The instance couldn’t continue (${short}). Fix the problem, then retry the instance.`
}

/**
 * The status every workflow task is born in — mirrors TasksService: the org's
 * `not_started` status, then the `is_default` one, then the first active one.
 * Fails LOUDLY (never an empty id that would hit a foreign-key error).
 */
export async function defaultStatusId(tx: Tx, orgId: string): Promise<string> {
  const notStarted = await tx.taskStatus.findFirst({
    where: { organization_id: orgId, type: 'not_started', is_active: true },
    orderBy: { order_index: 'asc' },
    select: { id: true },
  })
  if (notStarted) return notStarted.id
  const flagged = await tx.taskStatus.findFirst({
    where: { organization_id: orgId, is_default: true, is_active: true },
    orderBy: { order_index: 'asc' },
    select: { id: true },
  })
  if (flagged) return flagged.id
  const any = await tx.taskStatus.findFirst({
    where: { organization_id: orgId, is_active: true },
    orderBy: { order_index: 'asc' },
    select: { id: true },
  })
  if (any) return any.id
  throw new BadRequestException(
    'Tasks can’t be created because there is no active task status. Add one in Task settings, then retry.',
  )
}

/** The subset of `ids` that are active members of the org, in the given order. */
export async function activeMembers(tx: Tx, orgId: string, ids: (string | null | undefined)[]): Promise<string[]> {
  const wanted = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (!wanted.length) return []
  const rows = await tx.organizationMember.findMany({
    where: { organization_id: orgId, user_id: { in: wanted }, is_active: true, user: { is_active: true } },
    select: { user_id: true },
  })
  const ok = new Set(rows.map((r) => r.user_id))
  return wanted.filter((id) => ok.has(id))
}

export async function userName(tx: Tx, userId: string | null | undefined): Promise<string> {
  if (!userId) return 'someone'
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } })
  return u?.name ?? 'someone'
}

export async function userNames(tx: Tx, ids: string[]): Promise<string> {
  const names: string[] = []
  for (const id of ids.slice(0, 4)) names.push(await userName(tx, id))
  if (ids.length > 4) names.push(`${ids.length - 4} more`)
  return names.join(', ')
}

/** Serialise every engine transaction on one run (see class invariants). */
export async function lockInstance(tx: Tx, instanceId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "workflow_instances" WHERE "id" = ${instanceId} FOR UPDATE`
}

export function titleOf(row: StepRow, snap?: StepSnapshot | null): string {
  return (snap ?? readSnapshot(row.step_snapshot))?.title ?? 'A step'
}

/** Live non-CC workers of a task. */
export async function taskWorkers(tx: Tx, orgId: string, taskId: string | null): Promise<string[]> {
  if (!taskId) return []
  const rows = await tx.taskAssignee.findMany({
    where: { task_id: taskId, organization_id: orgId, is_cc: false, removed_at: null },
    select: { user_id: true },
  })
  return rows.map((r) => r.user_id)
}

// ═══ Snapshots ═══════════════════════════════════════════════════════════════

/**
 * The frozen step definition for a row. Legacy rows (no snapshot) fall back to the
 * live template step once — scoped to the instance's own template and org — and get
 * frozen. Null when neither exists.
 */
export async function snapshotFor(tx: Tx, row: StepRow, templateId: string): Promise<StepSnapshot | null> {
  const snap = readSnapshot(row.step_snapshot)
  if (snap) return snap
  const live = await tx.workflowStep.findFirst({
    where: { id: row.workflow_step_id, workflow_template_id: templateId, organization_id: row.organization_id },
  })
  if (!live) return null
  const raw = buildStepSnapshot(live)
  const built = applyChecklistTemplates(
    raw,
    await loadChecklistTemplates(tx, row.organization_id, snapshotTemplateIds(raw)),
  )
  await tx.workflowInstanceStep.update({
    where: { id: row.id },
    data: { step_snapshot: built as unknown as Prisma.InputJsonValue },
  })
  return built
}

/**
 * The org's checklist templates a run's steps link to — ONE query per run, scoped
 * by organization_id (a foreign id simply isn't found → the stored copy is used).
 */
export async function loadChecklistTemplates(tx: Tx, orgId: string, ids: string[]): Promise<Map<string, LiveChecklistTemplate>> {
  if (!ids.length) return new Map()
  const rows = await tx.taskChecklistTemplate.findMany({
    where: { id: { in: ids }, organization_id: orgId },
    select: { id: true, name: true, is_active: true, items: true },
  })
  return new Map(rows.map((r) => [r.id, r]))
}

// ═══ People: assignees, CCs, escalation contacts (at activation) ═════════════

/**
 * Who does the step, who is CC'd, and who the task escalates to.
 *  - Assignees / CCs: the snapshot's people who are still active members. Nobody
 *    left → the step's assigner (else the first active editor) does it, with a
 *    warning for `last_error` and the editors.
 *  - Escalation: 'people' → those (active) users as levels 1..n; 'manager' → the
 *    distinct current managers (EmployeeProfile.reporting_to_user_id) of the
 *    assignees, all at level 1; nobody → the workflow's editors, all at level 1.
 *    Someone working the task never escalates to themselves.
 */
export async function resolvePeople(tx: Tx, inst: InstanceCtx, snap: StepSnapshot): Promise<StepPeople> {
  const orgId = inst.organization_id
  let assignees = await activeMembers(tx, orgId, snap.assignee_user_ids)
  let warning: string | null = null
  if (!assignees.length) {
    const [fallback] = await activeMembers(tx, orgId, [snap.assigner_user_id, ...inst.editorIds])
    if (!fallback) {
      throw new BadRequestException(
        `No active person can do “${snap.title}”. Add an active editor, then retry.`,
      )
    }
    const why = snap.assignee_user_ids.length
      ? 'No assignee is active'
      : 'No one is assigned'
    warning = `${why}, so it was assigned to ${await userName(tx, fallback)}.`
    assignees = [fallback]
  }
  const ccs = (await activeMembers(tx, orgId, snap.cc_user_ids)).filter((u) => !assignees.includes(u))

  let escalationLevels: string[][] = []
  let escalationSource: StepPeople['escalationSource'] = 'none'
  if (snap.escalation_mode === 'people') {
    const people = await activeMembers(tx, orgId, snap.escalation_user_ids)
    if (people.length) {
      escalationLevels = people.map((u) => [u])
      escalationSource = 'people'
    }
  } else {
    const profiles = await tx.employeeProfile.findMany({
      where: { organization_id: orgId, user_id: { in: assignees } },
      select: { reporting_to_user_id: true },
    })
    const managers = (
      await activeMembers(
        tx,
        orgId,
        profiles.map((p) => p.reporting_to_user_id),
      )
    ).filter((u) => !assignees.includes(u))
    if (managers.length) {
      escalationLevels = [managers]
      escalationSource = 'manager'
    }
  }
  if (!escalationLevels.length) {
    const editors = (await activeMembers(tx, orgId, inst.editorIds)).filter((u) => !assignees.includes(u))
    if (editors.length) {
      escalationLevels = [editors]
      escalationSource = 'owners_fallback'
    }
  }
  return { assignees, ccs, escalationLevels, escalationSource, warning }
}

export function timingCtx(inst: Pick<InstanceCtx, 'started_at'>, snap: Pick<StepSnapshot, 'timing_every'>, tz: string): TimingContext {
  return { tz, runStart: inst.started_at, every: snap.timing_every ?? 1 }
}

/**
 * "1 note from B1 “Budget check”." for the live discussion messages left for `rowId`
 * ("For <step>"; null when none). A message's source is the step its author works on
 * in this instance (their latest step there as a non-CC assignee), else the author's name.
 */
export async function notesSummary(db: Tx, inst: Pick<InstanceCtx, 'id' | 'organization_id'>, rowId: string): Promise<string | null> {
  const orgId = inst.organization_id
  const notes = (
    await db.taskComment.findMany({
      where: { organization_id: orgId, workflow_instance_id: inst.id, for_instance_step_id: rowId, is_deleted: false },
      select: { user_id: true },
      orderBy: { created_at: 'asc' },
    })
  ).map((n) => ({ author_user_id: n.user_id }))
  if (!notes.length) return null
  const authors = Array.from(new Set(notes.map((n) => n.author_user_id)))
  const rows = await db.workflowInstanceStep.findMany({
    where: { workflow_instance_id: inst.id, organization_id: orgId, task_id: { not: null } },
    select: { id: true, task_id: true, step_snapshot: true, task_created_at: true },
    orderBy: { task_created_at: 'desc' },
  })
  const workedOn = rows.length
    ? await db.taskAssignee.findMany({
        where: {
          organization_id: orgId,
          task_id: { in: rows.map((r) => r.task_id!) },
          user_id: { in: authors },
          is_cc: false,
          removed_at: null,
        },
        select: { task_id: true, user_id: true },
      })
    : []
  const sources: string[] = []
  for (const author of authors) {
    const tasks = new Set(workedOn.filter((w) => w.user_id === author).map((w) => w.task_id))
    const own = rows.find((r) => r.id !== rowId && tasks.has(r.task_id!))
    const snap = own ? readSnapshot(own.step_snapshot) : null
    const label = snap ? [snap.number_label, `“${snap.title}”`].filter(Boolean).join(' ') : await userName(db, author)
    if (!sources.includes(label)) sources.push(label)
  }
  return `${notes.length} note${notes.length === 1 ? '' : 's'} from ${sources.join(', ')}.`
}

// ═══ Task withdrawal ═════════════════════════════════════════════════════════

/**
 * Withdraw a step's task (cancel / skip): soft-delete + archive snapshot + activity
 * entry, the same shape TasksService.deleteTask leaves. A task already closed
 * (completed / incomplete) is a record and is left alone. Returns the working
 * assignees of a withdrawn task (for notifications).
 */
export async function withdrawTask(
  tx: Tx,
  orgId: string,
  taskId: string | null,
  actorUserId: string,
  reason: string,
  now: Date,
): Promise<{ withdrawn: boolean; assigneeIds: string[]; title: string | null }> {
  if (!taskId) return { withdrawn: false, assigneeIds: [], title: null }
  const task = await tx.task.findFirst({
    where: { id: taskId, organization_id: orgId, is_deleted: false },
    include: { status: { select: { type: true } }, assignees: true, checklist: true },
  })
  if (!task || TERMINAL_TASK_TYPES.includes(task.status.type)) {
    return { withdrawn: false, assigneeIds: [], title: task?.title ?? null }
  }
  await tx.taskArchive.create({
    data: {
      organization_id: orgId,
      original_task_id: taskId,
      task_snapshot: JSON.parse(JSON.stringify(task)) as Prisma.InputJsonValue,
      deleted_by_user_id: actorUserId,
      deletion_reason: reason,
      deleted_at: now,
    },
  })
  await tx.task.update({
    where: { id: taskId },
    data: { is_deleted: true, deleted_by_user_id: actorUserId, deleted_at: now, deletion_reason: reason },
  })
  await tx.taskActivityLog.create({
    data: { organization_id: orgId, task_id: taskId, performed_by_user_id: actorUserId, action: 'deleted', metadata: { reason, source: 'workflow' } },
  })
  return {
    withdrawn: true,
    assigneeIds: task.assignees.filter((a) => !a.is_cc && !a.removed_at).map((a) => a.user_id),
    title: task.title,
  }
}

// ═══ Activation / settling the graph ═════════════════════════════════════════

export async function requireSnapshot(tx: Tx, inst: InstanceCtx, row: StepRow): Promise<StepSnapshot> {
  const snap = await snapshotFor(tx, row, inst.workflow_template_id)
  if (!snap) {
    throw new BadRequestException(
      'A step was deleted from the workflow before it ran. Skip the step or cancel the instance.',
    )
  }
  return snap
}

export async function loadInstanceCtx(
  db: Tx,
  orgId: string,
  instanceId: string,
): Promise<(InstanceCtx & { status: string; current_step_id: string | null; last_error: string | null }) | null> {
  const inst = await db.workflowInstance.findFirst({
    where: { id: instanceId, organization_id: orgId },
    include: { template: { select: { name: true, ...EDITORS_SELECT } } },
  })
  if (!inst) return null
  return {
    id: inst.id,
    organization_id: inst.organization_id,
    workflow_template_id: inst.workflow_template_id,
    name: inst.name,
    started_at: inst.started_at,
    templateName: inst.template.name,
    editorIds: editorsOf(inst.template),
    status: inst.status,
    current_step_id: inst.current_step_id,
    last_error: inst.last_error,
  }
}

/**
 * The next instance number of a workflow (1, 2, …), handed out atomically. Raw SQL on
 * purpose: the row lock serialises concurrent starts of the same workflow for the rest
 * of the transaction (so the name check below can't race), and it must not touch
 * `updated_at` (the builder's save-conflict check) or write an audit diff.
 */
export async function nextInstanceNumber(tx: Tx, orgId: string, templateId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ instance_seq: number }[]>`
    UPDATE "workflow_templates" SET "instance_seq" = "instance_seq" + 1
    WHERE "id" = ${templateId} AND "organization_id" = ${orgId}
    RETURNING "instance_seq"`
  if (!rows.length) throw new NotFoundException('Workflow not found')
  return Number(rows[0].instance_seq)
}

/**
 * The instance's name. A typed name (the Run dialog) is kept as typed (trimmed, inner
 * spaces collapsed) and must be unique within the workflow, case- and space-
 * insensitively — a clash is a 400 with `code: 'instance_name_taken'`. Otherwise (a
 * schedule, or an older caller without a name) "<Workflow name> — 3 Nov 2026", with
 * " (2)", " (3)"… when that is taken. Runs after `nextInstanceNumber` (template row
 * locked), so two starts can't pick the same name.
 */
export async function instanceName(
  tx: Tx,
  orgId: string,
  templateId: string,
  templateName: string,
  context: Record<string, unknown>,
  now: Date,
  tz: string,
): Promise<{ name: string; name_key: string; typed: boolean }> {
  const typed = typeof context.name === 'string' ? tidyInstanceName(context.name) : ''
  if (typed) {
    const key = instanceNameKey(typed)
    const clash = await tx.workflowInstance.findFirst({
      where: { workflow_template_id: templateId, organization_id: orgId, name_key: key },
      select: { id: true },
    })
    if (clash) throw instanceNameTaken()
    return { name: typed, name_key: key, typed: true }
  }
  const base = tidyInstanceName(`${templateName} — ${dayMonthYear(now, tz)}`)
  const baseKey = instanceNameKey(base)
  const taken = new Set(
    (
      await tx.workflowInstance.findMany({
        where: { workflow_template_id: templateId, organization_id: orgId, name_key: { startsWith: baseKey } },
        select: { name_key: true },
      })
    ).map((r) => r.name_key),
  )
  let name = base
  for (let n = 2; taken.has(instanceNameKey(name)); n++) name = `${base} (${n})`
  return { name, name_key: instanceNameKey(name), typed: false }
}

/** Completed rows upstream of `fromRowId`, nearest first (direct predecessors first). */
export function sendBackCandidates(rows: StepRow[], fromRowId: string): StepRow[] {
  const up = upstreamOf(rowDependencies(rows), fromRowId)
  return flowRows(rows)
    .filter((r) => up.has(r.id) && r.status === 'completed')
    .sort((a, b) => up.get(a.id)! - up.get(b.id)! || a.order_index - b.order_index)
}
