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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataScope } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { RequireAdmin } from '../common/decorators/require-admin.decorator';
import { TasksService } from './tasks.service';
import { TaskImportService } from './task-import.service';
import { BulkImportTasksDto } from './dto/bulk-import-task.dto';
import { TaskAttachmentsService, MAX_ATTACHMENT_BYTES, type UploadedFile as UploadedFileType } from './task-attachments.service';
import { principalFromUser } from '../access-rights/permissions.service';
import { RecurringTasksService, type RecurringRelation } from '../recurring-tasks/recurring-tasks.service';
import { ClockService } from '../clock/clock.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { parseTagIdsQuery } from '../common/tag-ids-query';
import { CreateCommentDto } from './dto/create-comment.dto';
import { AddAssigneeDto } from './dto/add-assignee.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';

/** Map a raw `?scope=` query value to a DataScope, ignoring anything invalid. */
function toDataScope(raw?: string): DataScope | undefined {
  if (raw && (Object.values(DataScope) as string[]).includes(raw)) return raw as DataScope;
  return undefined;
}

/**
 * `?tag_ids=` as the CSV the service parses. Accepts `tag_ids=a,b` and the repeated
 * `tag_ids=a&tag_ids=b` form (which Express hands over as an array). Empty → undefined.
 * Parsed by `parseTagIdsQuery` (non-strings ignored); the service's `buildTaskWhere`
 * trims, de-duplicates and caps again for any other caller.
 */
