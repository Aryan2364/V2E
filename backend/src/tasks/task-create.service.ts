import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { ChecklistAccessService } from '../task-masters/checklist-access.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { normaliseExtensions } from './task-attachments.service';
import { assertActiveOrgMembers } from '../common/org-members';
import { assertTagsUsable } from '../common/task-masters-usable';
import { isTerminal } from './status-phase';
import {
  resolveRemindAt,
  expandReminderRows,
} from '../common/reminders/reminder-spec';
import { swallow } from '../common/swallow';
import { TASK_INCLUDE, TASK_SUBJECT } from './task-shared';
import { TaskAccessService } from './task-access.service';
import { TaskDetailService } from './task-detail.service';

/** Task creation. */
@Injectable()
export class TaskCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly subjects: SubjectEligibilityService,
    private readonly clock: ClockService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly taskDetail: TaskDetailService,
  ) {}

  async createTask(orgId: string, userId: string, dto: CreateTaskDto) {
    await this.taskAccess.checkTaskPermission(
      orgId,
      userId,
      'task_creation_roles',
    );
    await this.taskAccess.assertGoalInOrg(orgId, dto.goal_id);
    await assertActiveOrgMembers(
      this.prisma,
      orgId,
      dto.escalation_user_ids,
      'escalation contacts',
    );
    // Subject eligibility (below) checks policy, not membership — gate that here.
    await assertActiveOrgMembers(
      this.prisma,
      orgId,
      [...(dto.assignee_user_ids ?? []), ...(dto.cc_user_ids ?? [])],
      'assignees or CC recipients',
    );
    const config = await this.taskAccess.getOrgConfig(orgId);

    // Master references must be this org's own, active rows (foreign/stale ids fail loud).
    await this.taskAccess.assertMastersUsable(orgId, dto);

    // Subject eligibility (fail loud, before any writes): every assignee must be
    // eligible to be assigned a task — even if they have no Tasks actor access.
    await this.subjects.assertAllEligible(
      orgId,
      TASK_SUBJECT,
      dto.assignee_user_ids ?? [],
    );

    // The picker's visibility rules re-checked at save time: the creator may only
    // put people they're allowed to assign to on the task (assignees AND CCs).
    await this.taskAccess.assertAssigneesVisible(orgId, userId, [
      ...(dto.assignee_user_ids ?? []),
      ...(dto.cc_user_ids ?? []),
    ]);

    // Checklist template access: the creator may only apply a template they're
    // allowed to use (by department / role / explicit grant). A task may now
    // combine several template-sourced checklists, so validate every applied id.
    const appliedTemplateIds = [
      ...(dto.checklist_template_id ? [dto.checklist_template_id] : []),
      ...(dto.checklist_template_ids ?? []),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx);
    for (const templateId of appliedTemplateIds) {
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

    // Resolve status. A task can never be BORN closed — terminal outcomes carry
    // business rules (proof, checklists, completion stamps) that only the dedicated
    // Complete / Mark Incomplete actions apply.
    let statusId = dto.status_id;
    if (statusId) {
      const st = await this.prisma.taskStatus.findFirst({
        where: { id: statusId, organization_id: orgId, is_active: true },
      });
      if (!st)
        throw new BadRequestException(
          'Status not found or inactive in this organization',
        );
      if (isTerminal(st.type)) {
        throw new BadRequestException(
          'A task cannot start in a closed status. Create it open, then use Complete.',
        );
      }
    } else {
      statusId = await this.taskAccess.getDefaultStatusId(orgId);
    }

    // Tags: org-owned and active (a foreign/unknown/deactivated id fails loud with a
    // 400 BEFORE any write). Creating a task never needs `keep` — nothing is on it yet.
    const tagIds = await assertTagsUsable(
      this.prisma,
      orgId,
      dto.tag_ids ?? [],
    );

    const assigneeIds = dto.assignee_user_ids ?? [];
    const ccIds = dto.cc_user_ids ?? [];

    // All dependent writes commit together: a failed check (holiday / assignee) or any
    // later insert rolls the whole task back instead of leaving a half-built row.
    const task = await this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.create({
          data: {
            organization_id: orgId,
            created_by_user_id: userId,
            title: dto.title,
            description: dto.description,
            category_id: dto.category_id,
            priority_id: dto.priority_id,
            status_id: statusId,
            quadrant: dto.quadrant ?? 'Q2',
            type: dto.type ?? 'one_time',
            department_id: dto.department_id,
            completion_mode: dto.completion_mode ?? 'any_can_complete',
            proof_required: dto.proof_required ?? false,
            proof_allowed_extensions: normaliseExtensions(
              dto.proof_allowed_extensions,
            ),
            deadline: dto.deadline ? new Date(dto.deadline) : undefined,
            // The date the task is FIRST committed to, frozen here and never rewritten by
            // an edit. Compliance reporting grades against this, so a later revision can
            // never turn a late task on-time retroactively.
            original_deadline: dto.deadline
              ? new Date(dto.deadline)
              : undefined,
            goal_id: dto.goal_id,
          },
          include: TASK_INCLUDE,
        });

        // Holiday deadline adjustment (after create so we have task.id for audit log).
        // The system never FORCES the holiday rule on the user: when the creator has
        // explicitly chosen to keep a holiday date (holiday_override), it stands as-is.
        if (dto.deadline && !dto.holiday_override) {
          const rawDeadline = new Date(dto.deadline);
          const adjusted = await this.holidaysService.adjustDeadline(
            rawDeadline,
            orgId,
            dto.department_id,
            dto.assignee_user_ids?.[0],
            'task',
            task.id,
            task.title,
          );
          if (adjusted === null) {
            throw new BadRequestException(
              'Deadline falls on a non-working day. Keep the date to override, or select a different one.',
            );
          }
          if (adjusted.getTime() !== rawDeadline.getTime()) {
            // The holiday-shifted date is the one the task is actually born with, so it —
            // not the raw picked date — becomes the frozen compliance baseline. Shifting
            // off a non-working day at birth is not a "revision".
            await tx.task.update({
              where: { id: task.id },
              data: { deadline: adjusted, original_deadline: adjusted },
            });
            (task as any).deadline = adjusted;
            (task as any).original_deadline = adjusted;
          }
        }

        if (assigneeIds.length === 0) {
          throw new BadRequestException(
            'At least one assignee is required. CC-only tasks are not allowed.',
          );
        }

        if (assigneeIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: assigneeIds.map((uid) => ({
              organization_id: orgId,
              task_id: task.id,
              user_id: uid,
              is_cc: false,
            })),
            skipDuplicates: true,
          });
        }

        if (ccIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: ccIds.map((uid) => ({
              organization_id: orgId,
              task_id: task.id,
              user_id: uid,
              is_cc: true,
            })),
            skipDuplicates: true,
          });
        }

        // Tag links (validated above). They cascade with the task, so the rollback
        // deletes above — and import undo — take them along.
        if (tagIds.length > 0) {
          await tx.taskTagLink.createMany({
            data: tagIds.map((tagId) => ({
              organization_id: orgId,
              task_id: task.id,
              tag_id: tagId,
              created_by_user_id: userId,
            })),
            skipDuplicates: true,
          });
        }

        // Create checklist items
        if (dto.checklist_items && dto.checklist_items.length > 0) {
          await tx.taskChecklist.createMany({
            data: dto.checklist_items.map((item) => ({
              organization_id: orgId,
              task_id: task.id,
              title: item.title,
              group_title: item.group_title ?? null,
              order_index: item.order_index,
            })),
          });
        }

        // Create escalation entries
        if (dto.escalation_user_ids && dto.escalation_user_ids.length > 0) {
          await tx.taskEscalation.createMany({
            data: dto.escalation_user_ids.map((uid, idx) => ({
              organization_id: orgId,
              task_id: task.id,
              level: idx + 1,
              escalate_to_user_id: uid,
              is_active: true,
            })),
          });
        }

        // Reminders. When the creator supplies `reminders` (even an empty array), those
        // are authoritative; otherwise fall back to the single admin-default reminder.
        if (dto.reminders !== undefined) {
          const remindNow = await this.clock.now(orgId);
          const rows = dto.reminders.flatMap((spec) => {
            const at = resolveRemindAt(spec, task.deadline, remindNow);
            if (!at) return []; // past reminders are dropped by resolveRemindAt
            // Never schedule a (non-yearly) reminder after the deadline.
            if (!spec.yearly && task.deadline && at > task.deadline) return [];
            return expandReminderRows(spec, at).map((r) => ({
              organization_id: orgId,
              task_id: task.id,
              ...r,
            }));
          });
          if (rows.length > 0) await tx.taskReminder.createMany({ data: rows });
        } else if (task.deadline) {
          // Legacy default: one assignee reminder `default_reminder_days_before` before the deadline.
          const remindAt = new Date(task.deadline);
          remindAt.setDate(
            remindAt.getDate() - config.default_reminder_days_before,
          );
          if (remindAt > new Date()) {
            await tx.taskReminder.create({
              data: {
                organization_id: orgId,
                task_id: task.id,
                remind_at: remindAt,
                type: 'assignee',
              },
            });
          }
        }
        return task;
      },
      { timeout: 15_000 },
    );

    // Best-effort assignee-frequency counts (kept outside the transaction: a swallowed
    // constraint error would otherwise abort it).
    // Upsert frequency counts for non-CC assignees
    if (assigneeIds.length > 0) {
      await Promise.all(
        assigneeIds.map(
          (assigneeUserId) =>
            this.prisma.taskAssigneeFrequency
              .upsert({
                where: {
                  organization_id_assigner_user_id_assignee_user_id: {
                    organization_id: orgId,
                    assigner_user_id: userId,
                    assignee_user_id: assigneeUserId,
                  },
                },
                create: {
                  organization_id: orgId,
                  assigner_user_id: userId,
                  assignee_user_id: assigneeUserId,
                  frequency_count: 1,
                  last_assigned_at: new Date(),
                },
                update: {
                  frequency_count: { increment: 1 },
                  last_assigned_at: new Date(),
                },
              })
              .catch(swallow('tasks.createTask', null)), // ignore if constraint fails on race condition
        ),
      );
    }

    // Log creation
    await this.taskAccess.logActivity(orgId, task.id, userId, 'created');

    // Notify assignees + CC (excluding the creator)
    const creatorName = await this.notifications.userName(userId);
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_assigned',
      recipients: assigneeIds.filter((uid) => uid !== userId),
      title: `${creatorName} assigned you a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${task.id}`,
      entity: { type: 'task', id: task.id },
    });
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_assigned',
      recipients: ccIds.filter((uid) => uid !== userId),
      title: `${creatorName} CC’d you on a task`,
      body: `“${task.title}”`,
      link: `/dashboard/tasks/${task.id}`,
      entity: { type: 'task', id: task.id },
    });

    return this.taskDetail.getTask(orgId, task.id);
  }
}
