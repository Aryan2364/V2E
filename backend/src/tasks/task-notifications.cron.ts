import { Injectable, Logger } from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Cron } from '@nestjs/schedule';
import { runExclusive } from '../common/run-exclusive';

/** Sweeps held task-completion notifications. */
@Injectable()
export class TaskNotificationsCron {
  private readonly logger = new Logger(TaskNotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Delayed "task completed" notification sweep ─────────────────────────────
  //
  // completeTask stamps `pending_completion_notification_at` instead of notifying
  // inline (see above); this sweep fires the notification once that time has passed,
  // and ONLY if the task is still in exactly the state completeTask left it in — a
  // reopen (undo or manual) clears the timestamp, which is the normal cancel path,
  // but a race (reopen landing between the sweep's query and its own write) is still
  // guarded against by re-checking `completed_at`/`completed_by_user_id` against what
  // the query returned, and by an atomic `updateMany` that only succeeds if the
  // timestamp is still exactly what was read. No existing @Cron sweep lived in this
  // file to extend the cadence of (grep for `@Cron`/`ScheduleModule` across
  // `backend/src` found none here). Every 10s, so the notification lands within ~25s of
  // completing (15s hold + sweep) instead of waiting out the whole reopen window; the
  // query is a single-column lookup that is almost always empty.
  @Cron('*/10 * * * * *')
  async processPendingCompletionNotifications() {
    return runExclusive(
      'TasksService.processPendingCompletionNotifications',
      async () => {
        const now = new Date();
        const due = await this.prisma.task.findMany({
          where: {
            pending_completion_notification_at: { lte: now },
            is_deleted: false,
          },
          select: {
            id: true,
            organization_id: true,
            title: true,
            completed_at: true,
            completed_by_user_id: true,
            pending_completion_notification_at: true,
            created_by_user_id: true,
            assignees: {
              where: { ...ACTIVE_ASSIGNEE, is_cc: false },
              select: { user_id: true },
            },
          },
        });
        for (const task of due) {
          await this.fireOnePendingCompletionNotification(task).catch((err) =>
            this.logger.error(
              `processPendingCompletionNotifications failed for task ${task.id}: ${err}`,
            ),
          );
        }
      },
    );
  }

  async fireOnePendingCompletionNotification(task: {
    id: string;
    organization_id: string;
    title: string;
    completed_at: Date | null;
    completed_by_user_id: string | null;
    pending_completion_notification_at: Date | null;
    created_by_user_id: string;
    assignees: { user_id: string }[];
  }) {
    // Atomic claim: only proceed if the row is STILL exactly the one we read — guards
    // against a reopen (the cancel path) racing in between the sweep's query and this
    // write. `updateMany`'s `count` tells us whether we won the race.
    const claimed = await this.prisma.task.updateMany({
      where: {
        id: task.id,
        pending_completion_notification_at:
          task.pending_completion_notification_at,
        completed_at: task.completed_at,
        completed_by_user_id: task.completed_by_user_id,
      },
      data: { pending_completion_notification_at: null },
    });
    if (claimed.count === 0) return; // reopened (or re-completed by someone else) since we read it — skip

    const completerId = task.completed_by_user_id;
    const completerName = completerId
      ? await this.notifications.userName(completerId)
      : 'Someone';
    await this.notifications.emit({
      orgId: task.organization_id,
      module: 'tasks',
      event_type: 'task_completed',
      recipients: [
        task.created_by_user_id,
        ...task.assignees.map((a) => a.user_id),
      ].filter((uid) => uid !== completerId),
      title: `${completerName} completed a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${task.id}`,
      entity: { type: 'task', id: task.id },
    });
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
}
