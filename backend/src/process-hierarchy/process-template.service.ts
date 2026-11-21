import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { ProcessNodeCopyService } from './process-node-copy.service';
import { ProcessSnapshotService } from './process-snapshot.service';

@Injectable()
export class ProcessTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly snapshots: ProcessSnapshotService,
    private readonly copy: ProcessNodeCopyService,
  ) {}

  // ─── Templates (reusable process blueprints) ───────────────────────────────────

  async saveAsTemplate(
    orgId: string,
    principal: Principal,
    mapId: string,
    name: string,
    description?: string,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const tree = await this.snapshots.serializeMap(orgId, mapId);
    return this.prisma.processTemplate.create({
      data: {
        organization_id: orgId,
        name: name.trim(),
        description: description ?? null,
        tree_json: tree,
        source_map_id: mapId,
        created_by_user_id: principal.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        created_by_user_id: true,
        created_at: true,
      },
    });
  }

  async listTemplates(orgId: string) {
    return this.prisma.processTemplate.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        created_by_user_id: true,
        created_at: true,
      },
    });
  }

  async deleteTemplate(
    orgId: string,
    principal: Principal,
    templateId: string,
  ) {
    const tpl = await this.prisma.processTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { id: true, created_by_user_id: true },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    if (!principal.isAdmin && tpl.created_by_user_id !== principal.userId) {
      throw new ForbiddenException(
        'Only the template creator or an administrator can delete it',
      );
    }
    await this.prisma.processTemplate.delete({ where: { id: templateId } });
    return { success: true };
  }

  /** Create a brand-new map from a template, cloning the tree with fresh ids. */
  async instantiateTemplate(
    orgId: string,
    principal: Principal,
    templateId: string,
    name: string,
  ) {
    const tpl = await this.prisma.processTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return this.copy.instantiateTree(
      orgId,
      principal.userId,
      tpl.tree_json as any,
      name,
    );
  }
}
