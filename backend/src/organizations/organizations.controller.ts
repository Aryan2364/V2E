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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { SuperAdmin } from '../common/decorators/super-admin.decorator';
import {
  CreateOrgWithAdminDto,
} from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateEntitlementsDto } from './dto/update-entitlements.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @SuperAdmin()
  findAll() {
    return this.organizationsService.findAll();
  }

  @Post()
  @SuperAdmin()
  create(@Body() dto: CreateOrgWithAdminDto) {
    return this.organizationsService.create(dto);
  }

  // Declared BEFORE @Get(':id') so it isn't captured as an :id. Lets the firm-creation
  // form know if the admin email already has a login → show a password field only for a
  // brand-new person, and none for an existing one.
  @Get('check-account')
  @SuperAdmin()
  checkAccount(
    @Query('identifier') identifier: string,
    @Query('country_code') countryCode?: string,
  ) {
    return this.organizationsService.checkAccount(identifier ?? '', countryCode);
  }

  // Member-scoped: any member of the org (not just super admins) can read their
  // own org's basic profile for the dashboard header. Scoped by OrgScopeGuard.
  @Get(':orgId/summary')
  @UseGuards(OrgScopeGuard)
  findSummary(@Param('orgId') orgId: string) {
    return this.organizationsService.findSummary(orgId);
  }

  @Get(':id')
  @SuperAdmin()
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @SuperAdmin()
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id/deactivate')
  @SuperAdmin()
  deactivate(@Param('id') id: string) {
    return this.organizationsService.deactivate(id);
  }

  @Post(':id/reactivate')
  @SuperAdmin()
  reactivate(@Param('id') id: string) {
    return this.organizationsService.reactivate(id);
  }

  // ─── Module entitlements (vendor ceiling — superadmin only) ───────────────────

  @Get(':id/entitlements')
  @SuperAdmin()
  getEntitlements(@Param('id') id: string) {
    return this.organizationsService.getEntitlements(id);
  }

  @Put(':id/entitlements')
  @SuperAdmin()
  setEntitlements(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateEntitlementsDto,
  ) {
    return this.organizationsService.setEntitlements(id, req.user.id, dto);
  }
}
