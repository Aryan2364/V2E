import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkLogsService } from './work-logs.service';
import { memTable } from '../common/testing/mem-table';

const ORG = 'org-1';
const OTHER = 'org-2';
const actor = (id: string, admin = false) => ({ id, is_admin: admin, isSuperAdmin: false });

function setup() {
  const demands = memTable<any>([{ id: 'dm-1', organization_id: ORG, assigner_user_id: 'u-assigner', assignee_user_id: 'u-writer', is_active: true }]);
  const submissions = memTable<any>([{ id: 'sub-1', organization_id: ORG, writer_user_id: 'u-writer', demand_id: 'dm-1', demand: { title: 't', assigner_user_id: 'u-assigner' } }]);
  const remarks = memTable<any>([
    { id: 'rm-1', organization_id: ORG, target_type: 'submission', target_id: 'sub-1', user_id: 'u-writer', is_deleted: false },
    { id: 'rm-foreign', organization_id: OTHER, target_type: 'submission', target_id: 'sub-x', user_id: 'u-foreign', is_deleted: false },
  ]);
  const prisma: any = {
    workLogDemand: demands,
    workLogSubmission: submissions,
    workLogRemark: remarks,
    workLogReaderGrant: memTable<any>([]),
    workLogDemandSchedule: memTable<any>([]),
    dailyUpdate: memTable<any>([]),
    organizationMember: memTable<any>([{ id: 'm', organization_id: ORG, user_id: 'u-writer', is_active: true }]),
  };
  const notifications: any = { emit: jest.fn(), userName: jest.fn(async () => 'N') };
  const visibility: any = { getProfiles: jest.fn(async () => new Map()), getSubordinateUserIds: jest.fn(async () => []) };
  const svc = new WorkLogsService(prisma, notifications, {} as any, visibility, {} as any);
  jest.spyOn(svc as any, 'getSettings').mockResolvedValue({ managers_read_reports: false });
  return { svc, demands, notifications };
}

describe('WorkLogsService object-level authorization', () => {
  it('another org cannot read or manage a demand, submit a log or read remarks', async () => {
    const { svc } = setup();
    await expect(svc.getDemandSeries(OTHER, actor('u-foreign', true), 'dm-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.pauseDemand(OTHER, actor('u-foreign', true), 'dm-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteDemand(OTHER, actor('u-foreign', true), 'dm-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.submitSubmission(OTHER, actor('u-writer'), 'sub-1', { body: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getRemarks(OTHER, actor('u-foreign', true), 'submission', 'sub-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a same-org non-participant cannot manage a demand, submit for someone else or read remarks', async () => {
    const { svc, demands } = setup();
    await expect(svc.pauseDemand(ORG, actor('u-peer'), 'dm-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteDemand(ORG, actor('u-peer'), 'dm-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getDemandSeries(ORG, actor('u-peer'), 'dm-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.submitSubmission(ORG, actor('u-peer'), 'sub-1', { body: 'x' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getRemarks(ORG, actor('u-peer'), 'submission', 'sub-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(demands.rows[0].is_active).toBe(true);
  });

  it("a reply cannot point at another org's remark (no cross-tenant notification)", async () => {
    const { svc, notifications } = setup();
    await expect(
      svc.addRemark(ORG, actor('u-writer'), { target_type: 'submission', target_id: 'sub-1', body: 'hi', reply_to_remark_id: 'rm-foreign' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('an admin cannot grant read access to people outside the org', async () => {
    const { svc } = setup();
    await expect(
      svc.addReaderGrant(ORG, actor('u-admin', true), { reader_user_id: 'u-foreign', writer_user_id: 'u-writer' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
