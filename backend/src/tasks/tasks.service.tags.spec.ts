import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Principal } from '../access-rights/permissions.service';

/**
 * Task tags on the canonical tasks service (TASK_TAGS_PLAN.md §4.3 / §4.7 / §10):
 * create, update (add / remove / clear / omitted), the inactive-tag keep rule, the
 * cross-org guard, the list filter + search shape, bulk add/remove with the per-task
 * edit gate, the activity diff and the flattened read shape.
 */

const ORG = 'org-1';
const ME = 'u-1';
const me: Principal = { userId: ME, systemRoleId: 'role-1', isAdmin: false, isSuperAdmin: false };

type TagRow = { id: string; name: string; color: string; is_active: boolean; organization_id?: string };
const TAGS: Record<string, TagRow> = {
  audit: { id: 'tag-audit', name: 'Audit', color: 'ochre', is_active: true, organization_id: ORG },
  q4: { id: 'tag-q4', name: 'Q4', color: 'teal', is_active: true, organization_id: ORG },
  client: { id: 'tag-client', name: 'client-ABC', color: 'indigo', is_active: true, organization_id: ORG },
  old: { id: 'tag-old', name: 'Legacy', color: 'slate', is_active: false, organization_id: ORG },
  foreign: { id: 'tag-foreign', name: 'Theirs', color: 'rose', is_active: true, organization_id: 'org-2' },
};
const link = (t: TagRow) => ({ tag: { id: t.id, name: t.name, color: t.color, is_active: t.is_active } });

function makePrisma() {
  const prisma: any = {
    taskTag: {
      // Behaves like the real org-scoped query: only rows of the asked org + ids.
      findMany: jest.fn(async ({ where }: any) =>
        Object.values(TAGS)
          .filter((t) => t.organization_id === where.organization_id && where.id.in.includes(t.id))
          .map(({ organization_id: _o, ...rest }) => rest),
      ),
      count: jest.fn(async ({ where }: any) =>
        Object.values(TAGS).filter((t) => t.organization_id === where.organization_id && where.id.in.includes(t.id))
          .length,
      ),
    },
    taskTagLink: {
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    task: {
      create: jest.fn(async ({ data }: any) => ({ id: 'task-new', deadline: null, ...data })),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }: any) => ({ id: 'task-1', status: { type: 'not_started' }, ...data })),
      delete: jest.fn(),
    },
    taskStatus: { findFirst: jest.fn(async () => ({ id: 'st-open', type: 'not_started' })) },
    taskAssignee: { createMany: jest.fn(async () => ({ count: 1 })) },
    taskAssigneeFrequency: { upsert: jest.fn(async () => ({})) },
    taskActivityLog: { create: jest.fn(async () => ({})) },
    taskMaster: {
      upsert: jest.fn(async () => ({
        task_creation_roles: ['employee'],
        task_edit_roles: [],
        default_reminder_days_before: 1,
      })),
    },
    organizationMember: {
      findUnique: jest.fn(async () => ({ is_admin: false })),
      findMany: jest.fn(async ({ where }: any) => where.user_id.in.map((user_id: string) => ({ user_id }))),
    },
    user: { findMany: jest.fn(async () => [{ id: ME, name: 'Asha', email: 'a@x.test' }]) },
    employeeProfile: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma)));
  return prisma;
}

function makeService(prisma: any, overrides: { scope?: any } = {}) {
  const scope = overrides.scope ?? {
    registerWiredList: jest.fn(),
    listWhere: jest.fn(async () => ({})),
    assertCanActOn: jest.fn(async () => {
      throw new ForbiddenException('out of scope');
    }),
  };
  const service = new TasksService(
    prisma,
    {} as any, // workflowEngine
    { adjustDeadline: jest.fn() } as any, // holidays
    {} as any, // projectProgress
    { userName: jest.fn(async () => 'Asha'), emit: jest.fn(async () => undefined) } as any,
    { resolve: jest.fn(async () => ({ pool: new Set(['u-1', 'u-2', 'u-3']) })) } as any,
    { assertAllEligible: jest.fn(async () => undefined) } as any,
    scope,
    {} as any, // leave
    { now: jest.fn(async () => new Date('2026-10-04T10:00:00Z')) } as any,
    { isAccessible: jest.fn(async () => true) } as any,
    { registerCounter: jest.fn(), whereForUser: jest.fn() } as any,
    { timingWhere: jest.fn(() => ({})) } as any,
    {} as any, // r2
  );
  return { service, scope };
}

