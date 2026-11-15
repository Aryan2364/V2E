import { BadRequestException, Injectable } from '@nestjs/common';
import { CompletionMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowTaskEventsService } from '../workflows/workflow-task-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { assertActiveOrgMembers } from '../common/org-members';
import { loadTagRefMap, TaskTagRef } from '../common/task-masters-usable';
import { isTerminal } from './status-phase';
import { swallow } from '../common/swallow';
import { TASK_SUBJECT, tagChangeEntry } from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskStatusService } from './task-status.service';

/** Reconcile a task's roster, tags, checklist and reminders. */
@Injectable()
export class TaskReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowTaskEventsService,
    private readonly notifications: NotificationsService,
    private readonly subjects: SubjectEligibilityService,
    private readonly clock: ClockService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskStatus: TaskStatusService,
  ) {}

  async reconcileTaskTags(
    orgId: string,
    actorId: string,
    taskId: string,
    current: TaskTagRef[],
    nextIds: string[],
  ): Promise<{ field: 'tags'; from: string[]; to: string[] } | null> {
    const currentIds = new Set(current.map((t) => t.id));
    const nextSet = new Set(nextIds);
    const removed = [...currentIds].filter((id) => !nextSet.has(id));
    const added = nextIds.filter((id) => !currentIds.has(id));
    if (!removed.length && !added.length) return null;

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (removed.length) {
      ops.push(
        this.prisma.taskTagLink.deleteMany({
          where: { task_id: taskId, organization_id: orgId, tag_id: { in: removed } },
        }),
      );
    }
    if (added.length) {
      ops.push(
        this.prisma.taskTagLink.createMany({
          data: added.map((tagId) => ({
            organization_id: orgId,
            task_id: taskId,
            tag_id: tagId,
            created_by_user_id: actorId,
          })),
          skipDuplicates: true,
        }),
      );
    }
    await this.prisma.$transaction(ops);

    const addedRefs = await loadTagRefMap(this.prisma, orgId, added);
    const next = [
      ...current.filter((t) => nextSet.has(t.id)),
      ...added.map((id) => addedRefs.get(id)).filter((t): t is TaskTagRef => !!t),
    ];
    return tagChangeEntry(current, next);
  }

  /**
   * Make the task's checklist match `incoming` exactly. Items carrying an `id` that
   * still exists are updated in place (title / group / order), so their per-person
   * TaskChecklistItemState rows — every assignee's tick or skip — survive the edit.
   * Items whose id is gone are deleted (their states cascade away). Items with no
   * known id are created fresh (everyone starts "not started" on them). Returns
   * whether anything actually changed, for the activity log.
   */

  async reconcileTaskChecklist(
    orgId: string,
    taskId: string,
    incoming: { id?: string; title: string; order_index: number; group_title?: string }[],
    db: Prisma.TransactionClient = this.prisma as unknown as Prisma.TransactionClient,
  ): Promise<boolean> {
    const existing = await db.taskChecklist.findMany({
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
      await db.taskChecklist.deleteMany({ where: { id: { in: toDelete } } });
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
          await db.taskChecklist.update({
            where: { id: prev.id },
            data: { title: item.title, group_title: groupTitle, order_index: item.order_index },
          });
          changed = true;
        }
      } else {
        await db.taskChecklist.create({
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

  async recomputeRemindersForDeadline(
    orgId: string,
    taskId: string,
    newDeadline: Date | null,
    db: Prisma.TransactionClient = this.prisma as unknown as Prisma.TransactionClient,
  ): Promise<void> {
    const pending = await db.taskReminder.findMany({
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
      await db.taskReminder.deleteMany({ where: { id: { in: pending.map((r) => r.id) } } });
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
        await db.taskReminder.update({ where: { id: r.id }, data: { remind_at: next } });
      }
    }
    if (stale.length) {
      await db.taskReminder.deleteMany({ where: { id: { in: stale } } });
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

  async reconcileTaskRoster(
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
      await this.taskAccess.assertAssigneesVisible(orgId, actorId, newlyOn);
      // Only real workers need to be *assignable*; a CC is an observer.
      await this.subjects.assertAllEligible(
        orgId,
        TASK_SUBJECT,
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

    // Flip / add / remove commit together so the roster is never half-applied.
    await this.prisma.$transaction(async (tx) => {
      for (const { user_id, to_cc } of flipped) {
        await tx.taskAssignee.update({
          where: { task_id_user_id: { task_id: task.id, user_id } },
          // `is_cc` only. Their status/completion columns are left untouched on purpose:
          // every count and gate in this service filters on `is_cc: false`, so a CC's
          // stale progress is inert — and if they are flipped back to working, their
          // real progress is still there instead of having been zeroed.
          data: { is_cc: to_cc },
        });
      }

      for (const { user_id, is_cc } of added) {
        await tx.taskAssignee.upsert({
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
        await tx.taskAssignee.updateMany({
          where: {
            task_id: task.id,
            user_id: { in: removed.map((r) => r.user_id) },
            ...ACTIVE_ASSIGNEE,
          },
          data: { removed_at: now, removed_by_user_id: actorId },
        });
      }
    });

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
            .catch(swallow('tasks.reconcileTaskRoster', null)),
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
      if (lostAWorker) await this.taskStatus.settleAllMustComplete(orgId, task.id, actorId);
      await this.taskStatus.rollUpTaskOpenStatus(orgId, task.id);
    }

    // ── Trail + notifications ───────────────────────────────────────────────────
    // `is_cc` is recorded on both sides so the history can distinguish "CC removed"
    // from "assignee removed" — the old log couldn't.
    if (added.length || flipped.length) {
      await this.taskAccess.logActivity(orgId, task.id, actorId, 'assigned', {
        added: added.map((a) => ({ user_id: a.user_id, is_cc: a.is_cc })),
        role_changed: flipped.map((f) => ({ user_id: f.user_id, is_cc: f.to_cc })),
      });
    }
    if (removed.length) {
      await this.taskAccess.logActivity(orgId, task.id, actorId, 'reassigned', {
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

    // Workflow: keep the step's assignee in sync with who now holds its task.
    if (task.workflow_instance_step_id) {
      await this.workflowEngine.syncStepFromTask(orgId, task.id);
    }

    return { added, removed, flipped };
  }

  // ─── Delete Task ──────────────────────────────────────────────────────────────
}
