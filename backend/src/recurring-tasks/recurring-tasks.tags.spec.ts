import { BadRequestException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { RecurringTasksService } from './recurring-tasks.service';
import { RecurringTasksController } from './recurring-tasks.controller';
import { TasksController } from '../tasks/tasks.controller';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { Principal } from '../access-rights/permissions.service';

/**
 * Task tags on recurring templates (TASK_TAGS_PLAN.md §4.4, §10.1): validation on
 * create/update (own-org, active unless already kept), de-duplicated storage, the
 * any-of list filter, `tag_ids` + resolved `tags` on every template response, and
 * flat `tags` on spawned instances.
 */

const ORG = 'org-1';
const creator: Principal = { userId: 'u-1', systemRoleId: 'role-1', isAdmin: false, isSuperAdmin: false };

type TagRow = { id: string; organization_id: string; name: string; color: string; is_active: boolean };
const TAGS: TagRow[] = [
  { id: 'tag-audit', organization_id: ORG, name: 'Audit', color: 'ochre', is_active: true },
  { id: 'tag-q4', organization_id: ORG, name: 'Q4', color: 'teal', is_active: true },
  { id: 'tag-old', organization_id: ORG, name: 'legacy', color: 'slate', is_active: false },
  { id: 'tag-foreign', organization_id: 'org-2', name: 'Theirs', color: 'rose', is_active: true },
];

/** taskTag.findMany honouring the `id in`, `organization_id` and `is_active` filters. */
function tagFindMany({ where, select }: any) {
  return Promise.resolve(
    TAGS.filter(
      (t) =>
        (!where?.id?.in || where.id.in.includes(t.id)) &&
        (!where?.organization_id || t.organization_id === where.organization_id) &&
        (where?.is_active === undefined || t.is_active === where.is_active),
    ).map((t) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, (t as any)[k]])) : t)),
  );
}

const templateRow = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-1',
  organization_id: ORG,
  created_by_user_id: 'u-1',
  title: 'Monthly close',
  description: null,
  is_active: true,
  assignee_user_ids: [],
  cc_user_ids: [],
  department_id: null,
  tag_ids: [],
  schedule_entries: [],
  ...over,
});

