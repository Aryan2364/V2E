import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { WorkflowTemplateService, overlapWarning } from './workflow-template.service'
import { planRun } from './engine/plan'
import { Principal } from '../access-rights/permissions.service'

const ORG = 'org-1'
const TPL = 'tpl-1'
const RUN = 'run-1'
const NOW = new Date('2026-10-08T00:00:00Z')
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'
const me = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u-me',
  systemRoleId: null,
  isAdmin: false,
  isSuperAdmin: false,
  ...over,
})

type Grant = 'view' | 'edit' | 'trigger'
const template = (over: Record<string, unknown> = {}, grants: Grant[] = []) => ({
  id: TPL,
  name: 'Onboarding',
  status: 'draft',
  owner_user_ids: ['u-owner'],
  created_by_user_id: 'u-creator',
  access: grants.map((access_type) => ({ access_type })),
  ...over,
})

/** A v2 template step row as Prisma returns it. */
const stepRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  workflow_template_id: TPL,
  order_index: 0,
  title: `Step ${id}`,
  description: null,
  assignee_type: 'fixed_person',
  assignee_user_id: null,
  assignee_role: null,
  assigner_user_id: 'u-me',
  deadline_config: {},
  proof_required: false,
  priority_id: null,
  category_id: null,
  checklist_items: [],
  if_overdue_action: 'block_next',
  branch_step_id: null,
  is_branch_step: false,
  parent_branch_step_id: null,
  assignee_user_ids: [U1],
  cc_user_ids: [],
  completion_mode: 'any_can_complete',
  tag_ids: [],
  proof_allowed_extensions: [],
  due_days: 1,
  due_time: '18:00',
  escalation_mode: 'manager',
  escalation_user_ids: [],
  if_late: 'wait',
  depends_on_step_ids: [],
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  ...over,
})

function build(prismaOverrides: Record<string, unknown> = {}) {
  const prisma: any = {
    workflowTemplate: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: TPL }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    workflowStep: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'ws-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { order_index: null } }),
    },
    workflowScheduleEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'sc-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workflowAccess: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workflowInstance: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    workflowInstanceStep: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    workflowInstanceEvent: { findMany: jest.fn().mockResolvedValue([]) },
    organizationMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm' }),
      // Everyone asked about is an active member unless a test says otherwise.
      findMany: jest.fn(async ({ where }: any) => (where.user_id?.in ?? []).map((user_id: string) => ({ user_id }))),
    },
    workflowMaster: { findUnique: jest.fn().mockResolvedValue(null) },
    employeeProfile: { findMany: jest.fn().mockResolvedValue([]) },
    taskChecklistTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    taskTag: { findMany: jest.fn().mockResolvedValue([]) },
    taskPriority: { findMany: jest.fn().mockResolvedValue([]) },
    taskCategory: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    task: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    taskAssignee: { findFirst: jest.fn().mockResolvedValue(null) },
    taskChecklist: { findMany: jest.fn().mockResolvedValue([]) },
    taskAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    organization: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    ...prismaOverrides,
  }
  const engine: any = {
    createInstance: jest.fn(),
    cancelInstance: jest.fn(),
    sendBack: jest.fn().mockResolvedValue(undefined),
    skipStep: jest.fn().mockResolvedValue(undefined),
    startStepNow: jest.fn().mockResolvedValue(undefined),
    // The engine's planning entry point, over the real (pure) planner, no holidays.
    planTimelines: jest.fn((_org: string, tz: string, steps: any[], runStarts: Date[], every: number) =>
      Promise.all(runStarts.map((runStart) => planRun(steps, { tz, runStart, every }))),
    ),
  }
  const clock: any = { now: jest.fn().mockResolvedValue(NOW) }
  const checklistAccess: any = {
    isAccessible: jest.fn().mockResolvedValue(true),
    listAccessibleTemplates: jest.fn().mockResolvedValue([]),
  }
  const files: any = {
    documents: jest.fn().mockResolvedValue({ step_files: [], run_files: [] }),
    upload: jest.fn(),
    getDownloadUrl: jest.fn(),
    findRunFile: jest.fn(),
    remove: jest.fn().mockResolvedValue({ id: 'f-1' }),
  }
  const tasksGate = { assertCanViewTask: jest.fn().mockResolvedValue(undefined) }
  const moduleRef: any = { get: jest.fn(() => tasksGate) }
  const service = new WorkflowTemplateService(prisma, engine, clock, checklistAccess, files, moduleRef)
  return { service, prisma, engine, checklistAccess, files, tasksGate, moduleRef }
}

/**
 * A harness for definition saves: the template (with the caller's grants) loads by
 * select, the detail read by include; existing steps / schedules / all grants as given.
 */
function defHarness(
  steps: ReturnType<typeof stepRow>[] = [],
  tpl: ReturnType<typeof template> = template({}, ['edit']),
  schedules: unknown[] = [],
  grants: { user_id: string; access_type: string }[] = [],
) {
  const h = build()
  const T0 = new Date('2026-10-05T00:00:00Z')
  const full = { manual_start_enabled: true, updated_at: T0, ...tpl }
  h.prisma.workflowTemplate.findFirst.mockImplementation(async (args: any) =>
    args.include
      ? {
          ...full,
          description: null,
          workflow_nature: 'one_time',
          recurring_type: null,
          show_workflow_on_task_card: true,
          created_at: T0,
          schedules: [],
          _count: { steps: steps.length, instances: 0 },
        }
      : full,
  )
  h.prisma.workflowStep.findMany.mockResolvedValue(steps)
  h.prisma.workflowScheduleEntry.findMany.mockResolvedValue(schedules)
  h.prisma.workflowAccess.findMany.mockResolvedValue(grants)
  return h
}

/** A definition body (Save draft unless `mode` says otherwise). */
const def = (over: Record<string, unknown> = {}) => ({
  name: 'Onboarding',
  description: null,
  mode: 'draft',
  starts: { manual: { enabled: true, starter_user_ids: [U1] }, schedules: [] },
  steps: [] as unknown[],
  ...over,
})
/** A definition step (keys double as ids for existing steps). */
const dstep = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  title: `Step ${key}`,
  assignee_user_ids: [U1],
  ...over,
})

describe('WorkflowTemplateService — capabilities', () => {
  const { service } = build()
  const caps = (t: ReturnType<typeof template>, p = me()) => service.capabilitiesFor(t as never, p)

  it('admins, owners and the creator manage everything — but start only if chosen under “Manually”', () => {
    for (const p of [me({ isAdmin: true }), me({ userId: 'u-owner' }), me({ userId: 'u-creator' })]) {
      expect(caps(template({ status: 'active' }), p)).toEqual({
        can_view: true,
        can_edit: true,
        can_trigger: false,
        can_manage_access: true,
        is_starter: false,
      })
      expect(caps(template({ status: 'active' }, ['trigger']), p).can_trigger).toBe(true)
    }
  })

  it('an editor edits but cannot change who is involved, and does not start unless chosen', () => {
    expect(caps(template({ status: 'active' }, ['edit']))).toEqual({
      can_view: true,
      can_edit: true,
      can_trigger: false,
      can_manage_access: false,
      is_starter: false,
    })
  })

  it('a starter starts only a Live (not paused) workflow whose “Manually” is on', () => {
    expect(caps(template({ status: 'active' }, ['trigger'])).can_trigger).toBe(true)
    expect(caps(template({ status: 'active' }, ['view'])).can_trigger).toBe(false)
    expect(caps(template({ status: 'paused' }, ['trigger'])).can_trigger).toBe(false)
    expect(caps(template({ status: 'draft' }, ['trigger'])).can_trigger).toBe(false)
    expect(caps(template({ status: 'archived' }, ['trigger'])).can_trigger).toBe(false)
    expect(caps(template({ status: 'active', manual_start_enabled: false }, ['trigger'])).can_trigger).toBe(false)
    expect(caps(template({ status: 'paused' }, ['trigger'])).is_starter).toBe(true)
  })

  it('any member may view a Live or Paused workflow, read-only, but not a draft', () => {
    for (const status of ['active', 'paused']) {
      expect(caps(template({ status }))).toEqual({
        can_view: true,
        can_edit: false,
        can_trigger: false,
        can_manage_access: false,
        is_starter: false,
      })
    }
    expect(caps(template({ status: 'draft' })).can_view).toBe(false)
  })
})

