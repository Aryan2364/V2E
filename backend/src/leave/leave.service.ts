import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Leave, LeaveState, LeaveOrigin } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateLeaveDto, DecideLeaveDto, UpdateLeaveMasterDto } from './dto/leave.dto';
import { TERMINAL_TYPES } from '../tasks/status-phase';
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee';

const CONFIG_TTL_MS = 5_000;

type ApprovalMode = 'self_mark' | 'manager' | 'approvers' | 'manager_or_approvers';

interface LeaveConfig {
  approvalMode: ApprovalMode;
  approverUserIds: string[];
  anyOneCanApprove: boolean;
  allowOverride: boolean;
  recurringNoticeDays: number;
  configManageRoles: string[];
}

// ─── Date helpers (date-only, UTC) ────────────────────────────────────────────────
// A leave covers whole calendar days. We store the start at 00:00:00.000Z and the end
// at 23:59:59.999Z so that any deadline instant falling on those days is inside the
// window. Warnings are soft, so UTC-day granularity is acceptable for v1.
function dayStart(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}
function dayEnd(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T23:59:59.999Z`);
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class LeaveService {
  private readonly configCache = new Map<string, { value: LeaveConfig; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Effectiveness (availability) — single source of truth ──────────────────────
  // A leave makes the person unavailable when it is not cancelled AND it is either
  // approved/pending, self-declared, or rejected-but-overridden. Approval state is a
  // governance layer; it does not, by itself, gate availability.
  static isEffective(l: Pick<Leave, 'state' | 'origin' | 'overridden'>): boolean {
    if (l.state === 'cancelled') return false;
    return (
      l.state === 'approved' ||
      l.state === 'pending' ||
      l.origin === 'self_declared' ||
      l.overridden === true
    );
  }

  /** Prisma `where` fragment matching effective leaves (mirror of isEffective). */
  private effectiveWhere(): Prisma.LeaveWhereInput {
    return {
      state: { not: 'cancelled' },
      OR: [
        { state: { in: ['approved', 'pending'] } },
        { origin: 'self_declared' },
        { overridden: true },
      ],
    };
  }

  // ─── Per-org config ──────────────────────────────────────────────────────────────

  invalidate(orgId: string) {
    this.configCache.delete(orgId);
  }

  async getConfig(orgId: string): Promise<LeaveConfig> {
    const cached = this.configCache.get(orgId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const m = await this.prisma.leaveMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
    });
    const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
    const value: LeaveConfig = {
      approvalMode: (m.approval_mode as ApprovalMode) ?? 'manager',
      approverUserIds: asArr(m.approver_user_ids),
      anyOneCanApprove: m.any_one_can_approve,
      allowOverride: m.allow_override,
      recurringNoticeDays: m.recurring_notice_days,
      configManageRoles: asArr(m.config_manage_roles),
    };
    this.configCache.set(orgId, { value, expires: Date.now() + CONFIG_TTL_MS });
    return value;
  }

  async getMaster(orgId: string) {
    await this.getConfig(orgId); // ensures the row exists
    return this.prisma.leaveMaster.findUnique({ where: { organization_id: orgId } });
  }

  async updateMaster(orgId: string, dto: UpdateLeaveMasterDto) {
    const data: Prisma.LeaveMasterUpdateInput = {};
    if (dto.approval_mode !== undefined) data.approval_mode = dto.approval_mode;
    if (dto.approver_user_ids !== undefined) data.approver_user_ids = dto.approver_user_ids;
    if (dto.any_one_can_approve !== undefined) data.any_one_can_approve = dto.any_one_can_approve;
    if (dto.allow_override !== undefined) data.allow_override = dto.allow_override;
    if (dto.recurring_notice_days !== undefined) data.recurring_notice_days = dto.recurring_notice_days;

    const m = await this.prisma.leaveMaster.upsert({
      where: { organization_id: orgId },
      create: Object.assign({ organization_id: orgId }, data) as Prisma.LeaveMasterCreateInput,
      update: data,
    });
    this.invalidate(orgId);
    return m;
  }

  // ─── Availability (the leave analogue of holidays.checkDate) ─────────────────────

  /** Effective leave windows overlapping [from,to] for the given users. */
  async availability(orgId: string, userIds: string[], from: string, to: string) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return { results: [] as AvailabilityEntry[] };
    const fromStart = dayStart(from);
    const toEnd = dayEnd(to);

    const [leaves, users] = await Promise.all([
      this.prisma.leave.findMany({
        where: {
          organization_id: orgId,
          user_id: { in: ids },
          start_date: { lte: toEnd },
          end_date: { gte: fromStart },
          ...this.effectiveWhere(),
        },
        orderBy: { start_date: 'asc' },
      }),
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);

    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const byUser = new Map<string, AvailabilityEntry>();
    for (const id of ids) {
      byUser.set(id, { user_id: id, name: nameOf.get(id) ?? 'Unknown', windows: [] });
    }
    for (const l of leaves) {
      byUser.get(l.user_id)?.windows.push({
        start_date: isoDay(l.start_date),
        end_date: isoDay(l.end_date),
        state: l.state,
        origin: l.origin,
        overridden: l.overridden,
      });
    }
    // Only return users that actually have a window.
    return { results: [...byUser.values()].filter((e) => e.windows.length > 0) };
  }

  /** Map of user_id → leave_until (ISO day) for users effectively on leave on `now`. */
  async onLeaveTodayMap(orgId: string, userIds: string[], now: Date): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const todayStart = dayStart(isoDay(now));
    const todayEnd = dayEnd(isoDay(now));
    const leaves = await this.prisma.leave.findMany({
      where: {
        organization_id: orgId,
        user_id: { in: ids },
        start_date: { lte: todayEnd },
        end_date: { gte: todayStart },
        ...this.effectiveWhere(),
      },
      select: { user_id: true, end_date: true },
    });
    for (const l of leaves) {
      const until = isoDay(l.end_date);
      const prev = out.get(l.user_id);
      if (!prev || until > prev) out.set(l.user_id, until); // keep the latest end
    }
    return out;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────────────

  listMine(orgId: string, userId: string) {
    return this.prisma.leave.findMany({
      where: { organization_id: orgId, user_id: userId },
      orderBy: { start_date: 'desc' },
    });
  }

  /** Pending requests the actor is allowed to decide on. */
  async listApprovals(orgId: string, actorUserId: string) {
    const admin = await this.isAdmin(orgId, actorUserId);
    const pending = await this.prisma.leave.findMany({
      where: { organization_id: orgId, state: 'pending', origin: 'requested' },
      orderBy: { created_at: 'asc' },
    });
    if (pending.length === 0) return [];
    const applicantIds = [...new Set(pending.map((l) => l.user_id))];
    const [profiles, users] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, user_id: { in: applicantIds } },
        select: { user_id: true, reporting_to_user_id: true },
      }),
      this.prisma.user.findMany({ where: { id: { in: applicantIds } }, select: { id: true, name: true } }),
    ]);
    const managerOf = new Map(profiles.map((p) => [p.user_id, p.reporting_to_user_id]));
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const cfg = await this.getConfig(orgId);

    const eligible = pending.filter((l) => {
      if (admin) return true;
      return this.canApprove(cfg, actorUserId, managerOf.get(l.user_id) ?? null);
    });
    return eligible.map((l) => ({ ...l, applicant_name: nameOf.get(l.user_id) ?? 'Unknown' }));
  }

  async adminList(orgId: string, actorUserId: string) {
    if (!(await this.isAdmin(orgId, actorUserId))) {
      throw new ForbiddenException('Admin only');
    }
    const leaves = await this.prisma.leave.findMany({
      where: { organization_id: orgId },
      orderBy: { start_date: 'desc' },
      take: 500,
    });
    const ids = [...new Set(leaves.map((l) => l.user_id))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return leaves.map((l) => ({ ...l, applicant_name: nameOf.get(l.user_id) ?? 'Unknown' }));
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────────

  async create(orgId: string, actorUserId: string, targetUserId: string, dto: CreateLeaveDto) {
    const start = dayStart(dto.start_date);
    const end = dayEnd(dto.end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start_date or end_date');
    }
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('end_date cannot be before start_date');
    }

    const cfg = await this.getConfig(orgId);
    const actorIsAdmin = await this.isAdmin(orgId, actorUserId);
    const onBehalf = targetUserId !== actorUserId;
    if (onBehalf && !actorIsAdmin) {
      throw new ForbiddenException('Only an admin can create leave on behalf of another employee');
    }

    // Decide approval routing. Admin-created or self_mark mode or an allowed self-declare
    // are booked immediately (and flagged self-declared); everything else is a request.
    let state: LeaveState = 'pending';
    let origin: LeaveOrigin = 'requested';
    const selfMark = cfg.approvalMode === 'self_mark';
    const declared = !!dto.declare && cfg.allowOverride;
    if (actorIsAdmin || selfMark || declared) {
      state = 'approved';
      origin = actorIsAdmin && !dto.declare && !selfMark ? 'requested' : 'self_declared';
    }

    const leave = await this.prisma.leave.create({
      data: {
        organization_id: orgId,
        user_id: targetUserId,
        start_date: start,
        end_date: end,
        reason: dto.reason?.trim() || null,
        state,
        origin,
        decided_by_user_id: state === 'approved' && actorIsAdmin ? actorUserId : null,
        decided_at: state === 'approved' ? new Date() : null,
        created_by_user_id: actorUserId,
      },
    });

    if (leave.state === 'pending') {
      await this.notifyApprovers(orgId, leave, cfg);
    }
    if (LeaveService.isEffective(leave)) {
      await this.notifyTaskConflicts(orgId, leave);
    }
    return leave;
  }

  async decide(orgId: string, actorUserId: string, leaveId: string, dto: DecideLeaveDto) {
    const leave = await this.getOwned(orgId, leaveId);
    if (leave.state !== 'pending') {
      throw new BadRequestException('Only a pending request can be decided');
    }
    const admin = await this.isAdmin(orgId, actorUserId);
    if (!admin) {
      const profile = await this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: leave.user_id },
        select: { reporting_to_user_id: true },
      });
      const cfg = await this.getConfig(orgId);
      if (!this.canApprove(cfg, actorUserId, profile?.reporting_to_user_id ?? null)) {
        throw new ForbiddenException('You are not an approver for this request');
      }
    }

    const updated = await this.prisma.leave.update({
      where: { id: leaveId },
      data: {
        state: dto.decision,
        decided_by_user_id: actorUserId,
        decided_at: new Date(),
        decision_note: dto.note?.trim() || null,
      },
    });

    await this.notifications.emit({
      orgId,
      module: 'leave',
      event_type: 'leave_decided',
      recipients: [updated.user_id],
      title: dto.decision === 'approved' ? 'Leave approved' : 'Leave rejected',
      body: `Your leave ${this.range(updated)} was ${dto.decision}${dto.note ? ` — ${dto.note.trim()}` : ''}.`,
      link: '/dashboard/ecs/leave',
      entity: { type: 'leave', id: updated.id },
    });

    if (dto.decision === 'approved') await this.notifyTaskConflicts(orgId, updated);
    return updated;
  }

  /** Owner overrides a rejection — they are taking the leave anyway (flagged). */
  async override(orgId: string, actorUserId: string, leaveId: string) {
    const leave = await this.getOwned(orgId, leaveId);
    if (leave.user_id !== actorUserId) {
      throw new ForbiddenException('Only the employee can override their own leave');
    }
    const cfg = await this.getConfig(orgId);
    if (!cfg.allowOverride) throw new ForbiddenException('Overriding a decision is disabled for this organization');
    if (leave.state !== 'rejected') {
      throw new BadRequestException('Only a rejected leave can be overridden');
    }
    const updated = await this.prisma.leave.update({
      where: { id: leaveId },
      data: { overridden: true },
    });

    // FYI to approvers/manager that the employee is taking it regardless.
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { organization_id: orgId, user_id: leave.user_id },
      select: { reporting_to_user_id: true },
    });
    const recipients = [...new Set([...(cfg.approverUserIds ?? []), profile?.reporting_to_user_id ?? null])];
    const applicant = await this.prisma.user.findUnique({ where: { id: leave.user_id }, select: { name: true } });
    await this.notifications.emit({
      orgId,
      module: 'leave',
      event_type: 'leave_overridden',
      recipients,
      title: 'Leave taken despite rejection',
      body: `${applicant?.name ?? 'An employee'} is taking leave ${this.range(updated)} after it was rejected.`,
      link: '/dashboard/ecs/approvals',
      entity: { type: 'leave', id: updated.id },
    });

    await this.notifyTaskConflicts(orgId, updated);
    return updated;
  }

  async cancel(orgId: string, actorUserId: string, leaveId: string) {
    const leave = await this.getOwned(orgId, leaveId);
    const admin = await this.isAdmin(orgId, actorUserId);
    if (leave.user_id !== actorUserId && !admin) {
      throw new ForbiddenException('Only the employee or an admin can cancel this leave');
    }
    return this.prisma.leave.update({ where: { id: leaveId }, data: { state: 'cancelled' } });
  }

  // ─── Approver resolution ──────────────────────────────────────────────────────────

  /** User ids who may approve a leave for `applicantUserId`, per the org policy. */
  async eligibleApprovers(orgId: string, applicantUserId: string): Promise<string[]> {
    const cfg = await this.getConfig(orgId);
    if (cfg.approvalMode === 'self_mark') return [];
    const out = new Set<string>();
    if (cfg.approvalMode === 'manager' || cfg.approvalMode === 'manager_or_approvers') {
      const profile = await this.prisma.employeeProfile.findFirst({
        where: { organization_id: orgId, user_id: applicantUserId },
        select: { reporting_to_user_id: true },
      });
      if (profile?.reporting_to_user_id) out.add(profile.reporting_to_user_id);
    }
    if (cfg.approvalMode === 'approvers' || cfg.approvalMode === 'manager_or_approvers') {
      for (const id of cfg.approverUserIds) out.add(id);
    }
    out.delete(applicantUserId); // never approve your own request
    return [...out];
  }

  private canApprove(cfg: LeaveConfig, actorUserId: string, applicantManagerId: string | null): boolean {
    if (cfg.approvalMode === 'self_mark') return false;
    const viaManager =
      (cfg.approvalMode === 'manager' || cfg.approvalMode === 'manager_or_approvers') &&
      applicantManagerId === actorUserId;
    const viaApprover =
      (cfg.approvalMode === 'approvers' || cfg.approvalMode === 'manager_or_approvers') &&
      cfg.approverUserIds.includes(actorUserId);
    return viaManager || viaApprover;
  }

  // ─── Side effects ─────────────────────────────────────────────────────────────────

  private async notifyApprovers(orgId: string, leave: Leave, cfg: LeaveConfig) {
    const approvers = await this.eligibleApprovers(orgId, leave.user_id);
    if (approvers.length === 0) return;
    const applicant = await this.prisma.user.findUnique({ where: { id: leave.user_id }, select: { name: true } });
    await this.notifications.emit({
      orgId,
      module: 'leave',
      event_type: 'leave_requested',
      recipients: approvers,
      title: 'Leave request',
      body: `${applicant?.name ?? 'An employee'} requested leave ${this.range(leave)}${leave.reason ? ` — ${leave.reason}` : ''}.`,
      link: '/dashboard/ecs/approvals',
      entity: { type: 'leave', id: leave.id },
      dedupe: true,
    });
  }

  /** Notify creators of incomplete tasks whose deadline lands inside this leave. */
  private async notifyTaskConflicts(orgId: string, leave: Leave) {
    const assignments = await this.prisma.taskAssignee.findMany({
      where: {
        organization_id: orgId,
        ...ACTIVE_ASSIGNEE, // a task they were taken off is no longer their conflict
        user_id: leave.user_id,
        is_cc: false,
        task: {
          is_deleted: false,
          status: { type: { notIn: TERMINAL_TYPES } },
          deadline: { gte: leave.start_date, lte: leave.end_date },
        },
      },
      select: { task: { select: { id: true, title: true, created_by_user_id: true } } },
    });
    if (assignments.length === 0) return;
    const applicant = await this.prisma.user.findUnique({ where: { id: leave.user_id }, select: { name: true } });
    const name = applicant?.name ?? 'An assignee';
    for (const a of assignments) {
      const t = a.task;
      if (!t.created_by_user_id || t.created_by_user_id === leave.user_id) continue;
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'assignee_on_leave_conflict',
        recipients: [t.created_by_user_id],
        title: 'Assignee will be on leave',
        body: `${name} is on leave ${this.range(leave)}, which covers the deadline for "${t.title}".`,
        link: `/dashboard/tasks/${t.id}`,
        entity: { type: 'task', id: t.id },
        dedupe: true,
      });
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────

  private async getOwned(orgId: string, leaveId: string): Promise<Leave> {
    const leave = await this.prisma.leave.findFirst({ where: { id: leaveId, organization_id: orgId } });
    if (!leave) throw new NotFoundException(`Leave ${leaveId} not found`);
    return leave;
  }

  private async isAdmin(orgId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.organizationMember.findFirst({
      where: { organization_id: orgId, user_id: userId },
      select: { is_admin: true },
    });
    return !!m?.is_admin;
  }

  private range(l: Pick<Leave, 'start_date' | 'end_date'>): string {
    const s = isoDay(l.start_date);
    const e = isoDay(l.end_date);
    return s === e ? `on ${s}` : `${s} → ${e}`;
  }
}

export interface AvailabilityEntry {
  user_id: string;
  name: string;
  windows: {
    start_date: string;
    end_date: string;
    state: LeaveState;
    origin: LeaveOrigin;
    overridden: boolean;
  }[];
}
