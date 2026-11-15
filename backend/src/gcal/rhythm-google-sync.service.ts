import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GcalApiService, RecurringPayload } from './gcal-api.service';
import { GoogleAccountService } from './google-account.service';
import { buildRecurrence, type RhythmScheduleShape } from './rrule';
import { swallow } from '../common/swallow';

function pad(n: number): string { return String(n).padStart(2, '0'); }

// Add minutes to a wall-clock "YYYY-MM-DDTHH:MM:00" using the fixed +05:30 offset
// (India, no DST) so it's independent of the server timezone.
function addMinutesToWall(wall: string, minutes: number): string {
  const base = new Date(`${wall}+05:30`);
  const ist = new Date(base.getTime() + minutes * 60_000 + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:00`;
}

// Mirrors a meeting-rhythm to ONE recurring Google event (Zoom-style). The rhythm
// owns the series: create → one recurring event; edit → update it (Google applies
// to all occurrences); delete/stop → delete it (removes all occurrences). Individual
// spawned instances are NOT mirrored separately. Fail-soft throughout.
@Injectable()
export class RhythmGoogleSyncService {
  private readonly logger = new Logger(RhythmGoogleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GcalApiService,
    private readonly accounts: GoogleAccountService,
  ) {}

  get isConfigured(): boolean { return this.api.isConfigured; }

  // Create or update the recurring event. `holidayDates` (YYYY-MM-DD) drive EXDATEs
  // when the rhythm skips holidays; the caller supplies them (it already has the
  // holidays service). A rhythm that is inactive / has no future occurrence has its
  // series torn down.
  async syncUpsert(orgId: string, rhythmId: string, holidayDates: string[]): Promise<void> {
    if (!this.api.isConfigured) return;
    try {
      const rhythm = await this.prisma.meetingRhythm.findFirst({
        where: { id: rhythmId, organization_id: orgId },
        include: { schedule_entries: true },
      });
      if (!rhythm) return;

      if (!rhythm.is_active) {
        if (rhythm.google_event_id) {
          await this.syncDelete(rhythm.created_by_user_id, rhythm.google_event_id);
          await this.clearMirror(rhythmId);
        }
        return;
      }

      const token = await this.accounts.getRefreshToken(rhythm.created_by_user_id);
      if (!token) return; // organiser not connected — nothing to mirror

      const entry = rhythm.schedule_entries[0];
      if (!entry) return;
      const schedule: RhythmScheduleShape = {
        schedule_type: entry.schedule_type as RhythmScheduleShape['schedule_type'],
        every: entry.every,
        days: (entry.days as number[]) ?? [],
        month_days: (entry.month_days as number[]) ?? [],
        yearly_dates: (entry.yearly_dates as { month: number; day: number }[]) ?? [],
        time: entry.time,
        start_date: entry.start_date,
        end_condition: entry.end_condition as RhythmScheduleShape['end_condition'],
        end_date: entry.end_date,
        end_after: entry.end_after,
        skip_holidays: (entry as any).skip_holidays ?? true,
      };

      const built = buildRecurrence(schedule, holidayDates);
      if (!built) return;
      const endWall = addMinutesToWall(built.startWall, rhythm.duration_min ?? 30);

      const attendeeIds = (rhythm.attendee_user_ids as string[]) ?? [];
      const [users, organizer] = await Promise.all([
        this.prisma.user.findMany({ where: { id: { in: attendeeIds } }, select: { email: true } }),
        this.prisma.user.findUnique({ where: { id: rhythm.created_by_user_id }, select: { email: true } }),
      ]);
      const attendeeEmails = users
        .map((u) => u.email)
        .filter((e): e is string => !!e && e !== organizer?.email);

      const payload: RecurringPayload = {
        title: rhythm.title,
        description: rhythm.agenda ?? null,
        location: rhythm.location || rhythm.online_link || null,
        startWall: built.startWall,
        endWall,
        timeZone: built.timeZone,
        attendeeEmails,
        recurrence: built.recurrence,
      };

      let res: { id: string; iCalUID: string };
      if (rhythm.google_event_id) {
        try {
          res = await this.api.updateRecurringEvent(token, rhythm.google_event_id, payload);
        } catch (err: any) {
          const status = err?.code ?? err?.response?.status;
          if (status === 404 || status === 410) res = await this.api.createRecurringEvent(token, payload);
          else throw err;
        }
      } else {
        res = await this.api.createRecurringEvent(token, payload);
      }

      await this.prisma.meetingRhythm.update({
        where: { id: rhythmId },
        data: { google_event_id: res.id, google_ical_uid: res.iCalUID || null },
      });
    } catch (err: any) {
      this.logger.warn(`syncUpsert failed for rhythm ${rhythmId}: ${err?.message ?? err}`);
    }
  }

  async syncDelete(organizerId: string, googleEventId: string | null): Promise<void> {
    if (!this.api.isConfigured || !googleEventId) return;
    try {
      const token = await this.accounts.getRefreshToken(organizerId);
      if (!token) return;
      await this.api.deleteEvent(token, googleEventId);
    } catch (err: any) {
      const status = err?.code ?? err?.response?.status;
      if (status === 404 || status === 410) return;
      this.logger.warn(`syncDelete failed for rhythm event ${googleEventId}: ${err?.message ?? err}`);
    }
  }

  private async clearMirror(rhythmId: string): Promise<void> {
    await this.prisma.meetingRhythm
      .update({ where: { id: rhythmId }, data: { google_event_id: null, google_ical_uid: null } })
      .catch(swallow('rhythm-google-sync.clearMirror'));
  }
}
