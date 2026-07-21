import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { TasksService } from '../tasks/tasks.service';
import { LeaveService } from '../leave/leave.service';
import { HolidaysService } from '../holidays/holidays.service';
import { PermissionsService, principalFromUser } from '../access-rights/permissions.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { ScopeService } from '../access-rights/scope.service';
import { AccessVisibilityService } from '../access-rights/access-visibility.service';
import { MeetingGoogleSyncService } from '../gcal/meeting-google-sync.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import {
  UpdateMeetingDto,
  UpdateRecordDto,
  DeclineDto,
  MarkAttendanceDto,
  PrivateNoteDto,
  BusyQueryDto,
} from './dto/meeting-actions.dto';
import {
  CreateActionItemDto,
  UpdateActionItemDto,
  LinkTaskDto,
  CreateDecisionDto,
  UpdateDecisionDto,
} from './dto/outputs.dto';

export interface Actor {
  id: string;
  system_role_id: string | null;
  is_admin: boolean;
  isSuperAdmin: boolean;
}

const MEETING = 'meetings';
const LINK = '/dashboard/governance/meetings';

// Fields whose change re-notifies every attendee: under opt-out the attendee never
// chose the time, so a silent reschedule would strand them. Take away their voice,
// you owe them notification.
const NOTIFY_ON_CHANGE: (keyof Prisma.MeetingUpdateInput)[] = [
  'scheduled_start',
  'scheduled_end',
  'location',
  'online_link',
  'link_type',
  'link_entity_id',
];

