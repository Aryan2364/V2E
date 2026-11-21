import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { memTable } from '../common/testing/mem-table';

/**
 * Leave object-level authorization (backend/AUTHORIZATION.md). Leave uses an approver
 * chain rather than data scope: the owner, an org admin, the applicant's manager or a
 * configured approver may act — everyone else in the same org is refused, and another
 * org cannot see the row at all.
 */
const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function setup(over: { approvalMode?: string; approvers?: string[] } = {}) {
  const leaves = memTable<any>([
    { id: 'leave-1', organization_id: ORG, user_id: 'u-owner', state: 'pending', origin: 'requested', overridden: false, start_date: new Date('2026-01-01'), end_date: new Date('2026-01-02') },
  ]);
  const members = memTable<any>([
    { id: 'm1', organization_id: ORG, user_id: 'u-owner', is_admin: false },
    { id: 'm2', organization_id: ORG, user_id: 'u-admin', is_admin: true },
    { id: 'm3', organization_id: ORG, user_id: 'u-manager', is_admin: false },
    { id: 'm4', organization_id: ORG, user_id: 'u-peer', is_admin: false },
    { id: 'm5', organization_id: OTHER_ORG, user_id: 'u-foreign', is_admin: true },
  ]);
  const profiles = memTable<any>([{ id: 'p1', organization_id: ORG, user_id: 'u-owner', reporting_to_user_id: 'u-manager' }]);
  const prisma: any = {
    leave: leaves,
    organizationMember: members,
    employeeProfile: profiles,
    leaveMaster: { findUnique: jest.fn(async () => ({ approval_mode: over.approvalMode ?? 'manager', approver_user_ids: over.approvers ?? [], allow_override: true, min_notice_days: 0 })) },
    user: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => ({ name: 'X' })) },
    task: { findMany: jest.fn(async () => []) },
    taskAssignee: { findMany: jest.fn(async () => []) },
  };
  const svc = new LeaveService(prisma, { now: jest.fn(async () => new Date()) } as any, { emit: jest.fn() } as any);
  // Config is read through getConfig(); stub it so the spec does not depend on its column names.
  jest.spyOn(svc, 'getConfig').mockResolvedValue({
    approvalMode: over.approvalMode ?? 'manager', approverUserIds: over.approvers ?? [], allowOverride: true, minNoticeDays: 0,
  } as any);
  return { svc, prisma, leaves };
}

describe('LeaveService object-level authorization', () => {
  it('another org cannot decide, cancel or override a leave (404)', async () => {
    const { svc } = setup();
    await expect(svc.decide(OTHER_ORG, 'u-foreign', 'leave-1', { decision: 'approved' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.cancel(OTHER_ORG, 'u-foreign', 'leave-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.override(OTHER_ORG, 'u-foreign', 'leave-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a same-org non-approver cannot decide', async () => {
    const { svc, leaves } = setup();
    await expect(svc.decide(ORG, 'u-peer', 'leave-1', { decision: 'approved' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(leaves.rows[0].state).toBe('pending');
  });

  it('the applicant cannot approve their own request even if listed as an approver', async () => {
    const { svc, leaves } = setup({ approvalMode: 'approvers', approvers: ['u-owner'] });
    await expect(svc.decide(ORG, 'u-owner', 'leave-1', { decision: 'approved' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(leaves.rows[0].state).toBe('pending');
  });

  it('the applicant\'s manager can decide', async () => {
    const { svc, leaves } = setup();
    await svc.decide(ORG, 'u-manager', 'leave-1', { decision: 'approved' } as any);
    expect(leaves.rows[0].state).toBe('approved');
  });

  it('a same-org peer cannot cancel someone else\'s leave; the owner can', async () => {
    const { svc, leaves } = setup();
    await expect(svc.cancel(ORG, 'u-peer', 'leave-1')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.cancel(ORG, 'u-owner', 'leave-1');
    expect(leaves.rows[0].state).toBe('cancelled');
  });

  it('an admin cannot book leave for a user who is not a member of the org', async () => {
    const { svc } = setup();
    await expect(
      svc.create(ORG, 'u-admin', 'u-foreign', { start_date: '2026-02-01', end_date: '2026-02-02' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
