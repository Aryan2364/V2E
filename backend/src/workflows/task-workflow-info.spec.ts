import { ForbiddenException } from '@nestjs/common'
import { taskWorkflowInfo } from './task-workflow-info'
import { instanceLabel, shortDate } from './instance-label'
import { TasksService } from '../tasks/tasks.service'

const ORG = 'org-1'
const NOW = new Date('2026-11-10T06:00:00Z')
const now = async () => NOW

/** Step rows of instance i-1 (3 steps) and i-2 (scheduled, 2 steps); r-x belongs to another org. */
function makeDb(over: { worksIn?: string[] } = {}) {
  const rows = [
    { id: 'r-1', organization_id: ORG, workflow_instance_id: 'i-1', task_id: 't-1', order_index: 0, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'Collect', number_label: '1' } },
    { id: 'r-2', organization_id: ORG, workflow_instance_id: 'i-1', task_id: 't-2', order_index: 1, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'Approve', number_label: '2' } },
    { id: 'r-3', organization_id: ORG, workflow_instance_id: 'i-1', task_id: null, order_index: 2, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'Pay', number_label: 'B1' } },
    { id: 'r-esc', organization_id: ORG, workflow_instance_id: 'i-1', task_id: null, order_index: 3, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'Esc', is_branch: true } },
    { id: 'r-4', organization_id: ORG, workflow_instance_id: 'i-2', task_id: 't-4', order_index: 0, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'Check', number_label: '1' } },
    { id: 'r-5', organization_id: ORG, workflow_instance_id: 'i-2', task_id: null, order_index: 1, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'File', number_label: '2' } },
    { id: 'r-x', organization_id: 'org-2', workflow_instance_id: 'i-x', task_id: 't-x', order_index: 0, step_snapshot: { version: 2, assigner_user_id: 'u-assigner', title: 'X' } },
  ]
  const instances = [
    {
      id: 'i-1',
      organization_id: ORG,
      workflow_template_id: 'tpl-1',
      name: 'ACME Ltd onboarding',
      trigger_type: 'manual_trigger',
      metadata: { name: 'ACME Ltd onboarding' },
      started_at: new Date('2026-11-03T06:00:00Z'),
      instance_number: 12,
      triggered_by_user_id: 'u-mehul',
      template: { name: 'Vendor onboarding', created_by_user_id: 'u-creator', access: [] as { access_type: string }[] },
    },
    {
      id: 'i-2',
      organization_id: ORG,
      workflow_template_id: 'tpl-2',
      name: 'Monthly close — 3 Nov 2025',
      trigger_type: 'schedule',
      metadata: { schedule_entry_id: 's' },
      started_at: new Date('2025-11-03T06:00:00Z'),
      instance_number: 4,
      triggered_by_user_id: null,
      template: { name: 'Monthly close', created_by_user_id: 'u-creator', access: [] as { access_type: string }[] },
    },
    {
      id: 'i-x',
      organization_id: 'org-2',
      workflow_template_id: 'tpl-x',
      name: 'Foreign',
      trigger_type: 'manual_trigger',
      metadata: { name: 'Foreign' },
      started_at: NOW,
      instance_number: 1,
      triggered_by_user_id: null,
      template: { name: 'Foreign', created_by_user_id: 'u-x', access: [] },
    },
  ]
  const db: any = {
    workflowInstanceStep: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) =>
          where.id ? where.id.in.includes(r.id) : where.workflow_instance_id.in.includes(r.workflow_instance_id),
        ),
      ),
    },
    workflowInstance: { findMany: jest.fn(async ({ where }: any) => instances.filter((i) => where.id.in.includes(i.id))) },
    organization: { findMany: jest.fn(async () => [{ id: ORG, timezone: 'Asia/Kolkata' }]) },
    user: { findMany: jest.fn(async () => [{ id: 'u-mehul', name: 'Mehul' }]) },
    task: {
      findMany: jest.fn(async ({ where }: any) =>
        (over.worksIn ?? [])
          .map((rowId) => rows.find((r) => r.id === rowId)!)
          .filter((r) => where.id.in.includes(r.task_id))
          .map((r) => ({ workflow_instance_step_id: r.id, organization_id: r.organization_id })),
      ),
    },
  }
  return { db, instances }
}

