import axios from 'axios'
import apiClient from './client'
import type {
  Task,
  TaskAttachment,
  TaskMasterConfig,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TaskComment,
  TaskActivityLog,
  TaskChecklistItem,
  RecurringTemplate,
  RecurringScheduleEntry,
  RecurringStats,
  TaskArchiveItem,
  ChecklistTemplate,
  ChecklistTemplateInput,
  BulkImportChecklistRow,
  ChecklistImportValidationResult,
  ChecklistImportResult,
  ChecklistImportBatchSummary,
  ChecklistUndoImportResult,
  TaskReportData,
  CollectiveOrgTasks,
  TaskDashboard,
  WorkFlow,
  PagedTasks,
  WorkQuery,
  PeopleTree,
  EmployeeReport,
  BulkAction,
  ReminderSpec,
  ProofVisibility,
  RecurringInstanceAttachment,
  RecurringTemplateList,
  RecurringListQuery,
  RecurringAccessPanel,
  RecurringAccessLevel,
  TaskTag,
  CreateTagInput,
  UpdateTagInput,
  DeleteTagResult,
  MergeTagResult,
  CreateTaskInput,
  UpdateTaskInput,
  BulkUpdatePayload,
  BulkUpdateResult,
} from '@/lib/types/tasks'

const base = (orgId: string) => `/api/v1/org/${orgId}/tasks`

/** A list filter as the server wants it: comma-separated, empties dropped. */
function csv(v: string[] | string | undefined | null): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(',')
  return v ?? ''
}

/**
 * Serialise a WorkQuery to a query string, dropping empty/undefined values. Arrays
 * (e.g. `tag_ids`) go out comma-separated — `tag_ids=a,b` — and an empty array is dropped.
 */
function workQs(query: WorkQuery): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    const value = Array.isArray(v) ? csv(v as string[]) : v
    if (value !== undefined && value !== null && value !== '') params.set(k, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

// ─── Tag errors ───────────────────────────────────────────────────────────────

/**
 * Thrown by `tasksApi.createTag` when the name matches a DEACTIVATED tag (HTTP 409).
 * `tagId` is that existing tag, so a caller allowed to manage tags can reactivate it
 * (`updateTag(orgId, tagId, { is_active: true })`) instead of creating a duplicate.
 * An exact match on an ACTIVE tag is not an error: the server returns that tag (200).
 */
export class TagConflictError extends Error {
  readonly status = 409 as const
  constructor(message: string, readonly tagId: string | null) {
    super(message)
    this.name = 'TagConflictError'
  }
}

export function isTagConflictError(e: unknown): e is TagConflictError {
  return e instanceof TagConflictError
}

/**
 * The server's human-readable message for a failed tag call (400 / 403 / 409 / 429),
 * or a plain fallback. Use it for the inline message under a tag field.
 */
export function tagErrorMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof TagConflictError) return e.message
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: unknown } | undefined
    if (typeof data?.message === 'string' && data.message) return data.message
    if (e.response?.status === 429) return 'Too many new tags in a short time. Try again later.'
  }
  return fallback
}

/** Lift a 409 from POST masters/tags into a TagConflictError; anything else passes through untouched. */
function asTagConflict(e: unknown): unknown {
  if (axios.isAxiosError(e) && e.response?.status === 409) {
    const data = (e.response.data ?? {}) as {
      message?: unknown
      tag_id?: unknown
      data?: { tag_id?: unknown } | null
    }
    const message =
      typeof data.message === 'string' && data.message ? data.message : 'That tag exists but is deactivated'
    const rawId = data.tag_id ?? data.data?.tag_id
    return new TagConflictError(message, typeof rawId === 'string' ? rawId : null)
  }
  return e
}

/** Deadline for tag list reads, so a stalled request reaches the error branch (kit §14.4). */
const TAG_REQUEST_TIMEOUT_MS = 15_000

// ─── Response unwrapper ───────────────────────────────────────────────────────

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

