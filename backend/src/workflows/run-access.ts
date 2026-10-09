import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Who is "involved in a workflow run" (workflows v2 spec, decision 6 / §C).
 *
 * A run participant is anyone who:
 *   - owns, created, or holds an `edit` grant on the run's workflow, or started the run; or
 *   - is on the LIVE roster (assignee or CC) of any task the run created; or
 *   - is an active escalation contact (TaskEscalation) of any task the run created.
 *
 * Admins are not listed here — callers apply the app's admin bypass themselves
 * (`Principal.isAdmin` / super admin), exactly as the template capability model does.
 *
 * Plain functions over Prisma (no DI) so both the workflows API and the task access
 * gate (`TasksService.assertParticipantView`) share ONE definition without a module
 * cycle. Every query is scoped by `organization_id` (AUTHORIZATION.md rule 3).
 */

type Db = PrismaService | Prisma.TransactionClient

function idsFromJson(v: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** Task-level participation filter: live assignee/CC or active escalation contact. */
export function taskParticipantWhere(userId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { assignees: { some: { user_id: userId, removed_at: null } } },
      { escalations: { some: { escalate_to_user_id: userId, is_active: true } } },
    ],
  }
}

/** True when `userId` is on any (non-deleted) task the run created. */
export async function isRunTaskParticipant(
  db: Db,
  orgId: string,
  instanceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db.workflowInstanceStep.findMany({
    where: { workflow_instance_id: instanceId, organization_id: orgId, task_id: { not: null } },
    select: { task_id: true },
  })
  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x))]
  if (!taskIds.length) return false
  const hit = await db.task.findFirst({
    where: { id: { in: taskIds }, organization_id: orgId, is_deleted: false, ...taskParticipantWhere(userId) },
    select: { id: true },
  })
  return !!hit
}

/**
 * True when `userId` participates in the run (see file header). Fails closed: an
 * instance outside this org is "not a participant".
 */
export async function isRunParticipant(db: Db, orgId: string, instanceId: string, userId: string): Promise<boolean> {
  const inst = await db.workflowInstance.findFirst({
    where: { id: instanceId, organization_id: orgId },
    select: {
      triggered_by_user_id: true,
      template: {
        select: {
          created_by_user_id: true,
          owner_user_ids: true,
          access: { where: { user_id: userId, access_type: 'edit' }, select: { access_type: true } },
        },
      },
    },
  })
  if (!inst) return false
  if (
    inst.triggered_by_user_id === userId ||
    inst.template.created_by_user_id === userId ||
    idsFromJson(inst.template.owner_user_ids).includes(userId) ||
    inst.template.access.length > 0
  ) {
    return true
  }
  return isRunTaskParticipant(db, orgId, instanceId, userId)
}

/**
 * The run a workflow step task belongs to, by the task's `workflow_instance_step_id`.
 * Null when the row is gone or belongs to another org.
 */
export async function instanceIdForRow(db: Db, orgId: string, rowId: string): Promise<string | null> {
  const row = await db.workflowInstanceStep.findFirst({
    where: { id: rowId, organization_id: orgId },
    select: { workflow_instance_id: true },
  })
  return row?.workflow_instance_id ?? null
}

/**
 * Ids of the runs (optionally of one template) in which `userId` is on a task —
 * live assignee/CC or active escalation contact — or which they started. Used to
 * list the runs a caller may open without template access.
 *
 * `opts.assigneesOnly` narrows to non-CC live assignees ("assigned to me").
 */
export async function participantInstanceIds(
  db: Db,
  orgId: string,
  userId: string,
  opts: { templateId?: string; assigneesOnly?: boolean; includeStarted?: boolean } = {},
): Promise<string[]> {
  const taskWhere: Prisma.TaskWhereInput = opts.assigneesOnly
    ? { assignees: { some: { user_id: userId, removed_at: null, is_cc: false } } }
    : taskParticipantWhere(userId)
  const [tasks, started] = await Promise.all([
    db.task.findMany({
      where: { organization_id: orgId, is_deleted: false, workflow_instance_step_id: { not: null }, ...taskWhere },
      select: { workflow_instance_step_id: true },
    }),
    opts.includeStarted
      ? db.workflowInstance.findMany({
          where: {
            organization_id: orgId,
            triggered_by_user_id: userId,
            ...(opts.templateId ? { workflow_template_id: opts.templateId } : {}),
          },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ])
  const rowIds = [...new Set(tasks.map((t) => t.workflow_instance_step_id).filter((x): x is string => !!x))]
  const rows = rowIds.length
    ? await db.workflowInstanceStep.findMany({
        where: {
          id: { in: rowIds },
          organization_id: orgId,
          ...(opts.templateId ? { instance: { workflow_template_id: opts.templateId } } : {}),
        },
        select: { workflow_instance_id: true },
      })
    : []
  return [...new Set([...rows.map((r) => r.workflow_instance_id), ...started.map((s) => s.id)])]
}
