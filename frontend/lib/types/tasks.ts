export type TaskQuadrant = 'Q1' | 'Q2' | 'Q3' | 'Q4'
export type TaskType = 'one_time' | 'recurring'
export type CompletionMode = 'all_must_complete' | 'any_can_complete'

// Who a reminder notifies (mirrors backend ReminderType).
export type ReminderRecipient = 'assignee' | 'assigner' | 'cc'

// A creator-set reminder sent with createTask/createRecurring.
// - relative: fires `offset_days` before the deadline at `time` (HH:mm). For a
//   one-time task the client precomputes `remind_at`; for a recurring template it
//   is omitted so each spawned instance recomputes it against its own deadline.
// - absolute: fires at the precomputed instant `remind_at`; `yearly` re-arms it.
export interface ReminderSpec {
  kind: 'relative' | 'absolute'
  offset_days?: number
  time?: string
  remind_at?: string
  yearly?: boolean
  recipients: ReminderRecipient[]
}

export interface TaskMasterConfig {
  id: string
  organization_id: string
  task_creation_roles: string[]
  task_edit_roles: string[]
  task_delete_roles: string[]
  default_reminder_days_before: number
  reopen_window_minutes: number
  escalation_levels: number
  archive_view_roles: string[]
  assignee_visibility_mode?: string
  assignee_custom_rules?: Record<string, unknown>
  assignee_visibility_config_roles?: string[]
}

export interface TaskCategory {
  id: string
  organization_id: string
  name: string
  description?: string
  color: string
  is_active: boolean
  created_at: string
}

// ─── Tags (TASK_TAGS_PLAN.md §10.1) ───────────────────────────────────────────

/**
 * Palette KEY, never a hex: the DB stores the key and globals.css owns the colours
 * (`--tag-<key>-*` tokens), so a re-theme changes every tag at once. Map a key to
 * its classes with `lib/tasks/tagColors.ts`.
 */
export type TagColor = 'slate' | 'ochre' | 'indigo' | 'rose' | 'teal' | 'green' | 'violet' | 'amber'

/** Every palette key, in swatch order. */
export const TAG_COLORS: TagColor[] = ['slate', 'ochre', 'indigo', 'rose', 'teal', 'green', 'violet', 'amber']

/** Most tags one task may carry (plan §8 Q4). The server enforces the same limit. */
export const MAX_TAGS_PER_TASK = 10

/** Light reference embedded in tasks and recurring templates. */
export interface TaskTagRef {
  id: string
  name: string
  color: TagColor
  is_active: boolean
}

/** Master row (GET masters/tags). */
export interface TaskTag extends TaskTagRef {
  organization_id: string
  description: string | null
  created_at: string
  updated_at: string
  /** Present ONLY when the caller holds tasks.config.tags.manage (any action) or is admin. */
  usage_count?: number
  /** Present ONLY when the caller holds tasks.config.tags.manage (any action) or is admin. */
  created_by?: { id: string; name: string } | null
}

/** POST masters/tags. When `color` is omitted the server picks the least-used palette colour. */
export interface CreateTagInput {
  name: string
  color?: TagColor
  description?: string | null
}

/** PATCH masters/tags/:id — a real partial; every field is optional. */
export interface UpdateTagInput {
  name?: string
  color?: TagColor
  description?: string | null
  is_active?: boolean
}

/** DELETE masters/tags/:id — a used tag is deactivated instead of deleted. */
export interface DeleteTagResult {
  result: 'deleted' | 'deactivated'
}

/** POST masters/tags/:id/merge. */
export interface MergeTagResult {
  moved: number
  into: TaskTag
}

export interface TaskPriority {
  id: string
  organization_id: string
  label: string
  color: string
  order_index: number
  is_active: boolean
}

// The fixed phase a status belongs to. `completed`, `partially_completed` and `incomplete`
// are all terminal (they close the task); only `completed` counts as a full success.
// `partially_completed` = an "all must complete" task where some finished and some couldn't.
export type TaskStatusPhase = 'not_started' | 'in_progress' | 'completed' | 'partially_completed' | 'incomplete'

export const TERMINAL_STATUS_PHASES: TaskStatusPhase[] = ['completed', 'partially_completed', 'incomplete']

