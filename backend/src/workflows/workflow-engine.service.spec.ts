import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { WorkflowEngineService } from './workflow-engine.service'

/**
 * Engine tests over an in-memory Prisma double: instances, instance rows, events,
 * tasks, task assignees and task escalations are real rows (so guarded `updateMany`s
 * behave like the database); everything else is a jest.fn with sensible defaults.
 * `$transaction(fn)` runs fn against the same double (rollback isn't simulated).
 */

const ORG = 'org-1'
const NOW = new Date('2026-10-08T04:30:00Z') // Thu 10:00 IST
const HOUR = 3_600_000

type Row = Record<string, any>

/** A v2 snapshot. `deps` are TEMPLATE step ids (ws-*). */
function snap(title: string, order: number, extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    title,
    description: null,
    assigner_user_id: 'u-assigner',
    assignee_user_ids: ['u-worker'],
    cc_user_ids: [],
    completion_mode: 'any_can_complete',
    priority_id: null,
    category_id: null,
    tag_ids: [],
    proof_required: false,
    proof_allowed_extensions: [],
    checklist_items: [],
    due_days: 1,
    due_time: '18:00',
    escalation_mode: 'manager',
    escalation_user_ids: [],
    if_late: 'wait',
    depends_on_step_ids: order > 0 ? [`ws-${order - 1}`] : [],
    order_index: order,
    workflow_step_id: `ws-${order}`,
    ...extra,
  }
}

/** A pre-v2 snapshot (straight sequence). */
function legacySnap(title: string, order: number) {
  return {
    title,
    description: null,
    assignee_type: 'fixed_person',
    assignee_user_id: 'u-worker',
    assignee_role: null,
    assigner_user_id: 'u-assigner',
    deadline_config: { type: 'x_days_after_prev_completed', days: 2, time: '18:00' },
    proof_required: false,
    priority_id: null,
    category_id: null,
    checklist_items: [],
    if_overdue_action: 'block_next',
    branch_step_id: null,
    is_branch_step: false,
    order_index: order,
    is_branch: false,
    branch_step: null,
  }
}

function matches(row: Row, where: Row = {}, relations: Record<string, (row: Row) => Row | undefined> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (relations[k]) {
      const related = relations[k](row)
      return !!related && matches(related, v as Row)
    }
    if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in v) return (v.in as unknown[]).includes(row[k])
    if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in v) return (row[k] ?? null) !== v.not
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime()
    return (row[k] ?? null) === (v ?? null)
  })
}

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment
    else row[k] = v
  }
  return row
}

function makeDb() {
  const instances: Row[] = []
  const steps: Row[] = []
  const events: Row[] = []
  const tasks: Row[] = []
  const taskAssignees: Row[] = []
  const escalations: Row[] = []
  const comments: Row[] = []
  const schedules: Row[] = []
  const managers: Record<string, string | null> = {}
  const inactive = new Set<string>()
  let seq = 0

  const copy = (r: Row | undefined) => (r ? { ...r } : null)
  const sortRows = (rows: Row[], orderBy?: any) => {
    const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy
    if (ob?.created_at === 'desc') return [...rows].sort((a, b) => b.created_at - a.created_at)
    return [...rows].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.created_at - b.created_at)
  }
  const table = (rows: Row[], prefix: string, relations: Record<string, (row: Row) => Row | undefined> = {}) => ({
    findUnique: jest.fn(async ({ where }: any) => copy(rows.find((r) => r.id === where.id))),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) =>
      copy(sortRows(rows.filter((r) => matches(r, where, relations)), orderBy)[0]),
    ),
    findMany: jest.fn(async ({ where, orderBy }: any = {}) =>
      sortRows(rows.filter((r) => matches(r, where ?? {}, relations)), orderBy).map((r) => ({ ...r })),
    ),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}, relations)).length),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where, relations))
      hit.forEach((r) => apply(r, data))
      return { count: hit.length }
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => x.id === where.id)
      if (!r) throw new Error(`${prefix} ${where.id} not found`)
      return { ...apply(r, data) }
    }),
    create: jest.fn(async ({ data }: any) => {
      const r = { id: `${prefix}-${++seq}`, created_at: new Date(1000 + seq), ...data }
      rows.push(r)
      return { ...r }
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) rows.push({ id: `${prefix}-${++seq}`, created_at: new Date(1000 + seq), ...d })
      return { count: data.length }
    }),
  })

  const withAssignees = (t: Row | undefined) =>
    t ? { ...t, assignees: taskAssignees.filter((a) => a.task_id === t.id).map((a) => ({ ...a })) } : null
  const taskTable = {
    create: jest.fn(async ({ data }: any) => {
      const id = `task-${tasks.length + 1}`
      const { assignees, checklist, ...rest } = data
      tasks.push({ id, is_deleted: false, status: { type: 'not_started' }, deadline_revision_count: 0, ...rest })
      for (const a of assignees?.create ?? []) {
        taskAssignees.push({ id: `ta-${++seq}`, task_id: id, removed_at: null, ...a })
      }
      return { id }
    }),
    findFirst: jest.fn(async ({ where }: any) => withAssignees(tasks.find((t) => matches(t, where)))),
    findMany: jest.fn(async ({ where }: any = {}) => tasks.filter((t) => matches(t, where ?? {})).map((t) => withAssignees(t))),
    update: jest.fn(async ({ where, data }: any) => {
      const t = tasks.find((x) => x.id === where.id)
      if (!t) throw new Error('task not found')
      return apply(t, data)
    }),
  }

  const prisma: any = {
    orgModuleEntitlement: { findUnique: jest.fn().mockResolvedValue({ state: 'full' }) },
    organization: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }), findMany: jest.fn().mockResolvedValue([]) },
    workflowInstance: table(instances, 'inst'),
    workflowInstanceStep: table(steps, 'step', {
      instance: (row) => instances.find((i) => i.id === row.workflow_instance_id),
    }),
    workflowInstanceEvent: table(events, 'evt'),
    workflowTemplate: { findFirst: jest.fn() },
    workflowStep: { findFirst: jest.fn().mockResolvedValue(null) },
    workflowScheduleEntry: table(schedules, 'sched', { template: (row) => row.template }),
    task: taskTable,
    taskAssignee: table(taskAssignees, 'ta'),
    taskEscalation: table(escalations, 'esc'),
    taskComment: table(comments, 'cmt'),
    taskStatus: { findFirst: jest.fn().mockResolvedValue({ id: 'st-not-started' }) },
    taskChecklistTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    taskPriority: { findFirst: jest.fn().mockResolvedValue(null) },
    taskCategory: { findFirst: jest.fn().mockResolvedValue(null) },
    taskTag: { findMany: jest.fn().mockResolvedValue([]) },
    taskTagLink: { createMany: jest.fn() },
    taskMaster: { findUnique: jest.fn().mockResolvedValue({ default_reminder_days_before: 1 }) },
    taskReminder: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    taskDeadlineRevision: { create: jest.fn() },
    taskActivityLog: { create: jest.fn() },
    taskArchive: { create: jest.fn() },
    organizationMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm' }),
      findMany: jest.fn(async ({ where }: any) =>
        (where.user_id?.in ?? []).filter((u: string) => !inactive.has(u)).map((u: string) => ({ user_id: u })),
      ),
    },
    user: { findUnique: jest.fn(async ({ where }: any) => ({ name: where.id })) },
    employeeProfile: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.user_id?.in ?? []).map((u: string) => ({ reporting_to_user_id: managers[u] ?? null })),
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  }
  const holidays = { adjustDeadline: jest.fn(async (d: Date) => d), isWorkingDay: jest.fn(async (_d: Date) => true) }
  const notifications = { emit: jest.fn().mockResolvedValue(1) }
  const auditWriter = { runAsSystem: jest.fn((_p: unknown, fn: () => Promise<unknown>) => fn()) }
  const clock = { now: jest.fn().mockResolvedValue(NOW) }
  const engine = new WorkflowEngineService(prisma, holidays as any, notifications as any, auditWriter as any, clock as any)

  const addInstance = (over: Row = {}) => {
    const inst: Row = {
      id: `inst-${instances.length + 1}`,
      organization_id: ORG,
      workflow_template_id: 'tpl-1',
      name: 'Onboarding — 08 Oct 2026',
      status: 'running',
      started_at: new Date('2026-10-07T04:30:00Z'),
      completed_at: null,
      current_step_id: null,
      last_error: null,
      template: { name: 'Onboarding', owner_user_ids: ['u-owner'], created_by_user_id: 'u-owner' },
      ...over,
    }
    instances.push(inst)
    return inst
  }
  const addStep = (inst: Row, over: Row = {}) => {
    const order = over.order_index ?? steps.filter((s) => s.workflow_instance_id === inst.id).length
    const row: Row = {
      id: `row-${order}-${inst.id}`,
      organization_id: ORG,
      workflow_instance_id: inst.id,
      workflow_step_id: `ws-${order}`,
      task_id: null,
      assigned_to_user_id: null,
      status: 'pending',
      scheduled_at: null,
      task_created_at: null,
      completed_at: null,
      branch_taken: false,
      order_index: order,
      step_snapshot: snap(`Step ${order + 1}`, order),
      last_error: null,
      sent_back_count: 0,
      waiting_on_row_id: null,
      returned_to_row_id: null,
      created_at: new Date(1000 + steps.length),
      ...over,
    }
    steps.push(row)
    return row
  }
  /** A task already driving a row (open by default). */
  const addTask = (row: Row, over: Row = {}, workers: string[] = ['u-worker']) => {
    const id = over.id ?? `t-${row.id}`
    tasks.push({
      id,
      organization_id: ORG,
      title: row.step_snapshot?.title ?? 'Task',
      is_deleted: false,
      status: { type: 'in_progress' },
      deadline: new Date('2026-10-09T12:30:00Z'),
      original_deadline: new Date('2026-10-09T12:30:00Z'),
      completion_mode: 'any_can_complete',
      workflow_instance_step_id: row.id,
      ...over,
    })
    for (const u of workers) taskAssignees.push({ id: `ta-${++seq}`, organization_id: ORG, task_id: id, user_id: u, is_cc: false, removed_at: null })
    row.task_id = id
    return tasks[tasks.length - 1]
  }
  const rowsOf = (inst: Row) => steps.filter((s) => s.workflow_instance_id === inst.id)
  const tasksFor = (row: Row) => tasks.filter((t) => t.workflow_instance_step_id === row.id)
  const eventsOf = (type: string) => events.filter((e) => e.type === type)
  /** Complete a row's task (as TasksService would) and run the engine hook. */
  const completeTask = async (row: Row) => {
    const t = tasks.find((x) => x.id === row.task_id)!
    t.status = { type: 'completed' }
    await engine.handleStepCompleted(row.id, row.task_id)
  }
  return {
    prisma, engine, holidays, notifications, auditWriter, clock,
    instances, steps, events, tasks, taskAssignees, escalations, comments, schedules, managers, inactive,
    addInstance, addStep, addTask, rowsOf, tasksFor, eventsOf, completeTask,
  }
}

