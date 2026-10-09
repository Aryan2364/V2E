import { DueRule, StartRule, readDueRule, readStartRule } from './timing'

/**
 * The frozen copy of a template step that every `WorkflowInstanceStep` carries in
 * `step_snapshot` (workflows v2 §A/§B). The engine reads ONLY this, so editing or
 * deleting template steps never reaches a running instance.
 *
 * v2: a step IS a task the system creates — the snapshot holds the task fields
 * (assignees, CCs, completion mode, tags, proof, checklist), the due rule
 * (`due_days` after the step starts at `due_time`), the escalation rule, the if-late
 * rule and the step's dependencies (`depends_on_step_ids`).
 *
 * Legacy snapshots (written before v2) carry `assignee_user_id` / `deadline_config` /
 * `if_overdue_action` and no `depends_on_step_ids`. `readSnapshot` normalises them to
 * the v2 shape (and leaves `depends_on_step_ids` null — such a run is a straight
 * sequence by order_index), so old runs stay readable and finishable.
 */

export interface ChecklistSnapshotItem {
  title: string
  order_index: number
  group_title?: string | null
  /**
   * Set on items that came from an org checklist template (TaskChecklistTemplate).
   * On the template STEP these are the saved copy (backup); in an instance snapshot
   * they are the template's items as resolved when the run was created.
   */
  template_id?: string | null
}

export type EscalationMode = 'manager' | 'people'
export type IfLate = 'wait' | 'move_on'
export type StepCompletionMode = 'any_can_complete' | 'all_must_complete'

export interface StepSnapshot {
  /** 2 for snapshots written by the v2 engine; absent on legacy snapshots. */
  version?: number
  title: string
  description: string | null
  /** Creator of the step's task (server-set on the template step). */
  assigner_user_id: string
  /** Non-CC assignees. */
  assignee_user_ids: string[]
  cc_user_ids: string[]
  completion_mode: StepCompletionMode
  priority_id: string | null
  category_id: string | null
  tag_ids: string[]
  proof_required: boolean
  proof_allowed_extensions: string[]
  checklist_items: ChecklistSnapshotItem[]
  /** Deadline = step start date + due_days, at due_time (org tz), holiday-adjusted. */
  due_days: number
  due_time: string
  escalation_mode: EscalationMode
  /** 'people' mode: the contacts in level order (1..n). */
  escalation_user_ids: string[]
  if_late: IfLate
  /**
   * Template step ids this step starts after (ALL must be satisfied). Empty = starts
   * with the run. NULL = legacy snapshot (the run is a straight sequence).
   */
  depends_on_step_ids: string[] | null
  /** Display position in the run (tracks in order, each in its own order). */
  order_index: number
  /** The template step this was copied from. */
  workflow_step_id?: string
  /**
   * The step's track when the run started ('main', 'B', …), the track's name, and the
   * step's number ("1", "B2"). Absent on runs started before tracks (their labels are
   * derived from the run graph instead).
   */
  track_key?: string
  track_name?: string | null
  number_label?: string
  /**
   * Step timing (engine/timing.ts). NULL = legacy: start as soon as the steps before
   * it are done; due = `due_days` after the start at `due_time`.
   */
  start_rule: StartRule | null
  due_rule: DueRule | null
  /**
   * The cycle length cycle_* rules count in, frozen from the workflow's schedules when
   * the run was created (1 when the workflow isn't cyclic).
   */
  timing_every?: number

  // ── Legacy fields (pre-v2 snapshots only; never written by v2) ──
  assignee_type?: string
  assignee_user_id?: string | null
  assignee_role?: string | null
  deadline_config?: Record<string, unknown>
  if_overdue_action?: string
  branch_step_id?: string | null
  is_branch_step?: boolean
  /** True on a legacy ESCALATION row (old trigger_branch). Never part of the flow. */
  is_branch?: boolean
  parent_instance_step_id?: string
  branch_step?: unknown
}

/** The template-step columns a v2 snapshot is built from. */
export interface TemplateStepLike {
  id: string
  title: string
  description: string | null
  assigner_user_id: string
  assignee_user_ids: unknown
  cc_user_ids: unknown
  completion_mode: string
  priority_id: string | null
  category_id: string | null
  tag_ids: unknown
  proof_required: boolean
  proof_allowed_extensions: string[] | null
  checklist_items: unknown
  due_days: number
  due_time: string
  escalation_mode: string
  escalation_user_ids: unknown
  if_late: string
  depends_on_step_ids: unknown
  order_index: number
  /** Absent on rows written before step timing (= legacy). */
  start_rule?: unknown
  due_rule?: unknown
}

const DEFAULT_DUE_TIME = '18:00'
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const LEGACY_DAY_TYPES = ['x_days_after_start', 'x_days_after_prev_completed', 'x_days_after_prev_deadline']

