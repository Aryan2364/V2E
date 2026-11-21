import { Injectable } from '@nestjs/common';
import { TASK_TAG_REF_SELECT } from '../common/task-masters-usable';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import { formatLocalDateTime, safeTimeZone } from '../workflows/engine/tz';
import { toTagRefs } from '../common/task-masters-usable';
import { TERMINAL_TYPES, isSuccessful } from './status-phase';
import { TASK_INCLUDE, TaskListFilters, TASK_LEAF } from './task-shared';
import { TaskQueryService } from './task-query.service';
import { TaskDetailService } from './task-detail.service';

/** CSV export and compliance reports. */
@Injectable()
export class TaskExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
    private readonly taskQuery: TaskQueryService,
    private readonly taskDetail: TaskDetailService,
  ) {}

  /** Scope + filter aware CSV of the current view (capped). Returned as a JSON string field. */
  async exportCsv(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters,
    requestedScope?: DataScope | null,
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
    filters = await this.taskQuery.resolveFilters(orgId, filters);
    const where = {
      ...this.taskQuery.buildTaskWhere(
        orgId,
        scopeWhere,
        filters,
        'created_at',
      ),
      ...this.taskQuery.bucketWhere(bucket, now),
    };
    const tasks = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: this.taskQuery.taskOrderBy('created_desc'),
      take: 5000,
    });
    const enriched = await this.taskDetail.enrichTaskList(
      tasks,
      undefined,
      principal,
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    const tz = safeTimeZone(org?.timezone);

    const headers = [
      'Title',
      'Description',
      'Status',
      'Priority',
      'Category',
      'Tags',
      'Type',
      'Assigned By',
      'Assignees',
      'Deadline',
      'Created',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const t of enriched as any[]) {
      lines.push(
        [
          t.title,
          t.description ?? '',
          t.status?.label ?? '',
          t.priority?.label ?? '',
          t.category?.name ?? '',
          // ", " — the same delimiter the import reads back (names can't contain a comma).
          (t.tags ?? []).map((tag: { name: string }) => tag.name).join(', '),
          t.type,
          // A workflow-created task isn't personally handed out by the step's assigner.
          t.workflow
            ? `Workflow: ${t.workflow.label}`
            : (t.created_by?.name ?? ''),
          (t.assignees ?? [])
            .filter((a: any) => !a.is_cc)
            .map((a: any) => a.user?.name)
            .filter(Boolean)
            .join('; '),
          // Org-local wall clock, not UTC — "2026-10-25 00:00" reads as the date the user saw.
          t.deadline ? formatLocalDateTime(new Date(t.deadline), tz) : '',
          formatLocalDateTime(new Date(t.created_at), tz),
        ]
          .map(esc)
          .join(','),
      );
    }
    return { csv: lines.join('\n'), count: enriched.length };
  }

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
        ...TASK_TAG_REF_SELECT,
      },
    });

    // "completed" = successful (drives completion counts); "terminal" = closed
    // (completed OR incomplete) — a closed task is never counted as overdue.
    const closingStatuses = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, type: { in: TERMINAL_TYPES } },
      select: { id: true, type: true },
    });
    const completedIds = new Set(
      closingStatuses.filter((s) => isSuccessful(s.type)).map((s) => s.id),
    );
    const terminalIds = new Set(closingStatuses.map((s) => s.id));
    const now = new Date();

    const userMap = new Map<
      string,
      { user_id: string; total: number; completed: number; overdue: number }
    >();
    const deptMap = new Map<
      string,
      {
        department_id: string;
        total: number;
        completed: number;
        overdue: number;
      }
    >();
    const priorityMap = new Map<
      string,
      {
        label: string;
        color: string;
        total: number;
        completed: number;
        overdue: number;
      }
    >();
    const categoryMap = new Map<
      string,
      {
        label: string;
        color: string;
        total: number;
        completed: number;
        overdue: number;
      }
    >();
    // One task counts once in EACH of its tags (tags are multi-valued, unlike category).
    const tagMap = new Map<
      string,
      {
        id: string;
        label: string;
        color: string;
        is_active: boolean;
        total: number;
        completed: number;
        overdue: number;
      }
    >();
    const statusMap = new Map<
      string,
      { label: string; color: string; total: number }
    >();
    let recurringTotal = 0,
      recurringCompleted = 0,
      oneTimeTotal = 0,
      oneTimeCompleted = 0;

    for (const task of tasks) {
      const isCompleted = completedIds.has(task.status_id);
      const isOverdue =
        !!task.deadline &&
        task.deadline < now &&
        !terminalIds.has(task.status_id);

      if (task.priority_id && task.priority) {
        if (!priorityMap.has(task.priority_id)) {
          priorityMap.set(task.priority_id, {
            label: task.priority.label,
            color: task.priority.color,
            total: 0,
            completed: 0,
            overdue: 0,
          });
        }
        const p = priorityMap.get(task.priority_id)!;
        p.total++;
        if (isCompleted) p.completed++;
        if (isOverdue) p.overdue++;
      }

      if (task.category_id && task.category) {
        if (!categoryMap.has(task.category_id)) {
          categoryMap.set(task.category_id, {
            label: task.category.name,
            color: task.category.color,
            total: 0,
            completed: 0,
            overdue: 0,
          });
        }
        const c = categoryMap.get(task.category_id)!;
        c.total++;
        if (isCompleted) c.completed++;
        if (isOverdue) c.overdue++;
      }

      for (const tag of toTagRefs(task.tags)) {
        let t = tagMap.get(tag.id);
        if (!t) {
          t = {
            id: tag.id,
            label: tag.name,
            color: tag.color,
            is_active: tag.is_active,
            total: 0,
            completed: 0,
            overdue: 0,
          };
          tagMap.set(tag.id, t);
        }
        t.total++;
        if (isCompleted) t.completed++;
        if (isOverdue) t.overdue++;
      }

      if (task.status) {
        if (!statusMap.has(task.status_id)) {
          statusMap.set(task.status_id, {
            label: task.status.label,
            color: task.status.color,
            total: 0,
          });
        }
        statusMap.get(task.status_id)!.total++;
      }

      for (const a of task.assignees) {
        if (!userMap.has(a.user_id)) {
          userMap.set(a.user_id, {
            user_id: a.user_id,
            total: 0,
            completed: 0,
            overdue: 0,
          });
        }
        const u = userMap.get(a.user_id)!;
        u.total++;
        if (isCompleted) u.completed++;
        if (isOverdue) u.overdue++;
      }

      if (task.department_id) {
        if (!deptMap.has(task.department_id)) {
          deptMap.set(task.department_id, {
            department_id: task.department_id,
            total: 0,
            completed: 0,
            overdue: 0,
          });
        }
        const d = deptMap.get(task.department_id)!;
        d.total++;
        if (isCompleted) d.completed++;
        if (isOverdue) d.overdue++;
      }

      if (task.type === 'recurring') {
        recurringTotal++;
        if (isCompleted) recurringCompleted++;
      } else {
        oneTimeTotal++;
        if (isCompleted) oneTimeCompleted++;
      }
    }

    const userIds = Array.from(userMap.keys());
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const userEnrich = new Map(users.map((u) => [u.id, u]));

    const deptIds = Array.from(deptMap.keys());
    const depts =
      deptIds.length > 0
        ? await this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [];
    const deptEnrich = new Map(depts.map((d) => [d.id, d]));

    return {
      total_tasks: tasks.length,
      user_performance: Array.from(userMap.entries()).map(([id, data]) => ({
        ...data,
        user: userEnrich.get(id) ?? null,
      })),
      department_performance: Array.from(deptMap.entries()).map(
        ([id, data]) => ({
          ...data,
          department: deptEnrich.get(id) ?? null,
        }),
      ),
      priority_breakdown: Array.from(priorityMap.values()),
      category_breakdown: Array.from(categoryMap.values()),
      tag_breakdown: Array.from(tagMap.values()).sort(
        (a, b) => b.total - a.total,
      ),
      status_breakdown: Array.from(statusMap.values()),
      frequency_breakdown: {
        recurring: { total: recurringTotal, completed: recurringCompleted },
        one_time: { total: oneTimeTotal, completed: oneTimeCompleted },
      },
    };
  }
}