describe('WorkflowTemplateService — gates', () => {
  it('404s a template from another org (query is org-scoped)', async () => {
    const { service, prisma } = build()
    prisma.workflowTemplate.findFirst.mockResolvedValue(null)
    await expect(service.getTemplate(ORG, TPL, me())).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.workflowTemplate.findFirst.mock.calls[0][0].where).toEqual({ id: TPL, organization_id: ORG })
  })

  it('403s a draft for someone without access', async () => {
    const { service, prisma } = build()
    prisma.workflowTemplate.findFirst.mockResolvedValue(template())
    await expect(service.getTemplate(ORG, TPL, me())).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('archived workflows reject saves', async () => {
    const h = defHarness([], template({ status: 'archived' }, ['edit']))
    await expect(h.service.updateDefinition(ORG, TPL, def() as never, me())).rejects.toThrow(
      'This workflow is archived. Restore it to make changes.',
    )
  })

  it('viewers cannot save', async () => {
    const h = defHarness([], template({ status: 'active' }))
    await expect(h.service.updateDefinition(ORG, TPL, def() as never, me())).rejects.toBeInstanceOf(ForbiddenException)
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('WorkflowTemplateService — starting by hand', () => {
  function startHarness(tpl: ReturnType<typeof template>) {
    const h = build()
    h.prisma.workflowTemplate.findFirst.mockResolvedValue(tpl)
    h.engine.createInstance.mockResolvedValue({ id: RUN })
    // instanceDetail after the start: not under test here.
    h.prisma.workflowInstance.findFirst.mockResolvedValue(null)
    return h
  }

  it('only the people chosen under “Manually” can start; an owner who is not one gets 403', async () => {
    const owner = startHarness(template({ status: 'active' }))
    await expect(owner.service.triggerInstance(ORG, TPL, undefined, me({ userId: 'u-owner' }))).rejects.toThrow(
      new ForbiddenException('Only the people listed under “Who can start it” can start this workflow.'),
    )
    const admin = startHarness(template({ status: 'active' }))
    await expect(admin.service.triggerInstance(ORG, TPL, undefined, me({ isAdmin: true }))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(owner.engine.createInstance).not.toHaveBeenCalled()

    const starter = startHarness(template({ status: 'active' }, ['trigger']))
    await starter.service.triggerInstance(ORG, TPL, ' Batch 7 ', me()).catch(() => undefined)
    expect(starter.engine.createInstance).toHaveBeenCalledWith(ORG, TPL, 'manual_trigger', { name: 'Batch 7' }, 'u-me')
  })

  it('a paused workflow or a draft cannot be started (400 says what to do)', async () => {
    const paused = startHarness(template({ status: 'paused' }, ['trigger']))
    await expect(paused.service.triggerInstance(ORG, TPL, undefined, me())).rejects.toThrow(
      new BadRequestException('This workflow is paused. Resume it to start it.'),
    )
    const draft = startHarness(template({ status: 'draft' }, ['trigger']))
    await expect(draft.service.triggerInstance(ORG, TPL, undefined, me())).rejects.toThrow(
      'This workflow is a draft. Save it to make it live.',
    )
    expect(paused.engine.createInstance).not.toHaveBeenCalled()
    expect(draft.engine.createInstance).not.toHaveBeenCalled()
  })

  it('a schedule-only workflow has no start by hand', async () => {
    const h = startHarness(template({ status: 'active', manual_start_enabled: false }, ['trigger']))
    await expect(h.service.triggerInstance(ORG, TPL, undefined, me())).rejects.toThrow(
      new BadRequestException('This workflow starts only on its schedule.'),
    )
    expect(h.engine.createInstance).not.toHaveBeenCalled()
  })
})

describe('WorkflowTemplateService — definition: steps and tracks', () => {
  it('Save draft saves an incomplete new workflow as a draft; its starters default to its owners', async () => {
    const h = defHarness()
    await h.service.createDefinition(
      ORG,
      def({
        starts: { manual: { enabled: true }, schedules: [] },
        steps: [dstep('n1', { title: '', assignee_user_ids: [] })],
      }) as never,
      me(),
    )
    expect(h.prisma.workflowTemplate.create.mock.calls[0][0].data).toMatchObject({
      name: 'Onboarding',
      status: 'draft',
      owner_user_ids: ['u-me'],
      created_by_user_id: 'u-me',
      manual_start_enabled: true,
    })
    expect(h.prisma.workflowStep.create.mock.calls[0][0].data).toMatchObject({ title: '', assignee_user_ids: [] })
    expect(h.prisma.workflowAccess.createMany.mock.calls[0][0].data).toEqual([
      { user_id: 'u-me', access_type: 'trigger', organization_id: ORG, workflow_template_id: TPL },
    ])
  })

  it('Save names exactly what is missing, with the step key so the builder can show it', async () => {
    const h = defHarness()
    const err: any = await h.service
      .createDefinition(
        ORG,
        def({
          mode: 'save',
          steps: [dstep('n1', { title: 'Collect' }), dstep('n2', { title: 'Review', assignee_user_ids: [], depends_on: ['n1'] })],
        }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BadRequestException)
    expect(err.message).toBe('Step 2 “Review”: add at least one assignee.')
    expect(err.getResponse()).toMatchObject({ code: 'step_invalid', step_key: 'n2', step_id: null })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()

    const blank: any = await h.service
      .createDefinition(ORG, def({ mode: 'save', steps: [dstep('n1', { title: '  ' })] }) as never, me())
      .catch((e: unknown) => e)
    expect(blank.message).toBe('Step 1: enter a title.')

    const esc: any = await h.service
      .createDefinition(
        ORG,
        def({ mode: 'save', steps: [dstep('n1', { title: 'Collect', escalation_mode: 'people', escalation_user_ids: [] })] }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(esc.message).toBe(
      'Step 1 “Collect”: add someone to escalate to, or choose “Reporting manager”.',
    )

    const noRoot: any = await h.service
      .createDefinition(ORG, def({ mode: 'save', steps: [] }) as never, me())
      .catch((e: unknown) => e)
    expect(noRoot.message).toBe('Add at least one step.')
  })

  it('tracks: client keys map to the ids created in the same transaction; depends_on is derived', async () => {
    const h = defHarness([stepRow('a', { title: 'Existing' })])
    const out: any = await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        mode: 'save',
        // Main: a → n1. Track B "Finance" splits after a: n2, which also waits for n1.
        tracks: [
          { key: 'main', name: null, split_from_step_key: null },
          { key: 'B', name: 'Finance', split_from_step_key: 'a' },
        ],
        steps: [
          dstep('n2', { title: 'Approve', track_key: 'B', merge_step_keys: ['n1'] }),
          dstep('a', { id: 'a', title: 'Existing' }),
          dstep('n1', { title: 'Review' }),
        ],
      }) as never,
      me(),
    )
    const created = h.prisma.workflowStep.create.mock.calls.map((c: any[]) => c[0].data)
    expect(created).toHaveLength(2)
    const review = created.find((d: any) => d.title === 'Review')
    const approve = created.find((d: any) => d.title === 'Approve')
    expect(review.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(review).toMatchObject({ track_key: 'main', order_index: 1, merge_step_ids: [], depends_on_step_ids: ['a'] })
    expect(approve).toMatchObject({ track_key: 'B', order_index: 0, merge_step_ids: [review.id], depends_on_step_ids: ['a', review.id] })
    expect(review).toMatchObject({ assigner_user_id: 'u-me', is_branch_step: false })
    expect(h.prisma.workflowStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a', workflow_template_id: TPL, organization_id: ORG },
        data: expect.objectContaining({ track_key: 'main', order_index: 0, depends_on_step_ids: [] }),
      }),
    )
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0].data.tracks).toEqual([
      { key: 'main', name: null, split_from_step_id: null },
      { key: 'B', name: 'Finance', split_from_step_id: 'a' },
    ])
    expect(out.step_keys).toEqual({ a: 'a', n1: review.id, n2: approve.id })
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('tracks: an “Also waits for” on a step it already waits for through its path is dropped quietly', async () => {
    const h = defHarness([stepRow('a', { title: 'Existing' })])
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        mode: 'save',
        // Path B splits after a; B1 "also waits for" a — it already does (its split point).
        tracks: [
          { key: 'main', name: null, split_from_step_key: null },
          { key: 'B', name: null, split_from_step_key: 'a' },
        ],
        steps: [dstep('a', { id: 'a', title: 'Existing' }), dstep('n1', { title: 'Check', track_key: 'B', merge_step_keys: ['a'] })],
      }) as never,
      me(),
    )
    const check = h.prisma.workflowStep.create.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.title === 'Check')
    expect(check).toMatchObject({ track_key: 'B', merge_step_ids: [], depends_on_step_ids: ['a'] })
  })

  it('tracks: an empty track is dropped; Save needs a step on the main track', async () => {
    const h = defHarness()
    await h.service.createDefinition(
      ORG,
      def({ tracks: [{ key: 'main' }, { key: 'C', split_from_step_key: null }], steps: [dstep('n1', { title: 'Collect' })] }) as never,
      me(),
    )
    expect(h.prisma.workflowTemplate.create.mock.calls[0][0].data.tracks).toEqual([{ key: 'main', name: null, split_from_step_id: null }])

    const noMain: any = await h.service
      .createDefinition(
        ORG,
        def({
          mode: 'save',
          tracks: [{ key: 'main' }, { key: 'B', split_from_step_key: null }],
          steps: [dstep('n1', { title: 'Collect', track_key: 'B' })],
        }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(noMain.message).toBe('Main path: add at least one step.')
    expect(noMain.getResponse()).toMatchObject({ code: 'track_invalid', track_key: 'main' })
  })

  it('keeps listed steps (in the new display order), creates new ones and deletes the rest — in one transaction', async () => {
    const h = defHarness([stepRow('a', { order_index: 0 }), stepRow('b', { order_index: 1, depends_on_step_ids: ['a'] })])
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({ steps: [dstep('n1', { title: 'First' }), dstep('a', { id: 'a', depends_on: ['n1'] })] }) as never,
      me(),
    )
    expect(h.prisma.workflowStep.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] }, workflow_template_id: TPL, organization_id: ORG },
    })
    const newId = h.prisma.workflowStep.create.mock.calls[0][0].data.id
    expect(h.prisma.workflowStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a', workflow_template_id: TPL, organization_id: ORG },
        data: expect.objectContaining({ order_index: 1, depends_on_step_ids: [newId] }),
      }),
    )
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses a step id that is not this workflow’s, a loop (even in a draft), bad merges and split points', async () => {
    const h = defHarness([stepRow('a')])
    await expect(
      h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('x', { id: U3 })] }) as never, me()),
    ).rejects.toThrow('One of the steps no longer exists. Reload and try again.')

    // Track B splits after step 2; step 1 also waiting for B1 would close a loop.
    const loop: any = await h.service
      .updateDefinition(
        ORG,
        TPL,
        def({
          tracks: [{ key: 'main' }, { key: 'B', split_from_step_key: 'n2' }],
          steps: [
            dstep('n1', { title: 'Collect', merge_step_keys: ['b1'] }),
            dstep('n2', { title: 'Review' }),
            dstep('b1', { title: 'Check', track_key: 'B' }),
          ],
        }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(loop.message).toBe(
      'Step 1 “Collect” can’t also wait for Step B1 “Check”. That would make a loop.',
    )
    expect(loop.getResponse()).toMatchObject({ code: 'step_invalid', step_key: 'n1' })

    const twoTracks = (merges: string[]) =>
      def({
        tracks: [{ key: 'main' }, { key: 'B', split_from_step_key: 'n1' }],
        steps: [
          dstep('n1', { title: 'Collect', merge_step_keys: merges }),
          dstep('n2', { title: 'Review' }),
          dstep('b1', { title: 'Check', track_key: 'B' }),
        ],
      })
    await expect(h.service.updateDefinition(ORG, TPL, twoTracks(['zz']) as never, me())).rejects.toThrow(
      'Step 1 “Collect”: “Also waits for” lists a step that no longer exists.',
    )
    await expect(h.service.updateDefinition(ORG, TPL, twoTracks(['n1']) as never, me())).rejects.toThrow(
      'Step 1 “Collect” can’t wait for itself.',
    )
    await expect(h.service.updateDefinition(ORG, TPL, twoTracks(['n2']) as never, me())).rejects.toThrow(
      'Step 1 “Collect”: “Also waits for” can only list steps on other paths.',
    )

    const badSplit: any = await h.service
      .updateDefinition(
        ORG,
        TPL,
        def({
          tracks: [{ key: 'main' }, { key: 'B', name: 'Finance', split_from_step_key: 'gone' }],
          steps: [dstep('n1'), dstep('b1', { track_key: 'B' })],
        }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(badSplit.message).toBe('Path B “Finance” starts after a step that no longer exists. Reload and try again.')
    expect(badSplit.getResponse()).toMatchObject({ code: 'track_invalid', track_key: 'B' })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('newly added people must be active members; people already on the step may stay; a CC who is an assignee is dropped', async () => {
    const h = defHarness([stepRow('a', { assignee_user_ids: [U1] })])
    h.prisma.organizationMember.findMany.mockImplementation(async ({ where }: any) =>
      (where.user_id.in as string[]).filter((id) => id !== U2).map((user_id) => ({ user_id })),
    )
    await expect(
      h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', assignee_user_ids: [U1, U2] })] }) as never, me()),
    ).rejects.toThrow('One or more assignees are not active members of this organization')
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({ steps: [dstep('a', { id: 'a', assignee_user_ids: [U1], cc_user_ids: [U1, U3] })] }) as never,
      me(),
    )
    const data = h.prisma.workflowStep.updateMany.mock.calls.at(-1)[0].data
    expect(data.assignee_user_ids).toEqual([U1])
    expect(data.cc_user_ids).toEqual([U3])
  })

  it('rejects proof types that can never be uploaded', async () => {
    const h = defHarness([stepRow('a')])
    await expect(
      h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', proof_allowed_extensions: ['.PDF', 'exe'] })] }) as never, me()),
    ).rejects.toThrow(".exe can’t be uploaded, so it can’t be required as proof.")
  })

  it('a step whose task creator left is handed to the person saving', async () => {
    const h = defHarness([stepRow('a', { assigner_user_id: 'u-gone' })])
    h.prisma.organizationMember.findMany.mockImplementation(async ({ where }: any) =>
      (where.user_id.in as string[]).filter((id) => id !== 'u-gone').map((user_id) => ({ user_id })),
    )
    await h.service.updateDefinition(ORG, TPL, def({ mode: 'save', steps: [dstep('a', { id: 'a' })] }) as never, me())
    expect(h.prisma.workflowStep.updateMany.mock.calls.at(-1)[0].data.assigner_user_id).toBe('u-me')
  })

  it('escalation contacts: specific people, else the assignees’ managers, else the owners', async () => {
    const steps = [
      stepRow('a', { order_index: 0, escalation_mode: 'people', escalation_user_ids: [U3] }),
      stepRow('b', { order_index: 1, assignee_user_ids: [U1] }),
      stepRow('c', { order_index: 2, assignee_user_ids: [U2] }),
    ]
    const h = defHarness(steps, template({ status: 'active', owner_user_ids: ['u-owner'] }))
    h.prisma.employeeProfile.findMany.mockResolvedValue([
      { user_id: U1, reporting_to_user_id: 'u-boss' },
      { user_id: U2, reporting_to_user_id: null },
    ])
    const out: any = await h.service.getTemplate(ORG, TPL, me())
    const by = (id: string) => out.steps.find((s: any) => s.id === id)
    expect(by('a').escalation_resolved_from).toBe('people')
    expect(by('a').escalation_contacts.map((c: any) => c.id)).toEqual([U3])
    expect(by('b').escalation_resolved_from).toBe('manager')
    expect(by('b').escalation_contacts.map((c: any) => c.id)).toEqual(['u-boss'])
    expect(by('c').escalation_resolved_from).toBe('owners_fallback')
    expect(by('c').escalation_contacts.map((c: any) => c.id)).toEqual(['u-owner'])
    const involved = Object.fromEntries(out.people.involved.map((x: any) => [x.id, x.roles]))
    expect(involved['u-owner']).toEqual(expect.arrayContaining(['owner', 'escalation_contact']))
    expect(involved[U1]).toEqual(['assignee'])
    expect(involved['u-boss']).toEqual(['escalation_contact'])
  })
})

describe('WorkflowTemplateService — definition: Save, Live and how it starts', () => {
  it('Save on a draft makes it Live and marks every schedule fired up to now (nothing missed while a draft fires)', async () => {
    const h = defHarness([stepRow('a')])
    await h.service.updateDefinition(ORG, TPL, def({ mode: 'save', steps: [dstep('a', { id: 'a' })] }) as never, me())
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: TPL, organization_id: ORG, status: 'draft' },
      data: { status: 'active' },
    })
    expect(h.prisma.workflowScheduleEntry.updateMany).toHaveBeenCalledWith({
      where: {
        workflow_template_id: TPL,
        organization_id: ORG,
        OR: [{ last_fired_at: null }, { last_fired_at: { lt: NOW } }],
      },
      data: { last_fired_at: NOW },
    })
  })

  it('Save draft keeps a draft a draft', async () => {
    const h = defHarness([stepRow('a')])
    await h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', assignee_user_ids: [] })] }) as never, me())
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0].data.status).toBe('draft')
  })

  it('a Live or Paused workflow is always fully validated — "draft" is no way around it — and keeps its status', async () => {
    for (const status of ['active', 'paused']) {
      const h = defHarness([stepRow('a')], template({ status }, ['edit']))
      await expect(
        h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', assignee_user_ids: [] })] }) as never, me()),
      ).rejects.toThrow('Step 1 “Step a”: add at least one assignee.')
      await h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a' })] }) as never, me())
      expect(h.prisma.workflowTemplate.updateMany.mock.calls.at(-1)[0].data.status).toBe(status)
      // Not going live again → schedule markers untouched.
      expect(h.prisma.workflowScheduleEntry.updateMany).not.toHaveBeenCalled()
    }
  })

  it('how it starts: “Manually” needs someone to start it, there must be a way to start, drafts skip both', async () => {
    const h = defHarness([stepRow('a')])
    const save = (starts: unknown, mode = 'save') =>
      h.service.updateDefinition(ORG, TPL, def({ mode, starts, steps: [dstep('a', { id: 'a' })] }) as never, me())
    const err: any = await save({ manual: { enabled: true, starter_user_ids: [] }, schedules: [] }).catch((e: unknown) => e)
    expect(err.message).toBe('Choose who can start this workflow.')
    expect(err.getResponse()).toMatchObject({ code: 'starts_invalid' })
    await expect(save({ manual: { enabled: false, starter_user_ids: [U1] }, schedules: [] })).rejects.toThrow(
      'Choose how this workflow starts.',
    )
    // Starters who have all left count as nobody.
    h.prisma.organizationMember.findMany.mockImplementation(async ({ where }: any) =>
      (where.user_id.in as string[]).filter((id) => id !== U2).map((user_id) => ({ user_id })),
    )
    h.prisma.workflowAccess.findMany.mockResolvedValue([{ user_id: U2, access_type: 'trigger' }])
    await expect(save({ manual: { enabled: true }, schedules: [] })).rejects.toThrow('Choose who can start this workflow.')
    // A draft may be saved with neither.
    await expect(save({ manual: { enabled: false }, schedules: [] }, 'draft')).resolves.toBeDefined()
    await expect(save({ manual: { enabled: true, starter_user_ids: [] }, schedules: [] }, 'draft')).resolves.toBeDefined()
  })

  it('a schedule-only workflow saves; an incomplete schedule is named on Save', async () => {
    const h = defHarness([stepRow('a')])
    const sched = (over: Record<string, unknown> = {}) => ({
      schedule_type: 'monthly',
      every: 1,
      month_days: [1],
      time: '09:00',
      start_date: '2026-10-01',
      end_condition: 'never',
      ...over,
    })
    const save = (schedules: unknown[]) =>
      h.service.updateDefinition(
        ORG,
        TPL,
        def({ mode: 'save', starts: { manual: { enabled: false }, schedules }, steps: [dstep('a', { id: 'a' })] }) as never,
        me(),
      )
    const err: any = await save([sched({ schedule_type: 'weekly', days: [] })]).catch((e: unknown) => e)
    expect(err.message).toBe('Schedule 1: choose at least one day of the week.')
    expect(err.getResponse()).toMatchObject({ code: 'starts_invalid', schedule_index: 0 })
    await save([sched()])
    expect(h.prisma.workflowTemplate.updateMany.mock.calls.at(-1)[0].data).toMatchObject({
      manual_start_enabled: false,
      workflow_nature: 'recurring',
      recurring_type: 'monthly',
    })
  })

  it('schedules: kept by id (only this workflow’s), new ones get a "now" marker; dates are stored as that calendar day', async () => {
    const existing = {
      id: 'sc-1',
      organization_id: ORG,
      workflow_template_id: TPL,
      schedule_type: 'daily',
      every: 1,
      days: [],
      month_days: [],
      yearly_dates: [],
      time: '09:00',
      start_date: new Date('2026-09-01T00:00:00Z'),
      end_condition: 'after_n',
      end_date: null,
      end_after: 3,
      occurrence_count: 3,
      is_active: false,
      order_index: 0,
      last_fired_at: new Date('2026-10-01T03:30:00Z'),
      created_at: new Date('2026-09-01T00:00:00Z'),
      updated_at: new Date('2026-09-01T00:00:00Z'),
    }
    const h = defHarness([stepRow('a')], template({}, ['edit']), [existing])
    await expect(
      h.service.updateDefinition(
        ORG,
        TPL,
        def({ starts: { manual: { enabled: true }, schedules: [{ id: U3, schedule_type: 'daily', time: '09:00', start_date: '2026-10-01' }] } }) as never,
        me(),
      ),
    ).rejects.toThrow('One of the schedules no longer exists. Reload and try again.')

    await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        starts: {
          manual: { enabled: true },
          schedules: [
            // Raising "after N" past the count brings a spent schedule back.
            { id: 'sc-1', schedule_type: 'daily', time: '09:00', start_date: '2026-09-01', end_condition: 'after_n', end_after: 5 },
            { schedule_type: 'yearly', yearly_dates: [{ month: 4, day: 1 }], time: '10:30', start_date: '2026-10-09' },
          ],
        },
        steps: [dstep('a', { id: 'a' })],
      }) as never,
      me(),
    )
    expect(h.prisma.workflowScheduleEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'sc-1', workflow_template_id: TPL, organization_id: ORG },
      data: expect.objectContaining({ end_after: 5, is_active: true, order_index: 0 }),
    })
    expect(h.prisma.workflowScheduleEntry.create.mock.calls[0][0].data).toMatchObject({
      organization_id: ORG,
      workflow_template_id: TPL,
      schedule_type: 'yearly',
      yearly_dates: [{ month: 4, day: 1 }],
      start_date: new Date('2026-10-09T00:00:00Z'),
      end_condition: 'never',
      last_fired_at: NOW,
      order_index: 1,
    })
    expect(h.prisma.workflowScheduleEntry.deleteMany).not.toHaveBeenCalled()
  })

  it('a save over someone else’s newer save is a 409, never a silent overwrite', async () => {
    const h = defHarness([stepRow('a')])
    await expect(
      h.service.updateDefinition(ORG, TPL, def({ expected_updated_at: '2026-10-01T00:00:00.000Z' }) as never, me()),
    ).rejects.toBeInstanceOf(ConflictException)
    h.prisma.workflowTemplate.updateMany.mockResolvedValueOnce({ count: 0 }) // raced between load and write
    await expect(
      h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a' })] }) as never, me()),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('pause stops a Live workflow; resume does not catch up what it missed', async () => {
    const live = defHarness([], template({ status: 'active' }, ['edit']))
    await live.service.pauseTemplate(ORG, TPL, me())
    expect(live.prisma.workflowTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: TPL, organization_id: ORG, status: 'active' },
      data: { status: 'paused' },
    })
    const draft = defHarness([], template({ status: 'draft' }, ['edit']))
    await expect(draft.service.pauseTemplate(ORG, TPL, me())).rejects.toThrow('Only a live workflow can be paused.')

    const paused = defHarness([], template({ status: 'paused' }, ['edit']))
    await paused.service.resumeTemplate(ORG, TPL, me())
    expect(paused.prisma.workflowTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: TPL, organization_id: ORG, status: 'paused' },
      data: { status: 'active' },
    })
    expect(paused.prisma.workflowScheduleEntry.updateMany).toHaveBeenCalledWith({
      where: { workflow_template_id: TPL, organization_id: ORG, OR: [{ last_fired_at: null }, { last_fired_at: { lt: NOW } }] },
      data: { last_fired_at: NOW },
    })
  })

  it('restore brings an archived workflow back as a draft', async () => {
    const h = defHarness([], template({ status: 'archived' }, ['edit']))
    await h.service.restoreTemplate(ORG, TPL, me())
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: TPL, organization_id: ORG, status: 'archived' },
      data: { status: 'draft' },
    })
  })
})

