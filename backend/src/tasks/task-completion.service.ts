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
import { COMPLETION_NOTICE_HOLD_MS } from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskStatusService } from './task-status.service';
import { TaskDetailService } from './task-detail.service';
import { TaskChecklistService } from './task-checklist.service';

/** Complete / reopen / mark incomplete. */
@Injectable()
export class TaskCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowTaskEventsService,
    private readonly projectProgressService: ProjectProgressService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskStatus: TaskStatusService,
    private readonly taskDetail: TaskDetailService,
    private readonly taskChecklist: TaskChecklistService,
  ) {}

  async completeTask(
    orgId: string,
    userId: string,
    taskId: string,
    targetUserId?: string,
    closeWholeTask = false,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    // A closed outcome is locked — Completed can never be stacked on top of
    // Incomplete / Partially Completed. Reopen first (the rule every screen shows).
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException(
        'This task is already closed. Reopen it first to change its outcome.',
      );
    }
    const config = await this.taskAccess.getOrgConfig(orgId);

    // Who is being marked done. Self by default; a creator/editor may finish another
    // assignee's part (all_must_complete) on their behalf.
    const target = targetUserId ?? userId;
    // The owner override (closeWholeTask, all_must) and acting on someone else's part
    // are assigner actions: creator, admin, or a scope-verified editor.
    if (closeWholeTask || target !== userId) {
      await this.taskAccess.assertAssignerRights(orgId, userId, task);
    } else {
      // Finishing "your own part" (or closing an any_can task) requires you to actually
      // BE on the task — knowing a task's id must never be enough to complete it.
      const isCreator = task.created_by_user_id === userId;
      const isWorker = (task.assignees ?? []).some(
        (a: any) => a.user_id === userId && !a.is_cc,
      );
      if (
        !isCreator &&
        !isWorker &&
        !(await this.taskAccess.isOrgAdmin(orgId, userId))
      ) {
        throw new ForbiddenException(
          'Only someone on this task can complete it.',
        );
      }
    }
    // all_must: the part being finished must belong to a working assignee.
    if (
      task.completion_mode === CompletionMode.all_must_complete &&
      !closeWholeTask
    ) {
      const part = (task.assignees ?? []).find(
        (a: any) => a.user_id === target && !a.is_cc,
      );
      if (!part)
        throw new BadRequestException(
          'That person is not a working assignee on this task.',
        );
    }

    // Proof of completion is enforced PER MODE below — any_can: any single proof on
    // the task; all_must: the finishing person's OWN proof. The owner force-close
    // (closeWholeTask) is a deliberate admin override and bypasses the proof gate.
    const proof = task.proof_required
      ? await this.taskDetail.proofSummary(orgId, taskId)
      : null;

    const completedStatus = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'completed', is_active: true },
      orderBy: { order_index: 'asc' },
    });

    // Owner override (all_must_complete): close the WHOLE task for everyone at once —
    // marks every outstanding part done and clears any can't-complete flags. This
    // intentionally bypasses the per-person proof gate (admin escape hatch).
    if (
      task.completion_mode === CompletionMode.all_must_complete &&
      closeWholeTask
    ) {
      // Parts + task status commit together.
      await this.prisma.$transaction(async (tx) => {
        await tx.taskAssignee.updateMany({
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
          const reopenExpiresAt = new Date(
            now.getTime() + config.reopen_window_minutes * 60_000,
          );
          await tx.task.update({
            where: { id: taskId },
            data: {
              status_id: completedStatus.id,
              reopen_expires_at: reopenExpiresAt,
              completed_at: completionNow,
              completion_timing: this.taskAccess.completionTiming(
                completionNow,
                gradingDeadline(task),
              ),
              completed_by_user_id: userId,
              // Delayed "task completed" notification — see the sweep (processPendingCompletionNotifications)
              // below. Cleared by reopenTask's within-window undo.
              pending_completion_notification_at: new Date(
                now.getTime() + COMPLETION_NOTICE_HOLD_MS,
              ),
            },
          });
        }
      });
    } else if (task.completion_mode === CompletionMode.all_must_complete) {
      // Combined close gate — report EVERY outstanding requirement at once (checklist +
      // proof), so the person isn't told them one at a time. (The owner override above
      // force-closes and skips this.)
      {
        const missing: string[] = [];
        const cl = await this.taskChecklist.checklistRemainingForUser(
          orgId,
          taskId,
          target,
        );
        if (cl > 0)
          missing.push(
            `tick ${cl} checklist item${cl > 1 ? 's' : ''} (or mark “can’t do” with a reason)`,
          );
        if (proof && !proof.submitted_user_ids.includes(target))
          missing.push('attach your proof of completion');
        if (missing.length) {
          throw new BadRequestException(
            `Before finishing your part you still need to: ${this.taskChecklist.joinRequirements(missing)}.`,
          );
        }
      }
      // Mark this person's part done — and clear any earlier can't-complete flag,
      // since finishing supersedes it.
      await this.prisma.taskAssignee.updateMany({
        where: {
          task_id: taskId,
          user_id: target,
          is_cc: false,
          ...ACTIVE_ASSIGNEE,
        },
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
      await this.taskAccess.logActivity(orgId, taskId, target, 'completed', {
        part: true,
      });
      await this.taskStatus.settleAllMustComplete(orgId, taskId, target);
      return this.taskDetail.getTask(orgId, taskId);
    } else {
      // any_can_complete — one person closes the whole task for everyone. Report EVERY
      // outstanding requirement at once (shared checklist + proof).
      {
        const missing: string[] = [];
        const cl = await this.taskChecklist.sharedChecklistRemaining(
          orgId,
          taskId,
        );
        if (cl > 0)
          missing.push(
            `tick ${cl} checklist item${cl > 1 ? 's' : ''} (or mark “can’t do” with a reason)`,
          );
        if (proof && !proof.task_has_any_proof)
          missing.push('attach proof of completion');
        if (missing.length) {
          throw new BadRequestException(
            `Before completing this task you still need to: ${this.taskChecklist.joinRequirements(missing)}.`,
          );
        }
      }
      // Task close + the closer's own completion stamp commit together.
      await this.prisma.$transaction(async (tx) => {
        if (completedStatus) {
          const now = new Date();
          const completionNow = await this.clock.now(orgId);
          const reopenExpiresAt = new Date(
            now.getTime() + config.reopen_window_minutes * 60_000,
          );
          // Optimistic close: if someone closed (or moved) the task between our read and
          // this write, exactly one completion wins — no double notification/workflow fire.
          const closed = await tx.task.updateMany({
            where: { id: taskId, status_id: task.status_id },
            data: {
              status_id: completedStatus.id,
              reopen_expires_at: reopenExpiresAt,
              completed_at: completionNow,
              completion_timing: this.taskAccess.completionTiming(
                completionNow,
                gradingDeadline(task),
              ),
              completed_by_user_id: userId,
              // Delayed "task completed" notification — see the sweep (processPendingCompletionNotifications)
              // below. Cleared by reopenTask's within-window undo.
              pending_completion_notification_at: new Date(
                now.getTime() + COMPLETION_NOTICE_HOLD_MS,
              ),
            },
          });
          if (closed.count === 0) {
            throw new BadRequestException(
              'This task was just updated by someone else — refresh and try again.',
            );
          }
        }
        await tx.taskAssignee.updateMany({
          where: {
            task_id: taskId,
            user_id: userId,
            is_cc: false,
            ...ACTIVE_ASSIGNEE,
          },
          data: { is_completed: true, completed_at: new Date() },
        });
      });
    }

    await this.taskAccess.logActivity(orgId, taskId, userId, 'completed');

    // The "task completed" notification is DELAYED, not fired here — it was stamped
    // onto `pending_completion_notification_at` above (now + COMPLETION_NOTICE_HOLD_MS) and the
    // processPendingCompletionNotifications sweep below fires it once that time has
    // passed AND the task is still completed (not undone in the meantime). This gives
    // the undo window a clean cancel: reopenTask just clears the timestamp.

    // Workflow: advance this task's step (a no-op for an ordinary task). The engine
    // never throws — a workflow failure parks the run as stuck, it never fails the
    // completion that already happened.
    await this.workflowEngine.onTaskCompleted(orgId, taskId);

    // Recalculate project progress if task is linked to a project
    const projectTask = await this.prisma.projectTask.findFirst({
      where: { task_id: taskId },
    });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(
        projectTask.project_id,
      );
    }

    return this.taskDetail.getTask(orgId, taskId);
  }

  // ─── Reopen Task ──────────────────────────────────────────────────────────────

  async reopenTask(
    orgId: string,
    userId: string,
    taskId: string,
    reason?: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);

    const isCreator = task.created_by_user_id === userId;
    const isAssignee = (task.assignees ?? []).some(
      (a: any) => a.user_id === userId && !a.is_cc,
    );
    // The grace/undo window (config `reopen_window_minutes`): while it is open, a terminal
    // state is soft — any participant can UNDO it with no reason (fixes an accidental
    // Complete/Incomplete). Once it expires the outcome locks: only the creator/admin may
    // reopen, and a reason is required.
    const withinWindow =
      !!task.reopen_expires_at && task.reopen_expires_at > new Date();
    // Still pending = the "completed" notification was never sent, so nobody heard of
    // the completion and a "reopened" ping would only be noise (the phone's Undo).
    const completionNoticePending = !!task.pending_completion_notification_at;

    if (withinWindow) {
      if (
        !isCreator &&
        !isAssignee &&
        !(await this.taskAccess.isOrgAdmin(orgId, userId))
      ) {
        throw new ForbiddenException(
          'Only someone on this task can undo its closure.',
        );
      }
    } else {
      if (!isCreator && !(await this.taskAccess.isOrgAdmin(orgId, userId))) {
        throw new ForbiddenException(
          'The undo window has expired. Only the task creator can reopen this task.',
        );
      }
      if (!reason?.trim()) {
        throw new BadRequestException(
          'A reason is required to reopen a task after the undo window.',
        );
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
    const resetStatusId =
      ongoingStatus?.id ?? defaultStatus?.id ?? task.status_id;

    // Task reset + assignee reset commit together.
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
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
          // Undo (within the window): cancel the delayed "task completed" notification —
          // the sweep re-checks this before firing, but clearing it here means it's never
          // even picked up. A manual reopen after the window has already fired (if it was
          // ever pending), so this is a no-op there.
          pending_completion_notification_at: null,
        },
      });

      // Reset all assignee completion flags, per-person tracks, and any can't-complete flags.
      await tx.taskAssignee.updateMany({
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
    });

    // Re-derive the shared open status from the (now-cleared) tracks so it doesn't
    // linger on a stale In Progress after a per-person task is reopened.
    await this.taskStatus.rollUpTaskOpenStatus(orgId, taskId);

    await this.taskAccess.logActivity(
      orgId,
      taskId,
      userId,
      'reopened',
      reason ? { reason } : undefined,
    );

    // Workflow: a reopened step task rolls its run back to this step (never throws).
    if (task.workflow_instance_step_id) {
      await this.workflowEngine.onTaskReopened(orgId, taskId, userId);
    }

    // Notify assignees + creator (excluding whoever reopened it) — but NOT for a
    // within-window undo: that's cancelling an accidental Complete/Incomplete, not an
    // event worth a "reopened" ping (and the delayed "completed" notification this
    // undo cancelled, above, already covers that side of it).
    if (!completionNoticePending) {
      const reopenerName = await this.notifications.userName(userId);
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_reopened',
        recipients: [
          task.created_by_user_id,
          ...(task.assignees ?? [])
            .filter((a: any) => !a.is_cc)
            .map((a: any) => a.user_id),
        ].filter((uid) => uid !== userId),
        title: `${reopenerName} reopened a task`,
        body: `“${task.title}”${reason ? `\n${reason}` : ''}`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    // Recalculate project progress if task is linked to a project
    const projectTaskReopened = await this.prisma.projectTask.findFirst({
      where: { task_id: taskId },
    });
    if (projectTaskReopened) {
      await this.projectProgressService.recalculateProjectProgress(
        projectTaskReopened.project_id,
      );
    }

    return this.taskDetail.getTask(orgId, taskId);
  }

  async markTaskIncomplete(
    orgId: string,
    userId: string,
    taskId: string,
    reason?: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException(
        'A reason is required to mark a task incomplete.',
      );
    }
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException(
        'This task is already closed. Reopen it first to change its outcome.',
      );
    }

    const isCreator = task.created_by_user_id === userId;
    const isAssignee = (task.assignees ?? []).some(
      (a: any) => a.user_id === userId && !a.is_cc,
    );
    const isAdmin = await this.taskAccess.isOrgAdmin(orgId, userId);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      if (!isCreator && !isAdmin) {
        throw new ForbiddenException(
          'In "all must complete" mode, only the task creator can mark the whole task incomplete. Flag your own part instead.',
        );
      }
    } else if (!isCreator && !isAssignee && !isAdmin) {
      throw new ForbiddenException(
        'Only someone on this task can mark it incomplete.',
      );
    }

    // The checklist must be fully filled (ticked or "can't do") before closing — the
    // same rule as completing. In all_must every assignee's grid must be filled; in
    // any_can the one shared list must be.
    if (task.completion_mode === CompletionMode.all_must_complete) {
      await this.taskChecklist.assertChecklistFilledForAllWorkers(
        orgId,
        taskId,
        task,
        'marking the task incomplete',
      );
    } else {
      await this.taskChecklist.assertSharedChecklistResolved(
        orgId,
        taskId,
        'marking the task incomplete',
      );
    }

    const { incomplete } = await this.taskAccess.getCanonicalStatuses(orgId);
    if (!incomplete) {
      throw new BadRequestException(
        'No "Incomplete" status is configured for this organization.',
      );
    }

    const config = await this.taskAccess.getOrgConfig(orgId);
    const now = new Date();
    const completionNow = await this.clock.now(orgId);
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status_id: incomplete.id,
        completed_at: completionNow,
        completion_timing: CompletionTiming.incomplete,
        reopen_expires_at: new Date(
          now.getTime() + config.reopen_window_minutes * 60_000,
        ),
        completed_by_user_id: userId,
        incomplete_reason: trimmed,
        // A closed task is never overdue.
        is_overdue: false,
        overdue_at: null,
      },
    });

    await this.taskAccess.logActivity(
      orgId,
      taskId,
      userId,
      'marked_incomplete',
      { reason: trimmed },
    );

    const actorName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_incomplete',
      recipients: [
        task.created_by_user_id,
        ...(task.assignees ?? [])
          .filter((a: any) => !a.is_cc)
          .map((a: any) => a.user_id),
      ].filter((uid) => uid !== userId),
      title: `${actorName} marked a task incomplete`,
      body: `“${task.title}”\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // We do NOT advance a workflow step on an incomplete task — that only follows
    // completion. The run is parked as stuck so its owners decide (reopen, retry with
    // a fresh task, or skip the step). Never throws.
    if (task.workflow_instance_step_id) {
      await this.workflowEngine.onTaskClosedIncomplete(orgId, taskId);
    }

    // Keep project rollups honest (a closed-not-done task is no longer pending).
    const projectTask = await this.prisma.projectTask.findFirst({
      where: { task_id: taskId },
    });
    if (projectTask) {
      await this.projectProgressService.recalculateProjectProgress(
        projectTask.project_id,
      );
    }

    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * all_must_complete: an assignee flags THEIR OWN part as can't-complete (required reason),
   * or the creator/editor flags someone's part on their behalf. The part stays open but
   * flagged; the task never auto-completes while any part is flagged, so the creator decides
   * whether to close the whole task Incomplete or reassign.
   */

  async setAssigneeCannotComplete(
    orgId: string,
    actorId: string,
    taskId: string,
    targetUserId: string,
    reason?: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException(
        'A reason is required to flag your part as incomplete.',
      );
    }
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException(
        'Flagging a single part only applies to "all must complete" tasks. Use Mark Incomplete instead.',
      );
    }
    if (isTerminal((task as any).status?.type)) {
      throw new BadRequestException(
        'This task is already closed. Reopen it first.',
      );
    }

    const target = targetUserId || actorId;
    // Acting on someone else's part is an assigner action (creator / admin / scoped editor).
    if (target !== actorId) {
      await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    }
    const part = (task.assignees ?? []).find(
      (a: any) => a.user_id === target && !a.is_cc,
    );
    if (!part) {
      throw new BadRequestException(
        'That person is not a primary assignee on this task.',
      );
    }
    if (part.is_completed) {
      throw new BadRequestException(
        'That part is already completed. Reopen the task to change it.',
      );
    }

    await this.prisma.taskAssignee.updateMany({
      where: {
        task_id: taskId,
        user_id: target,
        is_cc: false,
        ...ACTIVE_ASSIGNEE,
      },
      data: {
        cannot_complete: true,
        cannot_complete_reason: trimmed,
        cannot_complete_at: new Date(),
      },
    });

    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'part_flagged_incomplete',
      { reason: trimmed, target_user_id: target },
    );

    // Tell the creator (and, when someone acted on their behalf, the assignee).
    const actorName = await this.notifications.userName(actorId);
    const targetName = await this.notifications.userName(target);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_part_flagged',
      recipients: [task.created_by_user_id, target].filter(
        (uid) => uid && uid !== actorId,
      ),
      title: `${targetName}'s part can't be completed`,
      body: `“${task.title}”\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    // If this flag means everyone has now responded, settle the overall outcome
    // (Partially Completed if some finished, Incomplete if nobody did); otherwise it
    // just refreshes the open roll-up and the task stays open.
    await this.taskStatus.settleAllMustComplete(orgId, taskId, actorId);

    return this.taskDetail.getTask(orgId, taskId);
  }

  /** Clear a previously-set can't-complete flag (the person, or the creator/editor). */
  async clearAssigneeCannotComplete(
    orgId: string,
    actorId: string,
    taskId: string,
    targetUserId: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    const target = targetUserId || actorId;
    if (target !== actorId) {
      await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    }
    await this.prisma.taskAssignee.updateMany({
      where: {
        task_id: taskId,
        user_id: target,
        is_cc: false,
        ...ACTIVE_ASSIGNEE,
      },
      data: {
        cannot_complete: false,
        cannot_complete_reason: null,
        cannot_complete_at: null,
      },
    });
    await this.taskStatus.rollUpTaskOpenStatus(orgId, taskId);
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'part_flag_cleared',
      { target_user_id: target },
    );
    return this.taskDetail.getTask(orgId, taskId);
  }

  // ─── Proof of Completion ────────────────────────────────────────────────────────

  /**
   * Who must submit proof (non-CC assignees) and who has (distinct proof uploaders).
   * Non-sensitive — it reports WHO submitted, not the files — so it's safe to surface
   * to everyone on the task and drives both the completion gate and the "n/N submitted"
   * scoreboard. Files themselves are visibility-filtered in TaskAttachmentsService.
   */
}
