import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { MeetingsService, Actor } from './meetings.service';
import { MeetingsReportsService } from './meetings-reports.service';
import { MeetingRhythmsService } from './meeting-rhythms.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import {
  UpdateMeetingDto,
  DeleteMeetingDto,
  UpdateRecordDto,
  DeclineDto,
  MarkAttendanceDto,
  PrivateNoteDto,
  BusyQueryDto,
  CreateRhythmDto,
  UpdateRhythmDto,
} from './dto/meeting-actions.dto';
import {
  CreateActionItemDto,
  UpdateActionItemDto,
  LinkTaskDto,
  CreateDecisionDto,
  UpdateDecisionDto,
} from './dto/outputs.dto';

const MEETINGS = 'meetings';

function actorOf(req: any): Actor {
  return { id: req.user.id, system_role_id: req.user.system_role_id ?? null, is_admin: !!req.user.is_admin, isSuperAdmin: !!req.user.isSuperAdmin };
}

@ApiTags('meetings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/meetings')
export class MeetingsController {
  constructor(
    private readonly service: MeetingsService,
    private readonly reports: MeetingsReportsService,
    private readonly rhythms: MeetingRhythmsService,
  ) {}

  // ─── List / detail ──────────────────────────────────────────────────────────
  @Get()
  @RequirePermission(MEETINGS, PermissionAction.read)
  @ApiOperation({ summary: 'List meetings' })
  list(@Param('orgId') orgId: string, @Request() req: any, @Query() query: Record<string, string>) {
    return this.service.list(orgId, actorOf(req), query);
  }

  @Get('reports')
  @RequirePermission(MEETINGS, PermissionAction.read)
  @ApiOperation({ summary: 'Aggregated meeting reports (creator-scoped in v1)' })
  reportsAggregate(@Param('orgId') orgId: string, @Request() req: any, @Query() query: Record<string, string>) {
    return this.reports.report(orgId, actorOf(req), query);
  }

  @Get('decisions')
  @RequirePermission(MEETINGS, PermissionAction.read)
  @ApiOperation({ summary: 'Org-wide decision log' })
  decisionLog(@Param('orgId') orgId: string, @Query() query: Record<string, string>) {
    return this.service.listDecisions(orgId, query);
  }

  // ─── Google Calendar reverse view (the caller's OWN external events) ───────────
  // Declared before ':id' so "google" isn't captured as a meeting id.
  @Get('google/events')
  @RequirePermission(MEETINGS, PermissionAction.read)
  @ApiOperation({ summary: "The caller's external Google Calendar events in a window (deduped)" })
  googleEvents(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.googleExternalEvents(orgId, actorOf(req), from, to);
  }

  // ─── Busy view (organiser sees busy times before picking a slot) ──────────────
  @Post('busy')
  @RequirePermission(MEETINGS, PermissionAction.read)
  @ApiOperation({ summary: 'Busy times for a set of people over a window (floor, not a guarantee)' })
  busy(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: BusyQueryDto) {
    return this.service.busyView(orgId, actorOf(req), dto);
  }

  // ─── Rhythms (recurring meetings) ──────────────────────────────────────────────
  @Get('rhythms')
  @RequirePermission(MEETINGS, PermissionAction.read)
  listRhythms(@Param('orgId') orgId: string, @Request() req: any, @Query() query: Record<string, string>) {
    return this.rhythms.list(orgId, actorOf(req), query);
  }

  @Post('rhythms')
  @RequirePermission(MEETINGS, PermissionAction.write)
  createRhythm(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateRhythmDto) {
    return this.rhythms.create(orgId, actorOf(req), dto);
  }

  @Get('rhythms/:rhythmId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  getRhythm(@Param('orgId') orgId: string, @Param('rhythmId') rhythmId: string, @Request() req: any) {
    return this.rhythms.getOne(orgId, actorOf(req), rhythmId);
  }

  @Patch('rhythms/:rhythmId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  updateRhythm(@Param('orgId') orgId: string, @Param('rhythmId') rhythmId: string, @Request() req: any, @Body() dto: UpdateRhythmDto) {
    return this.rhythms.update(orgId, actorOf(req), rhythmId, dto);
  }

  @Post('rhythms/:rhythmId/pause')
  @RequirePermission(MEETINGS, PermissionAction.read)
  pauseRhythm(@Param('orgId') orgId: string, @Param('rhythmId') rhythmId: string, @Request() req: any) {
    return this.rhythms.pause(orgId, actorOf(req), rhythmId);
  }

  @Post('rhythms/:rhythmId/resume')
  @RequirePermission(MEETINGS, PermissionAction.read)
  resumeRhythm(@Param('orgId') orgId: string, @Param('rhythmId') rhythmId: string, @Request() req: any) {
    return this.rhythms.resume(orgId, actorOf(req), rhythmId);
  }

  @Delete('rhythms/:rhythmId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  removeRhythm(@Param('orgId') orgId: string, @Param('rhythmId') rhythmId: string, @Request() req: any, @Query('mode') mode?: 'stop' | 'delete-future') {
    return this.rhythms.remove(orgId, actorOf(req), rhythmId, mode ?? 'stop');
  }

  @Get(':id')
  @RequirePermission(MEETINGS, PermissionAction.read)
  getOne(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getOne(orgId, actorOf(req), id);
  }

