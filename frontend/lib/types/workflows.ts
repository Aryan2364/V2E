// Workflows v2 — shapes served by /api/v1/org/:orgId/workflows.
// A step is a task the system creates. Steps live in TRACKS: the Main track always
// exists; within a track each step waits for the one before it; another track starts
// after the step it splits from ("Split here"), and a step may also wait for steps in
// other tracks ("Also wait for" = a merge). The server derives `depends_on_step_ids`
// from that on save. Steps are numbered 1, 2, 3… on the main track and B1, B2… on track B.

import type { CompletionMode, RecurringEndCondition, RecurringScheduleType, TaskTagRef, YearlyDate } from '@/lib/types/tasks'

export type WorkflowNature = 'one_time' | 'recurring'
export type WorkflowRecurringType = 'daily' | 'weekly' | 'monthly' | 'yearly'
/**
 * draft = saved but not live (cannot be started, schedules never fire); active = Live;
 * paused = Live but stopped (no new runs, schedules skip; runs under way carry on);
 * archived = put away (Restore brings it back as a draft).
 */
export type WorkflowTemplateStatus = 'draft' | 'active' | 'paused' | 'archived'
/**
 * Run-row states. `branched` belongs to old runs only (follow-up steps, now removed).
 * `sent_back` = paused while an earlier step is redone; `moved_on` = late, the steps
 * after it started anyway, its task is still open.
 */
export type WorkflowStepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'overdue'
  | 'skipped'
  | 'branched'
  | 'sent_back'
  | 'moved_on'
export type WorkflowInstanceStatus = 'running' | 'completed' | 'stuck' | 'cancelled'
/** How a run is shown to people (server-computed; the client derives it for older servers). */
export type RunDisplayStatus = 'running' | 'falling_behind' | 'waiting_for_info' | 'needs_attention' | 'completed' | 'cancelled'
export type IfLate = 'wait' | 'move_on'
export type EscalationMode = 'manager' | 'people'

export interface PersonRef {
  id: string
  name: string
}

export interface ChecklistItem {
  title: string
  group_title?: string | null
  /**
   * Set on items that are the saved copy of a checklist template (linked). Each new run
   * uses the template's latest items; the saved copy is the fallback if it is gone.
   */
  template_id?: string | null
}

/** A linked checklist template's state, as the server sees it now (per step). */
export interface ChecklistTemplateStatus {
  template_id: string
  name: string
  /** false = deleted or deactivated: runs use the step's saved copy. */
  active: boolean
  /** Whether the person viewing may use this template themselves. */
  accessible: boolean
  /** false = the template was deleted. */
  exists?: boolean
}

/** A checklist template the current user may add to a step (GET /meta). */
export interface WorkflowChecklistTemplateOption {
  id: string
  name: string
  item_count: number
  items: { title: string }[]
}

// ─── Step timing ──────────────────────────────────────────────────────────────

/**
 * When a step starts. Relative kinds are always allowed; calendar kinds only when the
 * workflow's schedules repeat that way (weekday ↔ weekly, month_day ↔ monthly, …;
 * cycle_* when they repeat every 2+ weeks / months / years). Times are 'HH:mm' in the
 * organisation's time zone.
 *  - immediate: as soon as it may start (its "Starts after" steps are done, or the run starts).
 *  - days_after_previous: N (≥1) days after it may start, at time.
 *  - days_after_run_start: run start date + N (≥0) days, at time (never before it may start).
 */
export type StartRuleKind =
  | 'immediate'
  | 'days_after_previous'
  | 'days_after_run_start'
  | 'time_of_day'
  | 'weekday'
  | 'month_day'
  | 'year_date'
  | 'cycle_weekday'
  | 'cycle_month_day'
  | 'cycle_year_date'

/** When a step is due. Calendar kinds = the next occurrence strictly after it starts. */
export type DueRuleKind =
  | 'days_after_start'
  | 'time_of_day'
  | 'weekday'
  | 'month_day'
  | 'year_date'
  | 'cycle_weekday'
  | 'cycle_month_day'
  | 'cycle_year_date'

