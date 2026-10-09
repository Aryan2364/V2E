import axios from 'axios'
import apiClient from './client'
import type {
  WorkflowTemplate,
  SavedWorkflow,
  WorkflowDefinitionInput,
  WorkflowInstance,
  WorkflowMeta,
  OrgMemberOption,
  WorkflowRunEvent,
  RunDocuments,
  RunFile,
  SendBackTarget,
  TimelinePreview,
  WorkflowStepContext,
} from '@/lib/types/workflows'

const base = (orgId: string) => `/api/v1/org/${orgId}/workflows`

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as { data?: T } | null
  return d && typeof d === 'object' && 'data' in d && d.data !== undefined ? (d.data as T) : (res.data as T)
}

/**
 * The server's human-readable message for a failed workflows call, or a plain fallback.
 * Nest sends `message` as a string, or an array of validation messages.
 */
export function workflowErrorMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return 'We could not reach the server. Check your connection and try again.'
    const data = e.response.data as { message?: unknown } | undefined
    const msg = data?.message
    if (typeof msg === 'string' && msg.trim()) return msg
    if (Array.isArray(msg) && msg.length && typeof msg[0] === 'string') return msg.join(' ')
    if (e.response.status === 403) return 'You are not allowed to do this.'
    if (e.response.status === 404) return 'This item no longer exists, or you cannot see it.'
  }
  return fallback
}

/**
 * What a refused save points at: a step (`step_key` — the key it was sent with — and its
 * `step_id` once saved), a track (`code: 'track_invalid'`, `track_key`) or "How it
 * starts" (`code: 'starts_invalid'`, `schedule_index`).
 */
export function workflowErrorTarget(e: unknown): {
  code: string | null
  stepKey: string | null
  stepId: string | null
  trackKey: string | null
  scheduleIndex: number | null
} {
  const none = { code: null, stepKey: null, stepId: null, trackKey: null, scheduleIndex: null }
  if (!axios.isAxiosError(e)) return none
  const raw = e.response?.data as Record<string, unknown> | undefined
  const data = (raw && typeof raw.data === 'object' && raw.data ? (raw.data as Record<string, unknown>) : raw) ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    code: str(data.code) ?? str(raw?.code),
    stepKey: str(data.step_key) ?? str(raw?.step_key),
    stepId: str(data.step_id) ?? str(raw?.step_id),
    trackKey: str(data.track_key) ?? str(raw?.track_key),
    scheduleIndex: typeof data.schedule_index === 'number' ? data.schedule_index : typeof raw?.schedule_index === 'number' ? (raw.schedule_index as number) : null,
  }
}

/** HTTP status of a failed call, if any. */
export function workflowErrorStatus(e: unknown): number | undefined {
  return axios.isAxiosError(e) ? e.response?.status : undefined
}

/** Every request gets a deadline so nothing spins for ever. */
const T = { timeout: 30000 }

