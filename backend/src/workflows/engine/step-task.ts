import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ACTIVE_ASSIGNEE } from '../../tasks/active-assignee'
import { StepSnapshot } from './snapshot'

/**
 * System task operations for workflow step tasks (workflows v2 §B). Everything here
 * runs INSIDE the engine's transaction with direct Prisma writes — never through
 * TasksService (whose create/reopen paths are user-centric and gated, and which
 * depends on the engine, so it can't be injected back).
 *
 * The side effects deliberately mirror TasksService:
 *  - createStepTask ≈ createTask (assignees + CCs, checklist, tags, escalation rows,
 *    the org's default reminder, `created` activity entry);
 *  - reopenTaskForWorkflow ≈ reopenTask (status back to open, completion stamps and
 *    per-assignee flags cleared, `reopened_at`, `reopened` activity entry) plus a new
 *    deadline recorded as a deadline revision;
 *  - moveTaskDeadline ≈ updateTask's deadline revision (TaskDeadlineRevision row,
 *    revision count, relative reminders re-hung, overdue flag cleared when ahead).
 */

type Tx = Prisma.TransactionClient

/** TaskMaster.default_reminder_days_before's schema default. */
const DEFAULT_REMINDER_DAYS = 1

export interface CreateStepTaskArgs {
  orgId: string
  instanceId: string
  rowId: string
  snap: StepSnapshot
  /** Non-CC assignees — already filtered to active members, ≥1. */
  assigneeIds: string[]
  /** CCs — already filtered to active members, never overlapping assignees. */
  ccIds: string[]
  /** TaskEscalation rows: index 0 = level 1. Several users may share a level. */
  escalationLevels: string[][]
  statusId: string
  deadline: Date
  now: Date
}

export async function createStepTask(tx: Tx, a: CreateStepTaskArgs): Promise<string> {
  const { orgId, snap } = a
  // A master / tag deleted or deactivated since the step was designed must not fail
  // the task — it is simply left off.
  const priorityId = snap.priority_id
    ? (await tx.taskPriority.findFirst({ where: { id: snap.priority_id, organization_id: orgId }, select: { id: true } }))?.id
    : undefined
  const categoryId = snap.category_id
    ? (await tx.taskCategory.findFirst({ where: { id: snap.category_id, organization_id: orgId }, select: { id: true } }))?.id
    : undefined
  const tagIds = snap.tag_ids.length
    ? (
        await tx.taskTag.findMany({
          where: { id: { in: snap.tag_ids }, organization_id: orgId, is_active: true },
          select: { id: true },
        })
      ).map((t) => t.id)
    : []
  const items = snap.checklist_items ?? []

  const task = await tx.task.create({
    data: {
      organization_id: orgId,
      title: snap.title,
      description: snap.description ?? undefined,
      quadrant: 'Q2',
      type: 'one_time',
      status_id: a.statusId,
      priority_id: priorityId ?? undefined,
      category_id: categoryId ?? undefined,
      proof_required: snap.proof_required,
      proof_allowed_extensions: snap.proof_allowed_extensions ?? [],
      completion_mode: snap.completion_mode,
      created_by_user_id: snap.assigner_user_id,
      deadline: a.deadline,
      // Frozen compliance baseline, same as every other task-creation path.
      original_deadline: a.deadline,
      workflow_instance_step_id: a.rowId,
      // Org clock: a test org's simulated "now", so the task is never "from the future".
      created_at: a.now,
      assignees: {
        create: [
          ...a.assigneeIds.map((user_id) => ({ organization_id: orgId, user_id, is_cc: false })),
          ...a.ccIds.map((user_id) => ({ organization_id: orgId, user_id, is_cc: true })),
        ],
      },
      checklist: items.length
        ? {
            create: items.map((it, idx) => ({
              organization_id: orgId,
              title: it.title,
              group_title: it.group_title ?? null,
              order_index: typeof it.order_index === 'number' ? it.order_index : idx,
            })),
          }
        : undefined,
    },
    select: { id: true },
  })

  if (tagIds.length) {
    await tx.taskTagLink.createMany({
      data: tagIds.map((tag_id) => ({
        organization_id: orgId,
        task_id: task.id,
        tag_id,
        created_by_user_id: snap.assigner_user_id,
      })),
      skipDuplicates: true,
    })
  }

  const escalationRows = a.escalationLevels.flatMap((users, idx) =>
    users.map((uid) => ({
      organization_id: orgId,
      task_id: task.id,
      level: idx + 1,
      escalate_to_user_id: uid,
      is_active: true,
    })),
  )
  if (escalationRows.length) await tx.taskEscalation.createMany({ data: escalationRows })

  await createDefaultReminder(tx, orgId, task.id, a.deadline, a.now)

  await tx.taskActivityLog.create({
    data: {
      organization_id: orgId,
      task_id: task.id,
      performed_by_user_id: snap.assigner_user_id,
      action: 'created',
      metadata: { source: 'workflow', workflow_instance_id: a.instanceId, workflow_instance_step_id: a.rowId },
    },
  })
  return task.id
}

