import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

// A Google event flattened to the shape the reverse view needs. Times are kept
// as absolute instants (ISO/UTC); the frontend renders them in the viewer's
// locale. iCalUID is the stable cross-calendar key we dedupe on.
export interface ExternalGEvent {
  googleEventId: string;
  iCalUID: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string; // RFC3339 instant, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  htmlLink: string | null;
}

export interface PushableMeeting {
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  attendeeEmails: string[];
}

// Thin, stateless wrapper over the Google Calendar API. Holds no per-user state:
// every call takes the user's refresh token and builds a fresh OAuth client.
@Injectable()
export class GcalApiService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';
    this.callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL') ?? '';
  }

  // Whether the server is configured to talk to Google at all. Lets every entry
  // point degrade to a clean "not configured" instead of throwing on missing env.
  get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.callbackUrl);
  }

  private makeClient(refreshToken?: string) {
    const client = new google.auth.OAuth2(this.clientId, this.clientSecret, this.callbackUrl);
    if (refreshToken) client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  // `state` is our signed anti-CSRF token (carries the userId) — see
  // GoogleAccountService. offline + consent guarantees a refresh_token is issued.
  getAuthUrl(state: string): string {
    return this.makeClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ refreshToken: string }> {
    const { tokens } = await this.makeClient().getToken(code);
    if (!tokens.refresh_token) {
      // Google only re-issues a refresh token with prompt=consent; we always ask
      // for it, so a missing one means the grant is unusable for offline sync.
      throw new Error('Google did not return a refresh token');
    }
    return { refreshToken: tokens.refresh_token };
  }

  private toRequestBody(m: PushableMeeting) {
    return {
      summary: m.title,
      description: m.description ?? undefined,
      location: m.location ?? undefined,
      start: { dateTime: m.start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: m.end.toISOString(), timeZone: 'UTC' },
      attendees: m.attendeeEmails.map((email) => ({ email })),
    };
  }

  // Create the mirror on the organiser's primary calendar. sendUpdates:'all' makes
  // Google email the real invitations to every attendee (works even for attendees
  // who never connect our app). Returns the ids we persist on the meeting.
  async createEvent(
    refreshToken: string,
    meeting: PushableMeeting,
  ): Promise<{ id: string; iCalUID: string }> {
    const calendar = google.calendar({ version: 'v3', auth: this.makeClient(refreshToken) });
    const res = await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      requestBody: this.toRequestBody(meeting),
    });
    return { id: res.data.id!, iCalUID: res.data.iCalUID ?? '' };
  }

  async updateEvent(
    refreshToken: string,
    googleEventId: string,
    meeting: PushableMeeting,
  ): Promise<{ id: string; iCalUID: string }> {
    const calendar = google.calendar({ version: 'v3', auth: this.makeClient(refreshToken) });
    const res = await calendar.events.update({
      calendarId: 'primary',
      eventId: googleEventId,
      sendUpdates: 'all',
      requestBody: this.toRequestBody(meeting),
    });
    return { id: res.data.id!, iCalUID: res.data.iCalUID ?? '' };
  }

  async deleteEvent(refreshToken: string, googleEventId: string): Promise<void> {
    const calendar = google.calendar({ version: 'v3', auth: this.makeClient(refreshToken) });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: googleEventId,
      sendUpdates: 'all',
    });
  }

  // Pull a bounded window from the user's primary calendar. singleEvents expands
  // recurrences into instances so a month stays small. Cancelled instances are
  // dropped. Used by the reverse view to show the user's other commitments.
  async listEvents(
    refreshToken: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ExternalGEvent[]> {
    const calendar = google.calendar({ version: 'v3', auth: this.makeClient(refreshToken) });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 250,
    });
    return (res.data.items ?? [])
      .filter((ev) => ev.status !== 'cancelled' && (ev.start?.dateTime || ev.start?.date))
      .map((ev) => {
        const allDay = !!ev.start?.date;
        return {
          googleEventId: ev.id ?? '',
          iCalUID: ev.iCalUID ?? '',
          title: ev.summary ?? '(no title)',
          description: ev.description ?? null,
          location: ev.location ?? null,
          start: (ev.start?.dateTime ?? ev.start?.date)!,
          end: (ev.end?.dateTime ?? ev.end?.date)!,
          allDay,
          htmlLink: ev.htmlLink ?? null,
        };
      });
  }
}
