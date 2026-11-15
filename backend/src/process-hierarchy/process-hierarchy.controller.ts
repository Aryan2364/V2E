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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction, ProcessPool } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { principalFromUser } from '../access-rights/permissions.service';
import {
  MAX_ATTACHMENT_BYTES,
  type UploadedFile as UploadedFileType,
} from '../tasks/task-attachments.service';
import { ProcessMapService } from './process-map.service';
import { ProcessLaneService } from './process-lane.service';
import { ProcessNodeService } from './process-node.service';
import { ProcessConnectionService } from './process-connection.service';
import { ProcessArtifactService } from './process-artifact.service';
import { ProcessAccessRulesService } from './process-access-rules.service';
import { ProcessSnapshotService } from './process-snapshot.service';
import { ProcessReviewService } from './process-review.service';
import { ProcessTemplateService } from './process-template.service';
import { ProcessNodeCopyService } from './process-node-copy.service';
import { CreateMapDto, UpdateMapDto } from './dto/map.dto';
import { BulkPositionDto, CreateNodeDto, PasteNodesDto, UpdateNodeDto } from './dto/node.dto';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto';
import { CreateLaneDto, ReassignLaneDto, ReorderLanesDto, PoolOrderDto } from './dto/lane.dto';
import { CreateArtifactDto, CreateMaterialDto, LinkArtifactDto, UpdateArtifactDto } from './dto/artifact.dto';
import { AddAccessRuleDto } from './dto/access.dto';
import { CreateSnapshotDto, RestoreStateDto } from './dto/snapshot.dto';
import { DecideStatusDto, RequestReviewDto } from './dto/status.dto';
import { InstantiateTemplateDto, SaveAsTemplateDto } from './dto/template.dto';

const LEAF = 'process_hierarchy.map.manage';

@ApiTags('process-hierarchy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/process-hierarchy')
export class ProcessHierarchyController {
  constructor(
    private readonly maps: ProcessMapService,
    private readonly lanes: ProcessLaneService,
    private readonly nodes: ProcessNodeService,
    private readonly conns: ProcessConnectionService,
    private readonly artifacts: ProcessArtifactService,
    private readonly rules: ProcessAccessRulesService,
    private readonly snapshots: ProcessSnapshotService,
    private readonly review: ProcessReviewService,
    private readonly templates: ProcessTemplateService,
    private readonly copy: ProcessNodeCopyService,
  ) {}

