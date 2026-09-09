// ─── Goals domain types (mirror backend Prisma enums) ─────────────────────────
//
// One flat entity. A goal has an owner, a deadline, an optional target number,
// links to other goals, and a check-in history. Nothing is computed — every
// number is typed in by a person at a check-in, so there is no progress
// percentage anywhere in this module.

export type GoalStatus =
  | 'not_started'
  | 'in_progress'
  | 'on_track'
  | 'at_risk'
  | 'off_track'
  | 'on_hold'
  | 'achieved'
  | 'closed'

/** Every status, in the order they read as a life-cycle. */
export const ALL_STATUSES: GoalStatus[] = [
  'not_started',
  'in_progress',
  'on_track',
  'at_risk',
  'off_track',
  'on_hold',
  'achieved',
  'closed',
]
export type GoalCadence = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'

/** Which part of the business a goal moves — the four Balanced-Scorecard views. */
export type GoalFocusArea = 'customer' | 'finance' | 'learning_growth' | 'internal_process'

/** The only three statuses a check-in may record. */
export type CheckInStatus = Extract<GoalStatus, 'on_track' | 'at_risk' | 'off_track'>
export const CHECK_IN_STATUSES: CheckInStatus[] = ['on_track', 'at_risk', 'off_track']

/** A goal with no cadence is flagged stale past this many quiet days. */
export const GOAL_STALE_DAYS = 30

export interface GoalOwnerLite {
  id: string
  name: string
  email?: string
}

export interface GoalCheckIn {
  id: string
  goal_id: string
  check_in_date: string
  status: GoalStatus
  recorded_value: number | null
  /** The target as it stood that day — so raising it later never skews history. */
  target_value_at_check_in: number | null
  status_note?: string | null
  created_by_user_id: string
  created_at: string
  created_by?: { id: string; name: string }
  is_voided: boolean
  voided_at?: string | null
  voided_by_user_id?: string | null
  void_reason?: string | null
}

/** The other goal in a link, as returned on the detail endpoint. */
export interface LinkedGoalLite {
  id: string
  title: string
  status: GoalStatus
  due_date: string
  target_value: number | null
  current_value: number | null
  unit?: string | null
  owner?: { id: string; name: string }
  /** How far the chain continues past this neighbour, so the UI can say "+N behind this". */
  _count?: { supported_by: number; supports: number }
}

export interface GoalLink {
  link_id: string
  /** Why this link exists — the strategic assumption, recorded so it can be revisited. */
  note?: string | null
  goal: LinkedGoalLite
  /** True when this pair's deadlines don't make sense. Warns, never blocks. */
  deadline_warning: boolean
}

export interface Goal {
  id: string
  organization_id: string
  title: string
  description: string | null
  owner_user_id: string
  department_id: string | null
  focus_area: GoalFocusArea | null
  due_date: string
  target_value: number | null
  current_value: number | null
  unit: string | null
  status: GoalStatus
  review_cadence: GoalCadence
  next_review_date: string | null
  last_check_in_at: string | null
  created_at: string
  updated_at: string
  owner?: GoalOwnerLite
  department?: { id: string; name: string } | null

  // ─── List / detail extras (server-computed against the org's clock) ─────────
  days_left?: number
  task_counts?: { open: number; closed: number }
  supports_count?: number
  supported_by_count?: number

  // ─── Detail only ───────────────────────────────────────────────────────────
  check_ins?: GoalCheckIn[]
  /** Goals that support this one. */
  supported_by?: GoalLink[]
  /** Goals this one supports. */
  supports?: GoalLink[]
  tasks?: any[]
  /** Linked projects the viewer may open. */
  projects?: LinkedProject[]
  /** Linked projects withheld because the viewer isn't on them. */
  hidden_project_count?: number
  /**
   * Whether the Projects section applies to this viewer at all — false when the
   * org isn't licensed for Projects OR this person has no Projects permission.
   * The server decides both, so the UI has one flag and can't drift.
   */
  projects_visible?: boolean
}

/**
 * A project linked to a goal, as returned on the goal detail endpoint.
 * Unlike goals, projects carry row-level scope + membership, so the server only
 * returns the ones this viewer can actually open (see `hidden_project_count`).
 */
export interface LinkedProject {
  id: string
  name: string
  status: string
  start_date: string | null
  end_date: string | null
  completion_percentage: number
  total_tasks: number
  completed_tasks: number
  project_manager_user_id: string
}

/** A row on "My check-ins" — a goal plus why it's being chased. */
export interface GoalCheckInDue extends Goal {
  due_reason: string
  days_overdue: number | null
}

export interface GoalDashboard {
  as_on: string
  total: number
  counts: Record<GoalStatus, number>
  at_risk: Goal[]
  overdue: (Goal & { days_late: number })[]
  needs_check_in: (Goal & { due_reason: string })[]
}

export interface GoalDeleteImpact {
  supports_count: number
  supported_by_count: number
  open_task_count: number
  check_in_count: number
  project_count: number
}

/** A project that may be attached to a goal. */
export interface GoalCandidateProject {
  id: string
  name: string
  status: string
  end_date: string | null
}

