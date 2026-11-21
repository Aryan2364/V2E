import {
  BadRequestException,
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
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AssigneeVisibilityService } from './assignee-visibility.service';
import {
  CreateBridgeDto,
  SetDeptUnifyDto,
  SetDeptUpwardDto,
  SetEmployeeManualOverrideDto,
  UpdateAssigneeSettingsDto,
} from './dto/assignee-visibility.dto';

/** Single leaf governing every assignee-visibility mutation. */
const AV = 'tasks.config.assignee_visibility.manage';

@ApiTags('assignee-visibility')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/tasks/masters/assignee-visibility')
export class AssigneeVisibilityController {
  constructor(private readonly service: AssigneeVisibilityService) {}

  @Get()
  @ApiOperation({ summary: 'Full assignee-visibility config (settings, bridges, depts)' })
  getAdminView(@Param('orgId') orgId: string) {
    return this.service.getAdminView(orgId);
  }

  @Get('explain')
  @ApiOperation({ summary: "Explain a user's resolved assignee pool and which rule produced it" })
  explain(@Param('orgId') orgId: string, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('Choose a person.');
    return this.service.explain(orgId, userId);
  }

  @Put('settings')
  @RequirePermission(AV, PermissionAction.edit)
  @ApiOperation({ summary: 'Update override / excludes / full-visibility / config roles' })
  updateSettings(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: UpdateAssigneeSettingsDto,
  ) {
    return this.service.updateSettings(orgId, req.user.id, dto);
  }

  @Post('bridges')
  @RequirePermission(AV, PermissionAction.write)
  @ApiOperation({ summary: 'Create a one-directional cross-department bridge' })
  createBridge(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateBridgeDto) {
    return this.service.createBridge(orgId, req.user.id, dto);
  }

  @Delete('bridges/:id')
  @RequirePermission(AV, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a bridge' })
  deleteBridge(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.deleteBridge(orgId, req.user.id, id);
  }

  @Patch('department-upward')
  @RequirePermission(AV, PermissionAction.edit)
  @ApiOperation({ summary: 'Toggle a department\'s upward-assignment switch' })
  setDepartmentUpward(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: SetDeptUpwardDto,
  ) {
    return this.service.setDepartmentUpward(orgId, req.user.id, dto);
  }

  @Patch('department-unify')
  @RequirePermission(AV, PermissionAction.edit)
  @ApiOperation({ summary: 'Toggle treating a department + its sub-departments as one pool' })
  setDepartmentUnify(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: SetDeptUnifyDto,
  ) {
    return this.service.setDepartmentUnify(orgId, req.user.id, dto);
  }

  @Get('employee-override/:userId')
  @ApiOperation({ summary: "Read an employee's stored manual override (adds/removes/full-visibility)" })
  getEmployeeManualOverride(@Param('orgId') orgId: string, @Param('userId') userId: string) {
    return this.service.getEmployeeManualOverride(orgId, userId);
  }

  @Patch('employee-override')
  @RequirePermission(AV, PermissionAction.edit)
  @ApiOperation({ summary: "Save an employee's manual override (the most-granular layer)" })
  setEmployeeManualOverride(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: SetEmployeeManualOverrideDto,
  ) {
    return this.service.setEmployeeManualOverride(orgId, req.user.id, dto);
  }
}