function checklist(items: unknown): ChecklistSnapshotItem[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((it) => it && typeof it === 'object' && typeof (it as { title?: unknown }).title === 'string')
    .map((it, idx) => {
      const x = it as { title: string; order_index?: unknown; group_title?: unknown; template_id?: unknown }
      const out: ChecklistSnapshotItem = {
        title: x.title,
        order_index: typeof x.order_index === 'number' ? x.order_index : idx,
        group_title: typeof x.group_title === 'string' ? x.group_title : null,
      }
      if (typeof x.template_id === 'string' && x.template_id) out.template_id = x.template_id
      return out
    })
    .filter((it) => it.title.trim() !== '')
}

/** Distinct non-empty strings of a JSON array, in first-seen order. */
export function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) if (typeof v === 'string' && v && !out.includes(v)) out.push(v)
  return out
}

function dueDays(v: unknown, fallback = 1): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(365, Math.max(0, Math.trunc(n)))
}

function dueTime(v: unknown): string {
  return typeof v === 'string' && TIME_RE.test(v) ? v : DEFAULT_DUE_TIME
}

/** Where the step sits in the workflow's tracks when the run starts. */
export interface SnapshotTrackInfo {
  track_key: string
  track_name: string | null
  number_label: string
  /** Display position in the run. */
  order_index: number
}

export function buildStepSnapshot(step: TemplateStepLike, track?: SnapshotTrackInfo): StepSnapshot {
  const assignees = idList(step.assignee_user_ids)
  return {
    version: 2,
    title: step.title,
    description: step.description,
    assigner_user_id: step.assigner_user_id,
    assignee_user_ids: assignees,
    // A person is either doing the step or CC'd on it, never both.
    cc_user_ids: idList(step.cc_user_ids).filter((u) => !assignees.includes(u)),
    completion_mode: step.completion_mode === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete',
    priority_id: step.priority_id,
    category_id: step.category_id,
    tag_ids: idList(step.tag_ids),
    proof_required: step.proof_required,
    proof_allowed_extensions: Array.isArray(step.proof_allowed_extensions) ? [...step.proof_allowed_extensions] : [],
    checklist_items: checklist(step.checklist_items),
    due_days: dueDays(step.due_days),
    due_time: dueTime(step.due_time),
    escalation_mode: step.escalation_mode === 'people' ? 'people' : 'manager',
    escalation_user_ids: idList(step.escalation_user_ids).slice(0, 5),
    if_late: step.if_late === 'move_on' ? 'move_on' : 'wait',
    depends_on_step_ids: idList(step.depends_on_step_ids).filter((id) => id !== step.id),
    order_index: track ? track.order_index : step.order_index,
    workflow_step_id: step.id,
    ...(track ? { track_key: track.track_key, track_name: track.track_name, number_label: track.number_label } : {}),
    start_rule: readStartRule(step.start_rule),
    due_rule: readDueRule(step.due_rule),
  }
}

/**
 * Parse a stored snapshot into the v2 shape; null when missing/garbled. Legacy
 * snapshots are normalised the same way the v2 migration backfilled template steps:
 * the fixed person becomes the assignee (role steps have none → the engine falls
 * back to the assigner), x_days_* deadlines keep their day count (others → 1 day),
 * proceed_anyway → move_on, and `depends_on_step_ids` stays null (sequence).
 */
