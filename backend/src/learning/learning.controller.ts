import {
  Body,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthRequest } from '../common/types/auth-request';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { LearningService } from './learning.service';
import { LearningFilesService } from './learning-files.service';
import {
  MAX_ATTACHMENT_BYTES,
  type UploadedFile as UploadedFileType,
} from '../tasks/task-attachments.service';
import { CreateLearningPathDto } from './dto/create-learning-path.dto';
import { UpdateLearningPathDto } from './dto/update-learning-path.dto';
import { CreateLearningItemDto } from './dto/create-learning-item.dto';
import { UpdateLearningItemDto } from './dto/update-learning-item.dto';
import { AssignPathDto } from './dto/assign-path.dto';
import { CompleteItemDto } from './dto/complete-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

/** The caller's learner profile in this org — people without one have no assignments. */
function requireProfileId(req: AuthRequest): string {
  const id = req.user.employee_profile_id;
  if (!id) throw new ForbiddenException('No employee profile in this organization');
  return id;
}

@ApiTags('learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/learning')
export class LearningController {
  constructor(
    private readonly learningService: LearningService,
    private readonly filesService: LearningFilesService,
  ) {}

  // ─── Paths (HR/Admin) ───────────────────────────────────────────────────────

  @Get('paths')
  @ApiOperation({ summary: 'List all learning paths' })
  findAllPaths(@Param('orgId') orgId: string) {
    return this.learningService.findAllPaths(orgId);
  }

