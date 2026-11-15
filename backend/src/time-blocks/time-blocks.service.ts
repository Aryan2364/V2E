import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GcalApiService } from '../gcal/gcal-api.service';
import { GoogleAccountService } from '../gcal/google-account.service';
import { CreateTimeBlockDto, UpdateTimeBlockDto } from './dto/time-block.dto';
import { swallow } from '../common/swallow';

// A Time-Block is the user's OWN availability (a named personal event, e.g.
// "Dentist"). It is not a meeting and is never org-enumerated: every mutation is
// gated to the owner (user_id === actor). Blocks are the single source of truth
// for "this person is busy" and feed the meetings busy-view (shown as "Busy").
@Injectable()
export class TimeBlocksService {
  private readonly logger = new Logger(TimeBlocksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GcalApiService,
    private readonly accounts: GoogleAccountService,
  ) {}

  // The owner's blocks in a window (their calendar). Pulls fresh Google events
  // into blocks first (best-effort) so the view is the one true schedule.
  async listMine(orgId: string, userId: string, fromIso: string, toIso: string) {
    if (fromIso && toIso) await this.importFromGoogle(userId, fromIso, toIso).catch(swallow('time-blocks.listMine'));
    const where: any = { user_id: userId };
    if (fromIso && toIso) {
      where.end_at = { gt: new Date(fromIso) };
      where.start_at = { lt: new Date(toIso) };
    }
    return this.prisma.timeBlock.findMany({ where, orderBy: { start_at: 'asc' } });
  }

  async create(orgId: string, userId: string, dto: CreateTimeBlockDto) {
    const block = await this.prisma.timeBlock.create({
      data: {
        user_id: userId,
        organization_id: orgId,
        title: dto.title.trim(),
        note: dto.note ?? null,
        start_at: new Date(dto.start_at),
        end_at: new Date(dto.end_at),
        all_day: !!dto.all_day,
        source: 'native',
      },
    });
    await this.pushToGoogle(userId, block.id);
    return this.prisma.timeBlock.findUnique({ where: { id: block.id } });
  }