/** A calendar kind shared by Starts and Due. */
export type CalendarRuleKind = Exclude<DueRuleKind, 'days_after_start'>

/** Day of the month: 1–31 (31 in a short month = its last day), or the last day. */
export type RuleMonthDay = number | 'last'

interface TimingRuleBase {
  /** 'HH:mm'. */
  time?: string
  /** Relative kinds. */
  days?: number
  /** 0 = Sunday … 6 = Saturday (weekday, cycle_weekday). */
  weekday?: number
  /** month_day, year_date and their cycle forms. */
  day?: RuleMonthDay
  /** 1–12 (year_date, cycle_year_date). */
  month?: number
  /** 1..every — which week / month / year of the cycle (cycle_* kinds). */
  cycle?: number
}

export interface StartRule extends TimingRuleBase {
  kind: StartRuleKind
}

export interface DueRule extends TimingRuleBase {
  kind: DueRuleKind
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

/** 'main', or 'B', 'C', … (assigned in creation order, stable once saved). */
export type TrackKey = string

export interface WorkflowTrack {
  key: TrackKey
  /** Optional name, e.g. "Finance". */
  name: string | null
  /** "Main track", the name, or "Track B" (server-computed). */
  label?: string
  /** The step (in another track) this track starts after; null = when the workflow starts. Always null for main. */
  split_from_step_id: string | null
  step_count?: number
}

/** A run's lanes (from the steps' frozen track info). */
export interface RunTrack {
  key: TrackKey
  label: string
}

// ─── Steps ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string
  organization_id: string
  workflow_template_id: string
  /** Position within its track. */
  order_index: number
  /** Its track ('main' when missing). */
  track_key?: TrackKey
  /** "1", "B2" (server-computed; the builder recomputes it while editing). */
  number_label?: string
  /** "Also wait for": steps in OTHER tracks it waits for too. */
  merge_step_ids?: string[]
  title: string
  description: string | null
  /** Non-CC assignees (at least one to turn the workflow on). */
  assignee_user_ids: string[]
  cc_user_ids: string[]
  completion_mode: CompletionMode
  priority_id: string | null
  category_id: string | null
  tag_ids: string[]
  checklist_items: ChecklistItem[]
  proof_required: boolean
  /** Empty = any file type. */
  proof_allowed_extensions: string[]
  /**
   * Deadline = the day this step starts + due_days, at due_time (org time zone, holidays
   * skipped). Mirrors a relative `due_rule`; the whole rule when `due_rule` is null.
   */
  due_days: number
  due_time: string
  /** When it starts. null = legacy: as soon as it may start. */
  start_rule?: StartRule | null
  /** When it is due. null = legacy: due_days / due_time after it starts. */
  due_rule?: DueRule | null
  escalation_mode: EscalationMode
  /** Used when escalation_mode is 'people': 1–5 people, in order = levels. */
  escalation_user_ids: string[]
  if_late: IfLate
  /** Derived from the tracks (read-only): the steps it starts after. Empty = starts when the run starts. */
  depends_on_step_ids: string[]
  /** Creator of the step's tasks (server-set). */
  assigner_user_id: string | null
  created_at: string
  updated_at: string
  // Resolved by the server
  assignees?: PersonRef[]
  ccs?: PersonRef[]
  /** 'people' → those people; 'manager' → the assignees' current managers. */
  escalation_contacts?: PersonRef[]
  escalation_resolved_from?: 'manager' | 'people' | 'owners_fallback'
  /** The step's tags, when the server resolves them. */
  tags?: TaskTagRef[]
  /** One entry per linked checklist template on this step. */
  checklist_template_status?: ChecklistTemplateStatus[]
}

