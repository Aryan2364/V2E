import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { OrgScopeGuard } from '../common/guards/org-scope.guard'
import { RequireAdmin } from '../common/decorators/require-admin.decorator'
import { principalFromUser } from '../access-rights/permissions.service'
import { WorkflowTemplateViewService } from './workflow-template-view.service'
import { WorkflowInstanceQueryService } from './workflow-instance-query.service'
import { WorkflowDefinitionService } from './workflow-definition.service'
import { WorkflowTimelineService } from './workflow-timeline.service'
import { WorkflowLifecycleService } from './workflow-lifecycle.service'
import { WorkflowInstanceActionService } from './workflow-instance-action.service'
import { WorkflowInstanceCollabService } from './workflow-instance-collab.service'
import { PreviewTimelineDto, SaveDefinitionDto } from './dto/definition.dto'
import { TriggerInstanceDto } from './dto/trigger-instance.dto'
import { UpdateMasterDto } from './dto/update-master.dto'
import { SendBackDto, SkipStepDto } from './dto/run-actions.dto'
import { ChangeCreatorDto } from './dto/instance-notes.dto'
import { DiscussionQueryDto, PostDiscussionMessageDto } from './dto/discussion.dto'
import { MAX_ATTACHMENT_BYTES, type UploadedFile as UploadedFileType } from '../tasks/task-attachments.service'

/**
 * Workflows API (contract §8). Three layers on every route (AUTHORIZATION.md):
 * JwtAuthGuard (identity) → OrgScopeGuard (org + `workflows` entitlement; preview
 * is read-only) → the service's per-template capability gate, with every
 * sub-resource scoped to its parent template + org.
 *
 * Route order matters: static segments (`masters`, `meta`, `definition`, `my/...`,
 * `step-context/...`) are declared before `:id` so they never get captured as an id.
 *
 * A workflow is edited as a whole: the builder saves its entire definition (details,
 * how it starts, steps, people) in one request — `POST /definition` to create,
 * `PUT /:id/definition` to save.
 */
@Controller('api/v1/org/:orgId/workflows')
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
export class WorkflowTemplateController {
  constructor(
    private readonly templateView: WorkflowTemplateViewService,
    private readonly instanceQuery: WorkflowInstanceQueryService,
    private readonly definition: WorkflowDefinitionService,
    private readonly timelineService: WorkflowTimelineService,
    private readonly lifecycle: WorkflowLifecycleService,
    private readonly instanceActions: WorkflowInstanceActionService,
    private readonly collab: WorkflowInstanceCollabService,
  ) {}

  // ── Masters (admin only) ─────────────────────────────────────────────────────

  @Get('masters')
  @RequireAdmin()
  getMaster(@Param('orgId') orgId: string) {
    return this.templateView.getMaster(orgId)
  }

  @Patch('masters')
  @RequireAdmin()
  updateMaster(@Param('orgId') orgId: string, @Body() dto: UpdateMasterDto) {
    return this.templateView.updateMaster(orgId, dto)
  }

  // ── Meta ─────────────────────────────────────────────────────────────────────

  @Get('meta')
  getMeta(@Param('orgId') orgId: string, @Req() req: any) {
    return this.templateView.getMeta(orgId, principalFromUser(req.user))
  }

  // ── My workflows ─────────────────────────────────────────────────────────────

  @Get('my/owned')
  getOwnedWorkflows(@Param('orgId') orgId: string, @Req() req: any) {
    return this.templateView.getOwnedWorkflows(orgId, principalFromUser(req.user))
  }

  @Get('my/owned/instances')
  getOwnedInstances(@Param('orgId') orgId: string, @Req() req: any) {
    return this.instanceQuery.getOwnedInstances(orgId, principalFromUser(req.user))
  }

  @Get('my/assigned/instances')
  getAssignedInstances(@Param('orgId') orgId: string, @Req() req: any) {
    return this.instanceQuery.getAssignedInstances(orgId, principalFromUser(req.user))
  }

  // ── Task → workflow context (task detail banner + Send back) ─────────────────