function toTagIdsCsv(raw?: string | string[]): string | undefined {
  const ids = parseTagIdsQuery(raw);
  return ids.length ? ids.join(',') : undefined;
}

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/tasks')
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly importService: TaskImportService,
    private readonly attachments: TaskAttachmentsService,
    private readonly recurringService: RecurringTasksService,
    private readonly clock: ClockService,
  ) {}

  // ─── Task CRUD ────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a task' })
  create(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.createTask(orgId, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks with filters' })
  list(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('quadrant') quadrant?: string,
    @Query('type') type?: string,
    @Query('assignee_user_id') assignee_user_id?: string,
    @Query('goal_id') goal_id?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.listTasks(orgId, principalFromUser(req.user), {
      status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), quadrant, type,
      assignee_user_id, goal_id, search, from_date, to_date,
    });
  }

  // ─── Specific sub-routes (must be BEFORE /:id) ───────────────────────────────

  // NOTE: this path also matches RecurringTasksController's base route; whichever is
  // registered first wins, so this handler MUST scope identically (pass the principal
  // + query) or it becomes a leak. It exists here to intercept 'recurring' before the
  // task `:id` route below.
  @Get('recurring')
  @ApiOperation({ summary: 'List recurring task templates (scope + relation aware)' })
  async listRecurring(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('relation') relation?: RecurringRelation,
    @Query('status') status?: 'active' | 'paused',
    @Query('category_id') categoryId?: string,
    @Query('priority_id') priorityId?: string,
    @Query('department_id') departmentId?: string,
    @Query('search') search?: string,
    // CSV of tag ids (any-of) — must match RecurringTasksController.list exactly.
    @Query('tag_ids') tagIds?: string | string[],
  ) {
    const now = await this.clock.now(orgId);
    const tag_ids = parseTagIdsQuery(tagIds);
    return this.recurringService.listTemplates(
      orgId,
      principalFromUser(req.user),
      {
        scope: toDataScope(scope),
        relation,
        status,
        category_id: categoryId,
        priority_id: priorityId,
        department_id: departmentId,
        tag_ids: tag_ids.length ? tag_ids : undefined,
        search,
      },
      now,
    );
  }

  @Get('eligible-assignees')
  @ApiOperation({ summary: 'Get eligible assignees based on visibility rules' })
  getEligibleAssignees(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('sort') sort?: 'frequency' | 'workload' | 'name',
  ) {
    return this.service.getEligibleAssignees(orgId, req.user.id, search, sort ?? 'frequency');
  }

  @Get('eligible-assignees-for/:userId')
  @ApiOperation({ summary: "Admin preview: a given employee's resolved assignees with per-person reasons" })
  getEmployeeAssigneePreview(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query('search') search?: string,
  ) {
    return this.service.getEmployeeAssigneePreview(orgId, userId, search);
  }

  @Get('archive')
  @ApiOperation({ summary: 'Get archived (deleted) tasks' })
  getArchive(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.getArchive(orgId, req.user.id);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get tasks assigned to me' })
  getMyTasks(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.getMyTasks(orgId, req.user.id);
  }

  @Get('cc')
  @ApiOperation({ summary: 'Get tasks where I am CC\'d' })
  getMyCCTasks(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.getMyCCTasks(orgId, req.user.id);
  }

  @Get('assigned-by-me')
  @ApiOperation({ summary: 'Get tasks I created' })
  getAssignedByMe(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.getTasksAssignedByMe(orgId, req.user.id);
  }

  @Get('escalated')
  @ApiOperation({ summary: 'Get tasks escalated to me' })
  getEscalated(@Param('orgId') orgId: string, @Request() req: any) {
    return this.service.getEscalatedTasks(orgId, req.user.id);
  }

  @Get('reports')
  @RequireAdmin()
  @ApiOperation({ summary: 'Get task analytics and reports' })
  getReports(
    @Param('orgId') orgId: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.getReports(orgId, from_date, to_date);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Scope-aware Work dashboard: KPI counts + dimension breakdowns' })
  getDashboard(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('department_id') department_id?: string,
    @Query('department_ids') department_ids?: string,
    @Query('role_id') role_id?: string,
    @Query('created_by_user_id') created_by_user_id?: string,
    @Query('assignee_user_id') assignee_user_id?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.getDashboard(orgId, principalFromUser(req.user), {
      scope: toDataScope(scope),
      status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), department_id, department_ids, role_id, created_by_user_id,
      assignee_user_id, type, search, from_date, to_date,
    });
  }

  @Get('flow')
  @ApiOperation({ summary: 'Scope-aware work-flow analytics: source relationship, cross-dept matrix, delegation' })
  getWorkFlow(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('department_id') department_id?: string,
    @Query('department_ids') department_ids?: string,
    @Query('role_id') role_id?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.getWorkFlow(orgId, principalFromUser(req.user), {
      scope: toDataScope(scope),
      status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), department_id, department_ids, role_id, type, search, from_date, to_date,
    });
  }

  @Get('paged')
  @ApiOperation({ summary: 'Paginated, scope-aware task list for the dashboard result surface' })
  listPaged(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
    @Query('sort') sort?: string,
    @Query('bucket') bucket?: string,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('department_id') department_id?: string,
    @Query('department_ids') department_ids?: string,
    @Query('role_id') role_id?: string,
    @Query('timing') timing?: string,
    @Query('assigner_person_dept_id') assigner_person_dept_id?: string,
    @Query('assignee_person_dept_id') assignee_person_dept_id?: string,
    @Query('created_by_user_id') created_by_user_id?: string,
    @Query('assignee_user_id') assignee_user_id?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.listTasksPaged(
      orgId,
      principalFromUser(req.user),
      { status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), department_id, department_ids, role_id, timing, assigner_person_dept_id, assignee_person_dept_id, created_by_user_id, assignee_user_id, type, search, from_date, to_date },
      toDataScope(scope),
      page ? parseInt(page, 10) : 1,
      page_size ? parseInt(page_size, 10) : 25,
      sort ?? 'created_desc',
      bucket,
    );
  }

  @Get('people-tree')
  @ApiOperation({ summary: 'Reporting tree of visible people with per-node workload stats' })
  getPeopleTree(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('department_id') department_id?: string,
    @Query('department_ids') department_ids?: string,
    @Query('role_id') role_id?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.getPeopleTree(orgId, principalFromUser(req.user), toDataScope(scope), {
      status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), department_id, department_ids, role_id, type, search, from_date, to_date,
    });
  }

  @Get('people/:userId/report')
  @ApiOperation({ summary: "An employee's work report (scope-gated): their work + what they delegated" })
  getEmployeeReport(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Request() req: any,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.getEmployeeReport(orgId, principalFromUser(req.user), userId, { from_date, to_date });
  }

  @Get('export')
  @ApiOperation({ summary: 'Export the current scope/filtered task view as CSV' })
  exportCsv(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('bucket') bucket?: string,
    @Query('status_id') status_id?: string,
    @Query('priority_id') priority_id?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_ids') tag_ids?: string | string[],
    @Query('department_id') department_id?: string,
    @Query('department_ids') department_ids?: string,
    @Query('role_id') role_id?: string,
    @Query('timing') timing?: string,
    @Query('assigner_person_dept_id') assigner_person_dept_id?: string,
    @Query('assignee_person_dept_id') assignee_person_dept_id?: string,
    @Query('created_by_user_id') created_by_user_id?: string,
    @Query('assignee_user_id') assignee_user_id?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.service.exportCsv(
      orgId,
      principalFromUser(req.user),
      { status_id, priority_id, category_id, tag_ids: toTagIdsCsv(tag_ids), department_id, department_ids, role_id, timing, assigner_person_dept_id, assignee_person_dept_id, created_by_user_id, assignee_user_id, type, search, from_date, to_date },
      toDataScope(scope),
      bucket,
    );
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk status / deadline / complete / add_tags / remove_tags on a set of tasks (scope-gated)' })
  bulkUpdate(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body()
    body: {
      task_ids: string[];
      action: 'status' | 'deadline' | 'complete' | 'add_tags' | 'remove_tags';
      status_id?: string;
      deadline?: string | null;
      tag_ids?: string[];
    },
  ) {
    return this.service.bulkUpdate(orgId, principalFromUser(req.user), body.task_ids ?? [], body.action, {
      status_id: body.status_id,
      deadline: body.deadline,
      tag_ids: body.tag_ids,
    });
  }

  // ─── Bulk import (declared BEFORE /:id so "imports" isn't matched as an id) ──────

  @Get('bulk-import/options')
  @ApiOperation({ summary: 'Reference data for the import template (dropdowns, eligible assignees)' })
  importOptions(@Param('orgId') orgId: string, @Request() req: any) {
    return this.importService.getImportOptions(orgId, req.user.id);
  }

  @Post('bulk-import/validate')
  @ApiOperation({ summary: 'Dry-run: validate task import rows, resolve references (no writes)' })
  validateImport(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: BulkImportTasksDto) {
    return this.importService.validateImport(orgId, req.user.id, dto.rows);
  }

  @Post('bulk-import/commit')
  @ApiOperation({ summary: 'Commit a task import — creates ready rows and records an undoable batch' })
  commitImport(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: BulkImportTasksDto) {
    return this.importService.commitImport(orgId, req.user.id, dto.rows, dto.file_name);
  }

  @Get('imports')
  @ApiOperation({ summary: 'Task import history — past batches with undo eligibility' })
  listImports(@Param('orgId') orgId: string) {
    return this.importService.listImportBatches(orgId);
  }

  @Get('imports/:batchId')
  @ApiOperation({ summary: 'Full detail of one past task import batch' })
  getImportDetail(@Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.importService.getImportBatchDetail(orgId, batchId);
  }

  @Post('imports/:batchId/undo')
  @ApiOperation({ summary: 'Guarded undo of a task import batch (window-limited, skips acted-on tasks)' })
  undoImport(@Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.importService.undoImport(orgId, batchId);
  }

  // ─── /:id routes ─────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  getOne(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getTask(orgId, id, principalFromUser(req.user));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  update(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.service.updateTask(orgId, req.user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a task (requires reason)' })
  remove(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.service.deleteTask(orgId, req.user.id, id, body.reason);
  }

  // ─── Task Actions ─────────────────────────────────────────────────────────────

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark task as complete (close_whole_task = owner override, all_must)' })
  complete(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { close_whole_task?: boolean },
  ) {
    return this.service.completeTask(orgId, req.user.id, id, undefined, !!body?.close_whole_task);
  }

  @Post(':id/assignees/:userId/complete')
  @ApiOperation({ summary: "Mark a specific assignee's part complete (creator/editor, all_must_complete)" })
  completeAssignee(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.service.completeTask(orgId, req.user.id, id, userId);
  }

  @Post(':id/assignees/:userId/reopen')
  @ApiOperation({ summary: "Reopen one assignee's finished part for rework (assigner; or self-undo within the window)" })
  reopenAssigneePart(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    const target = userId === 'me' ? req.user.id : userId;
    return this.service.reopenAssigneePart(orgId, req.user.id, id, target, body?.reason);
  }

  @Patch(':id/assignee-status')
  @ApiOperation({ summary: 'Set a per-person status track (all_must_complete)' })
  setAssigneeStatus(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { user_id?: string; status_id: string },
  ) {
    return this.service.setAssigneeStatus(orgId, req.user.id, id, body.user_id ?? req.user.id, body.status_id);
  }

  @Patch(':id/shared-status')
  @ApiOperation({ summary: 'Move the single shared status (any_can_complete)' })
  setSharedStatus(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { status_id: string },
  ) {
    return this.service.setSharedStatus(orgId, req.user.id, id, body.status_id);
  }

  @Post(':id/incomplete')
  @ApiOperation({ summary: 'Close a task as incomplete/not-done (requires reason)' })
  markIncomplete(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.markTaskIncomplete(orgId, req.user.id, id, body?.reason);
  }

  @Post(':id/assignees/:userId/cannot-complete')
  @ApiOperation({ summary: "Flag an assignee's own part as can't-complete (all_must_complete, requires reason)" })
  flagCannotComplete(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    const target = userId === 'me' ? req.user.id : userId;
    return this.service.setAssigneeCannotComplete(orgId, req.user.id, id, target, body?.reason);
  }

  @Post(':id/assignees/:userId/can-complete')
  @ApiOperation({ summary: "Clear an assignee's can't-complete flag" })
  clearCannotComplete(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    const target = userId === 'me' ? req.user.id : userId;
    return this.service.clearAssigneeCannotComplete(orgId, req.user.id, id, target);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a completed task (within window)' })
  reopen(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.reopenTask(orgId, req.user.id, id, body?.reason);
  }

  // ─── Proof of completion (file uploads → Cloudflare R2) ──────────────────────

  @Post(':id/proof')
  @ApiOperation({ summary: 'Submit a proof-of-completion file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadProof(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileType,
    @Body() dto: SubmitProofDto,
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.uploadProof(orgId, req.user.id, id, file, dto.visibility ?? 'private');
  }

  @Post(':id/proof/from-comment/:attachmentId')
  @ApiOperation({ summary: 'Mark a file already shared in a comment as proof' })
  async markCommentAsProof(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.markCommentAttachmentAsProof(orgId, req.user.id, id, attachmentId);
  }

  @Get(':id/proofs')
  @ApiOperation({ summary: 'List proof files the current viewer may see' })
  async listProofs(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.listProofs(orgId, id, {
      userId: req.user.id,
      isAdmin: !!(req.user.is_admin || req.user.isSuperAdmin),
    });
  }

  @Get(':id/proofs/:attachmentId/download')
  @ApiOperation({ summary: 'Signed download URL for a proof file (visibility-gated)' })
  async downloadProof(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: any,
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.getProofDownloadUrl(orgId, id, attachmentId, {
      userId: req.user.id,
      isAdmin: !!(req.user.is_admin || req.user.isSuperAdmin),
    });
  }

  // ─── Activity Logs ────────────────────────────────────────────────────────────

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get task activity log' })
  getLogs(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getActivityLog(orgId, id, principalFromUser(req.user));
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get task comments' })
  getComments(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getComments(orgId, id, principalFromUser(req.user));
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  addComment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.addComment(orgId, req.user.id, id, dto, principalFromUser(req.user));
  }

  @Delete(':id/comments/:commentId')
  @ApiOperation({ summary: 'Soft-delete a comment' })
  deleteComment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('commentId') commentId: string,
  ) {
    return this.service.deleteComment(orgId, req.user.id, commentId);
  }

  // ─── Attachments (real document upload → Cloudflare R2) ──────────────────────

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Upload a document attachment to a task' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadTaskAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileType,
  ) {
    // Only someone who may read the task may add files to it (same gate as proof upload).
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.upload(orgId, req.user.id, id, file);
  }

  @Post(':id/comments/:commentId/attachments')
  @ApiOperation({ summary: 'Upload a document attachment to a task comment' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadCommentAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @UploadedFile() file: UploadedFileType,
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.upload(orgId, req.user.id, id, file, commentId);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List task-level attachments (private proofs visibility-filtered)' })
  async listAttachments(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.listForTask(orgId, id, {
      userId: req.user.id,
      isAdmin: !!(req.user.is_admin || req.user.isSuperAdmin),
    });
  }

  @Get(':id/attachments/all')
  @ApiOperation({ summary: 'List every attachment on the task (task-level + comment files; private proofs visibility-filtered)' })
  async listAllAttachments(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.listAllForTask(orgId, id, {
      userId: req.user.id,
      isAdmin: !!(req.user.is_admin || req.user.isSuperAdmin),
    });
  }

  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Get a short-lived signed download URL for an attachment (private proofs visibility-gated)' })
  async downloadAttachment(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: any,
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.attachments.getDownloadUrl(orgId, id, attachmentId, {
      userId: req.user.id,
      isAdmin: !!(req.user.is_admin || req.user.isSuperAdmin),
    });
  }

  @Delete(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Remove an attachment (uploader only)' })
  removeAttachment(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(orgId, req.user.id, id, attachmentId);
  }

  // ─── Checklist ────────────────────────────────────────────────────────────────
  // Object-level access is gated by assertCanViewTask (participation OR data scope);
  // the service adds the per-action rules (own item vs assigner override/challenge).

  @Post(':id/checklist/:itemId/check')
  @ApiOperation({ summary: 'Mark a checklist item done (own item in all_must; shared tick otherwise)' })
  async checkChecklistItem(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Param('itemId') itemId: string) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.checkChecklistItem(orgId, req.user.id, id, itemId);
  }

  @Post(':id/checklist/:itemId/uncheck')
  @ApiOperation({ summary: 'Clear a checklist item back to Not started' })
  async uncheckChecklistItem(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Param('itemId') itemId: string) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.uncheckChecklistItem(orgId, req.user.id, id, itemId);
  }

  @Post(':id/checklist/:itemId/skip')
  @ApiOperation({ summary: 'Mark a checklist item "can\'t do" with a required reason (all_must)' })
  async skipChecklistItem(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { reason?: string },
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.skipChecklistItem(orgId, req.user.id, id, itemId, body?.reason);
  }

  @Post(':id/checklist/:itemId/override')
  @ApiOperation({ summary: 'Assigner: mark a checklist item done for everyone (all_must)' })
  async overrideChecklistItem(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Param('itemId') itemId: string) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.overrideChecklistItem(orgId, req.user.id, id, itemId);
  }

  @Post(':id/checklist/:itemId/clear-override')
  @ApiOperation({ summary: 'Assigner: undo a "done for everyone" override' })
  async clearChecklistOverride(@Param('orgId') orgId: string, @Request() req: any, @Param('id') id: string, @Param('itemId') itemId: string) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.clearChecklistOverride(orgId, req.user.id, id, itemId);
  }

  @Post(':id/checklist/:itemId/challenge')
  @ApiOperation({ summary: "Assigner: challenge a person's checklist item — reopens just their part (all_must)" })
  async challengeChecklistItem(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { user_id?: string },
  ) {
    await this.service.assertCanViewTask(orgId, principalFromUser(req.user), id);
    return this.service.challengeChecklistItem(orgId, req.user.id, id, itemId, body?.user_id ?? '');
  }

  // ─── Assignees ────────────────────────────────────────────────────────────────

  @Post(':id/assignees')
  @ApiOperation({ summary: 'Add an assignee to a task' })
  addAssignee(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AddAssigneeDto,
  ) {
    return this.service.addAssignee(orgId, req.user.id, id, dto);
  }

  @Delete(':id/assignees/:userId')
  @ApiOperation({ summary: 'Remove an assignee from a task' })
  removeAssignee(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Param('id') id: string,
    @Param('userId') assigneeUserId: string,
  ) {
    return this.service.removeAssignee(orgId, req.user.id, id, assigneeUserId);
  }
}
