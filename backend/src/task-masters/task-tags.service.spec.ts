import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { PermissionAction, Prisma } from '@prisma/client';
import { TaskTagsService } from './task-tags.service';
import { assertTagsUsable, flattenTags, tagRefsFor } from '../common/task-masters-usable';
import { Principal } from '../access-rights/permissions.service';

const ORG = 'org-1';
const member: Principal = { userId: 'u-1', systemRoleId: 'role-1', isAdmin: false, isSuperAdmin: false };
const admin: Principal = { userId: 'u-admin', systemRoleId: null, isAdmin: true, isSuperAdmin: false };

const tagRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'tag-1',
  organization_id: ORG,
  name: 'Audit',
  name_key: 'audit',
  color: 'slate',
  description: null,
  is_active: true,
  created_by_user_id: 'u-1',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

function makePrisma() {
  const prisma: any = {
    taskTag: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => tagRow({ id: 'tag-new', ...data })),
      update: jest.fn(async ({ where, data }: any) => tagRow({ id: where.id, ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    taskTagLink: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    recurringTemplate: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-1', name: 'Asha' }]) },
  };
  prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
  return prisma;
}

/** hasEffective that grants exactly the listed `leaf:action` pairs. */
function permsGranting(...grants: string[]) {
  return {
    hasEffective: jest.fn(async (_org: string, p: Principal, leaf: string, action: PermissionAction) =>
      p.isAdmin || grants.includes(`${leaf}:${action}`),
    ),
  };
}

const p2002 = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

describe('TaskTagsService', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = makePrisma();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('createTag', () => {
    it('creates a new tag (201) with a normalised name and key', async () => {
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);
      const { tag, created } = await service.createTag(ORG, member, { name: '  Client   ABC ' });

      expect(created).toBe(true);
      expect(prisma.taskTag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organization_id: ORG,
          name: 'Client ABC',
          name_key: 'client abc',
          created_by_user_id: 'u-1',
          description: null,
        }),
      });
      // Internal columns never leave the API.
      expect(tag).not.toHaveProperty('name_key');
      expect(tag).not.toHaveProperty('created_by_user_id');
      expect(tag).not.toHaveProperty('usage_count');
    });

    it('returns the existing ACTIVE tag (200) for a case/space-insensitive repeat', async () => {
      prisma.taskTag.findFirst.mockResolvedValue(tagRow());
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);
      const { tag, created } = await service.createTag(ORG, member, { name: ' AUDIT ' });

      expect(created).toBe(false);
      expect(tag.id).toBe('tag-1');
      expect(prisma.taskTag.findFirst).toHaveBeenCalledWith({ where: { organization_id: ORG, name_key: 'audit' } });
      expect(prisma.taskTag.create).not.toHaveBeenCalled();
      expect(prisma.taskTag.count).not.toHaveBeenCalled(); // reuse never counts against the rate limit
    });

    it('409s with tag_id when the name matches a DEACTIVATED tag', async () => {
      prisma.taskTag.findFirst.mockResolvedValue(tagRow({ id: 'tag-old', is_active: false }));
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);

      const err = await service.createTag(ORG, member, { name: 'audit' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toEqual({ message: "'Audit' exists but is deactivated", tag_id: 'tag-old' });
    });

    it('403s without tasks.tags.create or tasks.config.tags.manage write', async () => {
      const perms = permsGranting('tasks.config.tags.manage:edit');
      const service = new TaskTagsService(prisma, perms as any);
      await expect(service.createTag(ORG, member, { name: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.taskTag.create).not.toHaveBeenCalled();
    });

    it('lets a tag manager (write) create without tasks.tags.create', async () => {
      const service = new TaskTagsService(prisma, permsGranting('tasks.config.tags.manage:write') as any);
      await expect(service.createTag(ORG, member, { name: 'Q4' })).resolves.toMatchObject({ created: true });
    });

    it('429s after 30 creations by the same user in the last hour', async () => {
      prisma.taskTag.count.mockResolvedValue(30);
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);

      const err = await service.createTag(ORG, member, { name: 'Another' }).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const where = prisma.taskTag.count.mock.calls[0][0].where;
      expect(where).toMatchObject({ organization_id: ORG, created_by_user_id: 'u-1' });
      expect(Date.now() - where.created_at.gte.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    });

    it('rejects commas, pipes and over-long names', async () => {
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);
      await expect(service.createTag(ORG, member, { name: 'a,b' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createTag(ORG, member, { name: 'a|b' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createTag(ORG, member, { name: 'x'.repeat(41) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createTag(ORG, member, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves a unique-constraint race by returning the winner', async () => {
      prisma.taskTag.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(tagRow({ id: 'tag-winner' }));
      prisma.taskTag.create.mockRejectedValue(p2002());
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);

      const { tag, created } = await service.createTag(ORG, member, { name: 'Audit' });
      expect(created).toBe(false);
      expect(tag.id).toBe('tag-winner');
    });

    it('auto-picks the least-used palette colour among active tags', async () => {
      prisma.taskTag.groupBy.mockResolvedValue([
        { color: 'slate', _count: { _all: 2 } },
        { color: 'ochre', _count: { _all: 1 } },
      ]);
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);
      await service.createTag(ORG, member, { name: 'New' });

      expect(prisma.taskTag.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organization_id: ORG, is_active: true } }),
      );
      // indigo is the first palette colour with zero uses.
      expect(prisma.taskTag.create.mock.calls[0][0].data.color).toBe('indigo');
    });

    it('breaks colour ties by palette order, and honours an explicit colour', async () => {
      prisma.taskTag.groupBy.mockResolvedValue(
        ['slate', 'ochre', 'indigo', 'rose', 'teal', 'green', 'violet', 'amber'].map((color) => ({
          color,
          _count: { _all: 3 },
        })),
      );
      const service = new TaskTagsService(prisma, permsGranting('tasks.tags.create:write') as any);
      await service.createTag(ORG, member, { name: 'Tie' });
      expect(prisma.taskTag.create.mock.calls[0][0].data.color).toBe('slate');

      await service.createTag(ORG, member, { name: 'Picked', color: 'rose' });
      expect(prisma.taskTag.create.mock.calls[1][0].data.color).toBe('rose');
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('listTags', () => {
    beforeEach(() => {
      prisma.taskTag.findMany.mockResolvedValue([tagRow(), tagRow({ id: 'tag-2', name: 'Q4', name_key: 'q4' })]);
      prisma.taskTagLink.groupBy.mockResolvedValue([{ tag_id: 'tag-1', _count: { _all: 42 } }]);
    });

    it('lists active tags by name for any member, without usage data', async () => {
      const service = new TaskTagsService(prisma, permsGranting() as any);
      const tags = await service.listTags(ORG, member);

      expect(prisma.taskTag.findMany).toHaveBeenCalledWith({
        where: { organization_id: ORG, is_active: true },
        orderBy: { name_key: 'asc' },
      });
      expect(tags).toHaveLength(2);
      expect(tags[0]).not.toHaveProperty('usage_count');
      expect(tags[0]).not.toHaveProperty('created_by');
    });

    it('adds usage_count and created_by for tag managers, and includes inactive on request', async () => {
      const service = new TaskTagsService(prisma, permsGranting('tasks.config.tags.manage:delete') as any);
      const tags = await service.listTags(ORG, member, true);

      expect(prisma.taskTag.findMany.mock.calls[0][0].where).toEqual({ organization_id: ORG });
      expect(tags[0]).toMatchObject({ usage_count: 42, created_by: { id: 'u-1', name: 'Asha' } });
      expect(tags[1]).toMatchObject({ usage_count: 0 });
    });

    it('gives admins usage data', async () => {
      const service = new TaskTagsService(prisma, permsGranting() as any);
      const tags = await service.listTags(ORG, admin);
      expect(tags[0].usage_count).toBe(42);
    });

    it('counts only live tasks in usage_count (soft-deleted tasks excluded)', async () => {
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await service.listTags(ORG, admin);
      expect(prisma.taskTagLink.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: ORG, tag_id: { in: ['tag-1', 'tag-2'] }, task: { is_deleted: false } },
        }),
      );
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('updateTag', () => {
    it('404s for a tag of another org', async () => {
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.updateTag(ORG, 'foreign', { color: 'teal' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.taskTag.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', organization_id: ORG } });
      expect(prisma.taskTag.update).not.toHaveBeenCalled();
    });

    it('409s when the new name collides with another tag', async () => {
      prisma.taskTag.findFirst
        .mockResolvedValueOnce(tagRow())
        .mockResolvedValueOnce({ id: 'tag-2', name: 'Urgent' });
      const service = new TaskTagsService(prisma, permsGranting() as any);
      const err = await service.updateTag(ORG, 'tag-1', { name: 'urgent' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ tag_id: 'tag-2' });
    });

    it('applies a partial update and re-keys a rename', async () => {
      prisma.taskTag.findFirst.mockResolvedValueOnce(tagRow()).mockResolvedValueOnce(null);
      const service = new TaskTagsService(prisma, permsGranting() as any);
      const tag = await service.updateTag(ORG, 'tag-1', { name: 'Audit 2026', is_active: false });

      expect(prisma.taskTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { name: 'Audit 2026', name_key: 'audit 2026', is_active: false },
      });
      expect(tag).toHaveProperty('usage_count');
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('deleteTag', () => {
    it('hard-deletes a tag that was never used', async () => {
      prisma.taskTag.findFirst.mockResolvedValue(tagRow());
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.deleteTag(ORG, 'tag-1')).resolves.toEqual({ result: 'deleted' });
      expect(prisma.taskTag.deleteMany).toHaveBeenCalledWith({ where: { id: 'tag-1', organization_id: ORG } });
    });

    it('deactivates a tag that is on a task', async () => {
      prisma.taskTag.findFirst.mockResolvedValue(tagRow());
      prisma.taskTagLink.count.mockResolvedValue(3);
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.deleteTag(ORG, 'tag-1')).resolves.toEqual({ result: 'deactivated' });
      expect(prisma.taskTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.taskTag.update).toHaveBeenCalledWith({ where: { id: 'tag-1' }, data: { is_active: false } });
    });

    it('deactivates a tag referenced only by a recurring template', async () => {
      prisma.taskTag.findFirst.mockResolvedValue(tagRow());
      prisma.recurringTemplate.count.mockResolvedValue(1);
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.deleteTag(ORG, 'tag-1')).resolves.toEqual({ result: 'deactivated' });
      expect(prisma.recurringTemplate.count).toHaveBeenCalledWith({
        where: { organization_id: ORG, tag_ids: { has: 'tag-1' } },
      });
    });

    it('deactivates (never hard-deletes) a tag whose only links are on soft-deleted tasks', async () => {
      // usage_count shows 0 (live tasks only), but the archived links still exist.
      prisma.taskTag.findFirst.mockResolvedValue(tagRow());
      prisma.taskTagLink.count.mockResolvedValue(2);
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.deleteTag(ORG, 'tag-1')).resolves.toEqual({ result: 'deactivated' });
      // The decision counts every link — no is_deleted filter.
      expect(prisma.taskTagLink.count).toHaveBeenCalledWith({ where: { tag_id: 'tag-1', organization_id: ORG } });
      expect(prisma.taskTag.deleteMany).not.toHaveBeenCalled();
    });

    it('404s for a tag of another org', async () => {
      const service = new TaskTagsService(prisma, permsGranting() as any);
      await expect(service.deleteTag(ORG, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.taskTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.taskTag.update).not.toHaveBeenCalled();
    });
  });

  // ─── merge ─────────────────────────────────────────────────────────────────

  describe('mergeTag', () => {
    const manager = permsGranting('tasks.config.tags.manage:edit', 'tasks.config.tags.manage:delete');

    it('moves links (skipping tasks that already have the target), rewrites templates, deletes the source', async () => {
      prisma.taskTag.findFirst.mockImplementation(async ({ where }: any) =>
        where.id === 'src'
          ? tagRow({ id: 'src', name: 'urgent', name_key: 'urgent' })
          : where.id === 'dst'
            ? tagRow({ id: 'dst', name: 'Urgent!', name_key: 'urgent!' })
            : null,
      );
      prisma.taskTagLink.findMany
        // links on the source
        .mockResolvedValueOnce([
          { id: 'l1', task_id: 't1' },
          { id: 'l2', task_id: 't2' },
          { id: 'l3', task_id: 't3' },
        ])
        // of those tasks, t2 already carries the target
        .mockResolvedValueOnce([{ task_id: 't2' }]);
      prisma.recurringTemplate.findMany.mockResolvedValue([
        { id: 'rt1', tag_ids: ['src', 'other'] },
        { id: 'rt2', tag_ids: ['dst', 'src'] },
      ]);
      const service = new TaskTagsService(prisma, manager as any);

      const res = await service.mergeTag(ORG, member, 'src', 'dst');

      expect(prisma.taskTagLink.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['l1', 'l3'] }, organization_id: ORG },
        data: { tag_id: 'dst' },
      });
      expect(prisma.taskTagLink.deleteMany).toHaveBeenCalledWith({ where: { tag_id: 'src', organization_id: ORG } });
      expect(prisma.recurringTemplate.update).toHaveBeenCalledWith({ where: { id: 'rt1' }, data: { tag_ids: ['dst', 'other'] } });
      expect(prisma.recurringTemplate.update).toHaveBeenCalledWith({ where: { id: 'rt2' }, data: { tag_ids: ['dst'] } });
      expect(prisma.taskTag.deleteMany).toHaveBeenCalledWith({ where: { id: 'src', organization_id: ORG } });
      expect(res.moved).toBe(2);
      expect(res.into.id).toBe('dst');
      expect(res.into).toHaveProperty('usage_count');
    });

    const bothTags = () =>
      prisma.taskTag.findFirst.mockImplementation(async ({ where }: any) =>
        where.id === 'src' || where.id === 'dst' ? tagRow({ id: where.id }) : null,
      );

    it('retries once when a concurrent change hits the unique index (P2002), then succeeds', async () => {
      bothTags();
      prisma.taskTagLink.findMany.mockImplementation(async ({ where }: any) => (where.tag_id === 'src' ? [{ id: 'l1', task_id: 't1' }] : []));
      prisma.taskTagLink.updateMany.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({ count: 1 });
      const service = new TaskTagsService(prisma, manager as any);

      const res = await service.mergeTag(ORG, member, 'src', 'dst');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(res.moved).toBe(1);
    });

    it('409s "Tags changed while merging" when the retry collides again', async () => {
      bothTags();
      prisma.taskTagLink.findMany.mockImplementation(async ({ where }: any) => (where.tag_id === 'src' ? [{ id: 'l1', task_id: 't1' }] : []));
      prisma.taskTagLink.updateMany.mockRejectedValue(p2002());
      const service = new TaskTagsService(prisma, manager as any);

      const err = await service.mergeTag(ORG, member, 'src', 'dst').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Tags changed while merging. Try again.');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-unique errors', async () => {
      bothTags();
      prisma.taskTagLink.findMany.mockImplementation(async ({ where }: any) => (where.tag_id === 'src' ? [{ id: 'l1', task_id: 't1' }] : []));
      prisma.taskTagLink.updateMany.mockRejectedValue(new Error('boom'));
      const service = new TaskTagsService(prisma, manager as any);

      await expect(service.mergeTag(ORG, member, 'src', 'dst')).rejects.toThrow('boom');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('needs delete as well as edit', async () => {
      const service = new TaskTagsService(prisma, permsGranting('tasks.config.tags.manage:edit') as any);
      await expect(service.mergeTag(ORG, member, 'src', 'dst')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to merge a tag into itself', async () => {
      const service = new TaskTagsService(prisma, manager as any);
      await expect(service.mergeTag(ORG, member, 'src', 'src')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when either tag belongs to another org', async () => {
      prisma.taskTag.findFirst.mockImplementation(async ({ where }: any) =>
        where.id === 'src' && where.organization_id === ORG ? tagRow({ id: 'src' }) : null,
      );
      const service = new TaskTagsService(prisma, manager as any);
      await expect(service.mergeTag(ORG, member, 'src', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.mergeTag(ORG, member, 'foreign', 'src')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

// ─── shared validator ────────────────────────────────────────────────────────

describe('assertTagsUsable', () => {
  const prismaWith = (rows: { id: string; name: string; is_active: boolean }[]) =>
    ({
      taskTag: {
        findMany: jest.fn(async ({ where }: any) =>
          where.organization_id === ORG ? rows.filter((r) => where.id.in.includes(r.id)) : [],
        ),
      },
    }) as any;

  it('passes undefined through (unchanged) and [] as "clear"', async () => {
    const prisma = prismaWith([]);
    await expect(assertTagsUsable(prisma, ORG, undefined)).resolves.toBeUndefined();
    await expect(assertTagsUsable(prisma, ORG, [])).resolves.toEqual([]);
    expect(prisma.taskTag.findMany).not.toHaveBeenCalled();
  });

  it('de-duplicates and scopes the lookup to the org', async () => {
    const prisma = prismaWith([{ id: 'a', name: 'A', is_active: true }]);
    await expect(assertTagsUsable(prisma, ORG, ['a', 'a'])).resolves.toEqual(['a']);
    expect(prisma.taskTag.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['a'] }, organization_id: ORG });
  });

  it('allows at most 10 distinct tags', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `t${i}`);
    const prisma = prismaWith(ids.map((id) => ({ id, name: id, is_active: true })));
    await expect(assertTagsUsable(prisma, ORG, ids)).rejects.toThrow('A task can have at most 10 tags');
    await expect(assertTagsUsable(prisma, ORG, [...ids.slice(0, 10), 't0'])).resolves.toHaveLength(10);
  });

  it('400s on a tag id from another org (or unknown)', async () => {
    const prisma = prismaWith([{ id: 'a', name: 'A', is_active: true }]);
    await expect(assertTagsUsable(prisma, ORG, ['a', 'foreign'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a newly added inactive tag but accepts one already on the task', async () => {
    const prisma = prismaWith([
      { id: 'a', name: 'A', is_active: true },
      { id: 'old', name: 'Old', is_active: false },
    ]);
    await expect(assertTagsUsable(prisma, ORG, ['a', 'old'])).rejects.toThrow('"Old" is deactivated');
    await expect(assertTagsUsable(prisma, ORG, ['a', 'old'], { keep: ['old'] })).resolves.toEqual(['a', 'old']);
  });

  it('still requires kept ids to belong to the org', async () => {
    const prisma = prismaWith([]);
    await expect(assertTagsUsable(prisma, ORG, ['foreign'], { keep: ['foreign'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('tag ref mappers', () => {
  it('flattenTags strips the join row', () => {
    const out = flattenTags({ id: 't1', tags: [{ tag: { id: 'a', name: 'A', color: 'teal', is_active: true } }] });
    expect(out).toEqual({ id: 't1', tags: [{ id: 'a', name: 'A', color: 'teal', is_active: true }] });
    const bare: { id: string; tags?: never[] } = { id: 't2' };
    expect(flattenTags(bare)).toEqual({ id: 't2', tags: [] });
  });

  it('tagRefsFor drops unknown ids, de-duplicates and sorts by name', () => {
    const refs = new Map([
      ['b', { id: 'b', name: 'beta', color: 'slate' as const, is_active: true }],
      ['a', { id: 'a', name: 'Alpha', color: 'rose' as const, is_active: false }],
    ]);
    expect(tagRefsFor(['b', 'gone', 'a', 'b'], refs).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
