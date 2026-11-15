import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../common/types/auth-request';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { ProjectsService } from './projects.service';
import { principalFromUser } from '../access-rights/permissions.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { UpdateProjectMemberDto } from './dto/update-project-member.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { LinkProjectTaskDto } from './dto/link-project-task.dto';
import { AddDependencyDto } from './dto/add-dependency.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AddDocumentDto } from './dto/add-document.dto';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  // ─── Config ──────────────────────────────────────────────────────────────────

  @Get('config')
  getConfig(@Param('orgId') orgId: string) {
    return this.service.getConfig(orgId);
  }

  // ─── Projects ────────────────────────────────────────────────────────────────

  @Get()
  list(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.listProjects(orgId, principalFromUser(req.user));
  }

  @Get('my')
  listMy(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.listMyProjects(orgId, principalFromUser(req.user));
  }

  @Get('managing')
  listManaging(@Param('orgId') orgId: string, @Request() req: AuthRequest) {
    return this.service.listManagingProjects(orgId, req.user.id);
  }

  @Post()
  create(@Param('orgId') orgId: string, @Request() req: AuthRequest, @Body() dto: CreateProjectDto) {
    return this.service.createProject(orgId, req.user.id, dto);
  }

  @Get(':id')
  get(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getProject(orgId, id, req.user.id);
  }

  @Patch(':id')
  update(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: UpdateProjectDto) {
    return this.service.updateProject(orgId, id, req.user.id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: UpdateProjectStatusDto) {
    return this.service.updateStatus(orgId, id, req.user.id, dto);
  }

  @Patch(':id/budget')
  updateBudget(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: UpdateBudgetDto) {
    return this.service.updateBudget(orgId, id, req.user.id, dto);
  }

  @Delete(':id')
  delete(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Query('reason') reason: string) {
    return this.service.deleteProject(orgId, id, req.user.id, reason);
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  @Get(':id/members')
  listMembers(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.listMembers(orgId, id, req.user.id);
  }

  @Post(':id/members')
  addMember(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: AddProjectMemberDto) {
    return this.service.addMember(orgId, id, req.user.id, dto);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.service.updateMember(orgId, id, req.user.id, targetUserId, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('orgId') orgId: string, @Param('id') id: string, @Param('userId') targetUserId: string, @Request() req: AuthRequest) {
    return this.service.removeMember(orgId, id, req.user.id, targetUserId);
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  @Get(':id/milestones')
  listMilestones(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.listMilestones(orgId, id, req.user.id);
  }

  @Post(':id/milestones')
  createMilestone(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: CreateMilestoneDto) {
    return this.service.createMilestone(orgId, id, req.user.id, dto);
  }

  @Patch(':id/milestones/:mid')
  updateMilestone(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.service.updateMilestone(orgId, id, req.user.id, mid, dto);
  }

  @Delete(':id/milestones/:mid')
  deleteMilestone(@Param('orgId') orgId: string, @Param('id') id: string, @Param('mid') mid: string, @Request() req: AuthRequest) {
    return this.service.deleteMilestone(orgId, id, req.user.id, mid);
  }

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  @Get(':id/tasks')
  listTasks(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Query('milestone_id') milestoneId?: string,
  ) {
    return this.service.listProjectTasks(orgId, id, req.user.id, milestoneId);
  }

  @Post(':id/tasks/link')
  linkTask(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: LinkProjectTaskDto) {
    return this.service.linkTask(orgId, id, req.user.id, dto);
  }

  @Post(':id/tasks/:projectTaskId/fulfill')
  fulfillPendingTask(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('projectTaskId') projectTaskId: string,
    @Request() req: AuthRequest,
    @Body('task_id') taskId: string,
  ) {
    return this.service.fulfillPendingTask(orgId, id, req.user.id, projectTaskId, taskId);
  }

  @Delete(':id/tasks/:projectTaskId')
  unlinkTask(@Param('orgId') orgId: string, @Param('id') id: string, @Param('projectTaskId') projectTaskId: string, @Request() req: AuthRequest) {
    return this.service.unlinkTask(orgId, id, req.user.id, projectTaskId);
  }

  @Get(':id/tasks/:taskId/dependencies')
  getDependencyWarnings(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Request() req: AuthRequest,
  ) {
    return this.service.getDependencyWarnings(orgId, id, req.user.id, taskId);
  }

  // ─── Dependencies ────────────────────────────────────────────────────────────

  @Get(':id/dependencies')
  listDependencies(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.listDependencies(orgId, id, req.user.id);
  }

  @Post(':id/dependencies')
  addDependency(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: AddDependencyDto) {
    return this.service.addDependency(orgId, id, req.user.id, dto);
  }

  @Delete(':id/dependencies/:depId')
  removeDependency(@Param('orgId') orgId: string, @Param('id') id: string, @Param('depId') depId: string, @Request() req: AuthRequest) {
    return this.service.removeDependency(orgId, id, req.user.id, depId);
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  @Get(':id/comments')
  listComments(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.listComments(orgId, id, req.user.id);
  }

  @Post(':id/comments')
  addComment(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: AddCommentDto) {
    return this.service.addComment(orgId, id, req.user.id, dto);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(@Param('orgId') orgId: string, @Param('id') id: string, @Param('commentId') commentId: string, @Request() req: AuthRequest) {
    return this.service.deleteComment(orgId, id, req.user.id, commentId);
  }

  // ─── Documents ───────────────────────────────────────────────────────────────

  @Get(':id/documents')
  listDocuments(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.listDocuments(orgId, id, req.user.id);
  }

  @Post(':id/documents')
  addDocument(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest, @Body() dto: AddDocumentDto) {
    return this.service.addDocument(orgId, id, req.user.id, dto);
  }

  @Delete(':id/documents/:docId')
  deleteDocument(@Param('orgId') orgId: string, @Param('id') id: string, @Param('docId') docId: string, @Request() req: AuthRequest) {
    return this.service.deleteDocument(orgId, id, req.user.id, docId);
  }

  // ─── Activity & Progress ─────────────────────────────────────────────────────

  @Get(':id/activity')
  getActivity(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getActivity(orgId, id, req.user.id);
  }

  @Get(':id/progress')
  getProgress(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getProgress(orgId, id, req.user.id);
  }

  @Post(':id/progress/recalculate')
  forceRecalculate(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.forceRecalculate(orgId, id, req.user.id);
  }
}