  @Get(':id/analytics')
  @RequirePermission(MEETINGS, PermissionAction.read)
  async analytics(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    await this.service.assertCanViewMeeting(orgId, actorOf(req), id);
    return this.reports.analytics(orgId, id);
  }

  @Get(':id/edit-log')
  @RequirePermission(MEETINGS, PermissionAction.read)
  editLog(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getEditLog(orgId, id, actorOf(req));
  }

  // ─── Create / update / delete ─────────────────────────────────────────────────
  @Post()
  @RequirePermission(MEETINGS, PermissionAction.write)
  create(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateMeetingDto) {
    return this.service.create(orgId, actorOf(req), dto);
  }

  @Patch(':id')
  @RequirePermission(MEETINGS, PermissionAction.read)
  update(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: UpdateMeetingDto) {
    return this.service.update(orgId, actorOf(req), id, dto);
  }

  @Delete(':id')
  @RequirePermission(MEETINGS, PermissionAction.delete)
  remove(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: DeleteMeetingDto) {
    return this.service.remove(orgId, actorOf(req), id, dto?.reason);
  }

  // ─── Shared record ─────────────────────────────────────────────────────────────
  @Put(':id/record')
  @RequirePermission(MEETINGS, PermissionAction.read)
  updateRecord(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: UpdateRecordDto) {
    return this.service.updateRecord(orgId, actorOf(req), id, dto);
  }

  // ─── Attendance response (opt-out: only decline / undo) ─────────────────────────
  @Post(':id/decline')
  @RequirePermission(MEETINGS, PermissionAction.read)
  decline(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: DeclineDto) {
    return this.service.decline(orgId, actorOf(req), id, dto);
  }

  @Post(':id/undo-decline')
  @RequirePermission(MEETINGS, PermissionAction.read)
  undoDecline(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.undoDecline(orgId, actorOf(req), id);
  }

  // ─── Lifecycle / time capture ──────────────────────────────────────────────────
  @Post(':id/start')
  @RequirePermission(MEETINGS, PermissionAction.read)
  start(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.start(orgId, actorOf(req), id);
  }

  @Post(':id/end')
  @RequirePermission(MEETINGS, PermissionAction.read)
  end(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.end(orgId, actorOf(req), id);
  }

  @Post(':id/close')
  @RequirePermission(MEETINGS, PermissionAction.read)
  close(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.close(orgId, actorOf(req), id);
  }

  @Post(':id/cancel')
  @RequirePermission(MEETINGS, PermissionAction.read)
  cancel(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: DeleteMeetingDto) {
    return this.service.cancel(orgId, actorOf(req), id, dto?.reason);
  }

  @Post(':id/reopen')
  @RequirePermission(MEETINGS, PermissionAction.read)
  reopen(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.reopen(orgId, actorOf(req), id);
  }

  @Post(':id/attendance')
  @RequirePermission(MEETINGS, PermissionAction.read)
  attendance(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: MarkAttendanceDto) {
    return this.service.markAttendance(orgId, actorOf(req), id, dto);
  }

  // ─── Private note ──────────────────────────────────────────────────────────────
  @Put(':id/my-note')
  @RequirePermission(MEETINGS, PermissionAction.read)
  myNote(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: PrivateNoteDto) {
    return this.service.upsertMyNote(orgId, actorOf(req), id, dto);
  }

  // ─── Action items ──────────────────────────────────────────────────────────────
  @Post(':id/action-items')
  @RequirePermission(MEETINGS, PermissionAction.read)
  addActionItem(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: CreateActionItemDto) {
    return this.service.addActionItem(orgId, actorOf(req), id, dto);
  }

  @Patch(':id/action-items/:itemId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  updateActionItem(@Param('orgId') orgId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Request() req: any, @Body() dto: UpdateActionItemDto) {
    return this.service.updateActionItem(orgId, actorOf(req), id, itemId, dto);
  }

  @Delete(':id/action-items/:itemId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  deleteActionItem(@Param('orgId') orgId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Request() req: any) {
    return this.service.deleteActionItem(orgId, actorOf(req), id, itemId);
  }

  @Post(':id/action-items/:itemId/link-task')
  @RequirePermission(MEETINGS, PermissionAction.read)
  linkTask(@Param('orgId') orgId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Request() req: any, @Body() dto: LinkTaskDto) {
    return this.service.linkTask(orgId, actorOf(req), id, itemId, dto);
  }

  // ─── Decisions ───────────────────────────────────────────────────────────────
  @Post(':id/decisions')
  @RequirePermission(MEETINGS, PermissionAction.read)
  addDecision(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any, @Body() dto: CreateDecisionDto) {
    return this.service.addDecision(orgId, actorOf(req), id, dto);
  }

  @Patch(':id/decisions/:decisionId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  updateDecision(@Param('orgId') orgId: string, @Param('id') id: string, @Param('decisionId') decisionId: string, @Request() req: any, @Body() dto: UpdateDecisionDto) {
    return this.service.updateDecision(orgId, actorOf(req), id, decisionId, dto);
  }

  @Delete(':id/decisions/:decisionId')
  @RequirePermission(MEETINGS, PermissionAction.read)
  deleteDecision(@Param('orgId') orgId: string, @Param('id') id: string, @Param('decisionId') decisionId: string, @Request() req: any) {
    return this.service.deleteDecision(orgId, actorOf(req), id, decisionId);
  }
}
