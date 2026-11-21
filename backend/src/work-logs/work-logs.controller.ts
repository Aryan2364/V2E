import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { AuthRequest } from '../common/types/auth-request';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { WorkLogsService, Actor } from './work-logs.service';
import {
  CreateDemandDto,
  CreateReaderGrantDto,
  CreateRemarkDto,
  SubmitSubmissionDto,
  UpdateAccessSettingsDto,
  UpsertDailyUpdateDto,
} from './dto/work-log.dto';

function actorOf(req: AuthRequest): Actor {
  return { id: req.user.id, is_admin: !!req.user.is_admin, isSuperAdmin: !!req.user.isSuperAdmin };
}

@ApiTags('work-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/work-logs')
export class WorkLogsController {
  constructor(private readonly service: WorkLogsService) {}

  // ─── Daily Update ────────────────────────────────────────────────────────────
  @Get('daily')
  @ApiOperation({ summary: "Get my Daily Update for a date (+ carry-forward + folded demands)" })
  getDay(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Query('date') date?: string) {
    return this.service.getDay(orgId, actorOf(req), date);
  }

  @Put('daily')
  @ApiOperation({ summary: 'Create/update my Daily Update for a date' })
  upsertDay(
    @Param('orgId') orgId: string,
    @Request() req: AuthRequest,
    @Body() dto: UpsertDailyUpdateDto,
    @Query('date') date?: string,
  ) {
    return this.service.upsertDay(orgId, actorOf(req), date, dto);
  }

  @Get('daily/context')
  @ApiOperation({ summary: "Sidebar context: that day's tasks due + tickets to/by me" })
  getDayContext(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Query('date') date?: string) {
    return this.service.getDayContext(orgId, actorOf(req), date);
  }

  // ─── Review (read-down) ────────────────────────────────────────────────────────
  @Get('readable-writers')
  @ApiOperation({ summary: 'People below me whose logs I can read' })
  readableWriters(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.listReadableWriters(orgId, actorOf(req));
  }

  @Get('writer/:writerId')
  @ApiOperation({ summary: "A writer's logs (daily updates + standalone submissions)" })
  writerLogs(
    @Param('orgId') orgId: string,
    @Param('writerId') writerId: string,
    @Request() req: AuthRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getWriterLogs(orgId, actorOf(req), writerId, from, to);
  }

  @Get('writer/:writerId/daily')
  @ApiOperation({ summary: "A writer's Daily Update for a specific date" })
  writerDay(
    @Param('orgId') orgId: string,
    @Param('writerId') writerId: string,
    @Request() req: AuthRequest,
    @Query('date') date: string,
  ) {
    return this.service.getWriterDay(orgId, actorOf(req), writerId, date);
  }

  // ─── Demands ───────────────────────────────────────────────────────────────────
  @Get('demands')
  @ApiOperation({ summary: 'Demands I created' })
  listDemands(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.listDemands(orgId, actorOf(req));
  }

  @Post('demands')
  @ApiOperation({ summary: 'Demand a log from someone below me' })
  createDemand(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Body() dto: CreateDemandDto) {
    return this.service.createDemand(orgId, actorOf(req), dto);
  }

  @Get('demands/:id')
  @ApiOperation({ summary: 'A demand and its submission series' })
  demandSeries(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getDemandSeries(orgId, actorOf(req), id);
  }

  @Post('demands/:id/pause')
  pauseDemand(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.pauseDemand(orgId, actorOf(req), id);
  }

  @Post('demands/:id/resume')
  resumeDemand(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.resumeDemand(orgId, actorOf(req), id);
  }

  @Delete('demands/:id')
  deleteDemand(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.deleteDemand(orgId, actorOf(req), id);
  }

  // ─── My standalone (non-daily) demanded logs ────────────────────────────────────
  @Get('my-submissions')
  @ApiOperation({ summary: 'Standalone demanded logs assigned to me' })
  mySubmissions(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Query('status') status?: string) {
    return this.service.listMySubmissions(orgId, actorOf(req), status);
  }

  @Put('submissions/:id')
  @ApiOperation({ summary: 'Submit a standalone demanded log' })
  submit(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: SubmitSubmissionDto,
  ) {
    return this.service.submitSubmission(orgId, actorOf(req), id, dto);
  }

  // ─── Remarks ───────────────────────────────────────────────────────────────────
  @Get('remarks')
  @ApiOperation({ summary: 'Remarks (+ replies) on a log' })
  getRemarks(
    @Param('orgId') orgId: string,
    @Request() req: AuthRequest,
    @Query('target_type') targetType: string,
    @Query('target_id') targetId: string,
  ) {
    return this.service.getRemarks(orgId, actorOf(req), targetType, targetId);
  }

  @Post('remarks')
  @ApiOperation({ summary: 'Add a remark or reply on a log' })
  addRemark(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Body() dto: CreateRemarkDto) {
    return this.service.addRemark(orgId, actorOf(req), dto);
  }

  @Delete('remarks/:id')
  deleteRemark(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.deleteRemark(orgId, actorOf(req), id);
  }

  // ─── Admin access ────────────────────────────────────────────────────────────
  @Get('access')
  @ApiOperation({ summary: 'Work Log access config (admin)' })
  getAccess(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.getAccessConfig(orgId, actorOf(req));
  }

  @Put('access/settings')
  updateAccess(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Body() dto: UpdateAccessSettingsDto) {
    return this.service.updateAccessSettings(orgId, actorOf(req), dto);
  }

  @Post('access/grants')
  addGrant(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Body() dto: CreateReaderGrantDto) {
    return this.service.addReaderGrant(orgId, actorOf(req), dto);
  }

  @Delete('access/grants/:id')
  removeGrant(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.removeReaderGrant(orgId, actorOf(req), id);
  }
}
