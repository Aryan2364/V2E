import { ACTIVE_ASSIGNEE } from './active-assignee';
import { TASK_TAG_REF_SELECT, TaskTagRef, toTagRefs } from '../common/task-masters-usable';

/** The subject leaf governing "can be assigned a task". */
export const TASK_SUBJECT = 'tasks.subject.assignable';
/** The content leaf governing task row-level scope. */
export const TASK_LEAF = 'tasks.task.manage';

export const TASK_INCLUDE = {
  status: true,
  priority: true,
  category: true,
  // The task's LIVE roster only. Taking someone off a task is a SOFT removal — the
  // TaskAssignee row is kept so compliance reporting can still show they held it (see
  // active-assignee.ts) — so every operational read flowing through this include must
  // see active participants only, or a removed person silently reappears in a
  // completion gate, an n/N count or a notification fan-out. The compliance reports
  // deliberately do NOT use this constant; they want the full historical roster.
  assignees: { where: ACTIVE_ASSIGNEE },
  checklist: { orderBy: { order_index: 'asc' as const } },
  escalations: true,
  reminders: true,
  // Glanceable counts for the task list — comments ("chats") and attachments,
  // filtered to exclude soft-deleted rows. Flows to every list/detail query.
  _count: {
    select: {
      comments: { where: { is_deleted: false } },
      attachments: { where: { is_deleted: false } },
    },
  },
  // Tags, sorted by name. Loaded as join rows; every response flattens them to
  // `tags: TaskTagRef[]` (see `withTagRefs`) so the join row never leaves the API.
  ...TASK_TAG_REF_SELECT,
};

/** Upper bound on `tag_ids` in a list filter — a filter, not a bulk payload. */
export const MAX_TAG_FILTER_IDS = 50;

/** Refusal for writing to a task whose created_at is after the org's (simulated) now. */
export const SIMULATED_FUTURE_TASK_MESSAGE =
  'This task was created in a simulated future. To interact with it, please time-travel to this date or later.';

/**
 * The single response serializer for tags: replace a loaded task's `tags` join rows
 * (`{ tag: {...} }[]`) with flat `TaskTagRef[]` (TASK_TAGS_PLAN.md §10.1). A row loaded
 * without the relation comes back with `tags: []`, so the shape is always stable.
 * Used by `enrichTaskList` (every list / my / cc / assigned / escalated / paged /
 * export / collective read) and `getTask` (detail + every create/update/action result).
 */
export function withTagRefs<T extends { tags?: unknown }>(task: T): Omit<T, 'tags'> & { tags: ReturnType<typeof toTagRefs> } {
  return { ...task, tags: toTagRefs(task.tags as Parameters<typeof toTagRefs>[0]) };
}

/** Parse a CSV id filter: trimmed, de-duplicated, empties dropped, capped. */
export function parseIdCsv(raw: string | undefined, cap: number): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, cap);
}

/** Shared filter shape for list / paged / dashboard task queries. */
export interface TaskListFilters {
  status_id?: string;
  priority_id?: string;
  category_id?: string;
  department_id?: string;
  department_ids?: string; // comma-separated; a department subtree drill
  created_by_user_id?: string;
  quadrant?: string;
  type?: string;
  timing?: string; // early | on_time | late | overdue | pending
  assignee_user_id?: string;
  assignee_user_ids?: string; // comma-separated
  created_by_user_ids?: string; // comma-separated assigners
  assigner_person_dept_id?: string; // matrix drill: assigner's home dept (subtree) → creators
  assignee_person_dept_id?: string; // matrix drill: assignee's home dept (subtree) → assignees
  role_id?: string; // job-role drill — resolved to the assignees holding that role
  goal_id?: string;
  tag_ids?: string; // comma-separated; matches a task carrying ANY of them
  search?: string;
  from_date?: string;
  to_date?: string;
  /** "From workflows": 'true' = only tasks a workflow created; 'false' = only tasks people handed out. */
  from_workflows?: string;
}

/** How long the "task completed" notification is held so an Undo (the phone's 10s toast,
 * plus network slack) can cancel it before anyone hears of it. */
export const COMPLETION_NOTICE_HOLD_MS = 15_000;


/**
 * The activity-log entry for a tag change: tag NAMES (sorted, case-insensitive)
 * before and after, or `null` when the set of tags did not change.
 */
export function tagChangeEntry(
  from: TaskTagRef[],
  to: TaskTagRef[],
): { field: 'tags'; from: string[]; to: string[] } | null {
  const fromIds = new Set(from.map((t) => t.id));
  const toIds = new Set(to.map((t) => t.id));
  if (fromIds.size === toIds.size && [...toIds].every((id) => fromIds.has(id))) return null;
  const names = (refs: TaskTagRef[]) =>
    refs.map((t) => t.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { field: 'tags', from: names(from), to: names(to) };
}
