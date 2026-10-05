import { TasksAnalyticsService } from './tasks-analytics.service';

/**
 * `by_tag` dashboard breakdown (TASK_TAGS_PLAN.md §7 Phase 5, §10.2): same item shape
 * as `by_category`, built from link groupBys filtered by the dashboard's own task
 * where-clause, a bounded number of queries, inactive tags still labelled, untagged
 * tasks not listed, sorted by total desc.
 */

const ORG = 'org-1';
const WHERE = { organization_id: ORG, is_deleted: false, category_id: 'cat-1' };

/** Link counts per timing bucket, keyed the way the service asks for them. */
const LINK_COUNTS: Record<string, Record<string, number>> = {
  early: { 'tag-audit': 1 },
  on_time: { 'tag-audit': 2, 'tag-old': 1 },
  late: { 'tag-q4': 1 },
  overdue: { 'tag-audit': 1, 'tag-q4': 3 },
  partial: {},
  incomplete: {},
  pending: { 'tag-q4': 1 },
};

function bucketOf(taskWhere: any): string {
  const ct = taskWhere.completion_timing;
  if (ct) return ct;
  return taskWhere.is_overdue ? 'overdue' : 'pending';
}

function makePrisma() {
  const prisma: any = {
    taskTagLink: {
      groupBy: jest.fn(async ({ where }: any) =>
        Object.entries(LINK_COUNTS[bucketOf(where.task)]).map(([tag_id, n]) => ({ tag_id, _count: { _all: n } })),
      ),
    },
    taskTag: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'tag-audit', name: 'Audit', color: 'ochre' },
        { id: 'tag-q4', name: 'Q4', color: 'teal' },
        { id: 'tag-old', name: 'Legacy', color: 'slate' }, // deactivated — still labelled
      ]),
    },
    task: { groupBy: jest.fn().mockResolvedValue([]) },
    taskStatus: { findMany: jest.fn().mockResolvedValue([]) },
    taskPriority: { findMany: jest.fn().mockResolvedValue([]) },
    taskCategory: { findMany: jest.fn().mockResolvedValue([]) },
    department: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

describe('TasksAnalyticsService — by_tag', () => {
  let prisma: any;
  let service: TasksAnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new TasksAnalyticsService(prisma, {} as any);
  });

  it('returns by_category-shaped items, sorted by total desc, with per-timing counts', async () => {
    const byTag = await service.tagBreakdown(ORG, WHERE);

    expect(byTag).toEqual([
      {
        id: 'tag-q4',
        label: 'Q4',
        color: 'teal',
        total: 5,
        timing: { early: 0, on_time: 0, late: 1, overdue: 3, partial: 0, incomplete: 0, pending: 1 },
      },
      {
        id: 'tag-audit',
        label: 'Audit',
        color: 'ochre',
        total: 4,
        timing: { early: 1, on_time: 2, late: 0, overdue: 1, partial: 0, incomplete: 0, pending: 0 },
      },
      {
        id: 'tag-old',
        label: 'Legacy',
        color: 'slate',
        total: 1,
        timing: { early: 0, on_time: 1, late: 0, overdue: 0, partial: 0, incomplete: 0, pending: 0 },
      },
    ]);
  });

  it('filters links by the dashboard task where-clause and stays a bounded query count', async () => {
    await service.tagBreakdown(ORG, WHERE);

    // One groupBy per timing bucket + one label lookup — independent of the tag count.
    expect(prisma.taskTagLink.groupBy).toHaveBeenCalledTimes(TasksAnalyticsService.TIMINGS.length);
    expect(prisma.taskTag.findMany).toHaveBeenCalledTimes(1);
    for (const [args] of prisma.taskTagLink.groupBy.mock.calls) {
      expect(args.by).toEqual(['tag_id']);
      expect(args.where.organization_id).toBe(ORG);
      expect(args.where.task).toMatchObject(WHERE);
    }
    // Labels are org-scoped and NOT restricted to active tags (history stays readable).
    const labelWhere = prisma.taskTag.findMany.mock.calls[0][0].where;
    expect(labelWhere.organization_id).toBe(ORG);
    expect(labelWhere).not.toHaveProperty('is_active');
  });

  it('returns [] (no "Untagged" bucket) when no task in scope carries a tag', async () => {
    prisma.taskTagLink.groupBy.mockResolvedValue([]);
    await expect(service.tagBreakdown(ORG, WHERE)).resolves.toEqual([]);
    expect(prisma.taskTag.findMany).not.toHaveBeenCalled();
  });

  it('dimensionBreakdowns includes by_tag next to by_category', async () => {
    const dims = await service.dimensionBreakdowns(ORG, WHERE);
    expect(dims.by_tag.map((t) => t.id)).toEqual(['tag-q4', 'tag-audit', 'tag-old']);
    expect(dims).toHaveProperty('by_category');
  });
});
