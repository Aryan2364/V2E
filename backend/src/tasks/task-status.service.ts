import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { CompletionMode, CompletionTiming } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowTaskEventsService } from '../workflows/workflow-task-events.service';
import { ProjectProgressService } from '../projects/project-progress.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { isTerminal } from './status-phase';
import { gradingDeadline } from './active-assignee';
import { TaskAccessService } from './task-access.service';
import { TaskDetailService } from './task-detail.service';

/** Status roll-up and settle for task assignee parts. */
@Injectable()
export class TaskStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowTaskEventsService,
    private readonly projectProgressService: ProjectProgressService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskDetail: TaskDetailService,
  ) {}

  async rollUpTaskOpenStatus(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      include: { status: true, assignees: true },
    });
    if (!task || task.completion_mode !== CompletionMode.all_must_complete)
      return;
    if (isTerminal(task.status.type)) return;

    const workers = task.assignees.filter((a) => !a.is_cc);
    const trackIds = [
      ...new Set(
        workers.map((a) => a.status_id).filter((id): id is string => !!id),
      ),
    ];
    const trackStatuses = trackIds.length
      ? await this.prisma.taskStatus.findMany({
          where: { id: { in: trackIds } },
          select: { id: true, type: true },
        })
      : [];
    const typeById = new Map(trackStatuses.map((s) => [s.id, s.type]));

    const anyStarted = workers.some(
      (a) =>
        a.is_completed ||
        (a.status_id != null && typeById.get(a.status_id) === 'in_progress'),
    );
    const { notStarted, inProgress } =
      await this.taskAccess.getCanonicalStatuses(orgId);
    const targetId = anyStarted
      ? (inProgress?.id ?? notStarted?.id)
      : notStarted?.id;
    if (targetId && targetId !== task.status_id) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status_id: targetId },
      });
    }
  }

  /** Find the org's "Partially Completed" terminal status, creating it if missing (self-heal). */
  async ensurePartialStatus(orgId: string) {
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

  async settleAllMustComplete(
    orgId: string,
    taskId: string,
    actorId: string,
  ): Promise<'open' | 'completed' | 'partial' | 'incomplete'> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      include: { assignees: true, status: true },
    });
    if (!task || task.completion_mode !== CompletionMode.all_must_complete)
      return 'open';
    if (isTerminal(task.status.type)) return 'open';

    // Proof invariant: no extra proof check is needed here. Every `is_completed`
    // worker already passed the per-person proof gate in completeTask at the moment
    // they finished, and `cannot_complete` parts never require proof.
    const workers = task.assignees.filter((a) => !a.is_cc);
    const allResponded =
      workers.length > 0 &&
      workers.every((a) => a.is_completed || a.cannot_complete);
    if (!allResponded) {
      await this.rollUpTaskOpenStatus(orgId, taskId);
      return 'open';
    }

    const completedCount = workers.filter((a) => a.is_completed).length;
    const cannotCount = workers.filter((a) => a.cannot_complete).length;
    const outcome: 'completed' | 'partial' | 'incomplete' =
      cannotCount === 0
        ? 'completed'
        : completedCount === 0
          ? 'incomplete'
          : 'partial';

    const { completed, incomplete } =
      await this.taskAccess.getCanonicalStatuses(orgId);
    const statusRow =
      outcome === 'completed'
        ? completed
        : outcome === 'incomplete'
          ? incomplete
          : await this.ensurePartialStatus(orgId);
    if (!statusRow) {
      await this.rollUpTaskOpenStatus(orgId, taskId);
      return 'open';
    }

    const config = await this.taskAccess.getOrgConfig(orgId);
    const now = new Date();
    const completionNow = await this.clock.now(orgId);
    const timing =
      outcome === 'completed'
        ? this.taskAccess.completionTiming(completionNow, gradingDeadline(task))
        : outcome === 'partial'
          ? CompletionTiming.partial
          : CompletionTiming.incomplete;
    const summary =
      outcome === 'completed'
        ? null
        : `${completedCount} of ${workers.length} completed; ${cannotCount} couldn’t.`;

    // Optimistic close: only settle if the status is still what we read above. When two
    // people finish at the same instant, exactly ONE settle wins — the loser skips the
    // duplicate notification and workflow/project advance instead of double-firing.
    const settled = await this.prisma.task.updateMany({
      where: { id: taskId, status_id: task.status_id },
      data: {
        status_id: statusRow.id,
        reopen_expires_at: new Date(
          now.getTime() + config.reopen_window_minutes * 60_000,
        ),
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
      await this.taskAccess.logActivity(
        orgId,
        taskId,
        actorId,
        'marked_incomplete',
        { auto: true, outcome, reason: summary },
      );
    }

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type:
        outcome === 'completed' ? 'task_completed' : 'task_incomplete',
      recipients: [
        task.created_by_user_id,
        ...workers.map((a) => a.user_id),
      ].filter((uid) => uid !== actorId),
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

    // Workflow: completion advances the task's step; an unfinished close parks its
    // run as stuck. Never throws.
    if (outcome === 'completed') {
      await this.workflowEngine.onTaskCompleted(orgId, taskId);
    } else if (task.workflow_instance_step_id) {
      await this.workflowEngine.onTaskClosedIncomplete(orgId, taskId);
    }
    const projectTask = await this.prisma.projectTask.findFirst({
      where: { task_id: taskId },
    });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(
        projectTask.project_id,
      );
    }

    return outcome;
  }

  /**
   * Set one assignee's personal status track (all_must_complete mode). Actor may set
   * their OWN track; the creator / an editor may set anyone's. Open states only —
   * finishing a part goes through completeTask.
   */

  async setAssigneeStatus(
    orgId: string,
    actorId: string,
    taskId: string,
    targetUserId: string,
    statusId: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException(
        'Per-person status only applies to "all must complete" tasks.',
      );
    }
    // A closed task's scoreboard is a frozen record — a later personal-status change
    // must never clear someone's done flag underneath a Completed task.
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException(
        'This task is closed. Reopen it before changing anyone’s status.',
      );
    }

    const isSelf = actorId === targetUserId;
    if (!isSelf) {
      await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    } else {
      const onTask = (task.assignees ?? []).some(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
      if (!onTask)
        throw new ForbiddenException(
          'Only someone on this task can change their status.',
        );
    }

    const target = (task.assignees ?? []).find(
      (a: any) => a.user_id === targetUserId && !a.is_cc,
    );
    if (!target)
      throw new BadRequestException(
        'That person is not a working assignee on this task.',
      );

    const st = await this.prisma.taskStatus.findFirst({
      where: { id: statusId, organization_id: orgId, is_active: true },
    });
    if (!st) throw new BadRequestException('Status not found or inactive');
    if (isTerminal(st.type)) {
      throw new BadRequestException(
        'To finish a part, use Complete — the status control only moves between open states.',
      );
    }

    const wasCompleted = target.is_completed;
    await this.prisma.taskAssignee.update({
      where: { id: target.id },
      // Moving a finished part back to an open state re-opens that person's part.
      data: {
        status_id: statusId,
        ...(wasCompleted ? { is_completed: false, completed_at: null } : {}),
      },
    });

    await this.rollUpTaskOpenStatus(orgId, taskId);

    const targetName = await this.notifications.userName(targetUserId);
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'status_changed',
      {
        changes: [
          { field: 'assignee_status', assignee: targetUserId, to: st.label },
        ],
      },
    );
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_status_changed',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? [])
          .filter((a: any) => !a.is_cc)
          .map((a: any) => a.user_id),
      ].filter((uid) => uid !== actorId),
      title: `${targetName}’s status is now ${st.label}`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * all_must_complete: the assigner (creator/editor) reopens ONE person's finished part —
   * e.g. the work wasn't good enough — without disturbing the co-assignees who legitimately
   * finished. Bounces that person back to In Progress with an optional note. Works whether
   * the task is still open (others pending) or already closed: on a closed task it brings the
   * WHOLE task back to open (only that person reset), mirroring challengeChecklistItem, and
   * bypasses the reopen window (an assigner can always send a part back for rework).
   */

  async reopenAssigneePart(
    orgId: string,
    actorId: string,
    taskId: string,
    targetUserId: string,
    reason?: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException(
        'Reopening one person’s part only applies to “all must complete” tasks.',
      );
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
        await this.taskAccess.assertAssignerRights(orgId, actorId, task);
      }
    }
    const part = (task.assignees ?? []).find(
      (a: any) => a.user_id === targetUserId && !a.is_cc,
    );
    if (!part)
      throw new BadRequestException(
        'That person is not a working assignee on this task.',
      );
    // Reopenable when the part is finished either way: completed (rework), or closed as
    // can't-complete (reopen it so they can pick the work back up).
    if (!part.is_completed && !part.cannot_complete) {
      throw new BadRequestException(
        'That person’s part isn’t finished, so there’s nothing to reopen.',
      );
    }

    const trimmed = (reason ?? '').trim() || null;
    const { notStarted, inProgress } =
      await this.taskAccess.getCanonicalStatuses(orgId);
    const openStatusId = inProgress?.id ?? notStarted?.id ?? null;

    // Reopen ONLY that person's part — clear a completion AND any can't-complete flag
    // (keep their proof; they may just be refining it).
    await this.prisma.taskAssignee.updateMany({
      where: {
        task_id: taskId,
        user_id: targetUserId,
        is_cc: false,
        ...ACTIVE_ASSIGNEE,
      },
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

    // Workflow: a closed step task is open again → roll its run back (never throws).
    if (
      isTerminal((task as any).status?.type) &&
      task.workflow_instance_step_id
    ) {
      await this.workflowEngine.onTaskReopened(orgId, taskId, actorId);
    }

    await this.taskAccess.logActivity(orgId, taskId, actorId, 'reopened', {
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
      body: trimmed
        ? `“${task.title}”\n${trimmed}`
        : `“${task.title}” — please revisit your part.`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * Move the single shared status (any_can_complete mode). Any working assignee — not
   * just the creator — may move it; the change applies to everyone and records who did it.
   */

  async setSharedStatus(
    orgId: string,
    actorId: string,
    taskId: string,
    statusId: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    if (task.completion_mode !== CompletionMode.any_can_complete) {
      throw new BadRequestException(
        'Shared status only applies to "any can complete" tasks.',
      );
    }

    const isParticipant =
      task.created_by_user_id === actorId ||
      (task.assignees ?? []).some(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
    if (!isParticipant) {
      await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    }

    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException('Reopen the task to change its status.');
    }
    const st = await this.prisma.taskStatus.findFirst({
      where: { id: statusId, organization_id: orgId, is_active: true },
    });
    if (!st) throw new BadRequestException('Status not found or inactive');
    if (isTerminal(st.type)) {
      throw new BadRequestException(
        'To close a task, use the Complete action — the status control only moves between open states.',
      );
    }

    if (statusId !== task.status_id) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status_id: statusId, status_actor_user_id: actorId },
      });
      const actorName = await this.notifications.userName(actorId);
      await this.taskAccess.logActivity(
        orgId,
        taskId,
        actorId,
        'status_changed',
        {
          changes: [{ field: 'status_id', from: task.status_id, to: statusId }],
        },
      );
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_status_changed',
        recipients: [
          task.created_by_user_id,
          ...(task.assignees ?? [])
            .filter((a: any) => !a.is_cc)
            .map((a: any) => a.user_id),
        ].filter((uid) => uid !== actorId),
        title: `${actorName} moved a task to ${st.label}`,
        body: `“${task.title}”`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * A linked goal must be a real goal in THIS org — otherwise a pasted foreign id
   * becomes a stored cross-tenant reference. Empty/undefined skips.
   */
}
