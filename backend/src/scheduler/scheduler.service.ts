import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditWriterService } from '../audit/audit-writer.service';
import { LeaveService } from '../leave/leave.service';
import { R2Service } from '../storage/r2.service';
import { extensionOf } from '../tasks/task-attachments.service';
import { shouldEntryFireToday } from '../common/recurrence/should-fire-today';
import { filterActiveOrgMembers } from '../common/org-members';
import { resolveRemindAt, expandReminderRows, type ReminderSpec } from '../common/reminders/reminder-spec';
import { isTerminal, TERMINAL_TYPES } from '../tasks/status-phase';
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee';
import { GoalsService } from '../goals/goals.service';

// Rolling look-ahead for meeting rhythms: the nightly cron keeps the next 60 days
// of occurrences materialised. (Tasks spawn day-of; rhythms need advance visibility.)
const MEETING_RHYTHM_HORIZON_DAYS = 60;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly auditWriter: AuditWriterService,
    private readonly leave: LeaveService,
    private readonly r2: R2Service,
    private readonly goals: GoalsService,
  ) {}

  /**
   * Copy every (non-deleted) attachment from a recurring template into a freshly
   * spawned child task. Each copy is an independent R2 object + TaskAttachment row,
   * so the child behaves exactly like a manually-attached task (its own download,
   * per-instance delete). Best-effort: a copy failure is logged and skipped so it
   * never aborts the spawn.
   */
  private async copyTemplateAttachmentsToTask(
    template: { id: string; organization_id: string; created_by_user_id: string },
    taskId: string,
  ): Promise<void> {
    const masters = await this.prisma.recurringTemplateAttachment.findMany({
      where: { recurring_template_id: template.id, organization_id: template.organization_id, is_deleted: false },
    });
    if (masters.length === 0) return;
    if (!this.r2.isConfigured) {
      this.logger.warn(`Skipping ${masters.length} template attachment copies for task ${taskId}: R2 not configured`);
      return;
    }

    for (const master of masters) {
      try {
        const destKey = `org/${template.organization_id}/tasks/${taskId}/${randomUUID()}.${extensionOf(master.file_name)}`;
        await this.r2.copyObject(master.storage_key, destKey);
        await this.prisma.taskAttachment.create({
          data: {
            organization_id: template.organization_id,
            task_id: taskId,
            file_name: master.file_name,
            mime_type: master.mime_type,
            size_bytes: master.size_bytes,
            storage_key: destKey,
            uploaded_by_user_id: master.uploaded_by_user_id,
          },
        });
      } catch (err) {
        this.logger.error(`Failed to copy template attachment ${master.id} to task ${taskId}: ${err}`);
      }
    }
  }

  // ─── Recurring Task Spawn Engine ──────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async spawnRecurringTasks() {
    this.logger.log('Recurring spawn engine starting...');
    const now = new Date();

    // Real-time orgs only — test orgs are advanced by the ReplayService on their sim clock.
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });

    let spawned = 0;
    for (const org of orgs) {
      const r = await this.spawnRecurringForOrg(org.id, now);
      spawned += r.spawned;
      await this.spawnDemandedLogsForOrg(org.id, now);
      // Meeting rhythms materialise a rolling 60-day look-ahead (nightly top-up) so
      // people can see the series on their calendars in advance.
      await this.spawnMeetingRhythmsForOrg(org.id, now, MEETING_RHYTHM_HORIZON_DAYS);
    }

    this.logger.log(`Recurring spawn: ${spawned} tasks spawned`);
  }

  // ─── Goal check-in reminders ──────────────────────────────────────────────────
  // The Goals module's heartbeat. `next_review_date` is meaningless unless
  // somebody is actually told, so this nudges the owner the day a check-in comes
  // due and again once they are properly late. Deduped per (event, goal) by the
  // notifications service, so an owner is never nagged twice for one miss.

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sendGoalCheckInReminders() {
    const now = new Date();
    // Real-time orgs only — test orgs are driven by ReplayService on their sim clock.
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    for (const org of orgs) {
      try {
        await this.processGoalCheckInsForOrg(org.id, now);
      } catch (err) {
        this.logger.warn(`Goal check-in reminders failed for org ${org.id}: ${err}`);
      }
    }
  }

  /** Also called by ReplayService so simulated clocks fire these too. */
  async processGoalCheckInsForOrg(orgId: string, now: Date): Promise<void> {
    const master = await this.notifications.getMaster(orgId);
    const followupDays = master?.overdue_followup_days ?? 2;
    const r = await this.goals.sendCheckInReminders(orgId, now, followupDays);
    if (r.due || r.overdue) {
      this.logger.log(`Goal check-ins for org ${orgId}: ${r.due} due, ${r.overdue} overdue`);
    }
  }

  // ─── Recurring leave look-ahead ───────────────────────────────────────────────
  // Warn a recurring template's creator in advance when an upcoming occurrence lands
  // on a date one of its assignees will be on leave. Lead time is per-org config.

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async warnRecurringLeaveConflicts() {
    const now = new Date();
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    for (const org of orgs) {
      try {
        await this.warnRecurringLeaveForOrg(org.id, now);
      } catch (err) {
        this.logger.warn(`Recurring leave look-ahead failed for org ${org.id}: ${err}`);
      }
    }
  }

  async warnRecurringLeaveForOrg(orgId: string, now: Date): Promise<void> {
    const cfg = await this.leave.getConfig(orgId);
    const notice = cfg.recurringNoticeDays;
    if (notice <= 0) return;

    const entries = await this.prisma.recurringScheduleEntry.findMany({
      where: { is_active: true, organization_id: orgId, template: { is_active: true } },
      include: { template: true },
    });
    if (entries.length === 0) return;

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    for (const entry of entries) {
      const assigneeIds = Array.isArray(entry.template.assignee_user_ids)
        ? (entry.template.assignee_user_ids as string[])
        : [];
      if (assigneeIds.length === 0) continue;

      for (let d = 1; d <= notice; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        if (!shouldEntryFireToday(entry, date)) continue;

        const onLeave = await this.leave.onLeaveTodayMap(orgId, assigneeIds, date);
        if (onLeave.size === 0) continue;

        const ids = Array.from(onLeave.keys());
        const users = await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { name: true },
        });
        const names = users.map((u) => u.name).join(', ');
        const dateStr = date.toISOString().slice(0, 10);
        await this.notifications.emit({
          orgId,
          module: 'tasks',
          event_type: 'recurring_assignee_on_leave',
          recipients: [entry.template.created_by_user_id],
          title: 'Upcoming recurring task — assignee on leave',
          body: `On ${dateStr}, "${entry.template.title}" is due but ${names} will be on leave.`,
          link: '/dashboard/tasks/recurring',
          // Composite id → dedupe per template + occurrence date.
          entity: { type: 'recurring_template', id: `${entry.template.id}:${dateStr}` },
          dedupe: true,
        });
      }
    }
  }

  // Org-scoped, now-injected spawn — used by the midnight cron (real now) and by
  // ReplayService (a simulated day instant) so both paths share identical logic.
  async spawnRecurringForOrg(orgId: string, now: Date): Promise<{ spawned: number }> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'recurring_spawn', occurredAt: now },
      () => this.spawnRecurringForOrgImpl(orgId, now),
    );
  }

  private async spawnRecurringForOrgImpl(orgId: string, now: Date): Promise<{ spawned: number }> {
    const entries = await this.prisma.recurringScheduleEntry.findMany({
      where: { is_active: true, organization_id: orgId, template: { is_active: true } },
      include: { template: true },
    });

    let spawned = 0;
    for (const entry of entries) {
      const did = await this.spawnEntry(entry, false, now);
      if (did) spawned++;
    }

    // Deactivate on_date entries whose end_date has passed (relative to `now`)
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    await this.prisma.recurringScheduleEntry.updateMany({
      where: { is_active: true, organization_id: orgId, end_condition: 'on_date', end_date: { lt: today } },
      data: { is_active: false },
    });

    return { spawned };
  }

  // Spawn today's task for a specific template (on-demand, e.g. after create/resume).
  // `now` is the org's effective clock (real, or simulated for test orgs).
  async spawnForTemplate(orgId: string, templateId: string, force = false, now: Date = new Date()): Promise<{ spawned: number }> {
    const entries = await this.prisma.recurringScheduleEntry.findMany({
      where: { is_active: true, recurring_template_id: templateId, organization_id: orgId, template: { is_active: true } },
      include: { template: true },
    });

    let spawned = 0;
    for (const entry of entries) {
      const did = await this.spawnEntry(entry, force, now);
      if (did) spawned++;
    }
    return { spawned };
  }

  private async spawnEntry(entry: any, force = false, now: Date = new Date()): Promise<boolean> {
    try {
      if (!shouldEntryFireToday(entry, now)) return false;

      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

      if (!force) {
        const alreadyToday = await this.prisma.task.count({
          where: {
            organization_id: entry.organization_id,
            recurring_template_id: entry.recurring_template_id,
            is_deleted: false,
            created_at: { gte: todayStart, lte: todayEnd },
          },
        });
        if (alreadyToday > 0) return false;
      }

      const template = entry.template;

      const status = await this.prisma.taskStatus.findFirst({
        where: { organization_id: template.organization_id, is_default: true, is_active: true },
        orderBy: { order_index: 'asc' },
      });
      if (!status) return false;

      const [h, m] = entry.time.split(':').map(Number);
      const rawDeadline = new Date(now);
      rawDeadline.setHours(h, m, 0, 0);

      const adjustedDeadline = await this.holidaysService.adjustDeadline(rawDeadline, template.organization_id);
      if (adjustedDeadline === null) {
        const newCount = entry.occurrence_count + 1;
        await this.prisma.recurringScheduleEntry.update({
          where: { id: entry.id },
          data: {
            occurrence_count: { increment: 1 },
            ...(entry.end_condition === 'after_n' && entry.end_after !== null && newCount >= entry.end_after && { is_active: false }),
          },
        });
        const holidayName = await this.holidaysService['getHolidayNameForDate'](rawDeadline, template.organization_id).catch(() => 'Holiday');
        this.logger.log(`Spawn skipped for entry ${entry.id} due to holiday: ${holidayName}`);
        return false;
      }

      // The goal link is re-verified per spawn — a goal deleted after the template
      // was created must not abort every future spawn on a dangling reference.
      let goalId: string | undefined;
      if (template.linked_goal_id) {
        const goal = await this.prisma.goal.findFirst({
          where: { id: template.linked_goal_id, organization_id: template.organization_id },
          select: { id: true },
        });
        goalId = goal?.id;
      }

      let task;
      try {
        task = await this.prisma.task.create({
          data: {
            organization_id: template.organization_id,
            title: template.title,
            description: template.description ?? undefined,
            category_id: template.category_id ?? undefined,
            priority_id: template.priority_id ?? undefined,
            status_id: status.id,
            quadrant: template.quadrant,
            type: 'recurring',
            created_by_user_id: template.created_by_user_id,
            department_id: template.department_id ?? undefined,
            completion_mode: template.completion_mode,
            proof_required: template.proof_required,
            proof_allowed_extensions: Array.isArray(template.proof_allowed_extensions)
              ? template.proof_allowed_extensions
              : [],
            goal_id: goalId,
            deadline: adjustedDeadline,
            // The date this occurrence is born committed to, frozen as its compliance
            // baseline. A spawned task is graded against this, so someone revising the
            // occurrence's deadline later can't turn a late one on-time.
            original_deadline: adjustedDeadline,
            recurring_template_id: template.id,
            recurring_spawn_date: todayStart, // date-only; unique index blocks a same-day duplicate
            created_at: now, // align instance date with the (possibly simulated) clock
          },
        });
      } catch (err) {
        // A concurrent scheduler tick / template-create trigger, or a repeat "Run Today",
        // lost the race — the DB unique index (template, spawn day) already holds today's
        // instance. This is expected, not a failure: no-op quietly, don't spawn a duplicate.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return false;
        }
        throw err;
      }

      const assigneeIds = template.assignee_user_ids as string[];
      const ccIds = template.cc_user_ids as string[];

      if (assigneeIds.length > 0) {
        await this.prisma.taskAssignee.createMany({
          data: assigneeIds.map((uid) => ({ organization_id: template.organization_id, task_id: task.id, user_id: uid, is_cc: false })),
          skipDuplicates: true,
        });
      }
      if (ccIds.length > 0) {
        await this.prisma.taskAssignee.createMany({
          data: ccIds.map((uid) => ({ organization_id: template.organization_id, task_id: task.id, user_id: uid, is_cc: true })),
          skipDuplicates: true,
        });
      }

      // Materialize the template's escalation contacts so the escalation engine
      // fires when this instance goes overdue (level = list position + 1).
      // Membership is re-verified per spawn — a contact who left the org is
      // skipped rather than getting rows the engine would escalate into a void.
      const escalationIds = Array.isArray(template.escalation_user_ids)
        ? await filterActiveOrgMembers(
            this.prisma,
            template.organization_id,
            template.escalation_user_ids as string[],
          )
        : [];
      if (escalationIds.length > 0) {
        await this.prisma.taskEscalation.createMany({
          data: escalationIds.map((uid, idx) => ({
            organization_id: template.organization_id,
            task_id: task.id,
            level: idx + 1,
            escalate_to_user_id: uid,
            is_active: true,
          })),
        });
      }

      // Carry the template's attachments into this instance (best-effort).
      await this.copyTemplateAttachmentsToTask(template, task.id);

      // Recreate the template's checklist on this instance.
      const checklistItems = Array.isArray(template.checklist_items)
        ? (template.checklist_items as Array<{ title: string; group_title?: string; order_index: number }>)
        : [];
      if (checklistItems.length > 0) {
        await this.prisma.taskChecklist.createMany({
          data: checklistItems.map((item, idx) => ({
            organization_id: template.organization_id,
            task_id: task.id,
            title: item.title,
            group_title: item.group_title ?? null,
            order_index: item.order_index ?? idx,
          })),
        });
      }

      // Recreate the template's reminders on this instance — relative ones are
      // recomputed against THIS instance's (holiday-adjusted) deadline.
      const reminderSpecs = Array.isArray(template.reminder_specs)
        ? (template.reminder_specs as ReminderSpec[])
        : [];
      if (reminderSpecs.length > 0) {
        const reminderRows = reminderSpecs.flatMap((spec) => {
          const at = resolveRemindAt(spec, adjustedDeadline, now);
          return at
            ? expandReminderRows(spec, at).map((r) => ({ organization_id: template.organization_id, task_id: task.id, ...r }))
            : [];
        });
        if (reminderRows.length > 0) await this.prisma.taskReminder.createMany({ data: reminderRows });
      }

      const newCount = entry.occurrence_count + 1;
      await this.prisma.recurringScheduleEntry.update({
        where: { id: entry.id },
        data: {
          occurrence_count: { increment: 1 },
          ...(entry.end_condition === 'after_n' && entry.end_after !== null && newCount >= entry.end_after && { is_active: false }),
        },
      });

      const activeCount = await this.prisma.recurringScheduleEntry.count({
        where: { recurring_template_id: template.id, is_active: true },
      });
      if (activeCount === 0) {
        await this.prisma.recurringTemplate.update({ where: { id: template.id }, data: { is_active: false } });
      }

      const deadlineAdjusted = adjustedDeadline.getTime() !== rawDeadline.getTime();
      await this.prisma.taskActivityLog.create({
        data: {
          organization_id: template.organization_id,
          task_id: task.id,
          performed_by_user_id: 'system',
          action: 'created',
          metadata: {
            source: 'recurring_spawn',
            template_id: template.id,
            entry_id: entry.id,
            ...(deadlineAdjusted && { deadline_adjusted: true, original_deadline: rawDeadline.toISOString(), adjusted_deadline: adjustedDeadline.toISOString() }),
          } as never,
        },
      });

      await this.notifications.emit({
        orgId: template.organization_id,
        module: 'tasks',
        event_type: 'recurring_spawned',
        recipients: assigneeIds,
        title: 'Recurring task created',
        body: `Today's "${template.title}" is ready.`,
        link: `/dashboard/tasks/${task.id}`,
        entity: { type: 'task', id: task.id },
      });

      return true;
    } catch (err) {
      this.logger.error(`Failed to spawn from entry ${entry.id}: ${err}`);
      return false;
    }
  }

  // ─── Meeting Rhythm Spawn Engine ──────────────────────────────────────────────
  // Reuses shouldEntryFireToday verbatim (the SAME evaluator as tasks/work-logs).
  // Divergences from the task engine, by design:
  //   • rolling look-ahead (horizonDays) instead of day-of, so people see the series;
  //   • holiday = SKIP (a Thursday review must never slide onto Saturday), and a
  //     skipped day does NOT consume an after_n count;
  //   • after_n is measured against the live count of already-spawned instances
  //     (COUNT), so the rolling horizon and nightly re-runs can never double-count.
  async spawnMeetingRhythmsForOrg(orgId: string, now: Date, horizonDays = 0): Promise<{ spawned: number }> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'meeting_rhythm_spawn', occurredAt: now },
      () => this.spawnMeetingRhythmsImpl(orgId, now, horizonDays, null),
    );
  }

  // Immediate top-up for one rhythm (called right after create/resume so the series
  // appears without waiting for the nightly cron).
  async spawnForMeetingRhythm(orgId: string, rhythmId: string, now: Date, horizonDays: number): Promise<{ spawned: number }> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'meeting_rhythm_spawn', occurredAt: now },
      () => this.spawnMeetingRhythmsImpl(orgId, now, horizonDays, rhythmId),
    );
  }

  private async spawnMeetingRhythmsImpl(orgId: string, now: Date, horizonDays: number, onlyRhythmId: string | null): Promise<{ spawned: number }> {
    const entries = await this.prisma.meetingRhythmSchedule.findMany({
      where: {
        is_active: true,
        organization_id: orgId,
        rhythm: { is_active: true, ...(onlyRhythmId ? { id: onlyRhythmId } : {}) },
      },
      include: { rhythm: true },
    });
    if (entries.length === 0) return { spawned: 0 };

    // Non-working days for the whole horizon, computed ONCE (not per-rhythm-per-day).
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + horizonDays);
    const holidays = await this.holidaysService.getHolidaysInRange(orgId, today, horizonEnd).catch(() => []);
    const nonWorking = new Set(holidays.map((h) => h.date)); // ISO yyyy-mm-dd

    let spawned = 0;
    for (const entry of entries) {
      spawned += await this.spawnRhythmEntry(entry, today, horizonDays, nonWorking, now);
    }
    return { spawned };
  }

  private async spawnRhythmEntry(entry: any, today: Date, horizonDays: number, nonWorking: Set<string>, now: Date): Promise<number> {
    const rhythm = entry.rhythm;
    // Source of truth for after_n: how many instances this rhythm has EVER spawned
    // (soft-deleted rows count — they occupy their spawn day via the unique index).
    let spawnedCount = await this.prisma.meeting.count({ where: { rhythm_id: rhythm.id } });
    let created = 0;

    for (let offset = 0; offset <= horizonDays; offset++) {
      if (entry.end_condition === 'after_n' && entry.end_after !== null && spawnedCount >= entry.end_after) break;

      const day = new Date(today); day.setDate(today.getDate() + offset); day.setHours(0, 0, 0, 0);
      const probe = { ...entry, occurrence_count: spawnedCount };
      if (!shouldEntryFireToday(probe, day)) continue;

      // Holiday = SKIP (never slide), and do NOT consume an after_n count — but only
      // when the setter left "skip holidays" on (default). Off → run it on the holiday.
      if (entry.skip_holidays !== false && nonWorking.has(day.toISOString().slice(0, 10))) continue;

      const didCreate = await this.materialiseRhythmMeeting(rhythm, entry, day, now);
      if (didCreate) { created++; spawnedCount++; }
    }

    // Persist the display counter and retire the entry/rhythm when after_n is met.
    const done = entry.end_condition === 'after_n' && entry.end_after !== null && spawnedCount >= entry.end_after;
    await this.prisma.meetingRhythmSchedule.update({
      where: { id: entry.id },
      data: { occurrence_count: spawnedCount, ...(done && { is_active: false }) },
    });
    if (done) {
      const activeCount = await this.prisma.meetingRhythmSchedule.count({ where: { meeting_rhythm_id: rhythm.id, is_active: true } });
      if (activeCount === 0) {
        await this.prisma.meetingRhythm.update({ where: { id: rhythm.id }, data: { is_active: false } });
      }
    }
    return created;
  }

  // Create one Meeting instance for a rhythm on `day`. Attendees are `attending` by
  // default (opt-out). P2002 (unique rhythm+day) means a concurrent run already made
  // it — a quiet no-op, never a duplicate. No per-instance notification (60-days-ahead
  // spam); attendees see it on their list + the standard 15-minute reminder fires.
  private async materialiseRhythmMeeting(rhythm: any, entry: any, day: Date, now: Date): Promise<boolean> {
    const [h, m] = String(entry.time).split(':').map(Number);
    const start = new Date(day); start.setHours(h || 0, m || 0, 0, 0);
    const end = new Date(start.getTime() + (rhythm.duration_min ?? 30) * 60_000);
    // @db.Date stores the UTC calendar date. Anchor the spawn-day at UTC-noon of the
    // instance's LOCAL calendar day so the stored date matches scheduled_start's day
    // in any timezone (local-midnight would roll back a day in +UTC offsets like IST,
    // desyncing the dedupe key from the meeting's actual date).
    const spawnDate = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0));

    let meeting;
    try {
      meeting = await this.prisma.meeting.create({
        data: {
          organization_id: rhythm.organization_id,
          title: rhythm.title,
          type: rhythm.type,
          online_link: rhythm.online_link ?? undefined,
          online_password: rhythm.online_password ?? undefined,
          location: rhythm.location ?? undefined,
          status: 'scheduled',
          link_type: rhythm.link_type ?? undefined,
          link_entity_id: rhythm.link_entity_id ?? undefined,
          agenda: rhythm.agenda ?? undefined,
          scheduled_start: start,
          scheduled_end: end,
          created_by_user_id: rhythm.created_by_user_id,
          rhythm_id: rhythm.id,
          rhythm_spawn_date: spawnDate,
          created_at: now,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      this.logger.error(`Failed to spawn rhythm meeting for rhythm ${rhythm.id} on ${spawnDate.toISOString()}: ${err}`);
      return false;
    }

    const attendeeIds = (Array.isArray(rhythm.attendee_user_ids) ? rhythm.attendee_user_ids : []) as string[];
    const optional = new Set((Array.isArray(rhythm.optional_user_ids) ? rhythm.optional_user_ids : []) as string[]);
    await this.prisma.meetingAttendee.create({
      data: {
        organization_id: rhythm.organization_id,
        meeting_id: meeting.id,
        user_id: rhythm.created_by_user_id,
        is_organizer: true,
        is_required: true,
        response: 'attending',
      },
    });
    const roster = attendeeIds.filter((uid) => uid !== rhythm.created_by_user_id);
    if (roster.length > 0) {
      await this.prisma.meetingAttendee.createMany({
        data: roster.map((uid) => ({
          organization_id: rhythm.organization_id,
          meeting_id: meeting.id,
          user_id: uid,
          is_required: !optional.has(uid),
          response: 'attending' as const,
        })),
        skipDuplicates: true,
      });
    }
    return true;
  }

  // ─── Reminder Engine ──────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async processReminders() {
    const now = new Date();
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    for (const org of orgs) await this.processRemindersForOrg(org.id, now);
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processRemindersForOrg(orgId: string, now: Date): Promise<number> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'reminder', occurredAt: now },
      () => this.processRemindersForOrgImpl(orgId, now),
    );
  }

  private async processRemindersForOrgImpl(orgId: string, now: Date): Promise<number> {
    const dueReminders = await this.prisma.taskReminder.findMany({
      where: { organization_id: orgId, remind_at: { lte: now }, is_sent: false },
      take: 500,
    });
    if (dueReminders.length === 0) return 0;

    // Load the reminded tasks (title + assignees + creator + status) for recipient
    // routing (by reminder.type) and yearly re-arm decisions.
    const taskIds = Array.from(new Set(dueReminders.map((r) => r.task_id)));
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        title: true,
        deadline: true,
        created_by_user_id: true,
        status: { select: { type: true } },
        // Reminders route to the LIVE roster (both primary and CC), so a person taken
        // off the task stops being reminded about it.
        assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_cc: true } },
      },
    });
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    this.logger.log(`Processing ${dueReminders.length} reminders for org ${orgId}...`);
    let sent = 0;
    for (const reminder of dueReminders) {
      try {
        const task = taskMap.get(reminder.task_id);

        // Yearly reminders re-arm to next year (until the task closes); everything
        // else is marked sent once.
        const rearm =
          reminder.recurrence === 'yearly' && task && !isTerminal(task.status?.type);
        if (rearm) {
          const next = new Date(reminder.remind_at);
          while (next <= now) next.setFullYear(next.getFullYear() + 1);
          await this.prisma.taskReminder.update({ where: { id: reminder.id }, data: { remind_at: next } });
        } else {
          await this.prisma.taskReminder.update({ where: { id: reminder.id }, data: { is_sent: true } });
        }

        await this.prisma.taskActivityLog.create({
          data: {
            organization_id: reminder.organization_id,
            task_id: reminder.task_id,
            performed_by_user_id: 'system',
            action: 'reminder_sent',
            metadata: { reminder_id: reminder.id, type: reminder.type } as never,
          },
        });

        if (task) {
          // Route recipients by the reminder's type.
          const recipients =
            reminder.type === 'assigner'
              ? [task.created_by_user_id]
              : reminder.type === 'cc'
                ? task.assignees.filter((a) => a.is_cc).map((a) => a.user_id)
                : task.assignees.filter((a) => !a.is_cc).map((a) => a.user_id);
          if (recipients.length > 0) {
            const due = task.deadline
              ? ` (due ${task.deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`
              : '';
            await this.notifications.emit({
              orgId,
              module: 'tasks',
              event_type: 'task_reminder',
              recipients,
              title: 'Task reminder',
              body: `Reminder: "${task.title}"${due}`,
              link: `/dashboard/tasks/${task.id}`,
              entity: { type: 'task', id: task.id },
            });
          }
        }
        sent++;
      } catch (err) {
        this.logger.error(`Failed to process reminder ${reminder.id}: ${err}`);
      }
    }
    return sent;
  }

  // ─── Meeting Reminder Engine (15 minutes before a scheduled meeting) ───────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processMeetingReminders() {
    const now = new Date();
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    for (const org of orgs) await this.processMeetingRemindersForOrg(org.id, now);
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processMeetingRemindersForOrg(orgId: string, now: Date): Promise<number> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'meeting_reminder', occurredAt: now },
      () => this.processMeetingRemindersForOrgImpl(orgId, now),
    );
  }

  private async processMeetingRemindersForOrgImpl(orgId: string, now: Date): Promise<number> {
    const windowEnd = new Date(now.getTime() + 15 * 60_000);
    const due = await this.prisma.meeting.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        status: 'scheduled',
        reminder_sent: false,
        scheduled_start: { not: null, lte: windowEnd },
      },
      select: {
        id: true,
        title: true,
        scheduled_start: true,
        // Opt-out: remind everyone who has NOT declined (attending-by-default), not
        // just those who opted in — nobody chose the time, so everyone still on it
        // gets the heads-up.
        attendees: { where: { response: { not: 'declined' } }, select: { user_id: true } },
      },
      take: 500,
    });
    if (due.length === 0) return 0;

    let sent = 0;
    for (const m of due) {
      try {
        await this.prisma.meeting.update({ where: { id: m.id }, data: { reminder_sent: true } });
        // Only actually notify if the meeting is still upcoming (skip long-past on a clock jump).
        if (m.scheduled_start && m.scheduled_start >= now && m.attendees.length) {
          await this.notifications.emit({
            orgId,
            module: 'meetings',
            event_type: 'meeting_reminder',
            recipients: m.attendees.map((a) => a.user_id),
            title: 'Meeting in 15 minutes',
            body: `"${m.title}" starts soon`,
            link: `/dashboard/governance/meetings/${m.id}`,
            entity: { type: 'meeting', id: m.id },
          });
        }
        sent++;
      } catch (err) {
        this.logger.error(`Failed to process meeting reminder ${m.id}: ${err}`);
      }
    }
    return sent;
  }

  // ─── Escalation Engine ────────────────────────────────────────────────────────

  @Cron('*/15 * * * *')
  async processEscalations() {
    const now = new Date();
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    let escalated = 0;
    for (const org of orgs) escalated += await this.processEscalationsForOrg(org.id, now);
    if (escalated > 0) this.logger.log(`Escalation engine: ${escalated} escalated`);
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processEscalationsForOrg(orgId: string, now: Date): Promise<number> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'escalation', occurredAt: now },
      () => this.processEscalationsForOrgImpl(orgId, now),
    );
  }

  private async processEscalationsForOrgImpl(orgId: string, now: Date): Promise<number> {
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        deadline: { lt: now },
        escalations: { some: { is_active: true } },
      },
      include: {
        status: { select: { type: true } },
        escalations: { where: { is_active: true }, orderBy: { level: 'asc' } },
        // Escalation copies go to the LIVE roster only.
        assignees: { where: { ...ACTIVE_ASSIGNEE, is_cc: false }, select: { user_id: true } },
      },
    });

    let escalated = 0;
    for (const task of overdueTasks) {
      if (isTerminal(task.status?.type)) continue;
      const untriggered = task.escalations.find((e) => e.escalated_at === null);
      if (!untriggered) continue;

      if (untriggered.level > 1) {
        const prev = task.escalations.find((e) => e.level === untriggered.level - 1);
        if (!prev?.escalated_at) continue;
        const hoursSincePrev = (now.getTime() - prev.escalated_at.getTime()) / 3_600_000;
        if (hoursSincePrev < 1) continue;
      }

      try {
        await this.prisma.taskEscalation.update({
          where: { id: untriggered.id },
          data: { escalated_at: now },
        });
        await this.prisma.taskActivityLog.create({
          data: {
            organization_id: task.organization_id,
            task_id: task.id,
            performed_by_user_id: 'system',
            action: 'escalated',
            metadata: { level: untriggered.level, escalated_to: untriggered.escalate_to_user_id } as never,
          },
        });
        await this.notifications.emit({
          orgId,
          module: 'tasks',
          event_type: 'task_escalated',
          recipients: [untriggered.escalate_to_user_id, ...task.assignees.map((a) => a.user_id)],
          title: `Task escalated (level ${untriggered.level})`,
          body: `"${task.title}" is overdue and has been escalated.`,
          link: `/dashboard/tasks/${task.id}`,
          entity: { type: 'task', id: task.id },
        });
        escalated++;
      } catch (err) {
        this.logger.error(`Failed to escalate task ${task.id}: ${err}`);
      }
    }
    return escalated;
  }

  // ─── Demanded Work Log Spawn Engine ───────────────────────────────────────────
  // Materializes WorkLogSubmission rows from recurring WorkLogDemandSchedule entries.
  // Daily-frequency demands fold into that day's Daily Update (no separate chase);
  // any other frequency stands alone with its own deadline + a notification.
  async spawnDemandedLogsForOrg(orgId: string, now: Date): Promise<{ spawned: number }> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'demand_spawn', occurredAt: now },
      () => this.spawnDemandedLogsForOrgImpl(orgId, now),
    );
  }

  private async spawnDemandedLogsForOrgImpl(orgId: string, now: Date): Promise<{ spawned: number }> {
    const entries = await this.prisma.workLogDemandSchedule.findMany({
      where: { is_active: true, organization_id: orgId, demand: { is_active: true } },
      include: { demand: true },
    });

    let spawned = 0;
    for (const entry of entries) {
      if (!shouldEntryFireToday(entry, now)) continue;

      const due = new Date(now);
      due.setHours(0, 0, 0, 0);
      const demand = entry.demand;

      try {
        // Dedupe per day via the (demand_id, due_date) unique constraint.
        const existing = await this.prisma.workLogSubmission.findUnique({
          where: { demand_id_due_date: { demand_id: demand.id, due_date: due } },
        });
        if (existing) continue;

        await this.prisma.workLogSubmission.create({
          data: {
            organization_id: orgId,
            demand_id: demand.id,
            writer_user_id: demand.assignee_user_id,
            due_date: due,
            period_label: formatPeriodLabel(entry.schedule_type, due),
            status: 'pending',
          },
        });

        const newCount = entry.occurrence_count + 1;
        await this.prisma.workLogDemandSchedule.update({
          where: { id: entry.id },
          data: {
            occurrence_count: { increment: 1 },
            ...(entry.end_condition === 'after_n' &&
              entry.end_after !== null &&
              newCount >= entry.end_after && { is_active: false }),
          },
        });

        const activeCount = await this.prisma.workLogDemandSchedule.count({
          where: { demand_id: demand.id, is_active: true },
        });
        if (activeCount === 0) {
          await this.prisma.workLogDemand.update({ where: { id: demand.id }, data: { is_active: false } });
        }

        // Daily demands fold into the Daily Update; others get their own due notification.
        if (entry.schedule_type !== 'daily') {
          await this.notifications.emit({
            orgId,
            module: 'work_logs',
            event_type: 'work_log_demand_due',
            recipients: [demand.assignee_user_id],
            title: 'A log is due',
            body: `"${demand.title}" is due (${formatPeriodLabel(entry.schedule_type, due)}).`,
            link: '/dashboard/governance/daily-update',
            entity: { type: 'work_log_demand', id: demand.id },
          });
        }
        spawned++;
      } catch (err) {
        this.logger.error(`Failed to spawn demanded log from entry ${entry.id}: ${err}`);
      }
    }

    // Deactivate on_date entries whose end_date has passed.
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    await this.prisma.workLogDemandSchedule.updateMany({
      where: { is_active: true, organization_id: orgId, end_condition: 'on_date', end_date: { lt: today } },
      data: { is_active: false },
    });

    return { spawned };
  }

  // ─── Auto-Overdue Detection ───────────────────────────────────────────────────
  // Task "overdue" is otherwise computed at read time and thus invisible to audit.
  // This sweep PERSISTS the transition (is_overdue false→true) so it flows through
  // the Prisma audit extension as a system entry (trigger 'auto_overdue'). Idempotent
  // via the is_overdue flag (mirrors Ticket.sla_breached); replays deterministically.

  @Cron(CronExpression.EVERY_HOUR)
  async detectTaskOverdue() {
    const now = new Date();
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: false },
      select: { id: true },
    });
    let flagged = 0;
    for (const org of orgs) flagged += await this.detectTaskOverdueForOrg(org.id, now);
    if (flagged > 0) this.logger.log(`Auto-overdue: ${flagged} task(s) marked overdue`);
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async detectTaskOverdueForOrg(orgId: string, now: Date): Promise<number> {
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'auto_overdue', occurredAt: now },
      () => this.detectTaskOverdueForOrgImpl(orgId, now),
    );
  }

  private async detectTaskOverdueForOrgImpl(orgId: string, now: Date): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        is_overdue: false,
        deadline: { lt: now },
        status: { type: { notIn: TERMINAL_TYPES } },
      },
      select: { id: true },
    });

    let flagged = 0;
    for (const task of tasks) {
      try {
        // Per-row update so the extension emits one audit entry per task.
        await this.prisma.task.update({
          where: { id: task.id },
          data: { is_overdue: true, overdue_at: now },
        });
        flagged++;
      } catch (err) {
        this.logger.error(`Failed to mark task ${task.id} overdue: ${err}`);
      }
    }

    // Reconcile the OTHER direction: a task flagged overdue may no longer be — its
    // deadline was extended past `now`, cleared, or (on a test org) the simulated
    // clock was rewound behind the deadline. Without this, is_overdue is a one-way
    // latch and a future-dated task keeps showing overdue. Clear the stale flag so
    // is_overdue stays an accurate mirror of "open & past deadline".
    const stale = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        is_overdue: true,
        status: { type: { notIn: TERMINAL_TYPES } },
        OR: [{ deadline: null }, { deadline: { gte: now } }],
      },
      select: { id: true },
    });
    for (const task of stale) {
      try {
        await this.prisma.task.update({
          where: { id: task.id },
          data: { is_overdue: false, overdue_at: null },
        });
      } catch (err) {
        this.logger.error(`Failed to clear overdue on task ${task.id}: ${err}`);
      }
    }
    return flagged;
  }
}

// Human label for a submission's period, derived from its frequency.
function formatPeriodLabel(scheduleType: string, due: Date): string {
  if (scheduleType === 'monthly') {
    return due.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  if (scheduleType === 'yearly') {
    return String(due.getFullYear());
  }
  // daily / weekly → a specific day
  return due.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
