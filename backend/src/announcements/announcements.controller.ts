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
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'List published announcements' })
  findAll(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('type') type?: string,
    @Query('scope') scope?: string,
    @Query('priority') priority?: string,
    @Query('pinned') pinned?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll(orgId, req.user.id, { type, scope, priority, pinned, page, pageSize });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get announcement detail' })
  findOne(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.findOne(id, orgId, req.user.id);
  }

  @Post()
  @RequirePermission('communication.announcements.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create an announcement' })
  create(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(orgId, req.user.id, dto);
  }

  @Patch(':id')
  @RequirePermission('communication.announcements.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update an announcement' })
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(id, orgId, req.user.id, !!req.user.is_admin, dto);
  }

  @Post(':id/publish')
  @RequirePermission('communication.announcements.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Publish an announcement' })
  publish(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.publish(id, orgId, req.user.id, !!req.user.is_admin);
  }

  @Post(':id/pin')
  @RequirePermission('communication.announcements.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Toggle pin on announcement' })
  togglePin(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.togglePin(id, orgId);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark announcement as read' })
  markRead(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.markRead(id, orgId, req.user.id);
  }

  @Get(':id/read-status')
  @RequirePermission('communication.announcements.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Get read receipt status' })
  getReadStatus(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.getReadStatus(id, orgId);
  }

  @Delete(':id')
  @RequirePermission('communication.announcements.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Delete an announcement' })
  remove(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, orgId, req.user.id, !!req.user.is_admin);
  }
}
