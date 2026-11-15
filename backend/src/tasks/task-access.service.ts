import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CompletionTiming,
  PermissionAction,
  TaskActionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { ClockService } from '../clock/clock.service';
import { ScopeService } from '../access-rights/scope.service';
import { AccessVisibilityService } from '../access-rights/access-visibility.service';
import { Principal } from '../access-rights/permissions.service';
import { instanceIdForRow, isRunParticipant } from '../workflows/run-access';
import { assertMastersUsable as assertMastersUsableShared } from '../common/task-masters-usable';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import {
  TASK_INCLUDE,
  SIMULATED_FUTURE_TASK_MESSAGE,
  TASK_LEAF,
} from './task-shared';

/** Permission / visibility helpers. Canonical authorization reference (see backend/AUTHORIZATION.md). */
@Injectable()
export class TaskAccessService {
  private readonly logger = new Logger(TaskAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
    private readonly visibility: AccessVisibilityService,
  ) {
    this.scope.registerWiredList(TASK_LEAF);
    this.visibility.registerCounter(TASK_LEAF, (orgId, userId) =>
      this.prisma.task.count({
        where: {
          organization_id: orgId,
          is_deleted: false,
          ...(this.visibility.whereForUser(TASK_LEAF, userId) ?? {}),
        },
      }),
    );
  }

  async checkTaskPermission(
    orgId: string,
    userId: string,
    field:
      | 'task_creation_roles'
      | 'task_edit_roles'
      | 'task_delete_roles'
      | 'archive_view_roles',
  ) {
    const [config, member] = await Promise.all([
      this.getOrgConfig(orgId),
      this.prisma.organizationMember.findUnique({
        where: {
          organization_id_user_id: { organization_id: orgId, user_id: userId },
        },
        select: { is_admin: true },
      }),
    ]);
    if (!member)
      throw new ForbiddenException('Not a member of this organization');
    const allowedRoles = config[field] as string[];
    // MemberRole-collapse translation: an "employee"-inclusive config stays open to
    // every member; otherwise the action is restricted to platform admins.
    const allowed =
      Array.isArray(allowedRoles) &&
      (allowedRoles.includes('employee') || member.is_admin);
    if (!allowed) {
      throw new ForbiddenException(
        `Your role is not permitted to perform this action`,
      );
    }
  }

  /**
   * A task is a private record. Given its participants, allow a viewer only if they
   * are directly on it (creator, assignee, or CC) OR the task falls within their read
   * scope (team / department / org) over one of its core participants. Fails closed —
   * knowing a task's id must never be enough to read it or its comments/attachments.
   *
   * With `ctx` (the task's id + workflow link) two more kinds of people are on it:
   *   - its ACTIVE escalation contacts (TaskEscalation.is_active) — they're asked to
   *     act on it, so the Escalated page must be able to open it;
   *   - for a workflow step task, everyone who may see that workflow instance
   *     (`isRunParticipant`: the workflow's editors and viewers, the person who ran
   *     it, and everyone working in it — assignees/CCs/escalation contacts of its
   *     tasks). This admits VIEW (and comment) only — completion keeps its own gates
   *     (non-CC assignee / assigner rights).
   */

  async assertParticipantView(
    orgId: string,
    principal: Principal,
    createdByUserId: string,
    assignees: { user_id: string; is_cc: boolean }[],
    ctx?: { taskId: string; workflowInstanceStepId?: string | null },
  ): Promise<void> {
    const onTask =
      createdByUserId === principal.userId ||
      assignees.some((a) => a.user_id === principal.userId);
    if (onTask) return;
    if (ctx) {
      const escalation = await this.prisma.taskEscalation.findFirst({
        where: {
          task_id: ctx.taskId,
          organization_id: orgId,
          escalate_to_user_id: principal.userId,
          is_active: true,
        },
        select: { id: true },
      });
      if (escalation) return;
      if (ctx.workflowInstanceStepId) {
        const instanceId = await instanceIdForRow(
          this.prisma,
          orgId,
          ctx.workflowInstanceStepId,
        );
        if (
          instanceId &&
          (await isRunParticipant(
            this.prisma,
            orgId,
            instanceId,
            principal.userId,
          ))
        )
          return;
      }
    }
    const coreParticipants = [
      createdByUserId,
      ...assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
    ];
    await this.scope.assertCanActOn(
      orgId,
      principal,
      TASK_LEAF,
      PermissionAction.read,
      coreParticipants,
    );
  }