type Db = ReturnType<typeof makeDb>

/** A run of a DAG: `deps` maps step order → orders it starts after. */
function dagRun(db: Db, deps: number[][], instOver: Row = {}) {
  const inst = db.addInstance(instOver)
  const rows = deps.map((d, i) =>
    db.addStep(inst, { step_snapshot: snap(`Step ${String.fromCharCode(65 + i)}`, i, { depends_on_step_ids: d.map((x) => `ws-${x}`) }) }),
  )
  return { inst, rows }
}

const recipientsOf = (db: Db, event: string) =>
  db.notifications.emit.mock.calls.filter(([p]: any) => p.event_type === event).flatMap(([p]: any) => p.recipients)

describe('WorkflowEngineService (v2 — DAG runs)', () => {
  describe('entitlement ceiling', () => {
    it.each(['off', 'preview'])('does not run automation when workflows are %s', async (state) => {
      const { prisma, engine, auditWriter } = makeDb()
      prisma.orgModuleEntitlement.findUnique.mockResolvedValue({ state })
      await engine.processSchedulesForOrg(ORG, new Date())
      await engine.processOverdueStepsForOrg(ORG, new Date())
      expect(auditWriter.runAsSystem).not.toHaveBeenCalled()
    })
  })

  describe('createInstance', () => {
    const tStep = (id: string, order: number, over: Row = {}) => ({
      id,
      title: `T ${id}`,
      description: null,
      assigner_user_id: 'u-assigner',
      assignee_user_ids: ['u-worker'],
      cc_user_ids: [],
      completion_mode: 'any_can_complete',
      priority_id: null,
      category_id: null,
      tag_ids: [],
      proof_required: false,
      proof_allowed_extensions: [],
      checklist_items: [],
      due_days: 1,
      due_time: '18:00',
      escalation_mode: 'manager',
      escalation_user_ids: [],
      if_late: 'wait',
      depends_on_step_ids: [],
      order_index: order,
      is_branch_step: false,
      ...over,
    })
    const template = (stepsList: Row[], over: Row = {}) => ({
      id: 'tpl-1',
      organization_id: ORG,
      name: 'Onboarding',
      status: 'active',
      owner_user_ids: ['u-owner'],
      created_by_user_id: 'u-owner',
      steps: stepsList,
      ...over,
    })

    it('rejects a turned-off workflow with a 400 and a workflow with no steps', async () => {
      const db = makeDb()
      db.prisma.workflowTemplate.findFirst.mockResolvedValueOnce(template([tStep('a', 0)], { status: 'draft' }))
      await expect(db.engine.createInstance(ORG, 'tpl-1', 'manual', {})).rejects.toBeInstanceOf(BadRequestException)
      db.prisma.workflowTemplate.findFirst.mockResolvedValueOnce(template([tStep('esc', 0, { is_branch_step: true })]))
      await expect(db.engine.createInstance(ORG, 'tpl-1', 'manual', {})).rejects.toThrow(/no steps/)
    })

    it('rejects when the entitlement is not full with a 403', async () => {
      const db = makeDb()
      db.prisma.workflowTemplate.findFirst.mockResolvedValue(template([tStep('a', 0)]))
      db.prisma.orgModuleEntitlement.findUnique.mockResolvedValue({ state: 'preview' })
      await expect(db.engine.createInstance(ORG, 'tpl-1', 'manual', {})).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('snapshots every step, starts every step with no dependencies (split at the root), one tx', async () => {
      const db = makeDb()
      db.prisma.workflowTemplate.findFirst.mockResolvedValue(
        template([
          tStep('a', 0),
          tStep('b', 1),
          tStep('c', 2, { depends_on_step_ids: ['a', 'b'] }),
          tStep('esc', 3, { is_branch_step: true }),
        ]),
      )
      const { id } = await db.engine.createInstance(ORG, 'tpl-1', 'manual', {}, 'u-owner')
      const inst = db.instances.find((i) => i.id === id)!
      const rows = db.rowsOf(inst)
      expect(rows).toHaveLength(3) // legacy escalation steps are not part of the flow
      expect(rows.map((r) => r.status)).toEqual(['active', 'active', 'pending'])
      expect(rows[2].step_snapshot.depends_on_step_ids).toEqual(['a', 'b'])
      expect(db.prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(db.eventsOf('run_started')).toHaveLength(1)
      expect(db.eventsOf('step_started')).toHaveLength(2)
      // Owners hear the run started; each first-step assignee once (their assignment).
      const toWorker = db.notifications.emit.mock.calls.filter(([p]: any) => p.recipients.includes('u-worker'))
      expect(toWorker.map(([p]: any) => p.event_type)).toEqual(['workflow_step_assigned', 'workflow_step_assigned'])
    })

    it('refuses a graph where no step can start first', async () => {
      const db = makeDb()
      db.prisma.workflowTemplate.findFirst.mockResolvedValue(
        template([tStep('a', 0, { depends_on_step_ids: ['b'] }), tStep('b', 1, { depends_on_step_ids: ['a'] })]),
      )
      await expect(db.engine.createInstance(ORG, 'tpl-1', 'manual', {})).rejects.toThrow(/No step of this workflow can start first/)
    })

    it('step task = the full task: assignees + CCs, mode, tags, proof, grouped checklist, deadline, reminder, created log', async () => {
      const db = makeDb()
      db.prisma.taskTag.findMany.mockResolvedValue([{ id: 'tag-live' }])
      db.prisma.workflowTemplate.findFirst.mockResolvedValue(
        template([
          tStep('a', 0, {
            assignee_user_ids: ['u-1', 'u-2'],
            cc_user_ids: ['u-cc', 'u-1'],
            completion_mode: 'all_must_complete',
            tag_ids: ['tag-live', 'tag-gone'],
            proof_required: true,
            proof_allowed_extensions: ['pdf'],
            due_days: 2,
            due_time: '17:00',
            checklist_items: [
              { title: 'Own first', order_index: 0 },
              { title: 'Saved KYC', group_title: 'KYC (saved)', template_id: 'tpl-kyc', order_index: 1 },
            ],
          }),
        ]),
      )
      db.prisma.taskChecklistTemplate.findMany.mockResolvedValue([
        { id: 'tpl-kyc', name: 'KYC', is_active: true, items: [{ title: 'Verify PAN', order_index: 1 }, { title: 'Collect ID', order_index: 0 }] },
      ])
      await db.engine.createInstance(ORG, 'tpl-1', 'manual', {}, 'u-owner')

      const data = db.prisma.task.create.mock.calls[0][0].data
      expect(data.assignees.create).toEqual([
        { organization_id: ORG, user_id: 'u-1', is_cc: false },
        { organization_id: ORG, user_id: 'u-2', is_cc: false },
        { organization_id: ORG, user_id: 'u-cc', is_cc: true },
      ])
      expect(data).toMatchObject({
        completion_mode: 'all_must_complete',
        proof_required: true,
        proof_allowed_extensions: ['pdf'],
        created_by_user_id: 'u-assigner',
        created_at: NOW,
        status_id: 'st-not-started',
      })
      // Start Thu 8 Oct + 2 days at 17:00 IST
      expect(data.deadline.toISOString()).toBe('2026-10-10T11:30:00.000Z')
      expect(data.original_deadline).toEqual(data.deadline)
      expect(data.checklist.create.map((c: Row) => [c.title, c.group_title])).toEqual([
        ['Own first', null],
        ['Collect ID', 'KYC'],
        ['Verify PAN', 'KYC'],
      ])
      expect(db.prisma.taskTagLink.createMany.mock.calls[0][0].data.map((d: Row) => d.tag_id)).toEqual(['tag-live'])
      expect(db.prisma.taskReminder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'assignee', offset_days: 1 }),
      })
      expect(db.prisma.taskActivityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'created', metadata: expect.objectContaining({ source: 'workflow' }) }),
      })
      expect(db.prisma.taskChecklistTemplate.findMany).toHaveBeenCalledTimes(1)
    })

    it('dedupes task-based starts per (trigger, task) and returns the winner of a lost race', async () => {
      const db = makeDb()
      db.prisma.workflowTemplate.findFirst.mockResolvedValue(template([tStep('a', 0)]))
      db.addInstance({ id: 'existing', trigger_id: 'trg-1', source_task_id: 'task-9' })
      const res = await db.engine.createInstance(ORG, 'tpl-1', 'task_completed_trigger', {}, null, { triggerId: 'trg-1', sourceTaskId: 'task-9' })
      expect(res.id).toBe('existing')

      const db2 = makeDb()
      db2.prisma.workflowTemplate.findFirst.mockResolvedValue(template([tStep('a', 0)]))
      db2.prisma.workflowInstance.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' })
      db2.prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
      const res2 = await db2.engine.createInstance(ORG, 'tpl-1', 'task_completed_trigger', {}, null, { triggerId: 'trg-1', sourceTaskId: 'task-9' })
      expect(res2).toEqual({ id: 'winner' })
    })
  })

  describe('DAG activation', () => {
    it('split: completing A starts B and C together; join D waits for ALL its inputs', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0], [0], [1, 2]])
      const [a, b, c, d] = rows
      a.status = 'active'
      db.addTask(a)

      await db.completeTask(a)
      expect([a, b, c, d].map((r) => r.status)).toEqual(['completed', 'active', 'active', 'pending'])

      await db.completeTask(b)
      expect(d.status).toBe('pending') // C still open

      await db.completeTask(c)
      expect(d.status).toBe('active')
      expect(db.tasksFor(d)).toHaveLength(1)

      await db.completeTask(d)
      expect(inst.status).toBe('completed')
      expect(db.eventsOf('run_completed')).toHaveLength(1)
      expect(recipientsOf(db, 'workflow_completed')).toEqual(['u-owner'])
      // Every engine transaction locks the run row first.
      expect(db.prisma.$queryRaw).toHaveBeenCalled()
      expect(String(db.prisma.$queryRaw.mock.calls[0][0].join('?'))).toMatch(/FOR UPDATE/)
    })

    it('concurrent completion of two join inputs activates the join exactly once', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[], [], [0, 1]])
      const [a, b, j] = rows
      a.status = 'active'
      b.status = 'active'
      db.addTask(a)
      db.addTask(b)
      db.tasks.forEach((t) => (t.status = { type: 'completed' }))

      await Promise.all([db.engine.handleStepCompleted(a.id, a.task_id), db.engine.handleStepCompleted(b.id, b.task_id)])

      expect(j.status).toBe('active')
      expect(db.tasksFor(j)).toHaveLength(1)
      expect(db.eventsOf('step_started').filter((e) => e.instance_step_id === j.id)).toHaveLength(1)
    })

    it('is idempotent: a second completion is a no-op; a stale task never completes the row', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      await db.engine.handleStepCompleted(rows[0].id, rows[0].task_id)
      expect(db.prisma.task.create).toHaveBeenCalledTimes(1)

      rows[1].task_id = 'task-new'
      await db.engine.handleStepCompleted(rows[1].id, 'task-old')
      expect(rows[1].status).toBe('active')
    })

    it('a cancelled run never moves; a stuck run resumes on progress', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]], { status: 'cancelled' })
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      expect(rows[0].status).toBe('active')
      expect(inst.status).toBe('cancelled')

      const db2 = makeDb()
      const r2 = dagRun(db2, [[], [0]], { status: 'stuck', last_error: 'x' })
      r2.rows[0].status = 'overdue'
      db2.addTask(r2.rows[0])
      await db2.completeTask(r2.rows[0])
      expect(r2.inst.status).toBe('running')
      expect(r2.inst.last_error).toBeNull()
      expect(r2.rows[1].status).toBe('active')
    })

    it('never throws: a failure parks the run as stuck with a readable error and a run_stuck event', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      db.prisma.taskStatus.findFirst.mockResolvedValue(null)
      await expect(db.completeTask(rows[0])).resolves.toBeUndefined()
      expect(inst.status).toBe('stuck')
      expect(inst.last_error).toMatch(/no active task status/i)
      expect(db.eventsOf('run_stuck')).toHaveLength(1)
    })

    it('legacy sequential snapshot: rows run one after another by order_index', async () => {
      const db = makeDb()
      const inst = db.addInstance()
      const s1 = db.addStep(inst, { status: 'active', step_snapshot: legacySnap('Old 1', 0) })
      const s2 = db.addStep(inst, { step_snapshot: legacySnap('Old 2', 1) })
      const s3 = db.addStep(inst, { step_snapshot: legacySnap('Old 3', 2) })
      db.addTask(s1)

      await db.completeTask(s1)
      expect([s1.status, s2.status, s3.status]).toEqual(['completed', 'active', 'pending'])
      const created = db.prisma.task.create.mock.calls[0][0].data
      expect(created.assignees.create).toEqual([{ organization_id: ORG, user_id: 'u-worker', is_cc: false }])
      // legacy x_days_after_prev_completed 2 days at 18:00 → 2 days after the step starts
      expect(created.deadline.toISOString()).toBe('2026-10-10T12:30:00.000Z')

      await db.completeTask(s2)
      await db.completeTask(s3)
      expect(inst.status).toBe('completed')
    })

    it('a legacy escalation row never drives the flow', async () => {
      const db = makeDb()
      const inst = db.addInstance()
      const s1 = db.addStep(inst, { status: 'overdue', step_snapshot: legacySnap('Main', 0) })
      db.addTask(s1)
      const esc = db.addStep(inst, { id: 'row-esc', order_index: 0, status: 'active', step_snapshot: { ...legacySnap('Escalate', 0), is_branch: true } })
      db.addTask(esc)
      await db.completeTask(esc)
      expect(esc.status).toBe('completed')
      expect(s1.status).toBe('overdue')
      expect(inst.status).toBe('running')
    })
  })

  describe('people and escalation rows', () => {
    it('manager mode: each assignee’s manager is a level-1 contact (assignees never escalate to themselves)', async () => {
      const db = makeDb()
      db.managers['u-1'] = 'u-boss1'
      db.managers['u-2'] = 'u-1' // u-2 reports to u-1, who is on the task
      db.managers['u-3'] = 'u-boss1'
      const { rows } = dagRun(db, [[], [0]])
      rows[1].step_snapshot.assignee_user_ids = ['u-1', 'u-2', 'u-3']
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      const esc = db.escalations.filter((e) => e.task_id === rows[1].task_id)
      expect(esc.map((e) => [e.level, e.escalate_to_user_id])).toEqual([[1, 'u-boss1']])
    })

    it('manager mode with several managers → several level-1 rows', async () => {
      const db = makeDb()
      db.managers['u-1'] = 'm-1'
      db.managers['u-2'] = 'm-2'
      const { rows } = dagRun(db, [[]])
      rows[0].step_snapshot.assignee_user_ids = ['u-1', 'u-2']
      await db.engine.retryInstance(ORG, rows[0].workflow_instance_id, 'u-owner') // stranded root → activates it
      const esc = db.escalations.filter((e) => e.task_id === rows[0].task_id)
      expect(esc.map((e) => [e.level, e.escalate_to_user_id])).toEqual([[1, 'm-1'], [1, 'm-2']])
    })

    it('people mode: the chosen people are levels 1..n (inactive ones dropped)', async () => {
      const db = makeDb()
      db.inactive.add('p-2')
      const { rows } = dagRun(db, [[], [0]])
      rows[1].step_snapshot.escalation_mode = 'people'
      rows[1].step_snapshot.escalation_user_ids = ['p-1', 'p-2', 'p-3']
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      const esc = db.escalations.filter((e) => e.task_id === rows[1].task_id)
      expect(esc.map((e) => [e.level, e.escalate_to_user_id])).toEqual([[1, 'p-1'], [2, 'p-3']])
    })

    it('no manager → the workflow owners (level 1)', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[], [0]], {
        template: { name: 'Onboarding', owner_user_ids: ['u-owner', 'u-owner2'], created_by_user_id: 'u-owner' },
      })
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      const esc = db.escalations.filter((e) => e.task_id === rows[1].task_id)
      expect(esc.map((e) => [e.level, e.escalate_to_user_id])).toEqual([[1, 'u-owner'], [1, 'u-owner2']])
      expect(db.eventsOf('step_started').at(-1)!.metadata.escalation_source).toBe('owners_fallback')
    })

    it('inactive assignees are skipped; none left → the assigner does it, with last_error and owners told', async () => {
      const db = makeDb()
      db.inactive.add('u-gone')
      const { rows } = dagRun(db, [[], [0]])
      rows[1].step_snapshot.assignee_user_ids = ['u-gone']
      rows[1].step_snapshot.cc_user_ids = ['u-gone', 'u-cc']
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.completeTask(rows[0])
      const created = db.prisma.task.create.mock.calls[0][0].data
      expect(created.assignees.create.map((a: Row) => [a.user_id, a.is_cc])).toEqual([
        ['u-assigner', false],
        ['u-cc', true],
      ])
      expect(rows[1].last_error).toMatch(/assigned to u-assigner instead/)
      expect(recipientsOf(db, 'workflow_stuck')).toContain('u-owner')
    })
  })

  describe('late steps', () => {
    const late = (db: Db, row: Row) => {
      const t = db.tasks.find((x) => x.id === row.task_id)!
      t.deadline = new Date(NOW.getTime() - HOUR)
    }

    it('wait: row → overdue, dependents keep waiting, run stays running; owners + contacts + assignees told', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      db.escalations.push({ id: 'e1', organization_id: ORG, task_id: rows[0].task_id, level: 1, escalate_to_user_id: 'u-mgr', is_active: true, escalated_at: null })
      late(db, rows[0])

      await db.engine.processOverdueStepsForOrg(ORG, NOW)
      await db.engine.processOverdueStepsForOrg(ORG, NOW) // second tick: nothing new

      expect(rows[0].status).toBe('overdue')
      expect(rows[1].status).toBe('pending')
      expect(inst.status).toBe('running')
      expect(db.eventsOf('step_late')).toHaveLength(1)
      expect(recipientsOf(db, 'workflow_step_late').sort()).toEqual(['u-mgr', 'u-owner', 'u-worker'])
    })

    it('move_on: row → moved_on and dependents start; the run completes only when the late task is done', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      rows[0].step_snapshot.if_late = 'move_on'
      db.addTask(rows[0])
      late(db, rows[0])

      await db.engine.processOverdueStepsForOrg(ORG, NOW)
      expect(rows[0].status).toBe('moved_on')
      expect(rows[1].status).toBe('active')
      expect(db.eventsOf('step_moved_on')).toHaveLength(1)

      await db.completeTask(rows[1])
      expect(inst.status).toBe('running') // moved_on row's task still open

      await db.completeTask(rows[0])
      expect(rows[0].status).toBe('completed')
      expect(inst.status).toBe('completed')
    })

    it('one failing step does not stop the sweep', async () => {
      const db = makeDb()
      const r1 = dagRun(db, [[]])
      r1.rows[0].status = 'active'
      db.addTask(r1.rows[0], { id: 'task-bad' })
      const r2 = dagRun(db, [[]])
      r2.rows[0].id = 'row-good'
      r2.rows[0].status = 'active'
      db.addTask(r2.rows[0], { id: 'task-good', deadline: new Date(NOW.getTime() - HOUR) })
      const real = db.prisma.task.findFirst.getMockImplementation()
      db.prisma.task.findFirst.mockImplementation(async (args: any) => {
        if (args.where.id === 'task-bad') throw new Error('boom')
        return real(args)
      })
      await db.engine.processOverdueStepsForOrg(ORG, NOW)
      expect(r1.rows[0].status).toBe('active')
      expect(r2.rows[0].status).toBe('overdue')
    })
  })

  describe('send back', () => {
    /** A → B → C; A and B completed, C in progress. */
    const chain = (db: Db) => {
      const { inst, rows } = dagRun(db, [[], [0], [1]])
      const [a, b, c] = rows
      a.status = 'completed'
      b.status = 'completed'
      c.status = 'active'
      db.addTask(a, { status: { type: 'completed' } }, ['u-a'])
      db.addTask(b, { status: { type: 'completed' } }, ['u-b'])
      db.addTask(c, { deadline: new Date('2026-10-09T12:30:00Z') }, ['u-c'])
      db.escalations.push({ id: 'esc-c', organization_id: ORG, task_id: c.task_id, level: 1, escalate_to_user_id: 'u-mgr', is_active: true, escalated_at: null })
      return { inst, a, b, c }
    }

    it('targets: completed upstream steps, direct predecessor first', async () => {
      const db = makeDb()
      const { inst, a, b, c } = chain(db)
      await expect(db.engine.sendBackTargets(ORG, inst.id, c.id)).resolves.toEqual([
        { row_id: b.id, title: 'Step B' },
        { row_id: a.id, title: 'Step A' },
      ])
      await expect(db.engine.sendBackTargets(ORG, inst.id, a.id)).resolves.toEqual([])
    })

    it('validates reason, target and who may send back', async () => {
      const db = makeDb()
      const { inst, a, c } = chain(db)
      await expect(db.engine.sendBack(ORG, inst.id, c.id, a.id, ' no ', 'u-c')).rejects.toThrow(/at least 5/)
      await expect(db.engine.sendBack(ORG, inst.id, a.id, c.id, 'please redo', 'u-a')).rejects.toBeInstanceOf(BadRequestException)
      await expect(db.engine.sendBack(ORG, inst.id, c.id, a.id, 'please redo', 'u-stranger')).rejects.toBeInstanceOf(ForbiddenException)
      await expect(db.engine.sendBack(ORG, inst.id, c.id, a.id, 'please redo', 'u-editor', { canEdit: true })).resolves.toBeUndefined()
    })

    it('to the direct predecessor: sender pauses, target reopens with a new deadline + the reason as a comment; return goes to the sender', async () => {
      const db = makeDb()
      const { inst, b, c } = chain(db)

      await db.engine.sendBack(ORG, inst.id, c.id, b.id, 'Missing the signed copy', 'u-c')

      expect(c).toMatchObject({ status: 'sent_back', waiting_on_row_id: b.id, sent_back_count: 1 })
      expect(b).toMatchObject({ status: 'active', returned_to_row_id: c.id })
      const bTask = db.tasks.find((t) => t.id === b.task_id)!
      expect(bTask.reopened_at).toEqual(NOW)
      expect(bTask.completed_at).toBeNull()
      expect(bTask.status_id).toBe('st-not-started') // first active open status (mock)
      // now (Thu 10:00 IST) + 1 day at 18:00
      expect(bTask.deadline.toISOString()).toBe('2026-10-09T12:30:00.000Z')
      expect(db.comments).toHaveLength(1)
      expect(db.comments[0]).toMatchObject({ task_id: b.task_id, user_id: 'u-c', body: 'Sent back from “Step C”: Missing the signed copy' })
      // The paused sender doesn't escalate while it waits.
      expect(db.escalations.find((e) => e.id === 'esc-c')!.is_active).toBe(false)
      expect(db.eventsOf('sent_back')[0]).toMatchObject({ actor_user_id: 'u-c', instance_step_id: c.id })
      expect(recipientsOf(db, 'workflow_sent_back').sort()).toEqual(['u-b', 'u-owner'])
      // Cannot send back again from a paused step.
      await expect(db.engine.sendBack(ORG, inst.id, c.id, b.id, 'again please', 'u-c')).rejects.toBeInstanceOf(BadRequestException)

      // B is done again 5 hours later → straight back to C, deadline extended by the pause.
      const LATER = new Date(NOW.getTime() + 5 * HOUR)
      db.clock.now.mockResolvedValue(LATER)
      await db.completeTask(b)

      expect(b).toMatchObject({ status: 'completed', returned_to_row_id: null })
      expect(c).toMatchObject({ status: 'active', waiting_on_row_id: null })
      const cTask = db.tasks.find((t) => t.id === c.task_id)!
      expect(cTask.deadline.toISOString()).toBe('2026-10-09T17:30:00.000Z') // +5h
      expect(db.prisma.taskDeadlineRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ task_id: c.task_id, reason: expect.stringMatching(/waited/) }),
      })
      expect(db.escalations.find((e) => e.id === 'esc-c')!.is_active).toBe(true)
      expect(db.eventsOf('returned')).toHaveLength(1)
      expect(recipientsOf(db, 'workflow_sent_back')).toContain('u-c')
      expect(db.prisma.task.create).not.toHaveBeenCalled() // nothing was redone or re-created
    })

    it('to an indirect ancestor: the run returns directly to the sender (intermediate steps are not redone)', async () => {
      const db = makeDb()
      const { inst, a, b, c } = chain(db)
      await db.engine.sendBack(ORG, inst.id, c.id, a.id, 'Wrong customer details', 'u-c')
      expect(b.status).toBe('completed') // untouched
      expect(a.status).toBe('active')

      await db.completeTask(a)
      expect(a.status).toBe('completed')
      expect(b.status).toBe('completed')
      expect(c.status).toBe('active')
      expect(db.tasks.find((t) => t.id === b.task_id)!.reopened_at).toBeUndefined()
    })

    it('sender completes while paused: accepted; the target stays open but no longer returns', async () => {
      const db = makeDb()
      const { inst, b, c } = chain(db)
      await db.engine.sendBack(ORG, inst.id, c.id, b.id, 'Missing the signed copy', 'u-c')

      await db.completeTask(c)
      expect(c).toMatchObject({ status: 'completed', waiting_on_row_id: null })
      expect(b).toMatchObject({ status: 'active', returned_to_row_id: null })
      expect(inst.status).toBe('running')

      await db.completeTask(b)
      expect(db.eventsOf('returned')).toHaveLength(0)
      expect(inst.status).toBe('completed')
    })

    it('an overdue sender resumes overdue when its extended deadline is still past', async () => {
      const db = makeDb()
      const { inst, b, c } = chain(db)
      c.status = 'overdue'
      db.tasks.find((t) => t.id === c.task_id)!.deadline = new Date(NOW.getTime() - 10 * HOUR)
      await db.engine.sendBack(ORG, inst.id, c.id, b.id, 'Missing the signed copy', 'u-c')
      db.clock.now.mockResolvedValue(new Date(NOW.getTime() + 2 * HOUR))
      await db.completeTask(b)
      expect(c.status).toBe('overdue')
    })
  })

  describe('cancel / skip / retry', () => {
    it('cancel withdraws every open task (incl. paused and moved-on), skips open + pending rows, refuses twice', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [], [0, 1], [2]])
      rows[0].status = 'active'
      rows[1].status = 'moved_on'
      db.addTask(rows[0])
      db.addTask(rows[1])

      await db.engine.cancelInstance(ORG, inst.id, 'u-owner')

      expect(inst.status).toBe('cancelled')
      expect(rows.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped'])
      expect(db.tasks.filter((t) => t.is_deleted)).toHaveLength(2)
      expect(recipientsOf(db, 'workflow_task_withdrawn')).toEqual(['u-worker', 'u-worker'])
      expect(db.eventsOf('run_cancelled')).toHaveLength(1)
      await expect(db.engine.cancelInstance(ORG, inst.id, 'u-owner')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('skip(row_id) skips that step and evaluates its dependents; without a row id and several open steps → 400', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[], [], [0]])
      rows[0].status = 'active'
      rows[1].status = 'active'
      db.addTask(rows[0])
      db.addTask(rows[1])
      const instId = rows[0].workflow_instance_id

      await expect(db.engine.skipStep(ORG, instId, 'u-owner')).rejects.toThrow(/choose which one/)
      await db.engine.skipStep(ORG, instId, 'u-owner', rows[0].id)

      expect(rows[0].status).toBe('skipped')
      expect(rows[2].status).toBe('active')
      expect(rows[1].status).toBe('active')
      expect(db.tasks.find((t) => t.id === rows[0].task_id)!.is_deleted).toBe(true)
      expect(db.eventsOf('step_skipped')).toHaveLength(1)
    })

    it('skip defaults to the single current step', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]], { status: 'stuck' })
      rows[0].status = 'overdue'
      db.addTask(rows[0])
      await db.engine.skipStep(ORG, inst.id, 'u-owner')
      expect(rows[0].status).toBe('skipped')
      expect(rows[1].status).toBe('active')
      expect(inst.status).toBe('running')
    })

    it('retry gives a step whose task was deleted a fresh task (deadline kept while ahead) and resumes', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]], { status: 'stuck', last_error: 'Task was deleted' })
      rows[0].status = 'active'
      rows[0].scheduled_at = new Date('2026-10-20T12:30:00Z')
      db.addTask(rows[0], { is_deleted: true })

      await db.engine.retryInstance(ORG, inst.id, 'u-owner')

      expect(inst.status).toBe('running')
      expect(inst.last_error).toBeNull()
      expect(rows[0].task_id).toBe('task-2')
      expect(rows[0].scheduled_at.toISOString()).toBe('2026-10-20T12:30:00.000Z')
      expect(db.eventsOf('retried')).toHaveLength(1)
    })

    it('retry completes a step whose task finished but whose advance failed', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]], { status: 'stuck', last_error: 'boom' })
      rows[0].status = 'active'
      db.addTask(rows[0], { status: { type: 'completed' } })
      await db.engine.retryInstance(ORG, inst.id, 'u-owner')
      expect(rows[0].status).toBe('completed')
      expect(rows[1].status).toBe('active')
    })

    it('retry refuses a run that is moving normally', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      await expect(db.engine.retryInstance(ORG, inst.id, 'u-owner')).rejects.toThrow(/nothing to retry/)
    })
  })

  describe('task lifecycle hooks', () => {
    it('task deleted → run stuck with "Task was deleted"', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.engine.onTaskDeleted(ORG, rows[0].task_id)
      expect(inst.status).toBe('stuck')
      expect(inst.last_error).toMatch(/^Task was deleted/)
      expect(rows[0].last_error).toBe('Task was deleted')
    })

    it('task closed incomplete → stuck; reopening it resumes the run', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[], [0]])
      rows[0].status = 'active'
      db.addTask(rows[0])
      await db.engine.onTaskClosedIncomplete(ORG, rows[0].task_id)
      expect(inst.status).toBe('stuck')
      expect(rows[1].status).toBe('pending')

      await db.engine.onTaskReopened(ORG, rows[0].task_id, 'u-owner')
      expect(inst.status).toBe('running')
      expect(rows[0].last_error).toBeNull()
    })

    it('reopening a completed step task puts the step back in progress (a completed run resumes)', async () => {
      const db = makeDb()
      const { inst, rows } = dagRun(db, [[]], { status: 'completed' })
      rows[0].status = 'completed'
      db.addTask(rows[0], { status: { type: 'in_progress' } })
      await db.engine.onTaskReopened(ORG, rows[0].task_id, 'u-owner')
      expect(rows[0].status).toBe('active')
      expect(inst.status).toBe('running')
      expect(inst.completed_at).toBeNull()
    })

    it('sync follows the task deadline and reassignment; an overdue step with a new future deadline is back on time', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[]])
      rows[0].status = 'overdue'
      rows[0].assigned_to_user_id = 'u-worker'
      const newDeadline = new Date('2026-10-30T12:30:00Z')
      db.addTask(rows[0], { deadline: newDeadline }, ['u-other'])
      await db.engine.syncStepFromTask(ORG, rows[0].task_id)
      expect(rows[0].scheduled_at).toEqual(newDeadline)
      expect(rows[0].assigned_to_user_id).toBe('u-other')
      expect(rows[0].status).toBe('active')
    })

    it('onTaskEscalated writes a step_escalated event for workflow tasks', async () => {
      const db = makeDb()
      const { rows } = dagRun(db, [[]])
      rows[0].status = 'overdue'
      db.addTask(rows[0])
      await db.engine.onTaskEscalated(ORG, rows[0].task_id, 1, ['m-1', 'm-2'])
      expect(db.eventsOf('step_escalated')[0].metadata).toMatchObject({ level: 1, contact_ids: ['m-1', 'm-2'] })
    })
  })

  describe('task completion outside workflows', () => {
    it('onTaskCompleted completes a workflow step; an ordinary task starts nothing', async () => {
      const db = makeDb()
      const adv = jest.spyOn(db.engine, 'handleStepCompleted').mockResolvedValue()
      const start = jest.spyOn(db.engine, 'createInstance')
      db.prisma.task.findFirst.mockResolvedValueOnce({ workflow_instance_step_id: 'step-x' })
      await db.engine.onTaskCompleted(ORG, 'task-a')
      expect(adv).toHaveBeenCalledWith('step-x', 'task-a')
      db.prisma.task.findFirst.mockResolvedValueOnce({ workflow_instance_step_id: null })
      await db.engine.onTaskCompleted(ORG, 'task-b')
      expect(adv).toHaveBeenCalledTimes(1)
      expect(start).not.toHaveBeenCalled()
    })
  })

  describe('schedules (recurring-task format, org time zone)', () => {
    // NOW = Thu 2026-10-08 10:00 IST. 09:00 IST = 03:30Z.
    const entry = (over: Row = {}, status = 'active'): Row => ({
      id: 'sched-1',
      organization_id: ORG,
      workflow_template_id: 'tpl-1',
      schedule_type: 'daily',
      every: 1,
      days: [],
      month_days: [],
      yearly_dates: [],
      time: '09:00',
      start_date: new Date('2026-10-01T00:00:00Z'),
      end_condition: 'never',
      end_date: null,
      end_after: null,
      occurrence_count: 0,
      is_active: true,
      order_index: 0,
      last_fired_at: new Date('2026-10-07T03:30:00Z'),
      created_at: new Date('2026-09-30T00:00:00Z'),
      template: { status, organization_id: ORG, name: 'Daily check', owner_user_ids: ['u-owner'], created_by_user_id: 'u-owner' },
      ...over,
    })
    const startSpy = (db: Db) => jest.spyOn(db.engine, 'createInstance').mockResolvedValue({ id: 'i' })

    it('claims the occurrence atomically and starts exactly one run for it', async () => {
      const db = makeDb()
      db.schedules.push(entry())
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW)
      await db.engine.processSchedulesForOrg(ORG, NOW) // the next tick: already claimed
      const occurrence = new Date('2026-10-08T03:30:00Z')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(
        ORG,
        'tpl-1',
        'schedule',
        { schedule_entry_id: 'sched-1', scheduled_for: occurrence.toISOString() },
        null,
        { startAt: occurrence },
      )
      expect(db.schedules[0]).toMatchObject({ last_fired_at: occurrence, occurrence_count: 1, is_active: true })
    })

    it('does not fire when another tick already claimed the occurrence', async () => {
      const db = makeDb()
      db.schedules.push(entry())
      db.prisma.workflowScheduleEntry.updateMany.mockResolvedValueOnce({ count: 0 })
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW)
      expect(spy).not.toHaveBeenCalled()
    })

    it('drafts never fire and paused workflows skip', async () => {
      for (const status of ['draft', 'paused', 'archived']) {
        const db = makeDb()
        db.schedules.push(entry({}, status))
        const spy = startSpy(db)
        await db.engine.processSchedulesForOrg(ORG, NOW)
        expect(spy).not.toHaveBeenCalled()
        expect(db.schedules[0].occurrence_count).toBe(0)
      }
    })

    it('missed occurrences collapse into the latest one (fired once)', async () => {
      const db = makeDb()
      db.schedules.push(entry({ last_fired_at: new Date('2026-10-01T03:30:00Z') })) // a week of misses
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][3]).toMatchObject({ scheduled_for: '2026-10-08T03:30:00.000Z' })
    })

    it('no catch-up after resume: a marker set to "now" leaves earlier occurrences unfired', async () => {
      const db = makeDb()
      // Resumed at 09:45 IST (after today's 09:00) — today's occurrence is not caught up.
      db.schedules.push(entry({ last_fired_at: new Date('2026-10-08T04:15:00Z') }))
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW)
      expect(spy).not.toHaveBeenCalled()
      // …and tomorrow's runs as usual.
      db.clock.now.mockResolvedValue(new Date('2026-10-09T04:30:00Z'))
      await db.engine.processSchedulesForOrg(ORG, new Date('2026-10-09T04:30:00Z'))
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('ends after N: counts each run and retires the entry at N', async () => {
      const db = makeDb()
      db.schedules.push(entry({ end_condition: 'after_n', end_after: 2, occurrence_count: 1 }))
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(db.schedules[0]).toMatchObject({ occurrence_count: 2, is_active: false })
      db.clock.now.mockResolvedValue(new Date('2026-10-09T04:30:00Z'))
      await db.engine.processSchedulesForOrg(ORG, new Date('2026-10-09T04:30:00Z'))
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('monthly on the 1st at 09:00 (org time zone), weekly on chosen days', async () => {
      const db = makeDb()
      db.schedules.push(entry({ schedule_type: 'monthly', month_days: [1], last_fired_at: new Date('2026-10-01T03:30:00Z') }))
      // Thursdays.
      db.schedules.push(entry({ id: 'sched-2', schedule_type: 'weekly', days: [4], last_fired_at: new Date('2026-10-01T03:30:00Z') }))
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, NOW) // Thu 8 Oct
      expect(spy.mock.calls.map((c) => (c[3] as Row).schedule_entry_id)).toEqual(['sched-2'])
      const nov1 = new Date('2026-11-01T04:00:00Z') // Sun 1 Nov 09:30 IST
      db.clock.now.mockResolvedValue(nov1)
      await db.engine.processSchedulesForOrg(ORG, nov1)
      expect(spy.mock.calls.map((c) => c[3])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ schedule_entry_id: 'sched-1', scheduled_for: '2026-11-01T03:30:00.000Z' }),
        ]),
      )
    })

    it('never fires past the org clock (replay passes end-of-day)', async () => {
      const db = makeDb()
      db.schedules.push(entry({ time: '18:00', last_fired_at: new Date('2026-10-07T12:30:00Z') })) // yesterday's 18:00 ran
      const spy = startSpy(db)
      await db.engine.processSchedulesForOrg(ORG, new Date('2026-10-08T18:29:59Z'))
      expect(spy).not.toHaveBeenCalled()
    })

    it('a schedule that cannot start its workflow tells the owners and the sweep keeps going', async () => {
      const db = makeDb()
      db.schedules.push(entry())
      db.schedules.push(entry({ id: 'sched-2', workflow_template_id: 'tpl-2' }))
      const spy = jest
        .spyOn(db.engine, 'createInstance')
        .mockRejectedValueOnce(new BadRequestException('This workflow has no steps yet.'))
        .mockResolvedValueOnce({ id: 'i' })
      await db.engine.processSchedulesForOrg(ORG, NOW)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(recipientsOf(db, 'workflow_stuck')).toEqual(['u-owner'])
    })
  })
})

