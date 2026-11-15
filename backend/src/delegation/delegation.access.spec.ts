import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DelegationService } from './delegation.service';
import { memTable } from '../common/testing/mem-table';
import { Principal } from '../access-rights/permissions.service';

const ORG = 'org-1';
const OTHER = 'org-2';
const p = (userId: string, isAdmin = false): Principal => ({ userId, systemRoleId: null, isAdmin, isSuperAdmin: false });

function setup() {
  const delegations = memTable<any>([
    { id: 'd-1', organization_id: ORG, created_by_user_id: 'u-delegator', owner_user_id: 'u-owner', status: 'active', criteria: [] },
  ]);
  const criteria = memTable<any>([{ id: 'cr-1', organization_id: ORG, delegation_id: 'd-1', is_met: false }]);
  const prisma: any = { delegation: delegations, delegationCriterion: criteria, user: { findMany: jest.fn(async () => []) } };
  const permissions: any = { hasEffective: jest.fn(async () => false) };
  return { svc: new DelegationService(prisma, permissions), criteria };
}

describe('DelegationService object-level authorization', () => {
  it('another org (even an admin) cannot read or mutate a delegation', async () => {
    const { svc } = setup();
    await expect(svc.getOne(OTHER, 'd-1', p('u-foreign', true))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.complete(OTHER, 'd-1', p('u-foreign', true))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.toggleCriterion(OTHER, 'd-1', 'cr-1', p('u-foreign', true), true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a same-org non-participant can neither read nor tick a criterion', async () => {
    const { svc, criteria } = setup();
    await expect(svc.getOne(ORG, 'd-1', p('u-peer'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.toggleCriterion(ORG, 'd-1', 'cr-1', p('u-peer'), true)).rejects.toBeInstanceOf(NotFoundException);
    expect(criteria.rows[0].is_met).toBe(false);
  });

  it('the owner cannot complete the delegation, and nobody without the delete right can delete', async () => {
    const { svc } = setup();
    await expect(svc.complete(ORG, 'd-1', p('u-owner'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove(ORG, 'd-1', p('u-delegator'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