export interface TaskStatus {
  id: string
  organization_id: string
  label: string
  type: TaskStatusPhase
  color: string
  order_index: number
  is_default: boolean
  is_active: boolean
}

export interface TaskAssigneeUser {
  id: string
  task_id: string
  user_id: string
  user_name?: string
  user_email?: string
  user?: { id: string; name: string; email: string; department?: string | null; role_title?: string | null }
  is_completed: boolean
  completed_at?: string
  is_cc: boolean
  /** Personal status track (all_must_complete mode); null in shared-status tasks. */
  status_id?: string | null
  status?: TaskStatus | null
  /** Deadline passed and this person hasn't finished their part. */
  is_overdue?: boolean
  /** all_must_complete: this person flagged their own part as can't-complete (with a reason). */
  cannot_complete?: boolean
  cannot_complete_reason?: string | null
  cannot_complete_at?: string | null
  /**
   * Set when this person was taken off the task. Present only on `removed_assignees`
   * — the live `assignees` list never contains a removed row.
   */
  removed_at?: string | null
  removed_by_user_id?: string | null
  removed_by?: { id: string; name: string; email?: string } | null
}

/** One recorded move of a task's deadline. Append-only; never edited or deleted. */
export interface TaskDeadlineRevision {
  id: string
  task_id: string
  /** Null only in the defensive case of a task that had no deadline. */
  from_deadline?: string | null
  /** Null when the deadline was cleared entirely. */
  to_deadline?: string | null
  /** Optional note the reviser gave. Not mandatory — see the DTO for why. */
  reason?: string | null
  changed_by_user_id: string
  changed_by?: { id: string; name: string; email?: string } | null
  changed_at: string
}

/** One person's state for a checklist item (all_must_complete mode). */
export interface TaskChecklistItemStateEntry {
  user_id: string
  user_name?: string | null
  state: 'done' | 'skipped'
  reason?: string | null
  /** Set by the assigner's "mark done for everyone". */
  is_override: boolean
  marked_by_user_id: string
  marked_by_name?: string | null
  marked_at?: string
}

export interface TaskChecklistItem {
  id: string
  task_id: string
  title: string
  /** Section label when a task carries multiple checklists; null/undefined = single ungrouped list. */
  group_title?: string | null
  /** Shared-mode tick only (any_can_complete / single). In all_must_complete, read the per-person `states`. */
  is_completed: boolean
  /** Shared-mode "can't do" — the item genuinely can't be done, with a reason. Fills the item so the task can close. */
  cant_do?: boolean
  cant_do_reason?: string | null
  /** Shared-mode attribution: who last ticked/flagged it. */
  completed_by_user_id?: string | null
  completed_by?: { id: string; name: string; email?: string } | null
  order_index: number
  // ── Per-person fields (all_must_complete), attached by the API ──
  /** Every assignee's state for this item (only those who have acted appear). */
  states?: TaskChecklistItemStateEntry[]
  /** How many assignees marked it done / skipped, and the roll-up denominator. */
  done_count?: number
  skipped_count?: number
  assignee_count?: number
  /** The current viewer's own state for this item, for quick rendering. */
  my_state?: 'done' | 'skipped' | null
  my_reason?: string | null
}

