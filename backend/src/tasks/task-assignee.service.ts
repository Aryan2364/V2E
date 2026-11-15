import { Injectable, NotFoundException } from '@nestjs/common';
import { AddAssigneeDto } from './dto/add-assignee.dto';
import { TaskAccessService } from './task-access.service';
import { TaskDetailService } from './task-detail.service';
import { TaskReconcileService } from './task-reconcile.service';

/** Add / remove an assignee. */
@Injectable()
export class TaskAssigneeService {
  constructor(
    private readonly taskAccess: TaskAccessService,
    private readonly taskDetail: TaskDetailService,
    private readonly taskReconcile: TaskReconcileService,
  ) {}

  async addAssignee(orgId: string, userId: string, taskId: string, dto: AddAssigneeDto) {
    // isWrite: a task created in a simulated future can't have its people changed
    // until the clock reaches it — the guard every other task mutation applies.
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    // Only the creator (or an admin / scope-verified editor) may change who a task
    // is assigned to — a plain assignee can't reassign the work.
    await this.taskAccess.assertAssignerRights(orgId, userId, task);

    const live: { user_id: string; is_cc: boolean }[] = (task as any).assignees ?? [];
    const isCc = dto.is_cc ?? false;
    const keep = live.filter((a) => a.user_id !== dto.user_id);
    await this.taskReconcile.reconcileTaskRoster(orgId, userId, task, {
      assigneeIds: [...keep.filter((a) => !a.is_cc).map((a) => a.user_id), ...(isCc ? [] : [dto.user_id])],
      ccIds: [...keep.filter((a) => a.is_cc).map((a) => a.user_id), ...(isCc ? [dto.user_id] : [])],
    });
    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * Take one person off the task. Soft — see `reconcileTaskRoster` and
   * active-assignee.ts: the record that they held it survives for reporting.
   */

  async removeAssignee(orgId: string, userId: string, taskId: string, assigneeUserId: string) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    // Only the creator (or an admin / scope-verified editor) may change assignees.
    await this.taskAccess.assertAssignerRights(orgId, userId, task);

    const live: { user_id: string; is_cc: boolean }[] = (task as any).assignees ?? [];
    if (!live.some((a) => a.user_id === assigneeUserId)) {
      throw new NotFoundException(`Assignee ${assigneeUserId} not found on task`);
    }
    // The "a task must keep at least one assignee" rule, the settle-the-completion-
    // maths step and the notification all live in the reconcile.
    const keep = live.filter((a) => a.user_id !== assigneeUserId);
    await this.taskReconcile.reconcileTaskRoster(orgId, userId, task, {
      assigneeIds: keep.filter((a) => !a.is_cc).map((a) => a.user_id),
      ccIds: keep.filter((a) => a.is_cc).map((a) => a.user_id),
    });
    return { message: 'Assignee removed' };
  }

  // ─── Archive ─────────────────────────────────────────────────────────────────
}
