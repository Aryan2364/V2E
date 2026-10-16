export type MeetingType = 'online' | 'offline' | 'hybrid'
export type MeetingStatus = 'scheduled' | 'in_progress' | 'closed' | 'cancelled'
export type MeetingLinkType = 'goal' | 'project' | 'task' | 'ticket'
// Opt-out attendance: everyone is attending by default; declining (with a reason)
// is the only opt-out. No pending, no accept.
export type MeetingAttendeeResponse = 'attending' | 'declined'
export type RecurringScheduleType = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurringEndCondition = 'never' | 'on_date' | 'after_n'

export interface UserLite {
  id: string
  name: string
  email?: string
}

export interface MeetingAttendee {
  id: string
  meeting_id: string
  user_id: string
  is_organizer: boolean
  is_required: boolean
  response: MeetingAttendeeResponse
  reject_reason: string | null
  attended: boolean
  attended_in_at: string | null
  attended_out_at: string | null
  user?: UserLite
}

export interface MeetingActionItem {
  id: string
  meeting_id: string
  text: string
  owner_user_id: string | null
  due_date: string | null
  linked_task_id: string | null
  is_done: boolean
}

export interface MeetingDecision {
  id: string
  meeting_id: string
  decision: string
  owner_user_id: string | null
  decided_on: string
  reason: string | null
  affects_link_type: MeetingLinkType | null
  affects_entity_id: string | null
  meeting?: { id: string; title: string }
}

export interface MeetingConflict {
  user_id: string
  meeting_id: string
  title: string
  scheduled_start: string | null
}

export interface Meeting {
  id: string
  organization_id: string
  title: string
  type: MeetingType
  online_link: string | null
  online_password: string | null
  location: string | null
  status: MeetingStatus
  link_type: MeetingLinkType | null
  link_entity_id: string | null
  agenda: string | null
  minutes: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  actual_start: string | null
  actual_end: string | null
  attendance_taken_at: string | null
  rhythm_id: string | null
  rhythm_spawn_date: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
  organizer?: UserLite
  attendees?: MeetingAttendee[]
  action_items?: MeetingActionItem[]
  decisions?: MeetingDecision[]
  _count?: { attendees?: number; action_items?: number; decisions?: number }
  // detail-only
  my_note?: string
  conflicts?: MeetingConflict[]
  can_manage?: boolean
}

export interface MeetingAnalytics {
  planned_minutes: number | null
  actual_minutes: number | null
  overrun_minutes: number | null
  attendance: {
    roster: number
    expected: number
    declined: number
    declined_required: number
    attended: number
    late: number
    no_show: number | null // null = attendance not recorded (never fabricated)
    attendance_recorded: boolean
  }
  action_items: { created: number; linked: number; done: number }
  decisions: number
  linkage: string
  started_on_time: boolean | null
}

export interface MeetingReportPerson {
  user_id: string
  name: string
  expected: number
  attended: number
  declined: number
  declined_required: number
  no_show: number
}

export interface MeetingReport {
  activity: {
    meetings_count: number
    total_hours: number
    avg_duration_min: number
    avg_overrun_min: number
    load_per_person: { user_id: string; meetings: number }[]
  }
  attendance: {
    attendance_rate: number
    no_show_rate: number
    declined_rate: number
    declined_required: number
    started_on_time_rate: number
    unrecorded_meetings: number
  }
  output: {
    decisions_total: number
    decisions_per_meeting: number
    zero_decision_meetings: number
    action_items_created: number
    pct_linked_to_tasks: number
    pct_linked_tasks_completed: number
  }
  linkage: {
    hours_by_type: { type: string; hours: number }[]
    goal_attention: { goal_id: string; meetings: number; hours: number }[]
  }
  by_person: MeetingReportPerson[]
}

// ─── Rhythms (recurring meetings) ──────────────────────────────────────────────
export interface RhythmSchedule {
  id: string
  schedule_type: RecurringScheduleType
  every: number
  days: number[]
  month_days: number[]
  yearly_dates: { month: number; day: number }[]
  time: string
  start_date: string
  end_condition: RecurringEndCondition
  end_date: string | null
  end_after: number | null
  occurrence_count: number
  is_active: boolean
}

export interface MeetingRhythm {
  id: string
  organization_id: string
  title: string
  type: MeetingType
  online_link: string | null
  online_password: string | null
  location: string | null
  link_type: MeetingLinkType | null
  link_entity_id: string | null
  agenda: string | null
  duration_min: number
  attendee_user_ids: string[]
  optional_user_ids: string[]
  is_active: boolean
  created_by_user_id: string
  created_at: string
  schedule_entries?: RhythmSchedule[]
  created_by_name?: string
  occurrences?: number
  next_run?: string | null
  can_manage?: boolean
}

// ─── Busy view ─────────────────────────────────────────────────────────────────
export interface BusyBlock {
  start: string
  end: string
  kind: 'meeting' | 'leave' | 'holiday' | 'block'
  label: string
}
export interface BusyPerson {
  user_id: string
  name: string
  required: boolean
  busy: BusyBlock[]
}
export interface BusySuggestion {
  start: string
  end: string
  hard_conflicts: string[]
  soft_conflicts: string[]
}
export interface BusyView {
  from: string
  to: string
  people: BusyPerson[]
  suggestions: BusySuggestion[]
  caveat: string
}

// ─── Labels & palette (DESIGN_RULES badge colors) ──────────────────────────────
export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; bg: string; text: string; border: string }> = {
  scheduled: { label: 'Scheduled', bg: 'var(--surface-control)', text: 'var(--text-secondary)', border: 'var(--border-light)' },
  in_progress: { label: 'In progress', bg: 'var(--primary-subtle)', text: 'var(--primary-text)', border: 'var(--primary-border)' },
  closed: { label: 'Closed', bg: 'var(--success-bg)', text: 'var(--success)', border: 'var(--success-border)' },
  cancelled: { label: 'Cancelled', bg: 'var(--danger-bg)', text: 'var(--danger)', border: 'var(--danger-border)' },
}

export const RESPONSE_META: Record<MeetingAttendeeResponse, { label: string; bg: string; text: string }> = {
  attending: { label: 'Attending', bg: 'var(--success-bg)', text: 'var(--success)' },
  declined: { label: "Won't make it", bg: 'var(--danger-bg)', text: 'var(--danger)' },
}

export const TYPE_LABEL: Record<MeetingType, string> = { online: 'Online', offline: 'Offline', hybrid: 'Hybrid' }
export const LINK_TYPE_LABEL: Record<MeetingLinkType, string> = { goal: 'Goal', project: 'Project', task: 'Task', ticket: 'Ticket' }