function makePrisma() {
  const prisma: any = {
    taskTag: { findMany: jest.fn(tagFindMany) },
    recurringTemplate: {
      create: jest.fn(async ({ data }: any) => templateRow({ ...data })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    recurringScheduleEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    recurringTemplateAccess: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Asha' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'u-1', name: 'Asha' }]),
    },
    department: { findMany: jest.fn().mockResolvedValue([]) },
    organizationMember: { findMany: jest.fn().mockResolvedValue([]) },
    employeeProfile: { findMany: jest.fn().mockResolvedValue([]) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

function makeService(prisma: any) {
  const scope = {
    resolveListScope: jest.fn().mockResolvedValue({ max: DataScope.org, effective: DataScope.org }),
    visibleUserIds: jest.fn().mockResolvedValue('ALL'),
    assertCanActOn: jest.fn(),
  };
  const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
  const assigneeVisibility = { resolve: jest.fn().mockResolvedValue({ pool: new Set<string>() }) };
  const subjects = { assertAllEligible: jest.fn().mockResolvedValue(undefined) };
  return new RecurringTasksService(prisma, scope as any, notifications as any, assigneeVisibility as any, subjects as any);
}

const createDto = (over: Partial<CreateRecurringDto> = {}): CreateRecurringDto =>
  ({
    title: 'Monthly close',
    schedule_entries: [{ schedule_type: 'daily', time: '09:00', start_date: '2026-10-01' }],
    ...over,
  }) as CreateRecurringDto;

describe('RecurringTasksService — task tags', () => {
  let prisma: any;
  let service: RecurringTasksService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
    prisma.recurringTemplate.findUnique.mockImplementation(async () =>
      templateRow({ tag_ids: prisma.recurringTemplate.create.mock.calls.at(-1)?.[0].data.tag_ids ?? [] }),
    );
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('stores de-duplicated tag ids and returns tag_ids + tags sorted by name', async () => {
      const res = await service.createTemplate(ORG, 'u-1', createDto({ tag_ids: ['tag-q4', 'tag-audit', 'tag-q4'] }));

      expect(prisma.recurringTemplate.create.mock.calls[0][0].data.tag_ids).toEqual(['tag-q4', 'tag-audit']);
      expect(res!.tag_ids).toEqual(['tag-q4', 'tag-audit']);
      expect(res!.tags).toEqual([
        { id: 'tag-audit', name: 'Audit', color: 'ochre', is_active: true },
        { id: 'tag-q4', name: 'Q4', color: 'teal', is_active: true },
      ]);
    });

    it('stores [] when tag_ids is omitted, and the response still carries empty tags', async () => {
      const res = await service.createTemplate(ORG, 'u-1', createDto());
      expect(prisma.recurringTemplate.create.mock.calls[0][0].data.tag_ids).toEqual([]);
      expect(res!.tag_ids).toEqual([]);
      expect(res!.tags).toEqual([]);
    });

    it('rejects a deactivated tag before writing anything', async () => {
      await expect(service.createTemplate(ORG, 'u-1', createDto({ tag_ids: ['tag-old'] }))).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.recurringTemplate.create).not.toHaveBeenCalled();
    });

    it('rejects a tag from another org (never a stored cross-tenant reference)', async () => {
      await expect(service.createTemplate(ORG, 'u-1', createDto({ tag_ids: ['tag-foreign'] }))).rejects.toThrow(
        'Tag not found in this organization.',
      );
      expect(prisma.recurringTemplate.create).not.toHaveBeenCalled();
    });

    it('rejects more than 10 distinct tags', async () => {
      const ids = Array.from({ length: 11 }, (_, i) => `t-${i}`);
      await expect(service.createTemplate(ORG, 'u-1', createDto({ tag_ids: ids }))).rejects.toThrow(/at most 10 tags/);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('updateTemplate', () => {
    beforeEach(() => {
      prisma.recurringTemplate.update.mockImplementation(async ({ data }: any) => templateRow({ tag_ids: ['tag-old'], ...data }));
    });

    it('keeps a since-deactivated tag already on the template and adds a new active one', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow({ tag_ids: ['tag-old'] }));

      const res = await service.updateTemplate(ORG, 'tpl-1', { tag_ids: ['tag-old', 'tag-audit'] } as any, 'u-1');

      expect(prisma.recurringTemplate.update.mock.calls[0][0].data.tag_ids).toEqual(['tag-old', 'tag-audit']);
      expect(res.tags.map((t: any) => [t.name, t.is_active])).toEqual([
        ['Audit', true],
        ['legacy', false],
      ]);
    });

    it('refuses to newly add a deactivated tag', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow({ tag_ids: [] }));
      await expect(service.updateTemplate(ORG, 'tpl-1', { tag_ids: ['tag-old'] } as any, 'u-1')).rejects.toThrow(
        /deactivated/,
      );
      expect(prisma.recurringTemplate.update).not.toHaveBeenCalled();
    });

    it('leaves tags unchanged when tag_ids is omitted, and [] clears them', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow({ tag_ids: ['tag-audit'] }));

      await service.updateTemplate(ORG, 'tpl-1', { title: 'Renamed' } as any, 'u-1');
      expect(prisma.recurringTemplate.update.mock.calls[0][0].data).not.toHaveProperty('tag_ids');

      await service.updateTemplate(ORG, 'tpl-1', { tag_ids: [] } as any, 'u-1');
      expect(prisma.recurringTemplate.update.mock.calls[1][0].data.tag_ids).toEqual([]);
    });

    it('never rewrites already-spawned instances (future spawns only)', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow({ tag_ids: [] }));
      prisma.taskTagLink = { createMany: jest.fn(), deleteMany: jest.fn() };
      await service.updateTemplate(ORG, 'tpl-1', { tag_ids: ['tag-audit'], apply_to: 'future_and_open' } as any, 'u-1');
      expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
      expect(prisma.taskTagLink.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('listTemplates', () => {
    it('pushes the any-of tag filter into the query as hasSome', async () => {
      await service.listTemplates(ORG, creator, { tag_ids: ['tag-audit', 'tag-q4'] });
      expect(prisma.recurringTemplate.findMany.mock.calls[0][0].where).toMatchObject({
        organization_id: ORG,
        tag_ids: { hasSome: ['tag-audit', 'tag-q4'] },
      });
    });

    it('adds no tag condition when no tag filter is given', async () => {
      await service.listTemplates(ORG, creator, {});
      expect(prisma.recurringTemplate.findMany.mock.calls[0][0].where).not.toHaveProperty('tag_ids');
    });

    it('resolves every row’s tags with ONE tag query, dropping unknown ids', async () => {
      prisma.recurringTemplate.findMany.mockResolvedValue([
        templateRow({ id: 'tpl-1', tag_ids: ['tag-q4', 'tag-audit'] }),
        templateRow({ id: 'tpl-2', tag_ids: ['tag-old', 'tag-gone'] }),
        templateRow({ id: 'tpl-3', tag_ids: [] }),
      ]);

      const { items } = await service.listTemplates(ORG, creator, {});

      expect(prisma.taskTag.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.taskTag.findMany.mock.calls[0][0].where.organization_id).toBe(ORG);
      expect(items.map((t: any) => t.tags.map((x: any) => x.name))).toEqual([['Audit', 'Q4'], ['legacy'], []]);
      expect(items[1].tag_ids).toEqual(['tag-old', 'tag-gone']);
    });
  });

  // ─── instances ─────────────────────────────────────────────────────────────

  describe('getInstances', () => {
    it('loads each instance’s tags and returns them flat (no join rows)', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow());
      prisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          assignees: [],
          tags: [{ tag: { id: 'tag-audit', name: 'Audit', color: 'ochre', is_active: true } }],
        },
      ]);

      const rows: any[] = await service.getInstances(ORG, 'tpl-1');

      const args = prisma.task.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ organization_id: ORG, recurring_template_id: 'tpl-1' });
      expect(args.include.tags).toBeDefined();
      expect(rows[0].tags).toEqual([{ id: 'tag-audit', name: 'Audit', color: 'ochre', is_active: true }]);
    });

    it('flattens tags on the enriched (with assignees) path too', async () => {
      prisma.recurringTemplate.findFirst.mockResolvedValue(templateRow());
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', assignees: [{ user_id: 'u-1' }], tags: [] },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'u-1', name: 'Asha', email: 'a@x' }]);

      const rows: any[] = await service.getInstances(ORG, 'tpl-1');
      expect(rows[0].tags).toEqual([]);
      expect(rows[0].assignees[0].user.name).toBe('Asha');
    });
  });
});