  /**
   * Guard for a task's sub-resources (comments, logs, attachments). External callers
   * pass their principal; internal callers pass none (already authorized upstream).
   */

  async assertCanViewTask(
    orgId: string,
    principal: Principal | undefined,
    taskId: string,
  ): Promise<void> {
    if (!principal) return;
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: {
        created_by_user_id: true,
        workflow_instance_step_id: true,
        // Live roster: being taken off a task ends the access it granted. Someone
        // removed can still reach it only if their data scope covers it.
        assignees: {
          where: ACTIVE_ASSIGNEE,
          select: { user_id: true, is_cc: true },
        },
      },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.assertParticipantView(
      orgId,
      principal,
      task.created_by_user_id,
      task.assignees,
      {
        taskId,
        workflowInstanceStepId: task.workflow_instance_step_id,
      },
    );
  }

  async getOrgConfig(orgId: string) {
    return this.prisma.taskMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
  }

  async findTaskOrFail(orgId: string, taskId: string, isWrite = false) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    if (isWrite) {
      const now = await this.clock.now(orgId);
      if (task.created_at > now) {
        throw new ForbiddenException(SIMULATED_FUTURE_TASK_MESSAGE);
      }
    }
    return task;
  }

  async logActivity(
    orgId: string,
    taskId: string,
    userId: string,
    action: TaskActionType,
    metadata?: Record<string, unknown>,
  ) {
    // The activity trail is best-effort: it is written AFTER the business
    // mutation has committed, so a transient failure here must never turn an
    // already-successful action into a 500.
    try {
      return await this.prisma.taskActivityLog.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          performed_by_user_id: userId,
          action,
          metadata: metadata ? (metadata as any) : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Activity log (${action}) failed for task ${taskId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async enrichAssignees(
    assignees: {
      user_id: string;
      is_cc: boolean;
      is_completed: boolean;
      completed_at: Date | null;
      id: string;
    }[],
  ) {
    const userIds = assignees.map((a) => a.user_id);
    if (userIds.length === 0)
      return assignees.map((a) => ({ ...a, user: null }));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return assignees.map((a) => ({
      ...a,
      user: userMap.get(a.user_id) ?? null,
    }));
  }

  async getDefaultStatusId(orgId: string): Promise<string> {
    // A new task is always born in the single `not_started` status. Fall back to the
    // is_default flag, then the first active status, for older/partial orgs.
    const notStarted = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'not_started', is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (notStarted) return notStarted.id;
    const flagged = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (flagged) return flagged.id;
    const fallback = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (!fallback)
      throw new BadRequestException(
        'No task statuses configured for this organization',
      );
    return fallback.id;
  }

  /** The three canonical open/terminal statuses an org keys its roll-up off. */
  async getCanonicalStatuses(orgId: string) {
    const all = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    return {
      notStarted:
        all.find((s) => s.type === 'not_started') ??
        all.find((s) => s.is_default) ??
        all[0] ??
        null,
      inProgress: all.find((s) => s.type === 'in_progress') ?? null,
      completed: all.find((s) => s.type === 'completed') ?? null,
      partiallyCompleted:
        all.find((s) => s.type === 'partially_completed') ?? null,
      incomplete: all.find((s) => s.type === 'incomplete') ?? null,
      all,
    };
  }

  async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: { organization_id: orgId, user_id: userId },
      },
      select: { is_admin: true },
    });
    return !!member?.is_admin;
  }

  /**
   * Rebuild a Principal for a userId-only code path so the scope toolkit can be
   * applied where only the actor's id was threaded through (legacy signatures).
   */

  async principalFor(orgId: string, userId: string): Promise<Principal> {
    const [member, profile] = await Promise.all([
      this.prisma.organizationMember.findUnique({
        where: {
          organization_id_user_id: { organization_id: orgId, user_id: userId },
        },
        select: { is_admin: true },
      }),
      this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: userId },
        select: { system_role_id: true },
      }),
    ]);
    return {
      userId,
      systemRoleId: profile?.system_role_id ?? null,
      isAdmin: !!member?.is_admin,
      isSuperAdmin: false,
    };
  }

  /**
   * Assigner-level rights over ONE task (owner override, acting on someone else's
   * part, editing/reassigning). The creator and org admins always qualify; anyone
   * else needs BOTH the org's task-edit-roles gate AND edit scope over the task's
   * core participants — the action gate alone is scope-blind and must never be a
   * skeleton key for every task in the company (AUTHORIZATION.md rule 6).
   */

  async assertAssignerRights(
    orgId: string,
    actorId: string,
    task: any,
  ): Promise<void> {
    if (task.created_by_user_id === actorId) return;
    if (await this.isOrgAdmin(orgId, actorId)) return;
    await this.checkTaskPermission(orgId, actorId, 'task_edit_roles');
    const principal = await this.principalFor(orgId, actorId);
    await this.scope.assertCanActOn(
      orgId,
      principal,
      TASK_LEAF,
      PermissionAction.edit,
      [
        task.created_by_user_id,
        ...(task.assignees ?? [])
          .filter((a: any) => !a.is_cc)
          .map((a: any) => a.user_id),
      ],
    );
  }

  /**
   * Master references (category / priority / department) must belong to THIS org
   * and be active — a pasted foreign, deleted or deactivated id must fail loud
   * with a clean 400, never store a cross-tenant reference or crash with a 500.
   */

  async assertMastersUsable(
    orgId: string,
    refs: {
      category_id?: string | null;
      priority_id?: string | null;
      department_id?: string | null;
    },
  ): Promise<void> {
    // One source of truth, shared with the recurring service (see common/task-masters-usable.ts).
    return assertMastersUsableShared(this.prisma, orgId, refs);
  }

  /**
   * The assignee picker's visibility rules re-checked at SAVE time — a hand-crafted
   * request must not reach people the assigner can't see in the picker. Applies to
   * working assignees AND CCs (both are chosen through the same visibility-scoped
   * picker). Uses the exact same resolved pool the picker itself renders.
   */

  async assertAssigneesVisible(
    orgId: string,
    assignerId: string,
    userIds: string[],
  ): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const { pool } = await this.assigneeVisibility.resolve(orgId, assignerId);
    const outside = ids.filter((id) => !pool.has(id));
    if (outside.length) {
      throw new BadRequestException(
        'One or more selected people are outside the set you are allowed to assign tasks to.',
      );
    }
  }

  /**
   * Recompute a task's single shared status from its per-person tracks. Only meaningful
   * for `all_must_complete` (per-person) tasks, and never touches a terminal status —
   * the completed transition is owned by completeTask / reopenTask. Rolls the open
   * status up to In Progress the moment anyone starts (or has finished their part),
   * otherwise leaves it at Not Started.
   */

  async assertGoalInOrg(
    orgId: string,
    goalId: string | null | undefined,
  ): Promise<void> {
    if (!goalId) return;
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, organization_id: orgId },
      select: { id: true },
    });
    if (!goal)
      throw new BadRequestException(
        'Linked goal not found in this organization',
      );
  }

  // ─── Create Task ──────────────────────────────────────────────────────────────

  /** status_id → phase type, for terminal checks while folding. */
  async statusTypeMap(orgId: string): Promise<Map<string, string>> {
    const statuses = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId },
      select: { id: true, type: true },
    });
    return new Map(statuses.map((s) => [s.id, s.type]));
  }

  completionTiming(
    completedAt: Date,
    deadline: Date | null | undefined,
  ): CompletionTiming {
    if (!deadline) return CompletionTiming.on_time;
    const day = (d: Date) =>
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const c = day(completedAt);
    const d = day(new Date(deadline));
    if (c < d) return CompletionTiming.early;
    if (c > d) return CompletionTiming.late;
    return CompletionTiming.on_time;
  }
}
