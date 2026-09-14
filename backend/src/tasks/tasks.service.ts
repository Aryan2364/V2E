import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChecklistItemState,
  CompletionMode,
  CompletionTiming,
  DataScope,
  PermissionAction,
  TaskActionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { HolidaysService } from '../holidays/holidays.service';
import { ProjectProgressService } from '../projects/project-progress.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { LeaveService } from '../leave/leave.service';
import { ClockService } from '../clock/clock.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { ScopeService } from '../access-rights/scope.service';
import { AccessVisibilityService } from '../access-rights/access-visibility.service';
import { Principal } from '../access-rights/permissions.service';
import { ChecklistAccessService } from '../task-masters/checklist-access.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { normaliseExtensions } from './task-attachments.service';
import { assertActiveOrgMembers } from '../common/org-members';
import { assertMastersUsable as assertMastersUsableShared } from '../common/task-masters-usable';
import { R2Service } from '../storage/r2.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { AddAssigneeDto } from './dto/add-assignee.dto';
import { TERMINAL_TYPES, isSuccessful, isTerminal } from './status-phase';
import { ACTIVE_ASSIGNEE, gradingDeadline } from './active-assignee';
import { resolveRemindAt, expandReminderRows } from '../common/reminders/reminder-spec';
import { ancestorChain, descendantIds } from '../holidays/dept-tree.util';
import { TasksAnalyticsService } from './tasks-analytics.service';

const TASK_INCLUDE = {
  status: true,
  priority: true,
  category: true,
  // The task's LIVE roster only. Taking someone off a task is a SOFT removal — the
  // TaskAssignee row is kept so compliance reporting can still show they held it (see
  // active-assignee.ts) — so every operational read flowing through this include must
  // see active participants only, or a removed person silently reappears in a
  // completion gate, an n/N count or a notification fan-out. The compliance reports
  // deliberately do NOT use this constant; they want the full historical roster.
  assignees: { where: ACTIVE_ASSIGNEE },
  checklist: { orderBy: { order_index: 'asc' as const } },
  escalations: true,
  reminders: true,
  // Glanceable counts for the task list — comments ("chats") and attachments,
  // filtered to exclude soft-deleted rows. Flows to every list/detail query.
  _count: {
    select: {
      comments: { where: { is_deleted: false } },
      attachments: { where: { is_deleted: false } },
    },
  },
};

