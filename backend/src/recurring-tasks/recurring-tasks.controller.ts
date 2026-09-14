import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataScope, PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { principalFromUser } from '../access-rights/permissions.service';
import { RecurringTasksService, type RecurringRelation } from './recurring-tasks.service';
import { SetAccessDto } from './dto/set-access.dto';
import { RecurringAttachmentsService } from './recurring-attachments.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ClockService } from '../clock/clock.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';
import { CreateScheduleEntryDto } from './dto/create-schedule-entry.dto';
import { MAX_ATTACHMENT_BYTES, type UploadedFile as UploadedFileType } from '../tasks/task-attachments.service';

@ApiTags('recurring-tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/tasks/recurring')
export class RecurringTasksController {
  constructor(
    private readonly service: RecurringTasksService,
    private readonly attachments: RecurringAttachmentsService,
    private readonly scheduler: SchedulerService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List recurring task templates (scope + relation aware)' })
  async list(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: DataScope,
    @Query('relation') relation?: RecurringRelation,
    @Query('status') status?: 'active' | 'paused',
    @Query('category_id') categoryId?: string,
    @Query('priority_id') priorityId?: string,
    @Query('department_id') departmentId?: string,
    @Query('search') search?: string,
  ) {
    const now = await this.clock.now(orgId);
    return this.service.listTemplates(
      orgId,
      principalFromUser(req.user),
      { scope, relation, status, category_id: categoryId, priority_id: priorityId, department_id: departmentId, search },
      now,
    );
  }

  // ─── Manage access (Google-Drive-style sharing) ──────────────────────────────

  @Get(':id/access')
  @ApiOperation({ summary: 'Who can see this template — rule-based viewers + shares + removals' })
  getAccess(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    return this.service.getAccess(orgId, principalFromUser(req.user), id);
  }

  @Post(':id/access')
  @ApiOperation({ summary: 'Share with / remove a person (creator or admin only)' })
  setAccess(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Body() dto: SetAccessDto) {
    return this.service.setAccess(orgId, principalFromUser(req.user), id, dto.user_id, dto.kind, dto.level);
  }

  @Delete(':id/access/:userId')
  @ApiOperation({ summary: 'Clear a person’s override — un-share or restore (creator or admin only)' })
  clearAccess(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.service.clearAccess(orgId, principalFromUser(req.user), id, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring task template' })
  async create(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateRecurringDto) {
    const template = await this.service.createTemplate(orgId, req.user.id, dto);
    // Immediately spawn today's occurrence if the schedule fires today (org's effective clock)
    const now = await this.clock.now(orgId);
    this.scheduler.spawnForTemplate(orgId, template!.id, false, now).catch(() => null);
    return template;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring task template' })
  async update(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Body() dto: UpdateRecurringDto) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    // The editor's own id, not the template creator's: the save-time assignee-visibility
    // check must be judged against the person actually making the change, and any
    // propagated removal is attributed to them on each child task.
    return this.service.updateTemplate(orgId, id, dto, req.user.id);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a recurring task template' })
  async pause(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.service.pauseTemplate(orgId, id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused recurring task template' })
  async resume(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    const template = await this.service.resumeTemplate(orgId, id);
    // Immediately spawn today's occurrence if the schedule fires today (org's effective clock)
    const now = await this.clock.now(orgId);
    this.scheduler.spawnForTemplate(orgId, id, false, now).catch(() => null);
    return template;
  }

  @Post(':id/spawn-today')
  @ApiOperation({ summary: 'Manually trigger today\'s spawn for a recurring template' })
  async spawnToday(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    const now = await this.clock.now(orgId);
    return this.scheduler.spawnForTemplate(orgId, id, true, now);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or stop a recurring task template' })
  async remove(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Query('mode') mode?: 'stop' | 'delete-future' | 'delete-all',
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.delete);
    return this.service.deleteTemplate(orgId, id, mode ?? 'stop');
  }

  @Get(':id/instances')
  @ApiOperation({ summary: 'Get task instances spawned from a template' })
  async getInstances(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    return this.service.getInstances(orgId, id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get completion + timing performance stats for a recurring template' })
  async getStats(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    // Trend window follows the org's effective clock (simulated for test orgs).
    const now = await this.clock.now(orgId);
    return this.service.getStats(orgId, id, now);
  }

  // ─── Attachments (carried into every spawned instance) ───────────────────────

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Upload a document attachment to a recurring template' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileType,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.attachments.upload(orgId, req.user.id, id, file);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List attachments on a recurring template' })
  async listAttachments(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    return this.attachments.listForTemplate(orgId, id);
  }

  @Get(':id/instance-attachments')
  @ApiOperation({ summary: 'List attachments across spawned task instances' })
  async listInstanceAttachments(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    return this.service.getInstanceAttachments(orgId, id, principalFromUser(req.user));
  }


  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Get a short-lived signed download URL for a template attachment' })
  async downloadAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    return this.attachments.getDownloadUrl(orgId, id, attachmentId);
  }

  @Delete(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Remove a template attachment (uploader only)' })
  async removeAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.attachments.remove(orgId, req.user.id, id, attachmentId);
  }

  // ─── Schedule Entries ───────────────────────────────────────────────────────

  @Get(':id/schedules')
  @ApiOperation({ summary: 'List schedule entries for a template' })
  async listSchedules(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.read);
    return this.service.listScheduleEntries(orgId, id);
  }

  @Post(':id/schedules')
  @ApiOperation({ summary: 'Add a schedule entry to a template' })
  async addSchedule(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateScheduleEntryDto,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.service.addScheduleEntry(orgId, id, dto);
  }

  @Patch(':id/schedules/:eid')
  @ApiOperation({ summary: 'Update a schedule entry' })
  async updateSchedule(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('eid') eid: string,
    @Body() dto: Partial<CreateScheduleEntryDto>,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.service.updateScheduleEntry(orgId, id, eid, dto);
  }

  @Delete(':id/schedules/:eid')
  @ApiOperation({ summary: 'Delete a schedule entry' })
  async deleteSchedule(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('eid') eid: string,
  ) {
    await this.service.assertCanAccessTemplate(orgId, principalFromUser(req.user), id, PermissionAction.edit);
    return this.service.deleteScheduleEntry(orgId, id, eid);
  }
}
