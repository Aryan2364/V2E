import { TaskImportService } from './task-import.service';
import { BulkTaskImportRowDto } from './dto/bulk-import-task.dto';

/**
 * The import `tags` column (TASK_TAGS_PLAN.md §4.5, §10.2): pipe/newline-separated
 * names matched case- and whitespace-insensitively against ACTIVE tags; an unknown
 * name is a row error; more than 10 is a row error; import never creates tags; the
 * resolved ids travel into the real createTask path.
 */

const ORG = 'org-1';

const TAGS = [
  { id: 'tag-audit', name: 'Audit', name_key: 'audit', is_active: true },
  { id: 'tag-client', name: 'Client ABC', name_key: 'client abc', is_active: true },
  { id: 'tag-q4', name: 'Q4', name_key: 'q4', is_active: true },
  { id: 'tag-old', name: 'Legacy', name_key: 'legacy', is_active: false },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `tag-n${i}`, name: `N${i}`, name_key: `n${i}`, is_active: true })),
];

function makePrisma() {
  return {
    taskPriority: { findMany: jest.fn().mockResolvedValue([]) },
    taskCategory: { findMany: jest.fn().mockResolvedValue([]) },
    taskTag: {
      findMany: jest.fn(async ({ where }: any) => TAGS.filter((t) => where.is_active === undefined || t.is_active === where.is_active)),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
    task: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    taskImportBatch: { create: jest.fn().mockResolvedValue({ id: 'batch-1' }), update: jest.fn().mockResolvedValue({}) },
    taskImportRow: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } as any;
}

function makeService(prisma: any) {
  const assigneeVisibility = {
    resolve: jest.fn().mockResolvedValue({ pool: new Set(['u-2']) }),
    getProfiles: jest.fn().mockResolvedValue(
      new Map([['u-2', { user_id: 'u-2', name: 'Ravi', department_name: 'Ops', role_title: 'Analyst' }]]),
    ),
  };
  const checklistAccess = { listAccessibleTemplates: jest.fn().mockResolvedValue([]) };
  const holidays = { isWorkingDay: jest.fn().mockResolvedValue(true) };
  const leave = { availability: jest.fn().mockResolvedValue({ results: [] }) };
  const tasks = { createTask: jest.fn().mockResolvedValue({ id: 'task-1' }) };
  const service = new TaskImportService(
    prisma,
    assigneeVisibility as any,
    checklistAccess as any,
    holidays as any,
    leave as any,
    tasks as any,
  );
  return { service, tasks };
}

const row = (tags?: string): BulkTaskImportRowDto => ({
  title: 'File GST return',
  deadline_date: '2099-01-15',
  assignee_1: 'Ravi',
  ...(tags !== undefined && { tags }),
});

describe('TaskImportService — tags column', () => {
  let prisma: any;
  let service: TaskImportService;
  let tasks: { createTask: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    ({ service, tasks } = makeService(prisma));
  });

  it('import options list the active tags (id + name), sorted case-insensitively', async () => {
    const opts = await service.getImportOptions(ORG, 'u-1');
    const call = prisma.taskTag.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ organization_id: ORG, is_active: true });
    expect(call.orderBy).toEqual({ name_key: 'asc' });
    expect(call.select).toEqual({ id: true, name: true });
    expect(opts.tags.map((t) => t.id)).not.toContain('tag-old');
    expect(opts.tags.length).toBe(TAGS.filter((t) => t.is_active).length);
  });

  it('resolves a known tag, ignoring case and stray whitespace', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row('  client   abc ')]);
    expect(res.rows[0].status).toBe('ready');
    expect(res.rows[0].resolved.tag_ids).toEqual(['tag-client']);
    expect(res.rows[0].resolved.tags).toEqual(['Client ABC']);
  });

  it('resolves several tags in one cell (pipe- and newline-separated), de-duplicated', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row('Audit | q4\nAUDIT')]);
    expect(res.rows[0].status).toBe('ready');
    expect(res.rows[0].resolved.tag_ids).toEqual(['tag-audit', 'tag-q4']);
  });

  it('an unknown tag is a row error naming it — and import never creates tags', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row('Audit | Nope | Also nope')]);
    expect(res.rows[0].status).toBe('error');
    const messages = res.rows[0].issues.filter((i) => i.field === 'tags').map((i) => i.message);
    expect(messages).toEqual(['Tag "Nope" not found', 'Tag "Also nope" not found']);
    expect(prisma.taskTag.create).not.toHaveBeenCalled();
    expect(prisma.taskTag.upsert).not.toHaveBeenCalled();
  });

  it('matches only ACTIVE tags (a deactivated tag reads as not found)', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row('Audit | Legacy')]);
    expect(prisma.taskTag.findMany.mock.calls[0][0].where).toEqual({ organization_id: ORG, is_active: true });
    expect(res.rows[0].status).toBe('error');
    expect(res.rows[0].issues.find((i) => i.field === 'tags')?.message).toBe('Tag "Legacy" not found');
  });

  it('more than 10 tags is a row error', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row('Audit | ' + Array.from({ length: 10 }, (_, i) => `N${i}`).join(' | '))]);
    expect(res.rows[0].status).toBe('error');
    expect(res.rows[0].issues.find((i) => i.field === 'tags')?.message).toMatch(/at most 10 tags/);
  });

  it('a row with no tags cell stays ready and carries no tag_ids', async () => {
    const res = await service.validateImport(ORG, 'u-1', [row()]);
    expect(res.rows[0].status).toBe('ready');
    expect(res.rows[0].resolved.tag_ids).toBeUndefined();
  });

  it('commit passes the resolved tag_ids into createTask', async () => {
    const res = await service.commitImport(ORG, 'u-1', [row('Q4 | Audit'), row()]);
    expect(res.created).toBe(2);
    expect(tasks.createTask.mock.calls[0][2].tag_ids).toEqual(['tag-q4', 'tag-audit']);
    expect(tasks.createTask.mock.calls[1][2].tag_ids).toBeUndefined();
  });

  it('commit never creates a row whose tags did not resolve', async () => {
    const res = await service.commitImport(ORG, 'u-1', [row('Ghost')]);
    expect(res.created).toBe(0);
    expect(res.results[0]).toMatchObject({ status: 'failed', error: 'Tag "Ghost" not found' });
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
});