/** Shared filter shape for list / paged / dashboard task queries. */
export interface TaskListFilters {
  status_id?: string;
  priority_id?: string;
  category_id?: string;
  department_id?: string;
  department_ids?: string; // comma-separated; a department subtree drill
  created_by_user_id?: string;
  quadrant?: string;
  type?: string;
  timing?: string; // early | on_time | late | overdue | pending
  assignee_user_id?: string;
  assignee_user_ids?: string; // comma-separated
  created_by_user_ids?: string; // comma-separated assigners
  assigner_person_dept_id?: string; // matrix drill: assigner's home dept (subtree) → creators
  assignee_person_dept_id?: string; // matrix drill: assignee's home dept (subtree) → assignees
  role_id?: string; // job-role drill — resolved to the assignees holding that role
  goal_id?: string;
  search?: string;
  from_date?: string;
  to_date?: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly holidaysService: HolidaysService,
    private readonly projectProgressService: ProjectProgressService,
    private readonly notifications: NotificationsService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly subjects: SubjectEligibilityService,
    private readonly scope: ScopeService,
    private readonly leave: LeaveService,
    private readonly clock: ClockService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly visibility: AccessVisibilityService,
    private readonly analytics: TasksAnalyticsService,
    private readonly r2: R2Service,
  ) {
    this.scope.registerWiredList(TasksService.TASK_LEAF);
    this.visibility.registerCounter(TasksService.TASK_LEAF, (orgId, userId) =>
      this.prisma.task.count({
        where: {
          organization_id: orgId,
          is_deleted: false,
          ...(this.visibility.whereForUser(TasksService.TASK_LEAF, userId) ?? {}),
        },
      }),
    );
  }

  /** The subject leaf governing "can be assigned a task". */
  private static readonly TASK_SUBJECT = 'tasks.subject.assignable';
  /** The content leaf governing task row-level scope. */
  private static readonly TASK_LEAF = 'tasks.task.manage';

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async checkTaskPermission(
    orgId: string,
    userId: string,
    field: 'task_creation_roles' | 'task_edit_roles' | 'task_delete_roles' | 'archive_view_roles',
  ) {
    const [config, member] = await Promise.all([
      this.getOrgConfig(orgId),
      this.prisma.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
        select: { is_admin: true },
      }),
    ]);
    if (!member) throw new ForbiddenException('Not a member of this organization');
    const allowedRoles = config[field] as string[];
    // MemberRole-collapse translation: an "employee"-inclusive config stays open to
    // every member; otherwise the action is restricted to platform admins.
    const allowed = Array.isArray(allowedRoles) && (allowedRoles.includes('employee') || member.is_admin);
    if (!allowed) {
      throw new ForbiddenException(`Your role is not permitted to perform this action`);
    }
  }

  /**
   * A task is a private record. Given its participants, allow a viewer only if they
   * are directly on it (creator, assignee, or CC) OR the task falls within their read
   * scope (team / department / org) over one of its core participants. Fails closed —
   * knowing a task's id must never be enough to read it or its comments/attachments.
   */
  private async assertParticipantView(
    orgId: string,
    principal: Principal,
    createdByUserId: string,
    assignees: { user_id: string; is_cc: boolean }[],
  ): Promise<void> {
    const onTask =
      createdByUserId === principal.userId ||
      assignees.some((a) => a.user_id === principal.userId);
    if (onTask) return;
    const coreParticipants = [
      createdByUserId,
      ...assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
    ];
    await this.scope.assertCanActOn(
      orgId,
      principal,
      TasksService.TASK_LEAF,
      PermissionAction.read,
      coreParticipants,
    );
  }

  /**
   * Guard for a task's sub-resources (comments, logs, attachments). External callers
   * pass their principal; internal callers pass none (already authorized upstream).
   */
  async assertCanViewTask(orgId: string, principal: Principal | undefined, taskId: string): Promise<void> {
    if (!principal) return;
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: {
        created_by_user_id: true,
        // Live roster: being taken off a task ends the access it granted. Someone
        // removed can still reach it only if their data scope covers it.
        assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_cc: true } },
      },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.assertParticipantView(orgId, principal, task.created_by_user_id, task.assignees);
  }

  private async getOrgConfig(orgId: string) {
    return this.prisma.taskMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
  }

  private async findTaskOrFail(orgId: string, taskId: string, isWrite = false) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    if (isWrite) {
      const now = await this.clock.now(orgId);
      if (task.created_at > now) {
        throw new ForbiddenException("This task was created in a simulated future. To interact with it, please time-travel to this date or later.");
      }
    }
    return task;
  }

  private async logActivity(
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
      this.logger.warn(`Activity log (${action}) failed for task ${taskId}: ${(err as Error).message}`);
      return null;
    }
  }

  private async enrichAssignees(assignees: { user_id: string; is_cc: boolean; is_completed: boolean; completed_at: Date | null; id: string }[]) {
    const userIds = assignees.map((a) => a.user_id);
    if (userIds.length === 0) return assignees.map((a) => ({ ...a, user: null }));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return assignees.map((a) => ({ ...a, user: userMap.get(a.user_id) ?? null }));
  }

  private async getDefaultStatusId(orgId: string): Promise<string> {
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
    if (!fallback) throw new BadRequestException('No task statuses configured for this organization');
    return fallback.id;
  }

  /** The three canonical open/terminal statuses an org keys its roll-up off. */
  private async getCanonicalStatuses(orgId: string) {
    const all = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    return {
      notStarted: all.find((s) => s.type === 'not_started') ?? all.find((s) => s.is_default) ?? all[0] ?? null,
      inProgress: all.find((s) => s.type === 'in_progress') ?? null,
      completed: all.find((s) => s.type === 'completed') ?? null,
      partiallyCompleted: all.find((s) => s.type === 'partially_completed') ?? null,
      incomplete: all.find((s) => s.type === 'incomplete') ?? null,
      all,
    };
  }

  private async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
      select: { is_admin: true },
    });
    return !!member?.is_admin;
  }

  /**
   * Rebuild a Principal for a userId-only code path so the scope toolkit can be
   * applied where only the actor's id was threaded through (legacy signatures).
   */
  private async principalFor(orgId: string, userId: string): Promise<Principal> {
    const [member, profile] = await Promise.all([
      this.prisma.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
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
  private async assertAssignerRights(orgId: string, actorId: string, task: any): Promise<void> {
    if (task.created_by_user_id === actorId) return;
    if (await this.isOrgAdmin(orgId, actorId)) return;
    await this.checkTaskPermission(orgId, actorId, 'task_edit_roles');
    const principal = await this.principalFor(orgId, actorId);
    await this.scope.assertCanActOn(orgId, principal, TasksService.TASK_LEAF, PermissionAction.edit, [
      task.created_by_user_id,
      ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
    ]);
  }

  /**
   * Master references (category / priority / department) must belong to THIS org
   * and be active — a pasted foreign, deleted or deactivated id must fail loud
   * with a clean 400, never store a cross-tenant reference or crash with a 500.
   */
  private async assertMastersUsable(
    orgId: string,
    refs: { category_id?: string | null; priority_id?: string | null; department_id?: string | null },
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
  private async assertAssigneesVisible(orgId: string, assignerId: string, userIds: string[]): Promise<void> {
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
  private async rollUpTaskOpenStatus(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      include: { status: true, assignees: true },
    });
    if (!task || task.completion_mode !== CompletionMode.all_must_complete) return;
    if (isTerminal(task.status.type)) return;

    const workers = task.assignees.filter((a) => !a.is_cc);
    const trackIds = [...new Set(workers.map((a) => a.status_id).filter((id): id is string => !!id))];
    const trackStatuses = trackIds.length
      ? await this.prisma.taskStatus.findMany({ where: { id: { in: trackIds } }, select: { id: true, type: true } })
      : [];
    const typeById = new Map(trackStatuses.map((s) => [s.id, s.type]));

    const anyStarted = workers.some(
      (a) => a.is_completed || (a.status_id != null && typeById.get(a.status_id) === 'in_progress'),
    );
    const { notStarted, inProgress } = await this.getCanonicalStatuses(orgId);
    const targetId = anyStarted ? inProgress?.id ?? notStarted?.id : notStarted?.id;
    if (targetId && targetId !== task.status_id) {
      await this.prisma.task.update({ where: { id: taskId }, data: { status_id: targetId } });
    }
  }

  /** Find the org's "Partially Completed" terminal status, creating it if missing (self-heal). */
  private async ensurePartialStatus(orgId: string) {
    const existing = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'partially_completed' },
    });
    if (existing) return existing;
    return this.prisma.taskStatus.create({
      data: {
        organization_id: orgId,
        label: 'Partially Completed',
        type: 'partially_completed',
        color: '#EA580C',
        order_index: 3,
        is_active: true,
      },
    });
  }

  /**
   * Decide and apply the terminal outcome of an all_must_complete task after its parts
   * change. While anyone is still working (hasn't completed AND hasn't flagged can't-
   * complete) the task stays open and we just refresh the roll-up. Once EVERY worker has
   * responded:
   *   - all finished          → Completed
   *   - a mix (some couldn't)  → Partially Completed
   *   - nobody finished        → Incomplete
   * Handles the status + completion stamps, notification, and workflow/project rollups.
   * Returns the outcome so callers can shape their own per-part activity trail.
   */
  private async settleAllMustComplete(
    orgId: string,
    taskId: string,
    actorId: string,
  ): Promise<'open' | 'completed' | 'partial' | 'incomplete'> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      include: { assignees: true, status: true },
    });
    if (!task || task.completion_mode !== CompletionMode.all_must_complete) return 'open';
    if (isTerminal(task.status.type)) return 'open';

    // Proof invariant: no extra proof check is needed here. Every `is_completed`
    // worker already passed the per-person proof gate in completeTask at the moment
    // they finished, and `cannot_complete` parts never require proof.
    const workers = task.assignees.filter((a) => !a.is_cc);
    const allResponded = workers.length > 0 && workers.every((a) => a.is_completed || a.cannot_complete);
    if (!allResponded) {
      await this.rollUpTaskOpenStatus(orgId, taskId);
      return 'open';
    }

    const completedCount = workers.filter((a) => a.is_completed).length;
    const cannotCount = workers.filter((a) => a.cannot_complete).length;
    const outcome: 'completed' | 'partial' | 'incomplete' =
      cannotCount === 0 ? 'completed' : completedCount === 0 ? 'incomplete' : 'partial';

    const { completed, incomplete } = await this.getCanonicalStatuses(orgId);
    const statusRow =
      outcome === 'completed' ? completed : outcome === 'incomplete' ? incomplete : await this.ensurePartialStatus(orgId);
    if (!statusRow) {
      await this.rollUpTaskOpenStatus(orgId, taskId);
      return 'open';
    }

    const config = await this.getOrgConfig(orgId);
    const now = new Date();
    const completionNow = await this.clock.now(orgId);
    const timing =
      outcome === 'completed'
        ? this.completionTiming(completionNow, gradingDeadline(task))
        : outcome === 'partial'
          ? CompletionTiming.partial
          : CompletionTiming.incomplete;
    const summary = outcome === 'completed' ? null : `${completedCount} of ${workers.length} completed; ${cannotCount} couldn’t.`;

    // Optimistic close: only settle if the status is still what we read above. When two
    // people finish at the same instant, exactly ONE settle wins — the loser skips the
    // duplicate notification and workflow/project advance instead of double-firing.
    const settled = await this.prisma.task.updateMany({
      where: { id: taskId, status_id: task.status_id },
      data: {
        status_id: statusRow.id,
        reopen_expires_at: new Date(now.getTime() + config.reopen_window_minutes * 60_000),
        completed_at: completionNow,
        completion_timing: timing,
        completed_by_user_id: actorId,
        ...(summary ? { incomplete_reason: summary } : {}),
        is_overdue: false,
        overdue_at: null,
      },
    });
    if (settled.count === 0) return 'open';

    if (outcome !== 'completed') {
      await this.logActivity(orgId, taskId, actorId, 'marked_incomplete', { auto: true, outcome, reason: summary });
    }

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: outcome === 'completed' ? 'task_completed' : 'task_incomplete',
      recipients: [task.created_by_user_id, ...workers.map((a) => a.user_id)].filter((uid) => uid !== actorId),
      title:
        outcome === 'completed'
          ? `${actorName} completed a task`
          : outcome === 'partial'
            ? 'A task was partially completed'
            : 'A task was marked incomplete',
      body: `“${task.title}”${summary ? `\n${summary}` : ''}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    if (outcome === 'completed' && task.workflow_instance_step_id) {
      await this.workflowEngine.handleStepCompleted(task.workflow_instance_step_id);
    }
    const projectTask = await this.prisma.projectTask.findFirst({ where: { task_id: taskId } });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(projectTask.project_id);
    }

    return outcome;
  }

  /**
   * Set one assignee's personal status track (all_must_complete mode). Actor may set
   * their OWN track; the creator / an editor may set anyone's. Open states only —
   * finishing a part goes through completeTask.
   */
  async setAssigneeStatus(orgId: string, actorId: string, taskId: string, targetUserId: string, statusId: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException('Per-person status only applies to "all must complete" tasks.');
    }
    // A closed task's scoreboard is a frozen record — a later personal-status change
    // must never clear someone's done flag underneath a Completed task.
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('This task is closed. Reopen it before changing anyone’s status.');
    }

    const isSelf = actorId === targetUserId;
    if (!isSelf) {
      await this.assertAssignerRights(orgId, actorId, task);
    } else {
      const onTask = (task.assignees ?? []).some((a: any) => a.user_id === actorId && !a.is_cc);
      if (!onTask) throw new ForbiddenException('Only someone on this task can change their status.');
    }

    const target = (task.assignees ?? []).find((a: any) => a.user_id === targetUserId && !a.is_cc);
    if (!target) throw new BadRequestException('That person is not a working assignee on this task.');

    const st = await this.prisma.taskStatus.findFirst({ where: { id: statusId, organization_id: orgId, is_active: true } });
    if (!st) throw new BadRequestException(`Status ${statusId} not found or inactive`);
    if (isTerminal(st.type)) {
      throw new BadRequestException('To finish a part, use Complete — the status control only moves between open states.');
    }

    const wasCompleted = target.is_completed;
    await this.prisma.taskAssignee.update({
      where: { id: target.id },
      // Moving a finished part back to an open state re-opens that person's part.
      data: { status_id: statusId, ...(wasCompleted ? { is_completed: false, completed_at: null } : {}) },
    });

    await this.rollUpTaskOpenStatus(orgId, taskId);

    const targetName = await this.notifications.userName(targetUserId);
    await this.logActivity(orgId, taskId, actorId, 'status_changed', {
      changes: [{ field: 'assignee_status', assignee: targetUserId, to: st.label }],
    });
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_status_changed',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
      ].filter((uid) => uid !== actorId),
      title: `${targetName}’s status is now ${st.label}`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    return this.getTask(orgId, taskId);
  }

  /**
   * all_must_complete: the assigner (creator/editor) reopens ONE person's finished part —
   * e.g. the work wasn't good enough — without disturbing the co-assignees who legitimately
   * finished. Bounces that person back to In Progress with an optional note. Works whether
   * the task is still open (others pending) or already closed: on a closed task it brings the
   * WHOLE task back to open (only that person reset), mirroring challengeChecklistItem, and
   * bypasses the reopen window (an assigner can always send a part back for rework).
   */
  async reopenAssigneePart(orgId: string, actorId: string, taskId: string, targetUserId: string, reason?: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException('Reopening one person’s part only applies to “all must complete” tasks.');
    }
    if (task.created_by_user_id !== actorId) {
      // An assignee may undo THEIR OWN finished part while the task is still open or
      // within the undo window — their undo must never reset co-assignees' finished
      // work (that whole-task hammer is reopenTask). Anything else is an assigner action.
      const isSelfUndo =
        actorId === targetUserId &&
        (!isTerminal((task as any).status?.type) ||
          (!!task.reopen_expires_at && task.reopen_expires_at > new Date()));
      if (!isSelfUndo) {
        await this.assertAssignerRights(orgId, actorId, task);
      }
    }
    const part = (task.assignees ?? []).find((a: any) => a.user_id === targetUserId && !a.is_cc);
    if (!part) throw new BadRequestException('That person is not a working assignee on this task.');
    // Reopenable when the part is finished either way: completed (rework), or closed as
    // can't-complete (reopen it so they can pick the work back up).
    if (!part.is_completed && !part.cannot_complete) {
      throw new BadRequestException('That person’s part isn’t finished, so there’s nothing to reopen.');
    }

    const trimmed = (reason ?? '').trim() || null;
    const { notStarted, inProgress } = await this.getCanonicalStatuses(orgId);
    const openStatusId = inProgress?.id ?? notStarted?.id ?? null;

    // Reopen ONLY that person's part — clear a completion AND any can't-complete flag
    // (keep their proof; they may just be refining it).
    await this.prisma.taskAssignee.updateMany({
      where: { task_id: taskId, user_id: targetUserId, is_cc: false, ...ACTIVE_ASSIGNEE },
      data: {
        is_completed: false,
        completed_at: null,
        cannot_complete: false,
        cannot_complete_reason: null,
        cannot_complete_at: null,
        status_id: openStatusId,
      },
    });

    // If the task had closed (everyone was done), bring it back to open WITHOUT resetting
    // the other assignees — they keep their completion.
    if (isTerminal((task as any).status?.type)) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status_id: openStatusId ?? task.status_id,
          completed_at: null,
          completion_timing: null,
          completed_by_user_id: null,
          incomplete_reason: null,
          reopen_expires_at: null,
          reopened_at: new Date(),
          is_overdue: false,
          overdue_at: null,
        },
      });
    }
    await this.rollUpTaskOpenStatus(orgId, taskId);

    await this.logActivity(orgId, taskId, actorId, 'reopened', {
      part: true,
      target_user_id: targetUserId,
      ...(trimmed ? { reason: trimmed } : {}),
    });

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_reopened',
      recipients: [targetUserId].filter((uid) => uid !== actorId),
      title: `${actorName} reopened your part`,
      body: trimmed ? `“${task.title}”\n${trimmed}` : `“${task.title}” — please revisit your part.`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.getTask(orgId, taskId);
  }

  /**
   * Move the single shared status (any_can_complete mode). Any working assignee — not
   * just the creator — may move it; the change applies to everyone and records who did it.
   */
  async setSharedStatus(orgId: string, actorId: string, taskId: string, statusId: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.any_can_complete) {
      throw new BadRequestException('Shared status only applies to "any can complete" tasks.');
    }

    const isParticipant =
      task.created_by_user_id === actorId ||
      (task.assignees ?? []).some((a: any) => a.user_id === actorId && !a.is_cc);
    if (!isParticipant) {
      await this.assertAssignerRights(orgId, actorId, task);
    }

    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('Reopen the task to change its status.');
    }
    const st = await this.prisma.taskStatus.findFirst({ where: { id: statusId, organization_id: orgId, is_active: true } });
    if (!st) throw new BadRequestException(`Status ${statusId} not found or inactive`);
    if (isTerminal(st.type)) {
      throw new BadRequestException('To close a task, use the Complete action — the status control only moves between open states.');
    }

    if (statusId !== task.status_id) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status_id: statusId, status_actor_user_id: actorId },
      });
      const actorName = await this.notifications.userName(actorId);
      await this.logActivity(orgId, taskId, actorId, 'status_changed', {
        changes: [{ field: 'status_id', from: task.status_id, to: statusId }],
      });
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_status_changed',
        recipients: [
          task.created_by_user_id,
          ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
        ].filter((uid) => uid !== actorId),
        title: `${actorName} moved a task to ${st.label}`,
        body: `“${task.title}”`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    return this.getTask(orgId, taskId);
  }

  /**
   * A linked goal must be a real goal in THIS org — otherwise a pasted foreign id
   * becomes a stored cross-tenant reference. Empty/undefined skips.
   */
  private async assertGoalInOrg(orgId: string, goalId: string | null | undefined): Promise<void> {
    if (!goalId) return;
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, organization_id: orgId },
      select: { id: true },
    });
    if (!goal) throw new BadRequestException('Linked goal not found in this organization');
  }

  // ─── Create Task ──────────────────────────────────────────────────────────────

  async createTask(orgId: string, userId: string, dto: CreateTaskDto) {
    await this.checkTaskPermission(orgId, userId, 'task_creation_roles');
    await this.assertGoalInOrg(orgId, dto.goal_id);
    await assertActiveOrgMembers(this.prisma, orgId, dto.escalation_user_ids, 'escalation contacts');
    // Subject eligibility (below) checks policy, not membership — gate that here.
    await assertActiveOrgMembers(
      this.prisma,
      orgId,
      [...(dto.assignee_user_ids ?? []), ...(dto.cc_user_ids ?? [])],
      'assignees or CC recipients',
    );
    const config = await this.getOrgConfig(orgId);

    // Master references must be this org's own, active rows (foreign/stale ids fail loud).
    await this.assertMastersUsable(orgId, dto);

    // Subject eligibility (fail loud, before any writes): every assignee must be
    // eligible to be assigned a task — even if they have no Tasks actor access.
    await this.subjects.assertAllEligible(orgId, TasksService.TASK_SUBJECT, dto.assignee_user_ids ?? []);

    // The picker's visibility rules re-checked at save time: the creator may only
    // put people they're allowed to assign to on the task (assignees AND CCs).
    await this.assertAssigneesVisible(orgId, userId, [
      ...(dto.assignee_user_ids ?? []),
      ...(dto.cc_user_ids ?? []),
    ]);

    // Checklist template access: the creator may only apply a template they're
    // allowed to use (by department / role / explicit grant). A task may now
    // combine several template-sourced checklists, so validate every applied id.
    const appliedTemplateIds = [
      ...(dto.checklist_template_id ? [dto.checklist_template_id] : []),
      ...(dto.checklist_template_ids ?? []),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx);
    for (const templateId of appliedTemplateIds) {
      const allowed = await this.checklistAccess.isAccessible(orgId, userId, templateId);
      if (!allowed) {
        throw new ForbiddenException('You are not allowed to use this checklist template.');
      }
    }

    // Resolve status. A task can never be BORN closed — terminal outcomes carry
    // business rules (proof, checklists, completion stamps) that only the dedicated
    // Complete / Mark Incomplete actions apply.
    let statusId = dto.status_id;
    if (statusId) {
      const st = await this.prisma.taskStatus.findFirst({
        where: { id: statusId, organization_id: orgId, is_active: true },
      });
      if (!st) throw new BadRequestException(`Status ${statusId} not found or inactive in this organization`);
      if (isTerminal(st.type)) {
        throw new BadRequestException('A task cannot start in a closed status. Create it open, then use Complete.');
      }
    } else {
      statusId = await this.getDefaultStatusId(orgId);
    }

    const task = await this.prisma.task.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        title: dto.title,
        description: dto.description,
        category_id: dto.category_id,
        priority_id: dto.priority_id,
        status_id: statusId,
        quadrant: dto.quadrant ?? 'Q2',
        type: dto.type ?? 'one_time',
        department_id: dto.department_id,
        completion_mode: dto.completion_mode ?? 'any_can_complete',
        proof_required: dto.proof_required ?? false,
        proof_allowed_extensions: normaliseExtensions(dto.proof_allowed_extensions),
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        // The date the task is FIRST committed to, frozen here and never rewritten by
        // an edit. Compliance reporting grades against this, so a later revision can
        // never turn a late task on-time retroactively.
        original_deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        goal_id: dto.goal_id,
      },
      include: TASK_INCLUDE,
    });

    // Holiday deadline adjustment (after create so we have task.id for audit log).
    // The system never FORCES the holiday rule on the user: when the creator has
    // explicitly chosen to keep a holiday date (holiday_override), it stands as-is.
    if (dto.deadline && !dto.holiday_override) {
      const rawDeadline = new Date(dto.deadline);
      const adjusted = await this.holidaysService.adjustDeadline(
        rawDeadline, orgId,
        dto.department_id, dto.assignee_user_ids?.[0],
        'task', task.id, task.title,
      );
      if (adjusted === null) {
        await this.prisma.task.delete({ where: { id: task.id } });
        throw new BadRequestException(
          'Deadline falls on a non-working day. Keep the date to override, or select a different one.',
        );
      }
      if (adjusted.getTime() !== rawDeadline.getTime()) {
        // The holiday-shifted date is the one the task is actually born with, so it —
        // not the raw picked date — becomes the frozen compliance baseline. Shifting
        // off a non-working day at birth is not a "revision".
        await this.prisma.task.update({
          where: { id: task.id },
          data: { deadline: adjusted, original_deadline: adjusted },
        });
        (task as any).deadline = adjusted;
        (task as any).original_deadline = adjusted;
      }
    }

    // Create assignees
    const assigneeIds = dto.assignee_user_ids ?? [];
    const ccIds = dto.cc_user_ids ?? [];

    if (assigneeIds.length === 0) {
      await this.prisma.task.delete({ where: { id: task.id } });
      throw new BadRequestException('At least one assignee is required. CC-only tasks are not allowed.');
    }

    if (assigneeIds.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data: assigneeIds.map((uid) => ({
          organization_id: orgId,
          task_id: task.id,
          user_id: uid,
          is_cc: false,
        })),
        skipDuplicates: true,
      });
    }

    if (ccIds.length > 0) {
      await this.prisma.taskAssignee.createMany({
        data: ccIds.map((uid) => ({
          organization_id: orgId,
          task_id: task.id,
          user_id: uid,
          is_cc: true,
        })),
        skipDuplicates: true,
      });
    }

    // Upsert frequency counts for non-CC assignees
    if (assigneeIds.length > 0) {
      await Promise.all(
        assigneeIds.map((assigneeUserId) =>
          this.prisma.taskAssigneeFrequency.upsert({
            where: {
              organization_id_assigner_user_id_assignee_user_id: {
                organization_id: orgId,
                assigner_user_id: userId,
                assignee_user_id: assigneeUserId,
              },
            },
            create: {
              organization_id: orgId,
              assigner_user_id: userId,
              assignee_user_id: assigneeUserId,
              frequency_count: 1,
              last_assigned_at: new Date(),
            },
            update: {
              frequency_count: { increment: 1 },
              last_assigned_at: new Date(),
            },
          }).catch(() => null), // ignore if constraint fails on race condition
        ),
      );
    }

    // Create checklist items
    if (dto.checklist_items && dto.checklist_items.length > 0) {
      await this.prisma.taskChecklist.createMany({
        data: dto.checklist_items.map((item) => ({
          organization_id: orgId,
          task_id: task.id,
          title: item.title,
          group_title: item.group_title ?? null,
          order_index: item.order_index,
        })),
      });
    }

    // Create escalation entries
    if (dto.escalation_user_ids && dto.escalation_user_ids.length > 0) {
      await this.prisma.taskEscalation.createMany({
        data: dto.escalation_user_ids.map((uid, idx) => ({
          organization_id: orgId,
          task_id: task.id,
          level: idx + 1,
          escalate_to_user_id: uid,
          is_active: true,
        })),
      });
    }

    // Reminders. When the creator supplies `reminders` (even an empty array), those
    // are authoritative; otherwise fall back to the single admin-default reminder.
    if (dto.reminders !== undefined) {
      const remindNow = await this.clock.now(orgId);
      const rows = dto.reminders.flatMap((spec) => {
        const at = resolveRemindAt(spec, task.deadline, remindNow);
        if (!at) return []; // past reminders are dropped by resolveRemindAt
        // Never schedule a (non-yearly) reminder after the deadline.
        if (!spec.yearly && task.deadline && at > task.deadline) return [];
        return expandReminderRows(spec, at).map((r) => ({ organization_id: orgId, task_id: task.id, ...r }));
      });
      if (rows.length > 0) await this.prisma.taskReminder.createMany({ data: rows });
    } else if (task.deadline) {
      // Legacy default: one assignee reminder `default_reminder_days_before` before the deadline.
      const remindAt = new Date(task.deadline);
      remindAt.setDate(remindAt.getDate() - config.default_reminder_days_before);
      if (remindAt > new Date()) {
        await this.prisma.taskReminder.create({
          data: {
            organization_id: orgId,
            task_id: task.id,
            remind_at: remindAt,
            type: 'assignee',
          },
        });
      }
    }

    // Log creation
    await this.logActivity(orgId, task.id, userId, 'created');

    // Notify assignees + CC (excluding the creator)
    const creatorName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_assigned',
      recipients: assigneeIds.filter((uid) => uid !== userId),
      title: `${creatorName} assigned you a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${task.id}`,
      entity: { type: 'task', id: task.id },
    });
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_assigned',
      recipients: ccIds.filter((uid) => uid !== userId),
      title: `${creatorName} CC’d you on a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${task.id}`,
      entity: { type: 'task', id: task.id },
    });

    return this.getTask(orgId, task.id);
  }

  // ─── List Tasks ───────────────────────────────────────────────────────────────

  async listTasks(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters,
  ) {
    // Row-level data scope (own/team/department/org) at the actor's full entitlement.
    const scopeWhere = await this.scope.listWhere(orgId, principal, TasksService.TASK_LEAF);
    const where = this.buildTaskWhere(orgId, scopeWhere, filters, 'deadline');

    const tasks = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });

    return this.enrichTaskList(tasks);
  }

  /**
   * Shared task `where` builder for list / paged / dashboard queries. `scopeWhere` is the
   * already-resolved row-scope fragment (AND'd so it never clobbers the search OR).
   * `dateField` chooses whether the from/to range filters by deadline (legacy list) or
   * created_at (dashboard "period" semantics).
   */
  private buildTaskWhere(
    orgId: string,
    scopeWhere: Record<string, unknown>,
    filters: TaskListFilters,
    dateField: 'deadline' | 'created_at' = 'created_at',
  ): any {
    const where: any = { organization_id: orgId, is_deleted: false };
    if (scopeWhere && Object.keys(scopeWhere).length) where.AND = [scopeWhere];

    if (filters.goal_id) where.goal_id = filters.goal_id;
    if (filters.status_id) where.status_id = filters.status_id;
    if (filters.priority_id) where.priority_id = filters.priority_id;
    if (filters.category_id) where.category_id = filters.category_id;
    if (filters.department_ids) {
      const ids = filters.department_ids.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) where.department_id = { in: ids };
    } else if (filters.department_id) {
      where.department_id = filters.department_id;
    }
    if (filters.created_by_user_ids) {
      const ids = filters.created_by_user_ids.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) where.created_by_user_id = { in: ids };
    } else if (filters.created_by_user_id) {
      where.created_by_user_id = filters.created_by_user_id;
    }
    if (filters.quadrant) where.quadrant = filters.quadrant as any;
    if (filters.type) where.type = filters.type as any;
    if (filters.timing) Object.assign(where, this.analytics.timingWhere(filters.timing as any));
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.from_date || filters.to_date) {
      const range: any = {};
      if (filters.from_date) range.gte = new Date(filters.from_date);
      if (filters.to_date) range.lte = new Date(filters.to_date);
      where[dateField] = range;
    }
    if (filters.assignee_user_ids) {
      const ids = filters.assignee_user_ids.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) where.assignees = { some: { user_id: { in: ids }, is_cc: false } };
    } else if (filters.assignee_user_id) {
      where.assignees = { some: { user_id: filters.assignee_user_id, is_cc: false } };
    }

    return where;
  }

  /** All user ids whose home department is `deptId` or any descendant of it. */
  private async deptMemberIds(orgId: string, deptId: string): Promise<string[]> {
    const depts = await this.prisma.department.findMany({ where: { organization_id: orgId }, select: { id: true, parent_department_id: true } });
    const ids = [deptId, ...descendantIds(depts, deptId)];
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId, department_id: { in: ids } }, select: { user_id: true },
    });
    return profiles.map((p) => p.user_id);
  }

  /**
   * Expand the person-relative drills (job role, assigner/assignee home department) into the
   * concrete user-id sets, since these live on the PERSON not the task. No-op when absent.
   * An empty resolution yields an impossible id so the slice is empty rather than unfiltered.
   */
  private async resolveFilters(orgId: string, filters: TaskListFilters): Promise<TaskListFilters> {
    if (!filters.role_id && !filters.assigner_person_dept_id && !filters.assignee_person_dept_id) return filters;
    const out: TaskListFilters = { ...filters };
    const orNone = (ids: string[]) => (ids.length ? ids : ['__none__']).join(',');

    if (filters.role_id) {
      const profiles = await this.prisma.employeeProfile.findMany({ where: { organization_id: orgId, role_id: filters.role_id }, select: { user_id: true } });
      out.assignee_user_ids = orNone(profiles.map((p) => p.user_id));
    }
    if (filters.assignee_person_dept_id) {
      out.assignee_user_ids = orNone(await this.deptMemberIds(orgId, filters.assignee_person_dept_id));
    }
    if (filters.assigner_person_dept_id) {
      out.created_by_user_ids = orNone(await this.deptMemberIds(orgId, filters.assigner_person_dept_id));
    }
    return out;
  }

  /**
   * Extra `where` fragment for a KPI "bucket" (overdue / due today / etc). Shared by the
   * dashboard counts and the paged list so a tile's number always matches the rows it opens.
   */
  private bucketWhere(bucket: string | undefined, now: Date): any {
    if (!bucket) return {};
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() - todayStart.getDay() + 7);
    const open = { status: { type: { notIn: TERMINAL_TYPES } } };
    switch (bucket) {
      case 'overdue': return { deadline: { lt: now }, ...open };
      case 'due_today': return { deadline: { gte: todayStart, lt: todayEnd }, ...open };
      case 'due_week': return { deadline: { gte: todayStart, lt: weekEnd }, ...open };
      case 'completed': return { status: { type: 'completed' } };
      case 'ongoing': return { status: { type: 'in_progress' } };
      case 'not_started': return { status: { type: 'not_started' } };
      case 'recurring': return { type: 'recurring' as any };
      default: return {};
    }
  }

  private taskOrderBy(sort?: string): any {
    switch (sort) {
      case 'deadline_asc': return [{ deadline: { sort: 'asc', nulls: 'last' } }];
      case 'deadline_desc': return [{ deadline: { sort: 'desc', nulls: 'last' } }];
      case 'created_asc': return { created_at: 'asc' };
      case 'updated_desc': return { updated_at: 'desc' };
      case 'created_desc':
      default: return { created_at: 'desc' };
    }
  }

  /**
   * Paginated task list for the Work dashboard's result surface. Scope is clamped to the
   * actor's entitlement (own/team/org switcher) and never widened past it. Returns a count
   * envelope so the client never loads the whole table — critical at org scale.
   */
  async listTasksPaged(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters,
    requestedScope?: DataScope | null,
    page = 1,
    pageSize = 25,
    sort = 'created_desc',
    bucket?: string,
  ) {
    const { effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, requestedScope);
    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    const now = await this.clock.now(orgId);
    filters = await this.resolveFilters(orgId, filters);
    const where = { ...this.buildTaskWhere(orgId, scopeWhere, filters, 'created_at'), ...this.bucketWhere(bucket, now) };

    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: this.taskOrderBy(sort), skip, take }),
      this.prisma.task.count({ where }),
    ]);

    return {
      items: await this.enrichTaskList(items),
      total,
      page: Math.max(page, 1),
      page_size: take,
      has_more: skip + items.length < total,
    };
  }

  /**
   * Scope-aware dashboard aggregation for the Work canvas. Computes KPI counts and
   * dimension breakdowns with count()/groupBy() (never a full-table load), sim-clock aware.
   * `applied_scope` / `max_scope` let the client render the Mine/My Team/Organization switcher.
   */
  async getDashboard(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters & { scope?: DataScope | null },
  ) {
    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, filters.scope);
    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    filters = { ...(await this.resolveFilters(orgId, filters)), scope: filters.scope };
    const where = this.buildTaskWhere(orgId, scopeWhere, filters, 'created_at');

    // Empty / denied scope → zeroed dashboard (never leak counts).
    if (effective === null) {
      return {
        applied_scope: null,
        max_scope: max,
        kpis: this.analytics.emptyKpis(),
        by_status: [], by_priority: [], by_category: [], by_department: [], by_type: [],
        by_assignee: [], by_assigner: [], by_role: [],
        by_timing: this.analytics.emptyTiming(), trend: [], trend_monthly: [],
      };
    }

    const now = await this.clock.now(orgId);

    const [kpis, dims, people, by_timing, trend, trend_monthly] = await Promise.all([
      this.analytics.kpiFor(orgId, where, now),
      this.analytics.dimensionBreakdowns(orgId, where),
      this.analytics.peopleDimensions(orgId, where),
      this.analytics.timingTotals(where),
      this.analytics.trendSeries(where, now),
      this.analytics.trendMonthlySeries(where, now),
    ]);

    return { applied_scope: effective, max_scope: max, kpis, ...dims, ...people, by_timing, trend, trend_monthly };
  }



  // ─── People tree (org-chart drill) ─────────────────────────────────────────────

  /**
   * Reporting tree of the people visible at `requestedScope`, each annotated with their
   * workload (as assignee: total/overdue/completed) and delegation count (as assigner),
   * computed over the tasks the VIEWER can see. The client assembles the tree from
   * `reporting_to_user_id` (a node whose parent isn't in the set is a root).
   */
  async getPeopleTree(
    orgId: string,
    principal: Principal,
    requestedScope: DataScope | null | undefined,
    filters: TaskListFilters,
  ) {
    const { effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, requestedScope);
    if (effective === null) return { nodes: [], root_user_id: principal.userId };

    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId, ...(visible === 'ALL' ? {} : { user_id: { in: visible } }) },
      select: {
        user_id: true,
        reporting_to_user_id: true,
        department: { select: { id: true, name: true } },
        role: { select: { title: true } },
      },
    });
    const userIds = profiles.map((p) => p.user_id);
    if (!userIds.length) return { nodes: [], root_user_id: principal.userId };

    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    const base = this.buildTaskWhere(orgId, scopeWhere, await this.resolveFilters(orgId, filters), 'created_at');
    const now = await this.clock.now(orgId);
    const openTask = { status: { type: { notIn: TERMINAL_TYPES } } };

    const [names, aTotal, aOverdue, aDone, asg, timingGroups] = await Promise.all([
      this.analytics.enrichUserNames(userIds),
      this.prisma.taskAssignee.groupBy({ by: ['user_id'], where: { is_cc: false, ...ACTIVE_ASSIGNEE, user_id: { in: userIds }, task: base }, _count: { _all: true } }),
      this.prisma.taskAssignee.groupBy({ by: ['user_id'], where: { is_cc: false, ...ACTIVE_ASSIGNEE, user_id: { in: userIds }, task: { ...base, deadline: { lt: now }, ...openTask } }, _count: { _all: true } }),
      this.prisma.taskAssignee.groupBy({ by: ['user_id'], where: { is_cc: false, ...ACTIVE_ASSIGNEE, user_id: { in: userIds }, task: { ...base, status: { type: 'completed' } } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['created_by_user_id'], where: { ...base, created_by_user_id: { in: userIds } }, _count: { _all: true } }),
      Promise.all(TasksAnalyticsService.TIMINGS.map((t) =>
        this.prisma.taskAssignee.groupBy({ by: ['user_id'], where: { is_cc: false, ...ACTIVE_ASSIGNEE, user_id: { in: userIds }, task: { ...base, ...this.analytics.timingWhere(t) } }, _count: { _all: true } }),
      )),
    ]);
    const cnt = (arr: any[], key: string) => new Map(arr.map((g) => [g[key], g._count._all]));
    const totM = cnt(aTotal, 'user_id'), ovM = cnt(aOverdue, 'user_id'), dnM = cnt(aDone, 'user_id'), asgM = cnt(asg, 'created_by_user_id');
    // user_id → assignee timing sub-counts (for the People-lens MiniBars; rolled up client-side).
    const timingM = new Map<string, ReturnType<TasksAnalyticsService['emptyTiming']>>();
    TasksAnalyticsService.TIMINGS.forEach((t, i) => {
      for (const g of timingGroups[i]) {
        let e = timingM.get(g.user_id);
        if (!e) { e = this.analytics.emptyTiming(); timingM.set(g.user_id, e); }
        e[t] += g._count._all;
      }
    });

    const nodes = profiles.map((p) => ({
      user_id: p.user_id,
      name: names.get(p.user_id)?.name ?? 'Unknown',
      role_title: p.role?.title ?? null,
      department_name: p.department?.name ?? null,
      reporting_to_user_id: p.reporting_to_user_id,
      assignee: { total: totM.get(p.user_id) ?? 0, overdue: ovM.get(p.user_id) ?? 0, completed: dnM.get(p.user_id) ?? 0 },
      assignee_timing: timingM.get(p.user_id) ?? this.analytics.emptyTiming(),
      assigned_count: asgM.get(p.user_id) ?? 0,
    }));
    return { nodes, root_user_id: principal.userId };
  }

  // ─── Employee work report (drill target) ───────────────────────────────────────

  /**
   * Per-employee work report, gated by the viewer's scope (403 if the target is outside
   * the viewer's visible set). Returns the employee's KPIs both as assignee ("their work")
   * and as assigner ("what they delegated"), over tasks the viewer can see.
   */
  async getEmployeeReport(orgId: string, principal: Principal, targetUserId: string, filters: TaskListFilters) {
    const { effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, undefined);
    if (effective === null) throw new ForbiddenException('You do not have access to task data');
    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    if (visible !== 'ALL' && !visible.includes(targetUserId)) {
      throw new ForbiddenException('This employee is outside your visibility scope');
    }

    const [user, profile] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, email: true } }),
      this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: targetUserId },
        select: { department: { select: { name: true } }, role: { select: { title: true } } },
      }),
    ]);
    if (!user) throw new NotFoundException('Employee not found');

    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    const base = this.buildTaskWhere(orgId, scopeWhere, filters, 'created_at');
    const now = await this.clock.now(orgId);
    const asAssignee = { ...base, assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: targetUserId, is_cc: false } } };
    const asAssigner = { ...base, created_by_user_id: targetUserId };

    const [assigneeKpis, assignerKpis, assigneeDims] = await Promise.all([
      this.analytics.kpiFor(orgId, asAssignee, now),
      this.analytics.kpiFor(orgId, asAssigner, now),
      this.analytics.dimensionBreakdowns(orgId, asAssignee),
    ]);

    return {
      employee: { id: user.id, name: user.name, email: user.email, role_title: profile?.role?.title ?? null, department_name: profile?.department?.name ?? null },
      as_assignee: assigneeKpis,
      as_assigner: assignerKpis,
      assignee_breakdowns: assigneeDims,
    };
  }

  // ─── Work flow (assigner → assignee source relationship) ───────────────────────

  private emptySourceItem(id: string, label: string) {
    return { id, label, total: 0, timing: this.analytics.emptyTiming() };
  }

  /**
   * Scope-aware "where work comes from" analytics. Classifies each (task, non-cc assignee)
   * pair by the relationship between the ASSIGNER's department and the ASSIGNEE's department:
   *   Immediate   = same department (leaf)
   *   Same dept   = same top-level department, different sub-department
   *   External    = a different top-level department
   * Returns the source breakdown, a giving×receiving department matrix (org), and — for
   * team/department scope — incoming-by-source, who's loading the team from outside, what the
   * team pushed outside, and a delegation summary. One bounded `findMany`, folded in JS.
   *
   * Flag: departments come from the PEOPLE (EmployeeProfile), not `task.department_id`; a
   * multi-assignee task contributes one classified pair per assignee (workload semantics).
   */
  async getWorkFlow(orgId: string, principal: Principal, filters: TaskListFilters & { scope?: DataScope | null }) {
    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, filters.scope);
    const empty = {
      applied_scope: null as DataScope | null, max_scope: max,
      by_source: [] as any[], matrix: { depts: [] as any[], rows: [] as any[] },
      incoming_by_source: [] as any[], external_by_dept: [] as any[],
      outgoing: { by_dept: [] as any[], overdue: 0 }, delegated: { total: 0, open: 0, overdue: 0, timing: this.analytics.emptyTiming() },
    };
    if (effective === null) return empty;

    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    const where = this.buildTaskWhere(orgId, scopeWhere, await this.resolveFilters(orgId, filters), 'created_at');

    // Department maps: each dept → its top-level root; names for labels.
    const depts = await this.prisma.department.findMany({
      where: { organization_id: orgId },
      select: { id: true, name: true, color: true, parent_department_id: true },
    });
    const rootOf = new Map<string, string>();
    for (const d of depts) { const chain = ancestorChain(depts, d.id); rootOf.set(d.id, chain[0] ?? d.id); }
    const deptInfo = new Map(depts.map((d) => [d.id, d]));
    const topDepts = depts.filter((d) => !d.parent_department_id);

    // user → department.
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId }, select: { user_id: true, department_id: true },
    });
    const userDept = new Map(profiles.map((p) => [p.user_id, p.department_id]));

    // The viewer's set ("my team"/own/dept) for relative classification; 'ALL' at org.
    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const mySet: Set<string> | null = visible === 'ALL' ? null : new Set(visible);
    const viewerRoot = (() => { const d = userDept.get(principal.userId); return d ? rootOf.get(d) ?? null : null; })();

    // Scoped tasks with assigner + non-cc assignees + timing fields.
    const CAP = 8000;
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        created_by_user_id: true, completion_timing: true, is_overdue: true, status_id: true,
        assignees: { where: { is_cc: false, ...ACTIVE_ASSIGNEE }, select: { user_id: true } },
      },
      take: CAP,
    });
    if (tasks.length === CAP) this.logTruncation?.(orgId, CAP);

    const statusType = await this.statusTypeMap(orgId);

    // ── Fold ──────────────────────────────────────────────────────────────────────
    const REL = ['immediate', 'same_dept', 'external'] as const;
    const REL_LABEL: Record<(typeof REL)[number], string> = { immediate: 'Immediate (same dept)', same_dept: 'Same department', external: 'External (other dept)' };
    const bySource = Object.fromEntries(REL.map((r) => [r, this.emptySourceItem(r, REL_LABEL[r])])) as Record<(typeof REL)[number], ReturnType<TasksService['emptySourceItem']>>;
    const matrix = new Map<string, Map<string, number>>();
    const INC = ['within', 'same_dept', 'external'] as const;
    const INC_LABEL: Record<(typeof INC)[number], string> = { within: 'Within team', same_dept: 'Same department', external: 'External' };
    const incoming = Object.fromEntries(INC.map((r) => [r, this.emptySourceItem(r, INC_LABEL[r])])) as Record<(typeof INC)[number], ReturnType<TasksService['emptySourceItem']>>;
    const externalByDept = new Map<string, ReturnType<TasksService['emptySourceItem']>>();
    const outgoingByDept = new Map<string, ReturnType<TasksService['emptySourceItem']>>();
    let outgoingOverdue = 0;
    const delegated = { total: 0, open: 0, overdue: 0, timing: this.analytics.emptyTiming() };

    const relOf = (aDept: string | null | undefined, bDept: string | null | undefined): (typeof REL)[number] => {
      if (!aDept || !bDept) return 'external';
      if (aDept === bDept) return 'immediate';
      return rootOf.get(aDept) === rootOf.get(bDept) ? 'same_dept' : 'external';
    };

    for (const t of tasks) {
      const timing = this.analytics.timingOf(t.completion_timing, t.is_overdue);
      const assignerDept = userDept.get(t.created_by_user_id);
      const assignerRoot = assignerDept ? rootOf.get(assignerDept) : undefined;
      const assignerInSet = mySet ? mySet.has(t.created_by_user_id) : true;

      // Delegation (task-grain): tasks this set handed out.
      if (assignerInSet && mySet) {
        delegated.total++;
        delegated.timing[timing]++;
        const term = isTerminal(statusType.get(t.status_id) ?? null);
        if (!term) delegated.open++;
        if (timing === 'overdue') delegated.overdue++;
      }

      let pushedOutside = false;
      for (const a of t.assignees) {
        const assigneeDept = userDept.get(a.user_id);
        const assigneeRoot = assigneeDept ? rootOf.get(assigneeDept) : undefined;

        // Source breakdown (absolute, assignee-perspective).
        bySource[relOf(assignerDept, assigneeDept)].timing[timing]++;
        bySource[relOf(assignerDept, assigneeDept)].total++;

        // Matrix (giving root → receiving root).
        if (assignerRoot && assigneeRoot) {
          if (!matrix.has(assignerRoot)) matrix.set(assignerRoot, new Map());
          const row = matrix.get(assignerRoot)!;
          row.set(assigneeRoot, (row.get(assigneeRoot) ?? 0) + 1);
        }

        if (mySet) {
          const assigneeInSet = mySet.has(a.user_id);
          // Incoming to my set, classified by who gave it.
          if (assigneeInSet) {
            const rel = assignerInSet ? 'within' : assignerRoot && assignerRoot === viewerRoot ? 'same_dept' : 'external';
            incoming[rel].total++; incoming[rel].timing[timing]++;
            if (rel === 'external' && assignerRoot) {
              const e = externalByDept.get(assignerRoot) ?? this.emptySourceItem(assignerRoot, deptInfo.get(assignerRoot)?.name ?? 'Unknown');
              e.total++; e.timing[timing]++; externalByDept.set(assignerRoot, e);
            }
          }
          // Outgoing: my set assigned OUT to someone not in my set.
          if (assignerInSet && !assigneeInSet && assigneeRoot) {
            const o = outgoingByDept.get(assigneeRoot) ?? this.emptySourceItem(assigneeRoot, deptInfo.get(assigneeRoot)?.name ?? 'Unknown');
            o.total++; o.timing[timing]++; outgoingByDept.set(assigneeRoot, o);
            pushedOutside = true;
          }
        }
      }
      if (pushedOutside && timing === 'overdue') outgoingOverdue++;
    }

    return {
      applied_scope: effective,
      max_scope: max,
      by_source: REL.map((r) => bySource[r]).filter((s) => s.total > 0),
      matrix: {
        depts: topDepts.map((d) => ({ id: d.id, name: d.name, color: d.color })),
        rows: topDepts.map((from) => ({
          from: from.id,
          cells: topDepts.map((to) => matrix.get(from.id)?.get(to.id) ?? 0),
        })),
      },
      incoming_by_source: INC.map((r) => incoming[r]).filter((s) => s.total > 0),
      external_by_dept: [...externalByDept.values()].sort((a, b) => b.total - a.total),
      outgoing: { by_dept: [...outgoingByDept.values()].sort((a, b) => b.total - a.total), overdue: outgoingOverdue },
      delegated,
    };
  }

  /** status_id → phase type, for terminal checks while folding. */
  private async statusTypeMap(orgId: string): Promise<Map<string, string>> {
    const statuses = await this.prisma.taskStatus.findMany({ where: { organization_id: orgId }, select: { id: true, type: true } });
    return new Map(statuses.map((s) => [s.id, s.type]));
  }

  private logTruncation(orgId: string, cap: number) {
    // eslint-disable-next-line no-console
    console.warn(`[tasks/flow] org ${orgId}: work-flow sample capped at ${cap} tasks; some cross-dept counts may be partial.`);
  }

  // ─── Bulk actions ──────────────────────────────────────────────────────────────

  /**
   * Bulk status / deadline / complete over the subset of `taskIds` the actor may EDIT.
   * The bulk tool obeys every rule the single-task actions enforce — read visibility is
   * not edit rights, terminal states can't be hand-set or silently dragged back open,
   * and "complete" routes through the real completion engine (proof, checklists,
   * per-person scoreboards, notifications, the undo window). Tasks that fail a rule are
   * skipped and reported, never force-updated.
   */
  async bulkUpdate(
    orgId: string,
    principal: Principal,
    taskIds: string[],
    action: 'status' | 'deadline' | 'complete',
    payload: { status_id?: string; deadline?: string | null },
  ) {
    const skipped: { id: string; title: string; reason: string }[] = [];
    if (!taskIds?.length) return { updated: 0, skipped };

    // Read visibility bounds the candidate set…
    const scopeWhere = await this.scope.listWhere(orgId, principal, TasksService.TASK_LEAF);
    const candidates = await this.prisma.task.findMany({
      where: { organization_id: orgId, is_deleted: false, id: { in: taskIds }, ...(Object.keys(scopeWhere).length ? { AND: [scopeWhere] } : {}) },
      select: {
        id: true,
        title: true,
        created_by_user_id: true,
        completion_mode: true,
        // Needed by the deadline branch: a bulk move is a real revision and has to
        // freeze/keep the compliance baseline like any single edit.
        deadline: true,
        original_deadline: true,
        status: { select: { type: true } },
        assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_cc: true } },
      },
    });
    if (!candidates.length) return { updated: 0, skipped };

    // …then each task needs EDIT rights: participants act on their own tasks; anyone
    // else must hold edit scope over the task's core participants.
    const editable: typeof candidates = [];
    for (const t of candidates) {
      const onTask =
        t.created_by_user_id === principal.userId ||
        t.assignees.some((a) => a.user_id === principal.userId && !a.is_cc);
      if (onTask || principal.isAdmin) {
        editable.push(t);
        continue;
      }
      try {
        await this.scope.assertCanActOn(orgId, principal, TasksService.TASK_LEAF, PermissionAction.edit, [
          t.created_by_user_id,
          ...t.assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
        ]);
        editable.push(t);
      } catch {
        skipped.push({ id: t.id, title: t.title, reason: 'You do not have edit access to this task.' });
      }
    }

    if (action === 'status') {
      if (!payload.status_id) throw new BadRequestException('Status is required');
      const st = await this.prisma.taskStatus.findFirst({
        where: { id: payload.status_id, organization_id: orgId, is_active: true },
      });
      if (!st) throw new BadRequestException('Status not found or inactive');
      // Terminal outcomes carry business rules (proof, checklists, the undo window) —
      // they can never be hand-set, not even in bulk. Use the Complete action.
      if (isTerminal(st.type)) {
        throw new BadRequestException('Closed statuses can’t be set by hand — use the Complete or Mark Incomplete action.');
      }
      const ids: string[] = [];
      for (const t of editable) {
        if (isTerminal(t.status?.type)) {
          skipped.push({ id: t.id, title: t.title, reason: 'Closed — reopen it before changing its status.' });
        } else if (t.completion_mode === CompletionMode.all_must_complete) {
          skipped.push({ id: t.id, title: t.title, reason: 'Tracks per-person statuses — set them on the task itself.' });
        } else {
          ids.push(t.id);
        }
      }
      if (ids.length) {
        await this.prisma.task.updateMany({
          where: { id: { in: ids } },
          data: { status_id: payload.status_id, status_actor_user_id: principal.userId },
        });
        await Promise.all(ids.map((id) => this.logActivity(orgId, id, principal.userId, 'status_changed', { bulk: true }).catch(() => null)));
      }
      return { updated: ids.length, skipped };
    }

    if (action === 'deadline') {
      const newDeadline = payload.deadline ? new Date(payload.deadline) : null;
      const ids: string[] = [];
      for (const t of editable) {
        if (isTerminal(t.status?.type)) {
          skipped.push({ id: t.id, title: t.title, reason: 'Closed — its deadline is part of the record.' });
        } else {
          ids.push(t.id);
        }
      }
      if (ids.length) {
        // Keep the persisted overdue flag in sync with the new deadline (the sweep
        // re-flags if it lapses again). Holiday adjustment is not forced here — a
        // bulk deadline is an explicit, deliberate user choice.
        const stillOverdue = !!newDeadline && newDeadline < new Date();
        const byId = new Map(editable.map((t) => [t.id, t]));

        // A bulk move gets exactly the same treatment as a single edit. Without this
        // it was the loophole that made the whole baseline pointless: select fifty
        // tasks, push the date, and every scorecard comes up clean.
        const revising = ids.filter((id) => byId.get(id)!.deadline !== null);
        const firstTime = ids.filter((id) => byId.get(id)!.deadline === null);

        // Tasks getting their FIRST deadline: this IS the baseline, not a revision.
        if (firstTime.length) {
          await this.prisma.task.updateMany({
            where: { id: { in: firstTime } },
            data: {
              deadline: newDeadline,
              original_deadline: newDeadline,
              is_overdue: stillOverdue,
              overdue_at: stillOverdue ? new Date() : null,
            },
          });
        }

        // Genuine revisions: the live date moves, the baseline stands, counter ticks.
        if (revising.length) {
          await this.prisma.task.updateMany({
            where: { id: { in: revising } },
            data: {
              deadline: newDeadline,
              is_overdue: stillOverdue,
              overdue_at: stillOverdue ? new Date() : null,
              deadline_revision_count: { increment: 1 },
            },
          });
          // Defensive: freeze a baseline for any row predating the column (the
          // migration backfilled every task, so this should never fire).
          await Promise.all(
            revising
              .filter((id) => byId.get(id)!.original_deadline === null)
              .map((id) =>
                this.prisma.task
                  .update({ where: { id }, data: { original_deadline: byId.get(id)!.deadline } })
                  .catch(() => null),
              ),
          );
          await this.prisma.taskDeadlineRevision.createMany({
            data: revising.map((id) => ({
              organization_id: orgId,
              task_id: id,
              from_deadline: byId.get(id)!.deadline,
              to_deadline: newDeadline,
              reason: 'Changed in a bulk update',
              changed_by_user_id: principal.userId,
            })),
          });
        }

        // Relative reminders were derived from the OLD dates — re-hang them, or they
        // fire after the deadline they were meant to pre-empt (or never fire).
        for (const id of ids) {
          await this.recomputeRemindersForDeadline(orgId, id, newDeadline).catch(() => null);
        }

        await Promise.all(ids.map((id) => this.logActivity(orgId, id, principal.userId, 'edited', { bulk: true, field: 'deadline' }).catch(() => null)));

        // Tell the people who have to hit these dates. Same event as a single edit,
        // so an org that finds it noisy can switch it off in one place.
        const actorName = await this.notifications.userName(principal.userId);
        const fmt = (d: Date | null) =>
          d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no deadline';
        for (const id of ids) {
          const t = byId.get(id)!;
          const recipients = [t.created_by_user_id, ...t.assignees.map((a) => a.user_id)].filter(
            (uid) => uid !== principal.userId,
          );
          if (!recipients.length) continue;
          await this.notifications
            .emit({
              orgId,
              module: 'tasks',
              event_type: 'task_deadline_changed',
              recipients,
              title: `${actorName} changed a task deadline`,
              body: `“${t.title}”\n${fmt(t.deadline)} → ${fmt(newDeadline)}`,
              link: `/dashboard/tasks/${id}`,
              entity: { type: 'task', id },
            })
            .catch(() => null);
        }
      }
      return { updated: ids.length, skipped };
    }

    if (action === 'complete') {
      // Route every task through the REAL completion engine so nothing is skipped:
      // proof gates, checklist gates, per-person scoreboards, terminal guards,
      // notifications and the undo window all apply. all_must tasks are closed via
      // the owner override (creator/admin only); an assignee completes their own part.
      let updated = 0;
      for (const t of editable) {
        try {
          const isOwner = t.created_by_user_id === principal.userId || principal.isAdmin;
          if (t.completion_mode === CompletionMode.all_must_complete && isOwner) {
            await this.completeTask(orgId, principal.userId, t.id, undefined, true);
          } else {
            await this.completeTask(orgId, principal.userId, t.id);
          }
          updated++;
        } catch (err) {
          skipped.push({ id: t.id, title: t.title, reason: (err as Error).message ?? 'Could not be completed.' });
        }
      }
      return { updated, skipped };
    }

    throw new BadRequestException('Unknown bulk action');
  }

  // ─── CSV export ────────────────────────────────────────────────────────────────

  /** Scope + filter aware CSV of the current view (capped). Returned as a JSON string field. */
  async exportCsv(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters,
    requestedScope?: DataScope | null,
    bucket?: string,
  ) {
    const { effective } = await this.scope.resolveListScope(orgId, principal, TasksService.TASK_LEAF, requestedScope);
    const scopeWhere = await this.scope.whereForScope(orgId, principal.userId, TasksService.TASK_LEAF, effective);
    const now = await this.clock.now(orgId);
    filters = await this.resolveFilters(orgId, filters);
    const where = { ...this.buildTaskWhere(orgId, scopeWhere, filters, 'created_at'), ...this.bucketWhere(bucket, now) };
    const tasks = await this.prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: this.taskOrderBy('created_desc'), take: 5000 });
    const enriched = await this.enrichTaskList(tasks);

    const headers = ['Title', 'Status', 'Priority', 'Category', 'Type', 'Assigned By', 'Assignees', 'Deadline', 'Created'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const t of enriched as any[]) {
      lines.push([
        t.title,
        t.status?.label ?? '',
        t.priority?.label ?? '',
        t.category?.name ?? '',
        t.type,
        t.created_by?.name ?? '',
        (t.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user?.name).filter(Boolean).join('; '),
        t.deadline ? new Date(t.deadline).toISOString() : '',
        new Date(t.created_at).toISOString(),
      ].map(esc).join(','));
    }
    return { csv: lines.join('\n'), count: enriched.length };
  }

  async getMyTasks(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: userId, is_cc: false } },
      },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.enrichTaskList(tasks, userId);
  }

  async getMyCCTasks(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: userId, is_cc: true } },
      },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.enrichTaskList(tasks, userId);
  }

  async getTasksAssignedByMe(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { organization_id: orgId, is_deleted: false, created_by_user_id: userId },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.enrichTaskList(tasks, userId);
  }

  async getEscalatedTasks(orgId: string, userId: string) {
    const escalations = await this.prisma.taskEscalation.findMany({
      where: { organization_id: orgId, escalate_to_user_id: userId, is_active: true, escalated_at: { not: null } },
      select: { task_id: true },
    });
    const taskIds = escalations.map((e) => e.task_id);
    if (taskIds.length === 0) return [];

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, is_deleted: false },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.enrichTaskList(tasks, userId);
  }

  /**
   * Compute, per task, how many comments the viewer hasn't seen yet: comments
   * created after the viewer last opened the task (or ever, if never opened),
   * excluding the viewer's own comments and soft-deleted ones. Returns a map of
   * task_id → unread count. No-op (empty map) when there's no viewer.
   */
  private async computeUnreadComments(viewerId: string, taskIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!viewerId || taskIds.length === 0) return result;
    const [views, comments] = await Promise.all([
      this.prisma.taskView.findMany({
        where: { user_id: viewerId, task_id: { in: taskIds } },
        select: { task_id: true, last_viewed_at: true },
      }),
      // Only other people's live comments matter for "unread". Bounded to the
      // viewer's visible task list, so pulling timestamps is cheap.
      this.prisma.taskComment.findMany({
        where: { task_id: { in: taskIds }, is_deleted: false, user_id: { not: viewerId } },
        select: { task_id: true, created_at: true },
      }),
    ]);
    const lastViewed = new Map(views.map((v) => [v.task_id, v.last_viewed_at.getTime()]));
    for (const c of comments) {
      const seenAt = lastViewed.get(c.task_id) ?? 0; // never opened → everything is unread
      if (c.created_at.getTime() > seenAt) {
        result.set(c.task_id, (result.get(c.task_id) ?? 0) + 1);
      }
    }
    return result;
  }

  private async enrichTaskList(tasks: any[], viewerId?: string) {
    const allUserIds = new Set<string>();
    const allOrgIds = new Set<string>();
    for (const task of tasks) {
      task.organization_id && allOrgIds.add(task.organization_id);
      task.created_by_user_id && allUserIds.add(task.created_by_user_id);
      for (const a of task.assignees ?? []) allUserIds.add(a.user_id);
    }
    const userIds = Array.from(allUserIds);
    const unreadMap = viewerId
      ? await this.computeUnreadComments(viewerId, tasks.map((t) => t.id))
      : new Map<string, number>();
    // Profiles are per-org, so key them by org+user (collective view spans orgs).
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.employeeProfile.findMany({
        where: { organization_id: { in: Array.from(allOrgIds) }, user_id: { in: userIds } },
        select: {
          organization_id: true,
          user_id: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(profiles.map((p) => [`${p.organization_id}:${p.user_id}`, p]));

    return tasks.map((task) => ({
      ...task,
      created_by: userMap.get(task.created_by_user_id) ?? null,
      unread_comments: unreadMap.get(task.id) ?? 0,
      assignees: (task.assignees ?? []).map((a: any) => {
        const u = userMap.get(a.user_id);
        const p = profileMap.get(`${task.organization_id}:${a.user_id}`);
        return {
          ...a,
          user: u
            ? { ...u, department: p?.department?.name ?? null, role_title: p?.role?.title ?? null }
            : null,
        };
      }),
    }));
  }

  /**
   * Map of taskId → whether the task is in a "completed"-type status.
   * Used by other modules (e.g. Meetings action items) to compute done-ness.
   */
  async areCompleted(orgId: string, taskIds: string[]): Promise<Record<string, boolean>> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (!ids.length) return {};
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: ids }, organization_id: orgId, is_deleted: false },
      select: { id: true, status: { select: { type: true } } },
    });
    const map: Record<string, boolean> = {};
    for (const t of tasks) map[t.id] = t.status?.type === 'completed';
    return map;
  }

  // ─── Get Single Task ──────────────────────────────────────────────────────────

  async getTask(orgId: string, taskId: string, principal?: Principal) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      include: {
        ...TASK_INCLUDE,
        activity_logs: { orderBy: { created_at: 'desc' } },
        // The deadline paper trail, newest first. `Task.original_deadline` is the date
        // the compliance reports grade against; this explains how the live `deadline`
        // drifted from it, so the detail screen can show "revised 2×" and by whom.
        deadline_revisions: { orderBy: { changed_at: 'desc' } },
        comments: {
          where: { is_deleted: false, reply_to_comment_id: null },
          include: { replies: { where: { is_deleted: false } } },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);

    // Authorization (external callers only — internal post-mutation reads pass no
    // principal). Reuses the already-fetched participants to avoid a second query.
    if (principal) {
      await this.assertParticipantView(orgId, principal, task.created_by_user_id, task.assignees);

      // Opening the task marks it read for this user — clears its unread-comment badge.
      // Use the org clock so it lines up with comment timestamps on a test org.
      const viewedAt = await this.clock.now(orgId);
      await this.prisma.taskView.upsert({
        where: { task_id_user_id: { task_id: taskId, user_id: principal.userId } },
        create: { organization_id: orgId, task_id: taskId, user_id: principal.userId, last_viewed_at: viewedAt },
        update: { last_viewed_at: viewedAt },
      });
    }

    // People taken OFF this task. Deliberately fetched apart from the live roster —
    // `TASK_INCLUDE` filters them out so no gate, count or notification can pick them
    // up by accident — but they belong on the screen: "Removed on 7 Sep by X" is the
    // record that stops a removal from quietly erasing what someone did here.
    const removedAssignees = await this.prisma.taskAssignee.findMany({
      where: { task_id: taskId, organization_id: orgId, removed_at: { not: null } },
      orderBy: { removed_at: 'desc' },
    });

    const allUserIds = new Set<string>();
    allUserIds.add(task.created_by_user_id);
    if (task.completed_by_user_id) allUserIds.add(task.completed_by_user_id);
    if (task.status_actor_user_id) allUserIds.add(task.status_actor_user_id);
    for (const a of task.assignees) allUserIds.add(a.user_id);
    for (const a of removedAssignees) {
      allUserIds.add(a.user_id);
      if (a.removed_by_user_id) allUserIds.add(a.removed_by_user_id);
    }
    for (const r of (task as any).deadline_revisions ?? []) allUserIds.add(r.changed_by_user_id);
    for (const c of task.comments as any[]) {
      allUserIds.add(c.user_id);
      for (const r of c.replies ?? []) allUserIds.add(r.user_id);
    }

    // Per-person checklist states (all_must_complete). Fetched here so their actors
    // are resolved to names in the same batch as everyone else.
    // Scoped to the LIVE roster. A person taken off the task keeps their state rows
    // (that's the point of a soft removal), but counting them here while the "n/N"
    // denominator below counts only current workers is how the badge ends up reading
    // an impossible 3/2.
    const liveWorkerIds = task.assignees.filter((a) => !a.is_cc).map((a) => a.user_id);
    const checklistIds = task.checklist.map((c: any) => c.id);
    const checklistStates =
      checklistIds.length && liveWorkerIds.length
        ? await this.prisma.taskChecklistItemState.findMany({
            where: { task_id: taskId, user_id: { in: liveWorkerIds } },
          })
        : [];
    for (const s of checklistStates) {
      allUserIds.add(s.user_id);
      allUserIds.add(s.marked_by_user_id);
    }
    for (const c of task.checklist as any[]) {
      if (c.completed_by_user_id) allUserIds.add(c.completed_by_user_id);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(allUserIds) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Per-person status track + overdue for the assignee scoreboard.
    const { notStarted } = await this.getCanonicalStatuses(orgId);
    const trackIds = [...new Set(task.assignees.map((a) => a.status_id).filter((id): id is string => !!id))];
    const trackStatuses = trackIds.length
      ? await this.prisma.taskStatus.findMany({ where: { id: { in: trackIds } } })
      : [];
    const statusById = new Map<string, any>(trackStatuses.map((s) => [s.id, s]));
    const now = await this.clock.now(orgId);
    const taskIsTerminal = isTerminal((task as any).status?.type);
    const nameOf = (id: string | null) => (id ? userMap.get(id) ?? null : null);

    const enrichedAssignees = task.assignees.map((a) => {
      const track = a.status_id ? statusById.get(a.status_id) ?? notStarted : notStarted;
      // Per-person overdue: the deadline has passed and this person is not yet finished.
      // "Finished" is their own completion (all_must_complete) or the whole task being closed.
      const done = task.completion_mode === CompletionMode.all_must_complete ? a.is_completed : taskIsTerminal;
      const is_overdue = !a.is_cc && !!task.deadline && task.deadline < now && !done;
      return { ...a, user: userMap.get(a.user_id) ?? null, status: a.is_cc ? null : track ?? null, is_overdue };
    });

    // Attach per-person states + aggregate counts to each checklist item. `assignee_count`
    // is the roll-up denominator (the "n/N" badge); `my_state` is a convenience for the viewer.
    const workerCount = task.assignees.filter((a: any) => !a.is_cc).length;
    const statesByItem = new Map<string, any[]>();
    for (const s of checklistStates) {
      const list = statesByItem.get(s.checklist_id) ?? [];
      list.push({
        user_id: s.user_id,
        user_name: userMap.get(s.user_id)?.name ?? null,
        state: s.state,
        reason: s.reason,
        is_override: s.is_override,
        marked_by_user_id: s.marked_by_user_id,
        marked_by_name: userMap.get(s.marked_by_user_id)?.name ?? null,
        marked_at: s.marked_at,
      });
      statesByItem.set(s.checklist_id, list);
    }
    const enrichedChecklist = (task.checklist as any[]).map((c) => {
      const states = statesByItem.get(c.id) ?? [];
      const mine = principal ? states.find((s) => s.user_id === principal.userId) : undefined;
      return {
        ...c,
        completed_by: c.completed_by_user_id ? userMap.get(c.completed_by_user_id) ?? null : null,
        states,
        done_count: states.filter((s) => s.state === ChecklistItemState.done).length,
        skipped_count: states.filter((s) => s.state === ChecklistItemState.skipped).length,
        assignee_count: workerCount,
        my_state: mine?.state ?? null,
        my_reason: mine?.reason ?? null,
      };
    });

    // Proof-of-completion scoreboard: who must submit (non-CC assignees) vs who has.
    // Names only, no files — safe for everyone; the "n/N submitted" badge reads from it.
    const proof_summary = task.proof_required ? await this.proofSummary(orgId, taskId) : null;

    return {
      ...task,
      created_by: userMap.get(task.created_by_user_id) ?? null,
      completed_by: nameOf(task.completed_by_user_id),
      status_actor: nameOf(task.status_actor_user_id),
      proof_summary,
      assignees: enrichedAssignees,
      // Former participants, with who removed them and when, so the detail screen can
      // show the full history of who has held this task.
      removed_assignees: removedAssignees.map((a) => ({
        ...a,
        user: userMap.get(a.user_id) ?? null,
        removed_by: nameOf(a.removed_by_user_id),
      })),
      deadline_revisions: ((task as any).deadline_revisions ?? []).map((r: any) => ({
        ...r,
        changed_by: nameOf(r.changed_by_user_id),
      })),
      checklist: enrichedChecklist,
      comments: (task.comments as any[]).map((c) => {
        const cu = userMap.get(c.user_id);
        return {
          ...c,
          user_name: cu?.name ?? null,
          user_email: cu?.email ?? null,
          user: cu ?? null,
          replies: (c.replies ?? []).map((r: any) => {
            const ru = userMap.get(r.user_id);
            return { ...r, user_name: ru?.name ?? null, user_email: ru?.email ?? null, user: ru ?? null };
          }),
        };
      }),
    };
  }

  // ─── Update Task ──────────────────────────────────────────────────────────────

  async updateTask(orgId: string, userId: string, taskId: string, dto: UpdateTaskDto) {
    const old = await this.findTaskOrFail(orgId, taskId, true);

    // Split rights. Looping a colleague in as CC is an everyday courtesy, not a
    // reassignment: it changes nobody's workload and is trivially reversible. So when
    // an edit touches NOTHING but the CC list, anyone actually on the task may make
    // it. Every other change — the working roster, the deadline, the fields — still
    // requires assigner rights (creator / admin / task-edit role + edit scope).
    //
    // This is safe by construction, not just by intention: the only door to the
    // roster is `reconcileTaskRoster`, and with `assignee_user_ids` absent it keeps
    // the current workers verbatim. A CC-only payload therefore cannot touch who is
    // doing the work even though it skipped the assigner gate.
    const touchedFields = (Object.keys(dto) as (keyof UpdateTaskDto)[]).filter(
      (k) => dto[k] !== undefined,
    );
    const isCcOnlyEdit = touchedFields.length === 1 && touchedFields[0] === 'cc_user_ids';
    const actorIsOnTask = ((old as any).assignees ?? []).some((a: any) => a.user_id === userId);
    if (!(isCcOnlyEdit && actorIsOnTask)) {
      await this.assertAssignerRights(orgId, userId, old);
    }

    await this.assertGoalInOrg(orgId, dto.goal_id);
    // Edited master references get the same org+active validation as create.
    await this.assertMastersUsable(orgId, {
      category_id: dto.category_id !== old.category_id ? dto.category_id : undefined,
      priority_id: dto.priority_id !== old.priority_id ? dto.priority_id : undefined,
      department_id: dto.department_id !== old.department_id ? dto.department_id : undefined,
    });

    // Editing the checklist is only allowed while the task is open (once closed it's a
    // frozen record — mirrors assertTaskOpenForChecklist), and any freshly-applied
    // template must be one the editor is allowed to use (same gate as create).
    if (dto.checklist_items !== undefined) {
      if (isTerminal((old as any).status?.type)) {
        throw new BadRequestException('This task is closed. Reopen it before changing the checklist.');
      }
      for (const templateId of dto.checklist_template_ids ?? []) {
        const allowed = await this.checklistAccess.isAccessible(orgId, userId, templateId);
        if (!allowed) {
          throw new ForbiddenException('You are not allowed to use this checklist template.');
        }
      }
    }

    const changedFields: Array<{ field: string; from: unknown; to: unknown }> = [];

    const updateData: any = {};

    // Set when the deadline genuinely moves off an existing date; drives the revision
    // record, the reminder recompute and the "your deadline changed" notification,
    // all of which must happen only after the task row itself commits.
    let deadlineRevision: { from: Date; to: Date | null; reason: string | null } | null = null;

    const trackField = (field: string, oldVal: unknown, newVal: unknown) => {
      if (newVal !== undefined && newVal !== oldVal) {
        changedFields.push({ field, from: oldVal, to: newVal });
        updateData[field] = newVal;
      }
    };

    trackField('title', old.title, dto.title);
    trackField('description', old.description, dto.description);
    trackField('category_id', old.category_id, dto.category_id);
    trackField('priority_id', old.priority_id, dto.priority_id);
    trackField('quadrant', old.quadrant, dto.quadrant);
    trackField('type', old.type, dto.type);
    trackField('department_id', old.department_id, dto.department_id);
    trackField('completion_mode', old.completion_mode, dto.completion_mode);
    trackField('proof_required', old.proof_required, dto.proof_required);
    trackField('goal_id', old.goal_id, dto.goal_id);
    if (dto.proof_allowed_extensions !== undefined) {
      const next = normaliseExtensions(dto.proof_allowed_extensions);
      const prev = normaliseExtensions((old as any).proof_allowed_extensions);
      if (prev.join(',') !== next.join(',')) {
        changedFields.push({ field: 'proof_allowed_extensions', from: prev, to: next });
        updateData.proof_allowed_extensions = next;
      }
    }

    if (dto.deadline !== undefined) {
      let newDeadline = dto.deadline ? new Date(dto.deadline) : null;
      // The create-time holiday rule applies to EDITS too — but never by force: an
      // explicit user override (holiday_override) keeps the chosen date as-is.
      if (newDeadline && !dto.holiday_override && String(old.deadline) !== String(newDeadline)) {
        const firstWorker = ((old as any).assignees ?? []).find((a: any) => !a.is_cc)?.user_id;
        const adjusted = await this.holidaysService.adjustDeadline(
          newDeadline, orgId,
          dto.department_id ?? old.department_id ?? undefined, firstWorker,
          'task', taskId, old.title,
        );
        if (adjusted === null) {
          throw new BadRequestException(
            'Deadline falls on a non-working day. Keep the date to override, or select a different one.',
          );
        }
        newDeadline = adjusted;
      }
      if (String(old.deadline) !== String(newDeadline)) {
        changedFields.push({ field: 'deadline', from: old.deadline, to: newDeadline });
        updateData.deadline = newDeadline;
        // Re-evaluate the persisted overdue flag; the auto-overdue sweep re-flags if it lapses again.
        const stillOverdue = !!newDeadline && newDeadline < new Date();
        if (old.is_overdue !== stillOverdue) {
          updateData.is_overdue = stillOverdue;
          updateData.overdue_at = stillOverdue ? new Date() : null;
        }

        if (old.deadline === null) {
          // Nothing to revise — the task never had a deadline, so this IS its first
          // commitment and becomes the compliance baseline. Not a revision, and not
          // counted as one; the plain 'edited' activity entry already records it.
          updateData.original_deadline = newDeadline;
        } else {
          // A genuine revision. Freeze the baseline if this row predates the column
          // (defensive — the migration backfilled every existing task), then record
          // the move. `original_deadline` is never written again after this point.
          if ((old as any).original_deadline === null) {
            updateData.original_deadline = old.deadline;
          }
          deadlineRevision = {
            from: old.deadline,
            to: newDeadline,
            reason: dto.deadline_reason?.trim() || null,
          };
          updateData.deadline_revision_count = { increment: 1 };
        }
      }
    }

    let newStatusLabel: string | null = null;
    if (dto.status_id !== undefined && dto.status_id !== old.status_id) {
      const st = await this.prisma.taskStatus.findFirst({
        where: { id: dto.status_id, organization_id: orgId, is_active: true },
      });
      if (!st) throw new BadRequestException(`Status ${dto.status_id} not found or inactive`);
      const oldType = (old as any).status?.type;
      // Terminal transitions carry business rules (proof, per-assignee completion,
      // the reopen window) — they must go through the dedicated actions, never a raw
      // status change. The status control only moves a task between OPEN states.
      if (isTerminal(st.type)) {
        throw new BadRequestException(
          'To close a task, use the Complete or Mark Incomplete action — the status control only moves between open states.',
        );
      }
      if (isTerminal(oldType)) {
        throw new BadRequestException('Reopen the task to change its status.');
      }
      newStatusLabel = st.label;
      changedFields.push({ field: 'status_id', from: old.status_id, to: dto.status_id });
      updateData.status_id = dto.status_id;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: TASK_INCLUDE,
    });

    // Switching completion model reconciles the two status shapes so neither goes stale.
    if (dto.completion_mode !== undefined && dto.completion_mode !== old.completion_mode) {
      if (dto.completion_mode === CompletionMode.all_must_complete) {
        // any → all: seed everyone's personal track from the current shared open status,
        // so the scoreboard starts coherent instead of blank.
        const seedId = isTerminal((updated as any).status?.type) ? null : updated.status_id;
        await this.prisma.taskAssignee.updateMany({
          where: { task_id: taskId, is_cc: false, ...ACTIVE_ASSIGNEE },
          data: { status_id: seedId },
        });
        await this.rollUpTaskOpenStatus(orgId, taskId);
      } else {
        // all → any: collapse to one shared status; personal tracks no longer apply.
        await this.prisma.taskAssignee.updateMany({
          where: { task_id: taskId, ...ACTIVE_ASSIGNEE },
          data: { status_id: null },
        });
        await this.prisma.task.update({
          where: { id: taskId },
          data: { status_actor_user_id: userId },
        });
      }
    }

    // Reconcile who is on the task (add / remove / flip between assignee and CC).
    // Runs AFTER the completion-mode switch above so a newly-added worker is seeded
    // against the mode the task now has, not the one it just left. `updated` carries
    // the post-commit status and live roster.
    const rosterChange = await this.reconcileTaskRoster(orgId, userId, updated, {
      assigneeIds: dto.assignee_user_ids,
      ccIds: dto.cc_user_ids,
    });
    if (rosterChange.added.length || rosterChange.removed.length || rosterChange.flipped.length) {
      changedFields.push({
        field: 'assignees',
        from: ((old as any).assignees ?? []).map((a: any) => a.user_id),
        to: null,
      });
    }

    // ── Deadline revision side-effects ───────────────────────────────────────────
    if (deadlineRevision) {
      // The immutable paper trail explaining how the live deadline drifted from the
      // baseline the reports grade against.
      await this.prisma.taskDeadlineRevision.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          from_deadline: deadlineRevision.from,
          to_deadline: deadlineRevision.to,
          reason: deadlineRevision.reason,
          changed_by_user_id: userId,
        },
      });

      await this.recomputeRemindersForDeadline(orgId, taskId, deadlineRevision.to);

      // Moving someone's deadline without telling them is how a task gets missed.
      // Everyone on it — workers and CCs — plus the creator, minus whoever did it.
      const actorName = await this.notifications.userName(userId);
      const recipients = [
        old.created_by_user_id,
        ...((updated as any).assignees ?? []).map((a: any) => a.user_id),
      ].filter((uid: string) => uid !== userId);
      const fmt = (d: Date | null) =>
        d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no deadline';
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_deadline_changed',
        recipients,
        title: `${actorName} changed a task deadline`,
        body:
          `“${old.title}”\n${fmt(deadlineRevision.from)} → ${fmt(deadlineRevision.to)}` +
          (deadlineRevision.reason ? `\nReason: ${deadlineRevision.reason}` : ''),
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    // Reconcile the checklist (add / edit / remove items). Runs as part of the edit;
    // items kept by id retain every assignee's per-person progress.
    if (dto.checklist_items !== undefined) {
      const checklistChanged = await this.reconcileTaskChecklist(orgId, taskId, dto.checklist_items);
      if (checklistChanged) {
        changedFields.push({ field: 'checklist', from: null, to: `${dto.checklist_items.length} item(s)` });
      }
    }

    if (changedFields.length > 0) {
      const action: TaskActionType = changedFields.some((f) => f.field === 'status_id') ? 'status_changed' : 'edited';
      await this.logActivity(orgId, taskId, userId, action, { changes: changedFields });
    }

    // A status move should ping everyone on the task (except whoever changed it).
    if (newStatusLabel) {
      const actorName = await this.notifications.userName(userId);
      const recipients = [
        old.created_by_user_id,
        ...((old as any).assignees ?? []).map((a: any) => a.user_id),
      ].filter((uid: string) => uid !== userId);
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_status_changed',
        recipients,
        title: `${actorName} changed status`,
        body: `Moved to “${newStatusLabel}”\non “${old.title}”`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    // Return the fully-enriched task (per-person status + overdue + attribution) so
    // callers that swap it straight into view state don't lose the scoreboard data.
    return this.getTask(orgId, taskId);
  }

  /**
   * Make the task's checklist match `incoming` exactly. Items carrying an `id` that
   * still exists are updated in place (title / group / order), so their per-person
   * TaskChecklistItemState rows — every assignee's tick or skip — survive the edit.
   * Items whose id is gone are deleted (their states cascade away). Items with no
   * known id are created fresh (everyone starts "not started" on them). Returns
   * whether anything actually changed, for the activity log.
   */
  private async reconcileTaskChecklist(
    orgId: string,
    taskId: string,
    incoming: { id?: string; title: string; order_index: number; group_title?: string }[],
  ): Promise<boolean> {
    const existing = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
    });
    const existingById = new Map(existing.map((c) => [c.id, c]));
    const keepIds = new Set(
      incoming.map((i) => i.id).filter((id): id is string => !!id && existingById.has(id)),
    );

    let changed = false;

    // Drop items the edit removed — their per-person states cascade away.
    const toDelete = existing.filter((c) => !keepIds.has(c.id)).map((c) => c.id);
    if (toDelete.length > 0) {
      await this.prisma.taskChecklist.deleteMany({ where: { id: { in: toDelete } } });
      changed = true;
    }

    // Keep/update or create each incoming item, preserving the payload's order.
    for (const item of incoming) {
      const groupTitle = item.group_title?.trim() ? item.group_title.trim() : null;
      const prev = item.id ? existingById.get(item.id) : undefined;
      if (prev) {
        if (
          prev.title !== item.title ||
          prev.group_title !== groupTitle ||
          prev.order_index !== item.order_index
        ) {
          await this.prisma.taskChecklist.update({
            where: { id: prev.id },
            data: { title: item.title, group_title: groupTitle, order_index: item.order_index },
          });
          changed = true;
        }
      } else {
        await this.prisma.taskChecklist.create({
          data: {
            organization_id: orgId,
            task_id: taskId,
            title: item.title,
            group_title: groupTitle,
            order_index: item.order_index,
          },
        });
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Re-hang the task's relative reminders off a NEW deadline.
   *
   * A reminder set as "3 days before the deadline" stores that provenance in
   * `offset_days`. Without this, moving a deadline left those rows pointing at
   * instants derived from the OLD date — so a reminder could fire after the deadline
   * it was meant to pre-empt, or sit in the past and never fire at all, which is the
   * one job a reminder has.
   *
   * Only unsent, one-time, relative reminders are touched:
   *   - absolute reminders (`offset_days` null) were pinned to a specific instant by
   *     the user and are none of this function's business;
   *   - `yearly` ones are anniversary re-arms with their own roll-forward rule;
   *   - already-sent rows are history.
   * The user's chosen time-of-day is carried over from the existing row. A recomputed
   * instant that is now in the past, or would land after the new deadline, is dropped
   * — matching exactly what task creation does with such reminders.
   */
  private async recomputeRemindersForDeadline(
    orgId: string,
    taskId: string,
    newDeadline: Date | null,
  ): Promise<void> {
    const pending = await this.prisma.taskReminder.findMany({
      where: {
        task_id: taskId,
        organization_id: orgId,
        is_sent: false,
        recurrence: 'one_time',
        offset_days: { not: null },
      },
    });
    if (!pending.length) return;

    // No deadline left to be relative to — a "3 days before" reminder is meaningless.
    if (!newDeadline) {
      await this.prisma.taskReminder.deleteMany({ where: { id: { in: pending.map((r) => r.id) } } });
      return;
    }

    const now = await this.clock.now(orgId);
    const stale: string[] = [];
    for (const r of pending) {
      const prev = new Date(r.remind_at);
      const next = new Date(newDeadline);
      next.setDate(next.getDate() - (r.offset_days ?? 0));
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      if (next <= now || next > newDeadline) {
        stale.push(r.id);
        continue;
      }
      if (next.getTime() !== prev.getTime()) {
        await this.prisma.taskReminder.update({ where: { id: r.id }, data: { remind_at: next } });
      }
    }
    if (stale.length) {
      await this.prisma.taskReminder.deleteMany({ where: { id: { in: stale } } });
    }
  }

  /**
   * Make the task's people match `incoming` exactly, preserving everything that can
   * be preserved. This is the single writer for "who is on this task" — the edit
   * modal, the detail-page Assignees card and the legacy add/remove endpoints all
   * funnel through it, so the rules below can't be bypassed by picking a different
   * door.
   *
   * Three operations, deliberately distinct:
   *   - **flip** (worker ⇄ CC): `is_cc` updated IN PLACE. The old code did this as a
   *     delete followed by a re-add, which silently destroyed that person's status
   *     track, completion stamp and can't-complete flag, and fired a contradictory
   *     "removed you" + "assigned you" notification pair for what the user
   *     experienced as one click.
   *   - **remove**: SOFT — stamps `removed_at`/`removed_by_user_id`. The row survives
   *     so compliance reporting can still show the person held the task; see
   *     active-assignee.ts for how they are then graded.
   *   - **add**: upsert that CLEARS `removed_at`. Re-adding someone previously removed
   *     revives their original row, so their earlier ticks, proof and status come back
   *     with them rather than the task pretending they are new.
   *
   * Passing only one of the two lists leaves the other group's membership alone.
   * Returns what actually changed, for the activity trail and notifications.
   */
  private async reconcileTaskRoster(
    orgId: string,
    actorId: string,
    task: any,
    incoming: { assigneeIds?: string[]; ccIds?: string[] },
  ): Promise<{
    added: { user_id: string; is_cc: boolean }[];
    removed: { user_id: string; is_cc: boolean }[];
    flipped: { user_id: string; to_cc: boolean }[];
  }> {
    const noChange = { added: [], removed: [], flipped: [] };
    if (incoming.assigneeIds === undefined && incoming.ccIds === undefined) return noChange;

    // Who a closed task was assigned to is part of its frozen record — the same rule
    // the checklist follows. Reopen it to change the people.
    if (isTerminal(task.status?.type)) {
      throw new BadRequestException(
        'This task is closed. Reopen it before changing who it is assigned to.',
      );
    }

    const live: { user_id: string; is_cc: boolean }[] = task.assignees ?? [];
    const currentWorkers = live.filter((a) => !a.is_cc).map((a) => a.user_id);
    const currentCcs = live.filter((a) => a.is_cc).map((a) => a.user_id);

    // A worker outranks a CC: if a hand-crafted payload lists someone in both, they
    // are the person doing the work, not an observer.
    const desiredWorkers = [...new Set(incoming.assigneeIds ?? currentWorkers)];
    const desiredCcs = [...new Set(incoming.ccIds ?? currentCcs)].filter(
      (id) => !desiredWorkers.includes(id),
    );

    if (desiredWorkers.length === 0) {
      throw new BadRequestException(
        'A task must have at least one assignee. Add another assignee before removing the last one.',
      );
    }

    const desired = new Map<string, boolean>([
      ...desiredWorkers.map((id) => [id, false] as [string, boolean]),
      ...desiredCcs.map((id) => [id, true] as [string, boolean]),
    ]);
    const liveByUser = new Map(live.map((a) => [a.user_id, a]));

    const added: { user_id: string; is_cc: boolean }[] = [];
    const removed: { user_id: string; is_cc: boolean }[] = [];
    const flipped: { user_id: string; to_cc: boolean }[] = [];
    for (const [userId, isCc] of desired) {
      const existing = liveByUser.get(userId);
      if (!existing) added.push({ user_id: userId, is_cc: isCc });
      else if (existing.is_cc !== isCc) flipped.push({ user_id: userId, to_cc: isCc });
    }
    for (const a of live) {
      if (!desired.has(a.user_id)) removed.push({ user_id: a.user_id, is_cc: a.is_cc });
    }

    if (!added.length && !removed.length && !flipped.length) return noChange;

    // ── Authorization, before any write ──────────────────────────────────────────
    // Everyone newly put on the task gets the exact same gates as at creation. A
    // flip is not re-gated: that person already passed these checks to get on the
    // task, and moving worker→CC only ever reduces what they are being asked to do.
    const newlyOn = added.map((a) => a.user_id);
    if (newlyOn.length) {
      await assertActiveOrgMembers(this.prisma, orgId, newlyOn, 'assignees or CC recipients');
      await this.assertAssigneesVisible(orgId, actorId, newlyOn);
      // Only real workers need to be *assignable*; a CC is an observer.
      await this.subjects.assertAllEligible(
        orgId,
        TasksService.TASK_SUBJECT,
        added.filter((a) => !a.is_cc).map((a) => a.user_id),
      );
    }

    // ── Apply ────────────────────────────────────────────────────────────────────
    const now = await this.clock.now(orgId);

    // A brand-new worker on an all_must_complete task needs a personal status track,
    // seeded from the task's current open status so the scoreboard stays coherent
    // (same seeding the any→all mode switch performs).
    const seedStatusId =
      task.completion_mode === CompletionMode.all_must_complete && !isTerminal(task.status?.type)
        ? task.status_id
        : null;

    for (const { user_id, to_cc } of flipped) {
      await this.prisma.taskAssignee.update({
        where: { task_id_user_id: { task_id: task.id, user_id } },
        // `is_cc` only. Their status/completion columns are left untouched on purpose:
        // every count and gate in this service filters on `is_cc: false`, so a CC's
        // stale progress is inert — and if they are flipped back to working, their
        // real progress is still there instead of having been zeroed.
        data: { is_cc: to_cc },
      });
    }

    for (const { user_id, is_cc } of added) {
      await this.prisma.taskAssignee.upsert({
        where: { task_id_user_id: { task_id: task.id, user_id } },
        create: {
          organization_id: orgId,
          task_id: task.id,
          user_id,
          is_cc,
          status_id: is_cc ? null : seedStatusId,
        },
        // Reviving a previously-removed person: clear the removal stamps and restore
        // the requested role, but leave their historical progress columns alone so
        // they come back exactly where they left off.
        update: { is_cc, removed_at: null, removed_by_user_id: null },
      });
    }

    if (removed.length) {
      await this.prisma.taskAssignee.updateMany({
        where: {
          task_id: task.id,
          user_id: { in: removed.map((r) => r.user_id) },
          ...ACTIVE_ASSIGNEE,
        },
        data: { removed_at: now, removed_by_user_id: actorId },
      });
    }

    // Assigner→assignee frequency powers the picker's "most assigned" ordering; keep
    // it fed from edits too, not just creation. Best-effort, exactly as at create.
    const newWorkers = added.filter((a) => !a.is_cc).map((a) => a.user_id);
    if (newWorkers.length) {
      await Promise.all(
        newWorkers.map((assigneeUserId) =>
          this.prisma.taskAssigneeFrequency
            .upsert({
              where: {
                organization_id_assigner_user_id_assignee_user_id: {
                  organization_id: orgId,
                  assigner_user_id: actorId,
                  assignee_user_id: assigneeUserId,
                },
              },
              create: {
                organization_id: orgId,
                assigner_user_id: actorId,
                assignee_user_id: assigneeUserId,
                frequency_count: 1,
                last_assigned_at: new Date(),
              },
              update: { frequency_count: { increment: 1 }, last_assigned_at: new Date() },
            })
            .catch(() => null),
        ),
      );
    }

    // ── Settle the completion maths ──────────────────────────────────────────────
    // Losing a worker — by removal OR by being demoted to CC — changes who the task
    // is still waiting on. If everyone REMAINING has already responded it must settle
    // now (Completed / Partial / Incomplete) rather than sit open forever waiting on
    // somebody who is no longer on it.
    if (task.completion_mode === CompletionMode.all_must_complete) {
      const lostAWorker =
        removed.some((r) => !r.is_cc) || flipped.some((f) => f.to_cc);
      if (lostAWorker) await this.settleAllMustComplete(orgId, task.id, actorId);
      await this.rollUpTaskOpenStatus(orgId, task.id);
    }

    // ── Trail + notifications ───────────────────────────────────────────────────
    // `is_cc` is recorded on both sides so the history can distinguish "CC removed"
    // from "assignee removed" — the old log couldn't.
    if (added.length || flipped.length) {
      await this.logActivity(orgId, task.id, actorId, 'assigned', {
        added: added.map((a) => ({ user_id: a.user_id, is_cc: a.is_cc })),
        role_changed: flipped.map((f) => ({ user_id: f.user_id, is_cc: f.to_cc })),
      });
    }
    if (removed.length) {
      await this.logActivity(orgId, task.id, actorId, 'reassigned', {
        removed: removed.map((r) => ({ user_id: r.user_id, is_cc: r.is_cc })),
      });
    }

    const actorName = await this.notifications.userName(actorId);
    const notify = async (
      recipients: string[],
      event_type: 'task_assigned' | 'task_unassigned',
      title: string,
      body: string,
    ) => {
      const to = recipients.filter((uid) => uid !== actorId);
      if (!to.length) return;
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type,
        recipients: to,
        title,
        body,
        link: `/dashboard/tasks/${task.id}`,
        entity: { type: 'task', id: task.id },
      });
    };

    await notify(
      added.filter((a) => !a.is_cc).map((a) => a.user_id),
      'task_assigned',
      `${actorName} assigned you a task`,
      `“${task.title}”`,
    );
    await notify(
      added.filter((a) => a.is_cc).map((a) => a.user_id),
      'task_assigned',
      `${actorName} CC’d you on a task`,
      `“${task.title}”`,
    );
    // One honest message per flip direction, instead of the old remove+add pair.
    await notify(
      flipped.filter((f) => f.to_cc).map((f) => f.user_id),
      'task_assigned',
      `${actorName} moved you to CC`,
      `“${task.title}”\nYou’re now an observer — no action needed from you.`,
    );
    await notify(
      flipped.filter((f) => !f.to_cc).map((f) => f.user_id),
      'task_assigned',
      `${actorName} made you an assignee`,
      `“${task.title}”\nYou were CC’d on this — it’s now yours to action.`,
    );
    await notify(
      removed.filter((r) => !r.is_cc).map((r) => r.user_id),
      'task_unassigned',
      `${actorName} removed you from a task`,
      `“${task.title}”\nYou’re no longer responsible for this task — thank you for your contribution.`,
    );
    await notify(
      removed.filter((r) => r.is_cc).map((r) => r.user_id),
      'task_unassigned',
      `${actorName} removed you from CC`,
      `“${task.title}”\nYou’ll no longer get updates on this task.`,
    );

    return { added, removed, flipped };
  }

  // ─── Delete Task ──────────────────────────────────────────────────────────────

  async deleteTask(orgId: string, userId: string, taskId: string, reason: string) {
    await this.checkTaskPermission(orgId, userId, 'task_delete_roles');
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Deletion reason is required');
    }

    const task = await this.findTaskOrFail(orgId, taskId, true);

    // Create archive snapshot
    await this.prisma.taskArchive.create({
      data: {
        organization_id: orgId,
        original_task_id: taskId,
        task_snapshot: task as any,
        deleted_by_user_id: userId,
        deletion_reason: reason,
        deleted_at: new Date(),
      },
    });

    // Soft delete
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        is_deleted: true,
        deleted_by_user_id: userId,
        deleted_at: new Date(),
        deletion_reason: reason,
      },
    });

    await this.logActivity(orgId, taskId, userId, 'deleted', { reason });

    return { message: 'Task deleted successfully' };
  }

  // ─── Complete Task ────────────────────────────────────────────────────────────

  /**
   * Classify a completed task against its deadline at DAY granularity (matches how
   * the dashboard reasons about timing). `early` = finished before the deadline day,
   * `on_time` = finished on the deadline day (or the task had no deadline), `late` =
   * finished after. Set once at completion and never recomputed.
   */
  /**
   * The early/on_time/late verdict stamped on a task when it closes.
   *
   * ALWAYS pass the compliance BASELINE (`original_deadline ?? deadline`), never the
   * live `deadline` — use `gradingDeadline()` below. This stamp is persisted and read
   * back by the reports and the Work Overview timing dashboard, so grading it against
   * an editable date is the same loophole in a different place: push the deadline,
   * complete the task, and a late task is stamped `on_time` forever.
   */
  private completionTiming(completedAt: Date, deadline: Date | null | undefined): CompletionTiming {
    if (!deadline) return CompletionTiming.on_time;
    const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const c = day(completedAt);
    const d = day(new Date(deadline));
    if (c < d) return CompletionTiming.early;
    if (c > d) return CompletionTiming.late;
    return CompletionTiming.on_time;
  }

  async completeTask(orgId: string, userId: string, taskId: string, targetUserId?: string, closeWholeTask = false) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    // A closed outcome is locked — Completed can never be stacked on top of
    // Incomplete / Partially Completed. Reopen first (the rule every screen shows).
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('This task is already closed. Reopen it first to change its outcome.');
    }
    const config = await this.getOrgConfig(orgId);

    // Who is being marked done. Self by default; a creator/editor may finish another
    // assignee's part (all_must_complete) on their behalf.
    const target = targetUserId ?? userId;
    // The owner override (closeWholeTask, all_must) and acting on someone else's part
    // are assigner actions: creator, admin, or a scope-verified editor.
    if (closeWholeTask || target !== userId) {
      await this.assertAssignerRights(orgId, userId, task);
    } else {
      // Finishing "your own part" (or closing an any_can task) requires you to actually
      // BE on the task — knowing a task's id must never be enough to complete it.
      const isCreator = task.created_by_user_id === userId;
      const isWorker = (task.assignees ?? []).some((a: any) => a.user_id === userId && !a.is_cc);
      if (!isCreator && !isWorker && !(await this.isOrgAdmin(orgId, userId))) {
        throw new ForbiddenException('Only someone on this task can complete it.');
      }
    }
    // all_must: the part being finished must belong to a working assignee.
    if (task.completion_mode === CompletionMode.all_must_complete && !closeWholeTask) {
      const part = (task.assignees ?? []).find((a: any) => a.user_id === target && !a.is_cc);
      if (!part) throw new BadRequestException('That person is not a working assignee on this task.');
    }

    // Proof of completion is enforced PER MODE below — any_can: any single proof on
    // the task; all_must: the finishing person's OWN proof. The owner force-close
    // (closeWholeTask) is a deliberate admin override and bypasses the proof gate.
    const proof = task.proof_required ? await this.proofSummary(orgId, taskId) : null;

    const completedStatus = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'completed', is_active: true },
      orderBy: { order_index: 'asc' },
    });

    // Owner override (all_must_complete): close the WHOLE task for everyone at once —
    // marks every outstanding part done and clears any can't-complete flags. This
    // intentionally bypasses the per-person proof gate (admin escape hatch).
    if (task.completion_mode === CompletionMode.all_must_complete && closeWholeTask) {
      await this.prisma.taskAssignee.updateMany({
        where: { task_id: taskId, is_cc: false, ...ACTIVE_ASSIGNEE },
        data: {
          is_completed: true,
          completed_at: new Date(),
          cannot_complete: false,
          cannot_complete_reason: null,
          cannot_complete_at: null,
        },
      });
      if (completedStatus) {
        const now = new Date();
        const completionNow = await this.clock.now(orgId);
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            status_id: completedStatus.id,
            reopen_expires_at: new Date(now.getTime() + config.reopen_window_minutes * 60_000),
            completed_at: completionNow,
            completion_timing: this.completionTiming(completionNow, gradingDeadline(task)),
            completed_by_user_id: userId,
          },
        });
      }
    } else if (task.completion_mode === CompletionMode.all_must_complete) {
      // Combined close gate — report EVERY outstanding requirement at once (checklist +
      // proof), so the person isn't told them one at a time. (The owner override above
      // force-closes and skips this.)
      {
        const missing: string[] = [];
        const cl = await this.checklistRemainingForUser(orgId, taskId, target);
        if (cl > 0) missing.push(`tick ${cl} checklist item${cl > 1 ? 's' : ''} (or mark “can’t do” with a reason)`);
        if (proof && !proof.submitted_user_ids.includes(target)) missing.push('attach your proof of completion');
        if (missing.length) {
          throw new BadRequestException(`Before finishing your part you still need to: ${this.joinRequirements(missing)}.`);
        }
      }
      // Mark this person's part done — and clear any earlier can't-complete flag,
      // since finishing supersedes it.
      await this.prisma.taskAssignee.updateMany({
        where: { task_id: taskId, user_id: target, is_cc: false, ...ACTIVE_ASSIGNEE },
        data: {
          is_completed: true,
          completed_at: new Date(),
          cannot_complete: false,
          cannot_complete_reason: null,
          cannot_complete_at: null,
        },
      });
      // Trail this person's part, then let settle decide the overall outcome
      // (Completed / Partially Completed / Incomplete) once everyone has responded —
      // it owns the closing notification, workflow + project rollups.
      await this.logActivity(orgId, taskId, target, 'completed', { part: true });
      await this.settleAllMustComplete(orgId, taskId, target);
      return this.getTask(orgId, taskId);
    } else {
      // any_can_complete — one person closes the whole task for everyone. Report EVERY
      // outstanding requirement at once (shared checklist + proof).
      {
        const missing: string[] = [];
        const cl = await this.sharedChecklistRemaining(orgId, taskId);
        if (cl > 0) missing.push(`tick ${cl} checklist item${cl > 1 ? 's' : ''} (or mark “can’t do” with a reason)`);
        if (proof && !proof.task_has_any_proof) missing.push('attach proof of completion');
        if (missing.length) {
          throw new BadRequestException(`Before completing this task you still need to: ${this.joinRequirements(missing)}.`);
        }
      }
      if (completedStatus) {
        const now = new Date();
        const completionNow = await this.clock.now(orgId);
        const reopenExpiresAt = new Date(now.getTime() + config.reopen_window_minutes * 60_000);
        // Optimistic close: if someone closed (or moved) the task between our read and
        // this write, exactly one completion wins — no double notification/workflow fire.
        const closed = await this.prisma.task.updateMany({
          where: { id: taskId, status_id: task.status_id },
          data: {
            status_id: completedStatus.id,
            reopen_expires_at: reopenExpiresAt,
            completed_at: completionNow,
            completion_timing: this.completionTiming(completionNow, gradingDeadline(task)),
            completed_by_user_id: userId,
          },
        });
        if (closed.count === 0) {
          throw new BadRequestException('This task was just updated by someone else — refresh and try again.');
        }
      }
      await this.prisma.taskAssignee.updateMany({
        where: { task_id: taskId, user_id: userId, is_cc: false, ...ACTIVE_ASSIGNEE },
        data: { is_completed: true, completed_at: new Date() },
      });
    }

    await this.logActivity(orgId, taskId, userId, 'completed');

    // Notify creator + co-assignees (excluding whoever completed it)
    const completerName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_completed',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
      ].filter((uid) => uid !== userId),
      title: `${completerName} completed a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // Advance workflow if this task belongs to a workflow step
    if (task.workflow_instance_step_id) {
      await this.workflowEngine.handleStepCompleted(task.workflow_instance_step_id);
    }

    // Recalculate project progress if task is linked to a project
    const projectTask = await this.prisma.projectTask.findFirst({ where: { task_id: taskId } });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(projectTask.project_id);
    }

    return this.getTask(orgId, taskId);
  }

  // ─── Reopen Task ──────────────────────────────────────────────────────────────

  async reopenTask(orgId: string, userId: string, taskId: string, reason?: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);

    const isCreator = task.created_by_user_id === userId;
    const isAssignee = (task.assignees ?? []).some((a: any) => a.user_id === userId && !a.is_cc);
    // The grace/undo window (config `reopen_window_minutes`): while it is open, a terminal
    // state is soft — any participant can UNDO it with no reason (fixes an accidental
    // Complete/Incomplete). Once it expires the outcome locks: only the creator/admin may
    // reopen, and a reason is required.
    const withinWindow = !!task.reopen_expires_at && task.reopen_expires_at > new Date();

    if (withinWindow) {
      if (!isCreator && !isAssignee && !(await this.isOrgAdmin(orgId, userId))) {
        throw new ForbiddenException('Only someone on this task can undo its closure.');
      }
    } else {
      if (!isCreator && !(await this.isOrgAdmin(orgId, userId))) {
        throw new ForbiddenException('The undo window has expired. Only the task creator can reopen this task.');
      }
      if (!reason?.trim()) {
        throw new BadRequestException('A reason is required to reopen a task after the undo window.');
      }
    }

    // Find ongoing / in-progress status
    const ongoingStatus = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'in_progress', is_active: true },
      orderBy: { order_index: 'asc' },
    });
    const defaultStatus = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    const resetStatusId = ongoingStatus?.id ?? defaultStatus?.id ?? task.status_id;

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status_id: resetStatusId,
        reopen_expires_at: null,
        reopened_at: new Date(),
        // Clear the persisted overdue flag; the sweep re-flags if the deadline is still past.
        is_overdue: false,
        overdue_at: null,
        // Leaving a terminal phase: drop the completion stamps so timing reads as open again.
        completed_at: null,
        completion_timing: null,
        completed_by_user_id: null,
        incomplete_reason: null,
      },
    });

    // Reset all assignee completion flags, per-person tracks, and any can't-complete flags.
    await this.prisma.taskAssignee.updateMany({
      // Live roster only: someone taken off the task keeps the frozen record of what
      // they did on it, so a whole-task reopen must not rewrite their history.
      where: { task_id: taskId, ...ACTIVE_ASSIGNEE },
      data: {
        is_completed: false,
        completed_at: null,
        status_id: null,
        cannot_complete: false,
        cannot_complete_reason: null,
        cannot_complete_at: null,
      },
    });

    // Re-derive the shared open status from the (now-cleared) tracks so it doesn't
    // linger on a stale In Progress after a per-person task is reopened.
    await this.rollUpTaskOpenStatus(orgId, taskId);

    await this.logActivity(orgId, taskId, userId, 'reopened', reason ? { reason } : undefined);

    // Notify assignees + creator (excluding whoever reopened it)
    const reopenerName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_reopened',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
      ].filter((uid) => uid !== userId),
      title: `${reopenerName} reopened a task`,
      body: `“${task.title}”${reason ? `\n${reason}` : ''}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // Recalculate project progress if task is linked to a project
    const projectTaskReopened = await this.prisma.projectTask.findFirst({ where: { task_id: taskId } });
    if (projectTaskReopened) {
      await this.projectProgressService.recalculateProjectProgress(projectTaskReopened.project_id);
    }

    return this.getTask(orgId, taskId);
  }

  // ─── Mark Incomplete ──────────────────────────────────────────────────────────

  /**
   * Close a task as INCOMPLETE (terminal "not done") with a REQUIRED reason.
   * Mirrors the Complete flow but never counts as a success:
   *  - any_can_complete: any non-CC assignee (or the creator / an admin) may close it,
   *    exactly as any one of them can Complete it.
   *  - all_must_complete: only the creator / an admin closes the whole task — individual
   *    assignees flag their own part instead (setAssigneeCannotComplete).
   */
  async markTaskIncomplete(orgId: string, userId: string, taskId: string, reason?: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required to mark a task incomplete.');
    }
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('This task is already closed. Reopen it first to change its outcome.');
    }

    const isCreator = task.created_by_user_id === userId;
    const isAssignee = (task.assignees ?? []).some((a: any) => a.user_id === userId && !a.is_cc);
    const isAdmin = await this.isOrgAdmin(orgId, userId);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      if (!isCreator && !isAdmin) {
        throw new ForbiddenException(
          'In "all must complete" mode, only the task creator can mark the whole task incomplete. Flag your own part instead.',
        );
      }
    } else if (!isCreator && !isAssignee && !isAdmin) {
      throw new ForbiddenException('Only someone on this task can mark it incomplete.');
    }

    // The checklist must be fully filled (ticked or "can't do") before closing — the
    // same rule as completing. In all_must every assignee's grid must be filled; in
    // any_can the one shared list must be.
    if (task.completion_mode === CompletionMode.all_must_complete) {
      await this.assertChecklistFilledForAllWorkers(orgId, taskId, task, 'marking the task incomplete');
    } else {
      await this.assertSharedChecklistResolved(orgId, taskId, 'marking the task incomplete');
    }

    const { incomplete } = await this.getCanonicalStatuses(orgId);
    if (!incomplete) {
      throw new BadRequestException('No "Incomplete" status is configured for this organization.');
    }

    const config = await this.getOrgConfig(orgId);
    const now = new Date();
    const completionNow = await this.clock.now(orgId);
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status_id: incomplete.id,
        completed_at: completionNow,
        completion_timing: CompletionTiming.incomplete,
        reopen_expires_at: new Date(now.getTime() + config.reopen_window_minutes * 60_000),
        completed_by_user_id: userId,
        incomplete_reason: trimmed,
        // A closed task is never overdue.
        is_overdue: false,
        overdue_at: null,
      },
    });

    await this.logActivity(orgId, taskId, userId, 'marked_incomplete', { reason: trimmed });

    const actorName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_incomplete',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? []).filter((a: any) => !a.is_cc).map((a: any) => a.user_id),
      ].filter((uid) => uid !== userId),
      title: `${actorName} marked a task incomplete`,
      body: `“${task.title}”\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // Keep project rollups honest (a closed-not-done task is no longer pending). We do
    // NOT advance a workflow step on an incomplete task — that only follows completion.
    const projectTask = await this.prisma.projectTask.findFirst({ where: { task_id: taskId } });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(projectTask.project_id);
    }

    return this.getTask(orgId, taskId);
  }

  /**
   * all_must_complete: an assignee flags THEIR OWN part as can't-complete (required reason),
   * or the creator/editor flags someone's part on their behalf. The part stays open but
   * flagged; the task never auto-completes while any part is flagged, so the creator decides
   * whether to close the whole task Incomplete or reassign.
   */
  async setAssigneeCannotComplete(orgId: string, actorId: string, taskId: string, targetUserId: string, reason?: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required to flag your part as incomplete.');
    }
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException('Flagging a single part only applies to "all must complete" tasks. Use Mark Incomplete instead.');
    }
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('This task is already closed. Reopen it first.');
    }

    const target = targetUserId || actorId;
    // Acting on someone else's part is an assigner action (creator / admin / scoped editor).
    if (target !== actorId) {
      await this.assertAssignerRights(orgId, actorId, task);
    }
    const part = (task.assignees ?? []).find((a: any) => a.user_id === target && !a.is_cc);
    if (!part) {
      throw new BadRequestException('That person is not a primary assignee on this task.');
    }
    if (part.is_completed) {
      throw new BadRequestException('That part is already completed. Reopen the task to change it.');
    }

    await this.prisma.taskAssignee.updateMany({
      where: { task_id: taskId, user_id: target, is_cc: false, ...ACTIVE_ASSIGNEE },
      data: { cannot_complete: true, cannot_complete_reason: trimmed, cannot_complete_at: new Date() },
    });

    await this.logActivity(orgId, taskId, actorId, 'part_flagged_incomplete', { reason: trimmed, target_user_id: target });

    // Tell the creator (and, when someone acted on their behalf, the assignee).
    const actorName = await this.notifications.userName(actorId);
    const targetName = await this.notifications.userName(target);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_part_flagged',
      recipients: [task.created_by_user_id, target].filter((uid) => uid && uid !== actorId),
      title: `${targetName}'s part can't be completed`,
      body: `“${task.title}”\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // If this flag means everyone has now responded, settle the overall outcome
    // (Partially Completed if some finished, Incomplete if nobody did); otherwise it
    // just refreshes the open roll-up and the task stays open.
    await this.settleAllMustComplete(orgId, taskId, actorId);

    return this.getTask(orgId, taskId);
  }

  /** Clear a previously-set can't-complete flag (the person, or the creator/editor). */
  async clearAssigneeCannotComplete(orgId: string, actorId: string, taskId: string, targetUserId: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    const target = targetUserId || actorId;
    if (target !== actorId) {
      await this.assertAssignerRights(orgId, actorId, task);
    }
    await this.prisma.taskAssignee.updateMany({
      where: { task_id: taskId, user_id: target, is_cc: false, ...ACTIVE_ASSIGNEE },
      data: { cannot_complete: false, cannot_complete_reason: null, cannot_complete_at: null },
    });
    await this.rollUpTaskOpenStatus(orgId, taskId);
    await this.logActivity(orgId, taskId, actorId, 'part_flag_cleared', { target_user_id: target });
    return this.getTask(orgId, taskId);
  }

  // ─── Proof of Completion ────────────────────────────────────────────────────────

  /**
   * Who must submit proof (non-CC assignees) and who has (distinct proof uploaders).
   * Non-sensitive — it reports WHO submitted, not the files — so it's safe to surface
   * to everyone on the task and drives both the completion gate and the "n/N submitted"
   * scoreboard. Files themselves are visibility-filtered in TaskAttachmentsService.
   */
  async proofSummary(orgId: string, taskId: string) {
    const [assignees, proofs] = await Promise.all([
      this.prisma.taskAssignee.findMany({
        // Live roster only — a removed person must not inflate the "n/N submitted"
        // denominator or keep a proof gate open forever.
        where: { task_id: taskId, is_cc: false, ...ACTIVE_ASSIGNEE },
        select: { user_id: true },
      }),
      this.prisma.taskAttachment.findMany({
        // Exclude proofs whose parent comment was deleted (they no longer exist).
        where: {
          organization_id: orgId,
          task_id: taskId,
          is_proof: true,
          is_deleted: false,
          OR: [{ comment_id: null }, { comment: { is_deleted: false } }],
        },
        select: { uploaded_by_user_id: true },
      }),
    ]);
    // The scoreboard answers "how many of the people who MUST submit, have?", so the
    // numerator has to be scoped to the same live roster as the denominator. A person
    // who submitted proof and was later taken off the task still has their file on
    // record, but counting them here would push the badge to an impossible 3/2 —
    // exactly the bug the checklist counts had.
    const required_user_ids = assignees.map((a) => a.user_id);
    const requiredSet = new Set(required_user_ids);
    const submitted_user_ids = Array.from(
      new Set(proofs.map((p) => p.uploaded_by_user_id).filter((id) => requiredSet.has(id))),
    );
    return {
      required_user_ids,
      submitted_user_ids,
      // Deliberately NOT scoped: this answers "does this task have any evidence at
      // all?", which drives the any_can_complete gate. Proof submitted by someone
      // since removed is still proof the work was evidenced.
      task_has_any_proof: proofs.length > 0,
    };
  }

  // ─── Activity Logs ────────────────────────────────────────────────────────────

  async getActivityLog(orgId: string, taskId: string, principal?: Principal) {
    await this.findTaskOrFail(orgId, taskId);
    await this.assertCanViewTask(orgId, principal, taskId);
    const logs = await this.prisma.taskActivityLog.findMany({
      where: { task_id: taskId, organization_id: orgId },
      orderBy: { created_at: 'desc' },
    });

    const userIds = [...new Set(logs.map((l) => l.performed_by_user_id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return logs.map((l) => ({ ...l, performed_by: userMap.get(l.performed_by_user_id) ?? null }));
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  async getComments(orgId: string, taskId: string, principal?: Principal) {
    await this.findTaskOrFail(orgId, taskId);
    await this.assertCanViewTask(orgId, principal, taskId);
    const attachmentSelect = {
      where: { is_deleted: false },
      // uploaded_by_user_id + is_proof let the UI show a "Mark as proof" action on the
      // author's own comment files (and hide it once already promoted).
      select: {
        id: true,
        file_name: true,
        mime_type: true,
        size_bytes: true,
        created_at: true,
        uploaded_by_user_id: true,
        is_proof: true,
      },
      orderBy: { created_at: 'asc' as const },
    };
    const comments = await this.prisma.taskComment.findMany({
      where: { task_id: taskId, organization_id: orgId, is_deleted: false, reply_to_comment_id: null },
      include: {
        attachments: attachmentSelect,
        replies: {
          where: { is_deleted: false },
          orderBy: { created_at: 'asc' },
          include: { attachments: attachmentSelect },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const allUserIds = new Set<string>();
    for (const c of comments) {
      allUserIds.add(c.user_id);
      for (const r of c.replies) allUserIds.add(r.user_id);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(allUserIds) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return comments.map((c) => {
      const u = userMap.get(c.user_id);
      return {
        ...c,
        user_name: u?.name ?? null,
        user_email: u?.email ?? null,
        user: u ?? null,
        replies: c.replies.map((r) => {
          const ru = userMap.get(r.user_id);
          return { ...r, user_name: ru?.name ?? null, user_email: ru?.email ?? null, user: ru ?? null };
        }),
      };
    });
  }

  async addComment(orgId: string, userId: string, taskId: string, dto: CreateCommentDto) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    // Stamp with the org's clock (respects a test org's simulated time) rather than
    // the DB's real-time default, so comments read in the timeline the user is in.
    const now = await this.clock.now(orgId);
    const comment = await this.prisma.taskComment.create({
      data: {
        organization_id: orgId,
        task_id: taskId,
        user_id: userId,
        body: dto.body,
        reply_to_comment_id: dto.reply_to_comment_id,
        attachment_urls: dto.attachment_urls as any,
        created_at: now,
      },
    });
    await this.logActivity(orgId, taskId, userId, 'comment_added', { comment_id: comment.id });
    // Post-commit enrichment read — the comment already exists, so degrade to a
    // nameless response rather than failing the whole request on a transient.
    const user = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } })
      .catch(() => null);

    // Notify everyone on the task (assignees + CC + creator) except the commenter.
    // Lead with WHO commented; show the comment itself, then the task for context.
    // A file-only comment (no text yet) reads as an attachment rather than a blank line.
    const trimmed = (dto.body ?? '').trim();
    const snippet = trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
    const payload = snippet ? `“${snippet}”` : 'Shared an attachment';
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_comment',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? []).map((a: any) => a.user_id),
      ].filter((uid) => uid !== userId),
      title: `${user?.name ?? 'Someone'} commented`,
      body: `${payload}\non “${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    return { ...comment, user_name: user?.name ?? null, user_email: user?.email ?? null, user: user ?? null };
  }

  async deleteComment(orgId: string, userId: string, commentId: string) {
    const comment = await this.prisma.taskComment.findFirst({
      where: { id: commentId, organization_id: orgId },
    });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    await this.findTaskOrFail(orgId, comment.task_id, true);
    if (comment.user_id !== userId) throw new ForbiddenException('Cannot delete another user\'s comment');

    await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { is_deleted: true, deleted_at: new Date() },
    });

    // Deleting a comment removes its files too — otherwise a file shared (and possibly
    // marked as proof) in that comment would linger in the attachments/proofs list and
    // keep counting toward the proof gate. Soft-delete the rows, then purge from R2.
    const orphaned = await this.prisma.taskAttachment.findMany({
      where: { comment_id: commentId, organization_id: orgId, is_deleted: false },
      select: { id: true, storage_key: true },
    });
    if (orphaned.length) {
      await this.prisma.taskAttachment.updateMany({
        where: { comment_id: commentId, organization_id: orgId, is_deleted: false },
        data: { is_deleted: true, deleted_at: new Date() },
      });
      // Best-effort file purge — never fail the delete on a storage hiccup.
      await Promise.all(orphaned.map((a) => this.r2.deleteObject(a.storage_key).catch(() => {})));
    }

    await this.logActivity(orgId, comment.task_id, userId, 'comment_deleted', { comment_id: commentId });
    return { message: 'Comment deleted' };
  }

  // ─── Checklist (per-person in all_must_complete; shared in any_can_complete) ─────

  /** Load a task + one of its checklist items, scoped to task + org (404 on miss). */
  private async loadChecklistItemForWrite(orgId: string, taskId: string, itemId: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    const item = await this.prisma.taskChecklist.findFirst({
      where: { id: itemId, task_id: taskId, organization_id: orgId },
    });
    if (!item) throw new NotFoundException(`Checklist item ${itemId} not found`);
    return { task, item };
  }

  /** Frozen once the task is closed — the checklist becomes a record of what happened.
   *  Only `challengeChecklistItem` (which reopens) may touch a terminal task. */
  private assertTaskOpenForChecklist(task: any) {
    if (isTerminal(task?.status?.type)) {
      throw new BadRequestException('This task is closed. Reopen it before changing the checklist.');
    }
  }

  /** May the actor tick the shared checklist (any_can_complete)? Working assignee,
   *  creator, admin, or an editor — mirrors who may move the shared status. */
  private async assertCanWorkTask(orgId: string, actorId: string, task: any) {
    const isParticipant =
      task.created_by_user_id === actorId ||
      (task.assignees ?? []).some((a: any) => a.user_id === actorId && !a.is_cc);
    if (isParticipant) return;
    await this.assertAssignerRights(orgId, actorId, task);
  }

  /** Join requirement phrases into a natural list: "A", "A and B", "A, B, and C". */
  private joinRequirements(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? '';
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  }

  /** all_must_complete: how many checklist items are still unresolved (not Done and not
   *  skipped-with-reason) for one person. 0 when there is no checklist. */
  private async checklistRemainingForUser(orgId: string, taskId: string, userId: string): Promise<number> {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { id: true },
    });
    if (items.length === 0) return 0;
    const states = await this.prisma.taskChecklistItemState.findMany({
      where: { task_id: taskId, user_id: userId },
      select: { checklist_id: true },
    });
    const satisfied = new Set(states.map((s) => s.checklist_id));
    return items.filter((i) => !satisfied.has(i.id)).length;
  }

  /** any_can_complete: how many items of the ONE shared checklist are still unresolved. */
  private async sharedChecklistRemaining(orgId: string, taskId: string): Promise<number> {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { is_completed: true, cant_do: true },
    });
    if (items.length === 0) return 0;
    return items.filter((i) => !i.is_completed && !i.cant_do).length;
  }

  /** any_can_complete: the ONE shared checklist must be fully filled (every item ticked
   *  or marked “can’t do”) before the task can be closed — as complete or incomplete. */
  private async assertSharedChecklistResolved(orgId: string, taskId: string, verb: string) {
    const remaining = await this.sharedChecklistRemaining(orgId, taskId);
    if (remaining > 0) {
      throw new BadRequestException(
        `Tick every checklist item — or mark it “can’t do” with a reason — before ${verb} (${remaining} still open).`,
      );
    }
  }

  /** all_must_complete: the whole per-person grid must be filled (every item done or
   *  “can’t do” for every working assignee) before the task can be closed as incomplete. */
  private async assertChecklistFilledForAllWorkers(orgId: string, taskId: string, task: any, verb: string) {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { id: true },
    });
    if (items.length === 0) return;
    const workers = (task.assignees ?? []).filter((a: any) => !a.is_cc);
    if (workers.length === 0) return;
    const states = await this.prisma.taskChecklistItemState.findMany({
      where: { task_id: taskId },
      select: { checklist_id: true, user_id: true },
    });
    const filled = new Set(states.map((s) => `${s.checklist_id}:${s.user_id}`));
    let remaining = 0;
    for (const it of items) for (const w of workers) if (!filled.has(`${it.id}:${w.user_id}`)) remaining++;
    if (remaining > 0) {
      throw new BadRequestException(
        `Every assignee must tick each checklist item — or mark it “can’t do” — before ${verb} (${remaining} still open).`,
      );
    }
  }

  /** Mark a checklist item done: the actor's own item (all_must) or the one shared
   *  tick (any_can). */
  async checkChecklistItem(orgId: string, actorId: string, taskId: string, itemId: string) {
    const { task } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find((a: any) => a.user_id === actorId && !a.is_cc);
      if (!part) {
        throw new BadRequestException(
          'Only a working assignee ticks their own checklist. As the assigner, use “mark done for everyone” instead.',
        );
      }
      if (part.is_completed) {
        throw new BadRequestException('Your part is already complete. Reopen your part to change its checklist.');
      }
      await this.prisma.taskChecklistItemState.upsert({
        where: { checklist_id_user_id: { checklist_id: itemId, user_id: actorId } },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: actorId,
          state: ChecklistItemState.done,
          marked_by_user_id: actorId,
        },
        update: { state: ChecklistItemState.done, reason: null, is_override: false, marked_by_user_id: actorId, marked_at: new Date() },
      });
    } else {
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: { is_completed: true, cant_do: false, cant_do_reason: null, completed_by_user_id: actorId, completed_at: new Date() },
      });
    }
    await this.logActivity(orgId, taskId, actorId, 'checklist_updated', { item_id: itemId, state: 'done' });
    return this.getTask(orgId, taskId);
  }

  /** Clear a checklist item back to Not started: the actor's own row (all_must) or the
   *  shared tick (any_can). */
  async uncheckChecklistItem(orgId: string, actorId: string, taskId: string, itemId: string) {
    const { task } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find((a: any) => a.user_id === actorId && !a.is_cc);
      if (!part) throw new BadRequestException('Only a working assignee can change their own checklist.');
      if (part.is_completed) {
        throw new BadRequestException('Your part is already complete. Reopen your part to change its checklist.');
      }
      await this.prisma.taskChecklistItemState.deleteMany({
        where: { checklist_id: itemId, user_id: actorId, task_id: taskId },
      });
    } else {
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: { is_completed: false, cant_do: false, cant_do_reason: null, completed_by_user_id: null, completed_at: null },
      });
    }
    await this.logActivity(orgId, taskId, actorId, 'checklist_updated', { item_id: itemId, state: 'not_started' });
    return this.getTask(orgId, taskId);
  }

  /** Mark an item “can’t do” with a REQUIRED reason. It fills the item (so the task can
   *  be closed) but is shown, and audited, as a skip — per-person in all_must, shared in
   *  any_can. */
  async skipChecklistItem(orgId: string, actorId: string, taskId: string, itemId: string, reason?: string) {
    const { task, item } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required to mark a checklist item “can’t do”.');
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find((a: any) => a.user_id === actorId && !a.is_cc);
      if (!part) throw new BadRequestException('Only a working assignee can mark their own checklist item “can’t do”.');
      if (part.is_completed) {
        throw new BadRequestException('Your part is already complete. Reopen your part to change its checklist.');
      }
      await this.prisma.taskChecklistItemState.upsert({
        where: { checklist_id_user_id: { checklist_id: itemId, user_id: actorId } },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: actorId,
          state: ChecklistItemState.skipped,
          reason: trimmed,
          marked_by_user_id: actorId,
        },
        update: { state: ChecklistItemState.skipped, reason: trimmed, is_override: false, marked_by_user_id: actorId, marked_at: new Date() },
      });
    } else {
      // any_can_complete — one shared "can't do" for everyone, with attribution.
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: { is_completed: false, cant_do: true, cant_do_reason: trimmed, completed_by_user_id: actorId, completed_at: new Date() },
      });
    }
    await this.logActivity(orgId, taskId, actorId, 'checklist_item_skipped', { item_id: itemId, reason: trimmed });

    // Keep the creator in the loop that a step was skipped (no sign-off needed).
    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_skipped',
      recipients: [task.created_by_user_id].filter((uid) => uid && uid !== actorId),
      title: `${actorName} couldn’t complete a checklist item`,
      body: `“${task.title}” — ${item.title}\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.getTask(orgId, taskId);
  }

  /** all_must_complete: the assigner marks an item done for EVERYONE at once. Leaves
   *  any genuine personal ticks untouched; fills the rest with an attributed override. */
  async overrideChecklistItem(orgId: string, actorId: string, taskId: string, itemId: string) {
    const { task } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException('“Mark done for everyone” applies to “all must complete” tasks.');
    }
    this.assertTaskOpenForChecklist(task);
    await this.assertAssignerRights(orgId, actorId, task);

    const workers = (task.assignees ?? []).filter((a: any) => !a.is_cc);
    const existing = await this.prisma.taskChecklistItemState.findMany({
      where: { checklist_id: itemId, task_id: taskId },
      select: { user_id: true, state: true },
    });
    const alreadyDone = new Set(existing.filter((s) => s.state === ChecklistItemState.done).map((s) => s.user_id));
    for (const w of workers) {
      if (alreadyDone.has(w.user_id)) continue; // don't clobber a genuine personal tick
      await this.prisma.taskChecklistItemState.upsert({
        where: { checklist_id_user_id: { checklist_id: itemId, user_id: w.user_id } },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: w.user_id,
          state: ChecklistItemState.done,
          is_override: true,
          marked_by_user_id: actorId,
        },
        update: { state: ChecklistItemState.done, reason: null, is_override: true, marked_by_user_id: actorId, marked_at: new Date() },
      });
    }
    await this.logActivity(orgId, taskId, actorId, 'checklist_item_overridden', { item_id: itemId });

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_overridden',
      recipients: workers.map((a: any) => a.user_id).filter((uid: string) => uid !== actorId),
      title: `${actorName} marked a checklist item done for everyone`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.getTask(orgId, taskId);
  }

  /** Undo an assigner override — removes only the override rows, leaving genuine
   *  personal ticks/skips in place. */
  async clearChecklistOverride(orgId: string, actorId: string, taskId: string, itemId: string) {
    const { task } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    this.assertTaskOpenForChecklist(task);
    await this.assertAssignerRights(orgId, actorId, task);
    await this.prisma.taskChecklistItemState.deleteMany({
      where: { checklist_id: itemId, task_id: taskId, is_override: true },
    });
    await this.logActivity(orgId, taskId, actorId, 'checklist_updated', { item_id: itemId, state: 'override_cleared' });
    return this.getTask(orgId, taskId);
  }

  /** all_must_complete: the assigner challenges one person's checklist item. This is the
   *  ONLY path that may touch a closed task — it reopens JUST that person's part (never
   *  disturbing co-assignees who legitimately finished) and bounces the item back to Not
   *  started, keeping the prior reason in the audit trail. */
  async challengeChecklistItem(orgId: string, actorId: string, taskId: string, itemId: string, targetUserId: string) {
    const { task, item } = await this.loadChecklistItemForWrite(orgId, taskId, itemId);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException('Challenging a checklist item applies to “all must complete” tasks.');
    }
    if (!targetUserId) throw new BadRequestException('Whose checklist item are you challenging?');
    await this.assertAssignerRights(orgId, actorId, task);
    const part = (task.assignees ?? []).find((a: any) => a.user_id === targetUserId && !a.is_cc);
    if (!part) throw new BadRequestException('That person is not a working assignee on this task.');

    const prior = await this.prisma.taskChecklistItemState.findUnique({
      where: { checklist_id_user_id: { checklist_id: itemId, user_id: targetUserId } },
      select: { state: true, reason: true },
    });

    // 1. Reset that person's item to Not started.
    await this.prisma.taskChecklistItemState.deleteMany({
      where: { checklist_id: itemId, user_id: targetUserId, task_id: taskId },
    });

    // 2. Reopen ONLY that person's part.
    const { notStarted, inProgress } = await this.getCanonicalStatuses(orgId);
    const openStatusId = inProgress?.id ?? notStarted?.id ?? null;
    await this.prisma.taskAssignee.updateMany({
      where: { task_id: taskId, user_id: targetUserId, is_cc: false, ...ACTIVE_ASSIGNEE },
      data: { is_completed: false, completed_at: null, status_id: openStatusId },
    });

    // 3. If the task had closed, bring it back to open — WITHOUT resetting the other
    //    assignees (unlike reopenTask, which is a whole-task reset).
    if (isTerminal((task as any).status?.type)) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status_id: openStatusId ?? task.status_id,
          completed_at: null,
          completion_timing: null,
          completed_by_user_id: null,
          incomplete_reason: null,
          reopen_expires_at: null,
          reopened_at: new Date(),
          is_overdue: false,
          overdue_at: null,
        },
      });
    }
    await this.rollUpTaskOpenStatus(orgId, taskId);

    await this.logActivity(orgId, taskId, actorId, 'checklist_item_challenged', {
      item_id: itemId,
      target_user_id: targetUserId,
      prior_state: prior?.state ?? null,
      prior_reason: prior?.reason ?? null,
    });

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_challenged',
      recipients: [targetUserId].filter((uid) => uid !== actorId),
      title: `${actorName} reopened your task`,
      body: `“${task.title}” — please revisit: ${item.title}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.getTask(orgId, taskId);
  }

  // ─── Assignees ────────────────────────────────────────────────────────────────

  /**
   * Put one person on the task, or change the role they hold on it.
   *
   * A thin wrapper over `reconcileTaskRoster` — the single writer for a task's people
   * — so this endpoint cannot drift from the edit modal's behaviour. In particular,
   * calling this for someone already on the task in the other role is a genuine
   * in-place FLIP, not the delete-and-recreate it used to be.
   */
  async addAssignee(orgId: string, userId: string, taskId: string, dto: AddAssigneeDto) {
    // isWrite: a task created in a simulated future can't have its people changed
    // until the clock reaches it — the guard every other task mutation applies.
    const task = await this.findTaskOrFail(orgId, taskId, true);
    // Only the creator (or an admin / scope-verified editor) may change who a task
    // is assigned to — a plain assignee can't reassign the work.
    await this.assertAssignerRights(orgId, userId, task);

    const live: { user_id: string; is_cc: boolean }[] = (task as any).assignees ?? [];
    const isCc = dto.is_cc ?? false;
    const keep = live.filter((a) => a.user_id !== dto.user_id);
    await this.reconcileTaskRoster(orgId, userId, task, {
      assigneeIds: [...keep.filter((a) => !a.is_cc).map((a) => a.user_id), ...(isCc ? [] : [dto.user_id])],
      ccIds: [...keep.filter((a) => a.is_cc).map((a) => a.user_id), ...(isCc ? [dto.user_id] : [])],
    });
    return this.getTask(orgId, taskId);
  }

  /**
   * Take one person off the task. Soft — see `reconcileTaskRoster` and
   * active-assignee.ts: the record that they held it survives for reporting.
   */
  async removeAssignee(orgId: string, userId: string, taskId: string, assigneeUserId: string) {
    const task = await this.findTaskOrFail(orgId, taskId, true);
    // Only the creator (or an admin / scope-verified editor) may change assignees.
    await this.assertAssignerRights(orgId, userId, task);

    const live: { user_id: string; is_cc: boolean }[] = (task as any).assignees ?? [];
    if (!live.some((a) => a.user_id === assigneeUserId)) {
      throw new NotFoundException(`Assignee ${assigneeUserId} not found on task`);
    }
    // The "a task must keep at least one assignee" rule, the settle-the-completion-
    // maths step and the notification all live in the reconcile.
    const keep = live.filter((a) => a.user_id !== assigneeUserId);
    await this.reconcileTaskRoster(orgId, userId, task, {
      assigneeIds: keep.filter((a) => !a.is_cc).map((a) => a.user_id),
      ccIds: keep.filter((a) => a.is_cc).map((a) => a.user_id),
    });
    return { message: 'Assignee removed' };
  }

  // ─── Archive ─────────────────────────────────────────────────────────────────

  async getArchive(orgId: string, userId: string) {
    await this.checkTaskPermission(orgId, userId, 'archive_view_roles');
    const items = await this.prisma.taskArchive.findMany({
      where: { organization_id: orgId },
      orderBy: { deleted_at: 'desc' },
    });
    // Resolve the deleting users' names for display.
    const userIds = Array.from(new Set(items.map((i) => i.deleted_by_user_id)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return items.map((i) => ({ ...i, deleted_by: userMap.get(i.deleted_by_user_id) ?? null }));
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async getReports(orgId: string, fromDate?: string, toDate?: string) {
    const where: any = { organization_id: orgId, is_deleted: false };
    if (fromDate || toDate) {
      where.created_at = {};
      if (fromDate) where.created_at.gte = new Date(fromDate);
      if (toDate) where.created_at.lte = new Date(toDate);
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        status: true,
        priority: true,
        category: true,
        // Live roster. This legacy Analytics roll-up has no notion of WHY someone left
        // a task, so counting a cleanly-withdrawn person's task as their overdue would
        // be worse than either option. The policy-correct graded treatment of removed
        // people lives in the three compliance reports (see assigneeOutcome).
        assignees: { where: { is_cc: false, ...ACTIVE_ASSIGNEE } },
      },
    });

    // "completed" = successful (drives completion counts); "terminal" = closed
    // (completed OR incomplete) — a closed task is never counted as overdue.
    const closingStatuses = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, type: { in: TERMINAL_TYPES } },
      select: { id: true, type: true },
    });
    const completedIds = new Set(closingStatuses.filter((s) => isSuccessful(s.type)).map((s) => s.id));
    const terminalIds = new Set(closingStatuses.map((s) => s.id));
    const now = new Date();

    const userMap = new Map<string, { user_id: string; total: number; completed: number; overdue: number }>();
    const deptMap = new Map<string, { department_id: string; total: number; completed: number; overdue: number }>();
    const priorityMap = new Map<string, { label: string; color: string; total: number; completed: number; overdue: number }>();
    const categoryMap = new Map<string, { label: string; color: string; total: number; completed: number; overdue: number }>();
    const statusMap = new Map<string, { label: string; color: string; total: number }>();
    let recurringTotal = 0, recurringCompleted = 0, oneTimeTotal = 0, oneTimeCompleted = 0;

    for (const task of tasks) {
      const isCompleted = completedIds.has(task.status_id);
      const isOverdue = !!task.deadline && task.deadline < now && !terminalIds.has(task.status_id);

      if (task.priority_id && task.priority) {
        if (!priorityMap.has(task.priority_id)) {
          priorityMap.set(task.priority_id, { label: task.priority.label, color: task.priority.color, total: 0, completed: 0, overdue: 0 });
        }
        const p = priorityMap.get(task.priority_id)!;
        p.total++; if (isCompleted) p.completed++; if (isOverdue) p.overdue++;
      }

      if (task.category_id && task.category) {
        if (!categoryMap.has(task.category_id)) {
          categoryMap.set(task.category_id, { label: task.category.name, color: task.category.color, total: 0, completed: 0, overdue: 0 });
        }
        const c = categoryMap.get(task.category_id)!;
        c.total++; if (isCompleted) c.completed++; if (isOverdue) c.overdue++;
      }

      if (task.status) {
        if (!statusMap.has(task.status_id)) {
          statusMap.set(task.status_id, { label: task.status.label, color: task.status.color, total: 0 });
        }
        statusMap.get(task.status_id)!.total++;
      }

      for (const a of task.assignees) {
        if (!userMap.has(a.user_id)) {
          userMap.set(a.user_id, { user_id: a.user_id, total: 0, completed: 0, overdue: 0 });
        }
        const u = userMap.get(a.user_id)!;
        u.total++; if (isCompleted) u.completed++; if (isOverdue) u.overdue++;
      }

      if (task.department_id) {
        if (!deptMap.has(task.department_id)) {
          deptMap.set(task.department_id, { department_id: task.department_id, total: 0, completed: 0, overdue: 0 });
        }
        const d = deptMap.get(task.department_id)!;
        d.total++; if (isCompleted) d.completed++; if (isOverdue) d.overdue++;
      }

      if (task.type === 'recurring') {
        recurringTotal++; if (isCompleted) recurringCompleted++;
      } else {
        oneTimeTotal++; if (isCompleted) oneTimeCompleted++;
      }
    }

    const userIds = Array.from(userMap.keys());
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userEnrich = new Map(users.map((u) => [u.id, u]));

    const deptIds = Array.from(deptMap.keys());
    const depts = deptIds.length > 0
      ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
      : [];
    const deptEnrich = new Map(depts.map((d) => [d.id, d]));

    return {
      total_tasks: tasks.length,
      user_performance: Array.from(userMap.entries()).map(([id, data]) => ({
        ...data,
        user: userEnrich.get(id) ?? null,
      })),
      department_performance: Array.from(deptMap.entries()).map(([id, data]) => ({
        ...data,
        department: deptEnrich.get(id) ?? null,
      })),
      priority_breakdown: Array.from(priorityMap.values()),
      category_breakdown: Array.from(categoryMap.values()),
      status_breakdown: Array.from(statusMap.values()),
      frequency_breakdown: {
        recurring: { total: recurringTotal, completed: recurringCompleted },
        one_time: { total: oneTimeTotal, completed: oneTimeCompleted },
      },
    };
  }

  // ─── Eligible Assignees ───────────────────────────────────────────────────────

  async getEligibleAssignees(
    orgId: string,
    userId: string,
    search?: string,
    sort: 'frequency' | 'workload' | 'name' = 'frequency',
  ) {
    // Membership is resolved (and cached) by AssigneeVisibilityService following the
    // override → full-visibility → exception → base default → bridges → excludes pipeline.
    const [{ pool }, profileMap] = await Promise.all([
      this.assigneeVisibility.resolve(orgId, userId),
      this.assigneeVisibility.getProfiles(orgId),
    ]);

    let eligibleProfiles = [...pool]
      .map((id) => profileMap.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

    if (search?.trim()) {
      const q = search.toLowerCase();
      // Match name, role, or department so you can find people by any of them.
      eligibleProfiles = eligibleProfiles.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.role_title ?? '').toLowerCase().includes(q) ||
          (p.department_name ?? '').toLowerCase().includes(q),
      );
    }

    // Get active task counts
    const eligibleUserIdArray = eligibleProfiles.map((p) => p.user_id);
    const activeTasks = eligibleUserIdArray.length > 0
      ? await this.prisma.taskAssignee.findMany({
          where: {
            organization_id: orgId,
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
            user_id: { in: eligibleUserIdArray },
            task: { is_deleted: false, status: { type: { notIn: TERMINAL_TYPES } } },
          },
          select: { user_id: true },
        })
      : [];

    const activeTaskMap = new Map<string, number>();
    for (const ta of activeTasks) {
      activeTaskMap.set(ta.user_id, (activeTaskMap.get(ta.user_id) ?? 0) + 1);
    }

    // Get frequency counts
    const frequencies = eligibleUserIdArray.length > 0
      ? await this.prisma.taskAssigneeFrequency.findMany({
          where: { organization_id: orgId, assigner_user_id: userId, assignee_user_id: { in: eligibleUserIdArray } },
          select: { assignee_user_id: true, frequency_count: true },
        })
      : [];
    const frequencyMap = new Map(frequencies.map((f) => [f.assignee_user_id, f.frequency_count]));

    // Top 3 by frequency = is_frequent
    const sortedFreq = [...frequencyMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const frequentUserIds = new Set(sortedFreq.filter(([, c]) => c > 0).map(([id]) => id));

    // Who is on leave right now (sim-clock aware) — annotates the picker, never filters it.
    const now = await this.clock.now(orgId);
    const onLeaveMap = await this.leave.onLeaveTodayMap(orgId, eligibleUserIdArray, now);

    const items = eligibleProfiles.map((p) => ({
      user_id: p.user_id,
      name: p.name,
      avatar_url: null as null,
      role_id: p.role_id,
      role_title: p.role_title,
      department_id: p.department_id,
      department_name: p.department_name,
      active_task_count: activeTaskMap.get(p.user_id) ?? 0,
      frequency_count: frequencyMap.get(p.user_id) ?? 0,
      is_frequent: frequentUserIds.has(p.user_id),
      on_leave_today: onLeaveMap.has(p.user_id),
      leave_until: onLeaveMap.get(p.user_id) ?? null,
    }));

    let sorted: typeof items;
    if (sort === 'frequency') {
      sorted = items.sort((a, b) => b.frequency_count - a.frequency_count || a.name.localeCompare(b.name));
    } else if (sort === 'workload') {
      sorted = items.sort((a, b) => a.active_task_count - b.active_task_count || a.name.localeCompare(b.name));
    } else {
      sorted = items.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Group by department (flat list when searching)
    if (search?.trim()) {
      return { departments: [{ department_id: 'search', department_name: 'Results', users: sorted }], total: sorted.length };
    }

    const deptMap = new Map<string, { department_id: string; department_name: string; users: typeof items }>();
    for (const item of sorted) {
      if (!deptMap.has(item.department_id)) {
        deptMap.set(item.department_id, { department_id: item.department_id, department_name: item.department_name, users: [] });
      }
      deptMap.get(item.department_id)!.users.push(item);
    }

    return { departments: Array.from(deptMap.values()), total: sorted.length };
  }

  /**
   * Admin preview: the resolved Assignees & CC list for ANY employee, with a per-person
   * reason and the "removed by manual override" strip. Powers the per-employee editor on
   * the masters page. Gated by `tasks.config.assignee_visibility.manage` at the route.
   */
  async getEmployeeAssigneePreview(orgId: string, targetUserId: string, search?: string) {
    const [{ pool, trace, provenance, removed }, profileMap, override] = await Promise.all([
      this.assigneeVisibility.resolve(orgId, targetUserId),
      this.assigneeVisibility.getProfiles(orgId),
      this.assigneeVisibility.getEmployeeManualOverride(orgId, targetUserId),
    ]);
    const target = profileMap.get(targetUserId) ?? null;

    let eligibleProfiles = [...pool]
      .map((id) => profileMap.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (search?.trim()) {
      const q = search.toLowerCase();
      // Match name, role, or department so you can find people by any of them.
      eligibleProfiles = eligibleProfiles.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.role_title ?? '').toLowerCase().includes(q) ||
          (p.department_name ?? '').toLowerCase().includes(q),
      );
    }

    const ids = eligibleProfiles.map((p) => p.user_id);
    const activeTasks = ids.length
      ? await this.prisma.taskAssignee.findMany({
          where: {
            organization_id: orgId,
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
            user_id: { in: ids },
            task: { is_deleted: false, status: { type: { notIn: TERMINAL_TYPES } } },
          },
          select: { user_id: true },
        })
      : [];
    const activeTaskMap = new Map<string, number>();
    for (const ta of activeTasks) activeTaskMap.set(ta.user_id, (activeTaskMap.get(ta.user_id) ?? 0) + 1);

    const frequencies = ids.length
      ? await this.prisma.taskAssigneeFrequency.findMany({
          where: { organization_id: orgId, assigner_user_id: targetUserId, assignee_user_id: { in: ids } },
          select: { assignee_user_id: true, frequency_count: true },
        })
      : [];
    const frequencyMap = new Map(frequencies.map((f) => [f.assignee_user_id, f.frequency_count]));
    const frequentUserIds = new Set(
      [...frequencyMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c > 0).map(([id]) => id),
    );

    const now = await this.clock.now(orgId);
    const onLeaveMap = await this.leave.onLeaveTodayMap(orgId, ids, now);
    const addedSet = new Set(override.added_user_ids);

    const items = eligibleProfiles
      .map((p) => ({
        user_id: p.user_id,
        name: p.name,
        avatar_url: null as null,
        role_title: p.role_title,
        department_id: p.department_id,
        department_name: p.department_name,
        active_task_count: activeTaskMap.get(p.user_id) ?? 0,
        frequency_count: frequencyMap.get(p.user_id) ?? 0,
        is_frequent: frequentUserIds.has(p.user_id),
        on_leave_today: onLeaveMap.has(p.user_id),
        leave_until: onLeaveMap.get(p.user_id) ?? null,
        reason: provenance.get(p.user_id) ?? 'department',
        manually_added: addedSet.has(p.user_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const deptMap = new Map<string, { department_id: string; department_name: string; users: typeof items }>();
    for (const item of items) {
      if (!deptMap.has(item.department_id)) {
        deptMap.set(item.department_id, { department_id: item.department_id, department_name: item.department_name, users: [] });
      }
      deptMap.get(item.department_id)!.users.push(item);
    }

    const removedItems = removed.map((r) => {
      const rp = profileMap.get(r.user_id);
      return {
        user_id: r.user_id,
        name: rp?.name ?? 'Unknown',
        role_title: rp?.role_title ?? '',
        department_id: rp?.department_id ?? '',
        department_name: rp?.department_name ?? '',
        would_be_reason: r.would_be_reason,
      };
    });

    return {
      employee: target
        ? {
            user_id: target.user_id,
            name: target.name,
            role_title: target.role_title,
            department_id: target.department_id,
            department_name: target.department_name,
          }
        : { user_id: targetUserId, name: 'Unknown', role_title: '', department_id: '', department_name: '' },
      trace,
      override,
      departments: Array.from(deptMap.values()),
      removed: removedItems,
      total: items.length,
    };
  }

  // ─── Collective (cross-org) ───────────────────────────────────────────────────

  async getCollectiveTasks(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { user_id: userId, is_active: true },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    return Promise.all(
      memberships.map(async (m) => {
        const tasks = await this.prisma.task.findMany({
          where: { organization_id: m.organization_id, is_deleted: false },
          include: {
            status: true,
            priority: true,
            category: true,
            assignees: true,
          },
          orderBy: { created_at: 'desc' },
          take: 100,
        });
        return {
          organization: m.organization,
          is_admin: m.is_admin,
          tasks: await this.enrichTaskList(tasks),
        };
      }),
    );
  }
}
