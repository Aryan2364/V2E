import { NotFoundException } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { memTable } from '../common/testing/mem-table';

/**
 * Goals are company-wide by design (scope registry: org_default) — the module permission
 * is the action gate and there is no per-row participant model. What must hold is org
 * isolation: no goal, link or check-in of another org can be read or mutated, and a
 * goal cannot be pointed at another org's department.
 */
const ORG = 'org-1';
const OTHER = 'org-2';

function setup() {
  const goals = memTable<any>([{ id: 'g-1', organization_id: ORG, is_deleted: false, title: 'G', owner_user_id: 'u-owner' }]);
  const links = memTable<any>([{ id: 'l-1', organization_id: ORG, supporting: { title: 'a' }, supported: { title: 'b' }, note: null }]);
  const checkIns = memTable<any>([{ id: 'ci-1', organization_id: ORG, goal_id: 'g-1', is_voided: false }]);
  const prisma: any = {
    goal: goals,
    goalLink: links,
    goalCheckIn: checkIns,
    department: memTable<any>([{ id: 'd-foreign', organization_id: OTHER }]),
  };
  const visibility: any = { registerCounter: jest.fn() };
  const svc = new GoalsService(
    prisma,
    { record: jest.fn() } as any,
    { assertEligible: jest.fn() } as any,
    visibility,
    {} as any,
    {} as any,
    { now: jest.fn(async () => new Date()) } as any,
    { emit: jest.fn() } as any,
  );
  return { svc, goals, links };
}

describe('GoalsService org isolation', () => {
  it('another org cannot read, edit, delete a goal or edit/remove a link', async () => {
    const { svc, goals, links } = setup();
    await expect(svc.getOne(OTHER, 'g-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(OTHER, 'u-x', 'g-1', { title: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove(OTHER, 'u-x', 'g-1', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateLink(OTHER, 'u-x', 'l-1', { note: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeLink(OTHER, 'u-x', 'l-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(goals.rows[0].is_deleted).toBe(false);
    expect(links.rows).toHaveLength(1);
  });

  it("a goal cannot be filed under another org's department", async () => {
    const { svc } = setup();
    await expect(svc.update(ORG, 'u-x', 'g-1', { department_id: 'd-foreign' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
