import { BadRequestException, Injectable } from '@nestjs/common';
import { TASK_TAG_REF_SELECT } from '../common/task-masters-usable';
import { CompletionMode, PermissionAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowTaskEventsService } from '../workflows/workflow-task-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import {
  assertTagsUsable,
  loadTagRefMap,
  TaskTagRef,
  toTagRefs,
} from '../common/task-masters-usable';
import { isTerminal } from './status-phase';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { MAX_TAGS_PER_TASK } from '../task-masters/task-tag.constants';
import { swallow } from '../common/swallow';
import {
  MAX_TAG_FILTER_IDS,
  SIMULATED_FUTURE_TASK_MESSAGE,
  TASK_LEAF,
  tagChangeEntry,
} from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskReconcileService } from './task-reconcile.service';
import { TaskCompletionService } from './task-completion.service';

/** Bulk update and bulk tag apply. */
@Injectable()
export class TaskBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowTaskEventsService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskReconcile: TaskReconcileService,
    private readonly taskCompletion: TaskCompletionService,
  ) {}

  /**
   * Bulk status / deadline / complete over the subset of `taskIds` the actor may EDIT.
   * The bulk tool obeys every rule the single-task actions enforce — read visibility is
   * not edit rights, terminal states can't be hand-set or silently dragged back open,
   * and "complete" routes through the real completion engine (proof, checklists,
   * per-person scoreboards, notifications, the undo window). Tasks that fail a rule are
   * skipped and reported, never force-updated.
   */
  async bulkUpdate(
    orgId: string,
    principal: Principal,
    taskIds: string[],
    action: 'status' | 'deadline' | 'complete' | 'add_tags' | 'remove_tags',
    payload: {
      status_id?: string;
      deadline?: string | null;
      tag_ids?: string[];
    },
  ) {
    const skipped: { id: string; title: string; reason: string }[] = [];
    if (!taskIds?.length) return { updated: 0, skipped };

    // Tag actions: validate the payload before touching any task. Adding needs active
    // tags of this org (same validator as create/edit); removing only needs the ids to
    // be this org's own — taking a deactivated tag OFF tasks is exactly what cleanup is.
    const isTagAction = action === 'add_tags' || action === 'remove_tags';
    let bulkTagIds: string[] = [];
    if (isTagAction) {
      bulkTagIds =
        action === 'add_tags'
          ? await assertTagsUsable(this.prisma, orgId, payload.tag_ids ?? [])
          : await this.assertTagIdsInOrg(orgId, payload.tag_ids ?? []);
      if (!bulkTagIds.length)
        throw new BadRequestException('Pick at least one tag.');
    }

    // Read visibility bounds the candidate set…
    const scopeWhere = await this.scope.listWhere(orgId, principal, TASK_LEAF);
    const candidates = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        id: { in: taskIds },
        ...(Object.keys(scopeWhere).length ? { AND: [scopeWhere] } : {}),
      },
      select: {
        id: true,
        title: true,
        created_by_user_id: true,
        // Needed by the tag branch: updateTask (findTaskOrFail isWrite) refuses tasks
        // created in a simulated future, so bulk tagging skips them too.
        created_at: true,
        completion_mode: true,
        // Needed by the deadline branch: a bulk move is a real revision and has to
        // freeze/keep the compliance baseline like any single edit.
        deadline: true,
        original_deadline: true,
        // Needed by the deadline branch: a workflow step follows its task's deadline.
        workflow_instance_step_id: true,
        status: { select: { type: true } },
        assignees: {
          where: ACTIVE_ASSIGNEE,
          select: { user_id: true, is_cc: true },
        },
        // Needed by the tag branch to diff and to log names.
        ...TASK_TAG_REF_SELECT,
      },
    });
    if (!candidates.length) return { updated: 0, skipped };

    // Tags are a task FIELD, so bulk tagging needs exactly the rights a single edit
    // (updateTask → assertAssignerRights) needs: creator, admin, or the org's
    // task-edit-roles gate AND edit scope over the task's core participants. Being an
    // assignee is enough to move a status, but not to retag someone else's task.
    // (The edit-roles lookup is per actor, so it runs at most once.)
    let editRoleAllowed: boolean | undefined;
    const canEditFields = async (
      t: (typeof candidates)[number],
    ): Promise<boolean> => {
      if (t.created_by_user_id === principal.userId || principal.isAdmin)
        return true;
      if (editRoleAllowed === undefined) {
        editRoleAllowed = await this.taskAccess
          .checkTaskPermission(orgId, principal.userId, 'task_edit_roles')
          .then(
            () => true,
            () => false,
          );
      }
      if (!editRoleAllowed) return false;
      try {
        await this.scope.assertCanActOn(
          orgId,
          principal,
          TASK_LEAF,
          PermissionAction.edit,
          [
            t.created_by_user_id,
            ...t.assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
          ],
        );
        return true;
      } catch {
        return false;
      }
    };

    // …then each task needs EDIT rights: participants act on their own tasks; anyone
    // else must hold edit scope over the task's core participants.
    const editable: typeof candidates = [];
    // Same org clock findTaskOrFail(isWrite) uses — respects a test org's simulated time.
    const tagNow = isTagAction ? await this.clock.now(orgId) : null;
    for (const t of candidates) {
      if (isTagAction) {
        if (tagNow && t.created_at > tagNow)
          skipped.push({
            id: t.id,
            title: t.title,
            reason: SIMULATED_FUTURE_TASK_MESSAGE,
          });
        else if (await canEditFields(t)) editable.push(t);
        else
          skipped.push({
            id: t.id,
            title: t.title,
            reason: 'You do not have edit access to this task.',
          });
        continue;
      }
      const onTask =
        t.created_by_user_id === principal.userId ||
        t.assignees.some((a) => a.user_id === principal.userId && !a.is_cc);
      if (onTask || principal.isAdmin) {
        editable.push(t);
        continue;
      }
      try {
        await this.scope.assertCanActOn(
          orgId,
          principal,
          TASK_LEAF,
          PermissionAction.edit,
          [
            t.created_by_user_id,
            ...t.assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
          ],
        );
        editable.push(t);
      } catch {
        skipped.push({
          id: t.id,
          title: t.title,
          reason: 'You do not have edit access to this task.',
        });
      }
    }

    if (action === 'status') {
      if (!payload.status_id)
        throw new BadRequestException('Status is required');
      const st = await this.prisma.taskStatus.findFirst({
        where: {
          id: payload.status_id,
          organization_id: orgId,
          is_active: true,
        },
      });
      if (!st) throw new BadRequestException('Status not found or inactive');
      // Terminal outcomes carry business rules (proof, checklists, the undo window) —
      // they can never be hand-set, not even in bulk. Use the Complete action.
      if (isTerminal(st.type)) {
        throw new BadRequestException(
          'Closed statuses can’t be set by hand — use the Complete or Mark Incomplete action.',
        );
      }
      const ids: string[] = [];
      for (const t of editable) {
        if (isTerminal(t.status?.type)) {
          skipped.push({
            id: t.id,
            title: t.title,
            reason: 'Closed — reopen it before changing its status.',
          });
        } else if (t.completion_mode === CompletionMode.all_must_complete) {
          skipped.push({
            id: t.id,
            title: t.title,
            reason: 'Tracks per-person statuses — set them on the task itself.',
          });
        } else {
          ids.push(t.id);
        }
      }
      if (ids.length) {
        await this.prisma.task.updateMany({
          where: { id: { in: ids } },
          data: {
            status_id: payload.status_id,
            status_actor_user_id: principal.userId,
          },
        });
        await Promise.all(
          ids.map((id) =>
            this.taskAccess
              .logActivity(orgId, id, principal.userId, 'status_changed', {
                bulk: true,
              })
              .catch(swallow('tasks.bulkUpdate', null)),
          ),
        );
      }
      return { updated: ids.length, skipped };
    }

    if (action === 'deadline') {
      const newDeadline = payload.deadline ? new Date(payload.deadline) : null;
      const ids: string[] = [];
      for (const t of editable) {
        if (isTerminal(t.status?.type)) {
          skipped.push({
            id: t.id,
            title: t.title,
            reason: 'Closed — its deadline is part of the record.',
          });
        } else {
          ids.push(t.id);
        }
      }
      if (ids.length) {
        // Keep the persisted overdue flag in sync with the new deadline (the sweep
        // re-flags if it lapses again). Holiday adjustment is not forced here — a
        // bulk deadline is an explicit, deliberate user choice.
        const stillOverdue = !!newDeadline && newDeadline < new Date();
        const byId = new Map(editable.map((t) => [t.id, t]));

        // A bulk move gets exactly the same treatment as a single edit. Without this
        // it was the loophole that made the whole baseline pointless: select fifty
        // tasks, push the date, and every scorecard comes up clean.
        const revising = ids.filter((id) => byId.get(id)!.deadline !== null);
        const firstTime = ids.filter((id) => byId.get(id)!.deadline === null);

        // Baseline freeze / date move / revision trail commit together for the whole batch.
        await this.prisma.$transaction(async (tx) => {
          // Tasks getting their FIRST deadline: this IS the baseline, not a revision.
          if (firstTime.length) {
            await tx.task.updateMany({
              where: { id: { in: firstTime } },
              data: {
                deadline: newDeadline,
                original_deadline: newDeadline,
                is_overdue: stillOverdue,
                overdue_at: stillOverdue ? new Date() : null,
              },
            });
          }

          // Genuine revisions: the live date moves, the baseline stands, counter ticks.
          if (revising.length) {
            await tx.task.updateMany({
              where: { id: { in: revising } },
              data: {
                deadline: newDeadline,
                is_overdue: stillOverdue,
                overdue_at: stillOverdue ? new Date() : null,
                deadline_revision_count: { increment: 1 },
              },
            });
            await tx.taskDeadlineRevision.createMany({
              data: revising.map((id) => ({
                organization_id: orgId,
                task_id: id,
                from_deadline: byId.get(id)!.deadline,
                to_deadline: newDeadline,
                reason: 'Changed in a bulk update',
                changed_by_user_id: principal.userId,
              })),
            });
          }
        });

        // Defensive baseline freeze (best-effort, kept outside the transaction).
        if (revising.length) {
          await Promise.all(
            revising
              .filter((id) => byId.get(id)!.original_deadline === null)
              .map((id) =>
                this.prisma.task
                  .update({
                    where: { id },
                    data: { original_deadline: byId.get(id)!.deadline },
                  })
                  .catch(swallow('tasks.bulkUpdate', null)),
              ),
          );
        }

        // Relative reminders were derived from the OLD dates — re-hang them, or they
        // fire after the deadline they were meant to pre-empt (or never fire).
        for (const id of ids) {
          await this.taskReconcile
            .recomputeRemindersForDeadline(orgId, id, newDeadline)
            .catch(swallow('tasks.bulkUpdate', null));
          // Workflow: a step's deadline follows its task's (never throws).
          if (byId.get(id)!.workflow_instance_step_id) {
            await this.workflowEngine.syncStepFromTask(orgId, id);
          }
        }

        await Promise.all(
          ids.map((id) =>
            this.taskAccess
              .logActivity(orgId, id, principal.userId, 'edited', {
                bulk: true,
                field: 'deadline',
              })
              .catch(swallow('tasks.bulkUpdate', null)),
          ),
        );

        // Tell the people who have to hit these dates. Same event as a single edit,
        // so an org that finds it noisy can switch it off in one place.
        const actorName = await this.notifications.userName(principal.userId);
        const fmt = (d: Date | null) =>
          d
            ? new Date(d).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : 'no deadline';
        for (const id of ids) {
          const t = byId.get(id)!;
          const recipients = [
            t.created_by_user_id,
            ...t.assignees.map((a) => a.user_id),
          ].filter((uid) => uid !== principal.userId);
          if (!recipients.length) continue;
          await this.notifications
            .emit({
              orgId,
              module: 'tasks',
              event_type: 'task_deadline_changed',
              recipients,
              title: `${actorName} changed a task deadline`,
              body: `“${t.title}”\n${fmt(t.deadline)} → ${fmt(newDeadline)}`,
              link: `/dashboard/tasks/${id}`,
              entity: { type: 'task', id },
            })
            .catch(swallow('tasks.bulkUpdate', null));
        }
      }
      return { updated: ids.length, skipped };
    }

    if (action === 'complete') {
      // Route every task through the REAL completion engine so nothing is skipped:
      // proof gates, checklist gates, per-person scoreboards, terminal guards,
      // notifications and the undo window all apply. all_must tasks are closed via
      // the owner override (creator/admin only); an assignee completes their own part.
      let updated = 0;
      for (const t of editable) {
        try {
          const isOwner =
            t.created_by_user_id === principal.userId || principal.isAdmin;
          if (
            t.completion_mode === CompletionMode.all_must_complete &&
            isOwner
          ) {
            await this.taskCompletion.completeTask(
              orgId,
              principal.userId,
              t.id,
              undefined,
              true,
            );
          } else {
            await this.taskCompletion.completeTask(
              orgId,
              principal.userId,
              t.id,
            );
          }
          updated++;
        } catch (err) {
          skipped.push({
            id: t.id,
            title: t.title,
            reason: (err as Error).message ?? 'Could not be completed.',
          });
        }
      }
      return { updated, skipped };
    }

    if (isTagAction) {
      return this.bulkApplyTags(
        orgId,
        principal.userId,
        editable,
        action,
        bulkTagIds,
        skipped,
      );
    }

    throw new BadRequestException('Unknown bulk action');
  }

  /**
   * Remove-side validation for bulk tagging: de-duplicated ids that must all be tags
   * of THIS org (active or not). A foreign/unknown id is a 400, never silently ignored.
   */

  async assertTagIdsInOrg(orgId: string, tagIds: string[]): Promise<string[]> {
    if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'string')) {
      throw new BadRequestException(
        'The tags are not in a valid format. Refresh the page and try again.',
      );
    }
    const ids = [...new Set(tagIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_TAG_FILTER_IDS) {
      throw new BadRequestException(`Pick at most ${MAX_TAG_FILTER_IDS} tags.`);
    }
    if (!ids.length) return [];
    const found = await this.prisma.taskTag.count({
      where: { id: { in: ids }, organization_id: orgId },
    });
    if (found !== ids.length)
      throw new BadRequestException('Tag not found in this organization.');
    return ids;
  }

  /**
   * The add_tags / remove_tags half of bulkUpdate, over tasks already cleared for
   * edit. `updated` counts tasks whose tags actually changed; a task that already
   * carries (add) or lacks (remove) every chosen tag is neither updated nor skipped.
   * A task that would pass the per-task limit is skipped with the reason.
   */

  async bulkApplyTags(
    orgId: string,
    actorId: string,
    editable: {
      id: string;
      title: string;
      tags: Parameters<typeof toTagRefs>[0];
    }[],
    action: 'add_tags' | 'remove_tags',
    tagIds: string[],
    skipped: { id: string; title: string; reason: string }[],
  ) {
    const refs =
      action === 'add_tags'
        ? await loadTagRefMap(this.prisma, orgId, tagIds)
        : new Map<string, TaskTagRef>();
    const chosen = new Set(tagIds);
    const changes: {
      id: string;
      entry: NonNullable<ReturnType<typeof tagChangeEntry>>;
    }[] = [];
    const addRows: {
      organization_id: string;
      task_id: string;
      tag_id: string;
      created_by_user_id: string;
    }[] = [];
    const removeFrom: string[] = [];

    for (const t of editable) {
      const current = toTagRefs(t.tags);
      const currentIds = new Set(current.map((c) => c.id));
      let next: TaskTagRef[];
      if (action === 'add_tags') {
        const toAdd = tagIds.filter((id) => !currentIds.has(id));
        if (!toAdd.length) continue;
        if (currentIds.size + toAdd.length > MAX_TAGS_PER_TASK) {
          skipped.push({
            id: t.id,
            title: t.title,
            reason: `A task can have at most ${MAX_TAGS_PER_TASK} tags.`,
          });
          continue;
        }
        for (const tagId of toAdd) {
          addRows.push({
            organization_id: orgId,
            task_id: t.id,
            tag_id: tagId,
            created_by_user_id: actorId,
          });
        }
        next = [
          ...current,
          ...toAdd
            .map((id) => refs.get(id))
            .filter((r): r is TaskTagRef => !!r),
        ];
      } else {
        if (!current.some((c) => chosen.has(c.id))) continue;
        removeFrom.push(t.id);
        next = current.filter((c) => !chosen.has(c.id));
      }
      const entry = tagChangeEntry(current, next);
      if (entry) changes.push({ id: t.id, entry });
    }

    if (addRows.length) {
      await this.prisma.taskTagLink.createMany({
        data: addRows,
        skipDuplicates: true,
      });
    }
    if (removeFrom.length) {
      await this.prisma.taskTagLink.deleteMany({
        where: {
          organization_id: orgId,
          task_id: { in: removeFrom },
          tag_id: { in: tagIds },
        },
      });
    }

    // One 'edited' entry per task actually changed, in the same `changes` shape a
    // single edit writes, so the activity feed renders the tag diff identically.
    await Promise.all(
      changes.map(({ id, entry }) =>
        this.taskAccess
          .logActivity(orgId, id, actorId, 'edited', {
            bulk: true,
            changes: [entry],
          })
          .catch(swallow('tasks.bulkApplyTags', null)),
      ),
    );
    return { updated: changes.length, skipped };
  }
}
