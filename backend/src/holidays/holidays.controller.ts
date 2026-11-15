import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common'
import { BulkImportOrgHolidaysDto } from './dto/bulk-import-org-holidays.dto'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { HolidayStatus, HolidayType, PermissionAction } from '@prisma/client'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { OrgScopeGuard } from '../common/guards/org-scope.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermission } from '../common/decorators/require-permission.decorator'
import { HolidaysService } from './holidays.service'

// Holiday management is gated by central access rights (System Roles); admins hold
// these implicitly. Viewing holidays stays open to all members (no gate on GETs).
const ORG = 'holidays.org.manage'
const DEPT = 'holidays.department.manage'
const INDIV = 'holidays.individual.manage'
import { UpdateHolidayMasterDto } from './dto/update-holiday-master.dto'
import { UpdateWorkingDaysDto } from './dto/update-working-days.dto'
import { CreateOrgHolidayDto, UpdateOrgHolidayDto } from './dto/create-org-holiday.dto'
import { CreateDepartmentHolidayDto, UpdateDepartmentHolidayDto } from './dto/create-department-holiday.dto'
import {
  CreateIndividualHolidayDto, UpdateIndividualHolidayDto,
  CreateIndividualWorkingDaysDto, UpdateIndividualWorkingDaysDto,
} from './dto/create-individual-holiday.dto'
import {
  OptOutOrgHolidaysDto, UndoOptOutOrgHolidaysDto, OptOutUserHolidaysDto,
} from './dto/opt-out.dto'

