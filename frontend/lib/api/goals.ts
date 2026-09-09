import apiClient from './client'
import type {
  Goal,
  GoalCandidate,
  GoalCandidateProject,
  GoalCheckIn,
  GoalCheckInDue,
  GoalDashboard,
  GoalDeleteImpact,
  GoalLink,
  StrategyMap,
  CreateGoalInput,
  UpdateGoalInput,
  CreateCheckInInput,
  CreateLinkInput,
} from '@/lib/types/goals'

const base = (orgId: string) => `/api/v1/org/${orgId}/goals`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

export interface GoalListFilters {
  owner_user_id?: string
  department_id?: string
  status?: string
  from_date?: string
  to_date?: string
  search?: string
}

export const goalsApi = {
  list: async (orgId: string, filters: GoalListFilters = {}): Promise<Goal[]> => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, String(v))
    })
    const qs = params.toString()
    const res = await apiClient.get(`${base(orgId)}${qs ? `?${qs}` : ''}`)
    return unwrap<Goal[]>(res)
  },

  get: async (orgId: string, id: string): Promise<Goal> => {
    const res = await apiClient.get(`${base(orgId)}/${id}`)
    return unwrap<Goal>(res)
  },

  create: async (orgId: string, dto: CreateGoalInput): Promise<Goal> => {
    const res = await apiClient.post(base(orgId), dto)
    return unwrap<Goal>(res)
  },

  update: async (orgId: string, id: string, dto: UpdateGoalInput): Promise<Goal> => {
    const res = await apiClient.patch(`${base(orgId)}/${id}`, dto)
    return unwrap<Goal>(res)
  },

  remove: async (orgId: string, id: string, reason?: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${id}`, { data: { reason } })
  },

  /** What a delete would sever — drives the confirm dialog's warning. */
  deleteImpact: async (orgId: string, id: string): Promise<GoalDeleteImpact> => {
    const res = await apiClient.get(`${base(orgId)}/${id}/delete-impact`)
    return unwrap<GoalDeleteImpact>(res)
  },

  // ─── Dashboard & my check-ins ───────────────────────────────────────────────
  dashboard: async (orgId: string): Promise<GoalDashboard> => {
    const res = await apiClient.get(`${base(orgId)}/dashboard`)
    return unwrap<GoalDashboard>(res)
  },

  /** Goals + the whole link web in one read — the Strategic Map canvas. */
  strategyMap: async (orgId: string): Promise<StrategyMap> => {
    const res = await apiClient.get(`${base(orgId)}/strategy-map`)
    return unwrap<StrategyMap>(res)
  },

  myCheckIns: async (orgId: string): Promise<GoalCheckInDue[]> => {
    const res = await apiClient.get(`${base(orgId)}/my-check-ins`)
    return unwrap<GoalCheckInDue[]>(res)
  },

  myCheckInCount: async (orgId: string): Promise<number> => {
    const res = await apiClient.get(`${base(orgId)}/my-check-ins/count`)
    return unwrap<{ count: number }>(res).count
  },

  // ─── Check-ins ──────────────────────────────────────────────────────────────
  listCheckIns: async (orgId: string, goalId: string): Promise<GoalCheckIn[]> => {
    const res = await apiClient.get(`${base(orgId)}/${goalId}/check-ins`)
    return unwrap<GoalCheckIn[]>(res)
  },

  createCheckIn: async (
    orgId: string,
    goalId: string,
    dto: CreateCheckInInput,
  ): Promise<GoalCheckIn> => {
    const res = await apiClient.post(`${base(orgId)}/${goalId}/check-ins`, dto)
    return unwrap<GoalCheckIn>(res)
  },

  /** Check-ins are never edited or deleted — a wrong one is voided with a reason. */
  voidCheckIn: async (orgId: string, checkInId: string, reason: string): Promise<void> => {
    await apiClient.post(`${base(orgId)}/check-ins/${checkInId}/void`, { reason })
  },

  // ─── Links (the web) ────────────────────────────────────────────────────────
  getLinks: async (
    orgId: string,
    goalId: string,
  ): Promise<{ supported_by: GoalLink[]; supports: GoalLink[] }> => {
    const res = await apiClient.get(`${base(orgId)}/${goalId}/links`)
    return unwrap<{ supported_by: GoalLink[]; supports: GoalLink[] }>(res)
  },

  /**
   * Goals that may be linked in a direction, with self-links, duplicates and
   * anything that would form a circle already filtered out server-side.
   */
  linkCandidates: async (
    orgId: string,
    goalId: string,
    direction: 'supported_by' | 'supports',
  ): Promise<GoalCandidate[]> => {
    const res = await apiClient.get(`${base(orgId)}/${goalId}/link-candidates?direction=${direction}`)
    return unwrap<GoalCandidate[]>(res)
  },

  // ─── Linked projects (many-to-many: a project may serve several goals) ─────
  projectCandidates: async (orgId: string, goalId: string): Promise<GoalCandidateProject[]> => {
    const res = await apiClient.get(`${base(orgId)}/${goalId}/project-candidates`)
    return unwrap<GoalCandidateProject[]>(res)
  },

  linkProject: async (orgId: string, goalId: string, projectId: string): Promise<void> => {
    await apiClient.post(`${base(orgId)}/${goalId}/projects/${projectId}`)
  },

  unlinkProject: async (orgId: string, goalId: string, projectId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${goalId}/projects/${projectId}`)
  },

  /** Links `supporting_goal_id` as a supporter of `goalId`. */
  createLink: async (orgId: string, goalId: string, dto: CreateLinkInput): Promise<void> => {
    await apiClient.post(`${base(orgId)}/${goalId}/links`, dto)
  },

  updateLinkNote: async (orgId: string, linkId: string, note: string | null): Promise<void> => {
    await apiClient.patch(`${base(orgId)}/links/${linkId}`, { note })
  },

  removeLink: async (orgId: string, linkId: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/links/${linkId}`)
  },
}