describe('instance labels', () => {
  it('manual → "<instance name> · <date>"; scheduled → "<workflow name> · <date>"; the year only when not this year', () => {
    const tz = 'Asia/Kolkata'
    const base = { name: 'ACME', started_at: new Date('2026-11-03T06:00:00Z') }
    expect(instanceLabel({ ...base, trigger_type: 'manual_trigger', metadata: { name: 'ACME' } }, 'Vendor onboarding', tz, NOW)).toBe(
      'ACME · 3 Nov',
    )
    expect(instanceLabel({ ...base, trigger_type: 'schedule', metadata: {} }, 'Vendor onboarding', tz, NOW)).toBe(
      'Vendor onboarding · 3 Nov',
    )
    // An old manual instance started without a typed name reads like a scheduled one.
    expect(instanceLabel({ ...base, trigger_type: 'manual_trigger', metadata: {} }, 'Vendor onboarding', tz, NOW)).toBe(
      'Vendor onboarding · 3 Nov',
    )
    expect(shortDate(new Date('2025-11-03T06:00:00Z'), tz, NOW)).toBe('3 Nov 2025')
    // The org's calendar day, not UTC's: 20:00Z on 2 Nov is 3 Nov in IST.
    expect(shortDate(new Date('2026-11-02T20:00:00Z'), tz, NOW)).toBe('3 Nov')
  })
})

describe('taskWorkflowInfo (the task list / detail `workflow` block)', () => {
  const tasks = [
    { id: 't-1', organization_id: ORG, workflow_instance_step_id: 'r-1' },
    { id: 't-2', organization_id: ORG, workflow_instance_step_id: 'r-2' },
    { id: 't-4', organization_id: ORG, workflow_instance_step_id: 'r-4' },
    { id: 't-plain', organization_id: ORG, workflow_instance_step_id: null },
    // A row of another org is never resolved for this org's task.
    { id: 't-spoof', organization_id: ORG, workflow_instance_step_id: 'r-x' },
  ]

  it('labels workflow tasks in a fixed number of queries; other tasks get nothing', async () => {
    const { db } = makeDb({ worksIn: ['r-2'] })
    const out = await taskWorkflowInfo(db, tasks, { userId: 'u-me', isAdmin: false }, now)
    expect(out.get('t-1')).toEqual({
      instance_id: 'i-1',
      template_id: 'tpl-1',
      template_name: 'Vendor onboarding',
      instance_name: 'ACME Ltd onboarding',
      label: 'ACME Ltd onboarding · 3 Nov',
      instance_number: 12,
      step_label: '1',
      step_title: 'Collect',
      total_steps: 3,
      started_by_name: 'Mehul',
      is_scheduled: false,
      can_open: true,
    })
    expect(out.get('t-4')).toMatchObject({
      label: 'Monthly close · 3 Nov 2025',
      instance_number: 4,
      step_label: '1',
      total_steps: 2,
      started_by_name: null,
      is_scheduled: true,
      can_open: false,
    })
    expect(out.has('t-plain')).toBe(false)
    expect(out.has('t-spoof')).toBe(false)
    // Batched: one query per kind whatever the list size.
    expect(db.workflowInstance.findMany).toHaveBeenCalledTimes(1)
    expect(db.workflowInstanceStep.findMany).toHaveBeenCalledTimes(2)
    expect(db.task.findMany).toHaveBeenCalledTimes(1)
    expect(db.user.findMany).toHaveBeenCalledTimes(1)
  })

  it('can_open: admins, editors / viewers, the person who ran it, people working in it — nobody else', async () => {
    const one = [tasks[0]]
    const { db, instances } = makeDb()
    expect((await taskWorkflowInfo(db, one, { userId: 'u-other', isAdmin: false }, now)).get('t-1')!.can_open).toBe(false)
    expect((await taskWorkflowInfo(db, one, { userId: 'u-other', isAdmin: true }, now)).get('t-1')!.can_open).toBe(true)
    expect((await taskWorkflowInfo(db, one, { userId: 'u-creator', isAdmin: false }, now)).get('t-1')!.can_open).toBe(true)
    expect((await taskWorkflowInfo(db, one, { userId: 'u-mehul', isAdmin: false }, now)).get('t-1')!.can_open).toBe(true)
    instances[0].template.access = [{ access_type: 'view' }]
    expect((await taskWorkflowInfo(db, one, { userId: 'u-viewer', isAdmin: false }, now)).get('t-1')!.can_open).toBe(true)
    // No viewer (internal read) → unknown.
    expect((await taskWorkflowInfo(db, one, null, now)).get('t-1')!.can_open).toBeNull()
  })

  it('does nothing (no queries) for a list without workflow tasks', async () => {
    const { db } = makeDb()
    const out = await taskWorkflowInfo(db, [tasks[3]], { userId: 'u-me', isAdmin: false }, now)
    expect(out.size).toBe(0)
    expect(db.workflowInstanceStep.findMany).not.toHaveBeenCalled()
  })
})

