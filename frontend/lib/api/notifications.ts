import apiClient from './client'

export interface AppNotification {
  id: string
  organization_id: string
  user_id: string
  module: 'tasks' | 'projects' | 'workflows' | 'tickets' | 'communication' | 'system'
  event_type: string
  title: string
  body: string
  link: string | null
  entity_type: string | null
  entity_id: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationList {
  items: AppNotification[]
  next_cursor: string | null
  unread_count: number
}

export interface NotificationMaster {
  id: string
  organization_id: string
  event_toggles: Record<string, boolean>
  overdue_followup_days: number
  catalog?: Record<string, readonly string[]>
}

const base = (orgId: string) => `/api/v1/org/${orgId}/notifications`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

export const notificationsApi = {
  list: async (orgId: string, cursor?: string, limit = 20): Promise<NotificationList> =>
    unwrap(await apiClient.get(base(orgId), { params: { cursor, limit } })),

  unreadCount: async (orgId: string): Promise<{ unread_count: number }> =>
    unwrap(await apiClient.get(`${base(orgId)}/unread-count`)),

  markRead: async (orgId: string, id: string): Promise<{ ok: boolean }> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/read`)),

  // Phone dot/swipe toggle (FRONTEND_RULES_PHONE.md §41.12 rule 6).
  markUnread: async (orgId: string, id: string): Promise<{ ok: boolean }> =>
    unwrap(await apiClient.patch(`${base(orgId)}/${id}/unread`)),

  markAllRead: async (orgId: string): Promise<{ ok: boolean }> =>
    unwrap(await apiClient.patch(`${base(orgId)}/read-all`)),

  getMaster: async (orgId: string): Promise<NotificationMaster> =>
    unwrap(await apiClient.get(`${base(orgId)}/master`)),

  updateMaster: async (
    orgId: string,
    dto: { event_toggles?: Record<string, boolean>; overdue_followup_days?: number },
  ): Promise<NotificationMaster> => unwrap(await apiClient.put(`${base(orgId)}/master`, dto)),

  getVapidKey: async (orgId: string): Promise<{ key: string | null }> =>
    unwrap(await apiClient.get(`${base(orgId)}/push/vapid-public-key`)),

  subscribePush: async (
    orgId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ): Promise<{ ok: boolean }> => unwrap(await apiClient.post(`${base(orgId)}/push/subscribe`, sub)),

  unsubscribePush: async (orgId: string, endpoint: string): Promise<{ ok: boolean }> =>
    unwrap(await apiClient.delete(`${base(orgId)}/push/subscribe`, { data: { endpoint } })),
}