export interface Task {
  id: string
  organization_id: string
  title: string
  description?: string
  category_id?: string
  priority_id?: string
  status_id: string
  quadrant: TaskQuadrant
  type: TaskType
  created_by_user_id: string
  department_id?: string
  completion_mode: CompletionMode
  proof_required: boolean
  /** Allowed proof file extensions (lowercase, no dot). Empty/absent = anything allowed. */
  proof_allowed_extensions?: string[]
  /** Who must submit proof (non-CC assignees) vs who has — drives the "n/N submitted" scoreboard. */
  proof_summary?: {
    required_user_ids: string[]
    submitted_user_ids: string[]
    task_has_any_proof: boolean
  } | null
  is_deleted: boolean
  deadline?: string
  /**
   * The deadline this task was FIRST committed to, frozen at creation. Compliance
   * reporting grades on-time vs late against this, never the live `deadline`, so
   * revising a date cannot turn a late task on-time after the fact.
   */
  original_deadline?: string | null
  /** How many times the deadline has been revised away from `original_deadline`. */
  deadline_revision_count?: number
  /** The deadline paper trail, newest first (detail view only). */
  deadline_revisions?: TaskDeadlineRevision[]
  /** Quarterly goal this task is linked to as an initiative (null/absent = unlinked). */
  goal_id?: string | null
  recurring_template_id?: string
  workflow_instance_step_id?: string
  workflow_step?: {
    instance_id: string
    step_order: number
    template_name: string
    instance_name: string
    show_on_card: boolean
  }
  /**
   * Set on a task a workflow step created (batched by the server for lists and the
   * detail): shown as the workflow badge instead of "Self" / "by <assigner>".
   */
  workflow?: TaskWorkflowRef | null
  reopen_expires_at?: string
  is_overdue?: boolean
  /** Attribution for the shared-status flow (any_can_complete). */
  status_actor_user_id?: string | null
  completed_by_user_id?: string | null
  status_actor?: { id: string; name: string; email?: string } | null
  completed_by?: { id: string; name: string; email?: string } | null
  completed_at?: string | null
  completion_timing?: 'early' | 'on_time' | 'late' | 'partial' | 'incomplete' | null
  /** Reason the task was closed as Incomplete (terminal not-done). */
  incomplete_reason?: string | null
  created_at: string
  updated_at: string
  category?: TaskCategory
  /** Tags on this task, sorted by name. Inactive tags stay on the tasks that carry them. */
  tags?: TaskTagRef[]
  priority?: TaskPriority
  status?: TaskStatus
  assignees?: TaskAssigneeUser[]
  /**
   * People taken OFF this task. Removal is soft, so the record that someone held the
   * task survives for reporting — they're excluded from every count and gate, but
   * still shown in the task's history. Detail view only.
   */
  removed_assignees?: TaskAssigneeUser[]
  checklist?: TaskChecklistItem[]
  /** The user who created/assigned the task (resolved server-side). */
  created_by?: { id: string; name: string; email?: string } | null
  _count?: { comments: number; attachments: number }
  /** Comments the current viewer hasn't seen since last opening the task. */
  unread_comments?: number
}

/** POST / (create task) body. */
export interface CreateTaskInput {
  title: string
  description?: string
  quadrant?: string
  priority_id?: string
  category_id?: string
  status_id?: string
  deadline?: string
  completion_mode?: string
  proof_required?: boolean
  proof_allowed_extensions?: string[]
  assignee_user_ids?: string[]
  cc_user_ids?: string[]
  checklist_items?: { title: string; order_index: number; group_title?: string }[]
  checklist_template_id?: string
  checklist_template_ids?: string[]
  reminders?: ReminderSpec[]
  escalation_user_ids?: string[]
  goal_id?: string
  /** Up to MAX_TAGS_PER_TASK active tag ids. */
  tag_ids?: string[]
}

/**
 * PATCH /:id body. `tag_ids` is the full authoritative list, like `assignee_user_ids`:
 * omitted means unchanged and `[]` clears every tag. Send `[]` explicitly when the
 * user clears the field — never `tag_ids || undefined`.
 */
export type UpdateTaskInput = Partial<Task> & { tag_ids?: string[] }

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  user_name: string
  user_email: string
  body: string
  attachment_urls?: { name: string; url: string; type: string }[]
  /** Real uploaded documents attached to this comment (stored in R2). */
  attachments?: TaskAttachment[]
  reply_to_comment_id?: string
  is_deleted: boolean
  created_at: string
  replies?: TaskComment[]
}

export type ProofVisibility = 'private' | 'everyone'

/** A document attached to a task or a task comment, stored in object storage. */
export interface TaskAttachment {
  id: string
  task_id?: string
  comment_id?: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by_user_id?: string
  uploaded_by_name?: string | null
  /** True when this file is a proof of completion; visibility gates who may see it. */
  is_proof?: boolean
  proof_visibility?: ProofVisibility | null
  created_at: string
}

export interface RecurringInstanceAttachment extends TaskAttachment {
  task_title: string
  task_date: string
}


export interface TaskActivityLog {
  id: string
  task_id: string
  performed_by_user_id: string
  /** Enriched actor, resolved server-side (getActivityLog). Null if the user was removed. */
  performed_by?: { id: string; name: string; email: string } | null
  action: string
  metadata?: Record<string, unknown>
  created_at: string
}

