import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import { TERMINAL_TYPES, isTerminal } from './status-phase';
import { ancestorChain } from '../holidays/dept-tree.util';
import { TasksAnalyticsService } from './tasks-analytics.service';
import { TaskListFilters, TASK_LEAF } from './task-shared';
import { TaskQueryService } from './task-query.service';
import { TaskAccessService } from './task-access.service';

/** Dashboards, reports, work-flow and CSV export. */
@Injectable()
export class TaskReportsService {
  private readonly logger = new Logger(TaskReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
    private readonly analytics: TasksAnalyticsService,
    private readonly taskQuery: TaskQueryService,
    private readonly taskAccess: TaskAccessService,
  ) {}

  async getDashboard(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters & { scope?: DataScope | null },
  ) {
    const { max, effective } = await this.scope.resolveListScope(
      orgId,
      principal,
      TASK_LEAF,
      filters.scope,
    );
    const scopeWhere = await this.scope.whereForScope(
      orgId,
      principal.userId,
      TASK_LEAF,
      effective,
    );
    filters = {
      ...(await this.taskQuery.resolveFilters(orgId, filters)),
      scope: filters.scope,
    };
    const where = this.taskQuery.buildTaskWhere(
      orgId,
      scopeWhere,
      filters,
      'created_at',
    );

    // Empty / denied scope → zeroed dashboard (never leak counts).
    if (effective === null) {
      return {
        applied_scope: null,
        max_scope: max,
        kpis: this.analytics.emptyKpis(),
        by_status: [],
        by_priority: [],
        by_category: [],
        by_tag: [],
        by_department: [],
        by_type: [],
        by_assignee: [],
        by_assigner: [],
        by_role: [],
        by_timing: this.analytics.emptyTiming(),
        trend: [],
        trend_monthly: [],
      };
    }

    const now = await this.clock.now(orgId);

    const [kpis, dims, people, by_timing, trend, trend_monthly] =
      await Promise.all([
        this.analytics.kpiFor(orgId, where, now),
        this.analytics.dimensionBreakdowns(orgId, where),
        this.analytics.peopleDimensions(orgId, where),
        this.analytics.timingTotals(where),
        this.analytics.trendSeries(where, now),
        this.analytics.trendMonthlySeries(where, now),
      ]);

    return {
      applied_scope: effective,
      max_scope: max,
      kpis,
      ...dims,
      ...people,
      by_timing,
      trend,
      trend_monthly,
    };
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
    const { effective } = await this.scope.resolveListScope(
      orgId,
      principal,
      TASK_LEAF,
      requestedScope,
    );
    if (effective === null)
      return { nodes: [], root_user_id: principal.userId };

    const visible = await this.scope.visibleUserIds(
      orgId,
      principal.userId,
      effective,
    );
    const profiles = await this.prisma.employeeProfile.findMany({
      where: {
        organization_id: orgId,
        ...(visible === 'ALL' ? {} : { user_id: { in: visible } }),
      },
      select: {
        user_id: true,
        reporting_to_user_id: true,
        department: { select: { id: true, name: true } },
        role: { select: { title: true } },
      },
    });
    const userIds = profiles.map((p) => p.user_id);
    if (!userIds.length) return { nodes: [], root_user_id: principal.userId };

    const scopeWhere = await this.scope.whereForScope(
      orgId,
      principal.userId,
      TASK_LEAF,
      effective,
    );
    const base = this.taskQuery.buildTaskWhere(
      orgId,
      scopeWhere,
      await this.taskQuery.resolveFilters(orgId, filters),
      'created_at',
    );
    const now = await this.clock.now(orgId);
    const openTask = { status: { type: { notIn: TERMINAL_TYPES } } };

    const [names, aTotal, aOverdue, aDone, asg, timingGroups] =
      await Promise.all([
        this.analytics.enrichUserNames(userIds),
        this.prisma.taskAssignee.groupBy({
          by: ['user_id'],
          where: {
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
            user_id: { in: userIds },
            task: base,
          },
          _count: { _all: true },
        }),
        this.prisma.taskAssignee.groupBy({
          by: ['user_id'],
          where: {
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
            user_id: { in: userIds },
            task: { ...base, deadline: { lt: now }, ...openTask },
          },
          _count: { _all: true },
        }),
        this.prisma.taskAssignee.groupBy({
          by: ['user_id'],
          where: {
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
            user_id: { in: userIds },
            task: { ...base, status: { type: 'completed' } },
          },
          _count: { _all: true },
        }),
        // Delegation counts people's own hand-outs, not tasks a workflow created.
        this.prisma.task.groupBy({
          by: ['created_by_user_id'],
          where: {
            AND: [
              base,
              {
                created_by_user_id: { in: userIds },
                workflow_instance_step_id: null,
              },
            ],
          },
          _count: { _all: true },
        }),
        Promise.all(
          TasksAnalyticsService.TIMINGS.map((t) =>
            this.prisma.taskAssignee.groupBy({
              by: ['user_id'],
              where: {
                is_cc: false,
                ...ACTIVE_ASSIGNEE,
                user_id: { in: userIds },
                task: { ...base, ...this.analytics.timingWhere(t) },
              },
              _count: { _all: true },
            }),
          ),
        ),
      ]);
    const cnt = (arr: any[], key: string) =>
      new Map(arr.map((g) => [g[key], g._count._all]));
    const totM = cnt(aTotal, 'user_id'),
      ovM = cnt(aOverdue, 'user_id'),
      dnM = cnt(aDone, 'user_id'),
      asgM = cnt(asg, 'created_by_user_id');
    // user_id → assignee timing sub-counts (for the People-lens MiniBars; rolled up client-side).
    const timingM = new Map<
      string,
      ReturnType<TasksAnalyticsService['emptyTiming']>
    >();
    TasksAnalyticsService.TIMINGS.forEach((t, i) => {
      for (const g of timingGroups[i]) {
        let e = timingM.get(g.user_id);
        if (!e) {
          e = this.analytics.emptyTiming();
          timingM.set(g.user_id, e);
        }
        e[t] += g._count._all;
      }
    });

    const nodes = profiles.map((p) => ({
      user_id: p.user_id,
      name: names.get(p.user_id)?.name ?? 'Unknown',
      role_title: p.role?.title ?? null,
      department_name: p.department?.name ?? null,
      reporting_to_user_id: p.reporting_to_user_id,
      assignee: {
        total: totM.get(p.user_id) ?? 0,
        overdue: ovM.get(p.user_id) ?? 0,
        completed: dnM.get(p.user_id) ?? 0,
      },
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

  async getEmployeeReport(
    orgId: string,
    principal: Principal,
    targetUserId: string,
    filters: TaskListFilters,
  ) {
    const { effective } = await this.scope.resolveListScope(
      orgId,
      principal,
      TASK_LEAF,
      undefined,
    );
    if (effective === null)
      throw new ForbiddenException('You do not have access to task data');
    const visible = await this.scope.visibleUserIds(
      orgId,
      principal.userId,
      effective,
    );
    if (visible !== 'ALL' && !visible.includes(targetUserId)) {
      throw new ForbiddenException(
        'This employee is outside your visibility scope',
      );
    }

    const [user, profile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: targetUserId },
        select: {
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      }),
    ]);
    if (!user) throw new NotFoundException('Employee not found');

    const scopeWhere = await this.scope.whereForScope(
      orgId,
      principal.userId,
      TASK_LEAF,
      effective,
    );
    const base = this.taskQuery.buildTaskWhere(
      orgId,
      scopeWhere,
      filters,
      'created_at',
    );
    const now = await this.clock.now(orgId);
    const asAssignee = {
      ...base,
      assignees: {
        some: { ...ACTIVE_ASSIGNEE, user_id: targetUserId, is_cc: false },
      },
    };
    // "What they delegated": workflow-created tasks aren't attributed to the step's assigner.
    const asAssigner = {
      AND: [
        base,
        { created_by_user_id: targetUserId, workflow_instance_step_id: null },
      ],
    };

    const [assigneeKpis, assignerKpis, assigneeDims] = await Promise.all([
      this.analytics.kpiFor(orgId, asAssignee, now),
      this.analytics.kpiFor(orgId, asAssigner, now),
      this.analytics.dimensionBreakdowns(orgId, asAssignee),
    ]);

    return {
      employee: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_title: profile?.role?.title ?? null,
        department_name: profile?.department?.name ?? null,
      },
      as_assignee: assigneeKpis,
      as_assigner: assignerKpis,
      assignee_breakdowns: assigneeDims,
    };
  }

