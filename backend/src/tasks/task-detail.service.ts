import { Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { ChecklistItemState, CompletionMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { Principal } from '../access-rights/permissions.service';
import { taskWorkflowInfo } from '../workflows/task-workflow-info';
import { isTerminal } from './status-phase';
import { TASK_INCLUDE, withTagRefs } from './task-shared';
import { TaskAccessService } from './task-access.service';

/** Single-task read (getTask) and list enrichment. */
@Injectable()
export class TaskDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly taskAccess: TaskAccessService,
  ) {}

  async computeUnreadComments(
    viewerId: string,
    taskIds: string[],
  ): Promise<Map<string, number>> {
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
        where: {
          task_id: { in: taskIds },
          is_deleted: false,
          user_id: { not: viewerId },
        },
        select: { task_id: true, created_at: true },
      }),
    ]);
    const lastViewed = new Map(
      views.map((v) => [v.task_id, v.last_viewed_at.getTime()]),
    );
    for (const c of comments) {
      if (!c.task_id) continue;
      const seenAt = lastViewed.get(c.task_id) ?? 0; // never opened → everything is unread
      if (c.created_at.getTime() > seenAt) {
        result.set(c.task_id, (result.get(c.task_id) ?? 0) + 1);
      }
    }
    return result;
  }

  /**
   * The viewer for a task list's workflow badges: the principal when the caller has
   * one, else the user (admin flag read from their membership of the tasks' org).
   */

  async workflowViewer(tasks: any[], viewerId?: string, principal?: Principal) {
    if (principal)
      return {
        userId: principal.userId,
        isAdmin: !!(principal.isAdmin || principal.isSuperAdmin),
      };
    if (!viewerId) return null;
    const orgId = tasks.find(
      (t) => t.workflow_instance_step_id,
    )?.organization_id;
    if (!orgId) return { userId: viewerId, isAdmin: false };
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: { organization_id: orgId, user_id: viewerId },
      },
      select: { is_admin: true },
    });
    return { userId: viewerId, isAdmin: !!member?.is_admin };
  }

  async enrichTaskList(tasks: any[], viewerId?: string, principal?: Principal) {
    const allUserIds = new Set<string>();
    const allOrgIds = new Set<string>();
    for (const task of tasks) {
      task.organization_id && allOrgIds.add(task.organization_id);
      task.created_by_user_id && allUserIds.add(task.created_by_user_id);
      for (const a of task.assignees ?? []) allUserIds.add(a.user_id);
    }
    const userIds = Array.from(allUserIds);
    const unreadMap = viewerId
      ? await this.computeUnreadComments(
          viewerId,
          tasks.map((t) => t.id),
        )
      : new Map<string, number>();
    // Profiles are per-org, so key them by org+user (collective view spans orgs).
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.employeeProfile.findMany({
        where: {
          organization_id: { in: Array.from(allOrgIds) },
          user_id: { in: userIds },
        },
        select: {
          organization_id: true,
          user_id: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(
      profiles.map((p) => [`${p.organization_id}:${p.user_id}`, p]),
    );
    // Workflow badges (the instance label), batched for the whole list.
    const workflowInfo = tasks.some((t) => t.workflow_instance_step_id)
      ? await taskWorkflowInfo(
          this.prisma,
          tasks,
          await this.workflowViewer(tasks, viewerId, principal),
          (orgId) => this.clock.now(orgId),
        )
      : new Map();

    return tasks.map((task) => ({
      ...withTagRefs(task),
      created_by: userMap.get(task.created_by_user_id) ?? null,
      /** Set when a workflow created the task (show the instance badge, not "From <assigner>"). */
      workflow: workflowInfo.get(task.id) ?? null,
      unread_comments: unreadMap.get(task.id) ?? 0,
      assignees: (task.assignees ?? []).map((a: any) => {
        const u = userMap.get(a.user_id);
        const p = profileMap.get(`${task.organization_id}:${a.user_id}`);
        return {
          ...a,
          user: u
            ? {
                ...u,
                department: p?.department?.name ?? null,
                role_title: p?.role?.title ?? null,
              }
            : null,
        };
      }),
    }));
  }

  /**
   * Map of taskId → whether the task is in a "completed"-type status.
   * Used by other modules (e.g. Meetings action items) to compute done-ness.
   */

  async areCompleted(
    orgId: string,
    taskIds: string[],
  ): Promise<Record<string, boolean>> {
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
    if (!task) throw new NotFoundException('Task not found');

    // Authorization (external callers only — internal post-mutation reads pass no
    // principal). Reuses the already-fetched participants to avoid a second query.
    if (principal) {
      await this.taskAccess.assertParticipantView(
        orgId,
        principal,
        task.created_by_user_id,
        task.assignees,
        {
          taskId,
          workflowInstanceStepId: task.workflow_instance_step_id,
        },
      );

      // Opening the task marks it read for this user — clears its unread-comment badge.
      // Use the org clock so it lines up with comment timestamps on a test org.
      const viewedAt = await this.clock.now(orgId);
      await this.prisma.taskView.upsert({
        where: {
          task_id_user_id: { task_id: taskId, user_id: principal.userId },
        },
        create: {
          organization_id: orgId,
          task_id: taskId,
          user_id: principal.userId,
          last_viewed_at: viewedAt,
        },
        update: { last_viewed_at: viewedAt },
      });
    }

    // People taken OFF this task. Deliberately fetched apart from the live roster —
    // `TASK_INCLUDE` filters them out so no gate, count or notification can pick them
    // up by accident — but they belong on the screen: "Removed on 7 Sep by X" is the
    // record that stops a removal from quietly erasing what someone did here.
    const removedAssignees = await this.prisma.taskAssignee.findMany({
      where: {
        task_id: taskId,
        organization_id: orgId,
        removed_at: { not: null },
      },
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
    for (const r of (task as any).deadline_revisions ?? [])
      allUserIds.add(r.changed_by_user_id);
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
    const liveWorkerIds = task.assignees
      .filter((a) => !a.is_cc)
      .map((a) => a.user_id);
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
    const { notStarted } = await this.taskAccess.getCanonicalStatuses(orgId);
    const trackIds = [
      ...new Set(
        task.assignees
          .map((a) => a.status_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const trackStatuses = trackIds.length
      ? await this.prisma.taskStatus.findMany({
          where: { id: { in: trackIds } },
        })
      : [];
    const statusById = new Map<string, any>(
      trackStatuses.map((s) => [s.id, s]),
    );
    const now = await this.clock.now(orgId);
    const taskIsTerminal = isTerminal((task as any).status?.type);
    const nameOf = (id: string | null) =>
      id ? (userMap.get(id) ?? null) : null;

    const enrichedAssignees = task.assignees.map((a) => {
      const track = a.status_id
        ? (statusById.get(a.status_id) ?? notStarted)
        : notStarted;
      // Per-person overdue: the deadline has passed and this person is not yet finished.
      // "Finished" is their own completion (all_must_complete) or the whole task being closed.
      const done =
        task.completion_mode === CompletionMode.all_must_complete
          ? a.is_completed
          : taskIsTerminal;
      const is_overdue =
        !a.is_cc && !!task.deadline && task.deadline < now && !done;
      return {
        ...a,
        user: userMap.get(a.user_id) ?? null,
        status: a.is_cc ? null : (track ?? null),
        is_overdue,
      };
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
      const mine = principal
        ? states.find((s) => s.user_id === principal.userId)
        : undefined;
      return {
        ...c,
        completed_by: c.completed_by_user_id
          ? (userMap.get(c.completed_by_user_id) ?? null)
          : null,
        states,
        done_count: states.filter((s) => s.state === ChecklistItemState.done)
          .length,
        skipped_count: states.filter(
          (s) => s.state === ChecklistItemState.skipped,
        ).length,
        assignee_count: workerCount,
        my_state: mine?.state ?? null,
        my_reason: mine?.reason ?? null,
      };
    });

    // Proof-of-completion scoreboard: who must submit (non-CC assignees) vs who has.
    // Names only, no files — safe for everyone; the "n/N submitted" badge reads from it.
    const proof_summary = task.proof_required
      ? await this.proofSummary(orgId, taskId)
      : null;
    const workflowInfo = task.workflow_instance_step_id
      ? await taskWorkflowInfo(
          this.prisma,
          [task],
          principal
            ? {
                userId: principal.userId,
                isAdmin: !!(principal.isAdmin || principal.isSuperAdmin),
              }
            : null,
          (id) => this.clock.now(id),
        )
      : null;

    return {
      ...withTagRefs(task),
      created_by: userMap.get(task.created_by_user_id) ?? null,
      /** Set when a workflow created the task: "Assigned by Workflow: <label>", set up by `created_by`. */
      workflow: workflowInfo?.get(task.id) ?? null,
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
      deadline_revisions: ((task as any).deadline_revisions ?? []).map(
        (r: any) => ({
          ...r,
          changed_by: nameOf(r.changed_by_user_id),
        }),
      ),
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
            return {
              ...r,
              user_name: ru?.name ?? null,
              user_email: ru?.email ?? null,
              user: ru ?? null,
            };
          }),
        };
      }),
    };
  }

  // ─── Update Task ──────────────────────────────────────────────────────────────

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
      new Set(
        proofs
          .map((p) => p.uploaded_by_user_id)
          .filter((id) => requiredSet.has(id)),
      ),
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

}