/** Fields the client may send when adding or editing a step. */
export interface StepInput {
  title?: string
  description?: string | null
  assignee_user_ids?: string[]
  cc_user_ids?: string[]
  completion_mode?: CompletionMode
  priority_id?: string | null
  category_id?: string | null
  tag_ids?: string[]
  checklist_items?: ChecklistItem[]
  proof_required?: boolean
  proof_allowed_extensions?: string[]
  due_days?: number
  due_time?: string
  start_rule?: StartRule | null
  due_rule?: DueRule | null
  escalation_mode?: EscalationMode
  escalation_user_ids?: string[]
  if_late?: IfLate
  merge_step_ids?: string[]
}

// ─── How it starts ────────────────────────────────────────────────────────────

/**
 * "On a schedule": the recurring-task schedule format (Repeat daily / weekly / monthly /
 * yearly, every N, weekdays, month days, yearly dates, time, starting date, ends never /
 * on a date / after N). Dates are "YYYY-MM-DD"; the time is in the organisation's time zone.
 */
export interface WorkflowSchedule {
  id: string
  schedule_type: RecurringScheduleType
  every: number
  days: number[]
  /** 1–31; a negative day means "that day, or the last day of shorter months". */
  month_days: number[]
  yearly_dates: YearlyDate[]
  time: string
  start_date: string
  end_condition: RecurringEndCondition
  end_date: string | null
  end_after: number | null
  /** How many runs it has started (counts toward "after N"). */
  occurrence_count: number
  /** False once an "after N" schedule has run N times. */
  is_active: boolean
  order_index: number
  /** Its next run (server-computed); it only actually starts one while the workflow is Live. */
  next_fire_at: string | null
}

// ─── Templates ────────────────────────────────────────────────────────────────

export interface WorkflowCapabilities {
  can_view: boolean
  can_edit: boolean
  /** May start it by hand now: chosen under "Manually", Manually is on, and it is Live. */
  can_trigger: boolean
  /** Owners and editors (owners / creator / admins). */
  can_manage_access: boolean
  /** Is one of the people chosen under "Manually", whatever the status. */
  is_starter?: boolean
}

/** Someone involved in a workflow, with every way they are involved. */
export interface InvolvedPerson extends PersonRef {
  /** e.g. 'owner', 'editor', 'starter', 'assignee', 'cc', 'escalation'. */
  roles: string[]
}

export interface WorkflowPeople {
  owners: PersonRef[]
  /** Can change it. */
  editors: PersonRef[]
  /** Chosen under "Manually": the only people who can start it by hand. */
  starters: PersonRef[]
  involved: InvolvedPerson[]
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string | null
  status: WorkflowTemplateStatus
  /** Live = active or paused. */
  is_live?: boolean
  /** "How it starts → Manually". Off = only its schedule starts it (no Start button). */
  manual_start_enabled: boolean
  workflow_nature: WorkflowNature
  recurring_type: WorkflowRecurringType | null
  show_workflow_on_task_card?: boolean
  created_by_user_id: string
  created_at: string
  updated_at: string
  owner_user_ids: string[]
  owners: PersonRef[]
  created_by: PersonRef | null
  capabilities: WorkflowCapabilities
  _count: { steps: number; instances: number; running_instances: number }
  /** "How it starts → On a schedule" (empty = no schedule). */
  schedules: WorkflowSchedule[]
  /** The next scheduled run while Live (null when paused, a draft, or nothing is scheduled). */
  next_run_at: string | null
  /** Detail only: main first, then the others in display order. */
  tracks?: WorkflowTrack[]
  /** Detail only — in display order (tracks in order, each in its own order). */
  steps?: WorkflowStep[]
  /** Detail only. */
  people?: WorkflowPeople
  /** After a save: things worth a look that do not stop it (e.g. a step planned before the one it follows is due). */
  warnings?: TimingWarning[]
}

// ─── Instances (runs) ─────────────────────────────────────────────────────────

