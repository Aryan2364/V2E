import apiClient from './client'

const base = (orgId: string) => `/api/v1/org/${orgId}/delegations`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

export type DelegationStatus = 'active' | 'completed' | 'cancelled'

export interface DelegationUser {
  id: string
  name: string | null
  email: string | null
}

export interface DelegationCriterion {
  id: string
  description: string
  target: string | null
  is_met: boolean
  order_index: number
}

export interface Delegation {
  id: string
  title: string
  outcome: string
  owner_user_id: string
  created_by_user_id: string
  kra: string | null
  running_by: string | null
  first_check_in: string | null
  status: DelegationStatus
  review_task_id: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  criteria: DelegationCriterion[]
  owner: DelegationUser | null
  created_by: DelegationUser | null
}

export interface CriterionInput {
  description: string
  target?: string
}

export interface DelegationInput {
  title: string
  outcome: string
  owner_user_id: string
  kra?: string
  running_by?: string
  first_check_in?: string
  criteria?: CriterionInput[]
}

export type DelegationView = 'mine' | 'incoming' | 'all'

export const delegationsApi = {
  list: async (orgId: string, view: DelegationView = 'all'): Promise<Delegation[]> => {
    const res = await apiClient.get(`${base(orgId)}`, { params: { view } })
    return unwrap<Delegation[]>(res)
  },

  get: async (orgId: string, id: string): Promise<Delegation> => {
    const res = await apiClient.get(`${base(orgId)}/${id}`)
    return unwrap<Delegation>(res)
  },

  create: async (orgId: string, dto: DelegationInput): Promise<Delegation> => {
    const res = await apiClient.post(`${base(orgId)}`, dto)
    return unwrap<Delegation>(res)
  },

  update: async (orgId: string, id: string, dto: Partial<DelegationInput>): Promise<Delegation> => {
    const res = await apiClient.patch(`${base(orgId)}/${id}`, dto)
    return unwrap<Delegation>(res)
  },

  complete: async (orgId: string, id: string): Promise<Delegation> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/complete`)
    return unwrap<Delegation>(res)
  },

  toggleCriterion: async (orgId: string, id: string, criterionId: string, isMet: boolean): Promise<Delegation> => {
    const res = await apiClient.patch(`${base(orgId)}/${id}/criteria/${criterionId}`, { is_met: isMet })
    return unwrap<Delegation>(res)
  },

  remove: async (orgId: string, id: string): Promise<{ success: boolean }> => {
    const res = await apiClient.delete(`${base(orgId)}/${id}`)
    return unwrap<{ success: boolean }>(res)
  },
}
