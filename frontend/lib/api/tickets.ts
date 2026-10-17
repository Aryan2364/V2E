import apiClient from './client'
import type {
  Ticket,
  TicketMasterConfig,
  TicketType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketTemplate,
  TicketComment,
  TicketActivityLog,
  TicketChecklist,
  TicketArchiveEntry,
  TicketStats,
  TicketNotification,
  TicketReportResolutionTime,
  TicketReportBreakdown,
  TicketReportSlaBreaches,
  TicketReportRatings,
  TicketReportFirstResponse,
  TicketReportBacklogAging,
  TicketReportAgentLoad,
  TicketReportReopenRate,
  TicketResolverGroup,
  TicketAssignableUsers,
} from '@/lib/types/tickets'

const base = (orgId: string) => `/api/v1/org/${orgId}/tickets`
const masters = (orgId: string) => `${base(orgId)}/masters`
const reports = (orgId: string) => `${base(orgId)}/reports`

function unwrap<T>(res: { data: { data: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

export const ticketsApi = {
  // ── Masters ────────────────────────────────────────────────────────────────

  getConfig: async (orgId: string): Promise<TicketMasterConfig> => {
    const res = await apiClient.get(`${masters(orgId)}/config`)
    return unwrap<TicketMasterConfig>(res)
  },
  updateConfig: async (orgId: string, dto: Partial<TicketMasterConfig>): Promise<TicketMasterConfig> => {
    const res = await apiClient.patch(`${masters(orgId)}/config`, dto)
    return unwrap<TicketMasterConfig>(res)
  },

  listTypes: async (orgId: string): Promise<TicketType[]> => {
    const res = await apiClient.get(`${masters(orgId)}/types`)
    return unwrap<TicketType[]>(res)
  },
  createType: async (orgId: string, dto: Partial<TicketType>): Promise<TicketType> => {
    const res = await apiClient.post(`${masters(orgId)}/types`, dto)
    return unwrap<TicketType>(res)
  },
  updateType: async (orgId: string, id: string, dto: Partial<TicketType>): Promise<TicketType> => {
    const res = await apiClient.patch(`${masters(orgId)}/types/${id}`, dto)
    return unwrap<TicketType>(res)
  },
  deleteType: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${masters(orgId)}/types/${id}`)
  },

  listCategories: async (orgId: string): Promise<TicketCategory[]> => {
    const res = await apiClient.get(`${masters(orgId)}/categories`)
    return unwrap<TicketCategory[]>(res)
  },
  createCategory: async (orgId: string, dto: Partial<TicketCategory>): Promise<TicketCategory> => {
    const res = await apiClient.post(`${masters(orgId)}/categories`, dto)
    return unwrap<TicketCategory>(res)
  },
  updateCategory: async (orgId: string, id: string, dto: Partial<TicketCategory>): Promise<TicketCategory> => {
    const res = await apiClient.patch(`${masters(orgId)}/categories/${id}`, dto)
    return unwrap<TicketCategory>(res)
  },
  deleteCategory: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${masters(orgId)}/categories/${id}`)
  },

  listPriorities: async (orgId: string): Promise<TicketPriority[]> => {
    const res = await apiClient.get(`${masters(orgId)}/priorities`)
    return unwrap<TicketPriority[]>(res)
  },
  createPriority: async (orgId: string, dto: Partial<TicketPriority>): Promise<TicketPriority> => {
    const res = await apiClient.post(`${masters(orgId)}/priorities`, dto)
    return unwrap<TicketPriority>(res)
  },
  updatePriority: async (orgId: string, id: string, dto: Partial<TicketPriority>): Promise<TicketPriority> => {
    const res = await apiClient.patch(`${masters(orgId)}/priorities/${id}`, dto)
    return unwrap<TicketPriority>(res)
  },
  deletePriority: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${masters(orgId)}/priorities/${id}`)
  },

  listStatuses: async (orgId: string): Promise<TicketStatus[]> => {
    const res = await apiClient.get(`${masters(orgId)}/statuses`)
    return unwrap<TicketStatus[]>(res)
  },
  createStatus: async (orgId: string, dto: Partial<TicketStatus>): Promise<TicketStatus> => {
    const res = await apiClient.post(`${masters(orgId)}/statuses`, dto)
    return unwrap<TicketStatus>(res)
  },
  updateStatus: async (orgId: string, id: string, dto: Partial<TicketStatus>): Promise<TicketStatus> => {
    const res = await apiClient.patch(`${masters(orgId)}/statuses/${id}`, dto)
    return unwrap<TicketStatus>(res)
  },
  reorderStatuses: async (orgId: string, items: { id: string; order_index: number }[]): Promise<TicketStatus[]> => {
    const res = await apiClient.post(`${masters(orgId)}/statuses/reorder`, { items })
    return unwrap<TicketStatus[]>(res)
  },

  listTemplates: async (orgId: string): Promise<TicketTemplate[]> => {
    const res = await apiClient.get(`${masters(orgId)}/templates`)
    return unwrap<TicketTemplate[]>(res)
  },
  createTemplate: async (orgId: string, dto: Partial<TicketTemplate>): Promise<TicketTemplate> => {
    const res = await apiClient.post(`${masters(orgId)}/templates`, dto)
    return unwrap<TicketTemplate>(res)
  },
  updateTemplate: async (orgId: string, id: string, dto: Partial<TicketTemplate>): Promise<TicketTemplate> => {
    const res = await apiClient.patch(`${masters(orgId)}/templates/${id}`, dto)
    return unwrap<TicketTemplate>(res)
  },
  archiveTemplate: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${masters(orgId)}/templates/${id}`)
  },

  // ── Tickets ────────────────────────────────────────────────────────────────

  raise: async (orgId: string, dto: Record<string, unknown>): Promise<Ticket> => {
    const res = await apiClient.post(base(orgId), dto)
    return unwrap<Ticket>(res)
  },
  list: async (orgId: string, params?: Record<string, string | boolean | undefined>): Promise<Ticket[]> => {
    const res = await apiClient.get(base(orgId), { params })
    return unwrap<Ticket[]>(res)
  },
  // Server-side page (kit §11.1.1). Passing `page` makes the backend return the
  // { items, total, page, pageSize } envelope instead of the plain array.
  listPaged: async (
    orgId: string,
    params: Record<string, string | boolean | number | undefined> & { page: number; pageSize?: number },
  ): Promise<{ items: Ticket[]; total: number; page: number; pageSize: number }> => {
    const res = await apiClient.get(base(orgId), { params })
    return unwrap<{ items: Ticket[]; total: number; page: number; pageSize: number }>(res)
  },
  getStats: async (orgId: string): Promise<TicketStats> => {
    const res = await apiClient.get(`${base(orgId)}/stats`)
    return unwrap<TicketStats>(res)
  },
  listMy: async (orgId: string): Promise<Ticket[]> => {
    const res = await apiClient.get(`${base(orgId)}/my`)
    return unwrap<Ticket[]>(res)
  },
  listAssigned: async (orgId: string): Promise<Ticket[]> => {
    const res = await apiClient.get(`${base(orgId)}/assigned`)
    return unwrap<Ticket[]>(res)
  },
  listArchive: async (orgId: string): Promise<TicketArchiveEntry[]> => {
    const res = await apiClient.get(`${base(orgId)}/archive`)
    return unwrap<TicketArchiveEntry[]>(res)
  },
  // ── Resolver Groups ──────────────────────────────────────────────────────────

  listResolverGroups: async (orgId: string): Promise<TicketResolverGroup[]> => {
    const res = await apiClient.get(`${masters(orgId)}/resolver-groups`)
    return unwrap<TicketResolverGroup[]>(res)
  },
  createResolverGroup: async (orgId: string, dto: Record<string, unknown>): Promise<TicketResolverGroup> => {
    const res = await apiClient.post(`${masters(orgId)}/resolver-groups`, dto)
    return unwrap<TicketResolverGroup>(res)
  },
  updateResolverGroup: async (orgId: string, id: string, dto: Record<string, unknown>): Promise<TicketResolverGroup> => {
    const res = await apiClient.patch(`${masters(orgId)}/resolver-groups/${id}`, dto)
    return unwrap<TicketResolverGroup>(res)
  },
  deleteResolverGroup: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${masters(orgId)}/resolver-groups/${id}`)
  },

  // Templates the current user may pick when raising (access-filtered).
  listAccessibleTemplates: async (orgId: string): Promise<TicketTemplate[]> => {
    const res = await apiClient.get(`${base(orgId)}/templates/accessible`)
    return unwrap<TicketTemplate[]>(res)
  },
  // Resolvers eligible to be assigned a ticket of the given type/category/template.
  listAssignable: async (orgId: string, params: { typeId?: string; categoryId?: string; templateId?: string }): Promise<TicketAssignableUsers> => {
    const res = await apiClient.get(`${base(orgId)}/assignable`, { params })
    return unwrap<TicketAssignableUsers>(res)
  },

  getNotifications: async (orgId: string): Promise<TicketNotification[]> => {
    const res = await apiClient.get(`${base(orgId)}/notifications`)
    return unwrap<TicketNotification[]>(res)
  },
  markNotificationRead: async (orgId: string, nid: string): Promise<void> => {
    await apiClient.patch(`${base(orgId)}/notifications/${nid}/read`)
  },

  getTicket: async (orgId: string, id: string): Promise<Ticket> => {
    const res = await apiClient.get(`${base(orgId)}/${id}`)
    return unwrap<Ticket>(res)
  },
  updateTicket: async (orgId: string, id: string, dto: Record<string, unknown>): Promise<Ticket> => {
    const res = await apiClient.patch(`${base(orgId)}/${id}`, dto)
    return unwrap<Ticket>(res)
  },
  deleteTicket: async (orgId: string, id: string, reason: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${id}`, { data: { reason } })
  },

  assign: async (orgId: string, id: string, assigned_to_user_id: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/assign`, { assigned_to_user_id })
    return unwrap<Ticket>(res)
  },
  accept: async (orgId: string, id: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/accept`)
    return unwrap<Ticket>(res)
  },
  resolve: async (orgId: string, id: string, resolution_note: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/resolve`, { resolution_note })
    return unwrap<Ticket>(res)
  },
  close: async (orgId: string, id: string, status_type: 'closed_resolved' | 'closed_unresolved'): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/close`, { status_type })
    return unwrap<Ticket>(res)
  },
  confirm: async (orgId: string, id: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/confirm`)
    return unwrap<Ticket>(res)
  },
  rate: async (orgId: string, id: string, rating: number, comment?: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/rate`, { rating, comment })
    return unwrap<Ticket>(res)
  },
  submitProof: async (orgId: string, id: string, proof_url: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/proof`, { proof_url })
    return unwrap<Ticket>(res)
  },
  hold: async (orgId: string, id: string, reason?: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/hold`, { reason })
    return unwrap<Ticket>(res)
  },
  resume: async (orgId: string, id: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/resume`)
    return unwrap<Ticket>(res)
  },
  reject: async (orgId: string, id: string, reason: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/reject`, { reason })
    return unwrap<Ticket>(res)
  },
  transfer: async (orgId: string, id: string, dto: { resolver_group_id?: string; department_id?: string; reason?: string }): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/transfer`, dto)
    return unwrap<Ticket>(res)
  },
  reopen: async (orgId: string, id: string, reason?: string): Promise<Ticket> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/reopen`, { reason })
    return unwrap<Ticket>(res)
  },

  getLogs: async (orgId: string, id: string): Promise<TicketActivityLog[]> => {
    const res = await apiClient.get(`${base(orgId)}/${id}/logs`)
    return unwrap<TicketActivityLog[]>(res)
  },
  getComments: async (orgId: string, id: string): Promise<TicketComment[]> => {
    const res = await apiClient.get(`${base(orgId)}/${id}/comments`)
    return unwrap<TicketComment[]>(res)
  },
  addComment: async (orgId: string, id: string, dto: { body: string; reply_to_comment_id?: string; attachment_urls?: string[] }): Promise<TicketComment> => {
    const res = await apiClient.post(`${base(orgId)}/${id}/comments`, dto)
    return unwrap<TicketComment>(res)
  },
  deleteComment: async (orgId: string, id: string, cid: string): Promise<void> => {
    await apiClient.delete(`${base(orgId)}/${id}/comments/${cid}`)
  },
  toggleChecklist: async (orgId: string, id: string, iid: string): Promise<TicketChecklist> => {
    const res = await apiClient.patch(`${base(orgId)}/${id}/checklist/${iid}`)
    return unwrap<TicketChecklist>(res)
  },

  // ── Reports ────────────────────────────────────────────────────────────────

  getResolutionTime: async (orgId: string, from?: string, to?: string): Promise<TicketReportResolutionTime[]> => {
    const res = await apiClient.get(`${reports(orgId)}/resolution-time`, { params: { from, to } })
    return unwrap<TicketReportResolutionTime[]>(res)
  },
  getByType: async (orgId: string, from?: string, to?: string): Promise<TicketReportBreakdown[]> => {
    const res = await apiClient.get(`${reports(orgId)}/by-type`, { params: { from, to } })
    return unwrap<TicketReportBreakdown[]>(res)
  },
  getByCategory: async (orgId: string, from?: string, to?: string): Promise<TicketReportBreakdown[]> => {
    const res = await apiClient.get(`${reports(orgId)}/by-category`, { params: { from, to } })
    return unwrap<TicketReportBreakdown[]>(res)
  },
  getByPriority: async (orgId: string, from?: string, to?: string): Promise<TicketReportBreakdown[]> => {
    const res = await apiClient.get(`${reports(orgId)}/by-priority`, { params: { from, to } })
    return unwrap<TicketReportBreakdown[]>(res)
  },
  getByStatus: async (orgId: string, from?: string, to?: string): Promise<TicketReportBreakdown[]> => {
    const res = await apiClient.get(`${reports(orgId)}/by-status`, { params: { from, to } })
    return unwrap<TicketReportBreakdown[]>(res)
  },
  getSlaBreaches: async (orgId: string, from?: string, to?: string): Promise<TicketReportSlaBreaches> => {
    const res = await apiClient.get(`${reports(orgId)}/sla-breach`, { params: { from, to } })
    return unwrap<TicketReportSlaBreaches>(res)
  },
  getRatings: async (orgId: string, from?: string, to?: string): Promise<TicketReportRatings> => {
    const res = await apiClient.get(`${reports(orgId)}/ratings`, { params: { from, to } })
    return unwrap<TicketReportRatings>(res)
  },
  getFirstResponse: async (orgId: string, from?: string, to?: string): Promise<TicketReportFirstResponse[]> => {
    const res = await apiClient.get(`${reports(orgId)}/first-response`, { params: { from, to } })
    return unwrap<TicketReportFirstResponse[]>(res)
  },
  getBacklogAging: async (orgId: string): Promise<TicketReportBacklogAging> => {
    const res = await apiClient.get(`${reports(orgId)}/backlog-aging`)
    return unwrap<TicketReportBacklogAging>(res)
  },
  getAgentLoad: async (orgId: string): Promise<TicketReportAgentLoad[]> => {
    const res = await apiClient.get(`${reports(orgId)}/agent-load`)
    return unwrap<TicketReportAgentLoad[]>(res)
  },
  getReopenRate: async (orgId: string, from?: string, to?: string): Promise<TicketReportReopenRate> => {
    const res = await apiClient.get(`${reports(orgId)}/reopen-rate`, { params: { from, to } })
    return unwrap<TicketReportReopenRate>(res)
  },
}