export interface GoalCandidate {
  id: string
  title: string
  due_date: string
  status: GoalStatus
  unit?: string | null
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateGoalInput {
  title: string
  description?: string
  owner_user_id: string
  department_id?: string
  focus_area?: GoalFocusArea
  due_date: string
  target_value?: number
  current_value?: number
  unit?: string
  status?: GoalStatus
  review_cadence?: GoalCadence
  /** When the first check-in falls due. Ignored when the cadence is none. */
  first_check_in_date?: string
}

export interface UpdateGoalInput {
  title?: string
  description?: string
  owner_user_id?: string
  department_id?: string | null
  focus_area?: GoalFocusArea | null
  due_date?: string
  target_value?: number | null
  unit?: string | null
  status?: GoalStatus
  review_cadence?: GoalCadence
  /** Pins the next check-in date explicitly instead of re-anchoring it. */
  next_review_date?: string | null
}

export interface CreateCheckInInput {
  check_in_date: string
  status: CheckInStatus
  recorded_value?: number | null
  status_note?: string
}

export interface CreateLinkInput {
  supporting_goal_id: string
  note?: string
}

// ─── Labels & palette (driven by DESIGN_RULES status/badge colors) ─────────────

export const STATUS_META: Record<
  GoalStatus,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  not_started: { label: 'Not started', bg: '#F1F5F9', text: '#475569', border: '#E2E8F0', dot: '#94A3B8' },
  in_progress: { label: 'In progress', bg: '#DBEAFE', text: '#1D4ED8', border: '#BFDBFE', dot: '#2563EB' },
  on_track: { label: 'On track', bg: '#DCFCE7', text: '#16A34A', border: '#BBF7D0', dot: '#16A34A' },
  at_risk: { label: 'At risk', bg: '#FEF9C3', text: '#CA8A04', border: '#FDE68A', dot: '#D97706' },
  off_track: { label: 'Off track', bg: '#FEE2E2', text: '#DC2626', border: '#FECACA', dot: '#DC2626' },
  on_hold: { label: 'On hold', bg: '#EDE9FE', text: '#6D28D9', border: '#DDD6FE', dot: '#7C3AED' },
  achieved: { label: 'Achieved', bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD', dot: '#0891B2' },
  closed: { label: 'Closed', bg: '#F1F5F9', text: '#475569', border: '#E2E8F0', dot: '#64748B' },
}

/**
 * The four focus areas. Colours are the old Balanced-Scorecard palette, which
 * was already tuned to DESIGN_RULES — one hue per area so a goal's area reads
 * at a glance without needing the label.
 */
export const FOCUS_AREA_META: Record<
  GoalFocusArea,
  { label: string; short: string; bg: string; text: string; border: string; dot: string }
> = {
  customer: {
    label: 'Customer',
    short: 'Customer',
    bg: '#E0F2FE',
    text: '#0369A1',
    border: '#BAE6FD',
    dot: '#0891B2',
  },
  finance: {
    label: 'Finance',
    short: 'Finance',
    bg: '#DCFCE7',
    text: '#16A34A',
    border: '#BBF7D0',
    dot: '#16A34A',
  },
  // `short` keeps the goals table narrow. Real words, not initialisms — "People"
  // and "Process" stay readable where "L&G" and "IP" would need decoding.
  learning_growth: {
    label: 'Learning & Growth',
    short: 'People',
    bg: '#FEF9C3',
    text: '#CA8A04',
    border: '#FDE68A',
    dot: '#D97706',
  },
  internal_process: {
    label: 'Internal Process',
    short: 'Process',
    bg: '#EDE9FE',
    text: '#6D28D9',
    border: '#DDD6FE',
    dot: '#7C3AED',
  },
}

/** Display order — money, then who pays it, then how, then who does it. */
export const FOCUS_AREA_OPTIONS: GoalFocusArea[] = [
  'finance',
  'customer',
  'internal_process',
  'learning_growth',
]

/** Statuses a person sets by hand on the goal (the rest come from check-ins). */
export const MANUAL_STATUSES: GoalStatus[] = [
  'not_started',
  'in_progress',
  'on_hold',
  'achieved',
  'closed',
]

export const CADENCE_META: Record<GoalCadence, { label: string; short: string }> = {
  none: { label: 'No set rhythm', short: 'Ad-hoc' },
  weekly: { label: 'Weekly', short: 'Weekly' },
  biweekly: { label: 'Every 2 weeks', short: 'Biweekly' },
  monthly: { label: 'Monthly', short: 'Monthly' },
  quarterly: { label: 'Quarterly', short: 'Quarterly' },
}

export const CADENCE_OPTIONS: GoalCadence[] = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly']

/** Formats a goal's number for display: "31 / 50 Cr", "6 / 9 dealers", "—". */
export function formatValue(value: number | null, unit?: string | null): string {
  if (value === null || value === undefined) return '—'
  const n = value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return unit ? `${n} ${unit}` : n
}

// ─── Access Rights & Audit (shared types that happen to live here) ────────────

export interface ResourcePermission {
  resource: string
  label: string
  description: string
  can_read: boolean
  can_write: boolean
  can_edit: boolean
  can_delete: boolean
}

export interface AccessMatrix {
  resources: Array<{ key: string; label: string; description: string }>
  roles: string[]
  matrix: Array<{ role: string; resources: ResourcePermission[] }>
  admin: { role: string; locked: boolean; note: string }
}

export interface MyPermissions {
  resources: Record<string, { read: boolean; write: boolean; edit: boolean; delete: boolean }>
  can_manage_access_rights: boolean
}

// AuditEntry / AuditListResponse moved to '@/lib/types/audit'.
export type { AuditEntry, AuditListResponse } from './audit'
