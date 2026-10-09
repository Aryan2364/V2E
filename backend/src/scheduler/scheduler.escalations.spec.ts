import { SchedulerService } from './scheduler.service';

/**
 * The escalation engine fires the lowest unfired level — ALL of that level's rows at
 * once (a workflow step escalates to every assignee's manager at level 1); a later
 * level waits an hour after the levels before it; paused (inactive) rows never fire.
 */

const ORG = 'org-1';
const NOW = new Date('2026-10-08T10:00:00Z');
const HOUR = 3_600_000;

function esc(id: string, level: number, to: string, escalated_at: Date | null = null) {
  return { id, level, escalate_to_user_id: to, escalated_at, is_active: true };
}

function setup(escalations: any[], taskOver: Record<string, unknown> = {}) {
  const task = {
    id: 'task-1',
    organization_id: ORG,
    title: 'Collect documents',
    deadline: new Date(NOW.getTime() - 2 * HOUR),
    status: { type: 'in_progress' },
    workflow_instance_step_id: null as string | null,
    assignees: [{ user_id: 'u-worker' }],
    escalations,
    ...taskOver,
  };
  const prisma: any = {
    task: { findMany: jest.fn().mockResolvedValue([task]) },
    taskEscalation: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = escalations.filter((e) => where.id.in.includes(e.id) && e.escalated_at === null);
        hit.forEach((e) => Object.assign(e, data));
        return { count: hit.length };
      }),
    },
    taskActivityLog: { create: jest.fn() },
  };
  const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
  const auditWriter = { runAsSystem: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) };
  const engine = { onTaskEscalated: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = { get: jest.fn(() => engine) };
  const service = new SchedulerService(
    prisma,
    {} as any,
    notifications as any,
    auditWriter as any,
    {} as any,
    {} as any,
    {} as any,
    moduleRef as any,
  );
  return { service, prisma, notifications, engine, escalations };
}

describe('SchedulerService.processEscalationsForOrg', () => {
  it('fires every level-1 row together, in one notification, once', async () => {
    const { service, prisma, notifications, escalations } = setup([esc('a', 1, 'm-1'), esc('b', 1, 'm-2'), esc('c', 2, 'boss')]);

    expect(await service.processEscalationsForOrg(ORG, NOW)).toBe(2);
    expect(escalations.map((e) => e.escalated_at)).toEqual([NOW, NOW, null]);
    expect(notifications.emit).toHaveBeenCalledTimes(1);
    expect(notifications.emit.mock.calls[0][0].recipients).toEqual(['m-1', 'm-2', 'u-worker']);
    expect(prisma.taskActivityLog.create).toHaveBeenCalledTimes(2);

    // Same tick again: level 2 must wait an hour after level 1.
    expect(await service.processEscalationsForOrg(ORG, NOW)).toBe(0);
  });

  it('a later level fires an hour after the last row of the levels before it', async () => {
    const fired = new Date(NOW.getTime() - 2 * HOUR);
    const { service, escalations } = setup([esc('a', 1, 'm-1', fired), esc('b', 1, 'm-2', new Date(NOW.getTime() - 30 * 60_000)), esc('c', 2, 'boss')]);
    expect(await service.processEscalationsForOrg(ORG, NOW)).toBe(0); // m-2 fired only 30 min ago
    expect(await service.processEscalationsForOrg(ORG, new Date(NOW.getTime() + HOUR))).toBe(1);
    expect(escalations[2].escalated_at).not.toBeNull();
  });

  it('tells the workflow engine when a workflow step task escalates', async () => {
    const { service, engine } = setup([esc('a', 1, 'm-1'), esc('b', 1, 'm-2')], { workflow_instance_step_id: 'row-1' });
    await service.processEscalationsForOrg(ORG, NOW);
    expect(engine.onTaskEscalated).toHaveBeenCalledWith(ORG, 'task-1', 1, ['m-1', 'm-2']);
  });

  it('never escalates a closed task', async () => {
    const { service, notifications } = setup([esc('a', 1, 'm-1')], { status: { type: 'completed' } });
    expect(await service.processEscalationsForOrg(ORG, NOW)).toBe(0);
    expect(notifications.emit).not.toHaveBeenCalled();
  });
});
