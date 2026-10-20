import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ACCESS_RIGHTS_RESOURCE } from '../access-rights/access-rights.constants';
import { parseSkipTake } from '../common/pagination';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission(ACCESS_RIGHTS_RESOURCE, PermissionAction.read)
  @ApiOperation({ summary: 'List foundation audit log entries' })
  list(
    @Param('orgId') orgId: string,
    @Query('resource') resource?: string,
    @Query('module') module?: string,
    @Query('entity_id') entity_id?: string,
    @Query('action') action?: string,
    @Query('actor_user_id') actor_user_id?: string,
    @Query('actor_type') actor_type?: string,
    @Query('trigger_source') trigger_source?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const range = parseSkipTake(skip, take);
    return this.audit.list(orgId, {
      resource,
      module,
      entity_id,
      action,
      actor_user_id,
      actor_type,
      trigger_source,
      from_date,
      to_date,
      search,
      skip: range.skip,
      take: range.take,
    });
  }

  @Get('resources')
  @RequirePermission(ACCESS_RIGHTS_RESOURCE, PermissionAction.read)
  @ApiOperation({ summary: 'Modules (grouped resources) + trigger sources for filters' })
  async resources(@Param('orgId') orgId: string) {
    const [modules, trigger_sources] = await Promise.all([
      this.audit.resourceModules(orgId),
      this.audit.triggerSources(orgId),
    ]);
    return { modules, trigger_sources };
  }
}
