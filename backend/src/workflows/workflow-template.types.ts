import { CompletionMode, Prisma, WorkflowAccessType, WorkflowInstanceStatus, WorkflowStep, WorkflowTemplateStatus } from '@prisma/client'
import { EscalationMode, IfLate } from './dto/definition.dto'
import { INSTANCE_NAME_MAX } from './workflow-engine.shared'
import { TaggedMessageRow } from './workflow-discussion.service'

/** The caller's role on a workflow (admin only when they have no role of their own). */
export type WorkflowRole = 'creator' | 'editor' | 'viewer' | 'admin' | 'starter' | null

export interface TemplateCapabilities {
  /** Sees the design and ALL its instances: admins, editors (creator included) and viewers. */
  can_view: boolean
  /** Edits the design, pauses/resumes/archives, manages instances: admins and editors. */
  can_edit: boolean
  /** May start it by hand NOW: a chosen starter, "Manually" is on, and it is Live. */
  can_trigger: boolean
  /** Changes editors / viewers: admins and editors. */
  can_manage_access: boolean
  /** "Change creator…" (⋯ menu): admins only. */
  can_change_creator: boolean
  /** Is one of the people chosen under "Manually" (whatever the status). */
  is_starter: boolean
  /** Created it — always an editor, can't be removed. */
  is_creator: boolean
  role: WorkflowRole
}

export interface InstanceCapabilities {
  can_cancel: boolean
  can_retry: boolean
  /** True when at least one step may be skipped (see `can_skip_row_ids`). */
  can_skip: boolean
  /** Rows the caller may skip (in progress, late, or moved on). */
  can_skip_row_ids: string[]
  /** May add instance files: editors, admins, the person who ran it and people working in it (not viewers). */
  can_upload: boolean
  /** May open the documents drawer: everyone who can see the instance. */
  can_view_documents: boolean
  /** May write in the instance discussion: everyone who can see the instance. */
  can_post_message: boolean
  /** Older name of `can_post_message`. */
  can_add_note: boolean
  /** Rows the caller may send back from (in progress, with a completed upstream step). */
  can_send_back_from: string[]
  /** Waiting rows (ready, before their start time) the caller may "Start now" (can_edit). */
  can_start_now_row_ids: string[]
}

/** One example run of the builder's live timeline. */
export interface TimelineRun {
  starts_at: Date
  steps: { key: string; title: string; planned_start_at: Date; planned_due_at: Date }[]
}

/** A step as the timeline reads it (from a request or from a save being applied). */
export interface TimelineStep {
  key: string
  title: string
  /** "1", "B2" — how warnings name it. */
  label: string
  deps: string[]
  start_rule: unknown
  due_rule: unknown
  due_days: number
  due_time: string
  holiday_user_id: string | null
}

/** How many scheduled occurrences the example timeline shows. */
export const TIMELINE_RUNS = 3

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type RunDisplayStatus =
  | 'running'
  | 'falling_behind'
  | 'waiting_for_info'
  | 'needs_attention'
  | 'completed'
  | 'cancelled'

/** Per linked checklist template on a step: drives "no longer available — using saved copy". */
export interface ChecklistTemplateStatus {
  template_id: string
  /** Current template name; the saved group title when the template was deleted. */
  name: string
  /** Template exists in this org and is active (runs use its current items). */
  active: boolean
  /** The CALLER may attach this template (same rule as the task modal). */
  accessible: boolean
  /** False when the template was deleted (runs use the step's saved copy). */
  exists: boolean
}

/** A checklist template the caller may attach to a step (GET /meta). */
export interface ChecklistTemplateOption {
  id: string
  name: string
  item_count: number
  items: { title: string }[]
}

/** One stored checklist item on a WorkflowStep. */
export interface StoredChecklistItem {
  title: string
  order_index: number
  group_title?: string
  template_id?: string
}

export interface UserRef {
  id: string
  name: string
}

export type EscalationResolvedFrom = 'manager' | 'people' | 'owners_fallback'

export interface TaskSummary {
  id: string
  status: { label: string; type: string; color: string | null } | null
  deadline: Date | null
  is_overdue: boolean
  completed_at: Date | null
  checklist_total: number
  checklist_done: number
  proof_count: number
  comment_count: number
}

/** An instance note as the API returns it. */
export interface NoteOut {
  id: string
  body: string
  author: UserRef
  created_at: Date
  /** The later step it is for (null = the whole instance). */
  for_row_id: string | null
  for_step: { row_id: string; number_label: string | null; title: string; status: string } | null
  /** The author, editors and admins may remove it. */
  can_delete: boolean
}

/** A tagged discussion message ("For <step>") as "Notes for this step" reads it. */
export type NoteRow = TaggedMessageRow

/** The editable state of a step (v2 columns), resolved from a row and/or a DTO. */
export interface StepState {
  title: string
  description: string | null
  assignee_user_ids: string[]
  cc_user_ids: string[]
  completion_mode: CompletionMode
  priority_id: string | null
  category_id: string | null
  tag_ids: string[]
  checklist_items: StoredChecklistItem[]
  proof_required: boolean
  proof_allowed_extensions: string[]
  due_days: number
  due_time: string
  escalation_mode: EscalationMode
  escalation_user_ids: string[]
  if_late: IfLate
  /** Step timing (engine/timing.ts) as stored: NULL = legacy; a draft may hold a partial rule. */
  start_rule: Record<string, unknown> | null
  due_rule: Record<string, unknown> | null
}