export type RecurringScheduleType = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurringEndCondition = 'never' | 'on_date' | 'after_n'

export interface YearlyDate {
  month: number
  day: number
}

export interface RecurringScheduleEntry {
  id: string
  organization_id: string
  recurring_template_id: string
  schedule_type: RecurringScheduleType
  every: number
  days: number[]
  month_days: number[]
  yearly_dates: YearlyDate[]
  time: string
  start_date: string
  end_condition: RecurringEndCondition
  end_date?: string
  end_after?: number
  occurrence_count: number
  is_active: boolean
  order_index: number
  created_at: string
  updated_at: string
}

export interface RecurringTemplate {
  id: string
  organization_id: string
  title: string
  description?: string
  quadrant: TaskQuadrant
  category_id?: string
  priority_id?: string
  has_multiple_schedules: boolean
  is_active: boolean
  completion_mode: string
  proof_required: boolean
  /** Allowed proof file extensions (empty = any type) — copied to every instance. */
  proof_allowed_extensions?: string[]
  /** Ordered escalation contacts; level = position + 1 on every spawned instance. */
  escalation_user_ids?: string[]
  /** Quarterly goal every spawned instance is linked to (initiative). */
  linked_goal_id?: string | null
  assignee_user_ids: string[]
  cc_user_ids: string[]
  /** Tags copied onto every future spawned instance (deactivated ones are skipped at spawn). */
  tag_ids?: string[]
  /** `tag_ids` resolved by the server, sorted by name; unknown ids are dropped. */
  tags?: TaskTagRef[]
  /** Flattened checklist definition copied into every spawned instance. */
  checklist_items?: { title: string; order_index: number; group_title?: string | null }[]
  /** Reminder specs re-resolved against each spawned instance's deadline. */
  reminder_specs?: ReminderSpec[]
  department_id?: string
  created_at: string
  created_by_user_id: string
  created_by_name?: string
  schedule_entries?: RecurringScheduleEntry[]
  // Enriched by the scoped list endpoint (present on list rows).
  assignee_names?: string[]
  cc_names?: string[]
  department_name?: string | null
  occurrences?: number
  next_run?: string | null
  /** Whether the current viewer may manage this template's sharing (creator or admin). */
  can_manage?: boolean
  /** Whether the current viewer may edit this template (creator, admin, or edit-share). Assignees cannot. */
  can_edit?: boolean
}

/** Mine/Team perspective: work SENT (outgoing) vs work RECEIVED (incoming). */
export type RecurringRelation = 'incoming' | 'outgoing' | 'all'

export interface RecurringListQuery {
  scope?: WorkScope
  relation?: RecurringRelation
  status?: 'active' | 'paused'
  category_id?: string
  priority_id?: string
  department_id?: string
  /** Templates carrying ANY of these tags. Sent as `tag_ids=a,b`. */
  tag_ids?: string[] | string
  search?: string
}

export interface RecurringTemplateList {
  items: RecurringTemplate[]
  max_scope: WorkScope | null
  applied_scope: WorkScope | null
}

// ── Google-Drive-style template access ─────────────────────────────────────────
export type RecurringAccessLevel = 'view' | 'edit'

export interface RecurringAccessPerson {
  user_id: string
  name: string
  /** For rule-based viewers: how they got access. */
  source?: 'creator' | 'assignee' | 'cc'
  /** For shares: the granted level. */
  level?: RecurringAccessLevel
}

export interface RecurringAccessPanel {
  template_id: string
  title: string
  rule_viewers: RecurringAccessPerson[]
  shares: RecurringAccessPerson[]
  revokes: RecurringAccessPerson[]
}

/** One instance's timing verdict in the recurring performance report. */
export type RecurringInstanceTiming = 'early' | 'on_time' | 'late' | 'partial' | 'incomplete' | 'overdue' | 'pending'