// ─── GET recurring ?tag_ids= parsing (both handlers that serve the route) ─────

describe('GET recurring — tag_ids query', () => {
  const req = { user: { id: 'u-1', system_role_id: 'role-1', is_admin: false } };
  const clock = { now: jest.fn().mockResolvedValue(new Date('2026-10-04T10:00:00Z')) };
  const makeRecurring = () => ({ listTemplates: jest.fn().mockResolvedValue({ items: [] }) });

  // (orgId, req, scope, relation, status, category, priority, department, search, tag_ids)
  const list = (ctrl: any, tagIds: unknown) =>
    (ctrl instanceof TasksController ? ctrl.listRecurring : ctrl.list).call(
      ctrl, ORG, req, undefined, undefined, undefined, undefined, undefined, undefined, undefined, tagIds,
    );

  const controllers = () => {
    const recurring = makeRecurring();
    return [
      { recurring, ctrl: new RecurringTasksController(recurring as any, {} as any, {} as any, clock as any) },
      (() => {
        const r = makeRecurring();
        return { recurring: r, ctrl: new TasksController({} as any, {} as any, {} as any, r as any, clock as any) };
      })(),
    ];
  };

  it.each([
    ['CSV', 'tag-a, tag-b', ['tag-a', 'tag-b']],
    ['repeated param (array)', ['tag-a', 'tag-b'], ['tag-a', 'tag-b']],
    ['mixed + duplicates', ['tag-a,tag-b', 'tag-a'], ['tag-a', 'tag-b']],
  ])('%s is accepted by both handlers without throwing', async (_label, raw, expected) => {
    for (const { ctrl, recurring } of controllers()) {
      await list(ctrl, raw);
      expect(recurring.listTemplates.mock.calls[0][2].tag_ids).toEqual(expected);
    }
  });

  it('no / blank tag_ids passes undefined (no filter)', async () => {
    for (const { ctrl, recurring } of controllers()) {
      await list(ctrl, undefined);
      await list(ctrl, ['', ' ']);
      expect(recurring.listTemplates.mock.calls[0][2].tag_ids).toBeUndefined();
      expect(recurring.listTemplates.mock.calls[1][2].tag_ids).toBeUndefined();
    }
  });
});
