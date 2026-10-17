import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PermissionAction } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { HolidaysService } from '../holidays/holidays.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AuditWriterService } from '../audit/audit-writer.service'
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service'
import { ScopeService } from '../access-rights/scope.service'
import { AccessVisibilityService } from '../access-rights/access-visibility.service'
import { Principal } from '../access-rights/permissions.service'
import { assertActiveOrgMembers } from '../common/org-members'
import type { RaiseTicketDto } from './dto/raise-ticket.dto'
import type { UpdateTicketDto } from './dto/update-ticket.dto'
import type { AssignTicketDto } from './dto/assign-ticket.dto'
import type { ResolveTicketDto } from './dto/resolve-ticket.dto'
import type { CloseTicketDto } from './dto/close-ticket.dto'
import type { RateTicketDto } from './dto/rate-ticket.dto'
import type { AddTicketCommentDto } from './dto/add-comment.dto'
import type { CreateTicketTypeDto, UpdateTicketTypeDto } from './dto/create-ticket-type.dto'
import type { CreateTicketCategoryDto, UpdateTicketCategoryDto } from './dto/create-ticket-category.dto'
import type { CreateTicketPriorityDto, UpdateTicketPriorityDto } from './dto/create-ticket-priority.dto'
import type { CreateTicketStatusDto, UpdateTicketStatusDto, ReorderTicketStatusesDto } from './dto/create-ticket-status.dto'
import type { CreateTicketTemplateDto, UpdateTicketTemplateDto, TicketTemplateAccessRuleDto } from './dto/create-ticket-template.dto'
import type { UpdateTicketMasterDto } from './dto/update-ticket-master.dto'
import type { HoldTicketDto } from './dto/hold-ticket.dto'
import type { RejectTicketDto } from './dto/reject-ticket.dto'
import type { TransferTicketDto } from './dto/transfer-ticket.dto'
import type { ReopenTicketDto } from './dto/reopen-ticket.dto'
import type { CreateResolverGroupDto, UpdateResolverGroupDto } from './dto/resolver-group.dto'
import { TicketTemplateAccessService } from './ticket-template-access.service'