// Timing-aware performance report for a recurring template (GET …/recurring/:id/stats).
export interface RecurringStats {
  template_id: string
  completion_mode: string
  total_instances: number
  completed: number
  pending: number
  missed: number
  overdue_open: number
  completion_ratio_percent: number
  /** Of the instances that have closed, % finished early or on time. */
  on_time_rate_percent: number
  current_streak: number
  best_streak: number
  timing: {
    early: number
    on_time: number
    late: number
    partial: number
    incomplete: number
    overdue: number
    pending: number
  }
  /** Last 10 instances, oldest first — drives the outcome strip. */
  recent: { task_id: string; date: string; timing: RecurringInstanceTiming }[]
  by_assignee: { user_id: string; name: string; assigned: number; done: number; late: number; missed: number }[]
  trend_monthly: { month: string; total: number; on_time: number; late: number; missed: number; open: number }[]
}

export interface TaskArchiveItem {
  id: string
  original_task_id: string
  task_snapshot: Task
  deleted_by_user_id: string
  deleted_by?: { id: string; name: string; email: string } | null
  deletion_reason?: string
  deleted_at: string
}

export type ChecklistAccessMode = 'everyone' | 'restricted'
export type ChecklistAccessKind = 'department' | 'role' | 'user' | 'exclude_user' | 'exclude_role'

export interface ChecklistAccessRule {
  id: string
  kind: ChecklistAccessKind
  department_id: string | null
  include_sub_departments: boolean
  role_id: string | null
  user_id: string | null
}

export interface ChecklistTemplate {
  id: string
  organization_id: string
  name: string
  items: { title: string; order_index: number }[]
  access_mode: ChecklistAccessMode
  access_rules: ChecklistAccessRule[]
  is_active: boolean
  created_at: string
}

export interface ChecklistAccessRuleInput {
  kind: ChecklistAccessKind
  department_id?: string
  include_sub_departments?: boolean
  role_id?: string
  user_id?: string
}

export interface ChecklistTemplateInput {
  name: string
  items: { title: string; order_index: number }[]
  access_mode?: ChecklistAccessMode
  access_rules?: ChecklistAccessRuleInput[]
  is_active?: boolean
}

// ─── Checklist bulk import ──────────────────────────────────────────────────────

export interface BulkImportChecklistRow {
  checklist_name?: string
  item?: string
}