  // ─── Work flow (assigner → assignee source relationship) ───────────────────────

  emptySourceItem(id: string, label: string) {
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

  async getWorkFlow(
    orgId: string,
    principal: Principal,
    filters: TaskListFilters & { scope?: DataScope | null },
  ) {
    const { max, effective } = await this.scope.resolveListScope(
      orgId,
      principal,
      TASK_LEAF,
      filters.scope,
    );
    const empty = {
      applied_scope: null as DataScope | null,
      max_scope: max,
      by_source: [] as any[],
      matrix: { depts: [] as any[], rows: [] as any[] },
      incoming_by_source: [] as any[],
      external_by_dept: [] as any[],
      outgoing: { by_dept: [] as any[], overdue: 0 },
      delegated: {
        total: 0,
        open: 0,
        overdue: 0,
        timing: this.analytics.emptyTiming(),
      },
    };
    if (effective === null) return empty;

    const scopeWhere = await this.scope.whereForScope(
      orgId,
      principal.userId,
      TASK_LEAF,
      effective,
    );
    const where = this.taskQuery.buildTaskWhere(
      orgId,
      scopeWhere,
      await this.taskQuery.resolveFilters(orgId, filters),
      'created_at',
    );

    // Department maps: each dept → its top-level root; names for labels.
    const depts = await this.prisma.department.findMany({
      where: { organization_id: orgId },
      select: { id: true, name: true, color: true, parent_department_id: true },
    });
    const rootOf = new Map<string, string>();
    for (const d of depts) {
      const chain = ancestorChain(depts, d.id);
      rootOf.set(d.id, chain[0] ?? d.id);
    }
    const deptInfo = new Map(depts.map((d) => [d.id, d]));
    const topDepts = depts.filter((d) => !d.parent_department_id);

    // user → department.
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId },
      select: { user_id: true, department_id: true },
    });
    const userDept = new Map(profiles.map((p) => [p.user_id, p.department_id]));

    // The viewer's set ("my team"/own/dept) for relative classification; 'ALL' at org.
    const visible = await this.scope.visibleUserIds(
      orgId,
      principal.userId,
      effective,
    );
    const mySet: Set<string> | null =
      visible === 'ALL' ? null : new Set(visible);
    const viewerRoot = (() => {
      const d = userDept.get(principal.userId);
      return d ? (rootOf.get(d) ?? null) : null;
    })();

    // Scoped tasks with assigner + non-cc assignees + timing fields.
    const CAP = 8000;
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        created_by_user_id: true,
        completion_timing: true,
        is_overdue: true,
        status_id: true,
        workflow_instance_step_id: true,
        assignees: {
          where: { is_cc: false, ...ACTIVE_ASSIGNEE },
          select: { user_id: true },
        },
      },
      take: CAP,
    });
    if (tasks.length === CAP) this.logTruncation?.(orgId, CAP);

    const statusType = await this.taskAccess.statusTypeMap(orgId);

    // ── Fold ──────────────────────────────────────────────────────────────────────
    const REL = ['immediate', 'same_dept', 'external'] as const;
    const REL_LABEL: Record<(typeof REL)[number], string> = {
      immediate: 'Immediate (same dept)',
      same_dept: 'Same department',
      external: 'External (other dept)',
    };
    const bySource = Object.fromEntries(
      REL.map((r) => [r, this.emptySourceItem(r, REL_LABEL[r])]),
    ) as Record<
      (typeof REL)[number],
      ReturnType<TaskReportsService['emptySourceItem']>
    >;
    const matrix = new Map<string, Map<string, number>>();
    const INC = ['within', 'same_dept', 'external'] as const;
    const INC_LABEL: Record<(typeof INC)[number], string> = {
      within: 'Within team',
      same_dept: 'Same department',
      external: 'External',
    };
    const incoming = Object.fromEntries(
      INC.map((r) => [r, this.emptySourceItem(r, INC_LABEL[r])]),
    ) as Record<
      (typeof INC)[number],
      ReturnType<TaskReportsService['emptySourceItem']>
    >;
    const externalByDept = new Map<
      string,
      ReturnType<TaskReportsService['emptySourceItem']>
    >();
    const outgoingByDept = new Map<
      string,
      ReturnType<TaskReportsService['emptySourceItem']>
    >();
    let outgoingOverdue = 0;
    const delegated = {
      total: 0,
      open: 0,
      overdue: 0,
      timing: this.analytics.emptyTiming(),
    };

    const relOf = (
      aDept: string | null | undefined,
      bDept: string | null | undefined,
    ): (typeof REL)[number] => {
      if (!aDept || !bDept) return 'external';
      if (aDept === bDept) return 'immediate';
      return rootOf.get(aDept) === rootOf.get(bDept) ? 'same_dept' : 'external';
    };

    for (const t of tasks) {
      // "Where work comes from" is about people handing work out; a workflow-created
      // task isn't attributed to its step's assigner.
      if (t.workflow_instance_step_id) continue;
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
        const assigneeRoot = assigneeDept
          ? rootOf.get(assigneeDept)
          : undefined;

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
            const rel = assignerInSet
              ? 'within'
              : assignerRoot && assignerRoot === viewerRoot
                ? 'same_dept'
                : 'external';
            incoming[rel].total++;
            incoming[rel].timing[timing]++;
            if (rel === 'external' && assignerRoot) {
              const e =
                externalByDept.get(assignerRoot) ??
                this.emptySourceItem(
                  assignerRoot,
                  deptInfo.get(assignerRoot)?.name ?? 'Unknown',
                );
              e.total++;
              e.timing[timing]++;
              externalByDept.set(assignerRoot, e);
            }
          }
          // Outgoing: my set assigned OUT to someone not in my set.
          if (assignerInSet && !assigneeInSet && assigneeRoot) {
            const o =
              outgoingByDept.get(assigneeRoot) ??
              this.emptySourceItem(
                assigneeRoot,
                deptInfo.get(assigneeRoot)?.name ?? 'Unknown',
              );
            o.total++;
            o.timing[timing]++;
            outgoingByDept.set(assigneeRoot, o);
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
        depts: topDepts.map((d) => ({
          id: d.id,
          name: d.name,
          color: d.color,
        })),
        rows: topDepts.map((from) => ({
          from: from.id,
          cells: topDepts.map((to) => matrix.get(from.id)?.get(to.id) ?? 0),
        })),
      },
      incoming_by_source: INC.map((r) => incoming[r]).filter(
        (s) => s.total > 0,
      ),
      external_by_dept: [...externalByDept.values()].sort(
        (a, b) => b.total - a.total,
      ),
      outgoing: {
        by_dept: [...outgoingByDept.values()].sort((a, b) => b.total - a.total),
        overdue: outgoingOverdue,
      },
      delegated,
    };
  }

  logTruncation(orgId: string, cap: number) {
    this.logger.warn(
      `[tasks/flow] org ${orgId}: work-flow sample capped at ${cap} tasks; some cross-dept counts may be partial.`,
    );
  }
}
