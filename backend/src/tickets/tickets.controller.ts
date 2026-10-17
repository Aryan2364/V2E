import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { OrgScopeGuard } from '../common/guards/org-scope.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { principalFromUser } from '../access-rights/permissions.service'
import { TicketsService } from './tickets.service'
import { RaiseTicketDto } from './dto/raise-ticket.dto'
import { UpdateTicketDto } from './dto/update-ticket.dto'
import { AssignTicketDto } from './dto/assign-ticket.dto'
import { ResolveTicketDto } from './dto/resolve-ticket.dto'
import { CloseTicketDto } from './dto/close-ticket.dto'
import { RateTicketDto } from './dto/rate-ticket.dto'
import { AddTicketCommentDto } from './dto/add-comment.dto'
import { DeleteTicketDto } from './dto/delete-ticket.dto'
import { HoldTicketDto } from './dto/hold-ticket.dto'
import { RejectTicketDto } from './dto/reject-ticket.dto'
import { TransferTicketDto } from './dto/transfer-ticket.dto'
import { ReopenTicketDto } from './dto/reopen-ticket.dto'

interface AuthUser {
  id: string
  role: string
  is_admin?: boolean
  isSuperAdmin?: boolean
  system_role_id?: string | null
  organizationId: string
}

@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  raise(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Body() dto: RaiseTicketDto) {
    return this.ticketsService.raiseTicket(orgId, user.id, dto)
  }

  @Get()
  list(
    @Param('orgId') orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('typeId') typeId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('priorityId') priorityId?: string,
    @Query('statusId') statusId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('raisedBy') raisedBy?: string,
    @Query('slaBreached') slaBreached?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: 'created_desc' | 'created_asc',
  ) {
    return this.ticketsService.listTickets(
      orgId,
      principalFromUser(user),
      {
        typeId,
        categoryId,
        priorityId,
        statusId,
        assignedTo,
        raisedBy,
        slaBreached: slaBreached !== undefined ? slaBreached === 'true' : undefined,
        from,
        to,
        search,
      },
      page !== undefined ? parseInt(page, 10) : undefined,
      pageSize !== undefined ? parseInt(pageSize, 10) : undefined,
      sort,
    )
  }

  @Get('stats')
  getStats(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getStats(orgId, user.id)
  }

  @Get('my')
  listMy(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.listTickets(orgId, principalFromUser(user), { raisedBy: user.id })
  }

  @Get('assigned')
  listAssigned(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.listTickets(orgId, principalFromUser(user), { assignedTo: user.id })
  }

  @Get('archive')
  listArchive(
    @Param('orgId') orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ticketsService.listArchive(
      orgId,
      user.is_admin ? undefined : user.id,
      search,
      page !== undefined ? parseInt(page, 10) : undefined,
      pageSize !== undefined ? parseInt(pageSize, 10) : undefined,
    )
  }

  @Get('notifications')
  getNotifications(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getNotifications(orgId, user.id)
  }

  @Patch('notifications/:nid/read')
  markRead(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('nid') nid: string) {
    return this.ticketsService.markNotificationRead(orgId, user.id, nid)
  }

  // Templates the current user may pick when raising (access-filtered).
  @Get('templates/accessible')
  accessibleTemplates(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.listAccessibleTemplates(orgId, user.id)
  }

  // Resolvers who may be assigned a ticket of the given type/category/template.
  @Get('assignable')
  assignable(
    @Param('orgId') orgId: string,
    @Query('typeId') typeId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('templateId') templateId?: string,
  ) {
    return this.ticketsService.listAssignableUsers(orgId, { typeId, categoryId, templateId })
  }

  @Get(':id')
  getOne(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.getTicket(orgId, id, principalFromUser(user))
  }

  @Patch(':id')
  update(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketsService.updateTicket(orgId, user.id, id, dto, principalFromUser(user))
  }

  @Delete(':id')
  remove(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeleteTicketDto) {
    return this.ticketsService.softDeleteTicket(orgId, user.id, id, dto.reason, principalFromUser(user))
  }

  @Post(':id/assign')
  assign(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.ticketsService.assignTicket(orgId, user.id, !!user.is_admin, id, dto, principalFromUser(user))
  }

  @Post(':id/accept')
  accept(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.acceptTicket(orgId, user.id, id)
  }

  @Post(':id/resolve')
  resolve(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResolveTicketDto) {
    return this.ticketsService.resolveTicket(orgId, user.id, id, dto)
  }

  @Post(':id/close')
  close(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CloseTicketDto) {
    return this.ticketsService.closeTicket(orgId, user.id, id, dto, principalFromUser(user))
  }

  @Post(':id/confirm')
  confirm(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.confirmResolution(orgId, user.id, id)
  }

  @Post(':id/hold')
  hold(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HoldTicketDto) {
    return this.ticketsService.holdTicket(orgId, user.id, !!user.is_admin, id, dto)
  }

  @Post(':id/resume')
  resume(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.resumeTicket(orgId, user.id, !!user.is_admin, id)
  }

  @Post(':id/reject')
  reject(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectTicketDto) {
    return this.ticketsService.rejectTicket(orgId, user.id, !!user.is_admin, id, dto)
  }

  @Post(':id/transfer')
  transfer(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TransferTicketDto) {
    return this.ticketsService.transferTicket(orgId, user.id, !!user.is_admin, id, dto)
  }

  @Post(':id/reopen')
  reopen(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReopenTicketDto) {
    return this.ticketsService.reopenTicket(orgId, user.id, !!user.is_admin, id, dto)
  }

  @Post(':id/rate')
  rate(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RateTicketDto) {
    return this.ticketsService.submitRating(orgId, user.id, id, dto)
  }

  @Post(':id/proof')
  proof(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body('proof_url') proofUrl: string) {
    return this.ticketsService.submitProof(orgId, user.id, id, proofUrl, principalFromUser(user))
  }

  @Get(':id/logs')
  getLogs(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.getActivityLog(orgId, id, principalFromUser(user))
  }

  @Get(':id/comments')
  getComments(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketsService.getComments(orgId, id, principalFromUser(user))
  }

  @Post(':id/comments')
  addComment(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddTicketCommentDto) {
    return this.ticketsService.addComment(orgId, user.id, id, dto, principalFromUser(user))
  }

  @Delete(':id/comments/:cid')
  deleteComment(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('cid') cid: string) {
    return this.ticketsService.deleteComment(orgId, user.id, cid)
  }

  @Patch(':id/checklist/:iid')
  toggleChecklist(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('iid') iid: string) {
    return this.ticketsService.toggleChecklist(orgId, user.id, id, iid, principalFromUser(user))
  }
}