export interface ChecklistImportRowIssue {
  field?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ChecklistImportRow {
  row: number
  checklist_name: string
  item: string
  status: 'ready' | 'error'
  issues: ChecklistImportRowIssue[]
}

export interface ChecklistImportGroup {
  name: string
  items: string[]
  already_exists: boolean
}

export interface ChecklistImportValidationResult {
  total: number
  ready: number
  errors: number
  warnings: number
  templates: number
  rows: ChecklistImportRow[]
  groups: ChecklistImportGroup[]
}

export interface ChecklistImportGroupResult {
  name: string
  item_count: number
  status: 'created' | 'failed'
  error?: string
}

export interface ChecklistImportResult {
  batch_id: string | null
  created: number
  failed: number
  results: ChecklistImportGroupResult[]
}

export interface ChecklistUndoKeptRow {
  name: string
  reason: string
}

export interface ChecklistUndoImportResult {
  batch_id: string
  undone: number
  kept: ChecklistUndoKeptRow[]
  status: 'committed' | 'undone' | 'partially_undone'
}

export interface ChecklistImportBatchSummary {
  id: string
  file_name: string | null
  imported_by: string
  total_rows: number
  created_count: number
  failed_count: number
  remaining: number
  status: 'committed' | 'undone' | 'partially_undone'
  can_undo: boolean
  created_at: string
  undone_at: string | null
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface UserPerformance {
  user_id: string
  user: { id: string; name: string; email: string } | null
  total: number
  completed: number
  overdue: number
}

export interface DeptPerformance {
  department_id: string
  department: { id: string; name: string } | null
  total: number
  completed: number
  overdue: number
}

export interface BreakdownItem {
  label: string
  color: string
  total: number
  completed: number
  overdue: number
}

export interface StatusBreakdown {
  label: string
  color: string
  total: number
}

export interface TaskReportData {
  total_tasks: number
  user_performance: UserPerformance[]
  department_performance: DeptPerformance[]
  priority_breakdown: BreakdownItem[]
  category_breakdown: BreakdownItem[]
  status_breakdown: StatusBreakdown[]
  frequency_breakdown: {
    recurring: { total: number; completed: number }
    one_time: { total: number; completed: number }
  }
}

// ─── Work Dashboard (scope-aware canvas) ────────────────────────────────────────

export type WorkScope = 'own' | 'team' | 'department' | 'org'

/** Completion-timing taxonomy — the analytical spine of the Work dashboard. */
export type Timing = 'early' | 'on_time' | 'late' | 'overdue' | 'partial' | 'incomplete' | 'pending'

export const TIMINGS: Timing[] = ['early', 'on_time', 'late', 'overdue', 'partial', 'incomplete', 'pending']

export type TimingCounts = Record<Timing, number>

/** Brand-system colors + labels for each timing bucket (DESIGN_RULES palette). */
export const TIMING_META: Record<Timing, { label: string; color: string }> = {
  early: { label: 'Completed Early', color: '#16A34A' },   // success green
  on_time: { label: 'Completed On-Time', color: '#2563EB' }, // primary blue
  late: { label: 'Completed Late', color: '#D97706' },     // warning amber
  overdue: { label: 'Overdue', color: '#DC2626' },         // danger red
  partial: { label: 'Partially Completed', color: '#EA580C' }, // orange — some did, some couldn't
  incomplete: { label: 'Incomplete', color: '#92400E' },   // dark amber/brown — closed-not-done
  pending: { label: 'Pending', color: '#94A3B8' },         // muted slate
}

export const emptyTiming = (): TimingCounts => ({ early: 0, on_time: 0, late: 0, overdue: 0, partial: 0, incomplete: 0, pending: 0 })

/** Sum two timing-count records (used for subtree roll-ups on the client). */
export function addTiming(a: TimingCounts, b: TimingCounts): TimingCounts {
  return { early: a.early + b.early, on_time: a.on_time + b.on_time, late: a.late + b.late, overdue: a.overdue + b.overdue, partial: a.partial + b.partial, incomplete: a.incomplete + b.incomplete, pending: a.pending + b.pending }
}

/** Which timing bucket a single task falls in (mirrors the server's classification). */
export function taskTiming(t: Task): Timing {
  if (t.completion_timing) return t.completion_timing
  if (t.status?.type === 'completed') return 'on_time'
  if (t.status?.type === 'partially_completed') return 'partial'
  if (t.status?.type === 'incomplete') return 'incomplete'
  return t.is_overdue ? 'overdue' : 'pending'
}

export interface DashboardKpis {
  total: number
  not_started: number
  ongoing: number
  completed: number
  overdue: number
  due_today: number
  due_week: number
  recurring: number
  // Timing-derived headline metrics
  completed_early: number
  completed_on_time: number
  completed_late: number
  critical_high_open: number
  completion_rate: number
  on_time_rate: number
  recurring_share: number
  delta: number | null // month-over-month completion-rate change (pts)
  overdue_aging: { d0_7: number; d8_30: number; d30_plus: number }
}

export interface DashboardBreakdownItem {
  id: string | null
  label: string
  color?: string
  type?: string | null
  order_index?: number
  total: number
  timing: TimingCounts
}

export interface TrendPoint {
  week: string
  created: number
  completed: number
  on_time: number
}

export interface MonthlyTrendPoint {
  month: string
  due: number
  completed: number
  on_time: number
  on_time_rate: number | null
}

export interface TaskDashboard {
  applied_scope: WorkScope | null
  max_scope: WorkScope | null
  kpis: DashboardKpis
  by_status: DashboardBreakdownItem[]
  by_priority: DashboardBreakdownItem[]
  by_category: DashboardBreakdownItem[]
  /**
   * Same item shape as by_category (`color` is a TagColor key). One task counts in every
   * tag it carries, so the totals can exceed the task count. Optional until the
   * backend's Phase 5 ships it.
   */
  by_tag?: DashboardBreakdownItem[]
  by_department: DashboardBreakdownItem[]
  by_type: DashboardBreakdownItem[]
  by_assignee: DashboardBreakdownItem[]
  by_assigner: DashboardBreakdownItem[]
  by_role: DashboardBreakdownItem[]
  by_timing: TimingCounts
  trend: TrendPoint[]
  trend_monthly: MonthlyTrendPoint[]
}

/** A source/flow breakdown row (Immediate/Same-dept/External, or a department). */
export interface SourceItem {
  id: string
  label: string
  total: number
  timing: TimingCounts
}

/** Cross-department giving×receiving heatmap (top-level departments). */
export interface FlowMatrix {
  depts: { id: string; name: string; color?: string | null }[]
  rows: { from: string; cells: number[] }[]
}

/** Scope-aware "where work comes from" analytics (from GET /tasks/flow). */
export interface WorkFlow {
  applied_scope: WorkScope | null
  max_scope: WorkScope | null
  by_source: SourceItem[]              // Immediate / Same-dept / External (assignee perspective)
  matrix: FlowMatrix                   // giving root × receiving root (org)
  incoming_by_source: SourceItem[]     // Within team / Same dept / External (team/dept scope)
  external_by_dept: SourceItem[]       // which outside department loads us most
  outgoing: { by_dept: SourceItem[]; overdue: number } // work the set pushed outside
  delegated: { total: number; open: number; overdue: number; timing: TimingCounts } // work the set handed out
}

export interface PersonNode {
  user_id: string
  name: string
  role_title: string | null
  department_name: string | null
  reporting_to_user_id: string | null
  assignee: { total: number; overdue: number; completed: number }
  assignee_timing: TimingCounts
  assigned_count: number
}

export interface PeopleTree {
  nodes: PersonNode[]
  root_user_id: string
}

export interface EmployeeReport {
  employee: { id: string; name: string; email: string; role_title: string | null; department_name: string | null }
  as_assignee: DashboardKpis
  as_assigner: DashboardKpis
  assignee_breakdowns: {
    by_status: DashboardBreakdownItem[]
    by_priority: DashboardBreakdownItem[]
    by_category: DashboardBreakdownItem[]
    by_department: DashboardBreakdownItem[]
    by_type: DashboardBreakdownItem[]
    by_assigner: DashboardBreakdownItem[]
  }
}

export type BulkAction = 'status' | 'deadline' | 'complete' | 'add_tags' | 'remove_tags'

/** POST bulk body (minus task_ids/action). `tag_ids` goes with add_tags / remove_tags. */
export interface BulkUpdatePayload {
  status_id?: string
  deadline?: string | null
  tag_ids?: string[]
}

/** POST bulk result: tasks the caller could not edit are skipped, with the reason. */
export interface BulkUpdateResult {
  updated: number
  skipped?: { id: string; title: string; reason: string }[]
}

export interface PagedTasks {
  items: Task[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

/** Query params shared by the dashboard + paged list endpoints. */
export interface WorkQuery {
  scope?: WorkScope
  status_id?: string
  priority_id?: string
  category_id?: string
  /** Tasks carrying ANY of these tags. Serialised as `tag_ids=a,b` (an empty list is dropped). */
  tag_ids?: string[] | string
  department_id?: string
  department_ids?: string // comma-separated — a department subtree drill
  role_id?: string // job-role drill (resolved to its assignees server-side)
  timing?: Timing // a completion-timing slice
  assigner_person_dept_id?: string // matrix drill: tasks given by a department's people
  assignee_person_dept_id?: string // matrix drill: tasks received by a department's people
  created_by_user_id?: string
  assignee_user_id?: string
  type?: string
  /** 'true' = only tasks a workflow step created; 'false' = none of them. */
  from_workflows?: 'true' | 'false'
  search?: string
  from_date?: string
  to_date?: string
  bucket?: string
  page?: number
  page_size?: number
  sort?: string
}

export type WorkBucket =
  | 'overdue' | 'due_today' | 'due_week' | 'completed' | 'ongoing' | 'not_started' | 'recurring'

// ─── Collective ───────────────────────────────────────────────────────────────

export interface CollectiveOrgTasks {
  organization: { id: string; name: string; slug: string }
  role: string
  tasks: Task[]
}

// ─── Assignee Selector ────────────────────────────────────────────────────────

export type AssigneeVisibilityMode = 'hierarchy_and_dept' | 'hierarchy_only' | 'dept_only' | 'custom'

export interface AssigneeCustomRules {
  include_departments: string[]
  exclude_departments: string[]
  include_roles: string[]
  exclude_roles: string[]
  allow_cross_dept: boolean
  allow_outside_hierarchy: boolean
}

export interface EligibleAssigneeUser {
  user_id: string
  name: string
  avatar_url: string | null
  role_id: string | null
  role_title: string
  department_id: string
  department_name: string
  active_task_count: number
  frequency_count: number
  is_frequent: boolean
  on_leave_today?: boolean
  leave_until?: string | null
}

export interface EligibleAssigneeGroup {
  department_id: string
  department_name: string
  users: EligibleAssigneeUser[]
}

export interface EligibleAssigneesResponse {
  departments: EligibleAssigneeGroup[]
  total: number
}

// ─── Assignee Visibility (admin model) ──────────────────────────────────────────

export type BridgeDepth = 'head_senior' | 'whole_dept'

export interface AssigneeVisibilitySettings {
  master_override: boolean
  full_visibility_roles: string[]
  full_visibility_users: string[]
  config_roles: string[]
}

export interface AssigneeBridge {
  id: string
  from_department_id: string
  from_department_name: string | null
  to_department_id: string
  to_department_name: string | null
  depth: BridgeDepth
  include_sub_departments: boolean
  match_count: number
}

export interface AssigneeDeptUpward {
  id: string
  name: string
  parent_department_id: string | null
  color: string | null
  assignee_allow_upward: boolean
  assignee_unify_subtree: boolean
}

export interface AssigneeVisibilityAdminView {
  settings: AssigneeVisibilitySettings
  bridges: AssigneeBridge[]
  departments: AssigneeDeptUpward[]
}

export interface AssigneeExplainResult {
  user_id: string
  total: number
  trace: {
    reason: string
    exception_id?: string
    exception_scope?: string
    bridges_used?: { to_department_id: string; depth: string; match_count: number; include_sub?: boolean }[]
    direct_manager_included?: boolean
  }
  users: {
    user_id: string
    name: string
    department_id: string
    department_name: string
    role_title: string
    role_level: string
    member_role: string | null
    reporting_to_user_id: string | null
  }[]
}

export interface SelectedAssignee {
  user_id: string
  name: string
  is_cc: boolean
}

// ─── Per-employee assignee editor (most-granular layer) ─────────────────────────

export type AssigneeReason =
  | 'self'
  | 'subordinate'
  | 'direct_manager'
  | 'department'
  | 'unified_subtree'
  | 'bridge'
  | 'full_visibility'
  | 'master_override'
  | 'manual_add'

export interface EmployeeAssigneeUser extends EligibleAssigneeUser {
  reason: AssigneeReason
  manually_added: boolean
}

export interface EmployeeAssigneeGroup {
  department_id: string
  department_name: string
  users: EmployeeAssigneeUser[]
}

export interface EmployeeManualOverride {
  employee_user_id: string
  added_user_ids: string[]
  removed_user_ids: string[]
}

export interface EmployeeAssigneeRemoved {
  user_id: string
  name: string
  role_title: string
  department_id: string
  department_name: string
  would_be_reason: AssigneeReason | null
}

export interface EmployeeAssigneePreview {
  employee: { user_id: string; name: string; role_title: string; department_id: string; department_name: string }
  trace: {
    reason: string
    manual_added_count?: number
    manual_removed_count?: number
  }
  override: EmployeeManualOverride
  departments: EmployeeAssigneeGroup[]
  removed: EmployeeAssigneeRemoved[]
  total: number
}

/** The workflow instance a step task belongs to — compact, for task lists and the detail. */
export interface TaskWorkflowRef {
  instance_id: string
  template_id: string
  /**
   * The instance label: a manual instance's name, or the workflow's name for a scheduled
   * one (the badge adds the date the instance started).
   */
  label: string
  instance_number: number | null
  /** "2", "B1". */
  step_label: string | null
  total_steps: number | null
  /** Who ran it; null = started by a schedule. */
  started_by_name: string | null
  /** When the instance started (for the badge date). */
  started_at?: string | null
  /** Started by a schedule (no person ran it). */
  is_scheduled?: boolean
  /** 'manual' | 'schedule' … (older shape). */
  trigger_type?: string | null
  step_title?: string | null
  template_name?: string | null
  instance_name?: string | null
  /** Who set the step up (its assigner), for "set up by …". */
  set_up_by_name?: string | null
  /** The viewer may open the instance page (null = not known for this response). */
  can_open?: boolean | null
}