describe('WorkflowTemplateService — definition: people and who can start it', () => {
  const grants = [
    { user_id: U2, access_type: 'edit' },
    { user_id: U1, access_type: 'trigger' },
  ]

  it('owners / creator / admins replace owners and editors; an owner may also be a starter', async () => {
    const h = defHarness([stepRow('a')], template({}, []), [], grants)
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        people: { owner_user_ids: [U1], editor_user_ids: [U1, U3] },
        starts: { manual: { enabled: true, starter_user_ids: [U1, U3] }, schedules: [] },
        steps: [dstep('a', { id: 'a' })],
      }) as never,
      me({ userId: 'u-owner' }),
    )
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0].data.owner_user_ids).toEqual([U1])
    expect(h.prisma.workflowAccess.deleteMany).toHaveBeenCalledWith({
      where: { workflow_template_id: TPL, organization_id: ORG, OR: [{ access_type: 'edit', user_id: U2 }] },
    })
    expect(h.prisma.workflowAccess.createMany.mock.calls[0][0]).toEqual({
      data: [
        { user_id: U3, access_type: 'edit', organization_id: ORG, workflow_template_id: TPL },
        { user_id: U3, access_type: 'trigger', organization_id: ORG, workflow_template_id: TPL },
      ],
      skipDuplicates: true,
    })
  })

  it('an editor saves with people unchanged, may change who can start it, but may not change owners or editors', async () => {
    const h = defHarness([stepRow('a')], template({}, ['edit']), [], grants)
    // Same people as stored → fine; and the starter list is part of "How it starts".
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        people: { owner_user_ids: ['u-owner'], editor_user_ids: [U2] },
        starts: { manual: { enabled: true, starter_user_ids: [U1, 'u-me'] }, schedules: [] },
        steps: [dstep('a', { id: 'a' })],
      }) as never,
      me(),
    )
    expect(h.prisma.workflowAccess.createMany.mock.calls[0][0].data).toEqual([
      { user_id: 'u-me', access_type: 'trigger', organization_id: ORG, workflow_template_id: TPL },
    ])
    await expect(
      h.service.updateDefinition(
        ORG,
        TPL,
        def({ people: { owner_user_ids: ['u-owner'], editor_user_ids: [U2, U3] }, steps: [dstep('a', { id: 'a' })] }) as never,
        me(),
      ),
    ).rejects.toThrow(new ForbiddenException("Only owners, the creator and admins can change who is involved."))
  })

  it('people omitted = unchanged; starters omitted on an existing workflow = unchanged', async () => {
    const h = defHarness([stepRow('a')], template({}, ['edit']), [], grants)
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({ starts: { manual: { enabled: true }, schedules: [] }, steps: [dstep('a', { id: 'a' })] }) as never,
      me(),
    )
    expect(h.prisma.workflowAccess.deleteMany).not.toHaveBeenCalled()
    expect(h.prisma.workflowAccess.createMany).not.toHaveBeenCalled()
    expect(h.prisma.workflowTemplate.updateMany.mock.calls[0][0].data.owner_user_ids).toEqual(['u-owner'])
  })

  it('a workflow needs an active owner; people newly added must be active members', async () => {
    const h = defHarness([stepRow('a')], template({}, []), [], [])
    h.prisma.organizationMember.findMany.mockImplementation(async ({ where }: any) =>
      (where.user_id.in as string[]).filter((id) => id !== U3).map((user_id) => ({ user_id })),
    )
    await expect(
      h.service.updateDefinition(
        ORG,
        TPL,
        def({ people: { owner_user_ids: [U3], editor_user_ids: [] }, steps: [dstep('a', { id: 'a' })] }) as never,
        me({ userId: 'u-owner' }),
      ),
    ).rejects.toThrow('One or more people you added are not active members of this organization')
    await expect(
      h.service.updateDefinition(
        ORG,
        TPL,
        def({ starts: { manual: { enabled: true, starter_user_ids: [U3] }, schedules: [] }, steps: [dstep('a', { id: 'a' })] }) as never,
        me({ userId: 'u-owner' }),
      ),
    ).rejects.toThrow('One or more people who can start it are not active members of this organization')
  })
})

