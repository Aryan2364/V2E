import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProcessPool, ProcessLaneOrigin } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { CreateLaneDto } from './dto/lane.dto';
import { requireProcessNode } from './process-helpers';

@Injectable()
export class ProcessLaneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
  ) {}

  // ─── Swimlane helpers ───────────────────────────────────────────────────────────

  // Validate a pool/department pair: a Company node MUST have a real department; a
  // Customer/Vendor (or unset) node never carries one.
  async resolveLane(
    orgId: string,
    pool: ProcessPool | null,
    departmentId: string | null,
  ): Promise<{ pool: ProcessPool | null; departmentId: string | null }> {
    if (pool === ProcessPool.company) {
      if (!departmentId)
        throw new BadRequestException(
          'A step in the Company pool needs a department (lane).',
        );
      const dept = await this.prisma.department.findFirst({
        where: { id: departmentId, organization_id: orgId },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department not found');
      return { pool, departmentId };
    }
    return { pool: pool ?? null, departmentId: null };
  }

  // Create the (auto) lane for a department at a level if it doesn't already exist.
  async ensureAutoLane(
    orgId: string,
    userId: string,
    mapId: string,
    parentNodeId: string | null,
    departmentId: string,
  ) {
    const existing = await this.prisma.processLane.findFirst({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
        department_id: departmentId,
      },
      select: { id: true },
    });
    if (existing) return;
    const max = await this.prisma.processLane.aggregate({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
      },
      _max: { sort_order: true },
    });
    await this.prisma.processLane.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
        department_id: departmentId,
        origin: ProcessLaneOrigin.auto,
        sort_order: (max._max.sort_order ?? -1) + 1,
        created_by_user_id: userId,
      },
    });
  }

  // Remove a lane once its last node LEAVES it (a node moved to another lane, left the Company pool,
  // changed level, or was deleted). Called only from those paths — so an emptied lane vanishes
  // regardless of origin, which is what people expect ("no steps left → the band should go"). A
  // freshly created empty lane ("New swimlane", to fill later) never triggers this, so it survives;
  // getFlow's lazy read-time prune stays auto-only to protect that just-created case.
  async cleanupAutoLane(
    orgId: string,
    mapId: string,
    parentNodeId: string | null,
    departmentId: string,
  ) {
    const lane = await this.prisma.processLane.findFirst({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
        department_id: departmentId,
      },
      select: { id: true },
    });
    if (!lane) return;
    const count = await this.prisma.processNode.count({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
        department_id: departmentId,
        is_deleted: false,
      },
    });
    if (count === 0)
      await this.prisma.processLane.delete({ where: { id: lane.id } });
  }

  // Create an empty lane by hand (origin = manual, so it persists even while empty). If a
  // lane for that department already exists at this level, promote it to manual and reuse it.
  async createLane(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateLaneDto,
  ) {
    const parentId = dto.parent_node_id ?? null;
    if (parentId) {
      await requireProcessNode(this.prisma, orgId, mapId, parentId);
      await this.access.assertCanEditNode(orgId, principal, parentId);
    } else {
      await this.access.assertCanEditMap(orgId, principal, mapId);
    }
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.department_id, organization_id: orgId },
      select: { id: true },
    });
    if (!dept) throw new BadRequestException('Department not found');

    const existing = await this.prisma.processLane.findFirst({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentId,
        department_id: dto.department_id,
      },
    });
    if (existing) {
      if (existing.origin === ProcessLaneOrigin.auto) {
        return this.prisma.processLane.update({
          where: { id: existing.id },
          data: { origin: ProcessLaneOrigin.manual },
        });
      }
      return existing;
    }
    const max = await this.prisma.processLane.aggregate({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentId,
      },
      _max: { sort_order: true },
    });
    return this.prisma.processLane.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentId,
        department_id: dto.department_id,
        origin: ProcessLaneOrigin.manual,
        sort_order: (max._max.sort_order ?? -1) + 1,
        created_by_user_id: principal.userId,
      },
    });
  }

  // Delete a lane. Empty → removed at once. Has steps → the caller must name a lane to move
  // them into first (never silently strand or delete a step).
  async deleteLane(
    orgId: string,
    principal: Principal,
    mapId: string,
    laneId: string,
    moveToDepartmentId?: string,
  ) {
    const lane = await this.prisma.processLane.findFirst({
      where: { id: laneId, map_id: mapId, organization_id: orgId },
    });
    if (!lane) throw new NotFoundException('Lane not found');
    if (lane.parent_node_id)
      await this.access.assertCanEditNode(
        orgId,
        principal,
        lane.parent_node_id,
      );
    else await this.access.assertCanEditMap(orgId, principal, mapId);

    const nodesInLane = await this.prisma.processNode.count({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: lane.parent_node_id,
        department_id: lane.department_id,
        is_deleted: false,
      },
    });
    if (nodesInLane > 0) {
      if (!moveToDepartmentId)
        throw new BadRequestException(
          'This lane has steps — choose a lane to move them to first.',
        );
      if (moveToDepartmentId === lane.department_id)
        throw new BadRequestException(
          'Choose a different lane to move the steps into.',
        );
      const dest = await this.prisma.processLane.findFirst({
        where: {
          organization_id: orgId,
          map_id: mapId,
          parent_node_id: lane.parent_node_id,
          department_id: moveToDepartmentId,
        },
        select: { id: true },
      });
      if (!dest) throw new BadRequestException('Destination lane not found');
      await this.prisma.processNode.updateMany({
        where: {
          organization_id: orgId,
          map_id: mapId,
          parent_node_id: lane.parent_node_id,
          department_id: lane.department_id,
          is_deleted: false,
        },
        data: { department_id: moveToDepartmentId },
      });
    }
    await this.prisma.processLane.delete({ where: { id: lane.id } });
    return { success: true };
  }

  // Re-point a lane at a DIFFERENT department (rename the lane) — every step in the lane moves to
  // the new department with it. If a lane for the new department already exists at this level, the
  // steps merge into it and this lane is removed; otherwise this lane is simply retargeted.
  async reassignLane(
    orgId: string,
    principal: Principal,
    mapId: string,
    laneId: string,
    newDepartmentId: string,
  ) {
    const lane = await this.prisma.processLane.findFirst({
      where: { id: laneId, map_id: mapId, organization_id: orgId },
    });
    if (!lane) throw new NotFoundException('Lane not found');
    if (lane.parent_node_id)
      await this.access.assertCanEditNode(
        orgId,
        principal,
        lane.parent_node_id,
      );
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    if (newDepartmentId === lane.department_id) return { updated: 0 };

    const dept = await this.prisma.department.findFirst({
      where: { id: newDepartmentId, organization_id: orgId },
      select: { id: true },
    });
    if (!dept) throw new BadRequestException('Department not found');

    // Move every step in the lane to the new department.
    const moved = await this.prisma.processNode.updateMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: lane.parent_node_id,
        department_id: lane.department_id,
        pool: ProcessPool.company,
        is_deleted: false,
      },
      data: { department_id: newDepartmentId },
    });

    const existingDest = await this.prisma.processLane.findFirst({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: lane.parent_node_id,
        department_id: newDepartmentId,
      },
      select: { id: true, origin: true },
    });
    if (existingDest) {
      // Merge into the existing lane (keep it manual if either side was), drop this one.
      if (
        lane.origin === ProcessLaneOrigin.manual &&
        existingDest.origin === ProcessLaneOrigin.auto
      ) {
        await this.prisma.processLane.update({
          where: { id: existingDest.id },
          data: { origin: ProcessLaneOrigin.manual },
        });
      }
      await this.prisma.processLane.delete({ where: { id: lane.id } });
    } else {
      await this.prisma.processLane.update({
        where: { id: lane.id },
        data: { department_id: newDepartmentId },
      });
    }
    return { updated: moved.count };
  }

  // Set the top→bottom order of the department lanes at a level. Steps ride along with their lane
  // (they're positioned lane-relative), so this only changes the visual arrangement — nothing moves
  // between lanes and nothing is deleted. Ids not belonging to this level are ignored; any lane the
  // client omitted is appended so no lane loses its place.
  async reorderLanes(
    orgId: string,
    principal: Principal,
    mapId: string,
    parentNodeId: string | null,
    laneIds: string[],
  ) {
    if (parentNodeId)
      await this.access.assertCanEditNode(orgId, principal, parentNodeId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    const lanes = await this.prisma.processLane.findMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
      },
      select: { id: true },
    });
    const known = new Set(lanes.map((l) => l.id));
    const seen = new Set<string>();
    const ordered = laneIds.filter(
      (id) => known.has(id) && !seen.has(id) && (seen.add(id), true),
    );
    for (const l of lanes) if (!seen.has(l.id)) ordered.push(l.id);
    await this.prisma.$transaction(
      ordered.map((id, i) =>
        this.prisma.processLane.update({
          where: { id },
          data: { sort_order: i },
        }),
      ),
    );
    return { success: true };
  }

  // Set the top→bottom order of the pools (customer/company/vendor) at a level. Stored per level on
  // the map's pool_order JSON (keyed by parent_node_id or "root"); an unset level falls back to the
  // default customer→company→vendor. Purely visual — no step or lane changes.
  async setPoolOrder(
    orgId: string,
    principal: Principal,
    mapId: string,
    parentNodeId: string | null,
    pools: ProcessPool[],
  ) {
    if (parentNodeId)
      await this.access.assertCanEditNode(orgId, principal, parentNodeId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId, organization_id: orgId, is_deleted: false },
      select: { pool_order: true },
    });
    if (!map) throw new NotFoundException('Map not found');
    const levelKey = parentNodeId ?? 'root';
    const current: Record<string, unknown> =
      map.pool_order &&
      typeof map.pool_order === 'object' &&
      !Array.isArray(map.pool_order)
        ? { ...(map.pool_order as Record<string, unknown>) }
        : {};
    const valid = pools.filter(
      (p, i) =>
        Object.values(ProcessPool).includes(p) && pools.indexOf(p) === i,
    );
    current[levelKey] = valid;
    await this.prisma.processMap.update({
      where: { id: mapId },
      data: { pool_order: current as Prisma.InputJsonValue },
    });
    return { success: true };
  }
}
