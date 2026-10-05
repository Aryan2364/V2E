import { SchedulerService } from './scheduler.service';

/**
 * Spawning copies a recurring template's tags onto the new instance
 * (TASK_TAGS_PLAN.md §4.4): only tags still active in the template's org are linked,
 * a deactivated / deleted / foreign one is skipped silently, and a tag failure never
 * costs the org the instance.
 */

const ORG = 'org-1';
const NOW = new Date('2026-10-04T08:00:00');

const ACTIVE_TAGS = [
  { id: 'tag-audit', organization_id: ORG, is_active: true },
  { id: 'tag-q4', organization_id: ORG, is_active: true },
  { id: 'tag-old', organization_id: ORG, is_active: false },
  { id: 'tag-foreign', organization_id: 'org-2', is_active: true },
];

function entryFor(tagIds: string[]) {
  return {
    id: 'entry-1',
    organization_id: ORG,
    recurring_template_id: 'tpl-1',
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '17:00',
    start_date: new Date('2026-10-01T00:00:00'),
    end_condition: 'never',
    end_date: null,
    end_after: null,
    occurrence_count: 3,
    is_active: true,
    template: {
      id: 'tpl-1',
      organization_id: ORG,
      created_by_user_id: 'u-creator',
      title: 'Monthly close',
      description: null,
      category_id: null,
      priority_id: null,
      quadrant: 'Q2',
      department_id: null,
      completion_mode: 'any_can_complete',
      proof_required: false,
      proof_allowed_extensions: [],
      linked_goal_id: null,
      assignee_user_ids: ['u-2'],
      cc_user_ids: [],
      escalation_user_ids: [],
      checklist_items: [],
      reminder_specs: [],
      tag_ids: tagIds,
      is_active: true,
    },
  };
}

function makePrisma(entry: any) {
  const prisma: any = {
    recurringScheduleEntry: {
      findMany: jest.fn().mockResolvedValue([entry]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    recurringTemplate: { update: jest.fn() },
    recurringTemplateAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    task: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'task-new' }),
    },
    taskStatus: { findFirst: jest.fn().mockResolvedValue({ id: 'st-1' }) },
    taskAssignee: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    taskTag: {
      findMany: jest.fn(async ({ where }: any) =>
        ACTIVE_TAGS.filter(
          (t) =>
            where.id.in.includes(t.id) &&
            t.organization_id === where.organization_id &&
            (where.is_active === undefined || t.is_active === where.is_active),
        ).map((t) => ({ id: t.id })),
      ),
    },
    taskTagLink: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    taskEscalation: { createMany: jest.fn() },
    taskChecklist: { createMany: jest.fn() },
    taskReminder: { createMany: jest.fn() },
    taskActivityLog: { create: jest.fn().mockResolvedValue({}) },
    organizationMember: { findMany: jest.fn().mockResolvedValue([]) },
    goal: { findFirst: jest.fn() },
  };
  return prisma;
}

function makeService(prisma: any) {
  const holidays = { adjustDeadline: jest.fn(async (d: Date) => d) };
  const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
  const auditWriter = { runAsSystem: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) };
  const r2 = { isConfigured: false };
  return new SchedulerService(
    prisma,
    holidays as any,
    notifications as any,
    auditWriter as any,
    {} as any, // leave — unused by the task spawn path
    r2 as any,
    {} as any, // goals — unused by the task spawn path
  );
}

describe('SchedulerService — spawn copies template tags', () => {
  it('links only the template tags still active in its org, attributed to the task creator', async () => {
    const prisma = makePrisma(entryFor(['tag-audit', 'tag-old', 'tag-q4', 'tag-foreign', 'tag-deleted', 'tag-audit']));
    const service = makeService(prisma);

    const res = await service.spawnForTemplate(ORG, 'tpl-1', false, NOW);

    expect(res.spawned).toBe(1);
    const lookup = prisma.taskTag.findMany.mock.calls[0][0];
    expect(lookup.where).toEqual({
      id: { in: ['tag-audit', 'tag-old', 'tag-q4', 'tag-foreign', 'tag-deleted'] },
      organization_id: ORG,
      is_active: true,
    });
    const { data } = prisma.taskTagLink.createMany.mock.calls[0][0];
    expect(data).toEqual([
      { organization_id: ORG, task_id: 'task-new', tag_id: 'tag-audit', created_by_user_id: 'u-creator' },
      { organization_id: ORG, task_id: 'task-new', tag_id: 'tag-q4', created_by_user_id: 'u-creator' },
    ]);
    // Same actor as the spawned task's created_by.
    expect(prisma.task.create.mock.calls[0][0].data.created_by_user_id).toBe('u-creator');
  });

  it('spawns without any link rows when every template tag has been deactivated', async () => {
    const prisma = makePrisma(entryFor(['tag-old']));
    const service = makeService(prisma);

    const res = await service.spawnForTemplate(ORG, 'tpl-1', false, NOW);

    expect(res.spawned).toBe(1);
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });

  it('skips the tag lookup entirely for an untagged template', async () => {
    const prisma = makePrisma(entryFor([]));
    const service = makeService(prisma);

    await service.spawnForTemplate(ORG, 'tpl-1', false, NOW);

    expect(prisma.taskTag.findMany).not.toHaveBeenCalled();
    expect(prisma.taskTagLink.createMany).not.toHaveBeenCalled();
  });

  it('never blocks the spawn when copying tags fails', async () => {
    const prisma = makePrisma(entryFor(['tag-audit']));
    prisma.taskTagLink.createMany.mockRejectedValue(new Error('db hiccup'));
    const service = makeService(prisma);

    const res = await service.spawnForTemplate(ORG, 'tpl-1', false, NOW);

    expect(res.spawned).toBe(1);
    expect(prisma.taskActivityLog.create).toHaveBeenCalled();
    expect(prisma.recurringScheduleEntry.update).toHaveBeenCalled();
  });
});