  async update(userId: string, id: string, dto: UpdateTimeBlockDto) {
    const existing = await this.owned(userId, id);
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.note !== undefined) data.note = dto.note ?? null;
    if (dto.start_at !== undefined) data.start_at = new Date(dto.start_at);
    if (dto.end_at !== undefined) data.end_at = new Date(dto.end_at);
    if (dto.all_day !== undefined) data.all_day = dto.all_day;
    await this.prisma.timeBlock.update({ where: { id }, data });
    // Push edits to Google for ANY block that has a Google event (native or
    // imported) — the user manages their whole calendar from here.
    await this.pushToGoogle(userId, id);
    return this.prisma.timeBlock.findUnique({ where: { id } });
  }

  async remove(userId: string, id: string) {
    const existing = await this.owned(userId, id);
    if (existing.google_event_id) {
      await this.deleteFromGoogle(userId, existing.google_event_id);
    }
    await this.prisma.timeBlock.delete({ where: { id } });
    return { success: true };
  }

  private async owned(userId: string, id: string) {
    const b = await this.prisma.timeBlock.findFirst({ where: { id, user_id: userId } });
    if (!b) throw new NotFoundException('Time-block not found');
    return b;
  }

  // Busy-view feed. Availability is universal (a block makes the person busy in
  // EVERY org), so match by user_id. Returns only times, never titles (privacy).
  async busyForUsers(userIds: string[], from: Date, to: Date) {
    if (!userIds.length) return [];
    return this.prisma.timeBlock.findMany({
      where: { user_id: { in: userIds }, end_at: { gt: from }, start_at: { lt: to } },
      select: { user_id: true, start_at: true, end_at: true },
    });
  }

  // Push a NATIVE block to the owner's Google Calendar (create or update).
  private async pushToGoogle(userId: string, blockId: string): Promise<void> {
    if (!this.api.isConfigured) return;
    try {
      const token = await this.accounts.getRefreshToken(userId);
      if (!token) return;
      const b = await this.prisma.timeBlock.findUnique({ where: { id: blockId } });
      if (!b) return;
      // Native blocks can be created in Google; imported ones can only be UPDATED
      // (they already exist there). Both flow their edits back to Google.
      if (b.source !== 'native' && !b.google_event_id) return;
      const payload = {
        title: b.title,
        description: b.note ?? null,
        location: null,
        start: b.start_at,
        end: b.end_at,
        attendeeEmails: [] as string[],
      };
      let res: { id: string; iCalUID: string };
      if (b.google_event_id) {
        try {
          res = await this.api.updateEvent(token, b.google_event_id, payload);
        } catch (err: any) {
          const status = err?.code ?? err?.response?.status;
          if ((status === 404 || status === 410) && b.source === 'native') res = await this.api.createEvent(token, payload);
          else throw err;
        }
      } else {
        res = await this.api.createEvent(token, payload);
      }
      await this.prisma.timeBlock.update({
        where: { id: blockId },
        data: { google_event_id: res.id, google_ical_uid: res.iCalUID || null },
      });
    } catch (err: any) {
      this.logger.warn(`pushToGoogle failed for block ${blockId}: ${err?.message ?? err}`);
    }
  }

  private async deleteFromGoogle(userId: string, googleEventId: string): Promise<void> {
    if (!this.api.isConfigured) return;
    try {
      const token = await this.accounts.getRefreshToken(userId);
      if (!token) return;
      await this.api.deleteEvent(token, googleEventId);
    } catch (err: any) {
      const status = err?.code ?? err?.response?.status;
      if (status === 404 || status === 410) return;
      this.logger.warn(`deleteFromGoogle failed for event ${googleEventId}: ${err?.message ?? err}`);
    }
  }

  // Pull the user's Google events into google-sourced blocks. Dedupes against
  // (a) v2e meetings already mirrored to Google and (b) our own native-block push
  // echoing back. Deletes google blocks Google no longer returns in the window.
  async importFromGoogle(userId: string, fromIso: string, toIso: string): Promise<void> {
    if (!this.api.isConfigured) return;
    const token = await this.accounts.getRefreshToken(userId);
    if (!token) return;

    let events;
    try {
      events = await this.api.listEvents(token, fromIso, toIso);
    } catch (err: any) {
      this.logger.warn(`importFromGoogle list failed for user ${userId}: ${err?.message ?? err}`);
      return;
    }

    const [meetings, rhythms, natives, existingGoogle] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { is_deleted: false, google_ical_uid: { not: null }, attendees: { some: { user_id: userId } } },
        select: { google_ical_uid: true, google_event_id: true },
      }),
      // Rhythm series (one recurring Google event) — its expanded instances must
      // not be re-imported as blocks.
      this.prisma.meetingRhythm.findMany({
        where: { google_ical_uid: { not: null } },
        select: { google_ical_uid: true, google_event_id: true },
      }),
      this.prisma.timeBlock.findMany({
        where: { user_id: userId, source: 'native', google_ical_uid: { not: null } },
        select: { google_ical_uid: true },
      }),
      this.prisma.timeBlock.findMany({
        where: { user_id: userId, source: 'google', end_at: { gt: new Date(fromIso) }, start_at: { lt: new Date(toIso) } },
        select: { id: true, google_event_id: true },
      }),
    ]);
    const meetingKeys = new Set(
      [...meetings, ...rhythms].flatMap((m) => [m.google_ical_uid, m.google_event_id]).filter((v): v is string => !!v),
    );
    const nativeKeys = new Set(natives.map((n) => n.google_ical_uid).filter((v): v is string => !!v));
    const byEventId = new Map(existingGoogle.map((b) => [b.google_event_id, b] as const));

    const seen = new Set<string>();
    for (const e of events) {
      if (meetingKeys.has(e.iCalUID) || meetingKeys.has(e.googleEventId)) continue;
      if (nativeKeys.has(e.iCalUID)) continue;
      seen.add(e.googleEventId);
      const start = e.allDay ? new Date(e.start.slice(0, 10) + 'T00:00:00') : new Date(e.start);
      const end = e.allDay ? new Date(e.end.slice(0, 10) + 'T00:00:00') : new Date(e.end);
      const found = byEventId.get(e.googleEventId);
      if (found) {
        await this.prisma.timeBlock.update({
          where: { id: found.id },
          data: { title: e.title, note: e.description ?? null, start_at: start, end_at: end, all_day: e.allDay, google_ical_uid: e.iCalUID || null },
        });
      } else {
        await this.prisma.timeBlock.create({
          data: {
            user_id: userId,
            organization_id: null,
            title: e.title,
            note: e.description ?? null,
            start_at: start,
            end_at: end,
            all_day: e.allDay,
            source: 'google',
            google_event_id: e.googleEventId,
            google_ical_uid: e.iCalUID || null,
          },
        });
      }
    }

    if (events.length < 250) {
      for (const b of existingGoogle) {
        if (b.google_event_id && !seen.has(b.google_event_id)) {
          await this.prisma.timeBlock.delete({ where: { id: b.id } }).catch(swallow('time-blocks.importFromGoogle'));
        }
      }
    }
  }

  // Keep every connected user's blocks reasonably fresh for OTHER people's
  // busy-view. Bounded forward window; no-op when Google isn't configured.
  @Cron('0 */15 * * * *')
  async syncAllConnectedUsers(): Promise<void> {
    if (!this.api.isConfigured) return;
    const users = await this.prisma.user.findMany({
      where: { google_refresh_token: { not: null } },
      select: { id: true },
    });
    if (!users.length) return;
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 21 * 86_400_000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    for (const u of users) {
      await this.importFromGoogle(u.id, fromIso, toIso).catch(swallow('time-blocks.syncAllConnectedUsers'));
    }
  }
}
