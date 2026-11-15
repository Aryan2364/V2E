import { failureStatuses } from '../failure'
import type { ColumnSpec, ImportIssue } from '../types'

export type TaskColumn =
  | 'title'
  | 'description'
  | 'priority'
  | 'category'
  | 'tags'
  | 'deadline_date'
  | 'deadline_time'
  | 'assignee_1'
  | 'assignee_2'
  | 'assignee_3'
  | 'assignee_4'
  | 'assignee_5'
  | 'cc_1'
  | 'cc_2'
  | 'cc_3'
  | 'completion_mode'
  | 'proof_required'
  | 'proof_allowed_types'
  | 'escalation_1'
  | 'escalation_2'
  | 'escalation_3'
  | 'linked_goal'
  | 'reminder_days_before'
  | 'checklist_template'
  | 'checklist_items'
  | 'attachments'
  | 'holiday_override'

/** Template column order (A..AA, 27 columns). */
export const TASK_COLUMNS: readonly ColumnSpec<TaskColumn>[] = [
  { key: 'title', label: 'title *', required: true, aliases: ['name', 'task', 'task_title'] },
  { key: 'description', label: 'description', aliases: ['desc'] },
  { key: 'priority', label: 'priority' },
  { key: 'category', label: 'category' },
  { key: 'tags', label: 'tags', aliases: ['tag'] },
  { key: 'deadline_date', label: 'deadline_date *', required: true, aliases: ['due_date', 'deadline'] },
  { key: 'deadline_time', label: 'deadline_time', aliases: ['due_time'] },
  { key: 'assignee_1', label: 'assignee_1 *', required: true, aliases: ['assignee'] },
  { key: 'assignee_2', label: 'assignee_2' },
  { key: 'assignee_3', label: 'assignee_3' },
  { key: 'assignee_4', label: 'assignee_4' },
  { key: 'assignee_5', label: 'assignee_5' },
  { key: 'cc_1', label: 'cc_1', aliases: ['cc'] },
  { key: 'cc_2', label: 'cc_2' },
  { key: 'cc_3', label: 'cc_3' },
  { key: 'completion_mode', label: 'completion_mode' },
  { key: 'proof_required', label: 'proof_required' },
  { key: 'proof_allowed_types', label: 'proof_allowed_types' },
  { key: 'escalation_1', label: 'escalation_1' },
  { key: 'escalation_2', label: 'escalation_2' },
  { key: 'escalation_3', label: 'escalation_3' },
  { key: 'linked_goal', label: 'linked_goal', aliases: ['goal'] },
  { key: 'reminder_days_before', label: 'reminder_days_before' },
  { key: 'checklist_template', label: 'checklist_template' },
  { key: 'checklist_items', label: 'checklist_items', aliases: ['checklist'] },
  { key: 'attachments', label: 'attachments' },
  { key: 'holiday_override', label: 'holiday_override' },
]

export const TASK_MISSING_COLUMNS =
  'Could not find the required "title" column. Download the template to see the expected format.'

// A single guide row is written under the header (row 2) spelling out each column's
// rule. Its title cell starts with GUIDE_MARKER so the importer always skips it:
// the user can leave it or delete it, either way it never becomes a task.
export const GUIDE_MARKER = '↳'

export const TASK_COLUMN_RULE: Record<TaskColumn, string> = {
  title: 'Required · ≤50 chars (Error) · repeats flagged (Warning)',
  description: '≤2000 chars (Error)',
  priority: 'Pick from list (Error if unknown)',
  category: 'Pick from list (Error if unknown)',
  tags: 'Comma-separated; each must match an existing tag',
  deadline_date: 'Required · today or later · YYYY-MM-DD (Error) · holiday/leave flagged (Warning)',
  deadline_time: 'HH:mm · defaults 23:59',
  assignee_1: 'Required · pick from list (Error)',
  assignee_2: 'Pick from list (Error if unknown)',
  assignee_3: 'Pick from list (Error if unknown)',
  assignee_4: 'Pick from list (Error if unknown)',
  assignee_5: 'Pick from list (Error if unknown)',
  cc_1: 'Pick from list (Error if unknown)',
  cc_2: 'Pick from list (Error if unknown)',
  cc_3: 'Pick from list (Error if unknown)',
  completion_mode: 'any_can_complete / all_must_complete',
  proof_required: 'Yes / No',
  proof_allowed_types: 'e.g. pdf | png (Warning if unknown)',
  escalation_1: 'Pick from list (Warning if same as assignee)',
  escalation_2: 'Pick from list',
  escalation_3: 'Pick from list',
  linked_goal: 'Pick from list (Error if unknown)',
  reminder_days_before: 'Whole number ≥ 0 (Error)',
  checklist_template: 'Pick a template you can use (Error)',
  checklist_items: 'Separate items with |',
  attachments: 'Filenames, separate with | · upload files in the app',
  holiday_override: 'Yes / No · keep a non-working-day date',
}

/** Fixed vocabulary for the exported failure_status column (sortable in Excel). */
export const TASK_FIELD_FAILURE_LABEL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  category: 'Category',
  tags: 'Tags',
  deadline_date: 'Deadline',
  deadline_time: 'Deadline',
  assignee_1: 'Assignee',
  assignee_2: 'Assignee',
  assignee_3: 'Assignee',
  assignee_4: 'Assignee',
  assignee_5: 'Assignee',
  cc_1: 'CC',
  cc_2: 'CC',
  cc_3: 'CC',
  completion_mode: 'Completion Mode',
  proof_allowed_types: 'Proof',
  escalation_1: 'Escalation',
  escalation_2: 'Escalation',
  escalation_3: 'Escalation',
  linked_goal: 'Goal',
  reminder_days_before: 'Reminder',
  checklist_template: 'Checklist',
}

export function taskFailureStatuses(row: { issues: readonly ImportIssue[] }): string[] {
  return failureStatuses(row.issues, TASK_FIELD_FAILURE_LABEL)
}

/** The deadline as an ISO instant in the browser's time zone (time defaults to 23:59), or undefined. */
export function deadlineIso(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '23:59'
  const d = new Date(`${date}T${t}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * Header cells to payload row. Returns null for the template's guide row (its title starts
 * with GUIDE_MARKER). The browser-local deadline instant is precomputed so the server never
 * shifts it.
 */
export function mapTaskRow(get: (k: TaskColumn) => string): Record<TaskColumn, string> & { deadline_iso?: string } | null {
  if (get('title').startsWith(GUIDE_MARKER)) return null
  const row = {} as Record<TaskColumn, string> & { deadline_iso?: string }
  for (const c of TASK_COLUMNS) row[c.key] = get(c.key)
  const iso = deadlineIso(row.deadline_date, row.deadline_time)
  if (iso) row.deadline_iso = iso
  return row
}

/** Lower-cased, trimmed name used to match attachment filenames. */
export function normName(s: string): string {
  return s.trim().toLowerCase()
}

/** Filenames referenced by the sheet's attachments column, across rows (deduped, lowercased). */
export function referencedAttachmentNames(rows: readonly { attachments?: string }[]): Set<string> {
  const set = new Set<string>()
  for (const r of rows) {
    for (const n of (r.attachments ?? '').split(/[|\n]/).map((s) => s.trim()).filter(Boolean)) set.add(normName(n))
  }
  return set
}