// ── Runs ───────────────────────────────────────────────────────────────────────

const snap = (stepId: string, title: string, deps: string[]) => ({
  version: 2,
  title,
  description: null,
  assigner_user_id: 'u-creator',
  assignee_user_ids: [U1],
  depends_on_step_ids: deps,
  due_days: 2,
  due_time: '10:00',
  if_late: 'wait',
  workflow_step_id: stepId,
})
const row = (id: string, stepId: string, status: string, deps: string[], order: number, taskId: string | null) => ({
  id,
  organization_id: ORG,
  workflow_instance_id: RUN,
  workflow_step_id: stepId,
  task_id: taskId,
  assigned_to_user_id: null,
  status,
  scheduled_at: null,
  task_created_at: null,
  completed_at: null,
  branch_taken: false,
  order_index: order,
  step_snapshot: snap(stepId, `Title ${id}`, deps),
  last_error: null,
  sent_back_count: 0,
  waiting_on_row_id: null,
  returned_to_row_id: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
})
const runTask = (id: string, assignees: { user_id: string; is_cc: boolean }[], over: Record<string, unknown> = {}) => ({
  id,
  is_deleted: false,
  deadline: null,
  is_overdue: false,
  completed_at: null,
  completion_mode: 'any_can_complete',
  created_by_user_id: 'u-creator',
  status: { label: 'In progress', type: 'in_progress', color: '#000' },
  assignees,
  escalations: [],
  _count: { comments: 2 },
  ...over,
})

function runHarness(opts: {
  tpl?: ReturnType<typeof template>
  rows?: ReturnType<typeof row>[]
  tasks?: ReturnType<typeof runTask>[]
  status?: string
}) {
  const h = build()
  const tpl = opts.tpl ?? template({ status: 'active' })
  // a (done) → b (in progress, me assigned) ; c starts with the run, in progress.
  const rows = opts.rows ?? [
    row('r-a', 's-a', 'completed', [], 0, 't-a'),
    row('r-b', 's-b', 'active', ['s-a'], 1, 't-b'),
    row('r-c', 's-c', 'active', [], 2, 't-c'),
  ]
  const tasks = opts.tasks ?? [
    runTask('t-a', [{ user_id: U2, is_cc: false }]),
    runTask('t-b', [{ user_id: 'u-me', is_cc: false }]),
    runTask('t-c', [{ user_id: U2, is_cc: false }]),
  ]
  const inst = {
    id: RUN,
    organization_id: ORG,
    workflow_template_id: TPL,
    name: 'Run 1',
    trigger_type: 'manual_trigger',
    triggered_by_user_id: 'u-owner',
    status: opts.status ?? 'running',
    started_at: new Date('2026-10-01T00:00:00Z'),
    completed_at: null,
    last_error: null,
    template: tpl,
    steps: rows,
  }
  h.prisma.workflowTemplate.findFirst.mockResolvedValue(tpl)
  h.prisma.workflowInstance.findFirst.mockImplementation(async (args: any) =>
    // isRunParticipant selects the template's owner/creator/edit grants.
    args.select ? { triggered_by_user_id: inst.triggered_by_user_id, template: { ...tpl, access: [] } } : inst,
  )
  h.prisma.workflowInstanceStep.findMany.mockResolvedValue(rows.map((r) => ({ task_id: r.task_id })))
  h.prisma.task.findMany.mockResolvedValue(tasks)
  // isRunTaskParticipant: is the caller on any task of the run?
  h.prisma.task.findFirst.mockImplementation(async ({ where }: any) => {
    const userId = where.OR?.[0]?.assignees?.some?.user_id
    const hit = tasks.find((t) => t.assignees.some((a) => a.user_id === userId))
    return hit ? { id: hit.id } : null
  })
  h.prisma.taskAssignee.findFirst.mockImplementation(async ({ where }: any) => {
    const t = tasks.find((x) => x.id === where.task_id)
    return t?.assignees.some((a) => a.user_id === where.user_id && !a.is_cc) ? { id: 'ta' } : null
  })
  return { ...h, inst, rows, tasks }
}

