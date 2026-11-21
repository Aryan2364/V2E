import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { CompletionMode, TaskActionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowTaskEventsService } from '../workflows/workflow-task-events.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChecklistAccessService } from '../task-masters/checklist-access.service';
import { UpdateTaskDto } from './dto/update-task.dto';
import { normaliseExtensions } from './task-attachments.service';
import { assertTagsUsable, toTagRefs } from '../common/task-masters-usable';
import { isTerminal } from './status-phase';
import { TASK_INCLUDE, withTagRefs } from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskStatusService } from './task-status.service';
import { TaskDetailService } from './task-detail.service';
import { TaskReconcileService } from './task-reconcile.service';

/** Task create / update / delete. */
@Injectable()
export class TaskCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowTaskEventsService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskStatus: TaskStatusService,
    private readonly taskDetail: TaskDetailService,
    private readonly taskReconcile: TaskReconcileService,
  ) {}

  // ─── List Tasks ───────────────────────────────────────────────────────────────

  async updateTask(
    orgId: string,
    userId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    const old = await this.taskAccess.findTaskOrFail(orgId, taskId, true);

    // Split rights. Looping a colleague in as CC is an everyday courtesy, not a
    // reassignment: it changes nobody's workload and is trivially reversible. So when
    // an edit touches NOTHING but the CC list, anyone actually on the task may make
    // it. Every other change — the working roster, the deadline, the fields — still
    // requires assigner rights (creator / admin / task-edit role + edit scope).
    //
    // This is safe by construction, not just by intention: the only door to the
    // roster is `reconcileTaskRoster`, and with `assignee_user_ids` absent it keeps
    // the current workers verbatim. A CC-only payload therefore cannot touch who is
    // doing the work even though it skipped the assigner gate.
    const touchedFields = (Object.keys(dto) as (keyof UpdateTaskDto)[]).filter(
      (k) => dto[k] !== undefined,
    );
    const isCcOnlyEdit =
      touchedFields.length === 1 && touchedFields[0] === 'cc_user_ids';
    const actorIsOnTask = ((old as any).assignees ?? []).some(
      (a: any) => a.user_id === userId,
    );
    if (!(isCcOnlyEdit && actorIsOnTask)) {
      await this.taskAccess.assertAssignerRights(orgId, userId, old);
    }

    await this.taskAccess.assertGoalInOrg(orgId, dto.goal_id);
    // Edited master references get the same org+active validation as create.
    await this.taskAccess.assertMastersUsable(orgId, {
      category_id:
        dto.category_id !== old.category_id ? dto.category_id : undefined,
      priority_id:
        dto.priority_id !== old.priority_id ? dto.priority_id : undefined,
      department_id:
        dto.department_id !== old.department_id ? dto.department_id : undefined,
    });

    // Tags: `tag_ids` is the full authoritative list (omitted = unchanged, [] = clear).
    // Validated BEFORE any write. Tags already on the task may be inactive — a task
    // carrying a since-deactivated tag can still be saved — but a newly added one must
    // be an active tag of this org. Tags sit behind the same assigner gate as category
    // above: a `tag_ids` payload is never a CC-only edit.
    const currentTags = toTagRefs((old as any).tags);
    const nextTagIds =
      dto.tag_ids !== undefined
        ? await assertTagsUsable(this.prisma, orgId, dto.tag_ids, {
            keep: currentTags.map((t) => t.id),
          })
        : undefined;

    // Editing the checklist is only allowed while the task is open (once closed it's a
    // frozen record — mirrors assertTaskOpenForChecklist), and any freshly-applied
    // template must be one the editor is allowed to use (same gate as create).
    if (dto.checklist_items !== undefined) {
      if (isTerminal((old as any).status?.type)) {
        throw new BadRequestException(
          'This task is closed. Reopen it before changing the checklist.',
        );
      }
      for (const templateId of dto.checklist_template_ids ?? []) {
        const allowed = await this.checklistAccess.isAccessible(
          orgId,
          userId,
          templateId,
        );
        if (!allowed) {
          throw new ForbiddenException(
            'You are not allowed to use this checklist template.',
          );
        }
      }
    }

    const changedFields: Array<{ field: string; from: unknown; to: unknown }> =
      [];

    const updateData: any = {};

    // Set when the deadline genuinely moves off an existing date; drives the revision
    // record, the reminder recompute and the "your deadline changed" notification,
    // all of which must happen only after the task row itself commits.
    let deadlineRevision: {
      from: Date;
      to: Date | null;
      reason: string | null;
    } | null = null;

    const trackField = (field: string, oldVal: unknown, newVal: unknown) => {
      if (newVal !== undefined && newVal !== oldVal) {
        changedFields.push({ field, from: oldVal, to: newVal });
        updateData[field] = newVal;
      }
    };

    trackField('title', old.title, dto.title);
    trackField('description', old.description, dto.description);
    trackField('category_id', old.category_id, dto.category_id);
    trackField('priority_id', old.priority_id, dto.priority_id);
    trackField('quadrant', old.quadrant, dto.quadrant);
    trackField('type', old.type, dto.type);
    trackField('department_id', old.department_id, dto.department_id);
    trackField('completion_mode', old.completion_mode, dto.completion_mode);
    trackField('proof_required', old.proof_required, dto.proof_required);
    trackField('goal_id', old.goal_id, dto.goal_id);
    if (dto.proof_allowed_extensions !== undefined) {
      const next = normaliseExtensions(dto.proof_allowed_extensions);
      const prev = normaliseExtensions((old as any).proof_allowed_extensions);
      if (prev.join(',') !== next.join(',')) {
        changedFields.push({
          field: 'proof_allowed_extensions',
          from: prev,
          to: next,
        });
        updateData.proof_allowed_extensions = next;
      }
    }

    if (dto.deadline !== undefined) {
      let newDeadline = dto.deadline ? new Date(dto.deadline) : null;
      // The create-time holiday rule applies to EDITS too — but never by force: an
      // explicit user override (holiday_override) keeps the chosen date as-is.
      if (
        newDeadline &&
        !dto.holiday_override &&
        String(old.deadline) !== String(newDeadline)
      ) {
        const firstWorker = ((old as any).assignees ?? []).find(
          (a: any) => !a.is_cc,
        )?.user_id;
        const adjusted = await this.holidaysService.adjustDeadline(
          newDeadline,
          orgId,
          dto.department_id ?? old.department_id ?? undefined,
          firstWorker,
          'task',
          taskId,
          old.title,
        );
        if (adjusted === null) {
          throw new BadRequestException(
            'Deadline falls on a non-working day. Keep the date to override, or select a different one.',
          );
        }
        newDeadline = adjusted;
      }
      if (String(old.deadline) !== String(newDeadline)) {
        changedFields.push({
          field: 'deadline',
          from: old.deadline,
          to: newDeadline,
        });
        updateData.deadline = newDeadline;
        // Re-evaluate the persisted overdue flag; the auto-overdue sweep re-flags if it lapses again.
        const stillOverdue = !!newDeadline && newDeadline < new Date();
        if (old.is_overdue !== stillOverdue) {
          updateData.is_overdue = stillOverdue;
          updateData.overdue_at = stillOverdue ? new Date() : null;
        }

        if (old.deadline === null) {
          // Nothing to revise — the task never had a deadline, so this IS its first
          // commitment and becomes the compliance baseline. Not a revision, and not
          // counted as one; the plain 'edited' activity entry already records it.
          updateData.original_deadline = newDeadline;
        } else {
          // A genuine revision. Freeze the baseline if this row predates the column
          // (defensive — the migration backfilled every existing task), then record
          // the move. `original_deadline` is never written again after this point.
          if ((old as any).original_deadline === null) {
            updateData.original_deadline = old.deadline;
          }
          deadlineRevision = {
            from: old.deadline,
            to: newDeadline,
            reason: dto.deadline_reason?.trim() || null,
          };
          updateData.deadline_revision_count = { increment: 1 };
        }
      }
    }

    let newStatusLabel: string | null = null;
    if (dto.status_id !== undefined && dto.status_id !== old.status_id) {
      const st = await this.prisma.taskStatus.findFirst({
        where: { id: dto.status_id, organization_id: orgId, is_active: true },
      });
      if (!st) throw new BadRequestException('Status not found or inactive');
      const oldType = (old as any).status?.type;
      // Terminal transitions carry business rules (proof, per-assignee completion,
      // the reopen window) — they must go through the dedicated actions, never a raw
      // status change. The status control only moves a task between OPEN states.
      if (isTerminal(st.type)) {
        throw new BadRequestException(
          'To close a task, use the Complete or Mark Incomplete action — the status control only moves between open states.',
        );
      }
      if (isTerminal(oldType)) {
        throw new BadRequestException('Reopen the task to change its status.');
      }
      newStatusLabel = st.label;
      changedFields.push({
        field: 'status_id',
        from: old.status_id,
        to: dto.status_id,
      });
      updateData.status_id = dto.status_id;
    }

    // The task row and the completion-mode seeding it implies commit together, so a
    // failure can't leave a task in the new mode with stale personal status tracks.
    const modeSwitched =
      dto.completion_mode !== undefined &&
      dto.completion_mode !== old.completion_mode;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.task.update({
        where: { id: taskId },
        data: updateData,
        include: TASK_INCLUDE,
      });

      // Switching completion model reconciles the two status shapes so neither goes stale.
      if (modeSwitched) {
        if (dto.completion_mode === CompletionMode.all_must_complete) {
          // any -> all: seed everyone's personal track from the current shared open status,
          // so the scoreboard starts coherent instead of blank.
          const seedId = isTerminal((row as any).status?.type)
            ? null
            : row.status_id;
          await tx.taskAssignee.updateMany({
            where: { task_id: taskId, is_cc: false, ...ACTIVE_ASSIGNEE },
            data: { status_id: seedId },
          });
        } else {
          // all -> any: collapse to one shared status; personal tracks no longer apply.
          await tx.taskAssignee.updateMany({
            where: { task_id: taskId, ...ACTIVE_ASSIGNEE },
            data: { status_id: null },
          });
          await tx.task.update({
            where: { id: taskId },
            data: { status_actor_user_id: userId },
          });
        }
      }
      return row;
    });
    if (
      modeSwitched &&
      dto.completion_mode === CompletionMode.all_must_complete
    ) {
      await this.taskStatus.rollUpTaskOpenStatus(orgId, taskId);
    }

    // Reconcile who is on the task (add / remove / flip between assignee and CC).
    // Runs AFTER the completion-mode switch above so a newly-added worker is seeded
    // against the mode the task now has, not the one it just left. `updated` carries
    // the post-commit status and live roster.
    const rosterChange = await this.taskReconcile.reconcileTaskRoster(
      orgId,
      userId,
      updated,
      {
        assigneeIds: dto.assignee_user_ids,
        ccIds: dto.cc_user_ids,
      },
    );
    if (
      rosterChange.added.length ||
      rosterChange.removed.length ||
      rosterChange.flipped.length
    ) {
      changedFields.push({
        field: 'assignees',
        from: ((old as any).assignees ?? []).map((a: any) => a.user_id),
        to: null,
      });
    }

    // ── Deadline revision side-effects ───────────────────────────────────────────
    if (deadlineRevision) {
      // The immutable paper trail explaining how the live deadline drifted from the
      // baseline the reports grade against.
      await this.prisma.$transaction(async (tx) => {
        await tx.taskDeadlineRevision.create({
          data: {
            organization_id: orgId,
            task_id: taskId,
            from_deadline: deadlineRevision.from,
            to_deadline: deadlineRevision.to,
            reason: deadlineRevision.reason,
            changed_by_user_id: userId,
          },
        });

        await this.taskReconcile.recomputeRemindersForDeadline(
          orgId,
          taskId,
          deadlineRevision.to,
          tx,
        );
      });

      // Workflow: the step's deadline follows its task's (never throws).
      if (old.workflow_instance_step_id) {
        await this.workflowEngine.syncStepFromTask(orgId, taskId);
      }

      // Moving someone's deadline without telling them is how a task gets missed.
      // Everyone on it — workers and CCs — plus the creator, minus whoever did it.
      const actorName = await this.notifications.userName(userId);
      const recipients = [
        old.created_by_user_id,
        ...((updated as any).assignees ?? []).map((a: any) => a.user_id),
      ].filter((uid: string) => uid !== userId);
      const fmt = (d: Date | null) =>
        d
          ? new Date(d).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : 'no deadline';
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_deadline_changed',
        recipients,
        title: `${actorName} changed a task deadline`,
        body:
          `“${old.title}”\n${fmt(deadlineRevision.from)} → ${fmt(deadlineRevision.to)}` +
          (deadlineRevision.reason
            ? `\nReason: ${deadlineRevision.reason}`
            : ''),
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    // Reconcile the checklist (add / edit / remove items). Runs as part of the edit;
    // items kept by id retain every assignee's per-person progress.
    if (dto.checklist_items !== undefined) {
      const checklistChanged = await this.prisma.$transaction((tx) =>
        this.taskReconcile.reconcileTaskChecklist(
          orgId,
          taskId,
          dto.checklist_items!,
          tx,
        ),
      );
      if (checklistChanged) {
        changedFields.push({
          field: 'checklist',
          from: null,
          to: `${dto.checklist_items.length} item(s)`,
        });
      }
    }

    // Reconcile the tags to the authoritative list. Logged only when the SET changed
    // (re-sending the same tags in another order is not an edit).
    if (nextTagIds !== undefined) {
      const tagChange = await this.taskReconcile.reconcileTaskTags(
        orgId,
        userId,
        taskId,
        currentTags,
        nextTagIds,
      );
      if (tagChange) changedFields.push(tagChange);
    }

    if (changedFields.length > 0) {
      const action: TaskActionType = changedFields.some(
        (f) => f.field === 'status_id',
      )
        ? 'status_changed'
        : 'edited';
      await this.taskAccess.logActivity(orgId, taskId, userId, action, {
        changes: changedFields,
      });
    }

    // A status move should ping everyone on the task (except whoever changed it).
    if (newStatusLabel) {
      const actorName = await this.notifications.userName(userId);
      const recipients = [
        old.created_by_user_id,
        ...((old as any).assignees ?? []).map((a: any) => a.user_id),
      ].filter((uid: string) => uid !== userId);
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_status_changed',
        recipients,
        title: `${actorName} changed status`,
        body: `Moved to “${newStatusLabel}”\non “${old.title}”`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    }

    // Return the fully-enriched task (per-person status + overdue + attribution) so
    // callers that swap it straight into view state don't lose the scoreboard data.
    return this.taskDetail.getTask(orgId, taskId);
  }

  /**
   * The activity-log entry for a tag change: tag NAMES (sorted, case-insensitive)
   * before and after, or `null` when the set of tags did not change.
   */

  async deleteTask(
    orgId: string,
    userId: string,
    taskId: string,
    reason: string,
  ) {
    await this.taskAccess.checkTaskPermission(
      orgId,
      userId,
      'task_delete_roles',
    );
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Deletion reason is required');
    }

    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);

    // Archive snapshot + soft delete commit together.
    await this.prisma.$transaction(async (tx) => {
      // Create archive snapshot
      await tx.taskArchive.create({
        data: {
          organization_id: orgId,
          original_task_id: taskId,
          // Tags are snapshotted as flat refs (name + colour at deletion time), the
          // same shape every task response carries.
          task_snapshot: withTagRefs(task) as any,
          deleted_by_user_id: userId,
          deletion_reason: reason,
          deleted_at: new Date(),
        },
      });

      // Soft delete
      await tx.task.update({
        where: { id: taskId },
        data: {
          is_deleted: true,
          deleted_by_user_id: userId,
          deleted_at: new Date(),
          deletion_reason: reason,
        },
      });
    });

    await this.taskAccess.logActivity(orgId, taskId, userId, 'deleted', {
      reason,
    });

    // Workflow: the run can't continue on a deleted step task → stuck (never throws).
    if (task.workflow_instance_step_id) {
      await this.workflowEngine.onTaskDeleted(orgId, taskId);
    }

    return { message: 'Task deleted successfully' };
  }

  // ─── Complete Task ────────────────────────────────────────────────────────────

  /**
   * Classify a completed task against its deadline at DAY granularity (matches how
   * the dashboard reasons about timing). `early` = finished before the deadline day,
   * `on_time` = finished on the deadline day (or the task had no deadline), `late` =
   * finished after. Set once at completion and never recomputed.
   */
  /**
   * The early/on_time/late verdict stamped on a task when it closes.
   *
   * ALWAYS pass the compliance BASELINE (`original_deadline ?? deadline`), never the
   * live `deadline` — use `gradingDeadline()` below. This stamp is persisted and read
   * back by the reports and the Work Overview timing dashboard, so grading it against
   * an editable date is the same loophole in a different place: push the deadline,
   * complete the task, and a late task is stamped `on_time` forever.
   */
}