export const workflowsApi = {
  // ── Meta / masters ──────────────────────────────────────────────────────────

  getMeta: async (orgId: string): Promise<WorkflowMeta> =>
    unwrap<WorkflowMeta>(await apiClient.get(`${base(orgId)}/meta`, T)),

  /** Active org members — open to every member (users/members). */
  listMembers: async (orgId: string): Promise<OrgMemberOption[]> => {
    const rows = unwrap<{ user_id: string; user: { id: string; name: string; email?: string | null } }[]>(
      await apiClient.get(`/api/v1/org/${orgId}/users/members`, T),
    )
    return (rows ?? [])
      .filter((r) => r?.user?.name)
      .map((r) => ({ user_id: r.user_id ?? r.user.id, name: r.user.name, email: r.user.email ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  // ── Templates ───────────────────────────────────────────────────────────────

  listWorkflows: async (orgId: string, opts: { includeArchived?: boolean } = {}): Promise<WorkflowTemplate[]> =>
    unwrap<WorkflowTemplate[]>(
      await apiClient.get(base(orgId), { ...T, params: opts.includeArchived ? { include_archived: 'true' } : undefined }),
    ),

  getWorkflow: async (orgId: string, id: string): Promise<WorkflowTemplate> =>
    unwrap<WorkflowTemplate>(await apiClient.get(`${base(orgId)}/${id}`, T)),

  /** Create a workflow from its whole definition ('draft' = Save draft, 'save' = Save → Live). */
  createDefinition: async (orgId: string, dto: WorkflowDefinitionInput): Promise<SavedWorkflow> =>
    unwrap<SavedWorkflow>(await apiClient.post(`${base(orgId)}/definition`, dto, T)),

  /** Save the whole workflow in one request (one transaction on the server). */
  saveDefinition: async (orgId: string, id: string, dto: WorkflowDefinitionInput): Promise<SavedWorkflow> =>
    unwrap<SavedWorkflow>(await apiClient.put(`${base(orgId)}/${id}/definition`, dto, T)),

  /**
   * The example run(s) the timing works out to, for the definition being edited (nothing
   * is saved): the next 3 scheduled runs, or one run starting now for a manual-only one.
   */
  previewTimeline: async (orgId: string, dto: WorkflowDefinitionInput, signal?: AbortSignal): Promise<TimelinePreview> => {
    const data = unwrap<Partial<TimelinePreview> | null>(await apiClient.post(`${base(orgId)}/preview-timeline`, dto, { ...T, signal }))
    return { runs: Array.isArray(data?.runs) ? data!.runs : [], warnings: Array.isArray(data?.warnings) ? data!.warnings : [] }
  },

  /** Live → Paused: nothing new starts (schedules skip); runs under way carry on. */
  pauseWorkflow: async (orgId: string, id: string): Promise<WorkflowTemplate> =>
    unwrap<WorkflowTemplate>(await apiClient.post(`${base(orgId)}/${id}/pause`, undefined, T)),

  /** Paused → Live. What it missed while paused is not caught up. */
  resumeWorkflow: async (orgId: string, id: string): Promise<WorkflowTemplate> =>
    unwrap<WorkflowTemplate>(await apiClient.post(`${base(orgId)}/${id}/resume`, undefined, T)),

  /** DELETE /:id archives the workflow. */
  archiveWorkflow: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${id}`, T)
  },

  /** Archived → Draft. */
  restoreWorkflow: async (orgId: string, id: string): Promise<WorkflowTemplate> =>
    unwrap<WorkflowTemplate>(await apiClient.post(`${base(orgId)}/${id}/restore`, undefined, T)),

  // ── Instances (runs) ────────────────────────────────────────────────────────

  /** Starts a run now. The name is optional; the server defaults it. */
  triggerInstance: async (orgId: string, templateId: string, name?: string): Promise<{ id: string }> =>
    unwrap<{ id: string }>(
      await apiClient.post(`${base(orgId)}/${templateId}/instances/trigger`, name?.trim() ? { name: name.trim() } : {}, T),
    ),

  listInstances: async (orgId: string, templateId: string): Promise<WorkflowInstance[]> =>
    unwrap<WorkflowInstance[]>(await apiClient.get(`${base(orgId)}/${templateId}/instances`, T)),

  getInstance: async (orgId: string, templateId: string, instanceId: string): Promise<WorkflowInstance> =>
    unwrap<WorkflowInstance>(await apiClient.get(`${base(orgId)}/${templateId}/instances/${instanceId}`, T)),

  cancelInstance: async (orgId: string, templateId: string, instanceId: string): Promise<unknown> =>
    unwrap<unknown>(await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/cancel`, undefined, T)),

  retryInstance: async (orgId: string, templateId: string, instanceId: string): Promise<unknown> =>
    unwrap<unknown>(await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/retry`, undefined, T)),

  /** Skips one run row (default: the single current row). */
  skipStep: async (orgId: string, templateId: string, instanceId: string, rowId?: string): Promise<unknown> =>
    unwrap<unknown>(
      await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/skip-step`, rowId ? { row_id: rowId } : {}, T),
    ),

  /** Starts a waiting step (pending until its start time) right away. */
  startStepNow: async (orgId: string, templateId: string, instanceId: string, rowId: string): Promise<WorkflowInstance | null> =>
    unwrap<WorkflowInstance | null>(
      await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/steps/${rowId}/start-now`, undefined, T),
    ) ?? null,

  /** Earlier completed steps this row may be sent back to — direct predecessor first. */
  getSendBackTargets: async (orgId: string, templateId: string, instanceId: string, rowId: string): Promise<SendBackTarget[]> =>
    unwrap<SendBackTarget[]>(
      await apiClient.get(`${base(orgId)}/${templateId}/instances/${instanceId}/steps/${rowId}/send-back-targets`, T),
    ),

  sendBack: async (
    orgId: string,
    templateId: string,
    instanceId: string,
    rowId: string,
    dto: { to_row_id: string; reason: string },
  ): Promise<WorkflowInstance> =>
    unwrap<WorkflowInstance>(
      await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/steps/${rowId}/send-back`, dto, T),
    ),

  /** The run's history, newest first. */
  listEvents: async (orgId: string, templateId: string, instanceId: string): Promise<WorkflowRunEvent[]> =>
    unwrap<WorkflowRunEvent[]>(await apiClient.get(`${base(orgId)}/${templateId}/instances/${instanceId}/events`, T)),

  /** Every step's files (grouped by step) plus files added to the run itself. */
  getDocuments: async (orgId: string, templateId: string, instanceId: string): Promise<RunDocuments> =>
    unwrap<RunDocuments>(await apiClient.get(`${base(orgId)}/${templateId}/instances/${instanceId}/documents`, T)),

  uploadRunFile: async (
    orgId: string,
    templateId: string,
    instanceId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<RunFile> => {
    const form = new FormData()
    form.append('file', file)
    return unwrap<RunFile>(
      await apiClient.post(`${base(orgId)}/${templateId}/instances/${instanceId}/files`, form, {
        timeout: 120000,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      }),
    )
  },

  /** Resolves a short-lived signed URL, then opens it. */
  downloadRunFile: async (orgId: string, templateId: string, instanceId: string, fileId: string): Promise<void> => {
    const { url } = unwrap<{ url: string; file_name?: string }>(
      await apiClient.get(`${base(orgId)}/${templateId}/instances/${instanceId}/files/${fileId}/download`, T),
    )
    if (typeof window !== 'undefined' && url) window.open(url, '_blank', 'noopener')
  },

  deleteRunFile: async (orgId: string, templateId: string, instanceId: string, fileId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${templateId}/instances/${instanceId}/files/${fileId}`, T)
  },

  /** For a task created by a workflow step: its workflow, run and step. */
  getStepContext: async (orgId: string, taskId: string): Promise<WorkflowStepContext | null> =>
    unwrap<WorkflowStepContext | null>(await apiClient.get(`${base(orgId)}/step-context/${taskId}`, T)) ?? null,

  // ── My workflows ────────────────────────────────────────────────────────────

  getOwnedWorkflows: async (orgId: string): Promise<WorkflowTemplate[]> =>
    unwrap<WorkflowTemplate[]>(await apiClient.get(`${base(orgId)}/my/owned`, T)),

  getOwnedInstances: async (orgId: string): Promise<WorkflowInstance[]> =>
    unwrap<WorkflowInstance[]>(await apiClient.get(`${base(orgId)}/my/owned/instances`, T)),

  getAssignedInstances: async (orgId: string): Promise<WorkflowInstance[]> =>
    unwrap<WorkflowInstance[]>(await apiClient.get(`${base(orgId)}/my/assigned/instances`, T)),
}
