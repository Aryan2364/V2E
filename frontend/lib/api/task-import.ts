import apiClient from './client'
import type { ApiResponse } from '../types'

// One row of the task import sheet. All values are strings (the sheet's cells);
// `deadline_iso` is a hidden, frontend-computed field carrying the browser-local
// instant so deadlines aren't shifted by the server timezone.
export interface BulkTaskImportRow {
  title?: string
  description?: string
  priority?: string
  category?: string
  /** Tag names, pipe- or newline-separated; each must match an existing active tag. */
  tags?: string
  deadline_date?: string
  deadline_time?: string
  deadline_iso?: string
  assignee_1?: string
  assignee_2?: string
  assignee_3?: string
  assignee_4?: string
  assignee_5?: string
  cc_1?: string
  cc_2?: string
  cc_3?: string
  completion_mode?: string
  proof_required?: string
  proof_allowed_types?: string
  escalation_1?: string
  escalation_2?: string
  escalation_3?: string
  linked_goal?: string
  reminder_days_before?: string
  checklist_template?: string
  checklist_items?: string
  attachments?: string
  holiday_override?: string
}

// ─── Import options (reference data for the template) ─────────────────────────────

export interface TaskImportOptions {
  priorities: { id: string; label: string }[]
  categories: { id: string; name: string }[]
  /** Active tags — the valid values for the `tags` column (the Excel "Tags" sheet). */
  tags: { id: string; name: string }[]
  goals: { id: string; title: string }[]
  checklist_templates: { id: string; name: string }[]
  assignees: {
    user_id: string
    name: string
    department_name: string | null
    role_title: string | null
    value: string
  }[]
  proof_extension_groups: { label: string; extensions: string[] }[]
  slots: { assignees: number; cc: number; escalations: number }
}

export async function getImportOptions(orgId: string): Promise<TaskImportOptions> {
  const { data } = await apiClient.get<ApiResponse<TaskImportOptions>>(
    `/api/v1/org/${orgId}/tasks/bulk-import/options`,
  )
  return data.data
}

// ─── Validation (dry-run) ─────────────────────────────────────────────────────────

export interface TaskImportRowIssue {
  field?: string
  message: string
  severity: 'error' | 'warning'
}

export interface TaskImportResolved {
  priority?: string
  category?: string
  /** Resolved ids of the row's `tags` cell. An unknown name is a row error instead. */
  tag_ids?: string[]
  /** Matched tag names, for the preview. */
  tags?: string[]
  deadline?: string
  assignees?: string[]
  cc?: string[]
  escalations?: string[]
  goal?: string
  checklist_template?: string
  checklist_item_count?: number
  attachment_names?: string[]
}

export interface TaskImportValidationRow {
  row: number
  title: string
  status: 'ready' | 'error'
  resolved: TaskImportResolved
  issues: TaskImportRowIssue[]
}

export interface TaskImportValidationResult {
  total: number
  ready: number
  errors: number
  warnings: number
  rows: TaskImportValidationRow[]
}

export async function validateTaskImport(
  orgId: string,
  rows: BulkTaskImportRow[],
): Promise<TaskImportValidationResult> {
  const { data } = await apiClient.post<ApiResponse<TaskImportValidationResult>>(
    `/api/v1/org/${orgId}/tasks/bulk-import/validate`,
    { rows },
  )
  return data.data
}

// ─── Commit ─────────────────────────────────────────────────────────────────────

export interface TaskImportRowResult {
  row: number
  title: string
  status: 'created' | 'failed'
  error?: string
  task_id?: string
  attachment_names?: string[]
}

export interface TaskImportResult {
  batch_id: string | null
  created: number
  failed: number
  results: TaskImportRowResult[]
}

export async function commitTaskImport(
  orgId: string,
  rows: BulkTaskImportRow[],
  fileName?: string,
): Promise<TaskImportResult> {
  const { data } = await apiClient.post<ApiResponse<TaskImportResult>>(
    `/api/v1/org/${orgId}/tasks/bulk-import/commit`,
    { rows, file_name: fileName },
  )
  return data.data
}

// ─── History + undo ───────────────────────────────────────────────────────────────

export interface TaskUndoKeptRow {
  title: string
  reason: string
}

export interface TaskUndoImportResult {
  batch_id: string
  undone: number
  kept: TaskUndoKeptRow[]
  status: 'committed' | 'undone' | 'partially_undone'
}

export interface TaskImportBatchSummary {
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

export interface TaskImportBatchDetailRow {
  row: number
  title: string | null
  status: 'created' | 'failed'
  error: string | null
  still_present: boolean
  data: Record<string, string>
}

export interface TaskImportBatchDetail extends TaskImportBatchSummary {
  undo_summary: { undone: number; kept: TaskUndoKeptRow[] } | null
  rows: TaskImportBatchDetailRow[]
  rows_reconstructed: boolean
}

export async function listTaskImportBatches(orgId: string): Promise<TaskImportBatchSummary[]> {
  const { data } = await apiClient.get<ApiResponse<TaskImportBatchSummary[]>>(
    `/api/v1/org/${orgId}/tasks/imports`,
  )
  return data.data
}

export async function getTaskImportBatchDetail(
  orgId: string,
  batchId: string,
): Promise<TaskImportBatchDetail> {
  const { data } = await apiClient.get<ApiResponse<TaskImportBatchDetail>>(
    `/api/v1/org/${orgId}/tasks/imports/${batchId}`,
  )
  return data.data
}

export async function undoTaskImport(orgId: string, batchId: string): Promise<TaskUndoImportResult> {
  const { data } = await apiClient.post<ApiResponse<TaskUndoImportResult>>(
    `/api/v1/org/${orgId}/tasks/imports/${batchId}/undo`,
    {},
  )
  return data.data
}