/**
 * Tolerate both the scoped `{ items, max_scope, applied_scope }` shape and the legacy
 * bare-array shape (e.g. while the dev server is still restarting on new code) so the
 * list never lands `undefined` in component state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecurringList(raw: any): RecurringTemplateList {
  if (Array.isArray(raw)) return { items: raw, max_scope: null, applied_scope: null }
  return { items: raw?.items ?? [], max_scope: raw?.max_scope ?? null, applied_scope: raw?.applied_scope ?? null }
}

// ─── Tasks API ────────────────────────────────────────────────────────────────

export const tasksApi = {
  // ── Masters ─────────────────────────────────────────────────────────────────

  // ── Tags (TASK_TAGS_PLAN.md §10.2) ──────────────────────────────────────────

  /** Org tag list, sorted by name. Active only unless `includeInactive`. Open to any org member. */
  getTags: async (orgId: string, opts: { includeInactive?: boolean } = {}): Promise<TaskTag[]> => {
    const qs = opts.includeInactive ? '?include_inactive=true' : ''
    const res = await apiClient.get(`${base(orgId)}/masters/tags${qs}`, { timeout: TAG_REQUEST_TIMEOUT_MS })
    return unwrap<TaskTag[]>(res) ?? []
  },

  /**
   * Create a tag, or get back the existing ACTIVE tag with the same name (case and
   * surrounding spaces ignored) — callers treat both the same.
   * @throws TagConflictError when the name matches a deactivated tag (409). It carries
   *   the server's message and the existing tag's id (`tagId`).
   * @throws the AxiosError for 400 / 403 (no create permission) / 429 (rate limit);
   *   read its message with `tagErrorMessage(e)`.
   */
  createTag: async (orgId: string, body: CreateTagInput): Promise<TaskTag> =>
    (await tasksApi.createTagDetailed(orgId, body)).tag,

  /**
   * `createTag`, but also says whether the server made a new tag (201, `created: true`)
   * or answered with the existing active tag of that name (200, `created: false`) — for
   * the Work Settings Tags tab, which must not present an existing tag as new.
   * Throws exactly as `createTag`.
   */
  createTagDetailed: async (orgId: string, body: CreateTagInput): Promise<{ tag: TaskTag; created: boolean }> => {
    try {
      const res = await apiClient.post(`${base(orgId)}/masters/tags`, body)
      return { tag: unwrap<TaskTag>(res), created: res.status === 201 }
    } catch (e) {
      throw asTagConflict(e)
    }
  },

  /** Rename / recolour / describe / (re)activate. 409 on a name collision — read it with tagErrorMessage. */
  updateTag: async (orgId: string, id: string, body: UpdateTagInput): Promise<TaskTag> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/tags/${id}`, body)
    return unwrap<TaskTag>(res)
  },

  /** Hard-deletes an unused tag; a tag in use is deactivated instead. The result says which. */
  deleteTag: async (orgId: string, id: string): Promise<DeleteTagResult> => {
    const res = await apiClient.delete(`${base(orgId)}/masters/tags/${id}`)
    return unwrap<DeleteTagResult>(res)
  },

  /** Move every use of tag `id` onto `intoId`, then delete `id`. */
  mergeTag: async (orgId: string, id: string, intoId: string): Promise<MergeTagResult> => {
    const res = await apiClient.post(`${base(orgId)}/masters/tags/${id}/merge`, { into_tag_id: intoId })
    return unwrap<MergeTagResult>(res)
  },

  getConfig: async (orgId: string): Promise<TaskMasterConfig> => {
    const res = await apiClient.get(`${base(orgId)}/masters/config`)
    return unwrap<TaskMasterConfig>(res)
  },

  updateConfig: async (orgId: string, dto: Partial<TaskMasterConfig>): Promise<TaskMasterConfig> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/config`, dto)
    return unwrap<TaskMasterConfig>(res)
  },

  getCategories: async (orgId: string): Promise<TaskCategory[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/categories`)
    return unwrap<TaskCategory[]>(res)
  },

  createCategory: async (orgId: string, dto: Omit<TaskCategory, 'id' | 'organization_id' | 'created_at'>): Promise<TaskCategory> => {
    const res = await apiClient.post(`${base(orgId)}/masters/categories`, dto)
    return unwrap<TaskCategory>(res)
  },

  updateCategory: async (orgId: string, id: string, dto: Partial<TaskCategory>): Promise<TaskCategory> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/categories/${id}`, dto)
    return unwrap<TaskCategory>(res)
  },

  deleteCategory: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/masters/categories/${id}`)
  },

  getPriorities: async (orgId: string): Promise<TaskPriority[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/priorities`)
    return unwrap<TaskPriority[]>(res)
  },

  createPriority: async (orgId: string, dto: Omit<TaskPriority, 'id' | 'organization_id'>): Promise<TaskPriority> => {
    const res = await apiClient.post(`${base(orgId)}/masters/priorities`, dto)
    return unwrap<TaskPriority>(res)
  },

  updatePriority: async (orgId: string, id: string, dto: Partial<TaskPriority>): Promise<TaskPriority> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/priorities/${id}`, dto)
    return unwrap<TaskPriority>(res)
  },

  deletePriority: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/masters/priorities/${id}`)
  },

  reorderPriorities: async (orgId: string, items: { id: string; order_index: number }[]): Promise<TaskPriority[]> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/priorities/reorder`, { items })
    return unwrap<TaskPriority[]>(res)
  },

  getStatuses: async (orgId: string): Promise<TaskStatus[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/statuses`)
    return unwrap<TaskStatus[]>(res)
  },

  createStatus: async (orgId: string, dto: Omit<TaskStatus, 'id' | 'organization_id'>): Promise<TaskStatus> => {
    const res = await apiClient.post(`${base(orgId)}/masters/statuses`, dto)
    return unwrap<TaskStatus>(res)
  },

  updateStatus: async (orgId: string, id: string, dto: Partial<TaskStatus>): Promise<TaskStatus> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/statuses/${id}`, dto)
    return unwrap<TaskStatus>(res)
  },

  deleteStatus: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/masters/statuses/${id}`)
  },

  reorderStatuses: async (orgId: string, items: { id: string; order_index: number }[]): Promise<TaskStatus[]> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/statuses/reorder`, { items })
    return unwrap<TaskStatus[]>(res)
  },

  getChecklistTemplates: async (orgId: string): Promise<ChecklistTemplate[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/checklist-templates`)
    return unwrap<ChecklistTemplate[]>(res)
  },

  // Templates the current user is allowed to apply when creating a task.
  getAccessibleChecklistTemplates: async (orgId: string): Promise<ChecklistTemplate[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/checklist-templates/accessible`)
    return unwrap<ChecklistTemplate[]>(res)
  },

  createChecklistTemplate: async (orgId: string, dto: ChecklistTemplateInput): Promise<ChecklistTemplate> => {
    const res = await apiClient.post(`${base(orgId)}/masters/checklist-templates`, dto)
    return unwrap<ChecklistTemplate>(res)
  },

  updateChecklistTemplate: async (orgId: string, id: string, dto: Partial<ChecklistTemplateInput>): Promise<ChecklistTemplate> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/checklist-templates/${id}`, dto)
    return unwrap<ChecklistTemplate>(res)
  },

  deleteChecklistTemplate: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/masters/checklist-templates/${id}`)
  },

  // ── Checklist template bulk import ─────────────────────────────────────────────

  validateChecklistImport: async (orgId: string, rows: BulkImportChecklistRow[]): Promise<ChecklistImportValidationResult> => {
    const res = await apiClient.post(`${base(orgId)}/masters/checklist-templates/bulk-import/validate`, { rows })
    return unwrap<ChecklistImportValidationResult>(res)
  },

  commitChecklistImport: async (orgId: string, rows: BulkImportChecklistRow[], fileName?: string): Promise<ChecklistImportResult> => {
    const res = await apiClient.post(`${base(orgId)}/masters/checklist-templates/bulk-import/commit`, { rows, file_name: fileName })
    return unwrap<ChecklistImportResult>(res)
  },

  listChecklistImportBatches: async (orgId: string): Promise<ChecklistImportBatchSummary[]> => {
    const res = await apiClient.get(`${base(orgId)}/masters/checklist-templates/imports`)
    return unwrap<ChecklistImportBatchSummary[]>(res)
  },

  undoChecklistImport: async (orgId: string, batchId: string): Promise<ChecklistUndoImportResult> => {
    const res = await apiClient.post(`${base(orgId)}/masters/checklist-templates/imports/${batchId}/undo`, {})
    return unwrap<ChecklistUndoImportResult>(res)
  },

  // ── Tasks ────────────────────────────────────────────────────────────────────

  listTasks: async (orgId: string, filters?: Record<string, string>): Promise<Task[]> => {
    const params = filters ? new URLSearchParams(filters).toString() : ''
    const res = await apiClient.get(`${base(orgId)}${params ? `?${params}` : ''}`)
    return unwrap<Task[]>(res)
  },

  // ── Work dashboard (scope-aware canvas) ───────────────────────────────────────

  getDashboard: async (orgId: string, query: WorkQuery = {}): Promise<TaskDashboard> => {
    const res = await apiClient.get(`${base(orgId)}/dashboard${workQs(query)}`)
    return unwrap<TaskDashboard>(res)
  },

  getWorkFlow: async (orgId: string, query: WorkQuery = {}): Promise<WorkFlow> => {
    const res = await apiClient.get(`${base(orgId)}/flow${workQs(query)}`)
    return unwrap<WorkFlow>(res)
  },

  listTasksPaged: async (orgId: string, query: WorkQuery = {}): Promise<PagedTasks> => {
    const res = await apiClient.get(`${base(orgId)}/paged${workQs(query)}`)
    return unwrap<PagedTasks>(res)
  },

  getPeopleTree: async (orgId: string, query: WorkQuery = {}): Promise<PeopleTree> => {
    const res = await apiClient.get(`${base(orgId)}/people-tree${workQs(query)}`)
    return unwrap<PeopleTree>(res)
  },

  getEmployeeReport: async (orgId: string, userId: string, query: WorkQuery = {}): Promise<EmployeeReport> => {
    const res = await apiClient.get(`${base(orgId)}/people/${userId}/report${workQs(query)}`)
    return unwrap<EmployeeReport>(res)
  },

  exportWork: async (orgId: string, query: WorkQuery = {}): Promise<{ csv: string; count: number }> => {
    const res = await apiClient.get(`${base(orgId)}/export${workQs(query)}`)
    return unwrap<{ csv: string; count: number }>(res)
  },

  bulkUpdate: async (orgId: string, taskIds: string[], action: BulkAction, payload: BulkUpdatePayload = {}): Promise<BulkUpdateResult> => {
    const res = await apiClient.post(`${base(orgId)}/bulk`, { task_ids: taskIds, action, ...payload })
    return unwrap<BulkUpdateResult>(res)
  },

  getMyTasks: async (orgId: string): Promise<Task[]> => {
    const res = await apiClient.get(`${base(orgId)}/my`)
    return unwrap<Task[]>(res)
  },

  getMyCCTasks: async (orgId: string): Promise<Task[]> => {
    const res = await apiClient.get(`${base(orgId)}/cc`)
    return unwrap<Task[]>(res)
  },

  getAssignedByMe: async (orgId: string): Promise<Task[]> => {
    const res = await apiClient.get(`${base(orgId)}/assigned-by-me`)
    return unwrap<Task[]>(res)
  },

  getEscalated: async (orgId: string): Promise<Task[]> => {
    const res = await apiClient.get(`${base(orgId)}/escalated`)
    return unwrap<Task[]>(res)
  },

  createTask: async (orgId: string, dto: CreateTaskInput): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}`, dto)
    return unwrap<Task>(res)
  },

  getTask: async (orgId: string, taskId: string): Promise<Task> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}`)
    return unwrap<Task>(res)
  },

  updateTask: async (orgId: string, taskId: string, dto: UpdateTaskInput): Promise<Task> => {
    const res = await apiClient.patch(`${base(orgId)}/${taskId}`, dto)
    return unwrap<Task>(res)
  },

  deleteTask: async (orgId: string, taskId: string, reason?: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${taskId}`, { data: { reason } })
  },

  completeTask: async (orgId: string, taskId: string, closeWholeTask = false): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/complete`, { close_whole_task: closeWholeTask })
    return unwrap<Task>(res)
  },

  /** Mark a specific assignee's part done (creator/editor, all_must_complete). */
  completeAssignee: async (orgId: string, taskId: string, userId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/assignees/${userId}/complete`)
    return unwrap<Task>(res)
  },

  /** all_must_complete: creator/editor reopens one person's finished part for rework. */
  reopenAssigneePart: async (orgId: string, taskId: string, userId: string, reason?: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/assignees/${userId}/reopen`, { reason })
    return unwrap<Task>(res)
  },

  /** Set a per-person status track (all_must_complete). Omit user_id to set your own. */
  setAssigneeStatus: async (orgId: string, taskId: string, status_id: string, user_id?: string): Promise<Task> => {
    const res = await apiClient.patch(`${base(orgId)}/${taskId}/assignee-status`, { status_id, user_id })
    return unwrap<Task>(res)
  },

  /** Move the single shared status (any_can_complete). */
  setSharedStatus: async (orgId: string, taskId: string, status_id: string): Promise<Task> => {
    const res = await apiClient.patch(`${base(orgId)}/${taskId}/shared-status`, { status_id })
    return unwrap<Task>(res)
  },

  reopenTask: async (orgId: string, taskId: string, reason?: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/reopen`, { reason })
    return unwrap<Task>(res)
  },

  // Close the whole task as Incomplete/not-done (reason required).
  markIncomplete: async (orgId: string, taskId: string, reason: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/incomplete`, { reason })
    return unwrap<Task>(res)
  },

  // all_must_complete: an assignee closes their own part as incomplete (reason required).
  // This is a deliberate, final choice by that person — there is no un-flag.
  flagCannotComplete: async (orgId: string, taskId: string, reason: string, userId?: string): Promise<Task> => {
    const target = userId ?? 'me'
    const res = await apiClient.post(`${base(orgId)}/${taskId}/assignees/${target}/cannot-complete`, { reason })
    return unwrap<Task>(res)
  },

  // ── Proof of completion (file uploads → R2, visibility-gated) ──────────────

  /** Upload a proof file for the current user's part. visibility ignored in any_can mode. */
  uploadProof: async (
    orgId: string,
    taskId: string,
    file: File,
    visibility: ProofVisibility = 'private',
    onProgress?: (pct: number) => void,
  ): Promise<TaskAttachment> => {
    const form = new FormData()
    form.append('file', file)
    form.append('visibility', visibility)
    const res = await apiClient.post(`${base(orgId)}/${taskId}/proof`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    return unwrap<TaskAttachment>(res)
  },

  /** Promote a file already shared in a comment to be the current user's proof. */
  markCommentAttachmentAsProof: async (orgId: string, taskId: string, attachmentId: string): Promise<TaskAttachment> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/proof/from-comment/${attachmentId}`, {})
    return unwrap<TaskAttachment>(res)
  },

  /** Proof files the current viewer is allowed to see. */
  listProofs: async (orgId: string, taskId: string): Promise<TaskAttachment[]> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/proofs`)
    return unwrap<TaskAttachment[]>(res)
  },

  /** Resolve a short-lived signed URL for a proof then trigger the browser download. */
  downloadProof: async (orgId: string, taskId: string, attachmentId: string): Promise<void> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/proofs/${attachmentId}/download`)
    const { url } = unwrap<{ url: string; file_name: string }>(res)
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  },

  getLogs: async (orgId: string, taskId: string): Promise<TaskActivityLog[]> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/logs`)
    return unwrap<TaskActivityLog[]>(res)
  },

  getComments: async (orgId: string, taskId: string): Promise<TaskComment[]> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/comments`)
    return unwrap<TaskComment[]>(res)
  },

  addComment: async (orgId: string, taskId: string, body: string, reply_to?: string): Promise<TaskComment> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/comments`, { body, reply_to_comment_id: reply_to })
    return unwrap<TaskComment>(res)
  },

  deleteComment: async (orgId: string, taskId: string, commentId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${taskId}/comments/${commentId}`)
  },

  // ── Attachments (real document upload → R2) ────────────────────────────────

  listAttachments: async (orgId: string, taskId: string): Promise<TaskAttachment[]> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/attachments`)
    return unwrap<TaskAttachment[]>(res)
  },

  // Every attachment on the task — task-level + files shared in comments.
  listAllAttachments: async (orgId: string, taskId: string): Promise<TaskAttachment[]> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/attachments/all`)
    return unwrap<TaskAttachment[]>(res)
  },

  uploadTaskAttachment: async (
    orgId: string,
    taskId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<TaskAttachment> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`${base(orgId)}/${taskId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    return unwrap<TaskAttachment>(res)
  },

  uploadCommentAttachment: async (
    orgId: string,
    taskId: string,
    commentId: string,
    file: File,
  ): Promise<TaskAttachment> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(
      `${base(orgId)}/${taskId}/comments/${commentId}/attachments`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return unwrap<TaskAttachment>(res)
  },

  /** Resolve a short-lived signed URL then trigger the browser download. */
  downloadAttachment: async (orgId: string, taskId: string, attachmentId: string): Promise<void> => {
    const res = await apiClient.get(`${base(orgId)}/${taskId}/attachments/${attachmentId}/download`)
    const { url } = unwrap<{ url: string; file_name: string }>(res)
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  },

  deleteAttachment: async (orgId: string, taskId: string, attachmentId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${taskId}/attachments/${attachmentId}`)
  },

  // ── Checklist (per-person in all_must_complete; shared otherwise). Each returns the
  //    refreshed task so per-person states + aggregate counts stay in sync. ──
  checkChecklistItem: async (orgId: string, taskId: string, itemId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/check`)
    return unwrap<Task>(res)
  },

  uncheckChecklistItem: async (orgId: string, taskId: string, itemId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/uncheck`)
    return unwrap<Task>(res)
  },

  // all_must_complete: mark an item "can't do" with a required reason.
  skipChecklistItem: async (orgId: string, taskId: string, itemId: string, reason: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/skip`, { reason })
    return unwrap<Task>(res)
  },

  // Assigner: mark an item done for everyone / undo that override.
  overrideChecklistItem: async (orgId: string, taskId: string, itemId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/override`)
    return unwrap<Task>(res)
  },

  clearChecklistOverride: async (orgId: string, taskId: string, itemId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/clear-override`)
    return unwrap<Task>(res)
  },

  // Assigner: challenge one person's item — reopens just their part and resets the item.
  challengeChecklistItem: async (orgId: string, taskId: string, itemId: string, userId: string): Promise<Task> => {
    const res = await apiClient.post(`${base(orgId)}/${taskId}/checklist/${itemId}/challenge`, { user_id: userId })
    return unwrap<Task>(res)
  },

  addAssignee: async (orgId: string, taskId: string, user_id: string, is_cc: boolean): Promise<void> => {
    await apiClient.post(`${base(orgId)}/${taskId}/assignees`, { user_id, is_cc })
  },

  removeAssignee: async (orgId: string, taskId: string, userId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${taskId}/assignees/${userId}`)
  },

  getArchive: async (orgId: string): Promise<TaskArchiveItem[]> => {
    const res = await apiClient.get(`${base(orgId)}/archive`)
    return unwrap<TaskArchiveItem[]>(res)
  },

  // ── Recurring ────────────────────────────────────────────────────────────────

  // Simple array (default scope) — used where the caller just needs the templates
  // it can see, e.g. resolving the current one on the detail page.
  getRecurringTemplates: async (orgId: string): Promise<RecurringTemplate[]> => {
    const res = await apiClient.get(`${base(orgId)}/recurring`)
    return normalizeRecurringList(unwrap(res)).items
  },

  // Scope + relation + filter aware list, with the viewer's authority ceiling.
  listRecurringTemplates: async (orgId: string, query: RecurringListQuery = {}): Promise<RecurringTemplateList> => {
    const params = new URLSearchParams()
    if (query.scope) params.set('scope', query.scope)
    if (query.relation) params.set('relation', query.relation)
    if (query.status) params.set('status', query.status)
    if (query.category_id) params.set('category_id', query.category_id)
    if (query.priority_id) params.set('priority_id', query.priority_id)
    if (query.department_id) params.set('department_id', query.department_id)
    const tagIds = csv(query.tag_ids)
    if (tagIds) params.set('tag_ids', tagIds)
    if (query.search) params.set('search', query.search)
    const qs = params.toString()
    const res = await apiClient.get(`${base(orgId)}/recurring${qs ? `?${qs}` : ''}`)
    return normalizeRecurringList(unwrap(res))
  },

  // ── Recurring template access (Google-Drive-style sharing) ────────────────────
  getRecurringAccess: async (orgId: string, id: string): Promise<RecurringAccessPanel> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${id}/access`)
    return unwrap<RecurringAccessPanel>(res)
  },
  setRecurringAccess: async (
    orgId: string,
    id: string,
    body: { user_id: string; kind: 'grant' | 'revoke'; level?: RecurringAccessLevel },
  ): Promise<RecurringAccessPanel> => {
    const res = await apiClient.post(`${base(orgId)}/recurring/${id}/access`, body)
    return unwrap<RecurringAccessPanel>(res)
  },
  clearRecurringAccess: async (orgId: string, id: string, userId: string): Promise<RecurringAccessPanel> => {
    const res = await apiClient.delete(`${base(orgId)}/recurring/${id}/access/${userId}`)
    return unwrap<RecurringAccessPanel>(res)
  },

  createRecurring: async (orgId: string, dto: {
    title: string
    description?: string
    category_id?: string
    priority_id?: string
    schedule_entries: Omit<RecurringScheduleEntry, 'id' | 'organization_id' | 'recurring_template_id' | 'occurrence_count' | 'is_active' | 'created_at' | 'updated_at'>[]
    completion_mode?: string
    proof_required?: boolean
    proof_allowed_extensions?: string[]
    escalation_user_ids?: string[]
    linked_goal_id?: string
    assignee_user_ids?: string[]
    cc_user_ids?: string[]
    checklist_items?: { title: string; order_index: number; group_title?: string }[]
    reminders?: ReminderSpec[]
    department_id?: string
    /** Copied onto every spawned instance. */
    tag_ids?: string[]
  }): Promise<RecurringTemplate> => {
    const res = await apiClient.post(`${base(orgId)}/recurring`, dto)
    return unwrap<RecurringTemplate>(res)
  },

  // Upload a document to a recurring template — copied into every spawned instance.
  uploadRecurringAttachment: async (
    orgId: string,
    templateId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<TaskAttachment> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`${base(orgId)}/recurring/${templateId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    return unwrap<TaskAttachment>(res)
  },

  listRecurringAttachments: async (orgId: string, templateId: string): Promise<TaskAttachment[]> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${templateId}/attachments`)
    return unwrap<TaskAttachment[]>(res)
  },

  listRecurringInstanceAttachments: async (orgId: string, templateId: string): Promise<RecurringInstanceAttachment[]> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${templateId}/instance-attachments`)
    return unwrap<RecurringInstanceAttachment[]>(res)
  },


  downloadRecurringAttachment: async (orgId: string, templateId: string, attachmentId: string): Promise<void> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${templateId}/attachments/${attachmentId}/download`)
    const { url } = unwrap<{ url: string; file_name: string }>(res)
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  },

  deleteRecurringAttachment: async (orgId: string, templateId: string, attachmentId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/recurring/${templateId}/attachments/${attachmentId}`)
  },

  updateRecurring: async (orgId: string, id: string, dto: Partial<{
    title: string
    description: string
    category_id: string
    priority_id: string
    schedule_entries: Partial<RecurringScheduleEntry>[]
    completion_mode: string
    proof_required: boolean
    proof_allowed_extensions: string[]
    escalation_user_ids: string[]
    linked_goal_id: string
    assignee_user_ids: string[]
    cc_user_ids: string[]
    checklist_items: { title: string; order_index: number; group_title?: string }[]
    reminders: ReminderSpec[]
    department_id: string
    /** Full list; affects future spawns only. `[]` clears. */
    tag_ids: string[]
  }>): Promise<RecurringTemplate> => {
    const res = await apiClient.patch(`${base(orgId)}/recurring/${id}`, dto)
    return unwrap<RecurringTemplate>(res)
  },

  pauseRecurring: async (orgId: string, id: string): Promise<RecurringTemplate> => {
    const res = await apiClient.post(`${base(orgId)}/recurring/${id}/pause`)
    return unwrap<RecurringTemplate>(res)
  },

  resumeRecurring: async (orgId: string, id: string): Promise<RecurringTemplate> => {
    const res = await apiClient.post(`${base(orgId)}/recurring/${id}/resume`)
    return unwrap<RecurringTemplate>(res)
  },

  spawnTodayRecurring: async (orgId: string, id: string): Promise<{ spawned: number }> => {
    const res = await apiClient.post(`${base(orgId)}/recurring/${id}/spawn-today`)
    return unwrap<{ spawned: number }>(res)
  },

  deleteRecurring: async (orgId: string, id: string, mode: 'stop' | 'delete-future' | 'delete-all' = 'stop'): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/recurring/${id}?mode=${mode}`)
  },

  getRecurringInstances: async (orgId: string, id: string): Promise<Task[]> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${id}/instances`)
    return unwrap<Task[]>(res)
  },

  getRecurringStats: async (orgId: string, id: string): Promise<RecurringStats> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${id}/stats`)
    return unwrap<RecurringStats>(res)
  },

  listScheduleEntries: async (orgId: string, templateId: string): Promise<RecurringScheduleEntry[]> => {
    const res = await apiClient.get(`${base(orgId)}/recurring/${templateId}/schedules`)
    return unwrap<RecurringScheduleEntry[]>(res)
  },

  addScheduleEntry: async (orgId: string, templateId: string, dto: Partial<RecurringScheduleEntry>): Promise<RecurringScheduleEntry> => {
    const res = await apiClient.post(`${base(orgId)}/recurring/${templateId}/schedules`, dto)
    return unwrap<RecurringScheduleEntry>(res)
  },

  updateScheduleEntry: async (orgId: string, templateId: string, entryId: string, dto: Partial<RecurringScheduleEntry>): Promise<RecurringScheduleEntry> => {
    const res = await apiClient.patch(`${base(orgId)}/recurring/${templateId}/schedules/${entryId}`, dto)
    return unwrap<RecurringScheduleEntry>(res)
  },

  deleteScheduleEntry: async (orgId: string, templateId: string, entryId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/recurring/${templateId}/schedules/${entryId}`)
  },

  getReports: async (orgId: string, params?: { from_date?: string; to_date?: string }): Promise<TaskReportData> => {
    const qs = params ? new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString() : ''
    const res = await apiClient.get(`${base(orgId)}/reports${qs ? `?${qs}` : ''}`)
    return unwrap<TaskReportData>(res)
  },

  getCollective: async (): Promise<CollectiveOrgTasks[]> => {
    const res = await apiClient.get('/api/v1/my-tasks/collective')
    return unwrap<CollectiveOrgTasks[]>(res)
  },

  getEligibleAssignees: async (orgId: string, search?: string, sort?: 'frequency' | 'workload' | 'name'): Promise<import('@/lib/types/tasks').EligibleAssigneesResponse> => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (sort) params.set('sort', sort)
    const qs = params.toString()
    const res = await apiClient.get(`${base(orgId)}/eligible-assignees${qs ? `?${qs}` : ''}`)
    return unwrap<import('@/lib/types/tasks').EligibleAssigneesResponse>(res)
  },

  updateAssigneeVisibility: async (orgId: string, dto: {
    assignee_visibility_mode?: string
    assignee_custom_rules?: Record<string, unknown>
    assignee_visibility_config_roles?: string[]
  }): Promise<void> => {
    await apiClient.patch(`${base(orgId)}/masters/assignee-visibility`, dto)
  },

  // ── Assignee Visibility (admin model) ─────────────────────────────────────────

  getAssigneeVisibility: async (orgId: string): Promise<import('@/lib/types/tasks').AssigneeVisibilityAdminView> => {
    const res = await apiClient.get(`${base(orgId)}/masters/assignee-visibility`)
    return unwrap(res)
  },

  updateAssigneeSettings: async (
    orgId: string,
    dto: Partial<import('@/lib/types/tasks').AssigneeVisibilitySettings>,
  ): Promise<import('@/lib/types/tasks').AssigneeVisibilitySettings> => {
    const res = await apiClient.put(`${base(orgId)}/masters/assignee-visibility/settings`, dto)
    return unwrap(res)
  },

  createAssigneeBridge: async (
    orgId: string,
    dto: {
      from_department_id: string
      to_department_id: string
      depth: import('@/lib/types/tasks').BridgeDepth
      include_sub_departments?: boolean
    },
  ): Promise<void> => {
    await apiClient.post(`${base(orgId)}/masters/assignee-visibility/bridges`, dto)
  },

  deleteAssigneeBridge: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/masters/assignee-visibility/bridges/${id}`)
  },

  setDepartmentUpward: async (
    orgId: string,
    dto: { department_id: string; allow: boolean },
  ): Promise<void> => {
    await apiClient.patch(`${base(orgId)}/masters/assignee-visibility/department-upward`, dto)
  },

  setDepartmentUnify: async (
    orgId: string,
    dto: { department_id: string; unify: boolean },
  ): Promise<void> => {
    await apiClient.patch(`${base(orgId)}/masters/assignee-visibility/department-unify`, dto)
  },

  explainAssignee: async (
    orgId: string,
    userId: string,
  ): Promise<import('@/lib/types/tasks').AssigneeExplainResult> => {
    const res = await apiClient.get(
      `${base(orgId)}/masters/assignee-visibility/explain?userId=${encodeURIComponent(userId)}`,
    )
    return unwrap(res)
  },

  // ── Per-employee assignee editor (most-granular layer) ──
  getEmployeeAssigneePreview: async (
    orgId: string,
    userId: string,
    search?: string,
  ): Promise<import('@/lib/types/tasks').EmployeeAssigneePreview> => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : ''
    const res = await apiClient.get(`${base(orgId)}/eligible-assignees-for/${encodeURIComponent(userId)}${qs}`)
    return unwrap(res)
  },

  setEmployeeManualOverride: async (
    orgId: string,
    dto: { employee_user_id: string; added_user_ids: string[]; removed_user_ids: string[] },
  ): Promise<import('@/lib/types/tasks').EmployeeManualOverride> => {
    const res = await apiClient.patch(`${base(orgId)}/masters/assignee-visibility/employee-override`, dto)
    return unwrap(res)
  },
}
