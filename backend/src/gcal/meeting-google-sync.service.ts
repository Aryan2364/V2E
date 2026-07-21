import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GcalApiService, ExternalGEvent, PushableMeeting } from './gcal-api.service';
import { GoogleAccountService } from './google-account.service';

// Bridges the Meetings module to Google Calendar. Every method is FAIL-SOFT:
// a Google outage, an expired grant, or a revoked token must never block or
// undo a meeting operation — the meeting is the source of truth, the calendar
// mirror is best-effort. Callers may `await` these freely.
@Injectable()
export class MeetingGoogleSyncService {
  private readonly logger = new Logger(MeetingGoogleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GcalApiService,
    private readonly accounts: GoogleAccountService,
  ) {}

  // Create or update the organiser's mirror for a meeting. Called after a meeting
  // is created or edited. Reads the meeting fresh (with organiser + attendee
  // emails) so callers needn't assemble the payload.
  async syncUpsert(orgId: string, meetingId: string): Promise<void> {
    if (!this.api.isConfigured) return;
    try {
      const meeting = await this.prisma.meeting.findFirst({
        where: { id: meetingId, organization_id: orgId },
        include: {
          organizer: { select: { id: true, email: true } },
          attendees: { include: { user: { select: { email: true } } } },
        },
      });
      if (!meeting) return;

      // Not mirror-able (cancelled / deleted / no fixed time): tear down any
      // existing mirror so a cancelled meeting doesn't linger on the calendar.
      if (
        meeting.is_deleted ||
        meeting.status === 'cancelled' ||
        !meeting.scheduled_start ||
        !meeting.scheduled_end
      ) {
        if (meeting.google_event_id) {
          await this.syncDelete(meeting.created_by_user_id, meeting.google_event_id);
          await this.clearMirror(meetingId);
        }
        return;
      }

      const token = await this.accounts.getRefreshToken(meeting.created_by_user_id);
      if (!token) return; // organiser hasn't connected Google — nothing to mirror

      const attendeeEmails = meeting.attendees
        .filter((a) => a.response !== 'declined')
        .map((a) => a.user.email)
        .filter((email): email is string => !!email && email !== meeting.organizer.email);

      const payload: PushableMeeting = {
        title: meeting.title,
        description: meeting.agenda ?? null,
        location: meeting.location || meeting.online_link || null,
        start: meeting.scheduled_start,
        end: meeting.scheduled_end,
        attendeeEmails,
      };

      let res: { id: string; iCalUID: string };
      if (meeting.google_event_id) {
        try {
          res = await this.api.updateEvent(token, meeting.google_event_id, payload);
        } catch (err: any) {
          // Mirror was deleted on Google's side → recreate rather than fail.
          const status = err?.code ?? err?.response?.status;
          if (status === 404 || status === 410) {
            res = await this.api.createEvent(token, payload);
          } else {
            throw err;
          }
        }
      } else {
        res = await this.api.createEvent(token, payload);
      }

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { google_event_id: res.id, google_ical_uid: res.iCalUID || null },
      });
    } catch (err: any) {
      this.logger.warn(`syncUpsert failed for meeting ${meetingId}: ${err?.message ?? err}`);
    }
  }

  // Delete the organiser's mirror. Called on meeting cancel/delete. Takes the ids
  // directly because the meeting row may already be soft-deleted by the caller.
  async syncDelete(organizerId: string, googleEventId: string | null): Promise<void> {
    if (!this.api.isConfigured || !googleEventId) return;
    try {
      const token = await this.accounts.getRefreshToken(organizerId);
      if (!token) return;
      await this.api.deleteEvent(token, googleEventId);
    } catch (err: any) {
      const status = err?.code ?? err?.response?.status;
      // Already gone on Google's side is a success for our purposes.
      if (status === 404 || status === 410) return;
      this.logger.warn(`syncDelete failed for event ${googleEventId}: ${err?.message ?? err}`);
    }
  }

  private async clearMirror(meetingId: string): Promise<void> {
    await this.prisma.meeting
      .update({ where: { id: meetingId }, data: { google_event_id: null, google_ical_uid: null } })
      .catch(() => undefined);
  }

  // Reverse view: the user's OTHER Google commitments in a window, so they see
  // conflicts alongside v2e meetings. Deduped against meetings already mirrored
  // to this user (by iCalUID / event id) so a synced meeting never shows twice.
  async listExternalForUser(
    orgId: string,
    userId: string,
    fromIso: string,
    toIso: string,
  ): Promise<{ connected: boolean; configured: boolean; events: ExternalGEvent[] }> {
    if (!this.api.isConfigured) return { connected: false, configured: false, events: [] };
    const token = await this.accounts.getRefreshToken(userId);
    if (!token) return { connected: false, configured: true, events: [] };

    let events: ExternalGEvent[];
    try {
      events = await this.api.listEvents(token, fromIso, toIso);
    } catch (err: any) {
      this.logger.warn(`listExternalForUser failed for user ${userId}: ${err?.message ?? err}`);
      return { connected: true, configured: true, events: [] };
    }

    const mirrored = await this.prisma.meeting.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        google_ical_uid: { not: null },
        attendees: { some: { user_id: userId } },
      },
      select: { google_ical_uid: true, google_event_id: true },
    });
    const known = new Set(
      mirrored.flatMap((m) => [m.google_ical_uid, m.google_event_id]).filter((v): v is string => !!v),
    );

    const external = events.filter(
      (e) => !known.has(e.iCalUID) && !known.has(e.googleEventId),
    );
    return { connected: true, configured: true, events: external };
  }
}
