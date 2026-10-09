import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isBranchRow, readSnapshot } from './engine/snapshot'
import { safeTimeZone } from './engine/tz'
import { SCHEDULE_START } from './engine/schedule'
import { instanceLabel } from './instance-label'
import { taskParticipantWhere } from './run-access'

type Db = PrismaService | Prisma.TransactionClient

/**
 * The compact workflow block on a task list row / task detail (`task.workflow`) for a
 * task a workflow created (`Task.workflow_instance_step_id`); `null` on every other task.
 * Drives the ⟳ instance badge instead of "Self" / "From <assigner>".
 */
export interface TaskWorkflowInfo {
  instance_id: string
  template_id: string
  template_name: string
  instance_name: string
  /** "ACME onboarding · 3 Nov" (manual) / "Vendor onboarding · 3 Nov" (schedule); year added when not this year. */
  label: string
  /** "Instance #12". */
  instance_number: number
  /** "2", "B1" — the step's number in its instance. */
  step_label: string | null
  step_title: string
  total_steps: number
  /** Who ran it; null when a schedule started it. */
  started_by_name: string | null
  is_scheduled: boolean
  /**
   * May the viewer open the instance page (admin, editor, viewer, the person who ran
   * it, or someone working in it)? null when the response has no viewer (an internal
   * post-mutation read) — keep the value you already have.
   */
  can_open: boolean | null
}

export interface TaskWorkflowViewer {
  userId: string
  isAdmin: boolean
}

/**
 * Workflow info for a batch of tasks — a fixed number of queries whatever the batch
 * size (never per task). Every lookup is constrained to the task's own organization
 * (a row/instance of another org is ignored), so it can't leak across tenants. It adds
 * nothing to what the caller may see: it only labels tasks the caller already sees.
 */
export async function taskWorkflowInfo(
  db: Db,
  tasks: { id: string; organization_id: string; workflow_instance_step_id?: string | null }[],
  viewer: TaskWorkflowViewer | null,
  nowFor: (orgId: string) => Promise<Date>,
): Promise<Map<string, TaskWorkflowInfo>> {
  const out = new Map<string, TaskWorkflowInfo>()
  const linked = tasks.filter((t) => !!t.workflow_instance_step_id)
  if (!linked.length) return out

  const rowIds = [...new Set(linked.map((t) => t.workflow_instance_step_id!))]
  const ownRows = await db.workflowInstanceStep.findMany({
    where: { id: { in: rowIds } },
    select: { id: true, organization_id: true, workflow_instance_id: true },
  })
  const rowById = new Map(ownRows.map((r) => [r.id, r]))
  const instanceIds = [...new Set(ownRows.map((r) => r.workflow_instance_id))]
  if (!instanceIds.length) return out

  const [instances, allRows] = await Promise.all([
    db.workflowInstance.findMany({
      where: { id: { in: instanceIds } },
      select: {
        id: true,
        organization_id: true,
        workflow_template_id: true,
        name: true,
        trigger_type: true,
        metadata: true,
        started_at: true,
        instance_number: true,
        triggered_by_user_id: true,
        template: {
          select: {
            name: true,
            created_by_user_id: true,
            access: viewer
              ? { where: { user_id: viewer.userId, access_type: { in: ['edit', 'view'] } }, select: { access_type: true } }
              : { where: { id: '__none__' }, select: { access_type: true } },
          },
        },
      },
    }),
    db.workflowInstanceStep.findMany({
      where: { workflow_instance_id: { in: instanceIds } },
      select: { id: true, organization_id: true, workflow_instance_id: true, task_id: true, step_snapshot: true, order_index: true },
    }),
  ])
  const instById = new Map(instances.map((i) => [i.id, i]))
  const orgIds = [...new Set(instances.map((i) => i.organization_id))]

  // Steps of each instance (legacy escalation rows are not steps).
  const flowByInstance = new Map<string, typeof allRows>()
  for (const r of allRows) {
    const inst = instById.get(r.workflow_instance_id)
    if (!inst || inst.organization_id !== r.organization_id) continue
    if (isBranchRow(r)) continue
    const list = flowByInstance.get(r.workflow_instance_id) ?? []
    list.push(r)
    flowByInstance.set(r.workflow_instance_id, list)
  }

  const [orgs, users, worked] = await Promise.all([
    db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, timezone: true } }),
    db.user.findMany({
      where: { id: { in: [...new Set(instances.map((i) => i.triggered_by_user_id).filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    }),
    viewer
      ? (async () => {
          const taskIds = allRows.map((r) => r.task_id).filter((x): x is string => !!x)
          if (!taskIds.length) return [] as { workflow_instance_step_id: string | null; organization_id: string }[]
          return db.task.findMany({
            where: { id: { in: taskIds }, ...taskParticipantWhere(viewer.userId) },
            select: { workflow_instance_step_id: true, organization_id: true },
          })
        })()
      : Promise.resolve([] as { workflow_instance_step_id: string | null; organization_id: string }[]),
  ])
  const tzOf = new Map(orgs.map((o) => [o.id, safeTimeZone(o.timezone)]))
  const nameOf = new Map(users.map((u) => [u.id, u.name]))
  const allRowById = new Map(allRows.map((r) => [r.id, r]))
  const worksIn = new Set<string>()
  for (const w of worked) {
    const r = w.workflow_instance_step_id ? allRowById.get(w.workflow_instance_step_id) : undefined
    if (r && r.organization_id === w.organization_id) worksIn.add(r.workflow_instance_id)
  }
  const nows = new Map<string, Date>()
  for (const orgId of orgIds) nows.set(orgId, await nowFor(orgId))

  for (const t of linked) {
    const row = rowById.get(t.workflow_instance_step_id!)
    if (!row || row.organization_id !== t.organization_id) continue
    const inst = instById.get(row.workflow_instance_id)
    if (!inst || inst.organization_id !== t.organization_id) continue
    const flow = [...(flowByInstance.get(inst.id) ?? [])].sort((a, b) => a.order_index - b.order_index)
    const own = allRowById.get(row.id)
    const snap = own ? readSnapshot(own.step_snapshot) : null
    const index = flow.findIndex((r) => r.id === row.id)
    const canOpen = viewer
      ? viewer.isAdmin ||
        inst.template.created_by_user_id === viewer.userId ||
        inst.template.access.length > 0 ||
        inst.triggered_by_user_id === viewer.userId ||
        worksIn.has(inst.id)
      : null
    out.set(t.id, {
      instance_id: inst.id,
      template_id: inst.workflow_template_id,
      template_name: inst.template.name,
      instance_name: inst.name,
      label: instanceLabel(inst, inst.template.name, tzOf.get(inst.organization_id) ?? safeTimeZone(null), nows.get(inst.organization_id) ?? new Date()),
      instance_number: inst.instance_number,
      step_label: snap?.number_label ?? (index >= 0 ? `${index + 1}` : null),
      step_title: snap?.title ?? 'Step',
      total_steps: flow.length,
      started_by_name: inst.triggered_by_user_id ? nameOf.get(inst.triggered_by_user_id) ?? 'Unknown user' : null,
      is_scheduled: inst.trigger_type === SCHEDULE_START,
      can_open: canOpen,
    })
  }
  return out
}
