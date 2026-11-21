import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataScope, PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ScopeService } from '../access-rights/scope.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { principalFromUser } from '../access-rights/permissions.service';
import { shouldEntryFireToday, type RecurrenceEntry } from '../common/recurrence/should-fire-today';
import { HolidaysService } from '../holidays/holidays.service';
import { Actor } from './meetings.service';
import { CreateRhythmDto, UpdateRhythmDto, RhythmScheduleDto } from './dto/meeting-actions.dto';
import { RhythmGoogleSyncService } from '../gcal/rhythm-google-sync.service';
import { swallow } from '../common/swallow';

const MEETING_LEAF = 'meetings';
const LINK = '/dashboard/governance/meetings/rhythms';
// The nightly cron keeps this many days materialised; create/resume top-up matches it.
const HORIZON = 60;

@Injectable()
export class MeetingRhythmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerService,
    private readonly scope: ScopeService,
    private readonly subjects: SubjectEligibilityService,
    private readonly holidays: HolidaysService,
    private readonly rgsync: RhythmGoogleSyncService,
  ) {}

  // Preview which upcoming occurrences of a (draft) schedule land on a company
  // holiday — i.e. exactly the days the spawner would SKIP when skip_holidays is on.
  // Mirrors the spawner's date + holiday matching so the list is authoritative.
  async holidayPreview(orgId: string, s: RhythmScheduleDto): Promise<{ date: string; name: string }[]> {
    const now = await this.clock.now();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const start = new Date(s.start_date); start.setHours(0, 0, 0, 0);
    const from = start > today ? start : today;
    const to =
      s.end_condition === 'on_date' && s.end_date
        ? (() => { const d = new Date(s.end_date); d.setHours(0, 0, 0, 0); return d; })()
        : (() => { const d = new Date(from); d.setDate(from.getDate() + 180); return d; })();
    if (to < from) return [];

    const holidays = await this.holidays.getHolidaysInRange(orgId, from, to).catch(() => []);
    const holMap = new Map(holidays.map((h) => [h.date, h.name]));
    if (holMap.size === 0) return [];

    const entry: RecurrenceEntry = {
      start_date: start,
      schedule_type: s.schedule_type,
      every: s.every ?? 1,
      days: s.days ?? [],
      month_days: s.month_days ?? [],
      yearly_dates: s.yearly_dates ?? [],
      end_condition: s.end_condition ?? 'never',
      end_date: s.end_date ? new Date(s.end_date) : null,
      end_after: s.end_after ?? null,
      occurrence_count: 0,
    };

    const out: { date: string; name: string }[] = [];
    let realCount = 0; // non-holiday occurrences (mirror after_n: holidays don't consume)
    const d = new Date(from);
    while (d <= to && out.length < 30) {
      if (shouldEntryFireToday({ ...entry, occurrence_count: realCount }, d)) {
        const key = d.toISOString().slice(0, 10);
        const name = holMap.get(key);
        if (name) out.push({ date: key, name });
        else realCount++;
        if (s.end_condition === 'after_n' && s.end_after && realCount >= s.end_after) break;
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  private jsonIds(v: unknown): string[] {
    return (Array.isArray(v) ? v : []) as string[];
  }

  private scheduleData(orgId: string, rhythmId: string, s: RhythmScheduleDto) {
    return {
      organization_id: orgId,
      meeting_rhythm_id: rhythmId,
      schedule_type: s.schedule_type,
      every: s.every ?? 1,
      days: (s.days ?? []) as unknown as Prisma.InputJsonValue,
      month_days: (s.month_days ?? []) as unknown as Prisma.InputJsonValue,
      yearly_dates: (s.yearly_dates ?? []) as unknown as Prisma.InputJsonValue,
      time: s.time,
      start_date: new Date(s.start_date),
      end_condition: s.end_condition ?? 'never',
      end_date: s.end_date ? new Date(s.end_date) : null,
      end_after: s.end_after ?? null,
      skip_holidays: s.skip_holidays ?? true,
    };
  }

  // Company holidays in the series window → EXDATEs on the recurring Google event.
  private async holidayDatesFor(orgId: string, entry: { start_date: Date; end_condition: string; end_date: Date | null }): Promise<string[]> {
    const start = new Date(entry.start_date); start.setHours(0, 0, 0, 0);
    const end = entry.end_condition === 'on_date' && entry.end_date
      ? new Date(entry.end_date)
      : (() => { const d = new Date(start); d.setFullYear(d.getFullYear() + 1); return d; })();
    const hols = await this.holidays.getHolidaysInRange(orgId, start, end).catch(() => []);
    return (hols as any[]).map((h) => h.date);
  }

  // Mirror the rhythm to its single recurring Google event (Zoom-style). Reads
  // the current schedule so it reflects the latest edit; is_active=false tears
  // the series down. Best-effort — never blocks the rhythm mutation.
  private async syncRhythmToGoogle(orgId: string, rhythmId: string): Promise<void> {
    if (!this.rgsync.isConfigured) return;
    const entry = await this.prisma.meetingRhythmSchedule.findFirst({ where: { meeting_rhythm_id: rhythmId }, orderBy: { created_at: 'asc' } });
    const skip = (entry as any)?.skip_holidays ?? true;
    const holidayDates = entry && skip ? await this.holidayDatesFor(orgId, entry as any) : [];
    await this.rgsync.syncUpsert(orgId, rhythmId, holidayDates);
  }

  // ─── Create ─────────────────────────────────────────────────────────────────
  async create(orgId: string, actor: Actor, dto: CreateRhythmDto) {
    const attendeeIds = [...new Set((dto.attendee_user_ids ?? []).filter((id) => id !== actor.id))];
    await this.subjects.assertAllEligible(orgId, 'meetings.subject.invitable', attendeeIds);

    const rhythm = await this.prisma.meetingRhythm.create({
      data: {
        organization_id: orgId,
        title: dto.title.trim(),
        type: dto.type,
        online_link: dto.online_link ?? null,
        online_password: dto.online_password ?? null,
        location: dto.location ?? null,
        link_type: dto.link_type ?? null,
        link_entity_id: dto.link_type ? dto.link_entity_id ?? null : null,
        agenda: dto.agenda ?? null,
        duration_min: dto.duration_min,
        attendee_user_ids: attendeeIds as unknown as Prisma.InputJsonValue,
        optional_user_ids: (dto.optional_user_ids ?? []) as unknown as Prisma.InputJsonValue,
        created_by_user_id: actor.id,
      },
    });
    await this.prisma.meetingRhythmSchedule.create({
      data: this.scheduleData(orgId, rhythm.id, dto.schedule),
    });

    // Materialise the next 60 days right away so the series is visible immediately.
    const now = await this.clock.now(orgId);
    await this.scheduler.spawnForMeetingRhythm(orgId, rhythm.id, now, HORIZON).catch(swallow('meeting-rhythms.create', null));

    // One notification per person that a rhythm was set up (NOT per spawned instance).
    if (attendeeIds.length) {
      await this.notifications.emit({
        orgId, module: 'meetings', event_type: 'meeting_invited',
        recipients: attendeeIds,
        title: 'You are on a recurring meeting',
        body: `${await this.notifications.userName(actor.id)} set up the rhythm "${dto.title}"`,
        link: `${LINK}/${rhythm.id}`,
        entity: { type: 'meeting_rhythm', id: rhythm.id },
      }).catch(swallow('meeting-rhythms.create'));
    }

    await this.syncRhythmToGoogle(orgId, rhythm.id);
    return this.getOne(orgId, actor, rhythm.id);
  }

  // ─── List ───────────────────────────────────────────────────────────────────
  async list(orgId: string, actor: Actor, filters: Record<string, string | undefined>) {
    const principal = principalFromUser(actor);
    const { effective } = await this.scope.resolveListScope(orgId, principal, MEETING_LEAF, null);
    if (effective === null) return []; // no read scope → nothing

    const where: Prisma.MeetingRhythmWhereInput = { organization_id: orgId };
    if (filters.status === 'active') where.is_active = true;
    else if (filters.status === 'paused') where.is_active = false;

    if (effective !== DataScope.org) {
      const visible = await this.scope.visibleUserIds(orgId, actor.id, effective);
      if (visible !== 'ALL') {
        // Rhythms whose creator is within my scope, OR that I am personally on.
        where.OR = [
          { created_by_user_id: { in: visible } },
          { attendee_user_ids: { array_contains: actor.id } },
        ];
      }
    }

    const rhythms = await this.prisma.meetingRhythm.findMany({
      where,
      include: { schedule_entries: true },
      orderBy: { created_at: 'desc' },
    });
    const now = await this.clock.now(orgId);
    return this.enrich(orgId, rhythms, now, actor);
  }

  private async enrich(orgId: string, rhythms: any[], now: Date, actor?: Actor) {
    if (rhythms.length === 0) return [];
    const creatorIds = [...new Set(rhythms.map((r) => r.created_by_user_id))];
    const users = await this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return rhythms.map((r) => ({
      ...r,
      created_by_name: nameOf.get(r.created_by_user_id) ?? 'Unknown',
      occurrences: (r.schedule_entries ?? []).reduce((s: number, e: any) => s + (e.occurrence_count ?? 0), 0),
      next_run: this.nextRun(r, now),
      ...(actor ? { can_manage: this.canManage(actor, r) } : {}),
    }));
  }

  private nextRun(rhythm: any, now: Date): string | null {
    if (!rhythm.is_active) return null;
    const entries = (rhythm.schedule_entries ?? []).filter((e: any) => e.is_active) as RecurrenceEntry[];
    if (entries.length === 0) return null;
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    for (let i = 0; i <= 366; i++) {
      const day = new Date(start); day.setDate(day.getDate() + i);
      if (entries.some((e) => shouldEntryFireToday(e, day))) return day.toISOString();
    }
    return null;
  }

  // ─── Get ────────────────────────────────────────────────────────────────────
  async getOne(orgId: string, actor: Actor, id: string) {
    const rhythm = await this.findOrFail(orgId, id);
    await this.assertCanView(orgId, actor, rhythm);
    const [enriched] = await this.enrich(orgId, [rhythm], await this.clock.now(orgId));
    return { ...enriched, can_manage: this.canManage(actor, rhythm) };
  }

  // ─── Update (EDIT-FREEZE) ─────────────────────────────────────────────────────
  // The template's new values apply to FUTURE spawns. Already-spawned instances that
  // are still 'scheduled', in the future, and UNTOUCHED (the organiser hasn't moved
  // their time) are updated to match. Held, past, cancelled, or manually-moved
  // instances are FROZEN. The schedule row is updated IN PLACE (never delete+recreate),
  // so occurrence_count — and therefore after_n — is never silently reset.
  async update(orgId: string, actor: Actor, id: string, dto: UpdateRhythmDto) {
    const rhythm = await this.findOrFail(orgId, id);
    this.requireManage(actor, rhythm);

    const attendeeIds = dto.attendee_user_ids !== undefined
      ? [...new Set(dto.attendee_user_ids.filter((x) => x !== rhythm.created_by_user_id))]
      : undefined;
    if (attendeeIds) await this.subjects.assertAllEligible(orgId, 'meetings.subject.invitable', attendeeIds);

    // Capture the OLD schedule time BEFORE any change — needed to detect "untouched".
    const oldEntry = await this.prisma.meetingRhythmSchedule.findFirst({
      where: { meeting_rhythm_id: id },
      orderBy: { created_at: 'asc' },
    });
    const oldTime = oldEntry?.time ?? null;

    const data: Prisma.MeetingRhythmUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.online_link !== undefined) data.online_link = dto.online_link;
    if (dto.online_password !== undefined) data.online_password = dto.online_password;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.link_type !== undefined) data.link_type = dto.link_type;
    if (dto.link_entity_id !== undefined) data.link_entity_id = dto.link_entity_id;
    if (dto.agenda !== undefined) data.agenda = dto.agenda;
    if (dto.duration_min !== undefined) data.duration_min = dto.duration_min;
    if (attendeeIds !== undefined) data.attendee_user_ids = attendeeIds as unknown as Prisma.InputJsonValue;
    if (dto.optional_user_ids !== undefined) data.optional_user_ids = dto.optional_user_ids as unknown as Prisma.InputJsonValue;

    const updated = await this.prisma.meetingRhythm.update({ where: { id }, data });

    // Update the schedule entry IN PLACE (preserve occurrence_count → never restarts after_n).
    let newEntry = oldEntry;
    if (dto.schedule !== undefined && oldEntry) {
      const s = dto.schedule;
      newEntry = await this.prisma.meetingRhythmSchedule.update({
        where: { id: oldEntry.id },
        data: {
          schedule_type: s.schedule_type,
          every: s.every ?? 1,
          days: (s.days ?? []) as unknown as Prisma.InputJsonValue,
          month_days: (s.month_days ?? []) as unknown as Prisma.InputJsonValue,
          yearly_dates: (s.yearly_dates ?? []) as unknown as Prisma.InputJsonValue,
          time: s.time,
          start_date: new Date(s.start_date),
          end_condition: s.end_condition ?? 'never',
          end_date: s.end_date ? new Date(s.end_date) : null,
          end_after: s.end_after ?? null,
          skip_holidays: s.skip_holidays ?? true,
          // occurrence_count intentionally untouched.
        },
      });
    }

    const now = await this.clock.now(orgId);
    const newTime = dto.schedule?.time ?? oldTime;
    // Pass the new schedule ONLY when the cadence changed, so propagate can retire
    // future instances that no longer fire under the new pattern (e.g. daily→weekly).
    await this.propagateToFutureInstances(
      orgId, updated, oldTime, newTime, now, actor,
      dto.schedule !== undefined ? newEntry : null,
    );

    // Materialise any newly-due days under the (possibly changed) schedule.
    await this.scheduler.spawnForMeetingRhythm(orgId, id, now, HORIZON).catch(swallow('meeting-rhythms.update', null));

    // Update the single recurring Google event → Google applies to all occurrences.
    await this.syncRhythmToGoogle(orgId, id);
    return this.getOne(orgId, actor, id);
  }

  // Push the edit into future, still-scheduled, UNTOUCHED instances only.
  private async propagateToFutureInstances(
    orgId: string,
    rhythm: any,
    oldTime: string | null,
    newTime: string | null,
    now: Date,
    actor: Actor,
    newEntry: any | null,
  ) {
    const future = await this.prisma.meeting.findMany({
      where: {
        organization_id: orgId,
        rhythm_id: rhythm.id,
        is_deleted: false,
        status: 'scheduled',
        scheduled_start: { gt: now },
      },
      include: { attendees: { select: { id: true, user_id: true, is_organizer: true, is_required: true, response: true } } },
    });
    if (future.length === 0) return;

    const roster = this.jsonIds(rhythm.attendee_user_ids);
    const optional = new Set(this.jsonIds(rhythm.optional_user_ids));

    for (const m of future) {
      // "Untouched" = the organiser has not moved this instance's time away from what
      // the rhythm produced. Compared by time-of-day (tz-safe, uses the instance's own day).
      if (oldTime && m.scheduled_start) {
        const hhmm = `${pad(m.scheduled_start.getHours())}:${pad(m.scheduled_start.getMinutes())}`;
        if (hhmm !== oldTime) continue; // manually moved → frozen
      }

      // If the cadence changed, an untouched instance whose day no longer fires under
      // the NEW pattern is an orphan (e.g. daily→weekly leaves stray weekday meetings).
      // Retire it so it doesn't linger on calendars. occurrence_count is neutralised in
      // the probe so an after_n cap can't mislabel a genuinely-matching day as invalid;
      // start_date/end_date filtering stays active (narrowing the window legitimately
      // removes out-of-range instances). Re-spawn (below, in update) refills valid days.
      if (newEntry && m.scheduled_start) {
        const probe = { ...(newEntry as RecurrenceEntry), occurrence_count: 0 };
        if (!shouldEntryFireToday(probe, m.scheduled_start)) {
          await this.prisma.meeting.update({
            where: { id: m.id },
            data: { is_deleted: true, deleted_at: now, deleted_by_user_id: actor.id, deletion_reason: 'Rhythm cadence changed' },
          });
          continue;
        }
      }

      const data: Prisma.MeetingUpdateInput = {
        title: rhythm.title,
        type: rhythm.type,
        online_link: rhythm.online_link,
        online_password: rhythm.online_password,
        location: rhythm.location,
        link_type: rhythm.link_type,
        link_entity_id: rhythm.link_entity_id,
        agenda: rhythm.agenda,
      };
      // Re-time on the SAME calendar day (only the time-of-day changes), then re-length.
      if (newTime && m.scheduled_start) {
        const [h, mm] = newTime.split(':').map(Number);
        const start = new Date(m.scheduled_start); start.setHours(h || 0, mm || 0, 0, 0);
        data.scheduled_start = start;
        data.scheduled_end = new Date(start.getTime() + (rhythm.duration_min ?? 30) * 60_000);
      }
      await this.prisma.meeting.update({ where: { id: m.id }, data });

      // Re-sync the roster on this instance. NEVER overwrite an existing person's
      // response (a decline is preserved) — only add/remove/adjust required-ness.
      const existing = new Map(m.attendees.map((a) => [a.user_id, a]));
      const wanted = new Set([rhythm.created_by_user_id, ...roster]);
      const toAdd = [...wanted].filter((uid) => !existing.has(uid));
      if (toAdd.length) {
        await this.prisma.meetingAttendee.createMany({
          data: toAdd.map((uid) => ({
            organization_id: orgId,
            meeting_id: m.id,
            user_id: uid,
            is_organizer: uid === rhythm.created_by_user_id,
            is_required: uid === rhythm.created_by_user_id ? true : !optional.has(uid),
            response: 'attending' as const,
          })),
          skipDuplicates: true,
        });
      }
      for (const a of m.attendees) {
        if (a.is_organizer) continue;
        if (!wanted.has(a.user_id)) {
          await this.prisma.meetingAttendee.delete({ where: { id: a.id } });
          continue;
        }
        const shouldRequire = !optional.has(a.user_id);
        if (a.is_required !== shouldRequire) {
          await this.prisma.meetingAttendee.update({ where: { id: a.id }, data: { is_required: shouldRequire } });
        }
      }
    }
  }

  // ─── Pause / resume / delete ──────────────────────────────────────────────────
  async pause(orgId: string, actor: Actor, id: string) {
    const rhythm = await this.findOrFail(orgId, id);
    this.requireManage(actor, rhythm);
    await this.prisma.meetingRhythm.update({ where: { id }, data: { is_active: false } });
    await this.syncRhythmToGoogle(orgId, id);
    return this.getOne(orgId, actor, id);
  }

  async resume(orgId: string, actor: Actor, id: string) {
    const rhythm = await this.findOrFail(orgId, id);
    this.requireManage(actor, rhythm);
    await this.prisma.meetingRhythm.update({ where: { id }, data: { is_active: true } });
    const now = await this.clock.now(orgId);
    await this.scheduler.spawnForMeetingRhythm(orgId, id, now, HORIZON).catch(swallow('meeting-rhythms.resume', null));
    await this.syncRhythmToGoogle(orgId, id);
    return this.getOne(orgId, actor, id);
  }

  // stop = deactivate only (spawned instances kept). delete-future = also soft-delete
  // future STILL-SCHEDULED instances (past/held/cancelled frozen). The rhythm row is
  // deactivated, not hard-deleted, so its instances keep their rhythm_id for governance.
  async remove(orgId: string, actor: Actor, id: string, mode: 'stop' | 'delete-future' = 'stop') {
    const rhythm = await this.findOrFail(orgId, id);
    this.requireManage(actor, rhythm);
    if (mode === 'delete-future') {
      const now = await this.clock.now(orgId);
      await this.prisma.meeting.updateMany({
        where: { organization_id: orgId, rhythm_id: id, is_deleted: false, status: 'scheduled', scheduled_start: { gt: now } },
        data: { is_deleted: true, deleted_at: new Date(), deleted_by_user_id: actor.id, deletion_reason: 'Rhythm stopped' },
      });
    }
    await this.prisma.meetingRhythm.update({ where: { id }, data: { is_active: false } });
    await this.syncRhythmToGoogle(orgId, id);
    return { message: mode === 'delete-future' ? 'Rhythm stopped and future meetings removed' : 'Rhythm stopped' };
  }

  // ─── Auth helpers ─────────────────────────────────────────────────────────────
  private async findOrFail(orgId: string, id: string) {
    const r = await this.prisma.meetingRhythm.findFirst({
      where: { id, organization_id: orgId },
      include: { schedule_entries: true },
    });
    if (!r) throw new NotFoundException('Rhythm not found');
    return r;
  }

  private canManage(actor: Actor, rhythm: { created_by_user_id: string }): boolean {
    return actor.id === rhythm.created_by_user_id || actor.is_admin || actor.isSuperAdmin;
  }

  private requireManage(actor: Actor, rhythm: { created_by_user_id: string }) {
    if (!this.canManage(actor, rhythm)) {
      throw new ForbiddenException('Only the rhythm owner or an admin can do this.');
    }
  }

  private async assertCanView(orgId: string, actor: Actor, rhythm: any) {
    if (this.canManage(actor, rhythm)) return;
    if (this.jsonIds(rhythm.attendee_user_ids).includes(actor.id)) return;
    // Otherwise require read scope over the creator (same participant model as meetings).
    await this.scope.assertCanActOn(
      orgId,
      principalFromUser(actor),
      MEETING_LEAF,
      PermissionAction.read,
      [rhythm.created_by_user_id],
    );
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