const TICKET_INCLUDE = {
  ticket_type: true,
  category: true,
  priority: true,
  status: true,
  checklist: { orderBy: { order_index: 'asc' as const } },
  escalations: { orderBy: { level: 'asc' as const } },
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name)

  private static readonly TICKETS_LEAF = 'tickets.ticket.manage'

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly subjects: SubjectEligibilityService,
    private readonly scope: ScopeService,
    private readonly auditWriter: AuditWriterService,
    private readonly templateAccess: TicketTemplateAccessService,
    private readonly visibility: AccessVisibilityService,
  ) {
    this.scope.registerWiredList(TicketsService.TICKETS_LEAF)
    this.visibility.registerCounter(TicketsService.TICKETS_LEAF, (orgId, userId) =>
      this.prisma.ticket.count({
        where: {
          organization_id: orgId,
          is_deleted: false,
          ...(this.visibility.whereForUser(TicketsService.TICKETS_LEAF, userId) ?? {}),
        },
      }),
    )
  }

  // ─── Defaults ──────────────────────────────────────────────────────────────

  async ensureDefaults(orgId: string) {
    const existing = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
    if (existing) return existing

    await this.prisma.ticketMaster.create({ data: { organization_id: orgId } })

    const defaultTypes = [
      { name: 'Issue', color: '#2563EB', icon: '🐛', default_sla_days: 3, order_index: 0 },
      { name: 'Service Request', color: '#0891B2', icon: '🛎️', default_sla_days: 5, order_index: 1 },
      { name: 'Complaint', color: '#DC2626', icon: '📢', default_sla_days: 7, order_index: 2 },
      { name: 'Query', color: '#D97706', icon: '❓', default_sla_days: 2, order_index: 3 },
    ]
    for (const t of defaultTypes) {
      await this.prisma.ticketType.create({ data: { organization_id: orgId, ...t } })
    }

    const defaultPriorities = [
      { label: 'Critical', color: '#DC2626', sla_days: 1, order_index: 0 },
      { label: 'High', color: '#D97706', sla_days: 2, order_index: 1 },
      { label: 'Medium', color: '#2563EB', sla_days: 5, order_index: 2 },
      { label: 'Low', color: '#475569', sla_days: 10, order_index: 3 },
    ]
    for (const p of defaultPriorities) {
      await this.prisma.ticketPriority.create({ data: { organization_id: orgId, ...p } })
    }

    const defaultStatuses = [
      { label: 'Open', type: 'open' as const, color: '#2563EB', order_index: 0, is_default: true },
      { label: 'Assigned', type: 'assigned' as const, color: '#0891B2', order_index: 1 },
      { label: 'Accepted & In Progress', type: 'in_progress' as const, color: '#D97706', order_index: 2 },
      { label: 'On Hold', type: 'on_hold' as const, color: '#6B7280', order_index: 3 },
      { label: 'Resolved', type: 'resolved' as const, color: '#16A34A', order_index: 4 },
      { label: 'Closed — Resolved', type: 'closed_resolved' as const, color: '#15803D', order_index: 5 },
      { label: 'Closed — Unresolved', type: 'closed_unresolved' as const, color: '#DC2626', order_index: 6 },
    ]
    for (const s of defaultStatuses) {
      await this.prisma.ticketStatus.create({ data: { organization_id: orgId, ...s } })
    }

    return this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async logActivity(
    orgId: string,
    ticketId: string,
    userId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.ticketActivityLog.create({
      data: {
        organization_id: orgId,
        ticket_id: ticketId,
        performed_by_user_id: userId,
        action: action as never,
        metadata: metadata as never,
      },
    })
  }

  // Routes all ticket notifications through the unified notification service.
  // (The legacy ticket_notifications table is no longer written — nothing reads it.)
  private async notifyUser(orgId: string, ticketId: string | null, userId: string, type: string, message: string) {
    await this.notifyUsers(orgId, ticketId, [userId], type, message)
  }

  private async notifyUsers(orgId: string, ticketId: string | null, userIds: string[], type: string, message: string) {
    if (userIds.length === 0) return
    const eventMap: Record<string, { event: string; title: string }> = {
      assigned: { event: 'ticket_raised', title: 'Ticket assigned to you' },
      reassigned: { event: 'ticket_raised', title: 'Ticket reassigned to you' },
      unassigned: { event: 'ticket_raised', title: 'Ticket needs assignment' },
      status_changed: { event: 'ticket_status_changed', title: 'Ticket status updated' },
      confirmation_requested: { event: 'ticket_status_changed', title: 'Ticket awaiting your confirmation' },
      sla_breached: { event: 'ticket_sla_breached', title: 'Ticket SLA breached' },
      escalated: { event: 'ticket_escalated', title: 'Ticket escalated to you' },
      comment: { event: 'ticket_comment', title: 'New ticket comment' },
    }
    const mapped = eventMap[type] ?? { event: 'ticket_status_changed', title: 'Ticket update' }
    await this.notifications.emit({
      orgId,
      module: 'tickets',
      event_type: mapped.event,
      recipients: userIds,
      title: mapped.title,
      body: message,
      // 'comment' carries the raw comment text in `message` — the lock-screen
      // push must never show it (§41.12 rule 3; plan D12), so it falls back
      // to the already-safe title-only template. Every other type's message
      // is already a system-authored status line, safe as pushed text too.
      pushBody: type === 'comment' ? mapped.title : undefined,
      link: ticketId ? `/dashboard/tasks/tickets/${ticketId}` : '/dashboard/tasks/tickets',
      entity: ticketId ? { type: 'ticket', id: ticketId } : undefined,
    })
  }

  private async getStatusByType(orgId: string, type: string) {
    const status = await this.prisma.ticketStatus.findFirst({ where: { organization_id: orgId, type: type as never } })
    if (!status) throw new BadRequestException(`Status type "${type}" not found. Run GET /tickets/masters/config first.`)
    return status
  }

  // Finds a status of the given type, creating a sensible default if missing.
  // Used for the `on_hold` status, added after some orgs were already seeded.
  private async ensureStatusByType(
    orgId: string,
    type: string,
    fallback: { label: string; color: string; order_index: number },
  ) {
    const existing = await this.prisma.ticketStatus.findFirst({ where: { organization_id: orgId, type: type as never } })
    if (existing) return existing
    return this.prisma.ticketStatus.create({
      data: { organization_id: orgId, type: type as never, ...fallback },
    })
  }

  private async generateTicketNumber(orgId: string): Promise<string> {
    const last = await this.prisma.ticket.findFirst({
      where: { organization_id: orgId },
      orderBy: { created_at: 'desc' },
      select: { ticket_number: true },
    })
    const n = last ? parseInt(last.ticket_number.replace('TKT-', '')) + 1 : 1
    return `TKT-${n.toString().padStart(4, '0')}`
  }

  private resolveSlaFromConfigs(
    typeSla: number,
    categorySla?: number | null,
    prioritySla?: number | null,
  ): number {
    return prioritySla ?? categorySla ?? typeSla
  }

  private async resolveAutoAssignee(
    orgId: string,
    typeId: string,
    categoryId?: string,
    templateId?: string,
  ): Promise<string | null> {
    if (templateId) {
      const tmpl = await this.prisma.ticketTemplate.findUnique({ where: { id: templateId } })
      if (tmpl?.auto_assign_user_id) return tmpl.auto_assign_user_id
      if (tmpl?.auto_assign_role) {
        const u = await this.resolveRoleRoundRobin(orgId, 'ticket_template', templateId, tmpl.auto_assign_role)
        if (u) return u
      }
    }
    if (categoryId) {
      const cat = await this.prisma.ticketCategory.findUnique({ where: { id: categoryId } })
      if (cat?.auto_assign_user_id) return cat.auto_assign_user_id
      if (cat?.auto_assign_role) {
        const u = await this.resolveRoleRoundRobin(orgId, 'ticket_category', categoryId, cat.auto_assign_role)
        if (u) return u
      }
    }
    const type = await this.prisma.ticketType.findUnique({ where: { id: typeId } })
    if (type?.auto_assign_user_id) return type.auto_assign_user_id
    if (type?.auto_assign_role) {
      const u = await this.resolveRoleRoundRobin(orgId, 'ticket_type', typeId, type.auto_assign_role)
      if (u) return u
    }
    return null
  }

  private async resolveRoleRoundRobin(
    orgId: string,
    scopeType: string,
    scopeId: string,
    role: string,
  ): Promise<string | null> {
    // NOTE: MemberRole was removed; legacy `auto_assign_role` configs are reinterpreted
    // as "admins" when they named org_admin, otherwise as any active member.
    const members = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, is_active: true, ...(role === 'org_admin' ? { is_admin: true } : {}) },
      select: { user_id: true },
      orderBy: { joined_at: 'asc' },
    })
    if (members.length === 0) return null
    const userIds = members.map((m) => m.user_id)
    const tracker = await this.prisma.ticketRoundRobinTracker.findUnique({
      where: { scope_type_scope_id_role: { scope_type: scopeType, scope_id: scopeId, role } },
    })
    let nextIdx = 0
    if (tracker) {
      const lastIdx = userIds.indexOf(tracker.last_assigned_user_id)
      nextIdx = (lastIdx + 1) % userIds.length
    }
    const assignedUserId = userIds[nextIdx]
    await this.prisma.ticketRoundRobinTracker.upsert({
      where: { scope_type_scope_id_role: { scope_type: scopeType, scope_id: scopeId, role } },
      update: { last_assigned_user_id: assignedUserId, assignment_count: { increment: 1 } },
      create: {
        organization_id: orgId,
        scope_type: scopeType,
        scope_id: scopeId,
        role,
        last_assigned_user_id: assignedUserId,
        assignment_count: 1,
      },
    })
    return assignedUserId
  }

  private async getAdminUserIds(orgId: string): Promise<string[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, is_admin: true, is_active: true },
      select: { user_id: true },
    })
    return members.map((m) => m.user_id)
  }

  // Resolves the resolver group that owns a ticket, template → category → type.
  private async resolveResolverGroup(orgId: string, typeId?: string, categoryId?: string, templateId?: string) {
    const groupIds: (string | null | undefined)[] = []
    if (templateId) {
      const t = await this.prisma.ticketTemplate.findUnique({ where: { id: templateId }, select: { resolver_group_id: true } })
      groupIds.push(t?.resolver_group_id)
    }
    if (categoryId) {
      const c = await this.prisma.ticketCategory.findUnique({ where: { id: categoryId }, select: { resolver_group_id: true } })
      groupIds.push(c?.resolver_group_id)
    }
    if (typeId) {
      const ty = await this.prisma.ticketType.findUnique({ where: { id: typeId }, select: { resolver_group_id: true } })
      groupIds.push(ty?.resolver_group_id)
    }
    const groupId = groupIds.find((g) => !!g)
    if (!groupId) return null
    return this.prisma.ticketResolverGroup.findFirst({
      where: { id: groupId, organization_id: orgId, is_active: true },
      include: { members: true },
    })
  }

  // Decides the initial assignee + resolver group for a new ticket. Resolver
  // groups take precedence; their strategy decides whether one member is
  // force-assigned (round_robin) or the ticket waits in the pool (claim/manual).
  private async resolveAssignment(
    orgId: string,
    typeId: string,
    categoryId?: string,
    templateId?: string,
  ): Promise<{ assigneeId: string | null; resolverGroupId: string | null }> {
    const group = await this.resolveResolverGroup(orgId, typeId, categoryId, templateId)
    if (group && group.members.length) {
      if (group.assignment_strategy === 'round_robin') {
        const memberId = await this.resolveGroupRoundRobin(orgId, group.id, group.members.map((m) => m.user_id))
        return { assigneeId: memberId, resolverGroupId: group.id }
      }
      // claim / manual — leave unassigned but remember which pool owns it.
      return { assigneeId: null, resolverGroupId: group.id }
    }
    // Legacy fallback: per-entity auto_assign_user_id / auto_assign_role.
    const assigneeId = await this.resolveAutoAssignee(orgId, typeId, categoryId, templateId)
    return { assigneeId, resolverGroupId: group?.id ?? null }
  }

  private async resolveGroupRoundRobin(orgId: string, groupId: string, userIds: string[]): Promise<string | null> {
    if (userIds.length === 0) return null
    const tracker = await this.prisma.ticketRoundRobinTracker.findUnique({
      where: { scope_type_scope_id_role: { scope_type: 'resolver_group', scope_id: groupId, role: 'members' } },
    })
    let nextIdx = 0
    if (tracker) {
      const lastIdx = userIds.indexOf(tracker.last_assigned_user_id)
      nextIdx = (lastIdx + 1) % userIds.length
    }
    const assignedUserId = userIds[nextIdx]
    await this.prisma.ticketRoundRobinTracker.upsert({
      where: { scope_type_scope_id_role: { scope_type: 'resolver_group', scope_id: groupId, role: 'members' } },
      update: { last_assigned_user_id: assignedUserId, assignment_count: { increment: 1 } },
      create: {
        organization_id: orgId,
        scope_type: 'resolver_group',
        scope_id: groupId,
        role: 'members',
        last_assigned_user_id: assignedUserId,
        assignment_count: 1,
      },
    })
    return assignedUserId
  }

  // First-response SLA (hours): template → category → type → org default. null = no clock.
  private resolveResponseSla(
    typeHours?: number | null,
    categoryHours?: number | null,
    templateHours?: number | null,
    orgDefaultHours?: number | null,
  ): number | null {
    return templateHours ?? categoryHours ?? typeHours ?? orgDefaultHours ?? null
  }

  // Sets responded_at the first time the assignee engages (accept or comment).
  private async markFirstResponse(
    orgId: string,
    ticket: { id: string; responded_at: Date | null; assigned_to_user_id: string | null; response_due_at: Date | null },
    actorUserId: string,
  ) {
    if (ticket.responded_at) return
    if (ticket.assigned_to_user_id !== actorUserId) return
    await this.prisma.ticket.update({ where: { id: ticket.id }, data: { responded_at: new Date() } })
    await this.logActivity(orgId, ticket.id, actorUserId, 'first_responded')
  }

  // ─── Masters ───────────────────────────────────────────────────────────────

  async getConfig(orgId: string) {
    await this.ensureDefaults(orgId)
    return this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
  }

  async updateConfig(orgId: string, dto: UpdateTicketMasterDto) {
    return this.prisma.ticketMaster.update({
      where: { organization_id: orgId },
      data: dto as never,
    })
  }

  async listTypes(orgId: string) {
    return this.prisma.ticketType.findMany({ where: { organization_id: orgId }, orderBy: { order_index: 'asc' } })
  }

  async createType(orgId: string, dto: CreateTicketTypeDto) {
    return this.prisma.ticketType.create({ data: { organization_id: orgId, ...dto } })
  }

  private async assertInOrg(
    model: 'ticketType' | 'ticketCategory' | 'ticketPriority' | 'ticketStatus' | 'ticketTemplate' | 'ticketResolverGroup',
    orgId: string,
    id: string,
    label: string,
  ) {
    const row = await (this.prisma[model] as { findFirst: (args: unknown) => Promise<unknown> }).findFirst({
      where: { id, organization_id: orgId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException(`${label} not found`)
  }

  async updateType(orgId: string, typeId: string, dto: UpdateTicketTypeDto) {
    await this.assertInOrg('ticketType', orgId, typeId, 'Ticket type')
    return this.prisma.ticketType.update({ where: { id: typeId }, data: dto })
  }

  async deleteType(orgId: string, typeId: string) {
    await this.assertInOrg('ticketType', orgId, typeId, 'Ticket type')
    return this.prisma.ticketType.update({ where: { id: typeId }, data: { is_active: false } })
  }

  async listCategories(orgId: string, typeId?: string) {
    return this.prisma.ticketCategory.findMany({
      where: { organization_id: orgId, ...(typeId ? { ticket_type_id: typeId } : {}) },
      orderBy: { name: 'asc' },
    })
  }

  async createCategory(orgId: string, dto: CreateTicketCategoryDto) {
    return this.prisma.ticketCategory.create({ data: { organization_id: orgId, ...dto } })
  }

  async updateCategory(orgId: string, categoryId: string, dto: UpdateTicketCategoryDto) {
    await this.assertInOrg('ticketCategory', orgId, categoryId, 'Ticket category')
    return this.prisma.ticketCategory.update({ where: { id: categoryId }, data: dto as never })
  }

  async deleteCategory(orgId: string, categoryId: string) {
    await this.assertInOrg('ticketCategory', orgId, categoryId, 'Ticket category')
    return this.prisma.ticketCategory.update({ where: { id: categoryId }, data: { is_active: false } })
  }

  async listPriorities(orgId: string) {
    return this.prisma.ticketPriority.findMany({ where: { organization_id: orgId }, orderBy: { order_index: 'asc' } })
  }

  async createPriority(orgId: string, dto: CreateTicketPriorityDto) {
    return this.prisma.ticketPriority.create({ data: { organization_id: orgId, ...dto } })
  }

  async updatePriority(orgId: string, priorityId: string, dto: UpdateTicketPriorityDto) {
    await this.assertInOrg('ticketPriority', orgId, priorityId, 'Ticket priority')
    return this.prisma.ticketPriority.update({ where: { id: priorityId }, data: dto })
  }

  async deletePriority(orgId: string, priorityId: string) {
    await this.assertInOrg('ticketPriority', orgId, priorityId, 'Ticket priority')
    return this.prisma.ticketPriority.update({ where: { id: priorityId }, data: { is_active: false } })
  }

  async listStatuses(orgId: string) {
    return this.prisma.ticketStatus.findMany({ where: { organization_id: orgId }, orderBy: { order_index: 'asc' } })
  }

  async createStatus(orgId: string, dto: CreateTicketStatusDto) {
    return this.prisma.ticketStatus.create({ data: { organization_id: orgId, ...dto } })
  }

  async updateStatus(orgId: string, statusId: string, dto: UpdateTicketStatusDto) {
    await this.assertInOrg('ticketStatus', orgId, statusId, 'Ticket status')
    return this.prisma.ticketStatus.update({ where: { id: statusId }, data: dto })
  }

  async reorderStatuses(orgId: string, dto: ReorderTicketStatusesDto) {
    await Promise.all(
      dto.items.map((item) =>
        this.prisma.ticketStatus.updateMany({
          where: { id: item.id, organization_id: orgId },
          data: { order_index: item.order_index },
        }),
      ),
    )
    return this.listStatuses(orgId)
  }

  async listTemplates(orgId: string) {
    return this.prisma.ticketTemplate.findMany({
      where: { organization_id: orgId, is_active: true },
      include: { ticket_type: true, category: true, priority: true, resolver_group: true, access_rules: true },
      orderBy: { name: 'asc' },
    })
  }

  // Templates the current user may pick when raising a ticket (access-filtered).
  async listAccessibleTemplates(orgId: string, userId: string) {
    await this.ensureDefaults(orgId)
    return this.templateAccess.listAccessibleTemplates(orgId, userId)
  }

  // Maps incoming access-rule DTOs to DB rows, nulling inapplicable target columns.
  private buildTemplateAccessRows(orgId: string, rules: TicketTemplateAccessRuleDto[] = []) {
    return rules
      .filter((r) => {
        if (r.kind === 'department') return !!r.department_id
        if (r.kind === 'role' || r.kind === 'exclude_role') return !!r.role_id
        if (r.kind === 'user' || r.kind === 'exclude_user') return !!r.user_id
        return false
      })
      .map((r) => ({
        organization_id: orgId,
        kind: r.kind,
        department_id: r.kind === 'department' ? r.department_id ?? null : null,
        include_sub_departments: r.kind === 'department' ? r.include_sub_departments ?? true : true,
        role_id: r.kind === 'role' || r.kind === 'exclude_role' ? r.role_id ?? null : null,
        user_id: r.kind === 'user' || r.kind === 'exclude_user' ? r.user_id ?? null : null,
      }))
  }

  async createTemplate(orgId: string, userId: string, dto: CreateTicketTemplateDto) {
    const { access_rules, checklist_items, ...rest } = dto
    return this.prisma.ticketTemplate.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        ...rest,
        checklist_items: (checklist_items ?? []) as never,
        access_rules:
          dto.access_mode === 'restricted' && access_rules?.length
            ? { create: this.buildTemplateAccessRows(orgId, access_rules) }
            : undefined,
      },
      include: { ticket_type: true, category: true, priority: true, resolver_group: true, access_rules: true },
    })
  }

  async updateTemplate(orgId: string, templateId: string, dto: UpdateTicketTemplateDto) {
    await this.assertInOrg('ticketTemplate', orgId, templateId, 'Ticket template')
    const { access_rules, checklist_items, ...rest } = dto
    const data: Record<string, unknown> = { ...rest }
    if (checklist_items !== undefined) data.checklist_items = checklist_items
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketTemplate.update({ where: { id: templateId }, data: data as never })
      // Replace-all the access rules when the access shape is part of this update.
      if (access_rules !== undefined || dto.access_mode !== undefined) {
        await tx.ticketTemplateAccessRule.deleteMany({ where: { template_id: templateId } })
        const mode = dto.access_mode
        if (mode === 'restricted' && access_rules?.length) {
          await tx.ticketTemplateAccessRule.createMany({
            data: this.buildTemplateAccessRows(orgId, access_rules).map((r) => ({ ...r, template_id: templateId })),
          })
        }
      }
    })
    return this.prisma.ticketTemplate.findUnique({
      where: { id: templateId },
      include: { ticket_type: true, category: true, priority: true, resolver_group: true, access_rules: true },
    })
  }

  async archiveTemplate(orgId: string, templateId: string) {
    await this.assertInOrg('ticketTemplate', orgId, templateId, 'Ticket template')
    return this.prisma.ticketTemplate.update({ where: { id: templateId }, data: { is_active: false } })
  }

  // ─── Resolver Groups ─────────────────────────────────────────────────────────

  async listResolverGroups(orgId: string) {
    return this.prisma.ticketResolverGroup.findMany({
      where: { organization_id: orgId },
      include: { members: true },
      orderBy: { name: 'asc' },
    })
  }

  async createResolverGroup(orgId: string, dto: CreateResolverGroupDto) {
    const { member_user_ids, ...rest } = dto
    return this.prisma.ticketResolverGroup.create({
      data: {
        organization_id: orgId,
        ...rest,
        members: member_user_ids?.length
          ? { create: member_user_ids.map((uid) => ({ organization_id: orgId, user_id: uid })) }
          : undefined,
      },
      include: { members: true },
    })
  }

  async updateResolverGroup(orgId: string, groupId: string, dto: UpdateResolverGroupDto) {
    await this.assertInOrg('ticketResolverGroup', orgId, groupId, 'Resolver group')
    const { member_user_ids, ...rest } = dto
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketResolverGroup.update({ where: { id: groupId }, data: rest as never })
      if (member_user_ids !== undefined) {
        await tx.ticketResolverGroupMember.deleteMany({ where: { resolver_group_id: groupId } })
        if (member_user_ids.length) {
          await tx.ticketResolverGroupMember.createMany({
            data: member_user_ids.map((uid) => ({ organization_id: orgId, resolver_group_id: groupId, user_id: uid })),
          })
        }
      }
    })
    return this.prisma.ticketResolverGroup.findUnique({ where: { id: groupId }, include: { members: true } })
  }

  async deleteResolverGroup(orgId: string, groupId: string) {
    await this.assertInOrg('ticketResolverGroup', orgId, groupId, 'Resolver group')
    return this.prisma.ticketResolverGroup.update({ where: { id: groupId }, data: { is_active: false } })
  }

  // The people who may resolve a ticket of a given type/category/template — used
  // to populate the assignee picker so only eligible resolvers surface.
  async listAssignableUsers(orgId: string, opts: { typeId?: string; categoryId?: string; templateId?: string }) {
    const group = await this.resolveResolverGroup(orgId, opts.typeId, opts.categoryId, opts.templateId)
    let candidateIds: string[]
    if (group && group.members.length) {
      candidateIds = group.members.map((m) => m.user_id)
    } else {
      const members = await this.prisma.organizationMember.findMany({
        where: { organization_id: orgId, is_active: true },
        select: { user_id: true },
      })
      candidateIds = members.map((m) => m.user_id)
    }
    // Gate by subject eligibility (module ceiling + per-user grants/revokes).
    const { eligible } = await this.subjects.filterEligible(orgId, 'tickets.subject.assignable', candidateIds)
    return { resolver_group_id: group?.id ?? null, user_ids: eligible }
  }

  // ─── Ticket Lifecycle ──────────────────────────────────────────────────────

  async raiseTicket(orgId: string, userId: string, dto: RaiseTicketDto) {
    await this.ensureDefaults(orgId)
    await assertActiveOrgMembers(this.prisma, orgId, dto.escalation_user_ids, 'escalation contacts')
    const master = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })!

    const [ticketType, category, priority, template] = await Promise.all([
      this.prisma.ticketType.findUnique({ where: { id: dto.ticket_type_id } }),
      dto.category_id ? this.prisma.ticketCategory.findUnique({ where: { id: dto.category_id } }) : null,
      dto.priority_id ? this.prisma.ticketPriority.findUnique({ where: { id: dto.priority_id } }) : null,
      dto.template_id ? this.prisma.ticketTemplate.findUnique({ where: { id: dto.template_id } }) : null,
    ])
    if (!ticketType) throw new NotFoundException('Ticket type not found')

    // A locked-priority template forces its own priority regardless of the form value.
    const effectivePriorityId =
      template?.lock_priority && template.priority_id ? template.priority_id : dto.priority_id
    const effectivePriority =
      effectivePriorityId === dto.priority_id
        ? priority
        : await this.prisma.ticketPriority.findUnique({ where: { id: effectivePriorityId! } })

    const sla_days = this.resolveSlaFromConfigs(
      ticketType.default_sla_days,
      category?.default_sla_days,
      effectivePriority?.sla_days,
    )
    const now = new Date()
    const rawSlaDate = new Date(now.getTime() + sla_days * 24 * 60 * 60 * 1000)
    // sla_due_at will be adjusted after ticket creation (need ticket.id for audit log)
    const sla_due_at = rawSlaDate

    // First-response clock (hours): template → category → type → org default.
    const responseHours = this.resolveResponseSla(
      ticketType.default_response_sla_hours,
      category?.default_response_sla_hours,
      template?.response_sla_hours,
      master?.default_response_sla_hours,
    )
    const responseDueAt = responseHours != null ? new Date(now.getTime() + responseHours * 60 * 60 * 1000) : null

    // Explicit assignee wins; otherwise route via resolver group / legacy auto-assign.
    let assigneeId = dto.assigned_to_user_id ?? null
    let resolverGroupId: string | null = null
    if (assigneeId) {
      resolverGroupId = (await this.resolveResolverGroup(orgId, dto.ticket_type_id, dto.category_id, dto.template_id))?.id ?? null
    } else {
      const routed = await this.resolveAssignment(orgId, dto.ticket_type_id, dto.category_id, dto.template_id)
      assigneeId = routed.assigneeId
      resolverGroupId = routed.resolverGroupId
    }
    const openStatus = await this.getStatusByType(orgId, assigneeId ? 'assigned' : 'open')

    const ticket_number = await this.generateTicketNumber(orgId)

    const ticket = await this.prisma.ticket.create({
      data: {
        organization_id: orgId,
        ticket_number,
        title: dto.title,
        description: dto.description,
        ticket_type_id: dto.ticket_type_id,
        category_id: dto.category_id,
        priority_id: effectivePriorityId,
        status_id: openStatus.id,
        template_id: dto.template_id,
        raised_by_user_id: userId,
        assigned_to_user_id: assigneeId,
        assigned_at: assigneeId ? now : undefined,
        resolver_group_id: resolverGroupId,
        sla_days,
        sla_due_at,
        response_sla_hours: responseHours,
        response_due_at: responseDueAt,
        requires_raiser_confirmation: master?.require_raiser_confirmation ?? false,
        proof_required: dto.proof_required ?? false,
        checklist: dto.checklist_items?.length
          ? {
              create: dto.checklist_items.map((item, i) => ({
                organization_id: orgId,
                title: item.title,
                order_index: i,
              })),
            }
          : undefined,
        escalations: dto.escalation_user_ids?.length
          ? {
              create: dto.escalation_user_ids.map((uid, i) => ({
                organization_id: orgId,
                level: i + 1,
                escalate_to_user_id: uid,
              })),
            }
          : undefined,
      },
      include: TICKET_INCLUDE,
    })

    // Holiday adjustment for SLA due date (create ticket first to get id for audit log)
    const adjustedSlaDate = await this.holidaysService.adjustDeadline(
      rawSlaDate, orgId,
      dto.category_id ? undefined : undefined,
      assigneeId ?? undefined,
      'ticket', ticket.id, ticket.title,
      true, // forTicket=true: skip_create treated as move_to_next_working_day
    )
    const finalSlaDate = adjustedSlaDate ?? rawSlaDate
    if (finalSlaDate.getTime() !== rawSlaDate.getTime()) {
      await this.prisma.ticket.update({ where: { id: ticket.id }, data: { sla_due_at: finalSlaDate } });
      (ticket as any).sla_due_at = finalSlaDate
    }

    await this.logActivity(orgId, ticket.id, userId, 'created')

    if (assigneeId) {
      await this.notifyUser(orgId, ticket.id, assigneeId, 'assigned', `You have been assigned ticket ${ticket_number}: ${dto.title}`)
    } else {
      const adminIds = await this.getAdminUserIds(orgId)
      await this.notifyUsers(orgId, ticket.id, adminIds, 'unassigned', `Ticket ${ticket_number} has no assignee and needs manual assignment`)
    }

    return ticket
  }

  async listTickets(
    orgId: string,
    principal: Principal,
    filters: {
      typeId?: string
      categoryId?: string
      priorityId?: string
      statusId?: string
      assignedTo?: string
      raisedBy?: string
      slaBreached?: boolean
      from?: string
      to?: string
      search?: string
    },
    // Opt-in pagination (kit §11.1.1). Omitting `page` returns the plain array,
    // byte-for-byte what every existing caller (phone, /my, /assigned) already
    // gets. Passing `page` returns the { items, total, page, pageSize } envelope.
    page?: number,
    pageSize?: number,
    sort?: 'created_desc' | 'created_asc',
  ) {
    const where: Record<string, unknown> = {
      organization_id: orgId,
      is_deleted: false,
      ...(filters.typeId && { ticket_type_id: filters.typeId }),
      ...(filters.categoryId && { category_id: filters.categoryId }),
      ...(filters.priorityId && { priority_id: filters.priorityId }),
      ...(filters.statusId && { status_id: filters.statusId }),
      ...(filters.assignedTo && { assigned_to_user_id: filters.assignedTo }),
      ...(filters.raisedBy && { raised_by_user_id: filters.raisedBy }),
      ...(filters.slaBreached !== undefined && { sla_breached: filters.slaBreached }),
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { ticket_number: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
      ...(filters.from || filters.to
        ? {
            created_at: {
              ...(filters.from && { gte: new Date(filters.from) }),
              ...(filters.to && { lte: new Date(filters.to) }),
            },
          }
        : {}),
    }
    const scopeWhere = await this.scope.listWhere(orgId, principal, TicketsService.TICKETS_LEAF)
    if (Object.keys(scopeWhere).length) (where as Record<string, unknown>).AND = [scopeWhere]
    const orderBy = { created_at: sort === 'created_asc' ? ('asc' as const) : ('desc' as const) }

    if (page === undefined) {
      return this.prisma.ticket.findMany({ where, include: TICKET_INCLUDE, orderBy })
    }

    const take = Math.min(Math.max(pageSize ?? 25, 1), 100)
    const skip = (Math.max(page, 1) - 1) * take
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({ where, include: TICKET_INCLUDE, orderBy, skip, take }),
      this.prisma.ticket.count({ where }),
    ])
    return { items, total, page: Math.max(page, 1), pageSize: take }
  }

  /**
   * A ticket is a private record. Allow an actor only if they are directly on it
   * (raiser, assignee, or escalation target) OR it falls within their effective
   * scope for `action` over one of its core participants. Fails closed — knowing
   * a ticket's id must never be enough to read or mutate it.
   */
  private async assertParticipantAction(
    orgId: string,
    principal: Principal,
    ticket: {
      raised_by_user_id: string
      assigned_to_user_id: string | null
      escalations: { escalate_to_user_id: string }[]
    },
    action: PermissionAction,
  ): Promise<void> {
    const onTicket =
      ticket.raised_by_user_id === principal.userId ||
      ticket.assigned_to_user_id === principal.userId ||
      ticket.escalations.some((e) => e.escalate_to_user_id === principal.userId)
    if (onTicket) return
    await this.scope.assertCanActOn(orgId, principal, TicketsService.TICKETS_LEAF, action, [
      ticket.raised_by_user_id,
      ticket.assigned_to_user_id,
      ...ticket.escalations.map((e) => e.escalate_to_user_id),
    ])
  }

  /**
   * Guard for a ticket's sub-resources (comments, logs, checklist). External
   * callers pass their principal; internal callers pass none (already authorized
   * upstream).
   */
  async assertCanViewTicket(orgId: string, principal: Principal | undefined, ticketId: string): Promise<void> {
    if (!principal) return
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, organization_id: orgId, is_deleted: false },
      select: {
        raised_by_user_id: true,
        assigned_to_user_id: true,
        escalations: { select: { escalate_to_user_id: true } },
      },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.read)
  }

  async getTicket(orgId: string, ticketId: string, principal?: Principal) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, organization_id: orgId, is_deleted: false },
      include: { ...TICKET_INCLUDE, activity_logs: { orderBy: { created_at: 'asc' } } },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    // Authorization (external callers only — internal post-mutation reads pass no principal).
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.read)
    return ticket
  }

  async updateTicket(orgId: string, userId: string, ticketId: string, dto: UpdateTicketDto, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.edit)
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: dto,
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'status_changed', { action: 'edited' })
    return updated
  }

  async assignTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string, dto: AssignTicketDto, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    const master = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
    const mode = master?.reassignment_mode ?? 'both'

    const isAssignee = ticket.assigned_to_user_id === userId
    if (mode === 'assignee_only' && !isAssignee) throw new ForbiddenException('Only the assignee can reassign this ticket')
    if (mode === 'admin_manager_only' && !isAdmin) throw new ForbiddenException('Only admins can reassign this ticket')
    // Under the open mode, being a participant or having edit scope over one is still required.
    if (mode === 'both' && principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.edit)

    // Subject eligibility (fail loud): the new assignee must be allowed to be assigned a ticket.
    if (dto.assigned_to_user_id) {
      await this.subjects.assertEligible(orgId, 'tickets.subject.assignable', dto.assigned_to_user_id)
    }

    const wasAssigned = !!ticket.assigned_to_user_id
    const assignedStatus = await this.getStatusByType(orgId, 'assigned')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assigned_to_user_id: dto.assigned_to_user_id,
        assigned_at: new Date(),
        status_id: assignedStatus.id,
      },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, wasAssigned ? 'reassigned' : 'assigned', {
      assigned_to: dto.assigned_to_user_id,
    })
    await this.notifyUser(orgId, ticketId, dto.assigned_to_user_id, wasAssigned ? 'reassigned' : 'assigned',
      `You have been ${wasAssigned ? 'reassigned' : 'assigned'} ticket ${ticket.ticket_number}: ${ticket.title}`)
    return updated
  }

  async acceptTicket(orgId: string, userId: string, ticketId: string) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (ticket.assigned_to_user_id !== userId) throw new ForbiddenException('Only the assigned user can accept this ticket')
    if (ticket.status.type !== 'assigned') throw new BadRequestException('Ticket must be in Assigned status to accept')
    await this.markFirstResponse(orgId, ticket, userId)
    const inProgressStatus = await this.getStatusByType(orgId, 'in_progress')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { accepted_at: new Date(), status_id: inProgressStatus.id },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'accepted')
    await this.notifyUser(orgId, ticketId, ticket.raised_by_user_id, 'status_changed',
      `Your ticket ${ticket.ticket_number} has been accepted and is now in progress`)
    return updated
  }

  async resolveTicket(orgId: string, userId: string, ticketId: string, dto: ResolveTicketDto) {
    if (!dto.resolution_note?.trim()) throw new BadRequestException('Resolution note is required')
    const ticket = await this.getTicket(orgId, ticketId)
    if (ticket.assigned_to_user_id !== userId) throw new ForbiddenException('Only the assigned user can resolve this ticket')
    if (!['in_progress', 'assigned'].includes(ticket.status.type)) throw new BadRequestException('Ticket must be in progress to resolve')

    const resolvedStatus = await this.getStatusByType(orgId, 'resolved')
    let statusId = resolvedStatus.id
    let closedAt: Date | undefined = undefined

    if (!ticket.requires_raiser_confirmation) {
      const closedStatus = await this.getStatusByType(orgId, 'closed_resolved')
      statusId = closedStatus.id
      closedAt = new Date()
    }

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        resolved_at: new Date(),
        resolution_note: dto.resolution_note,
        status_id: statusId,
        ...(closedAt && { closed_at: closedAt }),
      },
      include: TICKET_INCLUDE,
    })

    await this.logActivity(orgId, ticketId, userId, 'resolved', { resolution_note: dto.resolution_note })
    if (ticket.requires_raiser_confirmation) {
      await this.logActivity(orgId, ticketId, userId, 'confirmation_requested')
      await this.notifyUser(orgId, ticketId, ticket.raised_by_user_id, 'confirmation_requested',
        `Your ticket ${ticket.ticket_number} has been marked as resolved. Please confirm if your issue is resolved.`)
    } else {
      await this.logActivity(orgId, ticketId, userId, 'closed', { status_type: 'closed_resolved' })
      await this.notifyUser(orgId, ticketId, ticket.raised_by_user_id, 'status_changed',
        `Your ticket ${ticket.ticket_number} has been resolved and closed`)
    }
    return updated
  }

  async closeTicket(orgId: string, userId: string, ticketId: string, dto: CloseTicketDto, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.edit)
    const closedStatus = await this.getStatusByType(orgId, dto.status_type)
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { closed_at: new Date(), status_id: closedStatus.id },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'closed', { status_type: dto.status_type })
    await this.notifyUser(orgId, ticketId, ticket.raised_by_user_id, 'status_changed',
      `Your ticket ${ticket.ticket_number} has been closed`)
    return updated
  }

  async confirmResolution(orgId: string, userId: string, ticketId: string) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (ticket.raised_by_user_id !== userId) throw new ForbiddenException('Only the ticket raiser can confirm resolution')
    if (ticket.status.type !== 'resolved') throw new BadRequestException('Ticket must be resolved before confirmation')
    const closedStatus = await this.getStatusByType(orgId, 'closed_resolved')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { raiser_confirmed_at: new Date(), closed_at: new Date(), status_id: closedStatus.id },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'raiser_confirmed')
    return updated
  }

  // ─── Hold / Resume (SLA pause) ───────────────────────────────────────────────

  async holdTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string, dto: HoldTicketDto) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (!isAdmin && ticket.assigned_to_user_id !== userId) {
      throw new ForbiddenException('Only the assignee or an admin can put this ticket on hold')
    }
    if (ticket.on_hold) throw new BadRequestException('Ticket is already on hold')
    if (['closed_resolved', 'closed_unresolved'].includes(ticket.status.type)) {
      throw new BadRequestException('A closed ticket cannot be put on hold')
    }
    const holdStatus = await this.ensureStatusByType(orgId, 'on_hold', { label: 'On Hold', color: '#6B7280', order_index: 3 })
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { on_hold: true, hold_since: new Date(), status_id: holdStatus.id },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'put_on_hold', { reason: dto.reason })
    await this.notifyUser(orgId, ticketId, ticket.raised_by_user_id, 'status_changed',
      `Your ticket ${ticket.ticket_number} has been put on hold${dto.reason ? `: ${dto.reason}` : ''}`)
    return updated
  }

  async resumeTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (!isAdmin && ticket.assigned_to_user_id !== userId) {
      throw new ForbiddenException('Only the assignee or an admin can resume this ticket')
    }
    if (!ticket.on_hold || !ticket.hold_since) throw new BadRequestException('Ticket is not on hold')

    const now = new Date()
    const pausedMs = now.getTime() - ticket.hold_since.getTime()
    const pausedSeconds = Math.max(0, Math.round(pausedMs / 1000))
    // Push both clocks forward by the paused duration so the pause is "free time".
    const newSlaDue = new Date(ticket.sla_due_at.getTime() + pausedMs)
    const newResponseDue =
      ticket.response_due_at && !ticket.responded_at
        ? new Date(ticket.response_due_at.getTime() + pausedMs)
        : ticket.response_due_at
    // Return to in-progress if previously accepted, else assigned, else open.
    const resumeType = ticket.accepted_at ? 'in_progress' : ticket.assigned_to_user_id ? 'assigned' : 'open'
    const resumeStatus = await this.getStatusByType(orgId, resumeType)

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        on_hold: false,
        hold_since: null,
        total_hold_seconds: { increment: pausedSeconds },
        sla_due_at: newSlaDue,
        response_due_at: newResponseDue,
        status_id: resumeStatus.id,
      },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'resumed', { paused_seconds: pausedSeconds })
    return updated
  }

  // ─── Reject (bounce to triage) ───────────────────────────────────────────────

  async rejectTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string, dto: RejectTicketDto) {
    if (!dto.reason?.trim()) throw new BadRequestException('A rejection reason is required')
    const ticket = await this.getTicket(orgId, ticketId)
    if (!isAdmin && ticket.assigned_to_user_id !== userId) {
      throw new ForbiddenException('Only the assignee or an admin can reject this ticket')
    }
    if (['closed_resolved', 'closed_unresolved'].includes(ticket.status.type)) {
      throw new BadRequestException('A closed ticket cannot be rejected')
    }
    const openStatus = await this.getStatusByType(orgId, 'open')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assigned_to_user_id: null,
        assigned_at: null,
        accepted_at: null,
        on_hold: false,
        hold_since: null,
        status_id: openStatus.id,
      },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'rejected', { reason: dto.reason })
    const adminIds = await this.getAdminUserIds(orgId)
    await this.notifyUsers(orgId, ticketId, adminIds, 'unassigned',
      `Ticket ${ticket.ticket_number} was rejected and returned to triage: ${dto.reason}`)
    return updated
  }

  // ─── Transfer (re-route to another resolver group / department) ───────────────

  async transferTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string, dto: TransferTicketDto) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (!isAdmin && ticket.assigned_to_user_id !== userId) {
      throw new ForbiddenException('Only the assignee or an admin can transfer this ticket')
    }
    let group = null
    if (dto.resolver_group_id) {
      group = await this.prisma.ticketResolverGroup.findFirst({
        where: { id: dto.resolver_group_id, organization_id: orgId, is_active: true },
        include: { members: true },
      })
    } else if (dto.department_id) {
      group = await this.prisma.ticketResolverGroup.findFirst({
        where: { organization_id: orgId, department_id: dto.department_id, is_active: true },
        include: { members: true },
        orderBy: { name: 'asc' },
      })
    }
    if (!group) throw new BadRequestException('No active resolver group found for the transfer target')

    let assigneeId: string | null = null
    if (group.members.length && group.assignment_strategy === 'round_robin') {
      assigneeId = await this.resolveGroupRoundRobin(orgId, group.id, group.members.map((m) => m.user_id))
    }
    const status = await this.getStatusByType(orgId, assigneeId ? 'assigned' : 'open')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        resolver_group_id: group.id,
        assigned_to_user_id: assigneeId,
        assigned_at: assigneeId ? new Date() : null,
        accepted_at: null,
        on_hold: false,
        hold_since: null,
        status_id: status.id,
      },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'transferred', { to_group: group.id, reason: dto.reason })
    if (assigneeId) {
      await this.notifyUser(orgId, ticketId, assigneeId, 'assigned',
        `Ticket ${ticket.ticket_number} has been transferred to you: ${ticket.title}`)
    } else {
      const adminIds = await this.getAdminUserIds(orgId)
      await this.notifyUsers(orgId, ticketId, adminIds, 'unassigned',
        `Ticket ${ticket.ticket_number} was transferred to ${group.name} and needs assignment`)
    }
    return updated
  }

  // ─── Reopen ──────────────────────────────────────────────────────────────────

  async reopenTicket(orgId: string, userId: string, isAdmin: boolean, ticketId: string, dto: ReopenTicketDto) {
    const ticket = await this.getTicket(orgId, ticketId)
    const isClosedOrResolved = ['resolved', 'closed_resolved', 'closed_unresolved'].includes(ticket.status.type)
    if (!isClosedOrResolved) throw new BadRequestException('Only a resolved or closed ticket can be reopened')

    const master = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
    const isRaiser = ticket.raised_by_user_id === userId
    const isAssignee = ticket.assigned_to_user_id === userId
    const raiserAllowed = isRaiser && (master?.allow_requester_reopen ?? true)
    const assigneeAllowed = isAssignee && (master?.allow_assignee_reopen ?? true)
    if (!isAdmin && !raiserAllowed && !assigneeAllowed) {
      throw new ForbiddenException('You are not allowed to reopen this ticket')
    }

    // Restart the resolution clock from now (rework SLA), holiday-adjusted.
    const now = new Date()
    const rawSlaDue = new Date(now.getTime() + ticket.sla_days * 24 * 60 * 60 * 1000)
    const adjusted = await this.holidaysService.adjustDeadline(
      rawSlaDue, orgId, undefined, ticket.assigned_to_user_id ?? undefined,
      'ticket', ticket.id, ticket.title, true,
    )
    const reopenType = ticket.assigned_to_user_id ? 'in_progress' : 'open'
    const reopenStatus = await this.getStatusByType(orgId, reopenType)

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status_id: reopenStatus.id,
        reopen_count: { increment: 1 },
        resolved_at: null,
        closed_at: null,
        raiser_confirmed_at: null,
        sla_breached: false,
        sla_due_at: adjusted ?? rawSlaDue,
        on_hold: false,
        hold_since: null,
      },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'reopened', { reason: dto.reason })
    const notify = [ticket.assigned_to_user_id, ticket.raised_by_user_id].filter(
      (uid): uid is string => !!uid && uid !== userId,
    )
    await this.notifyUsers(orgId, ticketId, notify, 'status_changed',
      `Ticket ${ticket.ticket_number} has been reopened${dto.reason ? `: ${dto.reason}` : ''}`)
    return updated
  }

  async submitRating(orgId: string, userId: string, ticketId: string, dto: RateTicketDto) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (ticket.raised_by_user_id !== userId) throw new ForbiddenException('Only the ticket raiser can rate')
    if (!ticket.closed_at) throw new BadRequestException('Ticket must be closed before rating')
    if (ticket.rated_at) throw new BadRequestException('Ticket has already been rated')
    if (dto.rating < 1 || dto.rating > 5) throw new BadRequestException('Rating must be between 1 and 5')
    const master = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
    if (!master?.enable_rating) throw new BadRequestException('Rating is not enabled for this organization')
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { rating: dto.rating, rating_comment: dto.comment, rated_at: new Date() },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'rating_submitted', { rating: dto.rating })
    return updated
  }

  async submitProof(orgId: string, userId: string, ticketId: string, proofUrl: string, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.edit)
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { proof_url: proofUrl },
      include: TICKET_INCLUDE,
    })
    await this.logActivity(orgId, ticketId, userId, 'proof_attached', { proof_url: proofUrl })
    return updated
  }

  async softDeleteTicket(orgId: string, userId: string, ticketId: string, reason: string, principal?: Principal) {
    if (!reason?.trim()) throw new BadRequestException('Deletion reason is required')
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, organization_id: orgId, is_deleted: false },
      include: { ...TICKET_INCLUDE, checklist: true, escalations: true, activity_logs: true, comments: true },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    // Deletion is entitlement-gated (no participant shortcut): being on a ticket
    // does not grant the right to destroy it.
    if (principal) {
      await this.scope.assertCanActOn(orgId, principal, TicketsService.TICKETS_LEAF, PermissionAction.delete, [
        ticket.raised_by_user_id,
        ticket.assigned_to_user_id,
        ...ticket.escalations.map((e) => e.escalate_to_user_id),
      ])
    }
    await this.prisma.ticketArchive.create({
      data: {
        organization_id: orgId,
        original_ticket_id: ticketId,
        raised_by_user_id: ticket.raised_by_user_id,
        ticket_snapshot: ticket as never,
        deleted_by_user_id: userId,
        deletion_reason: reason,
        deleted_at: new Date(),
      },
    })
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { is_deleted: true, deleted_by_user_id: userId, deleted_at: new Date(), deletion_reason: reason },
    })
    await this.logActivity(orgId, ticketId, userId, 'deleted', { reason })
  }

  async listArchive(orgId: string, raisedByUserId?: string) {
    return this.prisma.ticketArchive.findMany({
      where: {
        organization_id: orgId,
        ...(raisedByUserId && { raised_by_user_id: raisedByUserId }),
      },
      orderBy: { deleted_at: 'desc' },
    })
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  async getComments(orgId: string, ticketId: string, principal?: Principal) {
    await this.assertCanViewTicket(orgId, principal, ticketId)
    return this.prisma.ticketComment.findMany({
      where: { ticket_id: ticketId, organization_id: orgId, reply_to_comment_id: null, is_deleted: false },
      include: { replies: { where: { is_deleted: false }, orderBy: { created_at: 'asc' } } },
      orderBy: { created_at: 'asc' },
    })
  }

  async addComment(orgId: string, userId: string, ticketId: string, dto: AddTicketCommentDto, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    // Commenting requires the same visibility as reading the thread.
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.read)
    const comment = await this.prisma.ticketComment.create({
      data: {
        organization_id: orgId,
        ticket_id: ticketId,
        user_id: userId,
        body: dto.body,
        attachment_urls: dto.attachment_urls ?? [],
        reply_to_comment_id: dto.reply_to_comment_id,
      },
    })
    await this.logActivity(orgId, ticketId, userId, 'comment_added')
    // A comment by the assignee counts as the first response.
    await this.markFirstResponse(orgId, ticket, userId)

    // Notify the other parties on the ticket (raiser + assignee, minus commenter)
    const snippet = dto.body.length > 80 ? `${dto.body.slice(0, 80)}…` : dto.body
    const others = [ticket.raised_by_user_id, ticket.assigned_to_user_id].filter(
      (uid): uid is string => !!uid && uid !== userId,
    )
    await this.notifyUsers(orgId, ticketId, others, 'comment', `${ticket.ticket_number}: ${snippet}`)

    return comment
  }

  async deleteComment(orgId: string, userId: string, commentId: string) {
    const comment = await this.prisma.ticketComment.findUnique({ where: { id: commentId } })
    if (!comment) throw new NotFoundException('Comment not found')
    if (comment.user_id !== userId) throw new ForbiddenException('You can only delete your own comments')
    await this.prisma.ticketComment.update({
      where: { id: commentId },
      data: { is_deleted: true, deleted_at: new Date() },
    })
    await this.logActivity(orgId, comment.ticket_id, userId, 'comment_deleted')
  }

  async toggleChecklist(orgId: string, userId: string, ticketId: string, itemId: string, principal?: Principal) {
    const ticket = await this.getTicket(orgId, ticketId)
    if (principal) await this.assertParticipantAction(orgId, principal, ticket, PermissionAction.edit)
    const item = await this.prisma.ticketChecklist.findFirst({
      where: { id: itemId, ticket_id: ticketId, organization_id: orgId },
    })
    if (!item) throw new NotFoundException('Checklist item not found')
    const updated = await this.prisma.ticketChecklist.update({
      where: { id: itemId },
      data: { is_completed: !item.is_completed },
    })
    await this.logActivity(orgId, ticketId, userId, 'checklist_updated', { item_id: itemId, completed: updated.is_completed })
    return updated
  }

  async getActivityLog(orgId: string, ticketId: string, principal?: Principal) {
    await this.assertCanViewTicket(orgId, principal, ticketId)
    return this.prisma.ticketActivityLog.findMany({
      where: { ticket_id: ticketId, organization_id: orgId },
      orderBy: { created_at: 'asc' },
    })
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats(orgId: string, userId: string) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [open, assignedToMe, slaBreached, resolvedThisMonth] = await Promise.all([
      this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, status: { type: 'open' } } }),
      this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, assigned_to_user_id: userId } }),
      this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, sla_breached: true, status: { type: { notIn: ['closed_resolved', 'closed_unresolved'] } } } }),
      this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, resolved_at: { gte: monthStart } } }),
    ])
    return { open, assignedToMe, slaBreached, resolvedThisMonth }
  }

  // ─── Reports ───────────────────────────────────────────────────────────────

  async getResolutionTimeReport(orgId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, resolved_at: { not: null }, ...dateFilter },
      select: { assigned_to_user_id: true, created_at: true, resolved_at: true },
    })
    const byUser: Record<string, { total: number; sum: number }> = {}
    for (const t of tickets) {
      if (!t.assigned_to_user_id || !t.resolved_at) continue
      const days = (t.resolved_at.getTime() - t.created_at.getTime()) / (1000 * 60 * 60 * 24)
      if (!byUser[t.assigned_to_user_id]) byUser[t.assigned_to_user_id] = { total: 0, sum: 0 }
      byUser[t.assigned_to_user_id].total++
      byUser[t.assigned_to_user_id].sum += days
    }
    return Object.entries(byUser).map(([userId, { total, sum }]) => ({
      user_id: userId,
      ticket_count: total,
      avg_days: Math.round((sum / total) * 10) / 10,
    }))
  }

  async getBreakdownReport(orgId: string, groupBy: 'type' | 'category' | 'priority' | 'status', from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, ...dateFilter },
      include: { ticket_type: true, category: true, priority: true, status: true },
    })
    const groups: Record<string, { label: string; color: string; count: number }> = {}
    for (const t of tickets) {
      let key = '', label = '', color = ''
      if (groupBy === 'type') { key = t.ticket_type_id; label = t.ticket_type.name; color = t.ticket_type.color }
      else if (groupBy === 'category') { key = t.category_id ?? 'none'; label = t.category?.name ?? 'None'; color = t.category?.color ?? '#94A3B8' }
      else if (groupBy === 'priority') { key = t.priority_id ?? 'none'; label = t.priority?.label ?? 'None'; color = t.priority?.color ?? '#94A3B8' }
      else { key = t.status_id; label = t.status.label; color = t.status.color }
      if (!groups[key]) groups[key] = { label, color, count: 0 }
      groups[key].count++
    }
    const total = tickets.length
    return Object.values(groups).map((g) => ({ ...g, share: total > 0 ? Math.round((g.count / total) * 100) : 0 }))
  }

  async getSlaBreachReport(orgId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const total = await this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, ...dateFilter } })
    const breached = await this.prisma.ticket.count({ where: { organization_id: orgId, is_deleted: false, sla_breached: true, ...dateFilter } })
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, sla_breached: true, ...dateFilter },
      include: { ticket_type: true, priority: true, status: true },
      orderBy: { sla_due_at: 'asc' },
    })
    return { total, breached, breach_rate: total > 0 ? Math.round((breached / total) * 100) : 0, tickets }
  }

  async getRatingsReport(orgId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, rated_at: { not: null }, ...dateFilter },
      select: { rating: true, rating_comment: true, rated_at: true, ticket_number: true, title: true },
    })
    const total = tickets.length
    const avg = total > 0 ? tickets.reduce((sum, t) => sum + (t.rating ?? 0), 0) / total : 0
    const distribution = [1, 2, 3, 4, 5].map((r) => ({
      rating: r,
      count: tickets.filter((t) => t.rating === r).length,
    }))
    return { total_ratings: total, avg_rating: Math.round(avg * 10) / 10, distribution, tickets }
  }

  // Avg time-to-first-response per assignee + how many breached the response SLA.
  async getFirstResponseReport(orgId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, responded_at: { not: null }, ...dateFilter },
      select: { assigned_to_user_id: true, created_at: true, responded_at: true, response_breached: true },
    })
    const byUser: Record<string, { total: number; sum: number; breached: number }> = {}
    for (const t of tickets) {
      if (!t.assigned_to_user_id || !t.responded_at) continue
      const hours = (t.responded_at.getTime() - t.created_at.getTime()) / (1000 * 60 * 60)
      const u = (byUser[t.assigned_to_user_id] ??= { total: 0, sum: 0, breached: 0 })
      u.total++
      u.sum += hours
      if (t.response_breached) u.breached++
    }
    return Object.entries(byUser).map(([userId, { total, sum, breached }]) => ({
      user_id: userId,
      responded_count: total,
      avg_hours: Math.round((sum / total) * 10) / 10,
      breached_count: breached,
    }))
  }

  // Open (non-closed) tickets bucketed by age, to surface a growing backlog tail.
  async getBacklogAgingReport(orgId: string) {
    const now = Date.now()
    const tickets = await this.prisma.ticket.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        status: { type: { notIn: ['closed_resolved', 'closed_unresolved'] } },
      },
      include: { ticket_type: true, priority: true, status: true },
      orderBy: { created_at: 'asc' },
    })
    const buckets = [
      { label: '< 1 day', min: 0, max: 1, count: 0 },
      { label: '1–3 days', min: 1, max: 3, count: 0 },
      { label: '3–7 days', min: 3, max: 7, count: 0 },
      { label: '7–14 days', min: 7, max: 14, count: 0 },
      { label: '> 14 days', min: 14, max: Infinity, count: 0 },
    ]
    for (const t of tickets) {
      const ageDays = (now - t.created_at.getTime()) / (1000 * 60 * 60 * 24)
      const b = buckets.find((bk) => ageDays >= bk.min && ageDays < bk.max)
      if (b) b.count++
    }
    return {
      total_open: tickets.length,
      buckets: buckets.map(({ label, count }) => ({ label, count })),
      oldest: tickets.slice(0, 10).map((t) => ({
        id: t.id,
        ticket_number: t.ticket_number,
        title: t.title,
        age_days: Math.round((now - t.created_at.getTime()) / (1000 * 60 * 60 * 24)),
        status: t.status.label,
        assigned_to_user_id: t.assigned_to_user_id,
        sla_breached: t.sla_breached,
      })),
    }
  }

  // Per-resolver workload: how many tickets they hold and in what state.
  async getAgentLoadReport(orgId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, assigned_to_user_id: { not: null } },
      include: { status: true },
    })
    const byUser: Record<string, { open: number; in_progress: number; on_hold: number; breached: number; resolved: number; total: number }> = {}
    for (const t of tickets) {
      if (!t.assigned_to_user_id) continue
      const u = (byUser[t.assigned_to_user_id] ??= { open: 0, in_progress: 0, on_hold: 0, breached: 0, resolved: 0, total: 0 })
      const type = t.status.type
      const closed = type === 'closed_resolved' || type === 'closed_unresolved'
      if (!closed) {
        u.total++
        if (type === 'open' || type === 'assigned') u.open++
        else if (type === 'in_progress') u.in_progress++
        else if (type === 'on_hold') u.on_hold++
        if (t.sla_breached) u.breached++
      }
      if (type === 'resolved' || type === 'closed_resolved') u.resolved++
    }
    return Object.entries(byUser).map(([userId, v]) => ({ user_id: userId, ...v }))
  }

  // How often closed tickets get reopened — a quality / first-time-fix signal.
  async getReopenRateReport(orgId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to)
    const tickets = await this.prisma.ticket.findMany({
      where: { organization_id: orgId, is_deleted: false, ...dateFilter },
      select: { reopen_count: true, closed_at: true, ticket_number: true, title: true, id: true },
    })
    const total = tickets.length
    const everReopened = tickets.filter((t) => t.reopen_count > 0)
    const totalReopens = tickets.reduce((s, t) => s + t.reopen_count, 0)
    return {
      total_tickets: total,
      reopened_tickets: everReopened.length,
      reopen_rate: total > 0 ? Math.round((everReopened.length / total) * 100) : 0,
      total_reopens: totalReopens,
      most_reopened: everReopened
        .sort((a, b) => b.reopen_count - a.reopen_count)
        .slice(0, 10)
        .map((t) => ({ id: t.id, ticket_number: t.ticket_number, title: t.title, reopen_count: t.reopen_count })),
    }
  }

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) return {}
    return { created_at: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
  }

  // ─── Cron ──────────────────────────────────────────────────────────────────

  @Cron('0 * * * *')
  async processSlaBreaches() {
    const now = new Date()
    const orgs = await this.prisma.organization.findMany({ where: { is_test: false }, select: { id: true } })
    for (const org of orgs) await this.processSlaForOrg(org.id, now)
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processSlaForOrg(orgId: string, now: Date) {
    const entitlement = await this.prisma.orgModuleEntitlement.findUnique({
      where: { organization_id_module_key: { organization_id: orgId, module_key: 'tickets' } },
      select: { state: true },
    })
    if (entitlement?.state !== 'full') return

    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'sla_breach', occurredAt: now },
      () => this.processSlaForOrgImpl(orgId, now),
    )
  }

  private async processSlaForOrgImpl(orgId: string, now: Date) {
    const master = await this.prisma.ticketMaster.findUnique({ where: { organization_id: orgId } })
    const intervalHours = master?.escalation_interval_hours ?? 24

    // 1) Newly-breached resolution SLAs. On-hold tickets are skipped (clock paused).
    const breaching = await this.prisma.ticket.findMany({
      where: {
        organization_id: orgId,
        sla_due_at: { lt: now },
        sla_breached: false,
        is_deleted: false,
        on_hold: false,
        status: { type: { notIn: ['closed_resolved', 'closed_unresolved'] } },
      },
    })
    if (breaching.length) {
      await this.prisma.ticket.updateMany({
        where: { id: { in: breaching.map((t) => t.id) } },
        data: { sla_breached: true },
      })
      await this.prisma.ticketActivityLog.createMany({
        data: breaching.map((t) => ({
          organization_id: t.organization_id,
          ticket_id: t.id,
          performed_by_user_id: 'system',
          action: 'sla_breached' as any,
        })),
      })
      await this.notifications.emitMany(
        breaching
          .filter((t) => t.assigned_to_user_id)
          .map((t) => ({
            orgId: t.organization_id,
            module: 'tickets' as const,
            event_type: 'ticket_sla_breached',
            recipients: [t.assigned_to_user_id!],
            title: 'Ticket SLA breached',
            body: `SLA breached on ticket ${t.ticket_number}: ${t.title}`,
            link: `/dashboard/tasks/tickets/${t.id}`,
            entity: { type: 'ticket', id: t.id },
          })),
      )
    }

    // 2) First-response SLA breaches (no response yet, clock elapsed).
    const responseBreaching = await this.prisma.ticket.findMany({
      where: {
        organization_id: orgId,
        response_due_at: { lt: now },
        response_breached: false,
        responded_at: null,
        is_deleted: false,
        on_hold: false,
        status: { type: { notIn: ['closed_resolved', 'closed_unresolved'] } },
      },
    })
    if (responseBreaching.length) {
      const adminIds = await this.getAdminUserIds(orgId) // hoisted: was re-queried per ticket
      await this.prisma.ticket.updateMany({
        where: { id: { in: responseBreaching.map((t) => t.id) } },
        data: { response_breached: true },
      })
      await this.prisma.ticketActivityLog.createMany({
        data: responseBreaching.map((t) => ({
          organization_id: t.organization_id,
          ticket_id: t.id,
          performed_by_user_id: 'system',
          action: 'response_breached' as any,
        })),
      })
      await this.notifications.emitMany(
        responseBreaching.map((t) => ({
          orgId: t.organization_id,
          module: 'tickets' as const,
          event_type: 'ticket_sla_breached',
          recipients: [t.assigned_to_user_id, ...adminIds].filter((u): u is string => !!u),
          title: 'Ticket SLA breached',
          body: `First-response SLA breached on ticket ${t.ticket_number}: ${t.title}`,
          link: `/dashboard/tasks/tickets/${t.id}`,
          entity: { type: 'ticket', id: t.id },
        })),
      )
    }

    // 3) Tiered escalation: fire successive levels over time on breached, still-open
    //    tickets. Level N is due at sla_due_at + (N-1) * escalation_interval_hours.
    const escalating = await this.prisma.ticket.findMany({
      where: {
        organization_id: orgId,
        sla_breached: true,
        is_deleted: false,
        on_hold: false,
        status: { type: { notIn: ['closed_resolved', 'closed_unresolved'] } },
        escalations: { some: { is_active: true, escalated_at: null } },
      },
      include: { escalations: { orderBy: { level: 'asc' } } },
    })
    // Resolve which escalation fires for each ticket (next pending level whose
    // time threshold has passed), then apply all of them set-based.
    const fires = escalating
      .map((ticket) => {
        const pending = ticket.escalations.filter((e) => e.is_active && !e.escalated_at).sort((a, b) => a.level - b.level)
        const next = pending[0]
        if (!next) return null
        const dueAt = new Date(ticket.sla_due_at.getTime() + (next.level - 1) * intervalHours * 60 * 60 * 1000)
        if (dueAt > now) return null
        return { ticket, next }
      })
      .filter((f): f is { ticket: (typeof escalating)[number]; next: (typeof escalating)[number]['escalations'][number] } => !!f)

    if (fires.length) {
      await this.prisma.ticketEscalation.updateMany({
        where: { id: { in: fires.map((f) => f.next.id) } },
        data: { escalated_at: now },
      })
      await this.prisma.ticketActivityLog.createMany({
        data: fires.map((f) => ({
          organization_id: f.ticket.organization_id,
          ticket_id: f.ticket.id,
          performed_by_user_id: 'system',
          action: 'escalated' as any,
          metadata: { level: f.next.level, user_id: f.next.escalate_to_user_id } as any,
        })),
      })
      await this.notifications.emitMany(
        fires.map((f) => ({
          orgId: f.ticket.organization_id,
          module: 'tickets' as const,
          event_type: 'ticket_escalated',
          recipients: [f.next.escalate_to_user_id],
          title: 'Ticket escalated to you',
          body: `Ticket ${f.ticket.ticket_number} escalated to you (level ${f.next.level}): ${f.ticket.title}`,
          link: `/dashboard/tasks/tickets/${f.ticket.id}`,
          entity: { type: 'ticket', id: f.ticket.id },
        })),
      )
    }
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  async getNotifications(orgId: string, userId: string) {
    return this.prisma.ticketNotification.findMany({
      where: { organization_id: orgId, user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
  }

  async markNotificationRead(orgId: string, userId: string, notificationId: string) {
    const result = await this.prisma.ticketNotification.updateMany({
      where: { id: notificationId, organization_id: orgId, user_id: userId },
      data: { is_read: true },
    })
    if (!result.count) throw new NotFoundException('Notification not found')
    return { success: true }
  }
}