export interface InstanceCapabilities {
  can_cancel: boolean
  can_retry: boolean
  /** True when at least one step may be skipped. */
  can_skip: boolean
  /** Rows the caller may skip. */
  can_skip_row_ids?: string[]
  /** May add files to the run's documents. */
  can_upload?: boolean
  /** May open the run's documents. */
  can_view_documents?: boolean
  /** Run rows the caller may send back from. */
  can_send_back_from?: string[]
  /** Waiting rows (pending with a start time) the caller may start now. */
  can_start_now_row_ids?: string[]
}

export interface InstanceProgress {
  total: number
  completed: number
  /** Steps being worked on now (or paused waiting for info). */
  current_step_titles?: string[]
  /** Older servers: the single current step. */
  current_step_title?: string | null
}

/** The step's task, as the run page needs it. */
export interface RunStepTask {
  id: string
  status: { label: string; type: string; color: string | null } | null
  deadline: string | null
  is_overdue: boolean
  completed_at: string | null
  checklist_total: number
  checklist_done: number
  proof_count: number
  comment_count: number
}

export interface WorkflowInstanceStep {
  id: string
  status: WorkflowStepStatus
  /** Display position in the run. */
  order_index: number
  /** The step's track in this run. */
  track_key?: TrackKey | null
  /** "1", "B2" — its number in this run. */
  number_label?: string | null
  title: string
  description: string | null
  scheduled_at: string | null
  completed_at: string | null
  task_created_at: string | null
  last_error: string | null
  task_id: string | null
  task_deleted: boolean
  checklist_items: ChecklistItem[] | null
  proof_required: boolean
  workflow_step_id?: string | null
  created_at?: string
  /** Old runs: a follow-up step started because a step was late. */
  is_branch?: boolean
  /** Old shape: the single assignee. */
  assigned_to?: PersonRef | null
  // v2
  /** Rows of this run this row starts after. Missing on old runs (= straight sequence). */
  depends_on_row_ids?: string[]
  /** On a paused (sent back) row: the earlier row being redone. */
  waiting_on_row_id?: string | null
  /** On a row being redone: the row to return to once it is completed again. */
  returned_to_row_id?: string | null
  sent_back_count?: number
  /** From the task's live roster. */
  assignees?: PersonRef[]
  ccs?: PersonRef[]
  due_days?: number | null
  due_time?: string | null
  if_late?: IfLate | null
  /** The step's task exists and is still open. */
  task_open?: boolean
  task?: RunStepTask | null
  /** Planned when the run was created (the example the timing works out to). */
  planned_start_at?: string | null
  planned_due_at?: string | null
  /** A pending row waiting for its start time: when it starts by itself. */
  start_at?: string | null
  /** Server: pending, the steps before it are done, and its start time has not come. */
  waiting?: boolean
  start_rule?: StartRule | null
  due_rule?: DueRule | null
}

export interface WorkflowInstance {
  id: string
  name: string
  status: WorkflowInstanceStatus
  display_status?: RunDisplayStatus
  trigger_type: string
  started_at: string
  completed_at: string | null
  last_error: string | null
  template: PersonRef
  triggered_by: PersonRef | null
  capabilities: InstanceCapabilities
  progress: InstanceProgress
  /** The run's tracks (lanes), main first. */
  tracks?: RunTrack[]
  /** Detail always; list may omit. */
  steps?: WorkflowInstanceStep[]
}

