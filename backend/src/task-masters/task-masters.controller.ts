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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TaskMastersService } from './task-masters.service';
import { ChecklistAccessService } from './checklist-access.service';
import { ChecklistImportService } from './checklist-import.service';
import { PermissionsService, principalFromUser } from '../access-rights/permissions.service';
import { BulkImportChecklistsDto } from './dto/bulk-import-checklist.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreatePriorityDto } from './dto/create-priority.dto';
import { CreateStatusDto } from './dto/create-status.dto';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { MergeTagDto } from './dto/merge-tag.dto';
import { TaskTagsService } from './task-tags.service';

@ApiTags('task-masters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/tasks/masters')
export class TaskMastersController {
  constructor(
    private readonly service: TaskMastersService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly checklistImport: ChecklistImportService,
    private readonly permissions: PermissionsService,
    private readonly tags: TaskTagsService,
  ) {}

  // ─── Config ─────────────────────────────────────────────────────────────────

  @Patch('assignee-visibility')
  @RequirePermission('tasks.config.assignee_visibility.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update assignee visibility configuration' })
  updateAssigneeVisibility(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: { assignee_visibility_mode?: string; assignee_custom_rules?: Record<string, unknown>; assignee_visibility_config_roles?: string[] },
  ) {
    return this.service.updateAssigneeVisibility(orgId, req.user.id, dto);
  }

  @Get('config')
  @ApiOperation({ summary: 'Get task master config for org' })
  getConfig(@Param('orgId') orgId: string) {
    return this.service.getOrCreateConfig(orgId);
  }

  @Patch('config')
  @RequirePermission('tasks.config.settings.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update task master config' })
  updateConfig(@Param('orgId') orgId: string, @Body() dto: UpdateConfigDto) {
    return this.service.updateConfig(orgId, dto);
  }

  // ─── Categories ─────────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'List task categories' })
  listCategories(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.listCategories(orgId, req.user.id);
  }

  @Post('categories')
  @RequirePermission('tasks.config.categories.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a task category' })
  createCategory(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.service.createCategory(orgId, req.user.id, dto);
  }

  @Patch('categories/:id')
  @RequirePermission('tasks.config.categories.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a task category' })
  updateCategory(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.service.updateCategory(orgId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermission('tasks.config.categories.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Deactivate a task category' })
  deleteCategory(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.deactivateCategory(orgId, id);
  }

  // ─── Tags ───────────────────────────────────────────────────────────────────
  // Org configuration, not participant content: action gate + org filter is the
  // complete gate (TASK_TAGS_PLAN.md §3). Every ':id' route 404s on a foreign id.
  // NOTE: 'tags/:id/merge' is a deeper path than 'tags/:id', so the two never collide;
  // any future static 'tags/<word>' route MUST be declared before 'tags/:id'.

  @Get('tags')
  @ApiOperation({ summary: 'List task tags (usage count + creator only for tag managers)' })
  listTags(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.tags.listTags(orgId, principalFromUser(req.user), includeInactive === 'true');
  }

  @Post('tags')
  @ApiOperation({ summary: 'Create a task tag — 201 new, 200 when an active tag with that name exists' })
  async createTag(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateTagDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Gated in the service: tasks.tags.create write OR tasks.config.tags.manage write.
    const { tag, created } = await this.tags.createTag(orgId, principalFromUser(req.user), dto);
    res.status(created ? 201 : 200);
    return tag;
  }

  @Patch('tags/:id')
  @RequirePermission('tasks.config.tags.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Rename, recolour, describe, deactivate or reactivate a task tag' })
  updateTag(@Param('orgId') orgId: string, @Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.updateTag(orgId, id, dto);
  }

  @Delete('tags/:id')
  @RequirePermission('tasks.config.tags.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a never-used task tag, otherwise deactivate it' })
  deleteTag(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.tags.deleteTag(orgId, id);
  }

  @Post('tags/:id/merge')
  @RequirePermission('tasks.config.tags.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Merge a task tag into another (needs manage edit + delete)' })
  mergeTag(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: MergeTagDto,
  ) {
    // `delete` is checked in the service — the decorator holds one action only.
    return this.tags.mergeTag(orgId, principalFromUser(req.user), id, dto.into_tag_id);
  }

  // ─── Priorities ─────────────────────────────────────────────────────────────
  // NOTE: 'priorities/reorder' MUST be defined before 'priorities/:id'

  @Get('priorities')
  @ApiOperation({ summary: 'List task priorities' })
  listPriorities(@Param('orgId') orgId: string) {
    return this.service.listPriorities(orgId);
  }

  @Post('priorities')
  @RequirePermission('tasks.config.priorities.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a task priority' })
  createPriority(@Param('orgId') orgId: string, @Body() dto: CreatePriorityDto) {
    return this.service.createPriority(orgId, dto);
  }

  @Patch('priorities/reorder')
  @RequirePermission('tasks.config.priorities.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Reorder task priorities' })
  reorderPriorities(
    @Param('orgId') orgId: string,
    @Body() body: { items: { id: string; order_index: number }[] },
  ) {
    return this.service.reorderPriorities(orgId, body.items);
  }

  @Patch('priorities/:id')
  @RequirePermission('tasks.config.priorities.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a task priority' })
  updatePriority(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: CreatePriorityDto,
  ) {
    return this.service.updatePriority(orgId, id, dto);
  }

  @Delete('priorities/:id')
  @RequirePermission('tasks.config.priorities.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Deactivate a task priority' })
  deletePriority(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.deactivatePriority(orgId, id);
  }

  // ─── Statuses ────────────────────────────────────────────────────────────────
  // NOTE: 'statuses/reorder' MUST be defined before 'statuses/:id'

  @Get('statuses')
  @ApiOperation({ summary: 'List task statuses' })
  listStatuses(@Param('orgId') orgId: string) {
    return this.service.listStatuses(orgId);
  }

  @Post('statuses')
  @RequirePermission('tasks.config.statuses.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a task status' })
  createStatus(@Param('orgId') orgId: string, @Body() dto: CreateStatusDto) {
    return this.service.createStatus(orgId, dto);
  }

  @Patch('statuses/reorder')
  @RequirePermission('tasks.config.statuses.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Reorder task statuses' })
  reorderStatuses(
    @Param('orgId') orgId: string,
    @Body() body: { items: { id: string; order_index: number }[] },
  ) {
    return this.service.reorderStatuses(orgId, body.items);
  }

  @Patch('statuses/:id')
  @RequirePermission('tasks.config.statuses.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a task status' })
  updateStatus(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: CreateStatusDto,
  ) {
    return this.service.updateStatus(orgId, id, dto);
  }

  @Delete('statuses/:id')
  @RequirePermission('tasks.config.statuses.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Deactivate a task status (cannot delete default status)' })
  deleteStatus(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.deactivateStatus(orgId, id);
  }

  // ─── Checklist Templates ─────────────────────────────────────────────────────

  @Get('checklist-templates')
  @ApiOperation({ summary: 'List checklist templates (managers see all; others only what they may use)' })
  async listTemplates(@Param('orgId') orgId: string, @Request() req: any) {
    // A restricted template's CONTENTS must not leak through the masters list: only
    // someone who may manage templates sees the full catalogue; everyone else gets
    // exactly the set they could pick in task creation (access rules applied).
    const principal = principalFromUser(req.user);
    const canManage =
      principal.isAdmin ||
      (await this.permissions.hasEffective(orgId, principal, 'tasks.config.checklist_templates.manage', PermissionAction.edit)) ||
      (await this.permissions.hasEffective(orgId, principal, 'tasks.config.checklist_templates.manage', PermissionAction.write));
    if (canManage) return this.service.listChecklistTemplates(orgId);
    return this.checklistAccess.listAccessibleTemplates(orgId, req.user.id);
  }

  @Get('checklist-templates/accessible')
  @ApiOperation({ summary: 'List checklist templates the current user may use when creating a task' })
  listAccessibleTemplates(@Param('orgId') orgId: string, @Request() req: any) {
    return this.checklistAccess.listAccessibleTemplates(orgId, req.user.id);
  }

  // ── Bulk import (validate → commit → history → undo) ──
  @Post('checklist-templates/bulk-import/validate')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Dry-run: validate checklist import rows (no writes)' })
  validateImport(@Param('orgId') orgId: string, @Body() dto: BulkImportChecklistsDto) {
    return this.checklistImport.validateImport(orgId, dto.rows);
  }

  @Post('checklist-templates/bulk-import/commit')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Commit a checklist import — creates inactive templates, records an undoable batch' })
  commitImport(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: BulkImportChecklistsDto) {
    return this.checklistImport.commitImport(orgId, req.user.id, dto.rows, dto.file_name);
  }

  @Get('checklist-templates/imports')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Checklist import history — past batches with undo eligibility' })
  listImports(@Param('orgId') orgId: string) {
    return this.checklistImport.listImportBatches(orgId);
  }

  @Post('checklist-templates/imports/:batchId/undo')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Undo a checklist import batch (deletes still-inactive imported templates)' })
  undoImport(@Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.checklistImport.undoImport(orgId, batchId);
  }

  @Post('checklist-templates')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a checklist template' })
  createTemplate(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateChecklistTemplateDto,
  ) {
    return this.service.createChecklistTemplate(orgId, req.user.id, dto);
  }

  @Patch('checklist-templates/:id')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a checklist template' })
  updateTemplate(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: CreateChecklistTemplateDto,
  ) {
    return this.service.updateChecklistTemplate(orgId, id, dto);
  }

  @Delete('checklist-templates/:id')
  @RequirePermission('tasks.config.checklist_templates.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a checklist template' })
  deleteTemplate(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.deleteChecklistTemplate(orgId, id);
  }
}