/**
 * The org's default assignee reminder (`default_reminder_days_before` days before the
 * deadline), exactly like createTask's legacy default — but stored with
 * `offset_days`, so any later deadline move re-hangs it instead of leaving it behind.
 */
async function createDefaultReminder(tx: Tx, orgId: string, taskId: string, deadline: Date, now: Date): Promise<void> {
  const master = await tx.taskMaster.findUnique({
    where: { organization_id: orgId },
    select: { default_reminder_days_before: true },
  })
  const days = master?.default_reminder_days_before ?? DEFAULT_REMINDER_DAYS
  const remindAt = new Date(deadline)
  remindAt.setDate(remindAt.getDate() - days)
  if (remindAt.getTime() <= now.getTime()) return
  await tx.taskReminder.create({
    data: { organization_id: orgId, task_id: taskId, remind_at: remindAt, type: 'assignee', offset_days: days },
  })
}

/**
 * Re-hang the task's unsent one-time RELATIVE reminders off a new deadline (same rule
 * as TasksService.recomputeRemindersForDeadline); when none is left pending, give the
 * task a fresh default reminder.
 */
async function rehangReminders(tx: Tx, orgId: string, taskId: string, newDeadline: Date, now: Date): Promise<void> {
  const pending = await tx.taskReminder.findMany({
    where: { task_id: taskId, organization_id: orgId, is_sent: false, recurrence: 'one_time', offset_days: { not: null } },
  })
  const stale: string[] = []
  for (const r of pending) {
    const prev = new Date(r.remind_at)
    const next = new Date(newDeadline)
    next.setDate(next.getDate() - (r.offset_days ?? 0))
    next.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
    if (next <= now || next > newDeadline) {
      stale.push(r.id)
      continue
    }
    if (next.getTime() !== prev.getTime()) {
      await tx.taskReminder.update({ where: { id: r.id }, data: { remind_at: next } })
    }
  }
  if (stale.length) await tx.taskReminder.deleteMany({ where: { id: { in: stale } } })
  const left = await tx.taskReminder.count({ where: { task_id: taskId, organization_id: orgId, is_sent: false } })
  if (left === 0) await createDefaultReminder(tx, orgId, taskId, newDeadline, now)
}

/**
 * Move a step task's deadline as a recorded revision: TaskDeadlineRevision row,
 * revision count, `edited` activity entry, reminders re-hung, and the persisted
 * overdue flag cleared when the new deadline is ahead (the hourly sweep re-flags it
 * otherwise). No-op when the deadline doesn't change.
 */
export async function moveTaskDeadline(
  tx: Tx,
  a: { orgId: string; taskId: string; newDeadline: Date; actorUserId: string; reason: string; now: Date },
): Promise<void> {
  const task = await tx.task.findFirst({
    where: { id: a.taskId, organization_id: a.orgId },
    select: { deadline: true, original_deadline: true },
  })
  if (!task) return
  if (task.deadline && task.deadline.getTime() === a.newDeadline.getTime()) return
  const ahead = a.newDeadline.getTime() > a.now.getTime()
  await tx.task.update({
    where: { id: a.taskId },
    data: {
      deadline: a.newDeadline,
      ...(task.deadline
        ? { deadline_revision_count: { increment: 1 }, ...(task.original_deadline ? {} : { original_deadline: task.deadline }) }
        : { original_deadline: a.newDeadline }),
      ...(ahead ? { is_overdue: false, overdue_at: null } : {}),
    },
  })
  if (task.deadline) {
    await tx.taskDeadlineRevision.create({
      data: {
        organization_id: a.orgId,
        task_id: a.taskId,
        from_deadline: task.deadline,
        to_deadline: a.newDeadline,
        reason: a.reason,
        changed_by_user_id: a.actorUserId,
        changed_at: a.now,
      },
    })
  }
  await tx.taskActivityLog.create({
    data: {
      organization_id: a.orgId,
      task_id: a.taskId,
      performed_by_user_id: a.actorUserId,
      action: 'edited',
      metadata: {
        source: 'workflow',
        field: 'deadline',
        from: task.deadline?.toISOString() ?? null,
        to: a.newDeadline.toISOString(),
        reason: a.reason,
      },
    },
  })
  await rehangReminders(tx, a.orgId, a.taskId, a.newDeadline, a.now)
}

