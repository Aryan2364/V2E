import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee';
import {
  CreateDemandDto,
  CreateReaderGrantDto,
  CreateRemarkDto,
  SubmitSubmissionDto,
  UpdateAccessSettingsDto,
  UpsertDailyUpdateDto,
} from './dto/work-log.dto';

export interface Actor {
  id: string;
  is_admin: boolean;
  isSuperAdmin: boolean;
}

const LINK = '/dashboard/governance';

@Injectable()
export class WorkLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly visibility: AssigneeVisibilityService,
    private readonly subjects: SubjectEligibilityService,
  ) {}

  private isAdmin(actor: Actor): boolean {
    return actor.isSuperAdmin || actor.is_admin;
  }

  // Local-midnight bounds for a calendar day, consistent with the scheduler's
  // local-time deadlines. `date` is 'YYYY-MM-DD'.
  private dayBounds(date: string): { start: Date; end: Date } {
    const [y, m, d] = date.split('-').map(Number);
    return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d, 23, 59, 59, 999) };
  }

  private dateKey(date: string): Date {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  private async today(orgId: string): Promise<string> {
    const now = await this.clock.now(orgId);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ─── Settings / writer access ──────────────────────────────────────────────────

  private async getSettings(orgId: string) {
    return this.prisma.workLogSettings.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
  }

  private async assertCanWrite(orgId: string, userId: string): Promise<void> {
    const settings = await this.getSettings(orgId);
    const allowlist = (settings.writer_user_ids as string[]) ?? [];
    if (allowlist.length > 0 && !allowlist.includes(userId)) {
      throw new ForbiddenException('You are not configured as a Work Log writer');
    }
  }

  // ─── Daily Update ────────────────────────────────────────────────────────────

  async getDay(orgId: string, actor: Actor, dateArg?: string) {
    const date = dateArg ?? (await this.today(orgId));
    const daily = await this.findOrNullDaily(orgId, actor.id, date);

    // Carry-forward: most recent prior day's planning_tomorrow.
    const prev = await this.prisma.dailyUpdate.findFirst({
      where: { organization_id: orgId, user_id: actor.id, log_date: { lt: this.dateKey(date) } },
      orderBy: { log_date: 'desc' },
      select: { log_date: true, planning_tomorrow: true },
    });

    // Daily-frequency demands folded into this day (lazily materialized).
    const folded = await this.getFoldedSubmissions(orgId, actor.id, date);

    return {
      date,
      daily_update: daily,
      previous_planning_tomorrow: prev?.planning_tomorrow ?? null,
      previous_planning_date: prev?.log_date ?? null,
      folded_demands: folded,
    };
  }

  private async findOrNullDaily(orgId: string, userId: string, date: string) {
    const daily = await this.prisma.dailyUpdate.findUnique({
      where: {
        organization_id_user_id_log_date: {
          organization_id: orgId,
          user_id: userId,
          log_date: this.dateKey(date),
        },
      },
      include: { notes: { orderBy: { order_index: 'asc' } } },
    });
    return daily;
  }

  // Active daily-frequency demands for this writer → ensure a submission row for the
  // day, returned with the demand title so the writer fills it inside the Daily Update.
  private async getFoldedSubmissions(orgId: string, userId: string, date: string) {
    const dailyDemands = await this.prisma.workLogDemand.findMany({
      where: {
        organization_id: orgId,
        assignee_user_id: userId,
        is_active: true,
        kind: 'recurring',
        schedule_entries: { some: { is_active: true, schedule_type: 'daily' } },
      },
      select: { id: true, title: true, description: true },
    });

    const out: {
      submission_id: string;
      demand_id: string;
      title: string;
      description: string | null;
      body: string | null;
      status: string;
    }[] = [];

    for (const demand of dailyDemands) {
      const sub = await this.prisma.workLogSubmission.upsert({
        where: { demand_id_due_date: { demand_id: demand.id, due_date: this.dateKey(date) } },
        create: {
          organization_id: orgId,
          demand_id: demand.id,
          writer_user_id: userId,
          due_date: this.dateKey(date),
          period_label: date,
          status: 'pending',
        },
        update: {},
      });
      out.push({
        submission_id: sub.id,
        demand_id: demand.id,
        title: demand.title,
        description: demand.description,
        body: sub.body,
        status: sub.status,
      });
    }
    return out;
  }

  async upsertDay(orgId: string, actor: Actor, dateArg: string | undefined, dto: UpsertDailyUpdateDto) {
    await this.assertCanWrite(orgId, actor.id);
    const date = dateArg ?? (await this.today(orgId));
    const logDate = this.dateKey(date);
    const submittedAt = dto.submit ? new Date() : undefined;

    const daily = await this.prisma.dailyUpdate.upsert({
      where: {
        organization_id_user_id_log_date: { organization_id: orgId, user_id: actor.id, log_date: logDate },
      },
      create: {
        organization_id: orgId,
        user_id: actor.id,
        log_date: logDate,
        stuck: dto.stuck ?? null,
        decisions: dto.decisions ?? null,
        day_summary: dto.day_summary ?? null,
        planning_tomorrow: dto.planning_tomorrow ?? null,
        submitted_at: submittedAt ?? null,
      },
      update: {
        stuck: dto.stuck ?? null,
        decisions: dto.decisions ?? null,
        day_summary: dto.day_summary ?? null,
        planning_tomorrow: dto.planning_tomorrow ?? null,
        ...(submittedAt && { submitted_at: submittedAt }),
      },
    });

    // Replace notes wholesale (mirror recurring template's replace-entries approach).
    if (dto.notes !== undefined) {
      await this.prisma.workLogNote.deleteMany({ where: { daily_update_id: daily.id } });
      if (dto.notes.length > 0) {
        await this.prisma.workLogNote.createMany({
          data: dto.notes.map((n, i) => ({
            organization_id: orgId,
            daily_update_id: daily.id,
            title: n.title,
            description: n.description ?? null,
            order_index: n.order_index ?? i,
          })),
        });
      }
    }

    // Save folded daily-demand submission bodies; mark submitted alongside the day.
    if (dto.folded_submissions?.length) {
      for (const f of dto.folded_submissions) {
        const sub = await this.prisma.workLogSubmission.findFirst({
          where: { id: f.id, organization_id: orgId, writer_user_id: actor.id },
        });
        if (!sub) continue;
        await this.prisma.workLogSubmission.update({
          where: { id: sub.id },
          data: {
            body: f.body ?? null,
            daily_update_id: daily.id,
            ...(dto.submit && { status: 'submitted', submitted_at: submittedAt }),
          },
        });
      }
    }

    return this.getDay(orgId, actor, date);
  }

  // ─── Day context (sidebar) ─────────────────────────────────────────────────────

  async getDayContext(orgId: string, actor: Actor, dateArg?: string) {
    const date = dateArg ?? (await this.today(orgId));
    const { start, end } = this.dayBounds(date);

    const [tasks, tickets] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          organization_id: orgId,
          is_deleted: false,
          deadline: { gte: start, lte: end },
          assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: actor.id } },
        },
        select: { id: true, title: true, deadline: true, status: { select: { label: true, type: true } } },
        orderBy: { deadline: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: {
          organization_id: orgId,
          is_deleted: false,
          created_at: { gte: start, lte: end },
          OR: [{ raised_by_user_id: actor.id }, { assigned_to_user_id: actor.id }],
        },
        select: {
          id: true,
          ticket_number: true,
          title: true,
          raised_by_user_id: true,
          assigned_to_user_id: true,
          created_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    return {
      date,
      tasks,
      tickets: tickets.map((t) => ({
        ...t,
        direction: t.raised_by_user_id === actor.id ? 'by_me' : 'to_me',
      })),
    };
  }

  // ─── Review (read-down the hierarchy) ──────────────────────────────────────────

  // The set of writers `actor` may read: their (recursive) reports when the org allows
  // it, plus any explicit reader grants. Admins read everyone.
  private async readableWriterIds(orgId: string, actor: Actor): Promise<Set<string>> {
    if (this.isAdmin(actor)) {
      const profiles = await this.visibility.getProfiles(orgId);
      return new Set(profiles.keys());
    }
    const ids = new Set<string>();
    const settings = await this.getSettings(orgId);
    if (settings.managers_read_reports) {
      for (const sub of await this.visibility.getSubordinateUserIds(orgId, actor.id)) ids.add(sub);
    }
    const grants = await this.prisma.workLogReaderGrant.findMany({
      where: { organization_id: orgId, reader_user_id: actor.id },
      select: { writer_user_id: true },
    });
    for (const g of grants) ids.add(g.writer_user_id);
    ids.delete(actor.id);
    return ids;
  }

  async listReadableWriters(orgId: string, actor: Actor) {
    const ids = await this.readableWriterIds(orgId, actor);
    const profiles = await this.visibility.getProfiles(orgId);
    return [...ids]
      .map((id) => {
        const p = profiles.get(id);
        return p
          ? { user_id: id, name: p.name, department_name: p.department_name, role_title: p.role_title }
          : { user_id: id, name: 'Unknown', department_name: null, role_title: null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getWriterLogs(orgId: string, actor: Actor, writerId: string, from?: string, to?: string) {
    const readable = await this.readableWriterIds(orgId, actor);
    if (!readable.has(writerId)) {
      throw new ForbiddenException("You do not have access to this person's logs");
    }
    const where: Prisma.DailyUpdateWhereInput = { organization_id: orgId, user_id: writerId };
    if (from || to) {
      where.log_date = {};
      if (from) (where.log_date as Prisma.DateTimeFilter).gte = this.dateKey(from);
      if (to) (where.log_date as Prisma.DateTimeFilter).lte = this.dateKey(to);
    }

    const [dailies, submissions] = await Promise.all([
      this.prisma.dailyUpdate.findMany({
        where,
        include: { notes: { orderBy: { order_index: 'asc' } } },
        orderBy: { log_date: 'desc' },
      }),
      this.prisma.workLogSubmission.findMany({
        where: { organization_id: orgId, writer_user_id: writerId, daily_update_id: null },
        include: { demand: { select: { id: true, title: true, assigner_user_id: true } } },
        orderBy: { due_date: 'desc' },
      }),
    ]);

    return { writer_id: writerId, daily_updates: dailies, standalone_submissions: submissions };
  }

  // A single day's Daily Update for a readable writer (for the review/remarks pane).
  async getWriterDay(orgId: string, actor: Actor, writerId: string, date: string) {
    const readable = await this.readableWriterIds(orgId, actor);
    if (writerId !== actor.id && !readable.has(writerId)) {
      throw new ForbiddenException("You do not have access to this person's logs");
    }
    const daily = await this.findOrNullDaily(orgId, writerId, date);
    return { date, writer_id: writerId, daily_update: daily };
  }

  // ─── Demands ───────────────────────────────────────────────────────────────────

  private async assertCanDemand(orgId: string, actor: Actor, assigneeId: string): Promise<void> {
    if (assigneeId === actor.id) throw new BadRequestException('You cannot demand a log from yourself');
    // Subject eligibility (fail loud): the target must be allowed to be asked for a
    // work log at all — independent of the hierarchy check below.
    await this.subjects.assertEligible(orgId, 'work_logs.subject.demandable', assigneeId);
    if (this.isAdmin(actor)) return;
    const allowed = await this.visibility.isSubordinate(orgId, actor.id, assigneeId);
    if (!allowed) throw new ForbiddenException('You can only demand logs from people below you');
  }

  async createDemand(orgId: string, actor: Actor, dto: CreateDemandDto) {
    await this.assertCanDemand(orgId, actor, dto.assignee_user_id);

    if (dto.kind === 'one_time') {
      if (!dto.deadline) throw new BadRequestException('A one-time demand needs a deadline');
    } else if (!dto.schedule_entries?.length) {
      throw new BadRequestException('A recurring demand needs at least one schedule entry');
    }

    const demand = await this.prisma.workLogDemand.create({
      data: {
        organization_id: orgId,
        title: dto.title.trim(),
        description: dto.description ?? null,
        assigner_user_id: actor.id,
        assignee_user_id: dto.assignee_user_id,
        kind: dto.kind,
        deadline: dto.kind === 'one_time' && dto.deadline ? new Date(dto.deadline) : null,
        ...(dto.kind === 'recurring' && {
          schedule_entries: {
            create: (dto.schedule_entries ?? []).map((e, i) => ({
              organization_id: orgId,
              schedule_type: e.schedule_type,
              every: e.every ?? 1,
              days: (e.days ?? []) as Prisma.InputJsonValue,
              month_days: (e.month_days ?? []) as Prisma.InputJsonValue,
              yearly_dates: (e.yearly_dates ?? []) as unknown as Prisma.InputJsonValue,
              time: e.time,
              start_date: new Date(e.start_date),
              end_condition: e.end_condition ?? 'never',
              end_date: e.end_date ? new Date(e.end_date) : null,
              end_after: e.end_after ?? null,
              order_index: e.order_index ?? i,
            })),
          },
        }),
      },
      include: { schedule_entries: true },
    });

    // One-time → a single pending submission with the deadline date.
    if (dto.kind === 'one_time' && dto.deadline) {
      const due = new Date(dto.deadline);
      due.setHours(0, 0, 0, 0);
      await this.prisma.workLogSubmission.create({
        data: {
          organization_id: orgId,
          demand_id: demand.id,
          writer_user_id: dto.assignee_user_id,
          due_date: due,
          period_label: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          status: 'pending',
        },
      });
    }

    const assignerName = await this.notifications.userName(actor.id);
    await this.notifications.emit({
      orgId,
      module: 'work_logs',
      event_type: 'work_log_demanded',
      recipients: [dto.assignee_user_id],
      title: 'A log has been demanded',
      body: `${assignerName} asked you for "${demand.title}"`,
      link: `${LINK}/daily-update`,
      entity: { type: 'work_log_demand', id: demand.id },
    });

    return demand;
  }

  async listDemands(orgId: string, actor: Actor) {
    const demands = await this.prisma.workLogDemand.findMany({
      where: { organization_id: orgId, assigner_user_id: actor.id },
      include: { schedule_entries: { orderBy: { order_index: 'asc' } }, _count: { select: { submissions: true } } },
      orderBy: { created_at: 'desc' },
    });
    const profiles = await this.visibility.getProfiles(orgId);
    return demands.map((d) => ({
      ...d,
      assignee_name: profiles.get(d.assignee_user_id)?.name ?? null,
    }));
  }

  async getDemandSeries(orgId: string, actor: Actor, demandId: string) {
    const demand = await this.prisma.workLogDemand.findFirst({
      where: { id: demandId, organization_id: orgId },
      include: { schedule_entries: { orderBy: { order_index: 'asc' } } },
    });
    if (!demand) throw new NotFoundException('Demand not found');
    // Assigner, the assignee, or an admin may view the series.
    if (demand.assigner_user_id !== actor.id && demand.assignee_user_id !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException('You cannot view this demand');
    }
    const submissions = await this.prisma.workLogSubmission.findMany({
      where: { demand_id: demandId },
      orderBy: { due_date: 'desc' },
    });
    const profiles = await this.visibility.getProfiles(orgId);
    return {
      ...demand,
      assignee_name: profiles.get(demand.assignee_user_id)?.name ?? null,
      assigner_name: profiles.get(demand.assigner_user_id)?.name ?? null,
      submissions,
    };
  }

  private async getOwnedDemand(orgId: string, actor: Actor, demandId: string) {
    const demand = await this.prisma.workLogDemand.findFirst({
      where: { id: demandId, organization_id: orgId },
    });
    if (!demand) throw new NotFoundException('Demand not found');
    if (demand.assigner_user_id !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException('Only the assigner can manage this demand');
    }
    return demand;
  }

  async pauseDemand(orgId: string, actor: Actor, demandId: string) {
    await this.getOwnedDemand(orgId, actor, demandId);
    return this.prisma.workLogDemand.update({ where: { id: demandId }, data: { is_active: false } });
  }

  async resumeDemand(orgId: string, actor: Actor, demandId: string) {
    await this.getOwnedDemand(orgId, actor, demandId);
    await this.prisma.workLogDemandSchedule.updateMany({
      where: { demand_id: demandId },
      data: { is_active: true },
    });
    return this.prisma.workLogDemand.update({ where: { id: demandId }, data: { is_active: true } });
  }

  async deleteDemand(orgId: string, actor: Actor, demandId: string) {
    await this.getOwnedDemand(orgId, actor, demandId);
    await this.prisma.workLogDemand.delete({ where: { id: demandId } }); // schedules + submissions cascade
    return { message: 'Demand deleted' };
  }

  // ─── Writer's standalone (non-daily) demanded logs ─────────────────────────────

  async listMySubmissions(orgId: string, actor: Actor, status?: string) {
    const submissions = await this.prisma.workLogSubmission.findMany({
      where: {
        organization_id: orgId,
        writer_user_id: actor.id,
        daily_update_id: null, // standalone only; daily-folded ones live in the Daily Update
        ...(status && { status }),
      },
      include: { demand: { select: { id: true, title: true, description: true, assigner_user_id: true } } },
      orderBy: { due_date: 'asc' },
    });
    const profiles = await this.visibility.getProfiles(orgId);
    return submissions.map((s) => ({
      ...s,
      assigner_name: profiles.get(s.demand.assigner_user_id)?.name ?? null,
    }));
  }

  async submitSubmission(orgId: string, actor: Actor, submissionId: string, dto: SubmitSubmissionDto) {
    const sub = await this.prisma.workLogSubmission.findFirst({
      where: { id: submissionId, organization_id: orgId },
      include: { demand: { select: { title: true, assigner_user_id: true } } },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    if (sub.writer_user_id !== actor.id) throw new ForbiddenException('This log is not assigned to you');

    const updated = await this.prisma.workLogSubmission.update({
      where: { id: submissionId },
      data: { body: dto.body ?? null, status: 'submitted', submitted_at: new Date() },
    });

    const writerName = await this.notifications.userName(actor.id);
    await this.notifications.emit({
      orgId,
      module: 'work_logs',
      event_type: 'work_log_submitted',
      recipients: [sub.demand.assigner_user_id],
      title: 'A demanded log was submitted',
      body: `${writerName} submitted "${sub.demand.title}"`,
      link: `${LINK}/work-log/demands`,
      entity: { type: 'work_log_submission', id: submissionId },
    });
    return updated;
  }

  // ─── Remarks (polymorphic, threaded — ported from task comments) ───────────────

  // Who the writer/reader counterparts are for a remark target, so we can notify and
  // authorize. Returns the writer of the log + the readers with access.
  private async resolveTarget(orgId: string, targetType: string, targetId: string): Promise<{ writerId: string }> {
    if (targetType === 'daily_update') {
      const daily = await this.prisma.dailyUpdate.findFirst({
        where: { id: targetId, organization_id: orgId },
        select: { user_id: true },
      });
      if (!daily) throw new NotFoundException('Daily update not found');
      return { writerId: daily.user_id };
    }
    const sub = await this.prisma.workLogSubmission.findFirst({
      where: { id: targetId, organization_id: orgId },
      select: { writer_user_id: true },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    return { writerId: sub.writer_user_id };
  }

  async getRemarks(orgId: string, actor: Actor, targetType: string, targetId: string) {
    const { writerId } = await this.resolveTarget(orgId, targetType, targetId);
    // The writer, a reader with access, or an admin may see remarks.
    if (writerId !== actor.id && !this.isAdmin(actor)) {
      const readable = await this.readableWriterIds(orgId, actor);
      if (!readable.has(writerId)) throw new ForbiddenException('No access to this log');
    }

    const remarks = await this.prisma.workLogRemark.findMany({
      where: { organization_id: orgId, target_type: targetType, target_id: targetId, is_deleted: false, reply_to_remark_id: null },
      include: { replies: { where: { is_deleted: false }, orderBy: { created_at: 'asc' } } },
      orderBy: { created_at: 'asc' },
    });

    const userIds = new Set<string>();
    for (const r of remarks) {
      userIds.add(r.user_id);
      for (const rep of r.replies) userIds.add(rep.user_id);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const decorate = (r: (typeof remarks)[number]) => ({
      ...r,
      user_name: userMap.get(r.user_id)?.name ?? null,
      user_email: userMap.get(r.user_id)?.email ?? null,
    });
    return remarks.map((r) => ({ ...decorate(r), replies: r.replies.map(decorate) }));
  }

  async addRemark(orgId: string, actor: Actor, dto: CreateRemarkDto) {
    const { writerId } = await this.resolveTarget(orgId, dto.target_type, dto.target_id);
    const isReply = !!dto.reply_to_remark_id;
    // Writer can reply; readers/admins can remark. Anyone with read access can do either.
    if (writerId !== actor.id && !this.isAdmin(actor)) {
      const readable = await this.readableWriterIds(orgId, actor);
      if (!readable.has(writerId)) throw new ForbiddenException('No access to this log');
    }

    const remark = await this.prisma.workLogRemark.create({
      data: {
        organization_id: orgId,
        target_type: dto.target_type,
        target_id: dto.target_id,
        user_id: actor.id,
        body: dto.body,
        reply_to_remark_id: dto.reply_to_remark_id ?? null,
        attachment_urls: (dto.attachment_urls ?? undefined) as Prisma.InputJsonValue,
      },
    });

    // Notify the counterpart: a reader's remark notifies the writer; the writer's reply
    // notifies whoever they're replying to.
    let recipientId: string | null = null;
    if (actor.id === writerId && dto.reply_to_remark_id) {
      const parent = await this.prisma.workLogRemark.findUnique({
        where: { id: dto.reply_to_remark_id },
        select: { user_id: true },
      });
      recipientId = parent?.user_id ?? null;
    } else if (actor.id !== writerId) {
      recipientId = writerId;
    }

    if (recipientId && recipientId !== actor.id) {
      const actorName = await this.notifications.userName(actor.id);
      const snippet = dto.body.length > 80 ? `${dto.body.slice(0, 80)}…` : dto.body;
      await this.notifications.emit({
        orgId,
        module: 'work_logs',
        event_type: isReply ? 'work_log_remark_reply' : 'work_log_remark',
        recipients: [recipientId],
        title: isReply ? 'Reply on your remark' : 'New remark on your log',
        body: `${actorName}: ${snippet}`,
        link: `${LINK}/work-log/review`,
        entity: { type: dto.target_type, id: dto.target_id },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true, email: true },
    });
    return { ...remark, user_name: user?.name ?? null, user_email: user?.email ?? null };
  }

  async deleteRemark(orgId: string, actor: Actor, remarkId: string) {
    const remark = await this.prisma.workLogRemark.findFirst({
      where: { id: remarkId, organization_id: orgId },
    });
    if (!remark) throw new NotFoundException('Remark not found');
    if (remark.user_id !== actor.id) throw new ForbiddenException("Cannot delete another user's remark");
    await this.prisma.workLogRemark.update({
      where: { id: remarkId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
    return { message: 'Remark deleted' };
  }

  // ─── Admin access config ───────────────────────────────────────────────────────

  private assertAdmin(actor: Actor): void {
    if (!this.isAdmin(actor)) {
      throw new ForbiddenException('Only admins can manage Work Log access');
    }
  }

  async getAccessConfig(orgId: string, actor: Actor) {
    this.assertAdmin(actor);
    const [settings, grants, profiles] = await Promise.all([
      this.getSettings(orgId),
      this.prisma.workLogReaderGrant.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      this.visibility.getProfiles(orgId),
    ]);
    const nameOf = (id: string) => profiles.get(id)?.name ?? null;
    return {
      settings: {
        managers_read_reports: settings.managers_read_reports,
        writer_user_ids: settings.writer_user_ids,
      },
      grants: grants.map((g) => ({
        id: g.id,
        reader_user_id: g.reader_user_id,
        reader_name: nameOf(g.reader_user_id),
        writer_user_id: g.writer_user_id,
        writer_name: nameOf(g.writer_user_id),
      })),
      members: [...profiles.values()]
        .map((p) => ({ user_id: p.user_id, name: p.name, department_name: p.department_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async updateAccessSettings(orgId: string, actor: Actor, dto: UpdateAccessSettingsDto) {
    this.assertAdmin(actor);
    const settings = await this.prisma.workLogSettings.upsert({
      where: { organization_id: orgId },
      create: {
        organization_id: orgId,
        ...(dto.managers_read_reports !== undefined && { managers_read_reports: dto.managers_read_reports }),
        ...(dto.writer_user_ids !== undefined && { writer_user_ids: dto.writer_user_ids as Prisma.InputJsonValue }),
      },
      update: {
        ...(dto.managers_read_reports !== undefined && { managers_read_reports: dto.managers_read_reports }),
        ...(dto.writer_user_ids !== undefined && { writer_user_ids: dto.writer_user_ids as Prisma.InputJsonValue }),
      },
    });
    return { managers_read_reports: settings.managers_read_reports, writer_user_ids: settings.writer_user_ids };
  }

  async addReaderGrant(orgId: string, actor: Actor, dto: CreateReaderGrantDto) {
    this.assertAdmin(actor);
    if (dto.reader_user_id === dto.writer_user_id) {
      throw new BadRequestException('Reader and writer must be different people');
    }
    return this.prisma.workLogReaderGrant.upsert({
      where: {
        organization_id_reader_user_id_writer_user_id: {
          organization_id: orgId,
          reader_user_id: dto.reader_user_id,
          writer_user_id: dto.writer_user_id,
        },
      },
      create: {
        organization_id: orgId,
        reader_user_id: dto.reader_user_id,
        writer_user_id: dto.writer_user_id,
        created_by: actor.id,
      },
      update: {},
    });
  }

  async removeReaderGrant(orgId: string, actor: Actor, grantId: string) {
    this.assertAdmin(actor);
    const grant = await this.prisma.workLogReaderGrant.findFirst({
      where: { id: grantId, organization_id: orgId },
    });
    if (!grant) throw new NotFoundException('Grant not found');
    await this.prisma.workLogReaderGrant.delete({ where: { id: grantId } });
    return { message: 'Grant removed' };
  }
}