@ApiTags('holidays')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/holidays')
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  // ─── Master ──────────────────────────────────────────────────────────────────

  @Get('master')
  @ApiOperation({ summary: 'Get holiday master config' })
  getConfig(@Param('orgId') orgId: string) {
    return this.service.getConfig(orgId)
  }

  @Patch('master')
  @RequirePermission(ORG, PermissionAction.edit)
  @ApiOperation({ summary: 'Update holiday master config' })
  updateConfig(@Param('orgId') orgId: string, @Body() dto: UpdateHolidayMasterDto) {
    return this.service.updateConfig(orgId, dto)
  }

  // ─── Org working days ─────────────────────────────────────────────────────────

  @Get('org/working-days')
  @ApiOperation({ summary: 'Get org working days' })
  getOrgWorkingDays(@Param('orgId') orgId: string) {
    return this.service.getOrgWorkingDays(orgId)
  }

  @Patch('org/working-days')
  @RequirePermission(ORG, PermissionAction.edit)
  @ApiOperation({ summary: 'Update org working days' })
  updateOrgWorkingDays(@Param('orgId') orgId: string, @Body() dto: UpdateWorkingDaysDto) {
    return this.service.updateOrgWorkingDays(orgId, dto)
  }

  // ─── Org holidays ─────────────────────────────────────────────────────────────

  @Get('org/holidays')
  @ApiOperation({ summary: 'List org holidays' })
  listOrgHolidays(
    @Param('orgId') orgId: string,
    @Query('year') year?: string,
    @Query('type') type?: HolidayType,
    @Query('status') status?: HolidayStatus,
  ) {
    return this.service.listOrgHolidays(orgId, year ? parseInt(year) : undefined, type, status)
  }

  @Post('org/holidays/bulk-import')
  @RequirePermission(ORG, PermissionAction.write)
  @ApiOperation({ summary: 'Bulk import org holidays from CSV data' })
  bulkImportOrgHolidays(
    @Param('orgId') orgId: string,
    @Body() dto: BulkImportOrgHolidaysDto,
  ) {
    return this.service.bulkImportOrgHolidays(orgId, dto.holidays)
  }

  @Post('org/holidays')
  @RequirePermission(ORG, PermissionAction.write)
  @ApiOperation({ summary: 'Create org holiday' })
  createOrgHoliday(@Param('orgId') orgId: string, @Body() dto: CreateOrgHolidayDto) {
    return this.service.createOrgHoliday(orgId, dto)
  }

  @Patch('org/holidays/:id')
  @RequirePermission(ORG, PermissionAction.edit)
  @ApiOperation({ summary: 'Update org holiday' })
  updateOrgHoliday(@Param('orgId') orgId: string, @Param('id') id: string, @Body() dto: UpdateOrgHolidayDto) {
    return this.service.updateOrgHoliday(orgId, id, dto)
  }

  @Delete('org/holidays/:id')
  @RequirePermission(ORG, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete org holiday' })
  deleteOrgHoliday(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.deleteOrgHoliday(orgId, id)
  }

  @Get('org/holidays/discrepancies')
  @ApiOperation({ summary: 'Departments out of sync with the org calendar (org holidays they removed)' })
  getOrgHolidayDiscrepancies(@Param('orgId') orgId: string) {
    return this.service.getOrgHolidayDiscrepancies(orgId)
  }

  // ─── Dept working days ────────────────────────────────────────────────────────

  @Get('dept/:deptId/working-days')
  @ApiOperation({ summary: 'Get dept working days' })
  getDeptWorkingDays(@Param('orgId') orgId: string, @Param('deptId') deptId: string) {
    return this.service.getDeptWorkingDays(orgId, deptId)
  }

  @Patch('dept/:deptId/working-days')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Upsert dept working days' })
  upsertDeptWorkingDays(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Body() dto: UpdateWorkingDaysDto,
  ) {
    return this.service.upsertDeptWorkingDays(orgId, deptId, dto)
  }

  @Delete('dept/:deptId/working-days')
  @RequirePermission(DEPT, PermissionAction.delete)
  @ApiOperation({ summary: 'Remove dept working days override' })
  deleteDeptWorkingDays(@Param('orgId') orgId: string, @Param('deptId') deptId: string) {
    return this.service.deleteDeptWorkingDays(orgId, deptId)
  }

  // ─── Dept holidays ────────────────────────────────────────────────────────────

  @Get('dept/:deptId/holidays')
  @ApiOperation({ summary: 'List dept holidays' })
  listDeptHolidays(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Query('year') year?: string,
  ) {
    return this.service.listDeptHolidays(orgId, deptId, year ? parseInt(year) : undefined)
  }

  @Post('dept/:deptId/holidays')
  @RequirePermission(DEPT, PermissionAction.write)
  @ApiOperation({ summary: 'Create dept holiday' })
  createDeptHoliday(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Body() dto: CreateDepartmentHolidayDto,
  ) {
    return this.service.createDeptHoliday(orgId, deptId, dto)
  }

  @Patch('dept/:deptId/holidays/:id')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Update dept holiday' })
  updateDeptHoliday(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentHolidayDto,
  ) {
    return this.service.updateDeptHoliday(orgId, deptId, id, dto)
  }

  @Delete('dept/:deptId/holidays/:id')
  @RequirePermission(DEPT, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete dept holiday' })
  deleteDeptHoliday(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteDeptHoliday(orgId, deptId, id)
  }

  @Post('dept/:deptId/holidays/:id/opt-out')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Opt this department (and its descendants) out of an inherited holiday' })
  optOutDeptHoliday(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.optOutDeptHoliday(orgId, deptId, id, req.user.id)
  }

  @Delete('dept/:deptId/holidays/:id/opt-out')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Undo a local opt-out (re-attach the inherited holiday)' })
  undoOptOutDeptHoliday(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.undoOptOutDeptHoliday(orgId, deptId, id, req.user.id)
  }

  @Post('dept/:deptId/org-holidays/opt-out')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Remove org holidays for this department (optionally cascading to sub-departments)' })
  optOutOrgHolidaysForDept(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Body() dto: OptOutOrgHolidaysDto,
    @Request() req: any,
  ) {
    return this.service.optOutOrgHolidaysForDept(orgId, deptId, dto.org_holiday_ids, dto.applies_to_subtree ?? true, req.user.id)
  }

  @Delete('dept/:deptId/org-holidays/opt-out')
  @RequirePermission(DEPT, PermissionAction.edit)
  @ApiOperation({ summary: 'Re-enforce (restore) removed org holidays for this department' })
  undoOptOutOrgHolidaysForDept(
    @Param('orgId') orgId: string,
    @Param('deptId') deptId: string,
    @Body() dto: UndoOptOutOrgHolidaysDto,
    @Request() req: any,
  ) {
    return this.service.undoOptOutOrgHolidaysForDept(orgId, deptId, dto.org_holiday_ids, req.user.id)
  }

  // ─── Individual working days ──────────────────────────────────────────────────

  @Get('user/:userId/working-days')
  @ApiOperation({ summary: 'List user working day schedules' })
  listUserWorkingDays(@Param('orgId') orgId: string, @Param('userId') userId: string) {
    return this.service.listUserWorkingDays(orgId, userId)
  }

  @Post('user/:userId/working-days')
  @RequirePermission(INDIV, PermissionAction.write)
  @ApiOperation({ summary: 'Create user working day schedule' })
  createUserWorkingDays(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: CreateIndividualWorkingDaysDto,
  ) {
    return this.service.createUserWorkingDays(orgId, userId, dto)
  }

  @Patch('user/:userId/working-days/:id')
  @RequirePermission(INDIV, PermissionAction.edit)
  @ApiOperation({ summary: 'Update user working day schedule' })
  updateUserWorkingDays(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateIndividualWorkingDaysDto,
  ) {
    return this.service.updateUserWorkingDays(orgId, userId, id, dto)
  }

  @Delete('user/:userId/working-days/:id')
  @RequirePermission(INDIV, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete user working day schedule' })
  deleteUserWorkingDays(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteUserWorkingDays(orgId, userId, id)
  }

  // ─── Individual holidays ──────────────────────────────────────────────────────

  @Get('user/:userId/holidays')
  @ApiOperation({ summary: 'List user holidays' })
  listUserHolidays(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query('year') year?: string,
  ) {
    return this.service.listUserHolidays(orgId, userId, year ? parseInt(year) : undefined)
  }

  @Post('user/:userId/holidays')
  @RequirePermission(INDIV, PermissionAction.write)
  @ApiOperation({ summary: 'Create user holiday' })
  createUserHoliday(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: CreateIndividualHolidayDto,
  ) {
    return this.service.createUserHoliday(orgId, userId, dto)
  }

  // Registered before the `:id` routes so the literal "opt-out" segment is not captured as an id.
  @Post('user/:userId/holidays/opt-out')
  @RequirePermission(INDIV, PermissionAction.edit)
  @ApiOperation({ summary: 'Remove inherited holidays (org/department) for this employee' })
  optOutHolidaysForUser(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: OptOutUserHolidaysDto,
    @Request() req: any,
  ) {
    return this.service.optOutHolidaysForUser(orgId, userId, dto.items, req.user.id)
  }

  @Delete('user/:userId/holidays/opt-out')
  @RequirePermission(INDIV, PermissionAction.edit)
  @ApiOperation({ summary: 'Restore inherited holidays for this employee' })
  undoOptOutHolidaysForUser(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: OptOutUserHolidaysDto,
    @Request() req: any,
  ) {
    return this.service.undoOptOutHolidaysForUser(orgId, userId, dto.items, req.user.id)
  }

  @Patch('user/:userId/holidays/:id')
  @RequirePermission(INDIV, PermissionAction.edit)
  @ApiOperation({ summary: 'Update user holiday' })
  updateUserHoliday(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateIndividualHolidayDto,
  ) {
    return this.service.updateUserHoliday(orgId, userId, id, dto)
  }

  @Delete('user/:userId/holidays/:id')
  @RequirePermission(INDIV, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete user holiday' })
  deleteUserHoliday(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteUserHoliday(orgId, userId, id)
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  @Get('check')
  @ApiOperation({ summary: 'Check if a date is a working day' })
  checkDate(
    @Param('orgId') orgId: string,
    @Query('date') date: string,
    @Query('userId') userId?: string,
    @Query('deptId') deptId?: string,
  ) {
    return this.service.checkDate(orgId, new Date(date), deptId, userId)
  }

  @Get('range')
  @ApiOperation({ summary: 'Get non-working dates in range' })
  getRange(
    @Param('orgId') orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('userId') userId?: string,
    @Query('deptId') deptId?: string,
  ) {
    return this.service.getHolidaysInRange(orgId, new Date(from), new Date(to), deptId, userId)
  }
}