/** A task as `findTaskOrFail` loads it (TASK_INCLUDE → tags as join rows). */
const loadedTask = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organization_id: ORG,
  created_by_user_id: ME,
  created_at: new Date('2026-10-01T00:00:00Z'),
  title: 'File returns',
  description: null,
  category_id: null,
  priority_id: null,
  department_id: null,
  quadrant: 'Q2',
  type: 'one_time',
  completion_mode: 'any_can_complete',
  proof_required: false,
  proof_allowed_extensions: [],
  goal_id: null,
  deadline: null,
  status_id: 'st-open',
  status: { type: 'not_started' },
  assignees: [{ user_id: 'u-2', is_cc: false }],
  tags: [link(TAGS.audit), link(TAGS.old)],
  ...over,
});

function lastActivityChanges(prisma: any) {
  const calls = prisma.taskActivityLog.create.mock.calls;
  return calls.length ? calls[calls.length - 1][0].data.metadata.changes : undefined;
}

// ─── createTask ──────────────────────────────────────────────────────────────────

describe('TasksService tags — createTask', () => {
  it('validates tag_ids and creates the links with org + actor', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    jest.spyOn(service, 'getTask').mockResolvedValue({ id: 'task-new' } as any);

    await service.createTask(ORG, ME, {
      title: 'File returns',
      assignee_user_ids: ['u-2'],
      tag_ids: ['tag-audit', 'tag-q4', 'tag-audit'],
    } as any);

    expect(prisma.taskTagLink.createMany).toHaveBeenCalledWith({
      data: [
        { organization_id: ORG, task_id: 'task-new', tag_id: 'tag-audit', created_by_user_id: ME },
        { organization_id: ORG, task_id: 'task-new', tag_id: 'tag-q4', created_by_user_id: ME },
      ],
      skipDuplicates: true,
    });
  });

  it('rejects a tag id from another org with 400, before any write', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(
      service.createTask(ORG, ME, { title: 't', assignee_user_ids: ['u-2'], tag_ids: ['tag-foreign'] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });

  it('rejects a deactivated tag on a new task', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(
      service.createTask(ORG, ME, { title: 't', assignee_user_ids: ['u-2'], tag_ids: ['tag-old'] } as any),
    ).rejects.toThrow(/deactivated/);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('creates no links when tag_ids is omitted', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    jest.spyOn(service, 'getTask').mockResolvedValue({ id: 'task-new' } as any);
    await service.createTask(ORG, ME, { title: 't', assignee_user_ids: ['u-2'] } as any);
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────────

describe('TasksService tags — updateTask', () => {
  let prisma: any;
  let service: TasksService;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.task.findFirst.mockResolvedValue(loadedTask());
    ({ service } = makeService(prisma));
    jest.spyOn(service, 'getTask').mockResolvedValue({ id: 'task-1' } as any);
  });

  it('omitted tag_ids leaves the tags untouched', async () => {
    await service.updateTask(ORG, ME, 'task-1', { title: 'Renamed' } as any);
    expect(prisma.taskTag.findMany).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.deleteMany).not.toHaveBeenCalled();
    expect(lastActivityChanges(prisma).some((c: any) => c.field === 'tags')).toBe(false);
  });

  it('adds and removes by diff, scoped by task AND org, and logs the name diff', async () => {
    // current: Audit, Legacy(inactive) → wanted: Legacy (kept although inactive), Q4
    await service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-old', 'tag-q4'] } as any);

    expect(prisma.taskTagLink.deleteMany).toHaveBeenCalledWith({
      where: { task_id: 'task-1', organization_id: ORG, tag_id: { in: ['tag-audit'] } },
    });
    expect(prisma.taskTagLink.createMany).toHaveBeenCalledWith({
      data: [{ organization_id: ORG, task_id: 'task-1', tag_id: 'tag-q4', created_by_user_id: ME }],
      skipDuplicates: true,
    });
    const tagsEntry = lastActivityChanges(prisma).find((c: any) => c.field === 'tags');
    expect(tagsEntry).toEqual({ field: 'tags', from: ['Audit', 'Legacy'], to: ['Legacy', 'Q4'] });
    expect(prisma.taskActivityLog.create.mock.calls.at(-1)[0].data.action).toBe('edited');
  });

  it('[] clears every tag', async () => {
    await service.updateTask(ORG, ME, 'task-1', { tag_ids: [] } as any);
    expect(prisma.taskTagLink.deleteMany).toHaveBeenCalledWith({
      where: { task_id: 'task-1', organization_id: ORG, tag_id: { in: ['tag-audit', 'tag-old'] } },
    });
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
    expect(lastActivityChanges(prisma)).toEqual([{ field: 'tags', from: ['Audit', 'Legacy'], to: [] }]);
  });

  it('the same set in another order is not a change (no writes, no activity)', async () => {
    await service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-old', 'tag-audit'] } as any);
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.deleteMany).not.toHaveBeenCalled();
    expect(prisma.taskActivityLog.create).not.toHaveBeenCalled();
  });

  it('keeps an inactive tag already on the task, but rejects newly adding one', async () => {
    // Kept: tag-old is already on the task → allowed.
    await expect(service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-old'] } as any)).resolves.toBeDefined();

    // Newly added: a task that does NOT carry tag-old cannot gain it.
    prisma.task.findFirst.mockResolvedValue(loadedTask({ tags: [link(TAGS.audit)] }));
    prisma.taskTagLink.createMany.mockClear();
    await expect(
      service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-audit', 'tag-old'] } as any),
    ).rejects.toThrow(/deactivated/);
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });

  it('a foreign-org tag id is a 400 and nothing is written', async () => {
    await expect(
      service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-audit', 'tag-foreign'] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.deleteMany).not.toHaveBeenCalled();
  });

  it('tags sit behind the assigner gate like category: a plain assignee cannot retag', async () => {
    // Created by someone else; the actor is only a working assignee, not admin, and
    // the org's task-edit-roles do not include employees.
    prisma.task.findFirst.mockResolvedValue(
      loadedTask({ created_by_user_id: 'u-3', assignees: [{ user_id: ME, is_cc: false }] }),
    );
    await expect(service.updateTask(ORG, ME, 'task-1', { tag_ids: ['tag-q4'] } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });
});

// ─── list filter + search ──────────────────────────────────────────────────────────

describe('TasksService tags — buildTaskWhere', () => {
  const { service } = makeService(makePrisma());
  const build = (filters: any, scopeWhere: any = { created_by_user_id: ME }) =>
    (service as any).buildTaskWhere(ORG, scopeWhere, filters, 'created_at');

  it('ANDs the tag filter with scope, search OR and the assignee filter without clobbering them', () => {
    const where = build({ tag_ids: 'tag-audit, tag-q4,,tag-audit', search: 'vat', assignee_user_id: 'u-2' });

    expect(where.organization_id).toBe(ORG);
    expect(where.AND).toEqual([
      { created_by_user_id: ME },
      { tags: { some: { tag_id: { in: ['tag-audit', 'tag-q4'] } } } },
    ]);
    expect(where.assignees).toEqual({ some: { user_id: 'u-2', is_cc: false } });
    expect(where.OR).toEqual([
      { title: { contains: 'vat', mode: 'insensitive' } },
      { description: { contains: 'vat', mode: 'insensitive' } },
      { tags: { some: { tag: { name: { contains: 'vat', mode: 'insensitive' } } } } },
    ]);
  });

  it('creates AND when there is no scope fragment', () => {
    const where = build({ tag_ids: 'tag-q4', assignee_user_ids: 'u-2,u-3' }, {});
    expect(where.AND).toEqual([{ tags: { some: { tag_id: { in: ['tag-q4'] } } } }]);
    expect(where.assignees).toEqual({ some: { user_id: { in: ['u-2', 'u-3'] }, is_cc: false } });
  });

  it('ignores an empty / blank tag filter and caps the id list', () => {
    expect(build({ tag_ids: ' , ' }, {}).AND).toBeUndefined();
    const many = Array.from({ length: 80 }, (_, i) => `t${i}`).join(',');
    expect(build({ tag_ids: many }, {}).AND[0].tags.some.tag_id.in).toHaveLength(50);
  });
});

// ─── read shape ──────────────────────────────────────────────────────────────────────

describe('TasksService tags — read shape', () => {
  it('list responses carry flat tags, never the join row', async () => {
    const prisma = makePrisma();
    prisma.task.findMany.mockResolvedValue([loadedTask()]);
    const { service } = makeService(prisma);

    const [row] = (await service.listTasks(ORG, me, {})) as any[];
    expect(row.tags).toEqual([
      { id: 'tag-audit', name: 'Audit', color: 'ochre', is_active: true },
      { id: 'tag-old', name: 'Legacy', color: 'slate', is_active: false },
    ]);
    expect(prisma.task.findMany.mock.calls[0][0].include.tags).toEqual({
      select: { tag: { select: { id: true, name: true, color: true, is_active: true } } },
      orderBy: { tag: { name_key: 'asc' } },
    });
  });

  it('CSV export has a Tags column joined with " | "', async () => {
    const prisma = makePrisma();
    prisma.task.findMany.mockResolvedValue([loadedTask({ created_at: new Date('2026-10-01T00:00:00Z') })]);
    const { service } = makeService(prisma, {
      scope: {
        registerWiredList: jest.fn(),
        resolveListScope: jest.fn(async () => ({ effective: 'org', max: 'org' })),
        whereForScope: jest.fn(async () => ({})),
      },
    });
    const { csv } = await service.exportCsv(ORG, me, {});
    const [header, line] = csv.split('\n');
    expect(header.split(',')).toContain('Tags');
    const col = header.split(',').indexOf('Tags');
    expect(line.split('","')[col].replace(/"/g, '')).toBe('Audit | Legacy');
  });
});

// ─── bulk ────────────────────────────────────────────────────────────────────────────

describe('TasksService tags — bulkUpdate', () => {
  const mine = { ...loadedTask({ id: 'task-mine', title: 'Mine', tags: [link(TAGS.audit)] }) };
  // Someone else's task where the actor is merely a working assignee: may move its
  // status, but not change its fields — so it is skipped for tag actions.
  const theirs = {
    ...loadedTask({
      id: 'task-theirs',
      title: 'Theirs',
      created_by_user_id: 'u-3',
      assignees: [{ user_id: ME, is_cc: false }],
      tags: [],
    }),
  };

  it('add_tags: adds only missing links, skips non-editable tasks with a reason, logs one diff per changed task', async () => {
    const prisma = makePrisma();
    prisma.task.findMany.mockResolvedValue([mine, theirs]);
    const { service } = makeService(prisma);

    const res = await service.bulkUpdate(ORG, me, ['task-mine', 'task-theirs'], 'add_tags', {
      tag_ids: ['tag-audit', 'tag-q4'],
    });

    expect(res).toEqual({
      updated: 1,
      skipped: [{ id: 'task-theirs', title: 'Theirs', reason: 'You do not have edit access to this task.' }],
    });
    expect(prisma.taskTagLink.createMany).toHaveBeenCalledWith({
      data: [{ organization_id: ORG, task_id: 'task-mine', tag_id: 'tag-q4', created_by_user_id: ME }],
      skipDuplicates: true,
    });
    expect(prisma.taskActivityLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.taskActivityLog.create.mock.calls[0][0].data).toMatchObject({
      task_id: 'task-mine',
      action: 'edited',
      metadata: { bulk: true, changes: [{ field: 'tags', from: ['Audit'], to: ['Audit', 'Q4'] }] },
    });
  });

  it('add_tags: an editor with edit scope (not on the task) may tag it', async () => {
    const prisma = makePrisma();
    prisma.task.findMany.mockResolvedValue([theirs]);
    prisma.taskMaster.upsert.mockResolvedValue({ task_edit_roles: ['employee'] });
    const scope = {
      registerWiredList: jest.fn(),
      listWhere: jest.fn(async () => ({})),
      assertCanActOn: jest.fn(async () => undefined),
    };
    const { service } = makeService(prisma, { scope });
    const res = await service.bulkUpdate(ORG, me, ['task-theirs'], 'add_tags', { tag_ids: ['tag-q4'] });
    expect(res).toEqual({ updated: 1, skipped: [] });
    expect(scope.assertCanActOn).toHaveBeenCalledWith(ORG, me, 'tasks.task.manage', 'edit', ['u-3', ME]);
  });

  it('add_tags: rejects an inactive or foreign tag before touching any task', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(
      service.bulkUpdate(ORG, me, ['task-mine'], 'add_tags', { tag_ids: ['tag-old'] }),
    ).rejects.toThrow(/deactivated/);
    await expect(
      service.bulkUpdate(ORG, me, ['task-mine'], 'add_tags', { tag_ids: ['tag-foreign'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.bulkUpdate(ORG, me, ['task-mine'], 'add_tags', { tag_ids: [] })).rejects.toThrow(
      /at least one tag/,
    );
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('add_tags: a task that would pass the 10-tag limit is skipped', async () => {
    const prisma = makePrisma();
    const full = loadedTask({
      id: 'task-full',
      title: 'Full',
      tags: Array.from({ length: 10 }, (_, i) => link({ id: `t${i}`, name: `T${i}`, color: 'slate', is_active: true })),
    });
    prisma.task.findMany.mockResolvedValue([full]);
    const { service } = makeService(prisma);
    const res = await service.bulkUpdate(ORG, me, ['task-full'], 'add_tags', { tag_ids: ['tag-q4'] });
    expect(res.updated).toBe(0);
    expect(res.skipped[0]).toMatchObject({ id: 'task-full', reason: expect.stringMatching(/at most 10 tags/) });
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });

  it('remove_tags: deletes by task + tag + org, may remove a deactivated tag, skips non-editable tasks', async () => {
    const prisma = makePrisma();
    const withOld = loadedTask({ id: 'task-mine', title: 'Mine', tags: [link(TAGS.audit), link(TAGS.old)] });
    const untouched = loadedTask({ id: 'task-plain', title: 'Plain', tags: [link(TAGS.q4)] });
    prisma.task.findMany.mockResolvedValue([withOld, untouched, { ...theirs, tags: [link(TAGS.old)] }]);
    const { service } = makeService(prisma);

    const res = await service.bulkUpdate(ORG, me, ['task-mine', 'task-plain', 'task-theirs'], 'remove_tags', {
      tag_ids: ['tag-old'],
    });

    expect(res).toEqual({
      updated: 1,
      skipped: [{ id: 'task-theirs', title: 'Theirs', reason: 'You do not have edit access to this task.' }],
    });
    expect(prisma.taskTagLink.deleteMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, task_id: { in: ['task-mine'] }, tag_id: { in: ['tag-old'] } },
    });
    expect(prisma.taskActivityLog.create.mock.calls[0][0].data.metadata).toEqual({
      bulk: true,
      changes: [{ field: 'tags', from: ['Audit', 'Legacy'], to: ['Audit'] }],
    });
  });

  // The org clock in makeService is 2026-10-04T10:00Z; this task was created after it.
  const future = loadedTask({ id: 'task-future', title: 'Future', created_at: new Date('2026-10-10T00:00:00Z'), tags: [link(TAGS.audit)] });
  const FUTURE_REASON =
    'This task was created in a simulated future. To interact with it, please time-travel to this date or later.';

  it.each(['add_tags', 'remove_tags'] as const)(
    '%s: skips a task created in the simulated future with updateTask’s reason',
    async (action) => {
      const prisma = makePrisma();
      prisma.task.findMany.mockResolvedValue([future, mine]);
      const { service } = makeService(prisma);

      const res = await service.bulkUpdate(ORG, me, ['task-future', 'task-mine'], action, {
        tag_ids: action === 'add_tags' ? ['tag-q4'] : ['tag-audit'],
      });

      expect(res.skipped).toEqual([{ id: 'task-future', title: 'Future', reason: FUTURE_REASON }]);
      expect(res.updated).toBe(1);
      const write = action === 'add_tags' ? prisma.taskTagLink.createMany : prisma.taskTagLink.deleteMany;
      expect(JSON.stringify(write.mock.calls)).not.toContain('task-future');
    },
  );

  it('the simulated-future skip is tag-only: a bulk status change is unaffected', async () => {
    const prisma = makePrisma();
    prisma.task.findMany.mockResolvedValue([future]);
    prisma.task.updateMany = jest.fn(async () => ({ count: 1 }));
    const { service } = makeService(prisma);
    const res = await service.bulkUpdate(ORG, me, ['task-future'], 'status', { status_id: 'st-open' });
    expect(res).toEqual({ updated: 1, skipped: [] });
  });

  it('remove_tags: more than 50 ids is a clear 400', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(
      service.bulkUpdate(ORG, me, ['task-mine'], 'remove_tags', { tag_ids: Array.from({ length: 51 }, (_, i) => `t${i}`) }),
    ).rejects.toThrow('Pick at most 50 tags.');
  });

  it('remove_tags: a foreign-org tag id is a 400', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(
      service.bulkUpdate(ORG, me, ['task-mine'], 'remove_tags', { tag_ids: ['tag-foreign'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.taskTagLink.deleteMany).not.toHaveBeenCalled();
  });
});
