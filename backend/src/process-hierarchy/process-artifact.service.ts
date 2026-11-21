import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import {
  UploadedFile,
  validateAttachmentFile,
  extensionOf,
} from '../tasks/task-attachments.service';
import {
  CreateArtifactDto,
  CreateMaterialDto,
  LinkArtifactDto,
  UpdateArtifactDto,
} from './dto/artifact.dto';
import { requireProcessNode } from './process-helpers';

@Injectable()
export class ProcessArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly r2: R2Service,
  ) {}

  // ─── Artifacts ──────────────────────────────────────────────────────────────

  async listArtifacts(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.prisma.processArtifact.findMany({
      where: { organization_id: orgId, map_id: mapId },
      orderBy: { created_at: 'desc' },
    });
  }

  async createArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateArtifactDto,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    return this.prisma.processArtifact.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        artifact_type: dto.artifact_type ?? 'document',
        created_by_user_id: principal.userId,
      },
    });
  }

  async uploadArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateArtifactDto,
    file: UploadedFile,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    validateAttachmentFile(file);
    const key = `orgs/${orgId}/process-artifacts/${mapId}/${randomUUID()}.${extensionOf(file.originalname)}`;
    await this.r2.putObject(key, file.buffer, file.mimetype);
    // Multipart sends booleans as strings; treat only an explicit "false" as view-only.
    const allowDownload = !(
      dto.allow_download === false || dto.allow_download === 'false'
    );
    return this.prisma.processArtifact.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        name: (dto.name || file.originalname).trim().slice(0, 50),
        description: dto.description ?? null,
        artifact_type: dto.artifact_type ?? 'document',
        content_type: 'file',
        allow_download: allowDownload,
        file_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        storage_key: key,
        created_by_user_id: principal.userId,
      },
    });
  }

  // Create a link or article material (no file). Exactly one of url / content_body.
  async createMaterial(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateMaterialDto,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const isLink = !!dto.url;
    const isArticle =
      dto.content_body !== undefined && dto.content_body !== null;
    if (isLink === isArticle) {
      throw new BadRequestException(
        'Add either a link or an article, not both.',
      );
    }
    return this.prisma.processArtifact.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        name: dto.name.trim().slice(0, 50),
        content_type: isLink ? 'link' : 'article',
        url: isLink ? dto.url : null,
        content_body: isArticle ? dto.content_body : null,
        created_by_user_id: principal.userId,
      },
    });
  }

  async updateArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
    dto: UpdateArtifactDto,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    return this.prisma.processArtifact.update({
      where: { id: artifact.id },
      data: {
        ...(dto.name !== undefined
          ? { name: dto.name.trim().slice(0, 50) }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.artifact_type !== undefined
          ? { artifact_type: dto.artifact_type }
          : {}),
        ...(dto.url !== undefined && artifact.content_type === 'link'
          ? { url: dto.url }
          : {}),
        ...(dto.content_body !== undefined &&
        artifact.content_type === 'article'
          ? { content_body: dto.content_body }
          : {}),
        ...(dto.allow_download !== undefined && artifact.content_type === 'file'
          ? { allow_download: dto.allow_download }
          : {}),
      },
    });
  }

  async deleteArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (artifact.storage_key) await this.r2.deleteObject(artifact.storage_key);
    await this.prisma.processArtifact.delete({ where: { id: artifact.id } }); // cascades node links
    return { success: true };
  }

  // Full detail for one artifact — used to preview a document straight from the canvas
  // (decide link vs file vs article, read the url/body). View access to the map is enough.
  async getArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.requireArtifact(orgId, mapId, artifactId);
  }

  // Inline URL for previewing a file (does NOT bypass view-only — that only blocks
  // the download button; previewing is always allowed to anyone who can view the map).
  async viewArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key)
      throw new BadRequestException('This material has no file to preview');
    const url = await this.r2.getSignedDownloadUrl(
      artifact.storage_key,
      artifact.file_name ?? artifact.name,
    );
    return {
      url,
      file_name: artifact.file_name,
      mime_type: artifact.mime_type,
      allow_download: artifact.allow_download,
    };
  }

  async downloadArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key)
      throw new BadRequestException('This artifact has no attached file');
    if (!artifact.allow_download)
      throw new ForbiddenException('This file is view-only');
    const url = await this.r2.getSignedDownloadUrl(
      artifact.storage_key,
      artifact.file_name ?? artifact.name,
    );
    return { url };
  }

  // Raw bytes, streamed same-origin (so pdf.js / OfficeViewer avoid R2 CORS). Preview
  // is always allowed to map viewers; view-only only blocks the Download button.
  async getArtifactBytes(
    orgId: string,
    principal: Principal,
    mapId: string,
    artifactId: string,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key)
      throw new BadRequestException('This material has no file to preview');
    const buffer = await this.r2.getObjectBuffer(artifact.storage_key);
    return {
      buffer,
      mime: artifact.mime_type ?? 'application/octet-stream',
      fileName: artifact.file_name ?? artifact.name,
    };
  }

  private async requireArtifact(
    orgId: string,
    mapId: string,
    artifactId: string,
  ) {
    const artifact = await this.prisma.processArtifact.findFirst({
      where: { id: artifactId, map_id: mapId, organization_id: orgId },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return artifact;
  }

  async linkArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    dto: LinkArtifactDto,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    await this.requireArtifact(orgId, mapId, dto.artifact_id);
    return this.prisma.processNodeArtifact.upsert({
      where: {
        node_id_artifact_id_direction: {
          node_id: nodeId,
          artifact_id: dto.artifact_id,
          direction: dto.direction,
        },
      },
      create: {
        node_id: nodeId,
        artifact_id: dto.artifact_id,
        direction: dto.direction,
      },
      update: {},
    });
  }

  async unlinkArtifact(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    linkId: string,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const res = await this.prisma.processNodeArtifact.deleteMany({
      where: { id: linkId, node_id: nodeId },
    });
    if (res.count === 0) throw new NotFoundException('Artifact link not found');
    return { success: true };
  }
}