describe('WorkflowEngineService — step timing', () => {
  // NOW = Thu 2026-10-08 10:00 IST. 09:00 IST = 03:30Z, 18:00 IST = 12:30Z.
  const tStep = (id: string, order: number, over: Row = {}) => ({
    id,
    title: `T ${id}`,
    description: null,
    assigner_user_id: 'u-assigner',
    assignee_user_ids: ['u-worker'],
    cc_user_ids: [],
    completion_mode: 'any_can_complete',
    priority_id: null,
    category_id: null,
    tag_ids: [],
    proof_required: false,
    proof_allowed_extensions: [],
    checklist_items: [],
    due_days: 1,
    due_time: '18:00',
    escalation_mode: 'manager',
    escalation_user_ids: [],
    if_late: 'wait',
    depends_on_step_ids: [],
    order_index: order,
    is_branch_step: false,
    start_rule: null,
    due_rule: null,
    ...over,
  })
  const template = (stepsList: Row[], schedules: Row[] = []) => ({
    id: 'tpl-1',
    organization_id: ORG,
    name: 'Onboarding',
    status: 'active',
    owner_user_ids: ['u-owner'],
    created_by_user_id: 'u-owner',
    steps: stepsList,
    schedules,
  })
  const weekly = [{ schedule_type: 'weekly', every: 1 }]
  const daily = [{ schedule_type: 'daily', every: 1 }]
  const FRI_0900 = new Date('2026-10-09T03:30:00Z')
  const FRI_1800 = new Date('2026-10-09T12:30:00Z')
  const SAT_1800 = new Date('2026-10-10T12:30:00Z')

  async function startRun(db: Db, stepsList: Row[], schedules: Row[] = []) {
    db.prisma.workflowTemplate.findFirst.mockResolvedValue(template(stepsList, schedules))
    const { id } = await db.engine.createInstance(ORG, 'tpl-1', 'manual_trigger', {}, 'u-owner')
    const inst = db.instances.find((i) => i.id === id)!
    // The double doesn't resolve `include`; later engine calls read the template.
    inst.template = { name: 'Onboarding', owner_user_ids: ['u-owner'], created_by_user_id: 'u-owner' }
    return { inst, rows: db.rowsOf(inst) }
  }

  it('a calendar start in the future: the row waits (pending, start_at, no task), every row gets its plan', async () => {
    const db = makeDb()
    const { rows } = await startRun(
      db,
      [
        tStep('a', 0, { start_rule: { kind: 'weekday', weekday: 5, time: '09:00' } }),
        tStep('b', 1, { depends_on_step_ids: ['a'] }), // legacy timing
      ],
      weekly,
    )
    const [a, b] = rows
    expect(a).toMatchObject({ status: 'pending', start_at: FRI_0900, planned_start_at: FRI_0900, planned_due_at: SAT_1800 })
    expect(a.task_id ?? null).toBeNull()
    expect(a.step_snapshot).toMatchObject({ start_rule: { kind: 'weekday', weekday: 5, time: '09:00' }, due_rule: null, timing_every: 1 })
    // Legacy step: planned to start when A is due, due a day later (display only).
    expect(b.status).toBe('pending')
    expect(b.start_at ?? null).toBeNull()
    expect(b).toMatchObject({ planned_start_at: SAT_1800, planned_due_at: new Date('2026-10-11T12:30:00Z') })
    expect(db.tasks).toHaveLength(0)
    expect(db.eventsOf('step_waiting')[0].message).toBe('“T a” is ready and starts Fri 9 Oct, 9:00 AM.')
    const started = db.notifications.emit.mock.calls.find(([p]: any) => p.event_type === 'workflow_triggered')![0]
    expect(started.body).toContain('First step: “T a” (starts Fri 9 Oct, 9:00 AM).')
  })

  it('the 15-minute tick starts a waiting row when its time comes (at its start time), deadline from that start', async () => {
    const db = makeDb()
    const { rows } = await startRun(db, [tStep('a', 0, { start_rule: { kind: 'weekday', weekday: 5, time: '09:00' } })], weekly)
    await db.engine.processWaitingStepsForOrg(ORG, NOW)
    expect(rows[0].status).toBe('pending')

    const later = new Date('2026-10-09T03:40:00Z')
    db.clock.now.mockResolvedValue(later)
    await db.engine.processWaitingStepsForOrg(ORG, later)
    expect(rows[0]).toMatchObject({ status: 'active', task_created_at: FRI_0900, scheduled_at: SAT_1800 })
    expect(db.tasks).toHaveLength(1)
    expect(db.tasks[0].deadline).toEqual(SAT_1800)
    expect(db.eventsOf('step_started')[0].created_at.getTime()).toBeGreaterThanOrEqual(FRI_0900.getTime())
    await db.engine.processWaitingStepsForOrg(ORG, later) // idempotent
    expect(db.tasks).toHaveLength(1)
  })

  it('never acts past the org clock (replay passes end-of-day); a tick more than a day late starts it now', async () => {
    const db = makeDb()
    const { rows } = await startRun(db, [tStep('a', 0, { start_rule: { kind: 'weekday', weekday: 5, time: '09:00' } })], weekly)
    await db.engine.processWaitingStepsForOrg(ORG, new Date('2026-10-09T18:29:00Z')) // org clock still Thu
    expect(rows[0].status).toBe('pending')

    const muchLater = new Date('2026-10-12T04:30:00Z')
    db.clock.now.mockResolvedValue(muchLater)
    await db.engine.processWaitingStepsForOrg(ORG, muchLater)
    expect(rows[0]).toMatchObject({ status: 'active', task_created_at: muchLater })
  })

  it('does nothing when the workflows module is not fully enabled', async () => {
    const db = makeDb()
    db.prisma.orgModuleEntitlement.findUnique.mockResolvedValue({ state: 'preview' })
    await db.engine.processWaitingStepsForOrg(ORG, NOW)
    expect(db.auditWriter.runAsSystem).not.toHaveBeenCalled()
  })

  it('a calendar due is the PLANNED due — kept even when the step before ran late', async () => {
    const db = makeDb()
    const { rows } = await startRun(
      db,
      [
        tStep('a', 0, { due_rule: { kind: 'weekday', weekday: 5, time: '18:00' } }),
        tStep('b', 1, { depends_on_step_ids: ['a'], due_rule: { kind: 'weekday', weekday: 5, time: '18:00' } }),
      ],
      weekly,
    )
    const [a, b] = rows
    expect(a).toMatchObject({ status: 'active', planned_due_at: FRI_1800, scheduled_at: FRI_1800 })
    expect(b.planned_due_at).toEqual(new Date('2026-10-16T12:30:00Z'))
    const lateDay = new Date('2026-10-17T05:00:00Z')
    db.clock.now.mockResolvedValue(lateDay)
    await db.completeTask(a)
    expect(b.status).toBe('active')
    expect(db.tasksFor(b)[0].deadline).toEqual(new Date('2026-10-16T12:30:00Z')) // late from birth: visible
  })

  it('a relative due counts from the ACTUAL start', async () => {
    const db = makeDb()
    const { rows } = await startRun(db, [
      tStep('a', 0),
      tStep('b', 1, { depends_on_step_ids: ['a'], due_rule: { kind: 'days_after_start', days: 2, time: '17:00' } }),
    ])
    db.clock.now.mockResolvedValue(new Date('2026-10-12T04:30:00Z')) // Mon 10:00
    await db.completeTask(rows[0])
    expect(db.tasksFor(rows[1])[0].deadline).toEqual(new Date('2026-10-14T11:30:00Z')) // Wed 17:00
  })

  it('days after the steps before: computed when they are done, moved off a weekly off', async () => {
    const db = makeDb()
    db.holidays.isWorkingDay.mockImplementation(async (d: Date) => d.getDay() !== 6) // Saturdays off
    const { rows } = await startRun(db, [
      tStep('a', 0),
      tStep('b', 1, { depends_on_step_ids: ['a'], start_rule: { kind: 'days_after_previous', days: 2, time: '09:00' } }),
    ])
    await db.completeTask(rows[0]) // Thu 8 Oct → +2 = Sat 10 Oct → Sun 11 Oct 09:00
    expect(rows[1]).toMatchObject({ status: 'pending', start_at: new Date('2026-10-11T03:30:00Z') })
    expect(rows[1].task_id ?? null).toBeNull()
    expect(db.eventsOf('step_waiting')).toHaveLength(1)
  })

  it('time of day: that time on the day it may start; already past → the next day', async () => {
    const db = makeDb()
    const { rows } = await startRun(
      db,
      [tStep('a', 0), tStep('b', 1, { depends_on_step_ids: ['a'], start_rule: { kind: 'time_of_day', time: '09:00' } })],
      daily,
    )
    await db.completeTask(rows[0]) // 10:00 → tomorrow 09:00
    expect(rows[1].start_at).toEqual(FRI_0900)
    const { rows: r2 } = await startRun(
      db,
      [tStep('a', 0), tStep('b', 1, { depends_on_step_ids: ['a'], start_rule: { kind: 'time_of_day', time: '15:00' } })],
      daily,
    )
    await db.completeTask(r2[0])
    expect(r2[1].start_at).toEqual(new Date('2026-10-08T09:30:00Z'))
  })

  it('days after the run start / calendar: max(planned, now) — a step that becomes ready late starts at once', async () => {
    const db = makeDb()
    const { rows } = await startRun(db, [
      tStep('a', 0),
      tStep('b', 1, { depends_on_step_ids: ['a'], start_rule: { kind: 'days_after_run_start', days: 1, time: '09:00' } }),
    ])
    // A is due Fri 18:00, so B is planned then (order wins over "day 1 at 09:00").
    expect(rows[1].planned_start_at).toEqual(FRI_1800)
    db.clock.now.mockResolvedValue(new Date('2026-10-10T04:30:00Z')) // Sat — after the plan
    await db.completeTask(rows[0])
    expect(rows[1].status).toBe('active')
  })

  it('a calendar start that is ready early waits for its planned start', async () => {
    const db = makeDb()
    const { rows } = await startRun(
      db,
      [tStep('a', 0), tStep('b', 1, { depends_on_step_ids: ['a'], start_rule: { kind: 'weekday', weekday: 1, time: '09:00' } })],
      weekly,
    )
    expect(rows[1].planned_start_at).toEqual(new Date('2026-10-12T03:30:00Z'))
    await db.completeTask(rows[0]) // Thu — done early
    expect(rows[1]).toMatchObject({ status: 'pending', start_at: new Date('2026-10-12T03:30:00Z') })
  })

  it('order always wins: a waiting step never starts while a step before it is not done (it waits again from scratch)', async () => {
    const db = makeDb()
    const { inst, rows } = dagRun(db, [[], [0]])
    rows[0].status = 'active' // reopened after B started waiting
    rows[1].start_at = new Date(NOW.getTime() - HOUR)
    await db.engine.processWaitingStepsForOrg(ORG, NOW)
    expect(rows[1]).toMatchObject({ status: 'pending', start_at: null, task_id: null })
    expect(inst.status).toBe('running')
  })

  it('a waiting row whose time came starts at its start time; a run that only waits is not stranded', async () => {
    const db = makeDb()
    const { inst, rows } = dagRun(db, [[], [0]])
    rows[0].status = 'completed'
    rows[1].start_at = new Date(NOW.getTime() + HOUR)
    await expect(db.engine.retryInstance(ORG, inst.id, 'u-owner')).rejects.toThrow(/moving normally/)
    rows[1].start_at = new Date(NOW.getTime() - HOUR)
    await db.engine.processWaitingStepsForOrg(ORG, NOW)
    expect(rows[1]).toMatchObject({ status: 'active', task_created_at: new Date(NOW.getTime() - HOUR) })
  })

  describe('Start now', () => {
    async function waitingRun(db: Db) {
      return startRun(
        db,
        [tStep('a', 0, { start_rule: { kind: 'weekday', weekday: 5, time: '09:00' } }), tStep('b', 1, { depends_on_step_ids: ['a'] })],
        weekly,
      )
    }

    it('starts a waiting step immediately; deadline rules unchanged; history says who started it early', async () => {
      const db = makeDb()
      const { inst, rows } = await waitingRun(db)
      await db.engine.startStepNow(ORG, inst.id, rows[0].id, 'u-owner')
      expect(rows[0]).toMatchObject({ status: 'active', task_created_at: NOW })
      expect(db.tasksFor(rows[0])[0].deadline).toEqual(FRI_1800) // relative due: 1 day after NOW at 18:00
      const ev = db.eventsOf('step_started')[0]
      expect(ev.message).toBe('“T a” was started early by u-owner — assigned to u-worker.')
      expect(ev).toMatchObject({ actor_user_id: 'u-owner', metadata: { started_early: true } })
      expect(rows[1].status).toBe('pending')
    })

    it('refuses a step that is not waiting, a row of another run / org, and a finished run', async () => {
      const db = makeDb()
      const { inst, rows } = await waitingRun(db)
      await expect(db.engine.startStepNow(ORG, inst.id, rows[1].id, 'u-owner')).rejects.toThrow(
        '“T b” isn’t waiting for its start time, so there is nothing to start early.',
      )
      await expect(db.engine.startStepNow(ORG, inst.id, 'row-elsewhere', 'u-owner')).rejects.toBeInstanceOf(NotFoundException)
      await expect(db.engine.startStepNow('org-other', inst.id, rows[0].id, 'u-owner')).rejects.toBeInstanceOf(NotFoundException)
      inst.status = 'cancelled'
      await expect(db.engine.startStepNow(ORG, inst.id, rows[0].id, 'u-owner')).rejects.toThrow(/only a running run/)
      expect(db.tasks).toHaveLength(0)
    })
  })

  it('skip and cancel work on waiting rows (no task to withdraw)', async () => {
    const db = makeDb()
    const { inst, rows } = dagRun(db, [[], [0], [1]])
    rows[0].status = 'completed'
    rows[1].start_at = new Date(NOW.getTime() + 24 * HOUR)
    await db.engine.skipStep(ORG, inst.id, 'u-owner', rows[1].id)
    expect(rows[1].status).toBe('skipped')
    expect(rows[2].status).toBe('active') // its dependent may start

    const db2 = makeDb()
    const run2 = dagRun(db2, [[], [0]])
    run2.rows[0].status = 'completed'
    run2.rows[1].start_at = new Date(NOW.getTime() + 24 * HOUR)
    await db2.engine.cancelInstance(ORG, run2.inst.id, 'u-owner')
    expect(run2.rows[1].status).toBe('skipped')
    expect(db2.prisma.taskArchive.create).not.toHaveBeenCalled()
  })

  it('a waiting row is never a send-back target (only completed steps are)', async () => {
    const db = makeDb()
    const { inst, rows } = dagRun(db, [[], [], [0, 1]])
    rows[0].status = 'completed'
    rows[1].start_at = new Date(NOW.getTime() + HOUR)
    rows[2].status = 'active'
    db.addTask(rows[2])
    const targets = await db.engine.sendBackTargets(ORG, inst.id, rows[2].id)
    expect(targets.map((t) => t.row_id)).toEqual([rows[0].id])
  })

  it('run planning moves a computed start off a weekly off (the org-local calendar day), dues via the deadline rules', async () => {
    const db = makeDb()
    db.holidays.isWorkingDay.mockImplementation(async (d: Date) => d.getDay() !== 0) // Sundays off
    db.holidays.adjustDeadline.mockImplementation(async (d: Date) => new Date(d.getTime() + HOUR))
    const { rows } = await startRun(db, [tStep('a', 0, { start_rule: { kind: 'weekday', weekday: 0, time: '09:00' } })], weekly)
    expect(rows[0]).toMatchObject({
      start_at: new Date('2026-10-12T03:30:00Z'),
      planned_start_at: new Date('2026-10-12T03:30:00Z'),
      planned_due_at: new Date('2026-10-13T13:30:00Z'), // Tue 18:00 + the (fake) holiday adjustment
    })
  })

  it('legacy steps (no rules) start at once with a relative deadline, exactly as before', async () => {
    const db = makeDb()
    const { rows } = await startRun(db, [tStep('a', 0, { due_days: 2, due_time: '17:00' })])
    expect(rows[0].status).toBe('active')
    expect(rows[0].start_at ?? null).toBeNull()
    expect(db.tasks[0].deadline).toEqual(new Date('2026-10-10T11:30:00Z'))
    expect(db.eventsOf('step_waiting')).toHaveLength(0)
    expect(db.holidays.isWorkingDay).not.toHaveBeenCalled()
  })
})
