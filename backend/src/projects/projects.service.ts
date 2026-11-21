import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectProgressService } from './project-progress.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { ScopeService } from '../access-rights/scope.service';
import { AccessVisibilityService } from '../access-rights/access-visibility.service';
import { Principal } from '../access-rights/permissions.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { UpdateProjectMemberDto } from './dto/update-project-member.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { LinkProjectTaskDto } from './dto/link-project-task.dto';
import { AddDependencyDto } from './dto/add-dependency.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AddDocumentDto } from './dto/add-document.dto';

const PROJECT_INCLUDE = {
  members: true,
  milestones: { orderBy: { order_index: 'asc' as const } },
  project_tasks: true,
  goals: {
    where: { goal: { is_deleted: false } },
    include: { goal: { select: { id: true, title: true, status: true, due_date: true } } },
  },
  _count: { select: { members: true, project_tasks: true } },
};

@Injectable()
export class ProjectsService {
  private static readonly PROJECTS_LEAF = 'projects.project.manage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly progressService: ProjectProgressService,
    private readonly notifications: NotificationsService,
    private readonly subjects: SubjectEligibilityService,
    private readonly scope: ScopeService,
    private readonly visibility: AccessVisibilityService,
  ) {
    this.scope.registerWiredList(ProjectsService.PROJECTS_LEAF);
    this.visibility.registerCounter(ProjectsService.PROJECTS_LEAF, (orgId, userId) =>
      this.prisma.project.count({
        where: {
          organization_id: orgId,
          is_deleted: false,
          ...(this.visibility.whereForUser(ProjectsService.PROJECTS_LEAF, userId) ?? {}),
        },
      }),
    );
  }

  // ─── Master ──────────────────────────────────────────────────────────────────

  private async ensureMaster(orgId: string) {
    return this.prisma.projectMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
  }

  async getConfig(orgId: string) {
    return this.ensureMaster(orgId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findProjectOrFail(orgId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organization_id: orgId, is_deleted: false },
      include: PROJECT_INCLUDE,
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /**
   * Linked goals must be real, live goals in THIS org — otherwise a pasted
   * foreign id would attach the project to another firm's goal.
   */
  private async assertGoalsInOrg(orgId: string, goalIds: string[] | undefined): Promise<string[]> {
    const ids = Array.from(new Set((goalIds ?? []).filter(Boolean)));
    if (ids.length === 0) return [];
    const found = await this.prisma.goal.findMany({
      where: { id: { in: ids }, organization_id: orgId, is_deleted: false },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('A linked goal was not found in this organization');
    }
    return ids;
  }

  /**
   * Replace a project's goal links with exactly `goalIds`. Many-to-many by
   * design: a project can serve several goals at once, so this is a set
   * operation, not a single foreign key.
   */
  private async setProjectGoals(
    orgId: string,
    projectId: string,
    userId: string,
    goalIds: string[],
  ): Promise<void> {
    const existing = await this.prisma.goalProject.findMany({
      where: { project_id: projectId, organization_id: orgId },
      select: { goal_id: true },
    });
    const have = new Set(existing.map((e) => e.goal_id));
    const want = new Set(goalIds);

    const toAdd = goalIds.filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !want.has(id));

    if (toRemove.length) {
      await this.prisma.goalProject.deleteMany({
        where: { project_id: projectId, organization_id: orgId, goal_id: { in: toRemove } },
      });
    }
    if (toAdd.length) {
      await this.prisma.goalProject.createMany({
        data: toAdd.map((goal_id) => ({
          organization_id: orgId,
          goal_id,
          project_id: projectId,
          created_by_user_id: userId,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async requireMember(projectId: string, userId: string) {
    const m = await this.prisma.projectMember.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    });
    if (!m) throw new ForbiddenException('You are not a member of this project');
    return m;
  }

  private async requireManagerOrEditor(projectId: string, userId: string) {
    const m = await this.requireMember(projectId, userId);
    if (m.role === 'viewer') throw new ForbiddenException('Viewers cannot modify this project');
    return m;
  }

  private log(orgId: string, projectId: string, userId: string, action: string, metadata: Record<string, unknown> = {}) {
    return this.prisma.projectActivityLog.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        performed_by_user_id: userId,
        action: action as never,
        metadata: metadata as never,
      },
    });
  }

  // ─── Apply template ──────────────────────────────────────────────────────────

  private async applyTemplate(orgId: string, projectId: string, templateId: string) {
    const template = await this.prisma.projectTemplate.findFirst({
      where: { id: templateId, organization_id: orgId, is_active: true },
      include: {
        milestones: { orderBy: { order_index: 'asc' } },
        tasks: { orderBy: { order_index: 'asc' } },
      },
    });
    if (!template) return;

    for (const ms of template.milestones) {
      const milestone = await this.prisma.projectMilestone.create({
        data: {
          organization_id: orgId,
          project_id: projectId,
          name: ms.name,
          description: ms.description,
          order_index: ms.order_index,
        },
      });

      const milestoneTasks = template.tasks.filter((t) => t.milestone_id === ms.id);
      for (let i = 0; i < milestoneTasks.length; i++) {
        const t = milestoneTasks[i];
        await this.prisma.projectTask.create({
          data: {
            organization_id: orgId,
            project_id: projectId,
            milestone_id: milestone.id,
            task_id: null,
            template_task_id: t.id,
            order_index: t.order_index,
          },
        });
      }
    }

    // Direct tasks (no milestone)
    const directTasks = template.tasks.filter((t) => !t.milestone_id);
    for (const t of directTasks) {
      await this.prisma.projectTask.create({
        data: {
          organization_id: orgId,
          project_id: projectId,
          milestone_id: null,
          task_id: null,
          template_task_id: t.id,
          order_index: t.order_index,
        },
      });
    }

    await this.progressService.recalculateProjectProgress(projectId);
  }

  // ─── Projects CRUD ──────────────────────────────────────────────────────────

  async listProjects(orgId: string, principal: Principal) {
    // Row-level data scope: own == projects the actor participates in (creator /
    // manager / member); team/department/org widen it via granted scope.
    const scopeWhere = await this.scope.listWhere(orgId, principal, ProjectsService.PROJECTS_LEAF);
    return this.prisma.project.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        ...(Object.keys(scopeWhere).length ? { AND: [scopeWhere as any] } : {}),
      },
      include: {
        members: true,
        milestones: { orderBy: { order_index: 'asc' } },
        _count: { select: { members: true, project_tasks: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async listMyProjects(orgId: string, principal: Principal) {
    return this.listProjects(orgId, principal);
  }

  async listManagingProjects(orgId: string, userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: { user_id: userId, role: 'manager' },
      select: { project_id: true },
    });
    const projectIds = memberships.map((m) => m.project_id);
    return this.prisma.project.findMany({
      where: { organization_id: orgId, id: { in: projectIds }, is_deleted: false },
      include: {
        members: true,
        milestones: { orderBy: { order_index: 'asc' } },
        _count: { select: { members: true, project_tasks: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getProject(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.findProjectOrFail(orgId, projectId);
  }

  async createProject(orgId: string, userId: string, dto: CreateProjectDto) {
    const master = await this.ensureMaster(orgId);
    const member = await this.prisma.organizationMember.findUnique({
      where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
      select: { is_admin: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this organization');
    const allowedRoles = master.project_creation_roles as string[];
    // MemberRole-collapse translation: employee-inclusive config → any member; else admin only.
    if (!(Array.isArray(allowedRoles) && (allowedRoles.includes('employee') || member.is_admin))) {
      throw new ForbiddenException('Your role is not permitted to create projects');
    }

    const goalIds = await this.assertGoalsInOrg(orgId, dto.goal_ids);

    const project = await this.prisma.project.create({
      data: {
        organization_id: orgId,
        name: dto.name,
        description: dto.description,
        project_manager_user_id: dto.project_manager_user_id,
        template_id: dto.template_id,
        start_date: dto.start_date ? new Date(dto.start_date) : undefined,
        end_date: dto.end_date ? new Date(dto.end_date) : undefined,
        planned_budget: dto.planned_budget,
        currency: dto.currency ?? 'INR',
        created_by_user_id: userId,
      },
    });

    if (goalIds.length) {
      await this.setProjectGoals(orgId, project.id, userId, goalIds);
    }

    // Auto-add creator as manager
    await this.prisma.projectMember.create({
      data: {
        organization_id: orgId,
        project_id: project.id,
        user_id: userId,
        role: 'manager',
        task_visibility: 'all_member_tasks',
        added_by_user_id: userId,
      },
    });

    // Add PM if different from creator
    if (dto.project_manager_user_id !== userId) {
      await this.prisma.projectMember.upsert({
        where: { project_id_user_id: { project_id: project.id, user_id: dto.project_manager_user_id } },
        create: {
          organization_id: orgId,
          project_id: project.id,
          user_id: dto.project_manager_user_id,
          role: 'manager',
          task_visibility: 'all_member_tasks',
          added_by_user_id: userId,
        },
        update: { role: 'manager' },
      });
    }

    if (dto.template_id) {
      await this.applyTemplate(orgId, project.id, dto.template_id);
      await this.log(orgId, project.id, userId, 'template_applied', { template_id: dto.template_id });
    }

    await this.log(orgId, project.id, userId, 'created', { name: project.name });

    // Notify the PM (if different from creator)
    if (dto.project_manager_user_id !== userId) {
      const creatorName = await this.notifications.userName(userId);
      await this.notifications.emit({
        orgId,
        module: 'projects',
        event_type: 'project_created',
        recipients: [dto.project_manager_user_id],
        title: 'New project',
        body: `${creatorName} created project "${project.name}" and made you its manager.`,
        link: `/dashboard/projects/${project.id}`,
        entity: { type: 'project', id: project.id },
      });
    }

    return this.findProjectOrFail(orgId, project.id);
  }

  async updateProject(orgId: string, projectId: string, userId: string, dto: UpdateProjectDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    if (dto.goal_ids !== undefined) {
      const goalIds = await this.assertGoalsInOrg(orgId, dto.goal_ids ?? []);
      await this.setProjectGoals(orgId, projectId, userId, goalIds);
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.project_manager_user_id !== undefined && { project_manager_user_id: dto.project_manager_user_id }),
        ...(dto.start_date !== undefined && { start_date: new Date(dto.start_date) }),
        ...(dto.end_date !== undefined && { end_date: new Date(dto.end_date) }),
      },
      include: PROJECT_INCLUDE,
    });
  }

  async updateStatus(orgId: string, projectId: string, userId: string, dto: UpdateProjectStatusDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    if ((dto.status === 'on_hold' || dto.status === 'cancelled') && !dto.status_reason?.trim()) {
      throw new BadRequestException('Give a reason when putting a project on hold or cancelling it.');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { status: dto.status, status_reason: dto.status_reason ?? null },
      include: PROJECT_INCLUDE,
    });

    await this.log(orgId, projectId, userId, 'status_changed', { status: dto.status, reason: dto.status_reason });
    return updated;
  }

  async updateBudget(orgId: string, projectId: string, userId: string, dto: UpdateBudgetDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.planned_budget !== undefined && { planned_budget: dto.planned_budget }),
        ...(dto.actual_spent !== undefined && { actual_spent: dto.actual_spent }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
      },
      include: PROJECT_INCLUDE,
    });

    await this.log(orgId, projectId, userId, 'budget_updated', { planned: dto.planned_budget, actual: dto.actual_spent });
    return updated;
  }

  async deleteProject(orgId: string, projectId: string, userId: string, reason: string) {
    await this.findProjectOrFail(orgId, projectId);
    const m = await this.requireMember(projectId, userId);
    if (m.role !== 'manager') throw new ForbiddenException('Only managers can delete projects');

    await this.log(orgId, projectId, userId, 'deleted', { reason });

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        is_deleted: true,
        deleted_by_user_id: userId,
        deleted_at: new Date(),
        deletion_reason: reason,
      },
    });

    return { message: 'Project deleted' };
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async listMembers(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectMember.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'asc' },
    });
  }

  async addMember(orgId: string, projectId: string, userId: string, dto: AddProjectMemberDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    // Subject eligibility (fail loud): the added user must be allowed to be a project member.
    await this.subjects.assertEligible(orgId, 'projects.subject.member', dto.user_id);

    const member = await this.prisma.projectMember.upsert({
      where: { project_id_user_id: { project_id: projectId, user_id: dto.user_id } },
      create: {
        organization_id: orgId,
        project_id: projectId,
        user_id: dto.user_id,
        role: dto.role ?? 'viewer',
        task_visibility: dto.task_visibility ?? 'own_tasks_only',
        added_by_user_id: userId,
      },
      update: {
        role: dto.role ?? 'viewer',
        task_visibility: dto.task_visibility ?? 'own_tasks_only',
      },
    });

    await this.log(orgId, projectId, userId, 'member_added', { user_id: dto.user_id, role: dto.role });

    if (dto.user_id !== userId) {
      const [adderName, project] = await Promise.all([
        this.notifications.userName(userId),
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      ]);
      await this.notifications.emit({
        orgId,
        module: 'projects',
        event_type: 'project_member_added',
        recipients: [dto.user_id],
        title: 'Added to a project',
        body: `${adderName} added you to project "${project?.name ?? ''}" as ${dto.role ?? 'viewer'}.`,
        link: `/dashboard/projects/${projectId}`,
        entity: { type: 'project', id: projectId },
      });
    }
    return member;
  }

  async updateMember(orgId: string, projectId: string, userId: string, targetUserId: string, dto: UpdateProjectMemberDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    const updated = await this.prisma.projectMember.update({
      where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.task_visibility !== undefined && { task_visibility: dto.task_visibility }),
      },
    });

    await this.log(orgId, projectId, userId, 'member_role_changed', { user_id: targetUserId, role: dto.role });
    return updated;
  }

  async removeMember(orgId: string, projectId: string, userId: string, targetUserId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    await this.prisma.projectMember.delete({
      where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } },
    });
    await this.log(orgId, projectId, userId, 'member_removed', { user_id: targetUserId });
    return { message: 'Member removed' };
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  async listMilestones(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectMilestone.findMany({
      where: { project_id: projectId },
      include: { tasks: true },
      orderBy: { order_index: 'asc' },
    });
  }

  async createMilestone(orgId: string, projectId: string, userId: string, dto: CreateMilestoneDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    const count = await this.prisma.projectMilestone.count({ where: { project_id: projectId } });

    const milestone = await this.prisma.projectMilestone.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        name: dto.name,
        description: dto.description,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        order_index: dto.order_index ?? count,
      },
    });

    await this.progressService.recalculateProjectProgress(projectId);
    await this.log(orgId, projectId, userId, 'milestone_created', { milestone_id: milestone.id, name: milestone.name });
    return milestone;
  }

  async updateMilestone(orgId: string, projectId: string, userId: string, milestoneId: string, dto: UpdateMilestoneDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    const milestone = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, project_id: projectId },
      select: { id: true },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');

    return this.prisma.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.due_date !== undefined && { due_date: new Date(dto.due_date) }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
      },
    });
  }

  async deleteMilestone(orgId: string, projectId: string, userId: string, milestoneId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    const milestone = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, project_id: projectId },
      select: { id: true },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    await this.prisma.projectMilestone.delete({ where: { id: milestoneId } });
    await this.progressService.recalculateProjectProgress(projectId);
    return { message: 'Milestone deleted' };
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  async listProjectTasks(orgId: string, projectId: string, userId: string, milestoneId?: string) {
    const member = await this.requireMember(projectId, userId);

    const where: Record<string, unknown> = { project_id: projectId };
    if (milestoneId) where.milestone_id = milestoneId;

    const projectTasks = await this.prisma.projectTask.findMany({
      where,
      orderBy: [{ milestone_id: 'asc' }, { order_index: 'asc' }],
    });

    const taskIds = projectTasks.filter((pt) => pt.task_id).map((pt) => pt.task_id as string);

    let taskMap: Record<string, unknown> = {};
    if (taskIds.length > 0) {
      const tasks = await this.prisma.task.findMany({
        where: { id: { in: taskIds }, is_deleted: false },
        include: { status: true, priority: true, assignees: true },
      });

      // Filter by visibility
      const filteredTasks = member.task_visibility === 'own_tasks_only'
        ? tasks.filter((t) => t.assignees.some((a) => a.user_id === userId && !a.is_cc))
        : tasks;

      taskMap = Object.fromEntries(filteredTasks.map((t) => [t.id, t]));
    }

    return projectTasks.map((pt) => ({
      ...pt,
      task: pt.task_id ? (taskMap[pt.task_id] ?? null) : null,
    }));
  }

  async linkTask(orgId: string, projectId: string, userId: string, dto: LinkProjectTaskDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    // Validate task exists in org
    const task = await this.prisma.task.findFirst({
      where: { id: dto.task_id, organization_id: orgId, is_deleted: false },
    });
    if (!task) throw new NotFoundException('Task not found');

    // Check not already linked
    const existing = await this.prisma.projectTask.findFirst({
      where: { project_id: projectId, task_id: dto.task_id },
    });
    if (existing) throw new BadRequestException('Task is already linked to this project');

    const count = await this.prisma.projectTask.count({ where: { project_id: projectId } });
    const pt = await this.prisma.projectTask.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        milestone_id: dto.milestone_id ?? null,
        task_id: dto.task_id,
        order_index: count,
      },
    });

    await this.progressService.recalculateProjectProgress(projectId);
    await this.log(orgId, projectId, userId, 'task_added', { task_id: dto.task_id });
    return pt;
  }

  async fulfillPendingTask(orgId: string, projectId: string, userId: string, projectTaskId: string, taskId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    const pt = await this.prisma.projectTask.findFirst({
      where: { id: projectTaskId, project_id: projectId, task_id: null },
    });
    if (!pt) throw new NotFoundException('Pending project task not found');

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
    });
    if (!task) throw new NotFoundException('Task not found');

    const updated = await this.prisma.projectTask.update({
      where: { id: projectTaskId },
      data: { task_id: taskId },
    });

    await this.progressService.recalculateProjectProgress(projectId);
    await this.log(orgId, projectId, userId, 'task_added', { task_id: taskId, from_template: true });
    return updated;
  }

  async unlinkTask(orgId: string, projectId: string, userId: string, projectTaskId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    const pt = await this.prisma.projectTask.findFirst({ where: { id: projectTaskId, project_id: projectId } });
    if (!pt) throw new NotFoundException('Project task not found');

    await this.prisma.projectTask.delete({ where: { id: projectTaskId } });
    await this.progressService.recalculateProjectProgress(projectId);
    await this.log(orgId, projectId, userId, 'task_removed', { task_id: pt.task_id });
    return { message: 'Task removed from project' };
  }

  async getDependencyWarnings(orgId: string, projectId: string, userId: string, taskId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireMember(projectId, userId);
    const deps = await this.prisma.projectTaskDependency.findMany({
      where: { task_id: taskId, project_id: projectId },
    });
    if (!deps.length) return [];

    const depTaskIds = deps.map((d) => d.depends_on_task_id);
    const completedStatuses = await this.prisma.taskStatus.findMany({
      where: { type: 'completed' },
      select: { id: true },
    });
    const completedStatusIds = new Set(completedStatuses.map((s) => s.id));

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: depTaskIds }, is_deleted: false },
      include: { status: true },
    });

    return tasks
      .filter((t) => !completedStatusIds.has(t.status_id))
      .map((t) => ({ task_id: t.id, title: t.title, status_label: t.status?.label ?? 'Unknown' }));
  }

  // ─── Dependencies ────────────────────────────────────────────────────────────

  async addDependency(orgId: string, projectId: string, userId: string, dto: AddDependencyDto) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);

    if (dto.task_id === dto.depends_on_task_id) {
      throw new BadRequestException('A task cannot depend on itself');
    }

    const dep = await this.prisma.projectTaskDependency.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        task_id: dto.task_id,
        depends_on_task_id: dto.depends_on_task_id,
      },
    });

    await this.log(orgId, projectId, userId, 'dependency_added', { task_id: dto.task_id, depends_on: dto.depends_on_task_id });
    return dep;
  }

  async removeDependency(orgId: string, projectId: string, userId: string, depId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireManagerOrEditor(projectId, userId);
    const dep = await this.prisma.projectTaskDependency.findFirst({
      where: { id: depId, project_id: projectId },
      select: { id: true },
    });
    if (!dep) throw new NotFoundException('Dependency not found');
    await this.prisma.projectTaskDependency.delete({ where: { id: depId } });
    await this.log(orgId, projectId, userId, 'dependency_removed', { dep_id: depId });
    return { message: 'Dependency removed' };
  }

  async listDependencies(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectTaskDependency.findMany({ where: { project_id: projectId } });
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  async listComments(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectComment.findMany({
      where: { project_id: projectId, is_deleted: false },
      orderBy: { created_at: 'asc' },
    });
  }

  async addComment(orgId: string, projectId: string, userId: string, dto: AddCommentDto) {
    await this.requireMember(projectId, userId);
    const comment = await this.prisma.projectComment.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        user_id: userId,
        body: dto.body,
        attachment_urls: (dto.attachment_urls ?? []) as never,
        reply_to_comment_id: dto.reply_to_comment_id ?? null,
      },
    });
    await this.log(orgId, projectId, userId, 'comment_added', { comment_id: comment.id });
    return comment;
  }

  async deleteComment(orgId: string, projectId: string, userId: string, commentId: string) {
    const member = await this.requireMember(projectId, userId);
    const comment = await this.prisma.projectComment.findFirst({
      where: { id: commentId, project_id: projectId, is_deleted: false },
      select: { id: true, user_id: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.user_id !== userId && member.role !== 'manager') {
      throw new ForbiddenException("Cannot delete another user's comment");
    }
    await this.prisma.projectComment.update({
      where: { id: commentId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
    return { message: 'Comment deleted' };
  }

  // ─── Documents ───────────────────────────────────────────────────────────────

  async listDocuments(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectDocument.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  async addDocument(orgId: string, projectId: string, userId: string, dto: AddDocumentDto) {
    await this.requireMember(projectId, userId);
    const doc = await this.prisma.projectDocument.create({
      data: {
        organization_id: orgId,
        project_id: projectId,
        name: dto.name,
        url: dto.url,
        type: dto.type,
        uploaded_by_user_id: userId,
      },
    });
    await this.log(orgId, projectId, userId, 'document_added', { document_id: doc.id, name: doc.name });
    return doc;
  }

  async deleteDocument(orgId: string, projectId: string, userId: string, docId: string) {
    await this.requireManagerOrEditor(projectId, userId);
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: docId, project_id: projectId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.projectDocument.delete({ where: { id: docId } });
    return { message: 'Document removed' };
  }

  // ─── Activity ────────────────────────────────────────────────────────────────

  async getActivity(orgId: string, projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.projectActivityLog.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Progress ────────────────────────────────────────────────────────────────

  async getProgress(orgId: string, projectId: string, userId: string) {
    const project = await this.findProjectOrFail(orgId, projectId);
    await this.requireMember(projectId, userId);
    return {
      project_id: projectId,
      completion_percentage: project.completion_percentage,
      total_tasks: project.total_tasks,
      completed_tasks: project.completed_tasks,
      total_milestones: project.total_milestones,
      achieved_milestones: project.achieved_milestones,
    };
  }

  async forceRecalculate(orgId: string, projectId: string, userId: string) {
    await this.findProjectOrFail(orgId, projectId);
    await this.requireMember(projectId, userId);
    await this.progressService.recalculateProjectProgress(projectId);
    return this.getProgress(orgId, projectId, userId);
  }
}
