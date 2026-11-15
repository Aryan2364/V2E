import { Injectable } from '@nestjs/common';
import { descendantIds } from '../holidays/dept-tree.util';
import { TASK_TAG_REF_SELECT } from '../common/task-masters-usable';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { CompletionMode, DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import { TERMINAL_TYPES } from './status-phase';
import { TasksAnalyticsService } from './tasks-analytics.service';
import { deadlineBucket, myOpenTasksWhere } from './badge-count.util';
import { clampTake } from '../common/pagination';
import {
  TASK_INCLUDE,
  MAX_TAG_FILTER_IDS,
  parseIdCsv,
  TaskListFilters,
  TASK_LEAF,
} from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskDetailService } from './task-detail.service';

/** Task lists, filters, my-tasks / CC / badge queries. */
@Injectable()
export class TaskQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
    private readonly analytics: TasksAnalyticsService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskDetail: TaskDetailService,
  ) {}

  async listTasks(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters,
  ) {
    // Row-level data scope (own/team/department/org) at the actor's full entitlement.
    const scopeWhere = await this.scope.listWhere(orgId, principal, TASK_LEAF);
    const where = this.buildTaskWhere(orgId, scopeWhere, filters, 'deadline');

    const tasks = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });

    return this.taskDetail.enrichTaskList(tasks, undefined, principal);
  }

  /**
   * Shared task `where` builder for list / paged / dashboard queries. `scopeWhere` is the
   * already-resolved row-scope fragment (AND'd so it never clobbers the search OR).
   * `dateField` chooses whether the from/to range filters by deadline (legacy list) or
   * created_at (dashboard "period" semantics).
   */

  buildTaskWhere(
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
      const ids = filters.department_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) where.department_id = { in: ids };
    } else if (filters.department_id) {
      where.department_id = filters.department_id;
    }
    if (filters.created_by_user_ids) {
      const ids = filters.created_by_user_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) where.created_by_user_id = { in: ids };
    } else if (filters.created_by_user_id) {
      where.created_by_user_id = filters.created_by_user_id;
    }
    if (filters.quadrant) where.quadrant = filters.quadrant as any;
    if (filters.type) where.type = filters.type as any;
    if (filters.from_workflows === 'true')
      where.workflow_instance_step_id = { not: null };
    else if (filters.from_workflows === 'false')
      where.workflow_instance_step_id = null;
    // An assigner filter means "handed out by": a workflow-created task isn't attributed
    // to its step's assigner (matches the by-assigner / flow analytics).
    else if (filters.created_by_user_ids || filters.created_by_user_id)
      where.workflow_instance_step_id = null;
    if (filters.timing)
      Object.assign(where, this.analytics.timingWhere(filters.timing as any));
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        // Search covers tags too (kit §27.1): a task matches when any of its tags'
        // names contains the query.
        {
          tags: {
            some: {
              tag: { name: { contains: filters.search, mode: 'insensitive' } },
            },
          },
        },
      ];
    }
    // Tag filter ("any of"). Pushed into AND — never assigned to a top-level key — so
    // it can't clobber the search OR or the assignee filter, and stays ANDed with the
    // row scope: filtering can never reveal a task the viewer couldn't already see.
    const tagIds = parseIdCsv(filters.tag_ids, MAX_TAG_FILTER_IDS);
    if (tagIds.length) {
      where.AND = [
        ...(where.AND ?? []),
        { tags: { some: { tag_id: { in: tagIds } } } },
      ];
    }
    if (filters.from_date || filters.to_date) {
      const range: any = {};
      if (filters.from_date) range.gte = new Date(filters.from_date);
      if (filters.to_date) range.lte = new Date(filters.to_date);
      where[dateField] = range;
    }
    if (filters.assignee_user_ids) {
      const ids = filters.assignee_user_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length)
        where.assignees = { some: { user_id: { in: ids }, is_cc: false } };
    } else if (filters.assignee_user_id) {
      where.assignees = {
        some: { user_id: filters.assignee_user_id, is_cc: false },
      };
    }

    return where;
  }

  /** All user ids whose home department is `deptId` or any descendant of it. */
  async deptMemberIds(orgId: string, deptId: string): Promise<string[]> {
    const depts = await this.prisma.department.findMany({
      where: { organization_id: orgId },
      select: { id: true, parent_department_id: true },
    });
    const ids = [deptId, ...descendantIds(depts, deptId)];
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId, department_id: { in: ids } },
      select: { user_id: true },
    });
    return profiles.map((p) => p.user_id);
  }

  /**
   * Expand the person-relative drills (job role, assigner/assignee home department) into the
   * concrete user-id sets, since these live on the PERSON not the task. No-op when absent.
   * An empty resolution yields an impossible id so the slice is empty rather than unfiltered.
   */

  async resolveFilters(
    orgId: string,
    filters: TaskListFilters,
  ): Promise<TaskListFilters> {
    if (
      !filters.role_id &&
      !filters.assigner_person_dept_id &&
      !filters.assignee_person_dept_id
    )
      return filters;
    const out: TaskListFilters = { ...filters };
    const orNone = (ids: string[]) =>
      (ids.length ? ids : ['__none__']).join(',');

    if (filters.role_id) {
      const profiles = await this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, role_id: filters.role_id },
        select: { user_id: true },
      });
      out.assignee_user_ids = orNone(profiles.map((p) => p.user_id));
    }
    if (filters.assignee_person_dept_id) {
      out.assignee_user_ids = orNone(
        await this.deptMemberIds(orgId, filters.assignee_person_dept_id),
      );
    }
    if (filters.assigner_person_dept_id) {
      out.created_by_user_ids = orNone(
        await this.deptMemberIds(orgId, filters.assigner_person_dept_id),
      );
    }
    return out;
  }

  /**
   * Extra `where` fragment for a KPI "bucket" (overdue / due today / etc). Shared by the
   * dashboard counts and the paged list so a tile's number always matches the rows it opens.
   */

  bucketWhere(bucket: string | undefined, now: Date): any {
    if (!bucket) return {};
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() - todayStart.getDay() + 7);
    const open = { status: { type: { notIn: TERMINAL_TYPES } } };
    switch (bucket) {
      case 'overdue':
        return { deadline: { lt: now }, ...open };
      case 'due_today':
        return { deadline: { gte: todayStart, lt: todayEnd }, ...open };
      case 'due_week':
        return { deadline: { gte: todayStart, lt: weekEnd }, ...open };
      case 'completed':
        return { status: { type: 'completed' } };
      case 'ongoing':
        return { status: { type: 'in_progress' } };
      case 'not_started':
        return { status: { type: 'not_started' } };
      case 'recurring':
        return { type: 'recurring' as any };
      default:
        return {};
    }
  }

  taskOrderBy(sort?: string): any {
    switch (sort) {
      case 'deadline_asc':
        return [{ deadline: { sort: 'asc', nulls: 'last' } }];
      case 'deadline_desc':
        return [{ deadline: { sort: 'desc', nulls: 'last' } }];
      case 'created_asc':
        return { created_at: 'asc' };
      case 'updated_desc':
        return { updated_at: 'desc' };
      case 'created_desc':
      default:
        return { created_at: 'desc' };
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
    const { effective } = await this.scope.resolveListScope(
      orgId,
      principal,
      TASK_LEAF,
      requestedScope,
    );
    const scopeWhere = await this.scope.whereForScope(
      orgId,
      principal.userId,
      TASK_LEAF,
      effective,
    );
    const now = await this.clock.now(orgId);
    filters = await this.resolveFilters(orgId, filters);
    const where = {
      ...this.buildTaskWhere(orgId, scopeWhere, filters, 'created_at'),
      ...this.bucketWhere(bucket, now),
    };

    const take = clampTake(pageSize, 25, 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: this.taskOrderBy(sort),
        skip,
        take,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      items: await this.taskDetail.enrichTaskList(items, undefined, principal),
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

  async getMyTasks(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        assignees: {
          some: { ...ACTIVE_ASSIGNEE, user_id: userId, is_cc: false },
        },
      },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.taskDetail.enrichTaskList(tasks, userId);
  }

  /**
   * "My tasks" bucketed by deadline (overdue / today / tomorrow / later / no date),
   * for the phone app's home screen. Reuses getMyTasks's own query (same predicate as
   * `myOpenTasksWhere`, shared with `getBadgeCount` below so they can never disagree)
   * rather than hand-rolling a second one, then enriches with whatever the client
   * needs to decide "tap-to-finish vs. open the Finish sheet" without a second call:
   * proof_required, completion_mode, proof_allowed_extensions, and the checklist
   * item count + this viewer's remaining count.
   */

  async getMyTasksGrouped(orgId: string, userId: string) {
    const now = await this.clock.now(orgId);
    const tasks = await this.prisma.task.findMany({
      where: myOpenTasksWhere(orgId, userId),
      include: TASK_INCLUDE,
      orderBy: { deadline: 'asc' },
    });
    const enriched = (await this.taskDetail.enrichTaskList(
      tasks,
      userId,
    )) as any[];

    // Per-user checklist state (all_must_complete), batched for the whole list —
    // the any_can_complete shared checklist is already fully loaded via TASK_INCLUDE.
    const taskIds = tasks.map((t) => t.id);
    const states = taskIds.length
      ? await this.prisma.taskChecklistItemState.findMany({
          where: { task_id: { in: taskIds }, user_id: userId },
          select: { task_id: true, checklist_id: true },
        })
      : [];
    const satisfiedByTask = new Map<string, Set<string>>();
    for (const s of states) {
      if (!satisfiedByTask.has(s.task_id))
        satisfiedByTask.set(s.task_id, new Set());
      satisfiedByTask.get(s.task_id)!.add(s.checklist_id);
    }

    const buckets: Record<
      'overdue' | 'today' | 'tomorrow' | 'later' | 'noDate',
      any[]
    > = {
      overdue: [],
      today: [],
      tomorrow: [],
      later: [],
      noDate: [],
    };

    for (const t of enriched) {
      const checklist: any[] = t.checklist ?? [];
      const checklistTotal = checklist.length;
      let checklistRemaining = 0;
      if (checklistTotal > 0) {
        if (t.completion_mode === CompletionMode.all_must_complete) {
          const satisfied = satisfiedByTask.get(t.id) ?? new Set<string>();
          checklistRemaining = checklist.filter(
            (i) => !satisfied.has(i.id),
          ).length;
        } else {
          checklistRemaining = checklist.filter(
            (i: any) => !i.is_completed && !i.cant_do,
          ).length;
        }
      }
      const shaped = {
        ...t,
        proof_required: t.proof_required,
        completion_mode: t.completion_mode,
        proof_allowed_extensions: t.proof_allowed_extensions ?? [],
        checklist_total: checklistTotal,
        checklist_remaining: checklistRemaining,
      };
      const key = deadlineBucket(t.deadline ? new Date(t.deadline) : null, now);
      buckets[key].push(shaped);
    }

    return {
      ...buckets,
      counts: {
        overdue: buckets.overdue.length,
        today: buckets.today.length,
        tomorrow: buckets.tomorrow.length,
        later: buckets.later.length,
        noDate: buckets.noDate.length,
        total: tasks.length,
      },
    };
  }

  /**
   * Phone app badge count: how many of MY tasks (real, non-CC, not-yet-closed
   * assignments) are overdue or due today. Uses the exact same predicate
   * (`myOpenTasksWhere` + `isOverdueOrDueToday`) as `getMyTasksGrouped`'s
   * overdue/today buckets, so the two can never disagree. Self-scoped by
   * `user_id` — no `ScopeService.assertCanActOn` needed (AUTHORIZATION.md's rule
   * for recipient/owner-scoped rows), `organization_id` is still scoped in the query.
   */

  async getBadgeCount(orgId: string, userId: string): Promise<number> {
    const now = await this.clock.now(orgId);
    const tasks = await this.prisma.task.findMany({
      where: myOpenTasksWhere(orgId, userId),
      select: { deadline: true },
    });
    return tasks.filter((t) => {
      const bucket = deadlineBucket(t.deadline, now);
      return bucket === 'overdue' || bucket === 'today';
    }).length;
  }

  async getMyCCTasks(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        assignees: {
          some: { ...ACTIVE_ASSIGNEE, user_id: userId, is_cc: true },
        },
      },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.taskDetail.enrichTaskList(tasks, userId);
  }

  /** Tasks I handed out. Workflow-created tasks aren't personally handed out, so they're excluded. */
  async getTasksAssignedByMe(orgId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        created_by_user_id: userId,
        workflow_instance_step_id: null,
      },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.taskDetail.enrichTaskList(tasks, userId);
  }

  async getEscalatedTasks(orgId: string, userId: string) {
    const escalations = await this.prisma.taskEscalation.findMany({
      where: {
        organization_id: orgId,
        escalate_to_user_id: userId,
        is_active: true,
        escalated_at: { not: null },
      },
      select: { task_id: true },
    });
    const taskIds = escalations.map((e) => e.task_id);
    if (taskIds.length === 0) return [];

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, is_deleted: false },
      include: TASK_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.taskDetail.enrichTaskList(tasks, userId);
  }

  /**
   * Compute, per task, how many comments the viewer hasn't seen yet: comments
   * created after the viewer last opened the task (or ever, if never opened),
   * excluding the viewer's own comments and soft-deleted ones. Returns a map of
   * task_id → unread count. No-op (empty map) when there's no viewer.
   */

  async getArchive(orgId: string, userId: string) {
    await this.taskAccess.checkTaskPermission(
      orgId,
      userId,
      'archive_view_roles',
    );
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
    return items.map((i) => ({
      ...i,
      deleted_by: userMap.get(i.deleted_by_user_id) ?? null,
    }));
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async getCollectiveTasks(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { user_id: userId, is_active: true },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
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
            // Flattened to `tags: TaskTagRef[]` by enrichTaskList.
            ...TASK_TAG_REF_SELECT,
          },
          orderBy: { created_at: 'desc' },
          take: 100,
        });
        return {
          organization: m.organization,
          is_admin: m.is_admin,
          tasks: await this.taskDetail.enrichTaskList(tasks),
        };
      }),
    );
  }
}