/** A run's history, newest first. */
export interface WorkflowRunEvent {
  id: string
  type: string
  message: string
  actor: PersonRef | null
  instance_step_id: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

export interface RunStepFile {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: PersonRef | null
  created_at: string
  is_proof: boolean
  in_comment: boolean
}

export interface RunFile {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: PersonRef | null
  created_at: string
}

export interface RunDocuments {
  step_files: { row_id: string; step_title: string; task_id: string | null; files: RunStepFile[] }[]
  run_files: RunFile[]
}

/** GET /workflows/step-context/:taskId — what the task page needs about its run. */
export interface WorkflowStepContext {
  template_id: string
  template_name: string
  instance_id: string
  instance_name: string
  row_id: string
  step_title: string
  can_send_back: boolean
  /** Whether the viewer may open the run page. */
  can_open_run?: boolean
  instance_status?: WorkflowInstanceStatus
  row_status?: WorkflowStepStatus
  /** Position of the step in the run (1-based). */
  step_number?: number | null
  /** "1", "B2" — the step's number in its run. */
  step_label?: string | null
  total_steps?: number
}

export interface SendBackTarget {
  row_id: string
  title: string
  /** "1", "B2". */
  number_label?: string | null
  /** The step right before (a direct "starts after"). */
  is_direct?: boolean
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export interface WorkflowMeta {
  /** 'preview' = the org can look but not change anything. */
  module_access?: 'full' | 'preview'
  /** Checklist templates the current user may add to a step. */
  checklist_templates?: WorkflowChecklistTemplateOption[]
}

/** An active member of the organization, for owner / assignee / people pickers. */
export interface OrgMemberOption {
  user_id: string
  name: string
  email?: string | null
}

// ─── Saving the whole workflow ────────────────────────────────────────────────

/**
 * One step of a definition save. `key` = its id, or a client key for a step not saved
 * yet. Its position in its track = its order among that track's steps in `steps`.
 */
export interface DefinitionStepInput extends Omit<StepInput, 'merge_step_ids' | 'title'> {
  key: string
  /** The existing step being kept (omitted for a new one). */
  id?: string
  title: string
  track_key: TrackKey
  /** "Also wait for": KEYS of steps in other tracks. */
  merge_step_keys: string[]
}

/** One track of a definition save (main first; empty tracks are dropped by the server). */
export interface DefinitionTrackInput {
  key: TrackKey
  name: string | null
  /** KEY of the step it starts after; null = when the workflow starts. */
  split_from_step_key: string | null
}

export interface DefinitionScheduleInput {
  id?: string
  schedule_type: RecurringScheduleType
  every: number
  days: number[]
  month_days: number[]
  yearly_dates: YearlyDate[]
  time: string
  start_date: string
  end_condition: RecurringEndCondition
  end_date?: string | null
  end_after?: number | null
}

/**
 * PUT /workflows/:id/definition (or POST /workflows/definition): the whole workflow in
 * one save. 'draft' = Save draft (only a name needed); 'save' = Save (everything checked;
 * a draft becomes Live). A Live or Paused workflow is always checked in full.
 */
export interface WorkflowDefinitionInput {
  name: string
  description: string | null
  mode: 'draft' | 'save'
  starts: {
    manual: { enabled: boolean; starter_user_ids?: string[] }
    schedules: DefinitionScheduleInput[]
  }
  steps: DefinitionStepInput[]
  tracks: DefinitionTrackInput[]
  /** Owners and editors; omitted = unchanged. */
  people?: { owner_user_ids: string[]; editor_user_ids: string[] }
  /** The version the editor loaded: a newer save by someone else is a 409. */
  expected_updated_at?: string
}

/** A saved workflow, plus which id each client step key became. */
export type SavedWorkflow = WorkflowTemplate & { step_keys?: Record<string, string> }

// ─── Example run (timing preview) ─────────────────────────────────────────────

/**
 * A non-blocking note about the timing: plain text, or an object naming the step (by the
 * key it was sent with) and, for "planned before the step it follows is due", that step.
 */
export type TimingWarning =
  | string
  | { message?: string | null; step_key?: string | null; key?: string | null; predecessor_key?: string | null }

export interface TimelinePreviewStep {
  /** The key the step was sent with (its id, or the client key of a step not saved yet). */
  key: string
  title: string
  planned_start_at: string | null
  planned_due_at: string | null
}

export interface TimelinePreviewRun {
  starts_at: string
  steps: TimelinePreviewStep[]
}

/** POST /workflows/preview-timeline: the next scheduled runs (or one run starting now), planned. */
export interface TimelinePreview {
  runs: TimelinePreviewRun[]
  warnings: TimingWarning[]
}