const DETAIL_INCLUDE = {
  organizer: { select: { id: true, name: true, email: true } },
  attendees: { include: { user: { select: { id: true, name: true, email: true } } } },
  action_items: { orderBy: { created_at: 'asc' } },
  decisions: { orderBy: { decided_on: 'desc' } },
} satisfies Prisma.MeetingInclude;

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly tasks: TasksService,
    private readonly leave: LeaveService,
    private readonly holidays: HolidaysService,
    private readonly permissions: PermissionsService,
    private readonly subjects: SubjectEligibilityService,
    private readonly scope: ScopeService,
    private readonly visibility: AccessVisibilityService,
    private readonly gsync: MeetingGoogleSyncService,
  ) {
    this.scope.registerWiredList(MEETING);
    this.visibility.registerCounter(MEETING, (orgId, userId) =>
      this.prisma.meeting.count({
        where: {
          organization_id: orgId,
          is_deleted: false,
          ...(this.visibility.whereForUser(MEETING, userId) ?? {}),
        },
      }),
    );
  }

  // ─── Create ─────────────────────────────────────────────────────────────────
  async create(orgId: string, actor: Actor, dto: CreateMeetingDto) {
    const attendeeIds = [...new Set((dto.attendee_user_ids ?? []).filter((id) => id !== actor.id))];
    const optionalIds = new Set((dto.optional_user_ids ?? []).filter((id) => id !== actor.id));
    // Subject eligibility (fail loud): everyone added must be allowed to be a meeting subject.
    await this.subjects.assertAllEligible(orgId, 'meetings.subject.invitable', attendeeIds);

    const data: Prisma.MeetingCreateInput = {
      organization_id: orgId,
      title: dto.title.trim(),
      type: dto.type,
      online_link: dto.online_link ?? null,
      online_password: dto.online_password ?? null,
      location: dto.location ?? null,
      link_type: dto.link_type ?? null,
      link_entity_id: dto.link_type ? dto.link_entity_id ?? null : null,
      agenda: dto.agenda ?? null,
      organizer: { connect: { id: actor.id } },
      status: 'scheduled',
    };

    let notify: { event: string; title: string; body: string } | null = null;

    if (dto.log_past) {
      if (!dto.actual_start) throw new BadRequestException('A logged past meeting needs an actual start time.');
      data.actual_start = new Date(dto.actual_start);
      data.actual_end = dto.actual_end ? new Date(dto.actual_end) : null;
      data.scheduled_start = dto.scheduled_start ? new Date(dto.scheduled_start) : new Date(dto.actual_start);
      data.scheduled_end = dto.scheduled_end ? new Date(dto.scheduled_end) : data.actual_end ?? null;
      // A meeting that already happened lands as the closed, official record.
      data.status = 'closed';
      if (dto.minutes !== undefined) data.minutes = dto.minutes;
    } else {
      if (!dto.scheduled_start || !dto.scheduled_end) {
        throw new BadRequestException('A meeting needs a start and end time.');
      }
      data.scheduled_start = new Date(dto.scheduled_start);
      data.scheduled_end = new Date(dto.scheduled_end);
      data.status = 'scheduled';
      // Opt-out framing: they are ON the meeting, not asked to accept it.
      notify = {
        event: 'meeting_invited',
        title: 'You are on a meeting',
        body: `${await this.notifications.userName(actor.id)} added you to "${dto.title}"`,
      };
    }

    const meeting = await this.prisma.meeting.create({ data });

    // Organizer + attendees. Everyone is `attending` by default (opt-out).
    await this.prisma.meetingAttendee.create({
      data: {
        organization_id: orgId,
        meeting_id: meeting.id,
        user_id: actor.id,
        is_organizer: true,
        is_required: true,
        response: 'attending',
        attended: !!dto.log_past,
      },
    });
    if (attendeeIds.length) {
      await this.prisma.meetingAttendee.createMany({
        data: attendeeIds.map((uid) => ({
          organization_id: orgId,
          meeting_id: meeting.id,
          user_id: uid,
          is_required: !optionalIds.has(uid),
          response: 'attending' as const,
          attended: !!dto.log_past,
        })),
        skipDuplicates: true,
      });
    }

    await this.audit.record({
      orgId,
      actorId: actor.id,
      action: 'create',
      resource: 'meeting',
      entityId: meeting.id,
      entityLabel: meeting.title,
      changes: { status: { before: null, after: meeting.status } },
    });

    if (notify && attendeeIds.length) {
      await this.notifications.emit({
        orgId,
        module: 'meetings',
        event_type: notify.event,
        recipients: attendeeIds,
        title: notify.title,
        body: notify.body,
        link: `${LINK}/${meeting.id}`,
        entity: { type: 'meeting', id: meeting.id },
      });
    }

    // Mirror to the organiser's Google Calendar (best-effort; never blocks).
    await this.gsync.syncUpsert(orgId, meeting.id);

    return this.getOne(orgId, actor, meeting.id);
  }

  // ─── List + detail ────────────────────────────────────────────────────────────
  async list(orgId: string, actor: Actor, filters: Record<string, string | undefined>) {
    const where: Prisma.MeetingWhereInput = { organization_id: orgId, is_deleted: false };
    const scopeWhere = await this.scope.listWhere(orgId, principalFromUser(actor), MEETING);
    if (Object.keys(scopeWhere).length) where.AND = [scopeWhere as Prisma.MeetingWhereInput];
    if (filters.status) where.status = filters.status as any;
    if (filters.type) where.type = filters.type as any;
    if (filters.link_type) where.link_type = filters.link_type as any;
    if (filters.mine === 'true') {
      where.attendees = { some: { user_id: actor.id } };
    } else if (filters.attendee) {
      where.attendees = { some: { user_id: filters.attendee } };
    }
    if (filters.rhythm_id) where.rhythm_id = filters.rhythm_id;
    if (filters.from_date || filters.to_date) {
      where.scheduled_start = {};
      if (filters.from_date) (where.scheduled_start as any).gte = new Date(filters.from_date);
      if (filters.to_date) (where.scheduled_start as any).lte = new Date(filters.to_date);
    }
    if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };

    return this.prisma.meeting.findMany({
      where,
      orderBy: [{ scheduled_start: 'asc' }, { created_at: 'desc' }],
      include: {
        organizer: { select: { id: true, name: true } },
        _count: { select: { attendees: true, action_items: true, decisions: true } },
      },
    });
  }

  // Reverse view: the caller's own external Google events in [from, to], deduped
  // against meetings already mirrored to them. Fail-soft (empty on any problem).
  async googleExternalEvents(orgId: string, actor: Actor, from?: string, to?: string) {
    if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return { connected: false, configured: true, events: [] };
    }
    return this.gsync.listExternalForUser(orgId, actor.id, from, to);
  }

  async getOne(orgId: string, actor: Actor, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organization_id: orgId, is_deleted: false },
      include: DETAIL_INCLUDE,
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    // Row-level read gate: manage rights imply visibility; everyone else must be
    // on the meeting or hold read scope over one of its participants.
    const canManage = await this.canManage(orgId, meeting, actor);
    if (!canManage) await this.assertParticipantView(orgId, actor, meeting);

    const myNote = await this.prisma.meetingPrivateNote.findUnique({
      where: { meeting_id_user_id: { meeting_id: id, user_id: actor.id } },
    });

    // Conflict signal for the current schedule (non-declined attendees double-booked).
    let conflicts: any[] = [];
    if (meeting.scheduled_start && meeting.scheduled_end) {
      conflicts = await this.conflictsFor(
        orgId,
        meeting.attendees.filter((a) => a.response !== 'declined').map((a) => a.user_id),
        meeting.scheduled_start,
        meeting.scheduled_end,
        meeting.id,
      );
    }

    return {
      ...meeting,
      my_note: myNote?.body ?? '',
      conflicts,
      can_manage: canManage,
    };
  }

  // ─── Header edit / delete ─────────────────────────────────────────────────────
  async update(orgId: string, actor: Actor, id: string, dto: UpdateMeetingDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    this.assertOpen(meeting);

    const data: Prisma.MeetingUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.online_link !== undefined) data.online_link = dto.online_link;
    if (dto.online_password !== undefined) data.online_password = dto.online_password;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.link_type !== undefined) data.link_type = dto.link_type;
    if (dto.link_entity_id !== undefined) data.link_entity_id = dto.link_entity_id;
    if (dto.scheduled_start !== undefined) data.scheduled_start = new Date(dto.scheduled_start);
    if (dto.scheduled_end !== undefined) data.scheduled_end = new Date(dto.scheduled_end);

    // Did any attendee-visible field actually change? (drives the re-notify)
    const notifyKeys = NOTIFY_ON_CHANGE.filter((k) => {
      if (!(k in data)) return false;
      const before = (meeting as any)[k];
      const after = (data as any)[k];
      const b = before instanceof Date ? before.getTime() : before;
      const a = after instanceof Date ? after.getTime() : after;
      return b !== a;
    });

    const updated = await this.prisma.meeting.update({ where: { id }, data });

    if (dto.attendee_user_ids) {
      await this.syncAttendees(orgId, id, dto.attendee_user_ids, dto.optional_user_ids ?? [], meeting.created_by_user_id);
    }

    const changes = this.audit.diff(
      meeting,
      {
        title: dto.title?.trim(),
        type: dto.type,
        location: dto.location,
        scheduled_start: data.scheduled_start as Date | undefined,
        scheduled_end: data.scheduled_end as Date | undefined,
      } as any,
      ['title', 'type', 'location', 'scheduled_start', 'scheduled_end'],
    );
    if (changes) {
      await this.audit.record({
        orgId, actorId: actor.id, action: 'update', resource: 'meeting',
        entityId: id, entityLabel: updated.title, changes,
      });
    }

    // Re-notify every non-declined attendee that the meeting they're ON has moved.
    if (notifyKeys.length) {
      const attendees = await this.prisma.meetingAttendee.findMany({
        where: { meeting_id: id, is_organizer: false, response: { not: 'declined' } },
        select: { user_id: true },
      });
      if (attendees.length) {
        const whenStr = updated.scheduled_start ? updated.scheduled_start.toISOString() : 'a new time';
        await this.notifications.emit({
          orgId,
          module: 'meetings',
          event_type: 'meeting_updated',
          recipients: attendees.map((a) => a.user_id),
          title: 'Meeting updated',
          body: `"${updated.title}" changed — it is now ${whenStr}. You are still on it.`,
          link: `${LINK}/${id}`,
          entity: { type: 'meeting', id },
        });
      }
    }

    // Re-mirror the edited meeting (time/title/attendees) to Google.
    await this.gsync.syncUpsert(orgId, id);

    return this.getOne(orgId, actor, id);
  }

  async remove(orgId: string, actor: Actor, id: string, reason?: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    await this.prisma.meeting.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date(), deleted_by_user_id: actor.id, deletion_reason: reason ?? null },
    });
    // Remove the organiser's Google mirror for the now-deleted meeting.
    await this.gsync.syncDelete(meeting.created_by_user_id, (meeting as any).google_event_id);
    await this.audit.record({
      orgId, actorId: actor.id, action: 'delete', resource: 'meeting',
      entityId: id, entityLabel: meeting.title,
      changes: reason ? { deletion_reason: { before: null, after: reason } } : null,
    });
    return { success: true };
  }

  // ─── Shared record (agenda + minutes) — any attendee, while open ───────────────
  async updateRecord(orgId: string, actor: Actor, id: string, dto: UpdateRecordDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    const data: Prisma.MeetingUpdateInput = {};
    if (dto.agenda !== undefined) data.agenda = dto.agenda;
    if (dto.minutes !== undefined) data.minutes = dto.minutes;
    const updated = await this.prisma.meeting.update({ where: { id }, data });
    const changes = this.audit.diff(meeting, dto as any, ['agenda', 'minutes']);
    if (changes) {
      await this.audit.record({
        orgId, actorId: actor.id, action: 'update', resource: 'meeting',
        entityId: id, entityLabel: updated.title, changes,
      });
    }
    return this.getOne(orgId, actor, id);
  }

  // ─── Attendance response — opt-out. The only action is to decline (with reason).
  async decline(orgId: string, actor: Actor, id: string, dto: DeclineDto) {
    const meeting = await this.findOrFail(orgId, id);
    const attendee = await this.getAttendeeOrFail(id, actor.id);
    if (meeting.status === 'closed' || meeting.status === 'cancelled') {
      throw new BadRequestException('This meeting is closed.');
    }
    if (!dto.reason?.trim()) throw new BadRequestException('A reason is required to decline.');

    await this.prisma.meetingAttendee.update({
      where: { id: attendee.id },
      data: { response: 'declined', reject_reason: dto.reason.trim() },
    });

    await this.notifications.emit({
      orgId, module: 'meetings', event_type: 'meeting_response',
      recipients: [meeting.created_by_user_id].filter((u) => u !== actor.id),
      title: attendee.is_required ? 'A required attendee declined' : 'An attendee declined',
      body: `${await this.notifications.userName(actor.id)} won't make "${meeting.title}": ${dto.reason.trim()}`,
      link: `${LINK}/${id}`,
      entity: { type: 'meeting', id },
    });
    return this.getOne(orgId, actor, id);
  }

  // Undo one's OWN decline → back to attending. Never touches another person's row,
  // and never lets the organiser flip someone else's stated intent.
  async undoDecline(orgId: string, actor: Actor, id: string) {
    const meeting = await this.findOrFail(orgId, id);
    const attendee = await this.getAttendeeOrFail(id, actor.id);
    if (meeting.status === 'closed' || meeting.status === 'cancelled') {
      throw new BadRequestException('This meeting is closed.');
    }
    await this.prisma.meetingAttendee.update({
      where: { id: attendee.id },
      data: { response: 'attending', reject_reason: null },
    });
    return this.getOne(orgId, actor, id);
  }

  // ─── Time capture / lifecycle ──────────────────────────────────────────────────
  async start(orgId: string, actor: Actor, id: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    if (meeting.status !== 'scheduled') throw new BadRequestException('Only a scheduled meeting can be started.');
    const now = await this.clock.now(orgId);
    await this.prisma.meeting.update({ where: { id }, data: { status: 'in_progress', actual_start: now } });
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { status: { before: 'scheduled', after: 'in_progress' } } });
    return this.getOne(orgId, actor, id);
  }

  async end(orgId: string, actor: Actor, id: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    if (meeting.status !== 'in_progress') throw new BadRequestException('Only a meeting in progress can be ended.');
    const now = await this.clock.now(orgId);
    await this.prisma.meeting.update({ where: { id }, data: { actual_end: now } });
    return this.getOne(orgId, actor, id);
  }

  async close(orgId: string, actor: Actor, id: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    if (meeting.status === 'closed') throw new BadRequestException('Meeting is already closed.');
    const now = await this.clock.now(orgId);
    await this.prisma.meeting.update({
      where: { id },
      data: { status: 'closed', actual_end: meeting.actual_end ?? now },
    });
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { status: { before: meeting.status, after: 'closed' } } });
    return this.getOne(orgId, actor, id);
  }

  async reopen(orgId: string, actor: Actor, id: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    if (meeting.status !== 'closed') throw new BadRequestException('Only a closed meeting can be reopened.');
    await this.prisma.meeting.update({ where: { id }, data: { status: 'in_progress' } });
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { status: { before: 'closed', after: 'in_progress' } } });
    return this.getOne(orgId, actor, id);
  }

  async cancel(orgId: string, actor: Actor, id: string, reason?: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    await this.prisma.meeting.update({
      where: { id },
      data: { status: 'cancelled', google_event_id: null, google_ical_uid: null },
    });
    // Pull the mirror off the organiser's Google Calendar (notifies attendees).
    await this.gsync.syncDelete(meeting.created_by_user_id, (meeting as any).google_event_id);
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { status: { before: meeting.status, after: 'cancelled' } } });
    const attendees = await this.prisma.meetingAttendee.findMany({ where: { meeting_id: id } });
    await this.notifications.emit({
      orgId, module: 'meetings', event_type: 'meeting_cancelled',
      recipients: attendees.map((a) => a.user_id).filter((u) => u !== actor.id),
      title: 'Meeting cancelled', body: `"${meeting.title}" was cancelled${reason ? `: ${reason}` : ''}`,
      link: `${LINK}/${id}`, entity: { type: 'meeting', id },
    });
    return this.getOne(orgId, actor, id);
  }

  async markAttendance(orgId: string, actor: Actor, id: string, dto: MarkAttendanceDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireManage(orgId, meeting, actor);
    for (const row of dto.rows) {
      await this.prisma.meetingAttendee.updateMany({
        where: { meeting_id: id, user_id: row.user_id },
        data: {
          attended: row.attended,
          attended_in_at: row.attended_in_at ? new Date(row.attended_in_at) : null,
          attended_out_at: row.attended_out_at ? new Date(row.attended_out_at) : null,
        },
      });
    }
    // Stamp the ledger the first time attendance is recorded, so governance can tell
    // "attendance not recorded" from "everyone no-showed". Never un-stamp.
    if (!meeting.attendance_taken_at) {
      await this.prisma.meeting.update({
        where: { id },
        data: { attendance_taken_at: await this.clock.now(orgId) },
      });
    }
    return this.getOne(orgId, actor, id);
  }

  // ─── Private note ──────────────────────────────────────────────────────────────
  async upsertMyNote(orgId: string, actor: Actor, id: string, dto: PrivateNoteDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    await this.prisma.meetingPrivateNote.upsert({
      where: { meeting_id_user_id: { meeting_id: id, user_id: actor.id } },
      create: { organization_id: orgId, meeting_id: id, user_id: actor.id, body: dto.body },
      update: { body: dto.body },
    });
    return { success: true };
  }

  // ─── Action items ──────────────────────────────────────────────────────────────
  async addActionItem(orgId: string, actor: Actor, id: string, dto: CreateActionItemDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    const item = await this.prisma.meetingActionItem.create({
      data: {
        organization_id: orgId, meeting_id: id, text: dto.text.trim(),
        owner_user_id: dto.owner_user_id ?? null, due_date: dto.due_date ? new Date(dto.due_date) : null,
      },
    });
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { action_item_added: { before: null, after: item.text } } });
    return this.getOne(orgId, actor, id);
  }

  async updateActionItem(orgId: string, actor: Actor, id: string, itemId: string, dto: UpdateActionItemDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    const data: Prisma.MeetingActionItemUpdateInput = {};
    if (dto.text !== undefined) data.text = dto.text.trim();
    if (dto.owner_user_id !== undefined) data.owner_user_id = dto.owner_user_id;
    if (dto.due_date !== undefined) data.due_date = dto.due_date ? new Date(dto.due_date) : null;
    if (dto.is_done !== undefined) data.is_done = dto.is_done;
    await this.prisma.meetingActionItem.updateMany({ where: { id: itemId, meeting_id: id }, data });
    return this.getOne(orgId, actor, id);
  }

  async deleteActionItem(orgId: string, actor: Actor, id: string, itemId: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    await this.prisma.meetingActionItem.deleteMany({ where: { id: itemId, meeting_id: id } });
    return this.getOne(orgId, actor, id);
  }

  /** Attach an existing task or create a new one (via the Task module) and link it. */
  async linkTask(orgId: string, actor: Actor, id: string, itemId: string, dto: LinkTaskDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    const item = await this.prisma.meetingActionItem.findFirst({ where: { id: itemId, meeting_id: id } });
    if (!item) throw new NotFoundException('Action item not found');

    let taskId = dto.task_id;
    if (!taskId && dto.create) {
      const task = await this.tasks.createTask(orgId, actor.id, {
        title: dto.create.title,
        assignee_user_ids: dto.create.assignee_user_ids,
        deadline: dto.create.deadline,
        goal_id: meeting.link_type === 'goal' ? meeting.link_entity_id ?? undefined : undefined,
      } as any);
      taskId = task.id;
    }
    if (!taskId) throw new BadRequestException('Provide a task to attach or details to create one.');

    await this.prisma.meetingActionItem.update({ where: { id: itemId }, data: { linked_task_id: taskId } });
    return this.getOne(orgId, actor, id);
  }

  // ─── Decisions ───────────────────────────────────────────────────────────────
  async addDecision(orgId: string, actor: Actor, id: string, dto: CreateDecisionDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    const d = await this.prisma.meetingDecision.create({
      data: {
        organization_id: orgId, meeting_id: id, decision: dto.decision.trim(),
        owner_user_id: dto.owner_user_id ?? null,
        decided_on: dto.decided_on ? new Date(dto.decided_on) : await this.clock.now(orgId),
        reason: dto.reason ?? null,
        affects_link_type: dto.affects_link_type ?? null,
        affects_entity_id: dto.affects_entity_id ?? null,
      },
    });
    await this.audit.record({ orgId, actorId: actor.id, action: 'update', resource: 'meeting', entityId: id, entityLabel: meeting.title, changes: { decision_added: { before: null, after: d.decision } } });
    return this.getOne(orgId, actor, id);
  }

  async updateDecision(orgId: string, actor: Actor, id: string, decisionId: string, dto: UpdateDecisionDto) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    const data: Prisma.MeetingDecisionUpdateInput = {};
    if (dto.decision !== undefined) data.decision = dto.decision.trim();
    if (dto.owner_user_id !== undefined) data.owner_user_id = dto.owner_user_id;
    if (dto.decided_on !== undefined) data.decided_on = new Date(dto.decided_on);
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.affects_link_type !== undefined) data.affects_link_type = dto.affects_link_type;
    if (dto.affects_entity_id !== undefined) data.affects_entity_id = dto.affects_entity_id;
    await this.prisma.meetingDecision.updateMany({ where: { id: decisionId, meeting_id: id }, data });
    return this.getOne(orgId, actor, id);
  }

  async deleteDecision(orgId: string, actor: Actor, id: string, decisionId: string) {
    const meeting = await this.findOrFail(orgId, id);
    await this.requireAttendee(orgId, meeting, actor);
    this.assertOpen(meeting);
    await this.prisma.meetingDecision.deleteMany({ where: { id: decisionId, meeting_id: id } });
    return this.getOne(orgId, actor, id);
  }

  /** Org-wide decision log across meetings. */
  async listDecisions(orgId: string, filters: Record<string, string | undefined>) {
    const where: Prisma.MeetingDecisionWhereInput = {
      organization_id: orgId,
      meeting: { is_deleted: false },
    };
    if (filters.owner_user_id) where.owner_user_id = filters.owner_user_id;
    if (filters.from_date || filters.to_date) {
      where.decided_on = {};
      if (filters.from_date) (where.decided_on as any).gte = new Date(filters.from_date);
      if (filters.to_date) (where.decided_on as any).lte = new Date(filters.to_date);
    }
    if (filters.search) where.decision = { contains: filters.search, mode: 'insensitive' };
    return this.prisma.meetingDecision.findMany({
      where,
      orderBy: { decided_on: 'desc' },
      include: { meeting: { select: { id: true, title: true } } },
    });
  }

  // ─── Edit log (reads the shared audit log) ─────────────────────────────────────
  async getEditLog(orgId: string, id: string, actor?: Actor) {
    const meeting = await this.findOrFail(orgId, id);
    if (actor) await this.assertParticipantView(orgId, actor, meeting);
    return this.audit.list(orgId, { resource: 'meeting', entity_id: id, take: 200 });
  }

  // ─── Busy view ─────────────────────────────────────────────────────────────────
  // The organiser sees people's busy times BEFORE he picks a slot (he still picks;
  // the system only suggests). HONEST FLOOR: this reflects only what THIS app knows —
  // in-app meetings, leave and holidays. It is never a guarantee someone is free.
  async busyView(orgId: string, actor: Actor, dto: BusyQueryDto) {
    const userIds = [...new Set(dto.user_ids.filter(Boolean))];
    if (userIds.length === 0) {
      return { from: dto.from, to: dto.to, people: [], suggestions: [], caveat: BUSY_CAVEAT };
    }
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
      throw new BadRequestException('Invalid date range.');
    }
    // Bound the window so a wide range can't fan out into an unbounded day scan.
    const MAX_DAYS = 62;
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) {
      throw new BadRequestException(`The busy window cannot exceed ${MAX_DAYS} days.`);
    }
    const required = new Set((dto.required_user_ids ?? userIds).filter((id) => userIds.includes(id)));

    // (a) In-app meetings — one bounded query, attendees pre-filtered to our people.
    const meetings = await this.prisma.meeting.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        status: { in: ['scheduled', 'in_progress'] },
        scheduled_start: { lt: to },
        scheduled_end: { gt: from },
        attendees: { some: { user_id: { in: userIds }, response: { not: 'declined' } } },
      },
      select: {
        id: true, title: true, scheduled_start: true, scheduled_end: true,
        attendees: { where: { user_id: { in: userIds }, response: { not: 'declined' } }, select: { user_id: true } },
      },
    });

    // (b) Leave (whole-day) and (c) holidays (whole-day, org-wide).
    const [leave, holidays, users] = await Promise.all([
      this.leave.availability(orgId, userIds, dto.from, dto.to),
      this.holidays.getHolidaysInRange(orgId, startOfDay(from), startOfDay(to)),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const leaveByUser = new Map(leave.results.map((r) => [r.user_id, r.windows]));

    const people = userIds.map((uid) => {
      const busy: { start: string; end: string; kind: 'meeting' | 'leave' | 'holiday'; label: string }[] = [];
      for (const m of meetings) {
        if (m.attendees.some((a) => a.user_id === uid) && m.scheduled_start && m.scheduled_end) {
          busy.push({ start: m.scheduled_start.toISOString(), end: m.scheduled_end.toISOString(), kind: 'meeting', label: m.title });
        }
      }
      for (const w of leaveByUser.get(uid) ?? []) {
        busy.push({ start: w.start_date, end: w.end_date, kind: 'leave', label: `On leave${w.state ? ` (${w.state})` : ''}` });
      }
      for (const h of holidays) {
        busy.push({ start: h.date, end: h.date, kind: 'holiday', label: h.name });
      }
      busy.sort((a, b) => a.start.localeCompare(b.start));
      return { user_id: uid, name: nameOf.get(uid) ?? 'Unknown', required: required.has(uid), busy };
    });

    // Ranked suggestions (only when a duration is supplied). Required-attendee clashes
    // are HARD (drive ranking); optional-attendee clashes are soft warnings.
    let suggestions: any[] = [];
    if (dto.duration_min && dto.duration_min > 0) {
      suggestions = this.rankSuggestions(meetings, from, to, dto.duration_min, required);
    }

    return { from: dto.from, to: dto.to, people, suggestions, caveat: BUSY_CAVEAT };
  }

  private rankSuggestions(
    meetings: { scheduled_start: Date | null; scheduled_end: Date | null; attendees: { user_id: string }[] }[],
    from: Date,
    to: Date,
    durationMin: number,
    required: Set<string>,
  ) {
    const HOURS = [9, 11, 14, 16];
    const durationMs = durationMin * 60_000;
    const candidates: { start: Date; end: Date }[] = [];
    const cursor = startOfDay(from);
    let days = 0;
    while (cursor <= to && days < 62) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        for (const h of HOURS) {
          const start = new Date(cursor); start.setHours(h, 0, 0, 0);
          const end = new Date(start.getTime() + durationMs);
          if (start >= from && end <= to) candidates.push({ start, end });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
      days++;
    }
    return candidates
      .map((c) => {
        const hard = new Set<string>();
        const soft = new Set<string>();
        for (const m of meetings) {
          if (m.scheduled_start && m.scheduled_end && m.scheduled_start < c.end && m.scheduled_end > c.start) {
            for (const a of m.attendees) (required.has(a.user_id) ? hard : soft).add(a.user_id);
          }
        }
        return { start: c.start.toISOString(), end: c.end.toISOString(), hard_conflicts: [...hard], soft_conflicts: [...soft] };
      })
      // Fewest required clashes first, then fewest optional clashes.
      .sort((a, b) => a.hard_conflicts.length - b.hard_conflicts.length || a.soft_conflicts.length - b.soft_conflicts.length)
      .slice(0, 5);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────────
  private async findOrFail(orgId: string, id: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id, organization_id: orgId, is_deleted: false } });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }

  private async getAttendeeOrFail(meetingId: string, userId: string) {
    const a = await this.prisma.meetingAttendee.findUnique({ where: { meeting_id_user_id: { meeting_id: meetingId, user_id: userId } } });
    if (!a) throw new ForbiddenException('You are not an attendee of this meeting.');
    return a;
  }

  private async requireAttendee(orgId: string, meeting: { id: string; created_by_user_id: string }, actor: Actor) {
    if (actor.id === meeting.created_by_user_id) return;
    const a = await this.prisma.meetingAttendee.findUnique({ where: { meeting_id_user_id: { meeting_id: meeting.id, user_id: actor.id } } });
    if (!a && !(await this.canManage(orgId, meeting, actor))) {
      throw new ForbiddenException('You are not part of this meeting.');
    }
  }

  private async participantIds(meeting: { id: string; created_by_user_id: string }): Promise<string[]> {
    const attendees = await this.prisma.meetingAttendee.findMany({
      where: { meeting_id: meeting.id },
      select: { user_id: true },
    });
    return [meeting.created_by_user_id, ...attendees.map((a) => a.user_id)];
  }

  /**
   * Scope-aware manage check: an edit entitlement must actually COVER this
   * meeting's participants — holding `meetings.edit` at own/team scope is not a
   * skeleton key for every meeting in the org.
   */
  private async canManage(orgId: string, meeting: { id: string; created_by_user_id: string }, actor: Actor): Promise<boolean> {
    if (actor.id === meeting.created_by_user_id) return true;
    if (!(await this.permissions.hasEffective(
      orgId,
      { userId: actor.id, systemRoleId: actor.system_role_id, isAdmin: actor.is_admin, isSuperAdmin: actor.isSuperAdmin },
      MEETING,
      'edit',
    ))) {
      return false;
    }
    try {
      await this.scope.assertCanActOn(
        orgId,
        principalFromUser(actor),
        MEETING,
        PermissionAction.edit,
        await this.participantIds(meeting),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async requireManage(orgId: string, meeting: { id: string; created_by_user_id: string }, actor: Actor) {
    if (!(await this.canManage(orgId, meeting, actor))) {
      throw new ForbiddenException('Only the organiser (or a user with edit rights) can do this.');
    }
  }

  /**
   * A meeting is a private record. Allow a viewer only if they are directly on it
   * (organizer or attendee) OR it falls within their read scope over one of its
   * participants. Fails closed — knowing a meeting's id must never be enough to
   * read its record, analytics, or edit log.
   */
  private async assertParticipantView(orgId: string, actor: Actor, meeting: { id: string; created_by_user_id: string }) {
    if (actor.id === meeting.created_by_user_id) return;
    const participants = await this.participantIds(meeting);
    if (participants.includes(actor.id)) return;
    await this.scope.assertCanActOn(orgId, principalFromUser(actor), MEETING, PermissionAction.read, participants);
  }

  /** Guard for meeting reads and sub-resources. Internal callers pass no actor. */
  async assertCanViewMeeting(orgId: string, actor: Actor | undefined, id: string): Promise<void> {
    if (!actor) return;
    const meeting = await this.findOrFail(orgId, id);
    await this.assertParticipantView(orgId, actor, meeting);
  }

  private assertOpen(meeting: { status: string }) {
    if (meeting.status === 'closed') throw new BadRequestException('This meeting is closed — its record is locked.');
    if (meeting.status === 'cancelled') throw new BadRequestException('This meeting was cancelled.');
  }

  private async syncAttendees(orgId: string, meetingId: string, userIds: string[], optionalUserIds: string[], organizerId: string) {
    // Fail loud: newly added attendees must be eligible meeting subjects.
    await this.subjects.assertAllEligible(
      orgId,
      'meetings.subject.invitable',
      userIds.filter((u) => u !== organizerId),
    );
    const optional = new Set(optionalUserIds);
    const wanted = new Set(userIds.concat(organizerId));
    const existing = await this.prisma.meetingAttendee.findMany({ where: { meeting_id: meetingId } });
    const existingIds = new Set(existing.map((a) => a.user_id));
    const toAdd = [...wanted].filter((u) => !existingIds.has(u));
    const toRemove = existing.filter((a) => !wanted.has(a.user_id) && !a.is_organizer).map((a) => a.id);
    if (toAdd.length) {
      await this.prisma.meetingAttendee.createMany({
        data: toAdd.map((uid) => ({
          organization_id: orgId,
          meeting_id: meetingId,
          user_id: uid,
          is_organizer: uid === organizerId,
          is_required: uid === organizerId ? true : !optional.has(uid),
          response: 'attending' as const,
        })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) await this.prisma.meetingAttendee.deleteMany({ where: { id: { in: toRemove } } });
    // Keep is_required in sync for people who stayed on the meeting (never the organizer).
    for (const a of existing) {
      if (a.is_organizer || !wanted.has(a.user_id)) continue;
      const shouldRequire = !optional.has(a.user_id);
      if (a.is_required !== shouldRequire) {
        await this.prisma.meetingAttendee.update({ where: { id: a.id }, data: { is_required: shouldRequire } });
      }
    }
  }

  /** Overlapping non-declined meetings for any of the given users (a soft conflict signal). */
  async conflictsFor(orgId: string, userIds: string[], start: Date, end: Date, excludeMeetingId?: string) {
    if (!userIds.length) return [];
    const meetings = await this.prisma.meeting.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        id: excludeMeetingId ? { not: excludeMeetingId } : undefined,
        status: { in: ['scheduled', 'in_progress'] },
        scheduled_start: { lt: end },
        scheduled_end: { gt: start },
        attendees: { some: { user_id: { in: userIds }, response: { not: 'declined' } } },
      },
      select: {
        id: true, title: true, scheduled_start: true, scheduled_end: true,
        attendees: { where: { user_id: { in: userIds }, response: { not: 'declined' } }, select: { user_id: true } },
      },
    });
    return meetings.flatMap((m) =>
      m.attendees.map((a) => ({ user_id: a.user_id, meeting_id: m.id, title: m.title, scheduled_start: m.scheduled_start })),
    );
  }
}

const BUSY_CAVEAT =
  'Shows only meetings, leave and holidays this app knows about. It is not a guarantee someone is free — check with them for anything outside the system.';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