  // ─── Maps ──────────────────────────────────────────────────────────────────
  @Get('maps')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'List process maps visible to the caller' })
  listMaps(@Param('orgId') orgId: string, @Request() req: any) {
    return this.maps.listMaps(orgId, principalFromUser(req.user));
  }

  @Post('maps')
  @RequirePermission(LEAF, PermissionAction.write)
  @ApiOperation({ summary: 'Create a process map (caller becomes owner)' })
  createMap(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateMapDto) {
    return this.maps.createMap(orgId, req.user.id, dto);
  }

  @Get('maps/:mapId')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Process map detail' })
  getMap(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.maps.getMap(orgId, principalFromUser(req.user), mapId);
  }

  @Patch('maps/:mapId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Rename / re-describe a process map (owner or admin)' })
  updateMap(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: UpdateMapDto) {
    return this.maps.updateMap(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Delete('maps/:mapId')
  @RequirePermission(LEAF, PermissionAction.delete)
  @ApiOperation({ summary: 'Delete a process map (admin only)' })
  deleteMap(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.maps.deleteMap(orgId, principalFromUser(req.user), mapId);
  }

  // ─── Flow (one drill level) ──────────────────────────────────────────────────
  @Get('maps/:mapId/flow')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Nodes + connections at one level (omit parentNodeId for the map root)' })
  getFlow(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Request() req: any,
    @Query('parentNodeId') parentNodeId?: string,
  ) {
    return this.maps.getFlow(orgId, principalFromUser(req.user), mapId, parentNodeId || null);
  }

  @Get('maps/:mapId/tree')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Flat list of every node in the map (for the outline tree + search)' })
  getTree(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.maps.getTree(orgId, principalFromUser(req.user), mapId);
  }

  // ─── Nodes ───────────────────────────────────────────────────────────────────
  @Post('maps/:mapId/nodes')
  @RequirePermission(LEAF, PermissionAction.write)
  @ApiOperation({ summary: 'Add a node to a flow' })
  createNode(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateNodeDto) {
    return this.nodes.createNode(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Post('maps/:mapId/nodes/paste')
  @RequirePermission(LEAF, PermissionAction.write)
  @ApiOperation({ summary: 'Paste copied nodes (with sub-trees) into this map/level' })
  pasteNodes(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: PasteNodesDto) {
    return this.copy.pasteNodes(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Get('maps/:mapId/nodes/:nodeId')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Full node detail (checklist, inputs/outputs, sharing)' })
  getNode(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('nodeId') nodeId: string, @Request() req: any) {
    return this.nodes.getNode(orgId, principalFromUser(req.user), mapId, nodeId);
  }

  @Patch('maps/:mapId/nodes/:nodeId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Update a node (details, status, responsible, checklist, position)' })
  updateNode(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Request() req: any,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.nodes.updateNode(orgId, principalFromUser(req.user), mapId, nodeId, dto);
  }

  @Post('maps/:mapId/node-positions')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Bulk-save node positions after a canvas drag' })
  bulkPosition(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: BulkPositionDto) {
    return this.nodes.bulkPosition(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Delete('maps/:mapId/nodes/:nodeId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Delete a node and its sub-tree' })
  deleteNode(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('nodeId') nodeId: string, @Request() req: any) {
    return this.nodes.deleteNode(orgId, principalFromUser(req.user), mapId, nodeId);
  }

  @Post('maps/:mapId/nodes/:nodeId/detach')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Detach a reference into its own independent copy (copy-on-write)' })
  detachNode(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('nodeId') nodeId: string, @Request() req: any) {
    return this.copy.detachNode(orgId, principalFromUser(req.user), mapId, nodeId);
  }

  @Post('maps/:mapId/nodes/:nodeId/make-reusable')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Turn a container into a standalone map that can be referenced anywhere' })
  makeNodeReusable(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('nodeId') nodeId: string, @Request() req: any) {
    return this.copy.makeNodeReusable(orgId, principalFromUser(req.user), mapId, nodeId);
  }

  // ─── Status workflow (draft → in_review → final) ─────────────────────────────
  @Post('maps/:mapId/nodes/:nodeId/request-review')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Send a node (optionally its sub-tree) for review' })
  requestReview(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Request() req: any,
    @Body() dto: RequestReviewDto,
  ) {
    return this.review.requestReview(orgId, principalFromUser(req.user), mapId, nodeId, !!dto.cascade);
  }

  @Post('maps/:mapId/nodes/:nodeId/decide-status')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Approve (final) or send back (draft) a node — owner/admin' })
  decideStatus(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Request() req: any,
    @Body() dto: DecideStatusDto,
  ) {
    return this.review.decideStatus(orgId, principalFromUser(req.user), mapId, nodeId, dto.status, !!dto.cascade);
  }

  // ─── Connections ─────────────────────────────────────────────────────────────
  @Post('maps/:mapId/connections')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Draw a connection between two steps in a flow' })
  createConnection(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateConnectionDto) {
    return this.conns.createConnection(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Patch('maps/:mapId/connections/:connId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Update a connection label / branch' })
  updateConnection(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('connId') connId: string,
    @Request() req: any,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.conns.updateConnection(orgId, principalFromUser(req.user), mapId, connId, dto);
  }

  @Delete('maps/:mapId/connections/:connId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Delete a connection' })
  deleteConnection(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('connId') connId: string, @Request() req: any) {
    return this.conns.deleteConnection(orgId, principalFromUser(req.user), mapId, connId);
  }

  // ─── Swimlanes ───────────────────────────────────────────────────────────────
  @Post('maps/:mapId/lanes')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Create an (empty) swimlane for a department in a level' })
  createLane(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateLaneDto) {
    return this.lanes.createLane(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Patch('maps/:mapId/lanes-order')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Reorder the department lanes at a level (top→bottom)' })
  reorderLanes(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: ReorderLanesDto) {
    return this.lanes.reorderLanes(orgId, principalFromUser(req.user), mapId, dto.parent_node_id ?? null, dto.lane_ids);
  }

  @Patch('maps/:mapId/pool-order')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Reorder the pools (customer/company/vendor) at a level (top→bottom)' })
  setPoolOrder(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: PoolOrderDto) {
    return this.lanes.setPoolOrder(orgId, principalFromUser(req.user), mapId, dto.parent_node_id ?? null, dto.pools as ProcessPool[]);
  }

  @Patch('maps/:mapId/lanes/:laneId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Re-point a swimlane at a different department (its steps move with it)' })
  reassignLane(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('laneId') laneId: string,
    @Request() req: any,
    @Body() dto: ReassignLaneDto,
  ) {
    return this.lanes.reassignLane(orgId, principalFromUser(req.user), mapId, laneId, dto.department_id);
  }

  @Delete('maps/:mapId/lanes/:laneId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Delete a swimlane (move its steps to another lane first if not empty)' })
  deleteLane(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('laneId') laneId: string,
    @Request() req: any,
    @Query('move_to_department_id') moveToDepartmentId?: string,
  ) {
    return this.lanes.deleteLane(orgId, principalFromUser(req.user), mapId, laneId, moveToDepartmentId);
  }

  // ─── Artifacts ────────────────────────────────────────────────────────────────
  @Get('maps/:mapId/artifacts')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'List the map artifact library' })
  listArtifacts(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.artifacts.listArtifacts(orgId, principalFromUser(req.user), mapId);
  }

  @Post('maps/:mapId/artifacts')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Create a metadata-only artifact' })
  createArtifact(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateArtifactDto) {
    return this.artifacts.createArtifact(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Post('maps/:mapId/materials')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Create a link or article material (no file)' })
  createMaterial(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateMaterialDto) {
    return this.artifacts.createMaterial(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Post('maps/:mapId/artifacts/upload')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Create an artifact with a real uploaded file (R2)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadArtifact(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Request() req: any,
    @UploadedFile() file: UploadedFileType,
    @Body() dto: CreateArtifactDto,
  ) {
    return this.artifacts.uploadArtifact(orgId, principalFromUser(req.user), mapId, dto, file);
  }

  @Patch('maps/:mapId/artifacts/:artifactId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Update artifact metadata' })
  updateArtifact(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('artifactId') artifactId: string,
    @Request() req: any,
    @Body() dto: UpdateArtifactDto,
  ) {
    return this.artifacts.updateArtifact(orgId, principalFromUser(req.user), mapId, artifactId, dto);
  }

  @Delete('maps/:mapId/artifacts/:artifactId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Delete an artifact (and its file)' })
  deleteArtifact(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('artifactId') artifactId: string, @Request() req: any) {
    return this.artifacts.deleteArtifact(orgId, principalFromUser(req.user), mapId, artifactId);
  }

  @Get('maps/:mapId/artifacts/:artifactId')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Full detail for one artifact (preview a document from the canvas)' })
  getArtifact(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('artifactId') artifactId: string, @Request() req: any) {
    return this.artifacts.getArtifact(orgId, principalFromUser(req.user), mapId, artifactId);
  }

  @Get('maps/:mapId/artifacts/:artifactId/view')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Inline signed URL for previewing a file (respects view-only for downloads)' })
  viewArtifact(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('artifactId') artifactId: string, @Request() req: any) {
    return this.artifacts.viewArtifact(orgId, principalFromUser(req.user), mapId, artifactId);
  }

  @Get('maps/:mapId/artifacts/:artifactId/view-file')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Stream an artifact file inline (same-origin, for pdf.js / OfficeViewer)' })
  async viewArtifactFile(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('artifactId') artifactId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { buffer, mime, fileName } = await this.artifacts.getArtifactBytes(orgId, principalFromUser(req.user), mapId, artifactId);
    const safe = fileName.replace(/"/g, '');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  }

  @Get('maps/:mapId/artifacts/:artifactId/download')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Short-lived signed download URL for an artifact file' })
  downloadArtifact(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('artifactId') artifactId: string, @Request() req: any) {
    return this.artifacts.downloadArtifact(orgId, principalFromUser(req.user), mapId, artifactId);
  }

  @Post('maps/:mapId/nodes/:nodeId/artifacts')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Link an artifact to a node as input/output' })
  linkArtifact(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Request() req: any,
    @Body() dto: LinkArtifactDto,
  ) {
    return this.artifacts.linkArtifact(orgId, principalFromUser(req.user), mapId, nodeId, dto);
  }

  @Delete('maps/:mapId/nodes/:nodeId/artifacts/:linkId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Remove an artifact input/output link from a node' })
  unlinkArtifact(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Param('linkId') linkId: string,
    @Request() req: any,
  ) {
    return this.artifacts.unlinkArtifact(orgId, principalFromUser(req.user), mapId, nodeId, linkId);
  }

  // ─── Access / sharing ───────────────────────────────────────────────────────
  @Get('maps/:mapId/nodes/:nodeId/access')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'List sharing/attachment rules on a node' })
  listAccess(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('nodeId') nodeId: string, @Request() req: any) {
    return this.rules.listNodeAccess(orgId, principalFromUser(req.user), mapId, nodeId);
  }

  @Post('maps/:mapId/nodes/:nodeId/access')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Attach a department/role/person (or exclude a person) at a node' })
  addAccess(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Request() req: any,
    @Body() dto: AddAccessRuleDto,
  ) {
    return this.rules.addAccessRule(orgId, principalFromUser(req.user), mapId, nodeId, dto);
  }

  @Delete('maps/:mapId/nodes/:nodeId/access/:ruleId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Remove a sharing/attachment rule' })
  removeAccess(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Param('nodeId') nodeId: string,
    @Param('ruleId') ruleId: string,
    @Request() req: any,
  ) {
    return this.rules.removeAccessRule(orgId, principalFromUser(req.user), mapId, nodeId, ruleId);
  }

  // ─── Snapshots (create + restore; diff is Phase 2) ───────────────────────────
  @Get('maps/:mapId/snapshots')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'List saved versions (as-is / to-be) of a map' })
  listSnapshots(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.snapshots.listSnapshots(orgId, principalFromUser(req.user), mapId);
  }

  @Post('maps/:mapId/snapshots')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Freeze the current map into a named version' })
  createSnapshot(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: CreateSnapshotDto) {
    return this.snapshots.createSnapshot(orgId, principalFromUser(req.user), mapId, dto);
  }

  @Post('maps/:mapId/snapshots/:snapshotId/restore')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Replace the working map from a saved version' })
  restoreSnapshot(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Param('snapshotId') snapshotId: string, @Request() req: any) {
    return this.snapshots.restoreSnapshot(orgId, principalFromUser(req.user), mapId, snapshotId);
  }

  // ─── Undo/redo (session history) — capture + restore state without a version row ─
  @Get('maps/:mapId/state')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Serialize the current map (for the editor undo stack)' })
  exportState(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any) {
    return this.snapshots.exportState(orgId, principalFromUser(req.user), mapId);
  }

  @Post('maps/:mapId/restore-state')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Rebuild the map from a captured state (undo/redo step)' })
  restoreState(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: RestoreStateDto) {
    return this.snapshots.restoreState(orgId, principalFromUser(req.user), mapId, dto.tree_json);
  }

  // ─── Diff (as-is vs to-be) ────────────────────────────────────────────────────
  @Get('maps/:mapId/diff')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'Structural + field-level diff between two versions (use "live" or a snapshot id)' })
  diff(
    @Param('orgId') orgId: string,
    @Param('mapId') mapId: string,
    @Request() req: any,
    @Query('base') base: string,
    @Query('target') target: string,
  ) {
    return this.snapshots.diff(orgId, principalFromUser(req.user), mapId, base || 'live', target || 'live');
  }

  // ─── Templates (reusable blueprints) ──────────────────────────────────────────
  @Get('templates')
  @RequirePermission(LEAF, PermissionAction.read)
  @ApiOperation({ summary: 'List reusable process templates' })
  listTemplates(@Param('orgId') orgId: string) {
    return this.templates.listTemplates(orgId);
  }

  @Post('maps/:mapId/save-as-template')
  @RequirePermission(LEAF, PermissionAction.write)
  @ApiOperation({ summary: 'Save the current map as a reusable template' })
  saveAsTemplate(@Param('orgId') orgId: string, @Param('mapId') mapId: string, @Request() req: any, @Body() dto: SaveAsTemplateDto) {
    return this.templates.saveAsTemplate(orgId, principalFromUser(req.user), mapId, dto.name, dto.description);
  }

  @Post('templates/:templateId/instantiate')
  @RequirePermission(LEAF, PermissionAction.write)
  @ApiOperation({ summary: 'Create a new map from a template' })
  instantiateTemplate(@Param('orgId') orgId: string, @Param('templateId') templateId: string, @Request() req: any, @Body() dto: InstantiateTemplateDto) {
    return this.templates.instantiateTemplate(orgId, principalFromUser(req.user), templateId, dto.name);
  }

  @Delete('templates/:templateId')
  @RequirePermission(LEAF, PermissionAction.edit)
  @ApiOperation({ summary: 'Delete a template (creator or admin)' })
  deleteTemplate(@Param('orgId') orgId: string, @Param('templateId') templateId: string, @Request() req: any) {
    return this.templates.deleteTemplate(orgId, principalFromUser(req.user), templateId);
  }
}
