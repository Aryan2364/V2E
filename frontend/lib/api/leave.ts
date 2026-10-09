import apiClient from './client'
import type { Leave, LeaveAvailability, LeaveMaster } from '@/lib/types/leave'

const base = (orgId: string) => `/api/v1/org/${orgId}/leave`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

export const leaveApi = {
  // Effective leave windows for the given users overlapping [from, to] (ISO yyyy-mm-dd).
  availability: async (orgId: string, userIds: string[], from: string, to: string): Promise<LeaveAvailability> => {
    if (userIds.length === 0) return { results: [] }
    const res = await apiClient.get(`${base(orgId)}/availability`, {
      params: { userIds: userIds.join(','), from, to },
    })
    return unwrap<LeaveAvailability>(res)
  },

  // ─── Self ─────────────────────────────────────────────────────────────────
  mine: async (orgId: string): Promise<Leave[]> => unwrap(await apiClient.get(`${base(orgId)}/mine`)),

  apply: async (
    orgId: string,
    body: { start_date: string; end_date: string; reason?: string; declare?: boolean },
  ): Promise<Leave> => unwrap(await apiClient.post(base(orgId), body)),

  override: async (orgId: string, id: string): Promise<Leave> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/override`)),

  cancel: async (orgId: string, id: string): Promise<Leave> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/cancel`)),

  // ─── Approvals ──────────────────────────────────────────────────────────────
  approvals: async (orgId: string): Promise<Leave[]> => unwrap(await apiClient.get(`${base(orgId)}/approvals`)),

  /** Does the caller approve leave for anyone (admin, a manager with reports, or a named approver)? */
  approvalEligibility: async (orgId: string): Promise<{ can_approve: boolean }> =>
    unwrap(await apiClient.get(`${base(orgId)}/approvals/eligibility`)),

  decide: async (
    orgId: string,
    id: string,
    body: { decision: 'approved' | 'rejected'; note?: string },
  ): Promise<Leave> => unwrap(await apiClient.patch(`${base(orgId)}/${id}/decision`, body)),

  // ─── Admin ────────────────────────────────────────────────────────────────
  list: async (orgId: string): Promise<Leave[]> => unwrap(await apiClient.get(base(orgId))),

  createFor: async (
    orgId: string,
    userId: string,
    body: { start_date: string; end_date: string; reason?: string; declare?: boolean },
  ): Promise<Leave> => unwrap(await apiClient.post(`${base(orgId)}/for/${userId}`, body)),

  getMaster: async (orgId: string): Promise<LeaveMaster> => unwrap(await apiClient.get(`${base(orgId)}/master`)),

  updateMaster: async (orgId: string, body: Partial<Omit<LeaveMaster, 'id' | 'organization_id' | 'config_manage_roles'>>): Promise<LeaveMaster> =>
    unwrap(await apiClient.put(`${base(orgId)}/master`, body)),
}
