import {
  BadRequestException,
  Body,
  Controller,
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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequireAdmin } from '../common/decorators/require-admin.decorator';
import { LeaveService } from './leave.service';
import { CreateLeaveDto, DecideLeaveDto, UpdateLeaveMasterDto } from './dto/leave.dto';

@ApiTags('leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/leave')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  // ─── Availability (open to all members) ─────────────────────────────────────────

  @Get('availability')
  @ApiOperation({ summary: 'Effective leave windows for users overlapping [from,to]' })
  availability(
    @Param('orgId') orgId: string,
    @Query('userIds') userIds: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) throw new BadRequestException('from and to query parameters are required');
    const ids = (userIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.availability(orgId, ids, from, to);
  }

  // ─── Self ─────────────────────────────────────────────────────────────────────────

  @Get('mine')
  @ApiOperation({ summary: "The caller's own leaves" })
  mine(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.listMine(orgId, req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Apply for (or declare) leave for yourself' })
  apply(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateLeaveDto) {
    return this.service.create(orgId, req.user.id, req.user.id, dto);
  }

  @Patch(':id/override')
  @ApiOperation({ summary: 'Override a rejection — take the leave anyway' })
  override(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.override(orgId, req.user.id, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a leave (owner or admin)' })
  cancel(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.cancel(orgId, req.user.id, id);
  }

  // ─── Approvals ──────────────────────────────────────────────────────────────────

  // Self-scoped: answers only about the caller (no :id, no other user's data), so the
  // Work sidebar can show "Leave Approvals" to the people who actually approve leave.
  @Get('approvals/eligibility')
  @ApiOperation({ summary: 'Whether the caller approves leave for anyone under the org policy' })
  approvalEligibility(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.approvalEligibility(orgId, req.user.id);
  }

  @Get('approvals')
  @ApiOperation({ summary: 'Pending requests the caller may approve' })
  approvals(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.listApprovals(orgId, req.user.id);
  }

  @Patch(':id/decision')
  @ApiOperation({ summary: 'Approve or reject a pending leave request' })
  decide(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: DecideLeaveDto,
  ) {
    return this.service.decide(orgId, req.user.id, id, dto);
  }

  // ─── Admin: policy + manage-all ───────────────────────────────────────────────────

  @Get('master')
  @RequireAdmin()
  @ApiOperation({ summary: 'Get the org leave policy' })
  getMaster(@Param('orgId') orgId: string) {
    return this.service.getMaster(orgId);
  }

  @Put('master')
  @RequireAdmin()
  @ApiOperation({ summary: 'Update the org leave policy (approval routing, overrides, notice days)' })
  updateMaster(@Param('orgId') orgId: string, @Body() dto: UpdateLeaveMasterDto) {
    return this.service.updateMaster(orgId, dto);
  }

  @Get()
  @RequireAdmin()
  @ApiOperation({ summary: 'All leaves in the org (admin)' })
  adminList(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.adminList(orgId, req.user.id);
  }

  @Post('for/:userId')
  @RequireAdmin()
  @ApiOperation({ summary: 'Create leave on behalf of an employee (admin)' })
  createFor(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Request() req: any,
    @Body() dto: CreateLeaveDto,
  ) {
    return this.service.create(orgId, req.user.id, userId, dto);
  }
}