/**
 * SYSTEM reopen of a closed step task (send back). Mirrors TasksService.reopenTask —
 * status back to the open status reopenTask would land on (in-progress, else the
 * default; a per-person task re-derives to not-started since every track is
 * cleared), completion stamps and every live assignee's completion / can't-complete
 * flags cleared, `reopened_at` stamped, `reopened` activity entry — then moves the
 * deadline to `newDeadline` (a recorded revision) and re-arms the task's escalations
 * so lateness against the new deadline escalates again. No permission checks: the
 * caller (the engine) has already authorised the send back.
 */
export async function reopenTaskForWorkflow(
  tx: Tx,
  a: { orgId: string; taskId: string; actorUserId: string; newDeadline: Date; now: Date; reason: string },
): Promise<void> {
  const task = await tx.task.findFirst({
    where: { id: a.taskId, organization_id: a.orgId, is_deleted: false },
    select: { id: true, status_id: true, completion_mode: true },
  })
  if (!task) throw new BadRequestException('That step’s task no longer exists, so the run can’t be sent back to it.')

  const statusOf = (type: 'in_progress' | 'not_started') =>
    tx.taskStatus.findFirst({
      where: { organization_id: a.orgId, type, is_active: true },
      orderBy: { order_index: 'asc' },
      select: { id: true },
    })
  const inProgress = await statusOf('in_progress')
  const notStarted = task.completion_mode === 'all_must_complete' ? await statusOf('not_started') : null
  const fallback = await tx.taskStatus.findFirst({
    where: { organization_id: a.orgId, is_default: true, is_active: true },
    orderBy: { order_index: 'asc' },
    select: { id: true },
  })
  const statusId = notStarted?.id ?? inProgress?.id ?? fallback?.id ?? task.status_id

  await tx.task.update({
    where: { id: a.taskId },
    data: {
      status_id: statusId,
      reopen_expires_at: null,
      reopened_at: a.now,
      is_overdue: false,
      overdue_at: null,
      completed_at: null,
      completion_timing: null,
      completed_by_user_id: null,
      incomplete_reason: null,
    },
  })
  await tx.taskAssignee.updateMany({
    where: { task_id: a.taskId, ...ACTIVE_ASSIGNEE },
    data: {
      is_completed: false,
      completed_at: null,
      status_id: null,
      cannot_complete: false,
      cannot_complete_reason: null,
      cannot_complete_at: null,
    },
  })
  await tx.taskActivityLog.create({
    data: {
      organization_id: a.orgId,
      task_id: a.taskId,
      performed_by_user_id: a.actorUserId,
      action: 'reopened',
      metadata: { source: 'workflow', reason: a.reason },
    },
  })
  await moveTaskDeadline(tx, { ...a, reason: a.reason })
  // A fresh deadline is a fresh escalation cycle.
  await tx.taskEscalation.updateMany({
    where: { task_id: a.taskId, organization_id: a.orgId, is_active: true },
    data: { escalated_at: null, is_acknowledged: false, acknowledged_at: null },
  })
}

/**
 * Pause / resume a task's unfired escalations (a step paused by a send back must not
 * escalate while it waits). Pausing deactivates only rows that have not fired yet;
 * resuming re-activates exactly those (fired rows are never deactivated, so an
 * inactive unfired row always means "paused").
 */
export async function setEscalationsPaused(tx: Tx, orgId: string, taskId: string, paused: boolean): Promise<void> {
  await tx.taskEscalation.updateMany({
    where: { task_id: taskId, organization_id: orgId, escalated_at: null, is_active: paused },
    data: { is_active: !paused },
  })
}
