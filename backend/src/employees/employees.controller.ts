import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EmployeeStatus, PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequireAdmin } from '../common/decorators/require-admin.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { EmployeeImportService } from './employee-import.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { BulkImportEmployeesDto } from './dto/bulk-import-employee.dto';

class UpdateStatusDto {
  status: EmployeeStatus;
}

class UpdateMyProfileDto {
  date_of_birth?: string | null;
  marriage_date?: string | null;
}

@ApiTags('employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly importService: EmployeeImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all employees in the organization' })
  findAll(@Param('orgId') orgId: string) {
    return this.employeesService.findAll(orgId);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Get reporting tree for all employees' })
  getReportingTree(@Param('orgId') orgId: string) {
    return this.employeesService.getReportingTree(orgId);
  }

  @Get('people-events')
  @ApiOperation({ summary: 'Get upcoming birthdays, anniversaries, new hirings, and work anniversaries' })
  getPeopleEvents(
    @Param('orgId') orgId: string,
    @Query('window') window?: string,
  ) {
    return this.employeesService.getPeopleEvents(orgId, window ? parseInt(window, 10) : 30);
  }

  @Get('imports')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Import history — past import batches with undo eligibility' })
  listImports(@Param('orgId') orgId: string) {
    return this.importService.listImportBatches(orgId);
  }

  @Get('imports/:batchId')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Full detail of one past import batch (rows, present vs removed)' })
  getImportDetail(@Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.importService.getImportBatchDetail(orgId, batchId);
  }

  @Get('me')
  @ApiOperation({ summary: "The caller's own employee profile (self-service)" })
  findMine(@Param('orgId') orgId: string, @CurrentUser('id') userId: string) {
    return this.employeesService.findMine(orgId, userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Self-edit personal fields (date of birth, marriage date) only' })
  updateMine(
    @Param('orgId') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() body: UpdateMyProfileDto,
  ) {
    return this.employeesService.updateMine(orgId, userId, body);
  }

  @Get('check-account')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Does a global login already exist for this email/phone? (drives the add form)' })
  checkAccount(
    @Param('orgId') orgId: string,
    @Query('identifier') identifier: string,
    @Query('country_code') countryCode?: string,
  ) {
    return this.employeesService.checkAccount(orgId, identifier ?? '', countryCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full employee profile with reporting chain' })
  findOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.employeesService.findOne(id, orgId);
  }

  @Post()
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a new employee (creates user account + profile)' })
  create(@Param('orgId') orgId: string, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(orgId, dto);
  }

  @Post('bulk-import/validate')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Dry-run: validate import rows, resolve refs, flag duplicates (no writes)' })
  validateImport(@Param('orgId') orgId: string, @Body() dto: BulkImportEmployeesDto) {
    return this.importService.validateImport(orgId, dto.rows);
  }

  @Post('bulk-import/commit')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Commit an import — writes valid rows and records an undoable batch' })
  commitImport(
    @Param('orgId') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BulkImportEmployeesDto,
  ) {
    return this.importService.commitImport(orgId, userId, dto.rows, dto.file_name);
  }

  @Post('imports/:batchId/undo')
  @RequirePermission('employees.profile.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Guarded undo of an import batch (window-limited, skips rows with activity)' })
  undoImport(@Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.importService.undoImport(orgId, batchId);
  }

  @Patch(':id')
  @RequirePermission('employees.profile.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update employee profile fields' })
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(id, orgId, dto);
  }

  @Patch(':id/status')
  @RequireAdmin()
  @ApiOperation({ summary: 'Update employee status (active/inactive)' })
  @ApiBody({ type: UpdateStatusDto })
  updateStatus(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateStatusDto,
  ) {
    return this.employeesService.updateStatus(id, orgId, body.status);
  }

  @Delete(':id')
  @RequireAdmin()
  @ApiOperation({
    summary: 'Delete an employee (blocked if they have reports/history — deactivate instead)',
    description:
      'Refused when the person still has reports or heads a department; the 400 carries ' +
      'those blockers so the UI can offer to clear them. Repeat with ?detach=true to ' +
      'confirm: the reporting lines and headships are cleared and the delete proceeds.',
  })
  @ApiQuery({ name: 'detach', required: false, type: Boolean })
  remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Query('detach') detach?: string,
  ) {
    return this.employeesService.remove(id, orgId, userId, detach === 'true');
  }
}
