import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { TERMINAL_TYPES } from './status-phase';
import { ACTIVE_ASSIGNEE } from './active-assignee';

@Injectable()
export class TasksAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  public static readonly TIMINGS = ['early', 'on_time', 'late', 'overdue', 'partial', 'incomplete', 'pending'] as const;

  public emptyTiming(): Record<(typeof TasksAnalyticsService.TIMINGS)[number], number> {
    return { early: 0, on_time: 0, late: 0, overdue: 0, partial: 0, incomplete: 0, pending: 0 };
  }

  public emptyKpis() {
    return {
      total: 0, not_started: 0, ongoing: 0, completed: 0, overdue: 0, due_today: 0, due_week: 0, recurring: 0,
      completed_early: 0, completed_on_time: 0, completed_late: 0, critical_high_open: 0,
      completion_rate: 0, on_time_rate: 0, recurring_share: 0, delta: null as number | null,
      overdue_aging: { d0_7: 0, d8_30: 0, d30_plus: 0 },
    };
  }

  public timingWhere(t: (typeof TasksAnalyticsService.TIMINGS)[number]): any {
    switch (t) {
      case 'early': return { completion_timing: 'early' };
      case 'on_time': return { completion_timing: 'on_time' };
      case 'late': return { completion_timing: 'late' };
      case 'partial': return { completion_timing: 'partial' };
      case 'incomplete': return { completion_timing: 'incomplete' };
      case 'overdue': return { completion_timing: null, is_overdue: true };
      case 'pending': return { completion_timing: null, is_overdue: false };
    }
  }

  public timingOf(ct: string | null, isOverdue: boolean): (typeof TasksAnalyticsService.TIMINGS)[number] {
    if (ct === 'early' || ct === 'on_time' || ct === 'late' || ct === 'partial' || ct === 'incomplete') return ct;
    return isOverdue ? 'overdue' : 'pending';
  }

  public bucketWhere(bucket: string, now: Date): any {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    switch (bucket) {
      case 'not_started': return { status: { type: 'not_started' } };
      case 'ongoing': return { status: { type: 'ongoing' } };
      case 'completed': return { status: { type: 'completed' } };
      case 'overdue': return { status: { type: { notIn: TERMINAL_TYPES } }, is_overdue: true };
      case 'due_today': return { status: { type: { notIn: TERMINAL_TYPES } }, deadline: { gte: startOfToday, lte: endOfToday } };
      case 'due_week': return { status: { type: { notIn: TERMINAL_TYPES } }, deadline: { gte: startOfWeek, lte: endOfWeek } };
      case 'recurring': return { recurring_template_id: { not: null } };
      default: return {};
    }
  }

  public async highPriorityIds(orgId: string): Promise<string[]> {
    const ps = await this.prisma.taskPriority.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' }, take: 2, select: { id: true },
    });
    return ps.map((p) => p.id);
  }

  public async kpiFor(orgId: string, where: any, now: Date) {
    const c = (extra: any = {}) => this.prisma.task.count({ where: { ...where, ...extra } });
    const highIds = await this.highPriorityIds(orgId);
    const open = { status: { type: { notIn: TERMINAL_TYPES } } };
    const d7 = new Date(now.getTime() - 7 * 86_400_000);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const [
      total, not_started, ongoing, completed, overdue, due_today, due_week, recurring,
      completed_early, completed_on_time, completed_late, critical_high_open,
      age0_7, age8_30, age30_plus,
    ] = await Promise.all([
      c(), c(this.bucketWhere('not_started', now)), c(this.bucketWhere('ongoing', now)), c(this.bucketWhere('completed', now)),
      c(this.bucketWhere('overdue', now)), c(this.bucketWhere('due_today', now)), c(this.bucketWhere('due_week', now)), c(this.bucketWhere('recurring', now)),
      c(this.timingWhere('early')), c(this.timingWhere('on_time')), c(this.timingWhere('late')),
      highIds.length ? c({ priority_id: { in: highIds }, ...open }) : Promise.resolve(0),
      c({ deadline: { gte: d7, lt: now }, ...open }),
      c({ deadline: { gte: d30, lt: d7 }, ...open }),
      c({ deadline: { lt: d30 }, ...open }),
    ]);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
    const delta = await this.momCompletionDelta(where, now);
    return {
      total, not_started, ongoing, completed, overdue, due_today, due_week, recurring,
      completed_early, completed_on_time, completed_late, critical_high_open,
      completion_rate: pct(completed, total),
      on_time_rate: pct(completed_early + completed_on_time, completed),
      recurring_share: pct(recurring, total),
      delta,
      overdue_aging: { d0_7: age0_7, d8_30: age8_30, d30_plus: age30_plus },
    };
  }

  public async momCompletionDelta(where: any, now: Date): Promise<number | null> {
    const monthRate = async (start: Date, end: Date): Promise<number | null> => {
      const window = { deadline: { gte: start, lt: end } };
      const [tot, comp] = await Promise.all([
        this.prisma.task.count({ where: { ...where, ...window } }),
        this.prisma.task.count({ where: { ...where, ...window, status: { type: 'completed' } } }),
      ]);
      return tot ? Math.round((comp / tot) * 100) : null;
    };
    const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const [tR, lR] = await Promise.all([monthRate(thisStart, nextStart), monthRate(lastStart, thisStart)]);
    return tR != null && lR != null ? tR - lR : null;
  }

  public foldTimingGroups<K extends string>(groups: any[], keyField: K) {
    const map = new Map<string, { total: number; timing: ReturnType<TasksAnalyticsService['emptyTiming']> }>();
    for (const g of groups) {
      const key = g[keyField];
      if (key == null) continue;
      let e = map.get(key);
      if (!e) { e = { total: 0, timing: this.emptyTiming() }; map.set(key, e); }
      const n = g._count._all;
      e.total += n;
      e.timing[this.timingOf(g.completion_timing, g.is_overdue)] += n;
    }
    return map;
  }

  public async timingTotals(where: any) {
    const groups = await this.prisma.task.groupBy({ by: ['completion_timing', 'is_overdue'], where, _count: { _all: true } });
    const out = this.emptyTiming();
    for (const g of groups) out[this.timingOf(g.completion_timing, g.is_overdue)] += g._count._all;
    return out;
  }

  public async dimensionBreakdowns(orgId: string, where: any) {
    const [statusGroups, priorityGroups, categoryGroups, deptGroups, typeGroups, assignerGroups] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status_id', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['priority_id', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['category_id', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['department_id', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['type', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['created_by_user_id', 'completion_timing', 'is_overdue'], where, _count: { _all: true } }),
    ]);
    const statusFold = this.foldTimingGroups(statusGroups, 'status_id');
    const priorityFold = this.foldTimingGroups(priorityGroups, 'priority_id');
    const categoryFold = this.foldTimingGroups(categoryGroups, 'category_id');
    const deptFold = this.foldTimingGroups(deptGroups, 'department_id');
    const typeFold = this.foldTimingGroups(typeGroups, 'type');
    const assignerFold = this.foldTimingGroups(assignerGroups, 'created_by_user_id');

    const [statuses, priorities, categories, depts, assignerNames] = await Promise.all([
      this.prisma.taskStatus.findMany({ where: { organization_id: orgId }, select: { id: true, label: true, color: true, type: true, order_index: true } }),
      this.prisma.taskPriority.findMany({ where: { organization_id: orgId }, select: { id: true, label: true, color: true, order_index: true } }),
      this.prisma.taskCategory.findMany({ where: { organization_id: orgId }, select: { id: true, name: true, color: true } }),
      this.prisma.department.findMany({ where: { id: { in: [...deptFold.keys()] } }, select: { id: true, name: true, color: true } }),
      this.enrichUserNames([...assignerFold.keys()]),
    ]);
    const statusMap = new Map(statuses.map((s) => [s.id, s]));
    const priorityMap = new Map(priorities.map((p) => [p.id, p]));
    const categoryMap = new Map(categories.map((c2) => [c2.id, c2]));
    const deptMap = new Map(depts.map((d) => [d.id, d]));
    const f = (m: Map<string, any>, id: string) => m.get(id) ?? { total: 0, timing: this.emptyTiming() };

    return {
      by_status: statuses
        .filter((s) => statusFold.has(s.id))
        .map((s) => ({ id: s.id, label: s.label, color: s.color, type: s.type, order_index: s.order_index, total: f(statusFold, s.id).total, timing: f(statusFold, s.id).timing }))
        .sort((a, b) => a.order_index - b.order_index),
      by_priority: priorities
        .filter((p) => priorityFold.has(p.id))
        .map((p) => ({ id: p.id, label: p.label, color: p.color, order_index: p.order_index, total: f(priorityFold, p.id).total, timing: f(priorityFold, p.id).timing }))
        .sort((a, b) => a.order_index - b.order_index),
      by_category: [...categoryFold.entries()].map(([id, v]) => {
        const cat = categoryMap.get(id);
        return { id, label: cat?.name ?? 'Uncategorized', color: cat?.color ?? '#94A3B8', total: v.total, timing: v.timing };
      }).sort((a, b) => b.total - a.total),
      by_department: [...deptFold.entries()].map(([id, v]) => {
        const d = deptMap.get(id);
        return { id, label: d?.name ?? 'Unassigned', color: d?.color ?? '#94A3B8', total: v.total, timing: v.timing };
      }).sort((a, b) => b.total - a.total),
      by_type: [...typeFold.entries()].map(([id, v]) => ({ id, label: id, total: v.total, timing: v.timing })),
      by_assigner: [...assignerFold.entries()]
        .map(([id, v]) => ({ id, label: assignerNames.get(id)?.name ?? 'Unknown', total: v.total, timing: v.timing }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12),
    };
  }

  public async enrichUserNames(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, { id: string; name: string; email: string }>();
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  public async peopleDimensions(orgId: string, where: any) {
    const timingGroups = await Promise.all(
      TasksAnalyticsService.TIMINGS.map((t) =>
        this.prisma.taskAssignee.groupBy({
          by: ['user_id'],
          // Work Overview is a live-workload dashboard (not one of the three compliance
          // reports), so it counts only tasks each person currently holds.
          where: { ...ACTIVE_ASSIGNEE, is_cc: false, task: { ...where, ...this.timingWhere(t) } },
          _count: { _all: true },
        }),
      ),
    );
    const byUser = new Map<string, { total: number; timing: ReturnType<TasksAnalyticsService['emptyTiming']> }>();
    TasksAnalyticsService.TIMINGS.forEach((t, i) => {
      for (const g of timingGroups[i]) {
        let e = byUser.get(g.user_id);
        if (!e) { e = { total: 0, timing: this.emptyTiming() }; byUser.set(g.user_id, e); }
        e.total += g._count._all;
        e.timing[t] += g._count._all;
      }
    });

    const [names, profiles] = await Promise.all([
      this.enrichUserNames([...byUser.keys()]),
      this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, user_id: { in: [...byUser.keys()] } },
        select: { user_id: true, role: { select: { id: true, title: true } } },
      }),
    ]);
    const roleOf = new Map(profiles.map((p) => [p.user_id, p.role]));

    const by_assignee = [...byUser.entries()]
      .map(([id, v]) => ({ id, label: names.get(id)?.name ?? 'Unknown', total: v.total, timing: v.timing }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    const byRole = new Map<string, { label: string; total: number; timing: ReturnType<TasksAnalyticsService['emptyTiming']> }>();
    for (const [uid, v] of byUser.entries()) {
      const role = roleOf.get(uid);
      const key = role?.id ?? '__none__';
      let e = byRole.get(key);
      if (!e) { e = { label: role?.title ?? 'No role', total: 0, timing: this.emptyTiming() }; byRole.set(key, e); }
      e.total += v.total;
      (Object.keys(v.timing) as (keyof typeof v.timing)[]).forEach((k) => (e!.timing[k] += v.timing[k]));
    }
    const by_role = [...byRole.entries()]
      .map(([id, v]) => ({ id: id === '__none__' ? null : id, label: v.label, total: v.total, timing: v.timing }))
      .sort((a, b) => b.total - a.total);

    return { by_assignee, by_role };
  }

  public async trendSeries(where: any, now: Date, weeks = 8) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - start.getDay());
    const baseWhere = { ...where };
    delete baseWhere.created_at;
    const buckets = Array.from({ length: weeks }, (_, i) => {
      const from = new Date(start); from.setDate(from.getDate() - (weeks - 1 - i) * 7);
      const to = new Date(from); to.setDate(to.getDate() + 7);
      return { from, to };
    });
    return Promise.all(
      buckets.map(async ({ from, to }) => {
        const [created, completed, on_time] = await Promise.all([
          this.prisma.task.count({ where: { ...baseWhere, created_at: { gte: from, lt: to } } }),
          this.prisma.task.count({ where: { ...baseWhere, status: { type: 'completed' }, updated_at: { gte: from, lt: to } } }),
          this.prisma.task.count({ where: { ...baseWhere, completion_timing: { in: ['early', 'on_time'] }, updated_at: { gte: from, lt: to } } }),
        ]);
        return { week: from.toISOString().slice(0, 10), created, completed, on_time };
      }),
    );
  }

  public async trendMonthlySeries(where: any, now: Date, months = 8) {
    const baseWhere = { ...where };
    delete baseWhere.created_at;
    const buckets = Array.from({ length: months }, (_, i) => {
      const from = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      return { from, to };
    });
    return Promise.all(
      buckets.map(async ({ from, to }) => {
        const window = { deadline: { gte: from, lt: to } };
        const [due, completed, on_time] = await Promise.all([
          this.prisma.task.count({ where: { ...baseWhere, ...window } }),
          this.prisma.task.count({ where: { ...baseWhere, ...window, status: { type: 'completed' } } }),
          this.prisma.task.count({ where: { ...baseWhere, ...window, completion_timing: { in: ['early', 'on_time'] } } }),
        ]);
        return { month: from.toISOString().slice(0, 10), due, completed, on_time, on_time_rate: completed ? Math.round((on_time / completed) * 100) : null };
      }),
    );
  }
}
