import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { memTable } from '../common/testing/mem-table';
import { Principal } from '../access-rights/permissions.service';

const ORG = 'org-1';
const OTHER = 'org-2';
const principal = (userId: string): Principal => ({ userId, systemRoleId: null, isAdmin: false, isSuperAdmin: false });

function setup() {
  const projects = memTable<any>([{ id: 'pr-1', organization_id: ORG, is_deleted: false, name: 'P', members: [] }]);
  const members = memTable<any>([
    { id: 'pm-1', organization_id: ORG, project_id: 'pr-1', user_id: 'u-manager', role: 'manager' },
    { id: 'pm-2', organization_id: ORG, project_id: 'pr-1', user_id: 'u-viewer', role: 'viewer' },
    // A user who belongs to two orgs: member of the project in ORG only.
    { id: 'pm-3', organization_id: ORG, project_id: 'pr-1', user_id: 'u-multi', role: 'manager' },
  ]);
  const milestones = memTable<any>([{ id: 'ms-1', organization_id: ORG, project_id: 'pr-1' }]);
  const tasks = memTable<any>([
    { id: 't-1', organization_id: ORG, is_deleted: false, created_by_user_id: 'u-creator', assignees: [] },
  ]);
  const prisma: any = {
    project: projects,
    projectMember: members,
    projectMilestone: milestones,
    projectTask: memTable<any>([]),
    task: tasks,
  };
  const scope: any = {
    registerWiredList: jest.fn(),
    assertCanActOn: jest.fn(async () => {
      throw new ForbiddenException('outside scope');
    }),
  };
  const svc = new ProjectsService(
    prisma,
    { recalculateProjectProgress: jest.fn() } as any,
    { emit: jest.fn(), userName: jest.fn() } as any,
    {} as any,
    scope,
    { registerCounter: jest.fn() } as any,
  );
  return { svc, projects, milestones, scope };
}

describe('ProjectsService object-level authorization', () => {
  it('another org cannot read or mutate a project, even via a membership in a different org', async () => {
    const { svc, milestones } = setup();
    // u-multi is a manager of pr-1 in ORG; acting under OTHER must not reach it.
    await expect(svc.getProject(OTHER, 'pr-1', 'u-multi')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listMembers(OTHER, 'pr-1', 'u-multi')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updateStatus(OTHER, 'pr-1', 'u-multi', { status: 'active' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteMilestone(OTHER, 'pr-1', 'u-multi', 'ms-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(milestones.rows).toHaveLength(1);
  });

  it('a same-org non-member cannot read or mutate; a viewer cannot modify', async () => {
    const { svc, milestones } = setup();
    await expect(svc.getProject(ORG, 'pr-1', 'u-peer')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteMilestone(ORG, 'pr-1', 'u-peer', 'ms-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteMilestone(ORG, 'pr-1', 'u-viewer', 'ms-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteProject(ORG, 'pr-1', 'u-viewer', 'why')).rejects.toBeInstanceOf(ForbiddenException);
    expect(milestones.rows).toHaveLength(1);
  });

  it("a project member cannot link a task they cannot see (outside their scope)", async () => {
    const { svc, scope } = setup();
    await expect(
      svc.linkTask(ORG, 'pr-1', 'u-manager', { task_id: 't-1' } as any, principal('u-manager')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(scope.assertCanActOn).toHaveBeenCalled();
  });
});