  @Get('paths/:pathId')
  @ApiOperation({ summary: 'Get a learning path by ID' })
  findOnePath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.learningService.findOnePath(pathId, orgId);
  }

  @Post('paths')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Create a new learning path' })
  createPath(
    @Param('orgId') orgId: string,
    @Request() req: AuthRequest,
    @Body() dto: CreateLearningPathDto,
  ) {
    return this.learningService.createPath(orgId, req.user.id, dto);
  }

  @Patch('paths/:pathId')
  @RequirePermission('learning.path.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a learning path' })
  updatePath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Body() dto: UpdateLearningPathDto,
  ) {
    return this.learningService.updatePath(pathId, orgId, dto);
  }

  @Post('paths/:pathId/publish')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Publish a learning path (triggers auto-assignment)' })
  publishPath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Request() req: AuthRequest,
  ) {
    return this.learningService.publishPath(pathId, orgId, req.user.id);
  }

  @Post('paths/:pathId/archive')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Archive a learning path' })
  archivePath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.learningService.archivePath(pathId, orgId);
  }

  @Post('paths/:pathId/unarchive')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Restore an archived learning path to published' })
  unarchivePath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.learningService.unarchivePath(pathId, orgId);
  }

  @Delete('paths/:pathId')
  @RequirePermission('learning.path.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a learning path (requires the learning delete permission)' })
  deletePath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.learningService.deletePath(pathId, orgId);
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  @Post('paths/:pathId/items')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Add a learning item to a path' })
  addItem(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Body() dto: CreateLearningItemDto,
  ) {
    return this.learningService.addItem(pathId, orgId, dto);
  }

  // NOTE: 'reorder' MUST be declared before ':itemId', otherwise Express binds
  // PATCH …/items/reorder to :itemId="reorder" and this route is unreachable.
  @Patch('paths/:pathId/items/reorder')
  @RequirePermission('learning.path.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Reorder items in a learning path' })
  reorderItems(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Body() dto: ReorderItemsDto,
  ) {
    return this.learningService.reorderItems(pathId, orgId, dto);
  }

  @Patch('paths/:pathId/items/:itemId')
  @RequirePermission('learning.path.manage', PermissionAction.edit)
  @ApiOperation({ summary: 'Update a learning item' })
  updateItem(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateLearningItemDto,
  ) {
    return this.learningService.updateItem(pathId, itemId, orgId, dto);
  }

  @Delete('paths/:pathId/items/:itemId')
  @RequirePermission('learning.path.manage', PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a learning item' })
  deleteItem(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.learningService.deleteItem(pathId, itemId, orgId);
  }

  // ─── Material files (upload + preview) ───────────────────────────────────────

  @Post('paths/:pathId/items/:itemId/file')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Upload/replace the document on a learning item (→ in-app preview)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadItemFile(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: UploadedFileType,
    @Body('allow_download') allowDownload?: string,
  ) {
    // Multipart form fields arrive as strings; default to downloadable.
    const allow = allowDownload === undefined ? true : allowDownload !== 'false';
    return this.filesService.uploadItemFile(orgId, pathId, itemId, file, allow);
  }

  @Get('paths/:pathId/items/:itemId/view-url')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Signed inline preview URL for a material (creator/admin)' })
  getAdminViewUrl(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.filesService.getAdminViewUrl(orgId, pathId, itemId);
  }

  @Get('paths/:pathId/items/:itemId/download-url')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Signed download URL for a material (creator/admin preview)' })
  getAdminDownloadUrl(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.filesService.getAdminDownloadUrl(orgId, pathId, itemId);
  }

  @Get('paths/:pathId/items/:itemId/view-file')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Stream a material preview inline (creator/admin, same-origin for pdf.js)' })
  async streamAdminPreview(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Param('itemId') itemId: string,
    @Res() res: Response,
  ) {
    const { buffer, mime, fileName } = await this.filesService.getAdminPreviewFile(orgId, pathId, itemId);
    sendInline(res, buffer, mime, fileName);
  }

  @Get('paths/:pathId/engagement')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Who-accessed-what engagement analytics for a path' })
  getEngagement(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.filesService.getEngagement(orgId, pathId);
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  @Post('paths/:pathId/assign')
  @RequirePermission('learning.path.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Assign a learning path to employees' })
  assignPath(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
    @Request() req: AuthRequest,
    @Body() dto: AssignPathDto,
  ) {
    return this.learningService.assignPath(pathId, orgId, req.user.id, dto);
  }

  @Get('paths/:pathId/assignments')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Get all assignments for a learning path' })
  getAssignments(
    @Param('orgId') orgId: string,
    @Param('pathId') pathId: string,
  ) {
    return this.learningService.getAssignments(pathId, orgId);
  }

  // ─── Progress Dashboard (HR) ─────────────────────────────────────────────────

  @Get('progress')
  @RequirePermission('learning.path.manage', PermissionAction.read)
  @ApiOperation({ summary: 'Get org-wide learning progress summary' })
  getOrgProgress(@Param('orgId') orgId: string) {
    return this.learningService.getOrgProgress(orgId);
  }

  // ─── Employee: My Learning ──────────────────────────────────────────────────

  @Get('my')
  @ApiOperation({ summary: 'Get my assigned learning paths' })
  getMyAssignments(@Request() req: AuthRequest) {
    const profileId = requireProfileId(req);
    if (!profileId) return [];
    return this.learningService.getMyAssignments(profileId);
  }

  @Get('my/:assignmentId')
  @ApiOperation({ summary: 'Get a specific assignment with items and progress' })
  getMyAssignment(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Request() req: AuthRequest,
  ) {
    const profileId = requireProfileId(req);
    return this.learningService.getMyAssignment(assignmentId, profileId, orgId);
  }

  @Post('my/:assignmentId/items/:itemId/complete')
  @ApiOperation({ summary: 'Mark a learning item as complete' })
  completeItem(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthRequest,
    @Body() dto: CompleteItemDto,
  ) {
    const profileId = requireProfileId(req);
    return this.learningService.completeItem(assignmentId, itemId, profileId, orgId, dto);
  }

  @Post('my/:assignmentId/items/:itemId/uncomplete')
  @ApiOperation({ summary: 'Undo completion of a learning item (accidental click)' })
  uncompleteItem(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthRequest,
  ) {
    return this.learningService.uncompleteItem(assignmentId, itemId, requireProfileId(req), orgId);
  }

  @Get('my/:assignmentId/items/:itemId/view-url')
  @ApiOperation({ summary: 'Inline preview URL for a material I was assigned (records the view)' })
  getMyViewUrl(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthRequest,
  ) {
    return this.filesService.getLearnerViewData(
      orgId,
      assignmentId,
      itemId,
      requireProfileId(req),
      req.user.id,
    );
  }

  @Get('my/:assignmentId/items/:itemId/download-url')
  @ApiOperation({ summary: 'Signed download URL for a material (blocked when view-only)' })
  getMyDownloadUrl(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthRequest,
  ) {
    return this.filesService.getLearnerDownloadUrl(
      orgId,
      assignmentId,
      itemId,
      requireProfileId(req),
    );
  }

  @Get('my/:assignmentId/items/:itemId/view-file')
  @ApiOperation({ summary: 'Stream an assigned material inline (same-origin for pdf.js)' })
  async streamMyPreview(
    @Param('orgId') orgId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthRequest,
    @Res() res: Response,
  ) {
    const { buffer, mime, fileName } = await this.filesService.getLearnerPreviewFile(
      orgId,
      assignmentId,
      itemId,
      requireProfileId(req),
    );
    sendInline(res, buffer, mime, fileName);
  }
}

/** Send a buffer inline, bypassing the JSON response wrapper. Never cached. */
function sendInline(res: Response, buffer: Buffer, mime: string, fileName: string) {
  const safe = fileName.replace(/"/g, '');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}
