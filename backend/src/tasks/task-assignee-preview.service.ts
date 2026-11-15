import { Injectable } from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { PrismaService } from '../prisma/prisma.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { LeaveService } from '../leave/leave.service';
import { ClockService } from '../clock/clock.service';
import { TERMINAL_TYPES } from './status-phase';

/** Assignee eligibility and preview. */
@Injectable()
export class TaskAssigneePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly leave: LeaveService,
    private readonly clock: ClockService,
  ) {}

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
    const activeTasks =
      eligibleUserIdArray.length > 0
        ? await this.prisma.taskAssignee.findMany({
            where: {
              organization_id: orgId,
              is_cc: false,
              ...ACTIVE_ASSIGNEE,
              user_id: { in: eligibleUserIdArray },
              task: {
                is_deleted: false,
                status: { type: { notIn: TERMINAL_TYPES } },
              },
            },
            select: { user_id: true },
          })
        : [];

    const activeTaskMap = new Map<string, number>();
    for (const ta of activeTasks) {
      activeTaskMap.set(ta.user_id, (activeTaskMap.get(ta.user_id) ?? 0) + 1);
    }

    // Get frequency counts
    const frequencies =
      eligibleUserIdArray.length > 0
        ? await this.prisma.taskAssigneeFrequency.findMany({
            where: {
              organization_id: orgId,
              assigner_user_id: userId,
              assignee_user_id: { in: eligibleUserIdArray },
            },
            select: { assignee_user_id: true, frequency_count: true },
          })
        : [];
    const frequencyMap = new Map(
      frequencies.map((f) => [f.assignee_user_id, f.frequency_count]),
    );

    // Top 3 by frequency = is_frequent
    const sortedFreq = [...frequencyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const frequentUserIds = new Set(
      sortedFreq.filter(([, c]) => c > 0).map(([id]) => id),
    );

    // Who is on leave right now (sim-clock aware) — annotates the picker, never filters it.
    const now = await this.clock.now(orgId);
    const onLeaveMap = await this.leave.onLeaveTodayMap(
      orgId,
      eligibleUserIdArray,
      now,
    );

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
      sorted = items.sort(
        (a, b) =>
          b.frequency_count - a.frequency_count || a.name.localeCompare(b.name),
      );
    } else if (sort === 'workload') {
      sorted = items.sort(
        (a, b) =>
          a.active_task_count - b.active_task_count ||
          a.name.localeCompare(b.name),
      );
    } else {
      sorted = items.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Group by department (flat list when searching)
    if (search?.trim()) {
      return {
        departments: [
          {
            department_id: 'search',
            department_name: 'Results',
            users: sorted,
          },
        ],
        total: sorted.length,
      };
    }

    const deptMap = new Map<
      string,
      { department_id: string; department_name: string; users: typeof items }
    >();
    for (const item of sorted) {
      if (!deptMap.has(item.department_id)) {
        deptMap.set(item.department_id, {
          department_id: item.department_id,
          department_name: item.department_name,
          users: [],
        });
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

  async getEmployeeAssigneePreview(
    orgId: string,
    targetUserId: string,
    search?: string,
  ) {
    const [{ pool, trace, provenance, removed }, profileMap, override] =
      await Promise.all([
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
            task: {
              is_deleted: false,
              status: { type: { notIn: TERMINAL_TYPES } },
            },
          },
          select: { user_id: true },
        })
      : [];
    const activeTaskMap = new Map<string, number>();
    for (const ta of activeTasks)
      activeTaskMap.set(ta.user_id, (activeTaskMap.get(ta.user_id) ?? 0) + 1);

    const frequencies = ids.length
      ? await this.prisma.taskAssigneeFrequency.findMany({
          where: {
            organization_id: orgId,
            assigner_user_id: targetUserId,
            assignee_user_id: { in: ids },
          },
          select: { assignee_user_id: true, frequency_count: true },
        })
      : [];
    const frequencyMap = new Map(
      frequencies.map((f) => [f.assignee_user_id, f.frequency_count]),
    );
    const frequentUserIds = new Set(
      [...frequencyMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .filter(([, c]) => c > 0)
        .map(([id]) => id),
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

    const deptMap = new Map<
      string,
      { department_id: string; department_name: string; users: typeof items }
    >();
    for (const item of items) {
      if (!deptMap.has(item.department_id)) {
        deptMap.set(item.department_id, {
          department_id: item.department_id,
          department_name: item.department_name,
          users: [],
        });
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
        : {
            user_id: targetUserId,
            name: 'Unknown',
            role_title: '',
            department_id: '',
            department_name: '',
          },
      trace,
      override,
      departments: Array.from(deptMap.values()),
      removed: removedItems,
      total: items.length,
    };
  }

}
