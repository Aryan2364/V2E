import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { ChecklistItemState, CompletionMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isTerminal } from './status-phase';
import { TaskAccessService } from './task-access.service';
import { TaskStatusService } from './task-status.service';
import { TaskDetailService } from './task-detail.service';

/** Task checklist item actions. */
@Injectable()
export class TaskChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskStatus: TaskStatusService,
    private readonly taskDetail: TaskDetailService,
  ) {}

  /** Load a task + one of its checklist items, scoped to task + org (404 on miss). */
  async loadChecklistItemForWrite(
    orgId: string,
    taskId: string,
    itemId: string,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    const item = await this.prisma.taskChecklist.findFirst({
      where: { id: itemId, task_id: taskId, organization_id: orgId },
    });
    if (!item)
      throw new NotFoundException(`Checklist item ${itemId} not found`);
    return { task, item };
  }

  /** Frozen once the task is closed — the checklist becomes a record of what happened.
   *  Only `challengeChecklistItem` (which reopens) may touch a terminal task. */

  assertTaskOpenForChecklist(task: any) {
    if (isTerminal(task?.status?.type)) {
      throw new BadRequestException(
        'This task is closed. Reopen it before changing the checklist.',
      );
    }
  }

  /** May the actor tick the shared checklist (any_can_complete)? Working assignee,
   *  creator, admin, or an editor — mirrors who may move the shared status. */

  async assertCanWorkTask(orgId: string, actorId: string, task: any) {
    const isParticipant =
      task.created_by_user_id === actorId ||
      (task.assignees ?? []).some(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
    if (isParticipant) return;
    await this.taskAccess.assertAssignerRights(orgId, actorId, task);
  }

  /** Join requirement phrases into a natural list: "A", "A and B", "A, B, and C". */
  joinRequirements(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? '';
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  }

  /** all_must_complete: how many checklist items are still unresolved (not Done and not
   *  skipped-with-reason) for one person. 0 when there is no checklist. */

  async checklistRemainingForUser(
    orgId: string,
    taskId: string,
    userId: string,
  ): Promise<number> {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { id: true },
    });
    if (items.length === 0) return 0;
    const states = await this.prisma.taskChecklistItemState.findMany({
      where: { task_id: taskId, user_id: userId },
      select: { checklist_id: true },
    });
    const satisfied = new Set(states.map((s) => s.checklist_id));
    return items.filter((i) => !satisfied.has(i.id)).length;
  }

  /** any_can_complete: how many items of the ONE shared checklist are still unresolved. */
  async sharedChecklistRemaining(
    orgId: string,
    taskId: string,
  ): Promise<number> {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { is_completed: true, cant_do: true },
    });
    if (items.length === 0) return 0;
    return items.filter((i) => !i.is_completed && !i.cant_do).length;
  }

  /** any_can_complete: the ONE shared checklist must be fully filled (every item ticked
   *  or marked “can’t do”) before the task can be closed — as complete or incomplete. */

  async assertSharedChecklistResolved(
    orgId: string,
    taskId: string,
    verb: string,
  ) {
    const remaining = await this.sharedChecklistRemaining(orgId, taskId);
    if (remaining > 0) {
      throw new BadRequestException(
        `Tick every checklist item — or mark it “can’t do” with a reason — before ${verb} (${remaining} still open).`,
      );
    }
  }

  /** all_must_complete: the whole per-person grid must be filled (every item done or
   *  “can’t do” for every working assignee) before the task can be closed as incomplete. */

  async assertChecklistFilledForAllWorkers(
    orgId: string,
    taskId: string,
    task: any,
    verb: string,
  ) {
    const items = await this.prisma.taskChecklist.findMany({
      where: { task_id: taskId, organization_id: orgId },
      select: { id: true },
    });
    if (items.length === 0) return;
    const workers = (task.assignees ?? []).filter((a: any) => !a.is_cc);
    if (workers.length === 0) return;
    const states = await this.prisma.taskChecklistItemState.findMany({
      where: { task_id: taskId },
      select: { checklist_id: true, user_id: true },
    });
    const filled = new Set(states.map((s) => `${s.checklist_id}:${s.user_id}`));
    let remaining = 0;
    for (const it of items)
      for (const w of workers)
        if (!filled.has(`${it.id}:${w.user_id}`)) remaining++;
    if (remaining > 0) {
      throw new BadRequestException(
        `Every assignee must tick each checklist item — or mark it “can’t do” — before ${verb} (${remaining} still open).`,
      );
    }
  }

  /** Mark a checklist item done: the actor's own item (all_must) or the one shared
   *  tick (any_can). */

  async checkChecklistItem(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
  ) {
    const { task } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
      if (!part) {
        throw new BadRequestException(
          'Only a working assignee ticks their own checklist. As the assigner, use “mark done for everyone” instead.',
        );
      }
      if (part.is_completed) {
        throw new BadRequestException(
          'Your part is already complete. Reopen your part to change its checklist.',
        );
      }
      await this.prisma.taskChecklistItemState.upsert({
        where: {
          checklist_id_user_id: { checklist_id: itemId, user_id: actorId },
        },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: actorId,
          state: ChecklistItemState.done,
          marked_by_user_id: actorId,
        },
        update: {
          state: ChecklistItemState.done,
          reason: null,
          is_override: false,
          marked_by_user_id: actorId,
          marked_at: new Date(),
        },
      });
    } else {
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: {
          is_completed: true,
          cant_do: false,
          cant_do_reason: null,
          completed_by_user_id: actorId,
          completed_at: new Date(),
        },
      });
    }
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_updated',
      { item_id: itemId, state: 'done' },
    );
    return this.taskDetail.getTask(orgId, taskId);
  }

  /** Clear a checklist item back to Not started: the actor's own row (all_must) or the
   *  shared tick (any_can). */

  async uncheckChecklistItem(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
  ) {
    const { task } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
      if (!part)
        throw new BadRequestException(
          'Only a working assignee can change their own checklist.',
        );
      if (part.is_completed) {
        throw new BadRequestException(
          'Your part is already complete. Reopen your part to change its checklist.',
        );
      }
      await this.prisma.taskChecklistItemState.deleteMany({
        where: { checklist_id: itemId, user_id: actorId, task_id: taskId },
      });
    } else {
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: {
          is_completed: false,
          cant_do: false,
          cant_do_reason: null,
          completed_by_user_id: null,
          completed_at: null,
        },
      });
    }
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_updated',
      { item_id: itemId, state: 'not_started' },
    );
    return this.taskDetail.getTask(orgId, taskId);
  }

  /** Mark an item “can’t do” with a REQUIRED reason. It fills the item (so the task can
   *  be closed) but is shown, and audited, as a skip — per-person in all_must, shared in
   *  any_can. */

  async skipChecklistItem(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
    reason?: string,
  ) {
    const { task, item } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    const trimmed = (reason ?? '').trim();
    if (!trimmed)
      throw new BadRequestException(
        'A reason is required to mark a checklist item “can’t do”.',
      );
    this.assertTaskOpenForChecklist(task);

    if (task.completion_mode === CompletionMode.all_must_complete) {
      const part = (task.assignees ?? []).find(
        (a: any) => a.user_id === actorId && !a.is_cc,
      );
      if (!part)
        throw new BadRequestException(
          'Only a working assignee can mark their own checklist item “can’t do”.',
        );
      if (part.is_completed) {
        throw new BadRequestException(
          'Your part is already complete. Reopen your part to change its checklist.',
        );
      }
      await this.prisma.taskChecklistItemState.upsert({
        where: {
          checklist_id_user_id: { checklist_id: itemId, user_id: actorId },
        },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: actorId,
          state: ChecklistItemState.skipped,
          reason: trimmed,
          marked_by_user_id: actorId,
        },
        update: {
          state: ChecklistItemState.skipped,
          reason: trimmed,
          is_override: false,
          marked_by_user_id: actorId,
          marked_at: new Date(),
        },
      });
    } else {
      // any_can_complete — one shared "can't do" for everyone, with attribution.
      await this.assertCanWorkTask(orgId, actorId, task);
      await this.prisma.taskChecklist.update({
        where: { id: itemId },
        data: {
          is_completed: false,
          cant_do: true,
          cant_do_reason: trimmed,
          completed_by_user_id: actorId,
          completed_at: new Date(),
        },
      });
    }
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_item_skipped',
      { item_id: itemId, reason: trimmed },
    );

    // Keep the creator in the loop that a step was skipped (no sign-off needed).
    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_skipped',
      recipients: [task.created_by_user_id].filter(
        (uid) => uid && uid !== actorId,
      ),
      title: `${actorName} couldn’t complete a checklist item`,
      body: `“${task.title}” — ${item.title}\n${trimmed}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.taskDetail.getTask(orgId, taskId);
  }

  /** all_must_complete: the assigner marks an item done for EVERYONE at once. Leaves
   *  any genuine personal ticks untouched; fills the rest with an attributed override. */

  async overrideChecklistItem(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
  ) {
    const { task } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException(
        '“Mark done for everyone” applies to “all must complete” tasks.',
      );
    }
    this.assertTaskOpenForChecklist(task);
    await this.taskAccess.assertAssignerRights(orgId, actorId, task);

    const workers = (task.assignees ?? []).filter((a: any) => !a.is_cc);
    const existing = await this.prisma.taskChecklistItemState.findMany({
      where: { checklist_id: itemId, task_id: taskId },
      select: { user_id: true, state: true },
    });
    const alreadyDone = new Set(
      existing
        .filter((s) => s.state === ChecklistItemState.done)
        .map((s) => s.user_id),
    );
    for (const w of workers) {
      if (alreadyDone.has(w.user_id)) continue; // don't clobber a genuine personal tick
      await this.prisma.taskChecklistItemState.upsert({
        where: {
          checklist_id_user_id: { checklist_id: itemId, user_id: w.user_id },
        },
        create: {
          organization_id: orgId,
          checklist_id: itemId,
          task_id: taskId,
          user_id: w.user_id,
          state: ChecklistItemState.done,
          is_override: true,
          marked_by_user_id: actorId,
        },
        update: {
          state: ChecklistItemState.done,
          reason: null,
          is_override: true,
          marked_by_user_id: actorId,
          marked_at: new Date(),
        },
      });
    }
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_item_overridden',
      { item_id: itemId },
    );

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_overridden',
      recipients: workers
        .map((a: any) => a.user_id)
        .filter((uid: string) => uid !== actorId),
      title: `${actorName} marked a checklist item done for everyone`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.taskDetail.getTask(orgId, taskId);
  }

  /** Undo an assigner override — removes only the override rows, leaving genuine
   *  personal ticks/skips in place. */

  async clearChecklistOverride(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
  ) {
    const { task } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    this.assertTaskOpenForChecklist(task);
    await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    await this.prisma.taskChecklistItemState.deleteMany({
      where: { checklist_id: itemId, task_id: taskId, is_override: true },
    });
    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_updated',
      { item_id: itemId, state: 'override_cleared' },
    );
    return this.taskDetail.getTask(orgId, taskId);
  }

  /** all_must_complete: the assigner challenges one person's checklist item. This is the
   *  ONLY path that may touch a closed task — it reopens JUST that person's part (never
   *  disturbing co-assignees who legitimately finished) and bounces the item back to Not
   *  started, keeping the prior reason in the audit trail. */

  async challengeChecklistItem(
    orgId: string,
    actorId: string,
    taskId: string,
    itemId: string,
    targetUserId: string,
  ) {
    const { task, item } = await this.loadChecklistItemForWrite(
      orgId,
      taskId,
      itemId,
    );
    if (task.completion_mode !== CompletionMode.all_must_complete) {
      throw new BadRequestException(
        'Challenging a checklist item applies to “all must complete” tasks.',
      );
    }
    if (!targetUserId)
      throw new BadRequestException(
        'Whose checklist item are you challenging?',
      );
    await this.taskAccess.assertAssignerRights(orgId, actorId, task);
    const part = (task.assignees ?? []).find(
      (a: any) => a.user_id === targetUserId && !a.is_cc,
    );
    if (!part)
      throw new BadRequestException(
        'That person is not a working assignee on this task.',
      );

    const prior = await this.prisma.taskChecklistItemState.findUnique({
      where: {
        checklist_id_user_id: { checklist_id: itemId, user_id: targetUserId },
      },
      select: { state: true, reason: true },
    });

    // 1. Reset that person's item to Not started.
    await this.prisma.taskChecklistItemState.deleteMany({
      where: { checklist_id: itemId, user_id: targetUserId, task_id: taskId },
    });

    // 2. Reopen ONLY that person's part.
    const { notStarted, inProgress } =
      await this.taskAccess.getCanonicalStatuses(orgId);
    const openStatusId = inProgress?.id ?? notStarted?.id ?? null;
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
        status_id: openStatusId,
      },
    });

    // 3. If the task had closed, bring it back to open — WITHOUT resetting the other
    //    assignees (unlike reopenTask, which is a whole-task reset).
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
    await this.taskStatus.rollUpTaskOpenStatus(orgId, taskId);

    await this.taskAccess.logActivity(
      orgId,
      taskId,
      actorId,
      'checklist_item_challenged',
      {
        item_id: itemId,
        target_user_id: targetUserId,
        prior_state: prior?.state ?? null,
        prior_reason: prior?.reason ?? null,
      },
    );

    const actorName = await this.notifications.userName(actorId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_checklist_challenged',
      recipients: [targetUserId].filter((uid) => uid !== actorId),
      title: `${actorName} reopened your task`,
      body: `“${task.title}” — please revisit: ${item.title}`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });
    return this.taskDetail.getTask(orgId, taskId);
  }

  // ─── Assignees ────────────────────────────────────────────────────────────────

  /**
   * Put one person on the task, or change the role they hold on it.
   *
   * A thin wrapper over `reconcileTaskRoster` — the single writer for a task's people
   * — so this endpoint cannot drift from the edit modal's behaviour. In particular,
   * calling this for someone already on the task in the other role is a genuine
   * in-place FLIP, not the delete-and-recreate it used to be.
   */
}