describe('TasksService — workflow tasks in task lists', () => {
  const makeService = (prisma: any) =>
    new TasksService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        registerWiredList: jest.fn(),
        listWhere: jest.fn(async () => ({})),
        assertCanActOn: jest.fn(async () => {
          throw new ForbiddenException('out of scope')
        }),
      } as any,
      {} as any,
      { now: jest.fn(async () => NOW) } as any,
      {} as any,
      { registerCounter: jest.fn(), whereForUser: jest.fn() } as any,
      { timingWhere: jest.fn(() => ({})) } as any,
      {} as any,
    )

  it('"Assigned by Me" excludes tasks a workflow created', async () => {
    const prisma: any = {
      task: { findMany: jest.fn(async () => []) },
      taskView: { findMany: jest.fn(async () => []) },
      taskComment: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async () => []) },
      employeeProfile: { findMany: jest.fn(async () => []) },
    }
    await makeService(prisma).getTasksAssignedByMe(ORG, 'u-me')
    expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({
      organization_id: ORG,
      is_deleted: false,
      created_by_user_id: 'u-me',
      workflow_instance_step_id: null,
    })
  })

  it('the "From workflows" filter (from_workflows) and assigner filters', () => {
    const service: any = makeService({})
    const build = (filters: any) => service.buildTaskWhere(ORG, {}, filters, 'created_at')
    expect(build({ from_workflows: 'true' }).workflow_instance_step_id).toEqual({ not: null })
    expect(build({ from_workflows: 'false' }).workflow_instance_step_id).toBeNull()
    expect(build({}).workflow_instance_step_id).toBeUndefined()
    // "Assigned by X" never attributes a workflow task to its step's assigner.
    expect(build({ created_by_user_id: 'u-2' })).toMatchObject({ created_by_user_id: 'u-2', workflow_instance_step_id: null })
    expect(build({ created_by_user_ids: 'u-2,u-3' }).workflow_instance_step_id).toBeNull()
  })

  it('list rows carry the `workflow` block (null on ordinary tasks), batched for the page', async () => {
    const { db } = makeDb({ worksIn: ['r-1'] })
    const rowsOut = [
      { id: 't-1', organization_id: ORG, workflow_instance_step_id: 'r-1', created_by_user_id: 'u-assigner', assignees: [], tags: [] },
      { id: 't-plain', organization_id: ORG, workflow_instance_step_id: null, created_by_user_id: 'u-me', assignees: [], tags: [] },
    ]
    const prisma: any = {
      ...db,
      task: { findMany: jest.fn(async (args: any) => (args.include ? rowsOut : db.task.findMany(args))) },
      user: { findMany: jest.fn(async () => [{ id: 'u-mehul', name: 'Mehul' }]) },
      employeeProfile: { findMany: jest.fn(async () => []) },
    }
    const out: any[] = await makeService(prisma).listTasks(ORG, { userId: 'u-me', systemRoleId: null, isAdmin: false, isSuperAdmin: false }, {})
    expect(out[0].workflow).toMatchObject({ instance_id: 'i-1', label: 'ACME Ltd onboarding · 3 Nov', step_label: '1', total_steps: 3, can_open: true })
    expect(out[1].workflow).toBeNull()
  })
})
