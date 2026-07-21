import apiClient from './client'
import type {
  Meeting,
  MeetingAnalytics,
  MeetingDecision,
  MeetingReport,
  MeetingType,
  MeetingLinkType,
  MeetingRhythm,
  BusyView,
  RecurringScheduleType,
  RecurringEndCondition,
} from '@/lib/types/meetings'

const base = (orgId: string) => `/api/v1/org/${orgId}/meetings`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

function qs(filters?: Record<string, string | undefined>): string {
  if (!filters) return ''
  const p = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface CreateMeetingInput {
  title: string
  type: MeetingType
  online_link?: string
  online_password?: string
  location?: string
  link_type?: MeetingLinkType
  link_entity_id?: string
  attendee_user_ids?: string[]
  optional_user_ids?: string[]
  agenda?: string
  minutes?: string
  scheduled_start?: string
  scheduled_end?: string
  log_past?: boolean
  actual_start?: string
  actual_end?: string
}

export interface RhythmScheduleInput {
  schedule_type: RecurringScheduleType
  every?: number
  days?: number[]
  month_days?: number[]
  yearly_dates?: { month: number; day: number }[]
  time: string
  start_date: string
  end_condition?: RecurringEndCondition
  end_date?: string
  end_after?: number
}

export interface CreateRhythmInput {
  title: string
  type: MeetingType
  online_link?: string
  online_password?: string
  location?: string
  link_type?: MeetingLinkType
  link_entity_id?: string
  agenda?: string
  duration_min: number
  attendee_user_ids?: string[]
  optional_user_ids?: string[]
  schedule: RhythmScheduleInput
}

export interface BusyInput {
  user_ids: string[]
  required_user_ids?: string[]
  from: string
  to: string
  duration_min?: number
}

// A read-only Google Calendar event for the reverse view (the user's own
// external commitments). Times are absolute instants (or YYYY-MM-DD if all-day).
export interface ExternalGEvent {
  googleEventId: string
  iCalUID: string
  title: string
  description: string | null
  location: string | null
  start: string
  end: string
  allDay: boolean
  htmlLink: string | null
}

export interface GoogleSyncStatus {
  connected: boolean
  configured: boolean
}

export const meetingsApi = {
  list: async (orgId: string, filters?: Record<string, string | undefined>): Promise<Meeting[]> =>
    unwrap(await apiClient.get(`${base(orgId)}${qs(filters)}`)),

  get: async (orgId: string, id: string): Promise<Meeting> =>
    unwrap(await apiClient.get(`${base(orgId)}/${id}`)),

  create: async (orgId: string, dto: CreateMeetingInput): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}`, dto)),

  update: async (orgId: string, id: string, dto: Partial<CreateMeetingInput>): Promise<Meeting> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}`, dto)),

  remove: async (orgId: string, id: string, reason?: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${id}`, { data: { reason } })
  },

  updateRecord: async (orgId: string, id: string, dto: { agenda?: string; minutes?: string }): Promise<Meeting> =>
    unwrap(await apiClient.put(`${base(orgId)}/${id}/record`, dto)),

  // attendance response — opt-out: only decline / undo
  decline: async (orgId: string, id: string, reason: string): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/decline`, { reason })),
  undoDecline: async (orgId: string, id: string): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/undo-decline`)),

  // lifecycle
  start: async (orgId: string, id: string): Promise<Meeting> => unwrap(await apiClient.post(`${base(orgId)}/${id}/start`)),
  end: async (orgId: string, id: string): Promise<Meeting> => unwrap(await apiClient.post(`${base(orgId)}/${id}/end`)),
  close: async (orgId: string, id: string): Promise<Meeting> => unwrap(await apiClient.post(`${base(orgId)}/${id}/close`)),
  cancel: async (orgId: string, id: string, reason?: string): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/cancel`, { reason })),
  reopen: async (orgId: string, id: string): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/reopen`)),

  markAttendance: async (
    orgId: string,
    id: string,
    rows: { user_id: string; attended: boolean; attended_in_at?: string; attended_out_at?: string }[],
  ): Promise<Meeting> => unwrap(await apiClient.post(`${base(orgId)}/${id}/attendance`, { rows })),

  saveMyNote: async (orgId: string, id: string, body: string): Promise<void> => {
    await apiClient.put(`${base(orgId)}/${id}/my-note`, { body })
  },

  // busy view — floor, not a guarantee
  busy: async (orgId: string, dto: BusyInput): Promise<BusyView> =>
    unwrap(await apiClient.post(`${base(orgId)}/busy`, dto)),

  // action items
  addActionItem: async (orgId: string, id: string, dto: { text: string; owner_user_id?: string; due_date?: string }): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/action-items`, dto)),
  updateActionItem: async (orgId: string, id: string, itemId: string, dto: Record<string, unknown>): Promise<Meeting> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/action-items/${itemId}`, dto)),
  deleteActionItem: async (orgId: string, id: string, itemId: string): Promise<Meeting> =>
    unwrap(await apiClient.delete(`${base(orgId)}/${id}/action-items/${itemId}`)),
  linkTask: async (
    orgId: string,
    id: string,
    itemId: string,
    dto: { task_id?: string; create?: { title: string; assignee_user_ids: string[]; deadline?: string } },
  ): Promise<Meeting> => unwrap(await apiClient.post(`${base(orgId)}/${id}/action-items/${itemId}/link-task`, dto)),

  // decisions
  addDecision: async (orgId: string, id: string, dto: Record<string, unknown>): Promise<Meeting> =>
    unwrap(await apiClient.post(`${base(orgId)}/${id}/decisions`, dto)),
  updateDecision: async (orgId: string, id: string, decisionId: string, dto: Record<string, unknown>): Promise<Meeting> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/decisions/${decisionId}`, dto)),
  deleteDecision: async (orgId: string, id: string, decisionId: string): Promise<Meeting> =>
    unwrap(await apiClient.delete(`${base(orgId)}/${id}/decisions/${decisionId}`)),

  // reads
  analytics: async (orgId: string, id: string): Promise<MeetingAnalytics> =>
    unwrap(await apiClient.get(`${base(orgId)}/${id}/analytics`)),
  editLog: async (orgId: string, id: string): Promise<{ items: any[]; total: number }> =>
    unwrap(await apiClient.get(`${base(orgId)}/${id}/edit-log`)),
  report: async (orgId: string, filters?: Record<string, string | undefined>): Promise<MeetingReport> =>
    unwrap(await apiClient.get(`${base(orgId)}/reports${qs(filters)}`)),
  decisionLog: async (orgId: string, filters?: Record<string, string | undefined>): Promise<MeetingDecision[]> =>
    unwrap(await apiClient.get(`${base(orgId)}/decisions${qs(filters)}`)),

  // rhythms
  listRhythms: async (orgId: string, filters?: Record<string, string | undefined>): Promise<MeetingRhythm[]> =>
    unwrap(await apiClient.get(`${base(orgId)}/rhythms${qs(filters)}`)),
  getRhythm: async (orgId: string, id: string): Promise<MeetingRhythm> =>
    unwrap(await apiClient.get(`${base(orgId)}/rhythms/${id}`)),
  createRhythm: async (orgId: string, dto: CreateRhythmInput): Promise<MeetingRhythm> =>
    unwrap(await apiClient.post(`${base(orgId)}/rhythms`, dto)),
  updateRhythm: async (orgId: string, id: string, dto: Partial<CreateRhythmInput>): Promise<MeetingRhythm> =>
    unwrap(await apiClient.patch(`${base(orgId)}/rhythms/${id}`, dto)),
  pauseRhythm: async (orgId: string, id: string): Promise<MeetingRhythm> =>
    unwrap(await apiClient.post(`${base(orgId)}/rhythms/${id}/pause`)),
  resumeRhythm: async (orgId: string, id: string): Promise<MeetingRhythm> =>
    unwrap(await apiClient.post(`${base(orgId)}/rhythms/${id}/resume`)),
  removeRhythm: async (orgId: string, id: string, mode: 'stop' | 'delete-future' = 'stop'): Promise<{ message: string }> =>
    unwrap(await apiClient.delete(`${base(orgId)}/rhythms/${id}?mode=${mode}`)),

  // ─── Google Calendar sync (per-user, own calendar) ──────────────────────────
  // Connection is user-level (under /auth); the reverse event feed is org-scoped.
  googleStatus: async (): Promise<GoogleSyncStatus> =>
    unwrap(await apiClient.get(`/api/v1/auth/google/status`)),
  googleAuthUrl: async (): Promise<{ url: string }> =>
    unwrap(await apiClient.get(`/api/v1/auth/google/url`)),
  googleDisconnect: async (): Promise<{ success: boolean }> =>
    unwrap(await apiClient.delete(`/api/v1/auth/google`)),
  googleEvents: async (
    orgId: string,
    from: string,
    to: string,
  ): Promise<{ connected: boolean; configured: boolean; events: ExternalGEvent[] }> =>
    unwrap(
      await apiClient.get(
        `${base(orgId)}/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    ),
}
