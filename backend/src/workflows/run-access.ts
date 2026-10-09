import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Who may see a workflow and its instances (workflows spec "people, access, instances").
 *
 *  - The workflow DESIGN and the list of ALL its instances: admins, editors (the
 *    creator — permanent — and `edit` grants) and viewers (`view` grants).
 *  - ONE instance additionally: the person who ran it, and everyone working in it —
 *    the assignees and CCs of any of its step tasks (live roster) and the escalation
 *    contacts of those tasks. Tasks the instance withdrew (cancel / skip) still count:
 *    access to a past instance follows who worked in it, so someone later replaced on
 *    a step keeps the instances they worked in, and new instances follow the current
 *    assignees.
 *
 * Admins are not listed here — callers apply the app's admin bypass themselves
 * (`Principal.isAdmin` / super admin). Owners (`owner_user_ids`) are retired from
 * access and never read here.
 *
 * Plain functions over Prisma (no DI) so both the workflows API and the task access
 * gate (`TasksService.assertParticipantView`) share ONE definition without a module
 * cycle. Every query is scoped by `organization_id` (AUTHORIZATION.md rule 3).
 */

type Db = PrismaService | Prisma.TransactionClient

/** Task-level participation filter: live assignee/CC or an escalation contact. */
export function taskParticipantWhere(userId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { assignees: { some: { user_id: userId, removed_at: null } } },
      { escalations: { some: { escalate_to_user_id: userId } } },
    ],
  }
}

/** The caller's role on a workflow from its creator + their own grants (no admin bypass). */
export function workflowRoleOf(
  t: { created_by_user_id: string; access: { access_type: string }[] },
  userId: string,
): { isCreator: boolean; isEditor: boolean; isViewer: boolean; isStarter: boolean } {
  const grants = t.access.map((a) => a.access_type)
  const isCreator = t.created_by_user_id === userId
  const isEditor = isCreator || grants.includes('edit')
  return { isCreator, isEditor, isViewer: !isEditor && grants.includes('view'), isStarter: grants.includes('trigger') }
}

/** True when `userId` is on any task the instance created (withdrawn tasks included). */
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
    where: { id: { in: taskIds }, organization_id: orgId, ...taskParticipantWhere(userId) },
    select: { id: true },
  })
  return !!hit
}

/**
 * True when `userId` may see the instance without an admin bypass: an editor or viewer
 * of its workflow, the person who ran it, or someone working in it (see file header).
 * Fails closed: an instance outside this org is "not a participant".
 */
export async function isRunParticipant(db: Db, orgId: string, instanceId: string, userId: string): Promise<boolean> {
  const inst = await db.workflowInstance.findFirst({
    where: { id: instanceId, organization_id: orgId },
    select: {
      triggered_by_user_id: true,
      template: {
        select: {
          created_by_user_id: true,
          access: { where: { user_id: userId, access_type: { in: ['edit', 'view'] } }, select: { access_type: true } },
        },
      },
    },
  })
  if (!inst) return false
  if (
    inst.triggered_by_user_id === userId ||
    inst.template.created_by_user_id === userId ||
    inst.template.access.length > 0
  ) {
    return true
  }
  return isRunTaskParticipant(db, orgId, instanceId, userId)
}

/**
 * The instance a workflow step task belongs to, by the task's `workflow_instance_step_id`.
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
 * Ids of the instances (optionally of one workflow) in which `userId` works — live
 * assignee/CC or escalation contact of one of its tasks, withdrawn tasks included —
 * or, with `includeStarted`, which they ran. Used to list the instances a caller may
 * open without design access to the workflow.
 *
 * `opts.assigneesOnly` narrows to non-CC live assignees ("assigned to me").
 */
export async function participantInstanceIds(
  db: Db,
  orgId: string,
  userId: string,
  opts: { templateId?: string; templateIds?: string[]; assigneesOnly?: boolean; includeStarted?: boolean } = {},
): Promise<string[]> {
  const taskWhere: Prisma.TaskWhereInput = opts.assigneesOnly
    ? { assignees: { some: { user_id: userId, removed_at: null, is_cc: false } } }
    : taskParticipantWhere(userId)
  const templateFilter: Prisma.WorkflowInstanceWhereInput = opts.templateId
    ? { workflow_template_id: opts.templateId }
    : opts.templateIds
      ? { workflow_template_id: { in: opts.templateIds } }
      : {}
  const [tasks, started] = await Promise.all([
    db.task.findMany({
      where: { organization_id: orgId, workflow_instance_step_id: { not: null }, ...taskWhere },
      select: { workflow_instance_step_id: true },
    }),
    opts.includeStarted
      ? db.workflowInstance.findMany({
          where: { organization_id: orgId, triggered_by_user_id: userId, ...templateFilter },
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
          ...(opts.templateId || opts.templateIds ? { instance: templateFilter } : {}),
        },
        select: { workflow_instance_id: true },
      })
    : []
  return [...new Set([...rows.map((r) => r.workflow_instance_id), ...started.map((s) => s.id)])]
}

/** Normalised instance name for uniqueness: trimmed, inner whitespace collapsed, lower-cased. */
export function instanceNameKey(name: string): string {
  return tidyInstanceName(name).toLowerCase()
}

/** An instance name as stored: trimmed, inner whitespace collapsed to one space. */
export function tidyInstanceName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}