  /** Gated by the TASK view rule. `null` when the task isn't a workflow step task. */
  @Get('step-context/:taskId')
  getStepContext(
    @Param('orgId') orgId: string,
    @Param('taskId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) taskId: string,
    @Req() req: any,
  ) {
    return this.instanceQuery.getStepContext(orgId, taskId, principalFromUser(req.user))
  }

  // ── Templates ────────────────────────────────────────────────────────────────

  @Get()
  listTemplates(
    @Param('orgId') orgId: string,
    @Query('include_archived') includeArchived: string | undefined,
    @Req() req: any,
  ) {
    return this.templateView.listTemplates(orgId, includeArchived === 'true', principalFromUser(req.user))
  }

  /** Create a workflow from its whole definition (`mode`: 'draft' = Save draft, 'save' = Save → Live). */
  @Post('definition')
  createDefinition(@Param('orgId') orgId: string, @Body() dto: SaveDefinitionDto, @Req() req: any) {
    return this.definition.createDefinition(orgId, dto, principalFromUser(req.user))
  }

  /**
   * The builder's example timeline for an in-memory definition (nothing is stored):
   * `{ runs: [{ starts_at, steps: [{ key, title, planned_start_at, planned_due_at }] }],
   * warnings }`. Module access is enough (OrgScopeGuard) — no workflow row is read.
   */
  @Post('preview-timeline')
  previewTimeline(@Param('orgId') orgId: string, @Body() dto: PreviewTimelineDto, @Req() req: any) {
    return this.timelineService.previewTimeline(orgId, dto, principalFromUser(req.user))
  }

  @Get(':id')
  getTemplate(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.templateView.getTemplate(orgId, id, principalFromUser(req.user))
  }

  /**
   * Save the whole definition in one transaction. Live/Paused workflows are always
   * fully validated; a draft saved with `mode: 'save'` goes Live. 409 when someone
   * else saved after `expected_updated_at`.
   */
  @Put(':id/definition')
  updateDefinition(@Param('orgId') orgId: string, @Param('id') id: string, @Body() dto: SaveDefinitionDto, @Req() req: any) {
    return this.definition.updateDefinition(orgId, id, dto, principalFromUser(req.user))
  }

  /** Live → Paused: no new runs, schedules skip; running runs continue. */
  @Post(':id/pause')
  pauseTemplate(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.lifecycle.pauseTemplate(orgId, id, principalFromUser(req.user))
  }

  /** Paused → Live. Occurrences missed while paused are not caught up. */
  @Post(':id/resume')
  resumeTemplate(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.lifecycle.resumeTemplate(orgId, id, principalFromUser(req.user))
  }

  /** Archive (never a hard delete). */
  @Delete(':id')
  archiveTemplate(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.lifecycle.archiveTemplate(orgId, id, principalFromUser(req.user))
  }

  /** Archived → Draft. */
  @Post(':id/restore')
  restoreTemplate(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.lifecycle.restoreTemplate(orgId, id, principalFromUser(req.user))
  }

  /** Admins: hand the permanent-editor ("creator") role to another active member. */
  @Post(':id/change-creator')
  @RequireAdmin()
  changeCreator(@Param('orgId') orgId: string, @Param('id') id: string, @Body() dto: ChangeCreatorDto, @Req() req: any) {
    return this.lifecycle.changeCreator(orgId, id, dto.user_id, principalFromUser(req.user))
  }

  // ── Instances ────────────────────────────────────────────────────────────────

  @Post(':id/instances/trigger')
  triggerInstance(@Param('orgId') orgId: string, @Param('id') id: string, @Body() dto: TriggerInstanceDto, @Req() req: any) {
    return this.instanceActions.triggerInstance(orgId, id, dto?.name, principalFromUser(req.user))
  }

  @Get(':id/instances')
  listInstances(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: any) {
    return this.instanceQuery.listInstances(orgId, id, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid')
  getInstance(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.instanceQuery.getInstance(orgId, id, iid, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid/tasks')
  getInstanceTasks(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.instanceQuery.getInstanceTasks(orgId, id, iid, principalFromUser(req.user))
  }

  @Post(':id/instances/:iid/cancel')
  cancelInstance(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.instanceActions.cancelInstance(orgId, id, iid, principalFromUser(req.user))
  }

  @Post(':id/instances/:iid/retry')
  retryInstance(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.instanceActions.retryInstance(orgId, id, iid, principalFromUser(req.user))
  }

  /** Skip `row_id`, or the single current step when omitted (can_edit). */
  @Post(':id/instances/:iid/skip-step')
  skipStep(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body() dto: SkipStepDto,
    @Req() req: any,
  ) {
    return this.instanceActions.skipStep(orgId, id, iid, dto?.row_id, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid/steps/:rowId/send-back-targets')
  getSendBackTargets(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('rowId') rowId: string,
    @Req() req: any,
  ) {
    return this.instanceActions.getSendBackTargets(orgId, id, iid, rowId, principalFromUser(req.user))
  }

  @Post(':id/instances/:iid/steps/:rowId/send-back')
  sendBack(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('rowId') rowId: string,
    @Body() dto: SendBackDto,
    @Req() req: any,
  ) {
    return this.instanceActions.sendBack(orgId, id, iid, rowId, dto, principalFromUser(req.user))
  }

  /** "Start now": a waiting step starts immediately (can_edit). */
  @Post(':id/instances/:iid/steps/:rowId/start-now')
  startStepNow(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('rowId') rowId: string,
    @Req() req: any,
  ) {
    return this.instanceActions.startStepNow(orgId, id, iid, rowId, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid/events')
  listEvents(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.instanceQuery.listEvents(orgId, id, iid, principalFromUser(req.user))
  }

  // ── Instance discussion (everyone who can see the instance) ─────────────────
  // One thread per instance: messages written on any of its step tasks plus messages
  // written on the instance page. Static segments before `:messageId`.

  /** One page, newest last (`?before=<messageId>&limit=`), with the caller's unread count. */
  @Get(':id/instances/:iid/discussion')
  getDiscussion(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Query() q: DiscussionQueryDto,
    @Req() req: any,
  ) {
    return this.collab.getDiscussion(orgId, id, iid, q, principalFromUser(req.user))
  }

  /** Who can be @mentioned: the people who can see this instance. */
  @Get(':id/instances/:iid/discussion/people')
  getDiscussionPeople(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.collab.getDiscussionPeople(orgId, id, iid, principalFromUser(req.user))
  }

  @Post(':id/instances/:iid/discussion')
  postDiscussion(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body() dto: PostDiscussionMessageDto,
    @Req() req: any,
  ) {
    return this.collab.postDiscussion(orgId, id, iid, dto, principalFromUser(req.user))
  }

  /** The caller has read the discussion up to now. */
  @Post(':id/instances/:iid/discussion/read')
  markDiscussionRead(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.collab.markDiscussionRead(orgId, id, iid, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid/discussion/files/:fileId/download')
  downloadDiscussionFile(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('fileId') fileId: string,
    @Req() req: any,
  ) {
    return this.collab.downloadDiscussionFile(orgId, id, iid, fileId, principalFromUser(req.user))
  }

  /** A file on the caller's own message. */
  @Post(':id/instances/:iid/discussion/:messageId/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadDiscussionFile(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('messageId') messageId: string,
    @UploadedFile() file: UploadedFileType,
    @Req() req: any,
  ) {
    return this.collab.uploadDiscussionFile(orgId, id, iid, messageId, file, principalFromUser(req.user))
  }

  /** Its author, editors and admins. */
  @Delete(':id/instances/:iid/discussion/:messageId')
  deleteDiscussionMessage(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('messageId') messageId: string,
    @Req() req: any,
  ) {
    return this.collab.deleteDiscussionMessage(orgId, id, iid, messageId, principalFromUser(req.user))
  }

  // ── Instance documents (everyone who can see it; adding: not viewers) ─────────

  @Get(':id/instances/:iid/documents')
  getDocuments(@Param('orgId') orgId: string, @Param('id') id: string, @Param('iid') iid: string, @Req() req: any) {
    return this.collab.getDocuments(orgId, id, iid, principalFromUser(req.user))
  }

  @Post(':id/instances/:iid/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadRunFile(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @UploadedFile() file: UploadedFileType,
    @Req() req: any,
  ) {
    return this.collab.uploadRunFile(orgId, id, iid, file, principalFromUser(req.user))
  }

  @Get(':id/instances/:iid/files/:fileId/download')
  downloadRunFile(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('fileId') fileId: string,
    @Req() req: any,
  ) {
    return this.collab.downloadRunFile(orgId, id, iid, fileId, principalFromUser(req.user))
  }

  @Delete(':id/instances/:iid/files/:fileId')
  deleteRunFile(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Param('fileId') fileId: string,
    @Req() req: any,
  ) {
    return this.collab.deleteRunFile(orgId, id, iid, fileId, principalFromUser(req.user))
  }
}