/** A step as it is being saved: its request key, final id and resolved state. */
export interface ProposedStep {
  key: string
  id: string
  existing: WorkflowStep | null
  state: StepState
  /** Its track ('main', 'B', …). */
  track_key: string
  /** Position within its track (stored as order_index). */
  order_index: number
  /** "1", "B2". */
  label: string
  /** Final ids of the steps in other tracks it also waits for ("Also wait for"). */
  merges: string[]
  /** Final ids of the steps it starts after — DERIVED from the tracks. */
  deps: string[]
}

// ── Messages (403s say who may do it) ─────────────────────────────────────────

export const MSG_NOT_FOUND = 'Workflow not found'

export const MSG_RUN_NOT_FOUND = 'Instance not found'

export const MSG_VIEW = "You don't have access to this workflow."

export const MSG_EDIT = 'Only editors and admins can do this.'

export const MSG_TRIGGER = 'Only the people listed under “Who can start it” can start this workflow.'

export const MSG_PAUSED = 'This workflow is paused. Resume it to start it.'

export const MSG_DRAFT_START = 'This workflow is a draft. Save it to make it live.'

export const MSG_ARCHIVED_START = 'This workflow is archived. Restore and save it first.'

export const MSG_SCHEDULE_ONLY = 'This workflow starts only on its schedule.'

export const MSG_CONFLICT = 'Someone else saved this workflow after you opened it. Reload to see their changes.'

export const MSG_PICK_STARTERS = 'Choose who can start this workflow.'

export const MSG_NO_START = 'Choose how this workflow starts.'

export const MSG_MANAGE = 'Only editors and admins can change who is involved.'

export const MSG_ARCHIVED = 'This workflow is archived. Restore it to make changes.'

export const MSG_INSTANCE_VIEW = "You don't have access to this instance."

export const MSG_RUN_FILES = 'Only editors, admins and people working in this instance can add its documents.'

export const MSG_SEND_BACK = "Only this step's assignees, editors and admins can send it back."

export const MSG_REMOVE_FILE = 'Only the person who added this file, editors and admins can remove it.'

export const MSG_CHANGE_CREATOR = 'Only admins can change who created a workflow.'

export const MSG_NAME_REQUIRED = 'Enter a name for this instance.'

export const MSG_NAME_TOO_LONG = `Keep the name to ${INSTANCE_NAME_MAX} characters or fewer.`

export const IN_FLIGHT: WorkflowInstanceStatus[] = ['running', 'stuck']

export const DEFAULT_TZ = 'Asia/Kolkata'

export const INSTANCE_LIST_LIMIT = 200

export const EVENT_LIMIT = 500

/** Task status types that close a task (mirrors the engine). */
export const TERMINAL_TASK_TYPES = ['completed', 'partially_completed', 'incomplete']

/** Row statuses whose task is being worked on (can be sent back / skipped). */
export const WORKING = ['active', 'overdue']

/** Row statuses a send-back may start from. */
export const SEND_BACK_FROM = ['active', 'overdue']

/** Row statuses an editor may skip. */
export const SKIPPABLE = ['active', 'overdue', 'moved_on']

/** Live = running for real (Active) or temporarily stopped (Paused). */
export const LIVE: WorkflowTemplateStatus[] = ['active', 'paused']

/** The template columns the access model reads, plus the caller's own grants. */
export type AccessSubject = {
  id: string
  name: string
  status: WorkflowTemplateStatus
  created_by_user_id: string
  /** Older callers/tests may omit it (= on). */
  manual_start_enabled?: boolean
  access: { access_type: WorkflowAccessType }[]
}

export const accessSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    status: true,
    created_by_user_id: true,
    manual_start_enabled: true,
    updated_at: true,
    access: { where: { user_id: userId }, select: { access_type: true } },
  }) satisfies Prisma.WorkflowTemplateSelect

export const SCHEDULE_ORDER: Prisma.WorkflowScheduleEntryOrderByWithRelationInput[] = [
  { order_index: 'asc' },
  { created_at: 'asc' },
]

export const templateInclude = (userId: string) =>
  ({
    schedules: { orderBy: SCHEDULE_ORDER },
    access: { where: { user_id: userId }, select: { access_type: true } },
    _count: { select: { steps: { where: { is_branch_step: false } }, instances: true } },
  }) satisfies Prisma.WorkflowTemplateInclude

export type TemplateRow = Prisma.WorkflowTemplateGetPayload<{ include: ReturnType<typeof templateInclude> }>

export const instanceInclude = (userId: string) =>
  ({
    template: { select: accessSelect(userId) },
    steps: true,
  }) satisfies Prisma.WorkflowInstanceInclude

export type InstanceRow = Prisma.WorkflowInstanceGetPayload<{ include: ReturnType<typeof instanceInclude> }>

export type InstanceStepRow = InstanceRow['steps'][number]

/** The latest `sent_back` event of an open send-back, by its sender row. */
export type SendBackEvent = { actor_user_id: string | null; created_at: Date; reason: string | null; to_row_id: string | null }

/**
 * An open send-back as a step shows it. On the waiting (sender) row: where it was sent
 * and why (`to_*`); on the reopened (target) row, while it owes the sender an answer:
 * who asked and why (`from_*`). Labels read "1 “Collect documents”".
 */
export type SendBackInfo =
  | { role: 'sender'; reason: string | null; by: UserRef | null; at: Date | null; to_row_id: string; to_label: string }
  | { role: 'target'; reason: string | null; by: UserRef | null; at: Date | null; from_row_id: string; from_label: string }

export type Tx = Prisma.TransactionClient

/** A step as the sample-run order check reads it. */
export interface OrderCheckStep {
  key: string
  /** "1", "B2". */
  label: string
  title: string
  deps: string[]
  start_rule: unknown
  due_rule: unknown
  due_days: number
  due_time: string
}