export function readSnapshot(raw: unknown): StepSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (typeof s.title !== 'string' || typeof s.assigner_user_id !== 'string') return null
  const legacy = s.version !== 2
  const cfg = (s.deadline_config && typeof s.deadline_config === 'object' ? s.deadline_config : {}) as Record<string, unknown>

  const assignees = legacy
    ? typeof s.assignee_user_id === 'string' && s.assignee_user_id && s.assignee_type !== 'role'
      ? [s.assignee_user_id]
      : []
    : idList(s.assignee_user_ids)

  return {
    ...(s as unknown as StepSnapshot),
    title: s.title,
    description: typeof s.description === 'string' ? s.description : null,
    assigner_user_id: s.assigner_user_id,
    assignee_user_ids: assignees,
    cc_user_ids: legacy ? [] : idList(s.cc_user_ids).filter((u) => !assignees.includes(u)),
    completion_mode: s.completion_mode === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete',
    priority_id: typeof s.priority_id === 'string' ? s.priority_id : null,
    category_id: typeof s.category_id === 'string' ? s.category_id : null,
    tag_ids: legacy ? [] : idList(s.tag_ids),
    proof_required: s.proof_required === true,
    proof_allowed_extensions: Array.isArray(s.proof_allowed_extensions)
      ? (s.proof_allowed_extensions as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    checklist_items: checklist(s.checklist_items),
    due_days: legacy ? (LEGACY_DAY_TYPES.includes(cfg.type as string) ? dueDays(cfg.days) : 1) : dueDays(s.due_days),
    due_time: legacy ? dueTime(cfg.time) : dueTime(s.due_time),
    escalation_mode: !legacy && s.escalation_mode === 'people' ? 'people' : 'manager',
    escalation_user_ids: legacy ? [] : idList(s.escalation_user_ids).slice(0, 5),
    if_late: legacy
      ? s.if_overdue_action === 'proceed_anyway'
        ? 'move_on'
        : 'wait'
      : s.if_late === 'move_on'
        ? 'move_on'
        : 'wait',
    depends_on_step_ids: legacy || !Array.isArray(s.depends_on_step_ids) ? null : idList(s.depends_on_step_ids),
    order_index: typeof s.order_index === 'number' ? s.order_index : 0,
    track_key: typeof s.track_key === 'string' && s.track_key ? s.track_key : undefined,
    track_name: typeof s.track_name === 'string' && s.track_name ? s.track_name : null,
    number_label: typeof s.number_label === 'string' && s.number_label ? s.number_label : undefined,
    start_rule: legacy ? null : readStartRule(s.start_rule),
    due_rule: legacy ? null : readDueRule(s.due_rule),
    timing_every:
      typeof s.timing_every === 'number' && Number.isInteger(s.timing_every) && s.timing_every >= 1 ? s.timing_every : 1,
  }
}

/** A legacy escalation row (old trigger_branch) — never part of the step flow. */
export function isBranchRow(row: { step_snapshot: unknown }): boolean {
  const s = row.step_snapshot as { is_branch?: unknown } | null
  return !!s && typeof s === 'object' && s.is_branch === true
}

// ═══ Linked checklist templates (resolved once, when a run is created) ═════════

/** The columns of a TaskChecklistTemplate the resolver needs. */
export interface LiveChecklistTemplate {
  id: string
  name: string
  is_active: boolean
  items: unknown
}

/** Distinct `template_id`s referenced by a stored checklist, in first-seen order. */
export function checklistTemplateIds(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  const ids: string[] = []
  for (const it of items) {
    const id = it && typeof it === 'object' ? (it as { template_id?: unknown }).template_id : undefined
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * A template's CURRENT items in the template's own order (`order_index`, then array
 * position), blank titles dropped. Template items are `{ title, order_index? }`.
 */
export function templateItemTitles(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items
    .map((it, idx) => {
      const x = (it && typeof it === 'object' ? it : {}) as { title?: unknown; order_index?: unknown }
      return {
        title: typeof x.title === 'string' ? x.title.trim() : '',
        order: typeof x.order_index === 'number' ? x.order_index : idx,
        idx,
      }
    })
    .filter((x) => x.title !== '')
    .sort((a, b) => a.order - b.order || a.idx - b.idx)
    .map((x) => x.title)
}

/**
 * Linked-not-copied checklists: every group of items carrying a `template_id` whose
 * template still exists (in `templates`, already org-scoped by the caller) and is
 * ACTIVE is replaced by that template's current items — `group_title` = the
 * template's current name, `template_id` kept — at the position of the group's first
 * item. A deleted or deactivated template keeps the stored copy untouched. The
 * editor's own items (no `template_id`) are kept as they are. `order_index` is
 * renumbered 0..n-1 in the resulting order.
 */
export function resolveChecklistTemplates(
  items: ChecklistSnapshotItem[],
  templates: Map<string, LiveChecklistTemplate>,
): ChecklistSnapshotItem[] {
  const out: Omit<ChecklistSnapshotItem, 'order_index'>[] = []
  const expanded = new Set<string>()
  for (const it of items) {
    const tid = it.template_id
    const live = tid ? templates.get(tid) : undefined
    if (!tid || !live || !live.is_active) {
      out.push({ ...it })
      continue
    }
    if (expanded.has(tid)) continue // the whole group was emitted at its first item
    expanded.add(tid)
    for (const title of templateItemTitles(live.items)) {
      out.push({ title, group_title: live.name, template_id: tid })
    }
  }
  return out.map((it, i) => ({ ...it, order_index: i }))
}

/** Every checklist template id a snapshot refers to. */
export function snapshotTemplateIds(snap: StepSnapshot): string[] {
  return checklistTemplateIds(snap.checklist_items)
}

/** Resolve a snapshot's checklist against live templates. */
export function applyChecklistTemplates(snap: StepSnapshot, templates: Map<string, LiveChecklistTemplate>): StepSnapshot {
  if (!templates.size) return snap
  return { ...snap, checklist_items: resolveChecklistTemplates(snap.checklist_items, templates) }
}
