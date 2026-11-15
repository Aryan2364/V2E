import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProcessNodeKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto';
import { requireProcessNode } from './process-helpers';

@Injectable()
export class ProcessConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
  ) {}

  // ─── Connections ─────────────────────────────────────────────────────────────

  async createConnection(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateConnectionDto,
  ) {
    const parentId = dto.parent_node_id ?? null;
    const [source, target] = await Promise.all([
      requireProcessNode(this.prisma, orgId, mapId, dto.source_node_id),
      requireProcessNode(this.prisma, orgId, mapId, dto.target_node_id),
    ]);
    if (
      source.parent_node_id !== parentId ||
      target.parent_node_id !== parentId
    ) {
      throw new BadRequestException(
        'A connection can only join two steps in the same flow',
      );
    }
    if (dto.source_node_id === dto.target_node_id) {
      throw new BadRequestException('A step cannot connect to itself');
    }
    if (parentId)
      await this.access.assertCanEditNode(orgId, principal, parentId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);

    // Output limits: a decision branches into exactly one Yes and one No. Every other step may lead
    // to as many next steps as it has FREE connector points — a point (a node side) is in use once a
    // line attaches to it, as this step's outgoing source_side OR an incoming target_side. So a step
    // can fan out from each of its free dots. (Authoritative guard — the client enforces the same.)
    const attached = await this.prisma.processConnection.findMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentId,
        OR: [
          { source_node_id: dto.source_node_id },
          { target_node_id: dto.source_node_id },
        ],
      },
      select: {
        source_node_id: true,
        target_node_id: true,
        source_side: true,
        target_side: true,
        condition_kind: true,
      },
    });
    const outs = attached.filter(
      (c) => c.source_node_id === dto.source_node_id,
    );
    const cond = dto.condition_kind ?? 'none';
    if (source.kind === ProcessNodeKind.decision) {
      if (cond !== 'none' && outs.some((o) => o.condition_kind === cond)) {
        throw new BadRequestException(
          `This decision already has a ${cond === 'yes' ? 'Yes' : 'No'} branch.`,
        );
      }
      if (outs.length >= 2)
        throw new BadRequestException(
          'A decision can only branch into Yes and No.',
        );
    } else {
      const usedPoints = new Set<string>();
      for (const c of attached) {
        if (c.source_node_id === dto.source_node_id && c.source_side)
          usedPoints.add(c.source_side);
        if (c.target_node_id === dto.source_node_id && c.target_side)
          usedPoints.add(c.target_side);
      }
      const side = dto.source_side ?? null;
      if (side && usedPoints.has(side)) {
        throw new BadRequestException(
          'That connection point is already in use — draw from a free dot.',
        );
      }
      if (!side && outs.length >= 4) {
        throw new BadRequestException(
          'This step already uses all its connection points.',
        );
      }
    }

    return this.prisma.processConnection.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentId,
        source_node_id: dto.source_node_id,
        target_node_id: dto.target_node_id,
        label: dto.label ?? null,
        condition_kind: cond,
        source_side: dto.source_side ?? null,
        target_side: dto.target_side ?? null,
      },
    });
  }

  async updateConnection(
    orgId: string,
    principal: Principal,
    mapId: string,
    connId: string,
    dto: UpdateConnectionDto,
  ) {
    const conn = await this.prisma.processConnection.findFirst({
      where: { id: connId, map_id: mapId, organization_id: orgId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.parent_node_id)
      await this.access.assertCanEditNode(
        orgId,
        principal,
        conn.parent_node_id,
      );
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    return this.prisma.processConnection.update({
      where: { id: connId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.condition_kind !== undefined
          ? { condition_kind: dto.condition_kind }
          : {}),
        ...(dto.source_side !== undefined
          ? { source_side: dto.source_side }
          : {}),
        ...(dto.target_side !== undefined
          ? { target_side: dto.target_side }
          : {}),
      },
    });
  }

  async deleteConnection(
    orgId: string,
    principal: Principal,
    mapId: string,
    connId: string,
  ) {
    const conn = await this.prisma.processConnection.findFirst({
      where: { id: connId, map_id: mapId, organization_id: orgId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.parent_node_id)
      await this.access.assertCanEditNode(
        orgId,
        principal,
        conn.parent_node_id,
      );
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    await this.prisma.processConnection.delete({ where: { id: connId } });
    return { success: true };
  }
}