describe('WorkflowTemplateService — run view, status and capabilities', () => {
  it('a step assignee may open a run of a workflow that is off; others may not', async () => {
    const h = runHarness({ tpl: template({ status: 'draft' }) })
    const out: any = await h.service.getInstance(ORG, TPL, RUN, me())
    expect(out.id).toBe(RUN)

    const stranger = runHarness({ tpl: template({ status: 'draft' }) })
    await expect(stranger.service.getInstance(ORG, TPL, RUN, me({ userId: 'u-stranger' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('labels steps from the snapshot (track, its name, number) when the run carries them', async () => {
    const withTrack = (r: ReturnType<typeof row>, track_key: string, number_label: string, track_name: string | null = null) => ({
      ...r,
      step_snapshot: { ...r.step_snapshot, track_key, number_label, track_name },
    })
    const h = runHarness({
      rows: [
        withTrack(row('r-a', 's-a', 'completed', [], 0, 't-a'), 'main', '1'),
        withTrack(row('r-c', 's-c', 'active', ['s-a'], 1, 't-c'), 'B', 'B1', 'Finance'),
        withTrack(row('r-b', 's-b', 'active', ['s-a'], 2, 't-b'), 'C', 'C1'),
      ] as never,
    })
    const out: any = await h.service.getInstance(ORG, TPL, RUN, me())
    expect(out.steps.map((s: any) => [s.id, s.number_label])).toEqual([
      ['r-a', '1'],
      ['r-c', 'B1'],
      ['r-b', 'C1'],
    ])
    expect(out.tracks).toEqual([
      { key: 'main', label: 'Main path' },
      { key: 'B', label: 'Finance' },
      { key: 'C', label: 'Path C' },
    ])
  })

  it('returns the DAG, task summaries and who may send back from where', async () => {
    const h = runHarness({})
    h.prisma.taskChecklist.findMany.mockResolvedValue([
      { task_id: 't-b', is_completed: true, cant_do: false, states: [] },
      { task_id: 't-b', is_completed: false, cant_do: false, states: [] },
    ])
    const out: any = await h.service.getInstance(ORG, TPL, RUN, me())
    const b = out.steps.find((s: any) => s.id === 'r-b')
    expect(b.depends_on_row_ids).toEqual(['r-a'])
    // A run started before tracks: labelled from its graph (c starts with the run → track B).
    expect(out.steps.map((s: any) => [s.id, s.number_label, s.track_key])).toEqual([
      ['r-a', '1', 'main'],
      ['r-b', '2', 'main'],
      ['r-c', 'B1', 'B'],
    ])
    expect(out.tracks).toEqual([
      { key: 'main', label: 'Main path' },
      { key: 'B', label: 'Path B' },
    ])
    expect(b.assignees).toEqual([{ id: 'u-me', name: 'Unknown user' }])
    expect(b.task).toMatchObject({ id: 't-b', checklist_total: 2, checklist_done: 1, comment_count: 2, proof_count: 0 })
    expect(b.due_days).toBe(2)
    expect(out.display_status).toBe('running')
    // Only B: I work on it and it has a completed upstream step. C has nothing upstream.
    expect(out.capabilities.can_send_back_from).toEqual(['r-b'])
    expect(out.capabilities.can_skip).toBe(false) // viewer of an active workflow, not an editor
    expect(out.capabilities.can_view_documents).toBe(true) // I'm on a task of the run
    expect(out.progress).toMatchObject({ total: 3, completed: 1, current_step_titles: ['Title r-b', 'Title r-c'] })
  })

  it('display status: waiting for info, falling behind, needs attention', async () => {
    const sent = runHarness({
      rows: [row('r-a', 's-a', 'active', [], 0, 't-a'), row('r-b', 's-b', 'sent_back', ['s-a'], 1, 't-b')],
    })
    expect(((await sent.service.getInstance(ORG, TPL, RUN, me())) as any).display_status).toBe('waiting_for_info')

    const late = runHarness({ rows: [row('r-a', 's-a', 'overdue', [], 0, 't-a')] })
    expect(((await late.service.getInstance(ORG, TPL, RUN, me())) as any).display_status).toBe('falling_behind')

    const stuck = runHarness({ status: 'stuck' })
    expect(((await stuck.service.getInstance(ORG, TPL, RUN, me())) as any).display_status).toBe('needs_attention')
  })
})

describe('WorkflowTemplateService — send back', () => {
  it("the step's assignee sends back to a completed upstream step", async () => {
    const h = runHarness({})
    await h.service.sendBack(ORG, TPL, RUN, 'r-b', { to_row_id: 'r-a', reason: '  Missing PAN copy ' }, me())
    expect(h.engine.sendBack).toHaveBeenCalledWith(ORG, RUN, 'r-b', 'r-a', 'Missing PAN copy', 'u-me', { canEdit: false })
  })

  it('targets are completed upstream steps only, nearest first', async () => {
    const h = runHarness({})
    expect(await h.service.getSendBackTargets(ORG, TPL, RUN, 'r-b', me())).toEqual([
      { row_id: 'r-a', title: 'Title r-a', number_label: '1', is_direct: true },
    ])
    expect(await h.service.getSendBackTargets(ORG, TPL, RUN, 'r-c', me())).toEqual([])
  })

  it('refuses a target that is not upstream, and people who are not on the step', async () => {
    const h = runHarness({})
    await expect(
      h.service.sendBack(ORG, TPL, RUN, 'r-c', { to_row_id: 'r-a', reason: 'Because' }, me({ userId: U2 })),
    ).rejects.toThrow('You can only send it back to an earlier step that is done.')

    await expect(
      h.service.sendBack(ORG, TPL, RUN, 'r-b', { to_row_id: 'r-a', reason: 'Because' }, me({ userId: U2 })),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(h.engine.sendBack).not.toHaveBeenCalled()
  })

  it('a row of another run is a 404', async () => {
    const h = runHarness({})
    await expect(
      h.service.sendBack(ORG, TPL, RUN, 'r-elsewhere', { to_row_id: 'r-a', reason: 'Because' }, me()),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('WorkflowTemplateService — skip, documents, files', () => {
  it('skip passes the row (scoped to the run) to the engine; editors only', async () => {
    const h = runHarness({ tpl: template({ status: 'active' }, ['edit']) })
    h.prisma.workflowInstanceStep.findFirst.mockResolvedValue({ id: 'r-c' })
    await h.service.skipStep(ORG, TPL, RUN, 'r-c', me())
    expect(h.prisma.workflowInstanceStep.findFirst.mock.calls[0][0].where).toEqual({
      id: 'r-c',
      workflow_instance_id: RUN,
      organization_id: ORG,
    })
    expect(h.engine.skipStep).toHaveBeenCalledWith(ORG, RUN, 'u-me', 'r-c')

    const viewer = runHarness({})
    await expect(viewer.service.skipStep(ORG, TPL, RUN, 'r-c', me())).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('documents are for people involved in the run, not every viewer of the workflow', async () => {
    const h = runHarness({})
    await expect(h.service.getDocuments(ORG, TPL, RUN, me({ userId: 'u-viewer' }))).rejects.toThrow(
      'Only people involved in this run can see or add its documents.',
    )
    await h.service.getDocuments(ORG, TPL, RUN, me())
    expect(h.files.documents).toHaveBeenCalledWith(
      ORG,
      RUN,
      [
        { row_id: 'r-a', step_title: 'Title r-a', task_id: 't-a' },
        { row_id: 'r-b', step_title: 'Title r-b', task_id: 't-b' },
        { row_id: 'r-c', step_title: 'Title r-c', task_id: 't-c' },
      ],
      { userId: 'u-me', isAdmin: false },
    )
  })

  it('a run file is removed only by its uploader or an editor', async () => {
    const h = runHarness({})
    h.files.findRunFile.mockResolvedValue({ id: 'f-1', uploaded_by_user_id: U2 })
    await expect(h.service.deleteRunFile(ORG, TPL, RUN, 'f-1', me())).rejects.toBeInstanceOf(ForbiddenException)
    await h.service.deleteRunFile(ORG, TPL, RUN, 'f-1', me({ userId: U2 }))
    expect(h.files.remove).toHaveBeenCalledWith(ORG, U2, RUN, 'f-1')
  })
})

describe('WorkflowTemplateService — step context (task detail banner)', () => {
  it('is gated by the task view rule and returns the run context', async () => {
    const h = runHarness({})
    h.prisma.task.findFirst.mockResolvedValue({ id: 't-b', workflow_instance_step_id: 'r-b' })
    h.prisma.workflowInstanceStep.findFirst.mockResolvedValue({ workflow_instance_id: RUN })
    const out: any = await h.service.getStepContext(ORG, 't-b', me())
    expect(h.tasksGate.assertCanViewTask).toHaveBeenCalledWith(ORG, me(), 't-b')
    expect(out).toMatchObject({
      template_id: TPL,
      instance_id: RUN,
      row_id: 'r-b',
      step_title: 'Title r-b',
      step_number: 2,
      total_steps: 3,
      can_send_back: true,
      can_open_run: true,
    })
  })

  it('denies when the task gate denies, and is null for a task outside any workflow', async () => {
    const h = runHarness({})
    h.prisma.task.findFirst.mockResolvedValue({ id: 't-x', workflow_instance_step_id: null })
    h.tasksGate.assertCanViewTask.mockRejectedValueOnce(new ForbiddenException('no'))
    await expect(h.service.getStepContext(ORG, 't-x', me())).rejects.toBeInstanceOf(ForbiddenException)
    expect(await h.service.getStepContext(ORG, 't-x', me())).toBeNull()
  })
})

describe('WorkflowTemplateService — linked checklist templates', () => {
  const T_LIVE = '33333333-3333-4333-8333-333333333333'
  const T_OFF = '44444444-4444-4444-8444-444444444444'
  const T_GONE = '55555555-5555-4555-8555-555555555555'
  const liveTemplate = {
    id: T_LIVE,
    name: 'KYC',
    is_active: true,
    // Template order is order_index, not array order.
    items: [
      { title: 'Verify PAN', order_index: 1 },
      { title: 'Collect ID', order_index: 0 },
    ],
  }

  function stepHarness(templates: unknown[] = [liveTemplate], stored: unknown[] = []) {
    const h = defHarness([stepRow('ws-1', { title: 'Collect documents', checklist_items: stored })])
    h.prisma.taskChecklistTemplate.findMany.mockResolvedValue(templates)
    return h
  }
  /** Save the workflow with one NEW step carrying these checklist items. */
  const saveNew = (h: ReturnType<typeof stepHarness>, items: unknown[]) =>
    h.service.updateDefinition(
      ORG,
      TPL,
      def({ steps: [dstep('n1', { title: 'Collect documents', checklist_items: items })] }) as never,
      me(),
    )

  it('403s a newly linked template the editor may not use (same gate as tasks)', async () => {
    const h = stepHarness()
    h.checklistAccess.isAccessible.mockResolvedValue(false)
    await expect(saveNew(h, [{ title: 'Collect ID', template_id: T_LIVE }])).rejects.toThrow(
      new ForbiddenException('You are not allowed to use this checklist template.'),
    )
    expect(h.checklistAccess.isAccessible).toHaveBeenCalledWith(ORG, 'u-me', T_LIVE)
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('400s a template id that is not in this org (lookup is org-scoped)', async () => {
    const h = stepHarness([])
    await expect(saveNew(h, [{ title: 'x', template_id: T_GONE }])).rejects.toBeInstanceOf(BadRequestException)
    expect(h.prisma.taskChecklistTemplate.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [T_GONE] },
      organization_id: ORG,
    })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('stores an active template as its current items at the group position, own items kept', async () => {
    const h = stepHarness()
    await saveNew(h, [
      { title: 'Say hello' },
      { title: 'stale copy', group_title: 'Old name', template_id: T_LIVE },
      { title: 'Wrap up', group_title: 'Mine' },
    ])
    expect(h.prisma.workflowStep.create.mock.calls[0][0].data.checklist_items).toEqual([
      { title: 'Say hello', order_index: 0 },
      { title: 'Collect ID', group_title: 'KYC', template_id: T_LIVE, order_index: 1 },
      { title: 'Verify PAN', group_title: 'KYC', template_id: T_LIVE, order_index: 2 },
      { title: 'Wrap up', group_title: 'Mine', order_index: 3 },
    ])
  })

  it('keeps an already-linked inactive or deleted template (saved copy, no access re-check)', async () => {
    const stored = [
      { title: 'Old A', group_title: 'Retired', template_id: T_OFF, order_index: 0 },
      { title: 'Gone A', group_title: 'Deleted one', template_id: T_GONE, order_index: 1 },
    ]
    const h = stepHarness([{ id: T_OFF, name: 'Retired', is_active: false, items: [{ title: 'New A' }] }], stored)
    await h.service.updateDefinition(
      ORG,
      TPL,
      def({
        steps: [
          dstep('ws-1', {
            id: 'ws-1',
            checklist_items: [
              { title: 'tampered', template_id: T_GONE },
              { title: 'Mine' },
              { title: 'tampered too', template_id: T_OFF },
            ],
          }),
        ],
      }) as never,
      me(),
    )
    expect(h.checklistAccess.isAccessible).not.toHaveBeenCalled()
    expect(h.prisma.workflowStep.updateMany.mock.calls[0][0].data.checklist_items).toEqual([
      { title: 'Gone A', group_title: 'Deleted one', template_id: T_GONE, order_index: 0 },
      { title: 'Mine', order_index: 1 },
      { title: 'Old A', group_title: 'Retired', template_id: T_OFF, order_index: 2 },
    ])
  })

  it("reports each linked template's status on the step", async () => {
    const stored = [
      { title: 'Collect ID', group_title: 'KYC', template_id: T_LIVE, order_index: 0 },
      { title: 'Gone A', group_title: 'Deleted one', template_id: T_GONE, order_index: 1 },
    ]
    const h = stepHarness([{ id: T_LIVE, name: 'KYC v2', is_active: true }], stored)
    h.checklistAccess.listAccessibleTemplates.mockResolvedValue([{ id: T_LIVE }])
    const out: any = await h.service.getTemplate(ORG, TPL, me())
    expect(out.steps[0].checklist_template_status).toEqual([
      { template_id: T_LIVE, name: 'KYC v2', active: true, accessible: true, exists: true },
      { template_id: T_GONE, name: 'Deleted one', active: false, accessible: false, exists: false },
    ])
  })

  it('meta lists exactly the templates the caller may use, items in template order', async () => {
    const h = build()
    h.prisma.orgModuleEntitlement = { findUnique: jest.fn().mockResolvedValue({ state: 'full' }) }
    h.checklistAccess.listAccessibleTemplates.mockResolvedValue([liveTemplate])
    const meta = await h.service.getMeta(ORG, me())
    expect(h.checklistAccess.listAccessibleTemplates).toHaveBeenCalledWith(ORG, 'u-me')
    expect(meta.checklist_templates).toEqual([
      { id: T_LIVE, name: 'KYC', item_count: 2, items: [{ title: 'Collect ID' }, { title: 'Verify PAN' }] },
    ])
  })
})

// ── Step timing ───────────────────────────────────────────────────────────────

describe('WorkflowTemplateService — step timing on save', () => {
  const monthly = { schedule_type: 'monthly', every: 1, month_days: [1], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }
  const weekly2 = { schedule_type: 'weekly', every: 2, days: [3], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }
  const weekday = { kind: 'weekday', weekday: 4, time: '09:00' }
  const saveErr = async (h: ReturnType<typeof defHarness>, body: Record<string, unknown>) =>
    h.service.createDefinition(ORG, def(body) as never, me()).catch((e: unknown) => e) as Promise<any>

  it('Save refuses a timing the workflow’s frequency doesn’t allow, naming the step and what to pick', async () => {
    const h = defHarness()
    const err = await saveErr(h, {
      mode: 'save',
      starts: { manual: { enabled: false }, schedules: [monthly] },
      steps: [dstep('n1', { title: 'Collect' }), dstep('n2', { title: 'Review', depends_on: ['n1'], start_rule: weekday })],
    })
    expect(err).toBeInstanceOf(BadRequestException)
    expect(err.message).toBe('Step 2 “Review”: the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.')
    expect(err.getResponse()).toMatchObject({ code: 'step_invalid', step_key: 'n2' })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()

    const manual = await saveErr(defHarness(), {
      mode: 'save',
      steps: [dstep('n1', { title: 'Collect', due_rule: { kind: 'month_day', day: 5, time: '18:00' } })],
    })
    expect(manual.message).toBe('Step 1 “Collect”: the workflow starts manually. Choose a “Days after” option.')

    const cycle = await saveErr(defHarness(), {
      mode: 'save',
      starts: { manual: { enabled: true, starter_user_ids: [U1] }, schedules: [weekly2] },
      steps: [dstep('n1', { title: 'Collect', start_rule: { kind: 'cycle_weekday', cycle: 3, weekday: 1, time: '09:00' } })],
    })
    expect(cycle.message).toBe('Step 1 “Collect”: the workflow repeats every 2 weeks. Choose Week 1 to Week 2.')

    const params = await saveErr(defHarness(), {
      mode: 'save',
      steps: [dstep('n1', { title: 'Collect', start_rule: { kind: 'days_after_previous', days: 0, time: '09:00' } })],
    })
    expect(params.message).toBe(
      'Step 1 “Collect”: start days must be 1 to 365.',
    )
  })

  it('Save refuses a first step timed before the run starts in its cycle; later steps may use any day', async () => {
    const on3rd = { ...monthly, month_days: [3] }
    const first = await saveErr(defHarness(), {
      mode: 'save',
      starts: { manual: { enabled: false }, schedules: [on3rd] },
      steps: [dstep('n1', { title: 'Collect documents', start_rule: { kind: 'month_day', day: 1, time: '09:00' } })],
    })
    expect(first).toBeInstanceOf(BadRequestException)
    expect(first.message).toBe('Step 1 “Collect documents”: pick a day on or after the 3rd, when the run starts.')
    expect(first.getResponse()).toMatchObject({ code: 'step_invalid', step_key: 'n1' })

    // Its due date too.
    const due = await saveErr(defHarness(), {
      mode: 'save',
      starts: { manual: { enabled: false }, schedules: [on3rd] },
      steps: [dstep('n1', { title: 'Collect documents', due_rule: { kind: 'month_day', day: 2, time: '18:00' } })],
    })
    expect(due.message).toBe('Step 1 “Collect documents”: pick a day on or after the 3rd, when the run starts.')

    // The first step of a path that starts with the run is a first step as well.
    const path = await saveErr(defHarness(), {
      mode: 'save',
      starts: { manual: { enabled: false }, schedules: [on3rd] },
      tracks: [{ key: 'main' }, { key: 'B', split_from_step_key: null }],
      steps: [dstep('n1', { title: 'Collect' }), dstep('b1', { title: 'Check', track_key: 'B', start_rule: { kind: 'month_day', day: 1, time: '09:00' } })],
    })
    expect(path.message).toBe('Step B1 “Check”: pick a day on or after the 3rd, when the run starts.')

    // A later step on the 1st is fine: it lands in the next month.
    const h = defHarness()
    await h.service.createDefinition(
      ORG,
      def({
        mode: 'save',
        starts: { manual: { enabled: false }, schedules: [on3rd] },
        steps: [
          dstep('n1', { title: 'Collect', start_rule: { kind: 'month_day', day: 3, time: '09:00' } }),
          dstep('n2', { title: 'Review', depends_on: ['n1'], start_rule: { kind: 'month_day', day: 1, time: '09:00' } }),
        ],
      }) as never,
      me(),
    )
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('Save words the other frequencies: weekly, yearly, daily; several trigger days use the latest', async () => {
    const save = (schedule: Record<string, unknown>, rule: Record<string, unknown>) =>
      saveErr(defHarness(), {
        mode: 'save',
        starts: { manual: { enabled: false }, schedules: [{ time: '09:00', start_date: '2026-10-01', end_condition: 'never', every: 1, ...schedule }] },
        steps: [dstep('n1', { title: 'Collect', start_rule: rule })],
      })
    expect((await save({ schedule_type: 'weekly', days: [3] }, { kind: 'weekday', weekday: 1, time: '09:00' })).message).toBe(
      'Step 1 “Collect”: pick a day on or after Wednesday, when the run starts.',
    )
    expect(
      (await save({ schedule_type: 'yearly', yearly_dates: [{ month: 4, day: 1 }] }, { kind: 'year_date', month: 3, day: 1, time: '09:00' })).message,
    ).toBe('Step 1 “Collect”: pick a date on or after 1 Apr, when the run starts.')
    expect((await save({ schedule_type: 'daily' }, { kind: 'time_of_day', time: '08:00' })).message).toBe(
      'Step 1 “Collect”: pick a time at or after 9:00 AM, when the run starts.',
    )
    expect((await save({ schedule_type: 'monthly', month_days: [3, 20] }, { kind: 'month_day', day: 10, time: '09:00' })).message).toBe(
      'Step 1 “Collect”: pick a day on or after the 20th, when the run starts.',
    )
  })

  it('when the schedule moves past a first step’s day, Save names the step (its choice is kept as it is)', async () => {
    const h = defHarness(
      [stepRow('a', { title: 'Collect', start_rule: { kind: 'month_day', day: 5, time: '09:00' } })],
      template({ status: 'active' }, ['edit']),
    )
    const err: any = await h.service
      .updateDefinition(
        ORG,
        TPL,
        def({
          starts: { manual: { enabled: false }, schedules: [{ ...monthly, month_days: [10] }] },
          steps: [dstep('a', { id: 'a', title: 'Collect' })],
        }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(err.message).toBe('Step 1 “Collect”: pick a day on or after the 10th, when the run starts.')
    expect(err.getResponse()).toMatchObject({ step_id: 'a', step_key: 'a' })
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('a draft keeps a first step before the run start; its warnings say what Save will need', async () => {
    const h = defHarness()
    const out: any = await h.service.createDefinition(
      ORG,
      def({
        starts: { manual: { enabled: false }, schedules: [{ ...monthly, month_days: [3] }] },
        steps: [dstep('n1', { title: 'Collect', start_rule: { kind: 'month_day', day: 1, time: '09:00' } })],
      }) as never,
      me(),
    )
    expect(out.warnings).toContain('Step 1 “Collect”: pick a day on or after the 3rd, when the run starts.')
  })

  it('“Days after workflow is triggered” is for first steps only: Save refuses it on a later step; drafts keep it', async () => {
    const trigger = { kind: 'days_after_run_start', days: 2, time: '09:00' }
    const err = await saveErr(defHarness(), {
      mode: 'save',
      steps: [dstep('n1', { title: 'Collect', start_rule: trigger }), dstep('n2', { title: 'Review', depends_on: ['n1'], start_rule: trigger })],
    })
    expect(err).toBeInstanceOf(BadRequestException)
    expect(err.message).toBe('Step 2 “Review”: “Days after workflow is triggered” is only for the first step — pick another start.')
    expect(err.getResponse()).toMatchObject({ code: 'step_invalid', step_key: 'n2' })

    const h = defHarness()
    const out: any = await h.service.createDefinition(
      ORG,
      def({ steps: [dstep('n1', { title: 'Collect' }), dstep('n2', { title: 'Review', depends_on: ['n1'], start_rule: trigger })] }) as never,
      me(),
    )
    expect(h.prisma.workflowStep.create.mock.calls.map((c: any[]) => c[0].data.start_rule)).toContainEqual(trigger)
    expect(out.warnings).toContain('Step 2 “Review”: “Days after workflow is triggered” is only for the first step — pick another start.')
  })

  it('stores valid rules in canonical form; a relative due rule is mirrored into due_days / due_time', async () => {
    const h = defHarness()
    await h.service.createDefinition(
      ORG,
      def({
        mode: 'save',
        starts: { manual: { enabled: false }, schedules: [monthly] },
        steps: [
          dstep('n1', {
            title: 'Collect',
            start_rule: { kind: 'month_day', day: 'last', time: '09:00', stray: 'x' },
            due_rule: { kind: 'days_after_start', days: 3, time: '17:30' },
          }),
        ],
      }) as never,
      me(),
    )
    expect(h.prisma.workflowStep.create.mock.calls[0][0].data).toMatchObject({
      start_rule: { kind: 'month_day', day: 'last', time: '09:00' },
      due_rule: { kind: 'days_after_start', days: 3, time: '17:30' },
      due_days: 3,
      due_time: '17:30',
    })
    expect(h.prisma.workflowStep.create.mock.calls[0][0].data.start_rule).not.toHaveProperty('stray')
  })

  it('drafts skip timing validation and keep what was entered; warnings say what Save will need', async () => {
    const h = defHarness()
    const out: any = await h.service.createDefinition(
      ORG,
      def({ steps: [dstep('n1', { title: 'Collect', start_rule: { kind: 'weekday', weekday: 4, time: '09:00' } })] }) as never,
      me(),
    )
    expect(h.prisma.workflowStep.create.mock.calls[0][0].data.start_rule).toEqual(weekday)
    expect(out.warnings).toEqual([
      'Step 1 “Collect”: the workflow starts manually. Choose a “Days after” option.',
    ])
  })

  it('null resets a rule to the default (stored as SQL NULL); omitted keeps the stored rule', async () => {
    const h = defHarness([stepRow('a', { start_rule: { kind: 'days_after_previous', days: 2, time: '09:00' } })])
    await h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a' })] }) as never, me())
    expect(h.prisma.workflowStep.updateMany.mock.calls.at(-1)[0].data.start_rule).toEqual({
      kind: 'days_after_previous',
      days: 2,
      time: '09:00',
    })
    await h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', start_rule: null })] }) as never, me())
    expect(h.prisma.workflowStep.updateMany.mock.calls.at(-1)[0].data.start_rule).toBe(Prisma.DbNull)
  })

  it('an older client editing due_days / due_time keeps a stored relative due rule in step', async () => {
    const h = defHarness([stepRow('a', { due_rule: { kind: 'days_after_start', days: 1, time: '18:00' } })])
    await h.service.updateDefinition(ORG, TPL, def({ steps: [dstep('a', { id: 'a', due_days: 4 })] }) as never, me())
    expect(h.prisma.workflowStep.updateMany.mock.calls.at(-1)[0].data).toMatchObject({
      due_days: 4,
      due_time: '18:00',
      due_rule: { kind: 'days_after_start', days: 4, time: '18:00' },
    })
  })

  it('when the schedules change so a stored timing no longer fits, Save names that step', async () => {
    const h = defHarness(
      [stepRow('a', { title: 'Collect', start_rule: weekday })],
      template({ status: 'active' }, ['edit']),
    )
    const err: any = await h.service
      .updateDefinition(
        ORG,
        TPL,
        def({ starts: { manual: { enabled: false }, schedules: [monthly] }, steps: [dstep('a', { id: 'a', title: 'Collect' })] }) as never,
        me(),
      )
      .catch((e: unknown) => e)
    expect(err.message).toBe('Step 1 “Collect”: the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.')
    expect(err.getResponse()).toMatchObject({ step_id: 'a', step_key: 'a' })
  })

  it('the builder reads every step’s timing — legacy steps as the defaults they run with', async () => {
    const h = defHarness([
      stepRow('a', { due_days: 2, due_time: '17:00' }),
      stepRow('b', { order_index: 1, start_rule: weekday, due_rule: { kind: 'weekday', weekday: 5, time: '18:00' } }),
    ])
    const out: any = await h.service.getTemplate(ORG, TPL, me())
    expect(out.steps[0]).toMatchObject({
      start_rule: { kind: 'immediate' },
      due_rule: { kind: 'days_after_start', days: 2, time: '17:00' },
    })
    expect(out.steps[1]).toMatchObject({ start_rule: weekday, due_rule: { kind: 'weekday', weekday: 5, time: '18:00' } })
  })
})

describe('WorkflowTemplateService — example timeline (preview)', () => {
  // NOW = 2026-10-08T00:00Z = Thu 05:30 IST.
  const body = (over: Record<string, unknown> = {}) => ({
    starts: { manual: { enabled: true }, schedules: [] },
    steps: [] as unknown[],
    ...over,
  })

  it('manual only: one example run starting now, planned by the engine; nothing stored or read', async () => {
    const h = build()
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        steps: [
          dstep('k1', { title: 'Collect', due_rule: { kind: 'days_after_start', days: 2, time: '18:00' } }),
          dstep('k2', { title: 'Review', depends_on: ['k1'], start_rule: { kind: 'days_after_previous', days: 1, time: '10:00' } }),
        ],
      }) as never,
      me(),
    )
    expect(out.runs).toHaveLength(1)
    expect(out.runs[0].starts_at).toEqual(NOW)
    expect(out.runs[0].steps).toEqual([
      { key: 'k1', title: 'Collect', planned_start_at: NOW, planned_due_at: new Date('2026-10-10T12:30:00Z') },
      { key: 'k2', title: 'Review', planned_start_at: new Date('2026-10-11T04:30:00Z'), planned_due_at: new Date('2026-10-12T12:30:00Z') },
    ])
    expect(out.warnings).toEqual([])
    expect(h.engine.planTimelines).toHaveBeenCalledWith(ORG, 'Asia/Kolkata', expect.any(Array), [NOW], 1)
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
    expect(h.prisma.workflowTemplate.findFirst).not.toHaveBeenCalled()
    expect(h.prisma.workflowStep.findMany).not.toHaveBeenCalled()
  })

  it('scheduled: the next 3 occurrences of the schedules from the org clock', async () => {
    const h = build()
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: {
          manual: { enabled: false },
          schedules: [{ schedule_type: 'weekly', every: 1, days: [3], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }],
        },
        steps: [
          dstep('k1', {
            title: 'Collect',
            start_rule: { kind: 'weekday', weekday: 4, time: '09:00' },
            due_rule: { kind: 'weekday', weekday: 5, time: '18:00' },
          }),
        ],
      }) as never,
      me(),
    )
    expect(out.runs.map((r: any) => r.starts_at)).toEqual([
      new Date('2026-10-14T03:30:00Z'),
      new Date('2026-10-21T03:30:00Z'),
      new Date('2026-10-28T03:30:00Z'),
    ])
    expect(out.runs[0].steps[0]).toMatchObject({
      planned_start_at: new Date('2026-10-15T03:30:00Z'),
      planned_due_at: new Date('2026-10-16T12:30:00Z'),
    })
  })

  it('several schedules: merged, earliest first; schedules with nothing ahead fall back to a run from now', async () => {
    const h = build()
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: {
          manual: { enabled: false },
          schedules: [
            { schedule_type: 'weekly', every: 1, days: [1], time: '09:00', start_date: '2026-10-01', end_condition: 'never' },
            { schedule_type: 'weekly', every: 1, days: [5], time: '09:00', start_date: '2026-10-01', end_condition: 'never' },
          ],
        },
        steps: [dstep('k1')],
      }) as never,
      me(),
    )
    expect(out.runs.map((r: any) => r.starts_at)).toEqual([
      new Date('2026-10-09T03:30:00Z'),
      new Date('2026-10-12T03:30:00Z'),
      new Date('2026-10-16T03:30:00Z'),
    ])
    const ended: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: {
          manual: { enabled: true },
          schedules: [
            { schedule_type: 'daily', every: 1, time: '09:00', start_date: '2026-01-01', end_condition: 'on_date', end_date: '2026-02-01' },
          ],
        },
        steps: [dstep('k1')],
      }) as never,
      me(),
    )
    expect(ended.runs.map((r: any) => r.starts_at)).toEqual([NOW])
  })

  it('warns about a timing that doesn’t fit (planned with the defaults); a day before the previous step is no warning', async () => {
    const h = build()
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: {
          manual: { enabled: true },
          schedules: [{ schedule_type: 'monthly', every: 1, month_days: [1], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }],
        },
        steps: [
          dstep('k1', { title: 'Collect', due_rule: { kind: 'month_day', day: 10, time: '18:00' } }),
          dstep('k2', { title: 'Review', depends_on: ['k1'], start_rule: { kind: 'month_day', day: 5, time: '09:00' } }),
          dstep('k3', { title: 'File', depends_on: ['k2'], start_rule: { kind: 'weekday', weekday: 1, time: '09:00' } }),
        ],
      }) as never,
      me(),
    )
    expect(out.runs).toHaveLength(3)
    expect(out.warnings).toEqual([
      'Step 3 “File”: the workflow repeats monthly. Choose “Day of the month” or a “Days after” option.',
      'Runs will overlap: this run ends 7 Dec, the next starts 1 Dec.',
    ])
    // Review moves to the 5th of the month after Collect is due.
    expect(out.runs[0].steps[1].planned_start_at).toEqual(new Date('2026-12-05T03:30:00Z'))
  })

  it('warns when runs overlap: a run’s last planned date after the next run starts', async () => {
    const h = build()
    const monthly3 = { schedule_type: 'monthly', every: 1, month_days: [3], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: { manual: { enabled: false }, schedules: [monthly3] },
        steps: [
          dstep('k1', { title: 'Collect', due_rule: { kind: 'month_day', day: 20, time: '18:00' } }),
          // Due on the 5th after the 20th → the 5th of the next month, after the next run (3rd).
          dstep('k2', { title: 'Review', depends_on: ['k1'], due_rule: { kind: 'month_day', day: 5, time: '18:00' } }),
        ],
      }) as never,
      me(),
    )
    expect(out.runs[0].starts_at).toEqual(new Date('2026-11-03T03:30:00Z'))
    expect(out.warnings).toEqual(['Runs will overlap: this run ends 5 Dec, the next starts 3 Dec.'])

    const fits: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: { manual: { enabled: false }, schedules: [monthly3] },
        steps: [dstep('k1', { title: 'Collect', due_rule: { kind: 'month_day', day: 20, time: '18:00' } })],
      }) as never,
      me(),
    )
    expect(fits.warnings).toEqual([])
  })

  it('warns about a first step timed before the run starts (Save’s words)', async () => {
    const h = build()
    const out: any = await h.service.previewTimeline(
      ORG,
      body({
        starts: {
          manual: { enabled: false },
          schedules: [{ schedule_type: 'monthly', every: 1, month_days: [3], time: '09:00', start_date: '2026-10-01', end_condition: 'never' }],
        },
        steps: [dstep('k1', { title: 'Collect documents', start_rule: { kind: 'month_day', day: 1, time: '09:00' } })],
      }) as never,
      me(),
    )
    expect(out.warnings).toContain('Step 1 “Collect documents”: pick a day on or after the 3rd, when the run starts.')
  })
})

describe('overlapWarning', () => {
  const tz = 'Asia/Kolkata'
  const step = (start: string, due: string) => ({ planned_start_at: new Date(start), planned_due_at: new Date(due) })

  it('names the run’s last date and the next run’s start, in the org’s time zone', () => {
    expect(overlapWarning([step('2026-11-03T03:30:00Z', '2026-12-05T12:30:00Z')], new Date('2026-12-03T03:30:00Z'), tz)).toBe(
      'Runs will overlap: this run ends 5 Dec, the next starts 3 Dec.',
    )
    expect(overlapWarning([step('2026-12-03T03:30:00Z', '2027-01-05T12:30:00Z')], new Date('2027-01-03T03:30:00Z'), tz)).toBe(
      'Runs will overlap: this run ends 5 Jan, the next starts 3 Jan.',
    )
    // When the two dates fall in different years, the years are said.
    expect(overlapWarning([step('2026-12-30T03:30:00Z', '2027-01-05T12:30:00Z')], new Date('2026-12-31T03:30:00Z'), tz)).toBe(
      'Runs will overlap: this run ends 5 Jan 2027, the next starts 31 Dec 2026.',
    )
  })

  it('names a later example run ("the run on 3 Dec") — the first one is "this run"', () => {
    expect(
      overlapWarning([step('2026-12-03T03:30:00Z', '2027-01-04T12:30:00Z')], new Date('2027-01-03T03:30:00Z'), tz, new Date('2026-12-03T03:30:00Z')),
    ).toBe('Runs will overlap: the run on 3 Dec 2026 ends 4 Jan 2027, the next starts 3 Jan 2027.')
    expect(
      overlapWarning([step('2026-11-03T03:30:00Z', '2026-12-05T12:30:00Z')], new Date('2026-12-03T03:30:00Z'), tz, new Date('2026-11-03T03:30:00Z')),
    ).toBe('Runs will overlap: the run on 3 Nov ends 5 Dec, the next starts 3 Dec.')
  })

  it('no warning when the run ends by the time the next one starts (or has no steps)', () => {
    expect(overlapWarning([step('2026-11-03T03:30:00Z', '2026-11-20T12:30:00Z')], new Date('2026-12-03T03:30:00Z'), tz)).toBeNull()
    expect(overlapWarning([step('2026-11-03T03:30:00Z', '2026-12-03T03:30:00Z')], new Date('2026-12-03T03:30:00Z'), tz)).toBeNull()
    expect(overlapWarning([], new Date('2026-12-03T03:30:00Z'), tz)).toBeNull()
  })
})

describe('WorkflowTemplateService — waiting steps and Start now', () => {
  const waitingRows = () => {
    const a = row('r-a', 's-a', 'completed', [], 0, 't-a')
    const b = {
      ...row('r-b', 's-b', 'pending', ['s-a'], 1, null),
      start_at: new Date('2026-10-09T03:30:00Z'),
      planned_start_at: new Date('2026-10-09T03:30:00Z'),
      planned_due_at: new Date('2026-10-10T12:30:00Z'),
    }
    return [a, b]
  }

  it('run rows carry their plan and waiting state; editors may start a waiting step now; a waiting run is not stranded', async () => {
    const h = runHarness({ tpl: template({ status: 'active' }, ['edit']), rows: waitingRows() as never, tasks: [runTask('t-a', [{ user_id: U2, is_cc: false }])] })
    const out: any = await h.service.getInstance(ORG, TPL, RUN, me())
    const b = out.steps.find((s: any) => s.id === 'r-b')
    expect(b).toMatchObject({
      status: 'pending',
      waiting: true,
      start_at: new Date('2026-10-09T03:30:00Z'),
      planned_start_at: new Date('2026-10-09T03:30:00Z'),
      planned_due_at: new Date('2026-10-10T12:30:00Z'),
      start_rule: { kind: 'immediate' },
      due_rule: { kind: 'days_after_start', days: 2, time: '10:00' },
    })
    expect(out.capabilities.can_start_now_row_ids).toEqual(['r-b'])
    expect(out.capabilities.can_retry).toBe(false)
    expect(out.steps.find((s: any) => s.id === 'r-a').waiting).toBe(false)

    const viewer = runHarness({ rows: waitingRows() as never })
    const vout: any = await viewer.service.getInstance(ORG, TPL, RUN, me())
    expect(vout.capabilities.can_start_now_row_ids).toEqual([])
  })

  it('Start now: editors only; the row is looked up scoped to the run + org; the engine does the rest', async () => {
    const h = runHarness({ tpl: template({ status: 'active' }, ['edit']), rows: waitingRows() as never })
    h.prisma.workflowInstanceStep.findFirst.mockResolvedValue({ id: 'r-b' })
    await h.service.startStepNow(ORG, TPL, RUN, 'r-b', me())
    expect(h.prisma.workflowInstanceStep.findFirst.mock.calls[0][0].where).toEqual({
      id: 'r-b',
      workflow_instance_id: RUN,
      organization_id: ORG,
    })
    expect(h.engine.startStepNow).toHaveBeenCalledWith(ORG, RUN, 'r-b', 'u-me')

    const missing = runHarness({ tpl: template({ status: 'active' }, ['edit']) })
    missing.prisma.workflowInstanceStep.findFirst.mockResolvedValue(null)
    await expect(missing.service.startStepNow(ORG, TPL, RUN, 'r-x', me())).rejects.toBeInstanceOf(NotFoundException)

    const viewer = runHarness({ rows: waitingRows() as never })
    await expect(viewer.service.startStepNow(ORG, TPL, RUN, 'r-b', me())).rejects.toBeInstanceOf(ForbiddenException)
    expect(viewer.engine.startStepNow).not.toHaveBeenCalled()
  })
})
