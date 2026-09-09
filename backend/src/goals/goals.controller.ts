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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { GoalsService } from './goals.service';
import { principalFromUser } from '../access-rights/permissions.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto, DeleteGoalDto } from './dto/update-goal.dto';
import { CreateGoalCheckInDto } from './dto/create-check-in.dto';
import { VoidCheckInDto } from './dto/void-check-in.dto';
import { CreateGoalLinkDto, UpdateGoalLinkDto } from './dto/goal-link.dto';

const GOALS = 'goals';

/**
 * Goals is deliberately flat on access: holding the `goals` leaf at the right
 * action IS the permission. There is no row-level scope and no per-goal
 * participation gate — goals are company-wide by design. Multi-tenant
 * isolation still holds: OrgScopeGuard proves membership of :orgId, and every
 * service query filters on organization_id, so an id from another firm 404s.
 */
@ApiTags('goals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/goals')
export class GoalsController {
  constructor(private readonly service: GoalsService) {}

  // ─── Reads ──────────────────────────────────────────────────────────────────
  @Get()
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'List goals (flat) with filters' })
  list(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('owner_user_id') owner_user_id?: string,
    @Query('department_id') department_id?: string,
    @Query('status') status?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list(orgId, principalFromUser(req.user), {
      owner_user_id,
      department_id,
      status,
      from_date,
      to_date,
      search,
    });
  }

  @Get('dashboard')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Counts by status, plus at-risk / overdue / stale lists' })
  dashboard(@Param('orgId') orgId: string) {
    return this.service.dashboard(orgId);
  }

  @Get('my-check-ins')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Goals I own that owe a check-in' })
  myCheckIns(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.myCheckIns(orgId, req.user.id);
  }

  @Get('my-check-ins/count')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Badge count for the My check-ins nav item' })
  myCheckInCount(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.myCheckInCount(orgId, req.user.id);
  }

  // Declared BEFORE :id so 'strategy-map' is never read as a goal id.
  @Get('strategy-map')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Every goal + every link edge, for the Strategic Map canvas' })
  strategyMap(@Param('orgId') orgId: string) {
    return this.service.strategyMap(orgId);
  }

  @Get(':id')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Goal detail (both sides of its web, check-ins, linked tasks)' })
  getOne(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    // The principal is needed to respect the Projects module's own row scope
    // when listing this goal's linked projects.
    return this.service.getOne(orgId, id, principalFromUser(req.user));
  }

  @Get(':id/check-ins')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Full check-in history for a goal (voided rows included)' })
  listCheckIns(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.listCheckIns(orgId, id);
  }

  @Get(':id/link-candidates')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Goals that may be linked in a direction (loops pre-filtered out)' })
  linkCandidates(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query('direction') direction?: string,
  ) {
    const dir = direction === 'supports' ? 'supports' : 'supported_by';
    return this.service.linkCandidates(orgId, id, dir);
  }

  @Get(':id/delete-impact')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'What deleting this goal would sever (for the confirm dialog)' })
  deleteImpact(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.deleteImpact(orgId, id, principalFromUser(req.user));
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────
  @Post()
  @RequirePermission(GOALS, PermissionAction.write)
  @ApiOperation({ summary: 'Create a goal' })
  create(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateGoalDto) {
    return this.service.create(orgId, req.user.id, dto);
  }

  @Patch(':id')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Update a goal' })
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.service.update(orgId, req.user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission(GOALS, PermissionAction.delete)
  @ApiOperation({ summary: 'Soft-delete a goal (never blocked; links are preserved)' })
  remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: DeleteGoalDto,
  ) {
    return this.service.remove(orgId, req.user.id, id, dto?.reason);
  }

  // ─── Check-ins ──────────────────────────────────────────────────────────────
  @Post(':id/check-ins')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Record a check-in (number + traffic light + note)' })
  createCheckIn(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: CreateGoalCheckInDto,
  ) {
    return this.service.createCheckIn(orgId, req.user.id, id, dto);
  }

  @Post('check-ins/:checkInId/void')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Void a check-in (kept + reason; never edited or deleted)' })
  voidCheckIn(
    @Param('orgId') orgId: string,
    @Param('checkInId') checkInId: string,
    @Request() req: any,
    @Body() dto: VoidCheckInDto,
  ) {
    return this.service.voidCheckIn(orgId, req.user.id, checkInId, dto);
  }

  // ─── Linked projects ────────────────────────────────────────────────────────
  @Get(':id/project-candidates')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Projects this user could link to the goal (already-linked excluded)' })
  projectCandidates(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.projectCandidates(orgId, id, principalFromUser(req.user));
  }

  @Post(':id/projects/:projectId')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Attach a project to this goal (a project may serve several goals)' })
  linkProject(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Request() req: any,
  ) {
    return this.service.linkProject(orgId, req.user.id, id, projectId);
  }

  @Delete(':id/projects/:projectId')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Detach a project from this goal (the project itself is untouched)' })
  unlinkProject(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Request() req: any,
  ) {
    return this.service.unlinkProject(orgId, req.user.id, id, projectId);
  }

  // ─── Links ──────────────────────────────────────────────────────────────────
  @Get(':id/links')
  @RequirePermission(GOALS, PermissionAction.read)
  @ApiOperation({ summary: 'Both sides of a goal’s web' })
  getLinks(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.getLinks(orgId, id);
  }

  @Post(':id/links')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Link a goal as a supporter of this one (self-links and loops refused)' })
  createLink(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: CreateGoalLinkDto,
  ) {
    return this.service.createLink(orgId, req.user.id, id, dto);
  }

  @Patch('links/:linkId')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Edit a link’s note' })
  updateLink(
    @Param('orgId') orgId: string,
    @Param('linkId') linkId: string,
    @Request() req: any,
    @Body() dto: UpdateGoalLinkDto,
  ) {
    return this.service.updateLink(orgId, req.user.id, linkId, dto);
  }

  @Delete('links/:linkId')
  @RequirePermission(GOALS, PermissionAction.edit)
  @ApiOperation({ summary: 'Unlink two goals' })
  removeLink(@Param('orgId') orgId: string, @Param('linkId') linkId: string, @Request() req: any) {
    return this.service.removeLink(orgId, req.user.id, linkId);
  }
}
