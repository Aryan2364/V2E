import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ProcessNodeKind, ProcessPool } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { BulkPositionDto, CreateNodeDto, UpdateNodeDto } from './dto/node.dto';
import { requireProcessNode } from './process-helpers';
import { ProcessLaneService } from './process-lane.service';
import { ProcessAccessRulesService } from './process-access-rules.service';

@Injectable()
export class ProcessNodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly lanes: ProcessLaneService,
    private readonly rules: ProcessAccessRulesService,
  ) {}

  // ─── Nodes ──────────────────────────────────────────────────────────────────────

  async createNode(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateNodeDto,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    if (dto.parent_node_id) {
      await requireProcessNode(this.prisma, orgId, mapId, dto.parent_node_id);
      await this.access.assertCanEditNode(orgId, principal, dto.parent_node_id);
    } else {
      await this.access.assertCanEditMap(orgId, principal, mapId);
    }
    const maxSort = await this.prisma.processNode.aggregate({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: dto.parent_node_id ?? null,
        is_deleted: false,
      },
      _max: { sort_order: true },
    });

    // Composition. Either reference an existing map, or (build-in-place) create a fresh
    // child map for a container/sub-process so the area is instantly its own map.
    const isArea =
      dto.kind === ProcessNodeKind.container ||
      dto.kind === ProcessNodeKind.subprocess;
    let linkedMapId: string | null = null;
    if (dto.linked_map_id) {
      if (dto.linked_map_id === mapId)
        throw new BadRequestException('A node cannot reference its own map');
      await this.access.assertCanViewMap(orgId, principal, dto.linked_map_id);
      linkedMapId = dto.linked_map_id;
    } else if (dto.create_linked_map && isArea) {
      const child = await this.prisma.processMap.create({
        data: {
          organization_id: orgId,
          name: dto.name.trim(),
          parent_map_id: mapId,
          created_by_user_id: principal.userId,
        },
      });
      linkedMapId = child.id;
    }

    // Swimlane placement. A Company node needs a department (its lane); Customer/Vendor
    // have none. Assigning a Company node auto-creates its lane if one isn't there yet.
    const { pool, departmentId } = await this.lanes.resolveLane(
      orgId,
      dto.pool ?? null,
      dto.department_id ?? null,
    );
    if (pool === ProcessPool.company && departmentId) {
      await this.lanes.ensureAutoLane(
        orgId,
        principal.userId,
        mapId,
        dto.parent_node_id ?? null,
        departmentId,
      );
    }

    return this.prisma.processNode.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: dto.parent_node_id ?? null,
        kind: dto.kind,
        name: dto.name.trim(),
        description: dto.description ?? null,
        pool,
        department_id: departmentId,
        position_x: dto.position_x ?? 0,
        position_y: dto.position_y ?? 0,
        // A node created WITH a position is already placed — freeze it so it never re-flows.
        // One created without (e.g. straight into a lane) stays auto-placed until the client bakes it.
        layout_frozen: dto.position_x != null && dto.position_y != null,
        sort_order: (maxSort._max.sort_order ?? -1) + 1,
        linked_map_id: linkedMapId,
        created_by_user_id: principal.userId,
      },
    });
  }

  async getNode(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
  ) {
    await this.access.assertCanViewNode(orgId, principal, nodeId);
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    const [checklist, artifactLinks, accessRules, childCount] =
      await Promise.all([
        this.prisma.processChecklistItem.findMany({
          where: { node_id: nodeId },
          orderBy: { sort_order: 'asc' },
        }),
        this.prisma.processNodeArtifact.findMany({
          where: { node_id: nodeId },
          include: { artifact: true },
        }),
        this.prisma.processNodeAccess.findMany({
          where: { organization_id: orgId, node_id: nodeId },
        }),
        this.prisma.processNode.count({
          where: {
            organization_id: orgId,
            map_id: mapId,
            parent_node_id: nodeId,
            is_deleted: false,
            kind: { not: ProcessNodeKind.note },
          },
        }),
      ]);

    const [responsibleUser, responsibleRole] = await Promise.all([
      node.responsible_user_id
        ? this.prisma.user.findUnique({
            where: { id: node.responsible_user_id },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      node.responsible_role_id
        ? this.prisma.role.findUnique({
            where: { id: node.responsible_role_id },
            select: { id: true, title: true },
          })
        : Promise.resolve(null),
    ]);

    const linkedMapRow = node.linked_map_id
      ? await this.prisma.processMap.findFirst({
          where: {
            id: node.linked_map_id,
            organization_id: orgId,
            is_deleted: false,
          },
          select: { id: true, name: true, parent_map_id: true },
        })
      : null;
    // "owned" = built in place here (a single-use child), so detach doesn't apply.
    // "shared" = references a map owned elsewhere, where detach makes a local variant.
    const linkedMap = linkedMapRow
      ? {
          id: linkedMapRow.id,
          name: linkedMapRow.name,
          owned: linkedMapRow.parent_map_id === node.map_id,
        }
      : null;

    return {
      ...node,
      child_count: childCount,
      can_edit: await this.access.canEditNode(orgId, principal, nodeId),
      can_approve: await this.access.canEditMap(orgId, principal, mapId),
      responsible_user: responsibleUser,
      responsible_role: responsibleRole,
      linked_map: linkedMap,
      checklist,
      inputs: artifactLinks.filter((l) => l.direction === 'input'),
      outputs: artifactLinks.filter((l) => l.direction === 'output'),
      access_rules: await this.rules.enrichAccessRules(orgId, accessRules),
    };
  }

  async updateNode(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    dto: UpdateNodeDto,
  ) {
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);

    // Change node type — only the safe conversions. Start/End are structural markers
    // and never convert; an "area" (container/sub-process) may only become a step
    // once it's empty, so its contents are never stranded.
    if (dto.kind !== undefined && dto.kind !== node.kind) {
      const AREA: ProcessNodeKind[] = [
        ProcessNodeKind.container,
        ProcessNodeKind.subprocess,
      ];
      const STEP: ProcessNodeKind[] = [
        ProcessNodeKind.task,
        ProcessNodeKind.decision,
      ];
      const isEvent = (k: ProcessNodeKind) =>
        k === ProcessNodeKind.start_event || k === ProcessNodeKind.end_event;
      if (isEvent(node.kind) || isEvent(dto.kind)) {
        throw new BadRequestException(
          'Start and End markers cannot change type',
        );
      }
      if (AREA.includes(node.kind) && STEP.includes(dto.kind)) {
        const children = await this.prisma.processNode.count({
          where: {
            organization_id: orgId,
            map_id: mapId,
            parent_node_id: nodeId,
            is_deleted: false,
          },
        });
        if (children > 0) {
          throw new BadRequestException(
            'This area has steps inside it — move or remove them before turning it into a single step',
          );
        }
      }
    }

    // Cross-map link: only to a map the actor can see, never to this same map.
    if (dto.linked_map_id) {
      if (dto.linked_map_id === mapId)
        throw new BadRequestException('A node cannot link to its own map');
      await this.access.assertCanViewMap(orgId, principal, dto.linked_map_id);
    }

    // Re-parent (move to another container/level). Validate same-map, permission on
    // the destination, and no cycle (can't move a node inside itself/its own subtree).
    let reparent: {
      parent_node_id: string | null;
      sort_order: number;
      position_x: number;
      position_y: number;
    } | null = null;
    if (dto.parent_node_id !== undefined) {
      const newParent = dto.parent_node_id ?? null;
      if (newParent === nodeId)
        throw new BadRequestException('A node cannot be its own parent');
      const all = await this.prisma.processNode.findMany({
        where: { organization_id: orgId, map_id: mapId, is_deleted: false },
        select: { id: true, parent_node_id: true },
      });
      const byId = new Map(all.map((n) => [n.id, n]));
      if (newParent) {
        if (!byId.has(newParent))
          throw new BadRequestException('Target location is not in this map');
        // Walk up from the destination — if we reach this node, the move is a cycle.
        let cur: string | null = newParent;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          if (cur === nodeId)
            throw new BadRequestException('Cannot move a node inside itself');
          seen.add(cur);
          cur = byId.get(cur)?.parent_node_id ?? null;
        }
        await this.access.assertCanEditNode(orgId, principal, newParent);
      } else {
        await this.access.assertCanEditMap(orgId, principal, mapId);
      }
      // Land the moved node in a free spot at the destination — below all existing
      // content there — so it never drops on top of the target's current diagram.
      const sibs = await this.prisma.processNode.findMany({
        where: {
          organization_id: orgId,
          map_id: mapId,
          parent_node_id: newParent,
          is_deleted: false,
          id: { not: nodeId },
        },
        select: { sort_order: true, position_y: true },
      });
      const nextY = sibs.length
        ? Math.max(...sibs.map((s) => s.position_y)) + 170
        : 60;
      const nextSort = sibs.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
      reparent = {
        parent_node_id: newParent,
        sort_order: nextSort,
        position_x: 60,
        position_y: nextY,
      };
      // Moving levels invalidates this node's connections (edges live at one level).
      await this.prisma.processConnection.deleteMany({
        where: {
          organization_id: orgId,
          map_id: mapId,
          OR: [{ source_node_id: nodeId }, { target_node_id: nodeId }],
        },
      });
    }

    // Swimlane re-assignment. Changing pool/department moves the node to that band/lane.
    // The lane IS the department (single source of truth) — no separate warning, it just moves.
    let laneUpdate: {
      pool: ProcessPool | null;
      department_id: string | null;
    } | null = null;
    if (dto.pool !== undefined || dto.department_id !== undefined) {
      const desiredPool =
        dto.pool !== undefined ? (dto.pool ?? null) : node.pool;
      const desiredDept =
        dto.department_id !== undefined
          ? (dto.department_id ?? null)
          : node.department_id;
      const resolved = await this.lanes.resolveLane(
        orgId,
        desiredPool,
        desiredDept,
      );
      laneUpdate = {
        pool: resolved.pool,
        department_id: resolved.departmentId,
      };
    }
    const finalParent = reparent
      ? reparent.parent_node_id
      : node.parent_node_id;
    const effPool = laneUpdate ? laneUpdate.pool : node.pool;
    const effDept = laneUpdate ? laneUpdate.department_id : node.department_id;
    // Ensure the target lane exists for the node's final level (covers dept change AND re-parent).
    if (effPool === ProcessPool.company && effDept) {
      await this.lanes.ensureAutoLane(
        orgId,
        principal.userId,
        mapId,
        finalParent,
        effDept,
      );
    }

    await this.prisma.processNode.update({
      where: { id: nodeId },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.responsible_role_id !== undefined
          ? { responsible_role_id: dto.responsible_role_id }
          : {}),
        ...(dto.responsible_user_id !== undefined
          ? { responsible_user_id: dto.responsible_user_id }
          : {}),
        ...(laneUpdate
          ? { pool: laneUpdate.pool, department_id: laneUpdate.department_id }
          : {}),
        ...(dto.position_x !== undefined ? { position_x: dto.position_x } : {}),
        ...(dto.position_y !== undefined ? { position_y: dto.position_y } : {}),
        // Any explicit position move (e.g. dragging onto another lane) places the node → freeze it.
        ...(dto.position_x !== undefined || dto.position_y !== undefined
          ? { layout_frozen: true }
          : {}),
        ...(dto.linked_map_id !== undefined
          ? { linked_map_id: dto.linked_map_id }
          : {}),
        ...(reparent ? reparent : {}),
      },
    });

    // If the node left an auto lane (dept changed, pool left Company, or it moved levels),
    // remove that lane when it's now empty. Manual lanes are kept.
    const levelChanged =
      !!reparent &&
      (reparent.parent_node_id ?? null) !== (node.parent_node_id ?? null);
    if (
      node.department_id &&
      (effDept !== node.department_id ||
        effPool !== ProcessPool.company ||
        levelChanged)
    ) {
      await this.lanes.cleanupAutoLane(
        orgId,
        mapId,
        node.parent_node_id,
        node.department_id,
      );
    }

    if (dto.checklist !== undefined) {
      await this.replaceChecklist(nodeId, dto.checklist);
    }

    // Keep a build-in-place area's child map named the same as its node. Ownership
    // signal: the linked map's parent is this node's map (it was built here). A
    // shared reference (linked to a map owned elsewhere) is left untouched.
    if (dto.name !== undefined && node.linked_map_id) {
      const linked = await this.prisma.processMap.findFirst({
        where: {
          id: node.linked_map_id,
          organization_id: orgId,
          is_deleted: false,
        },
        select: { id: true, parent_map_id: true },
      });
      if (linked && linked.parent_map_id === node.map_id) {
        await this.prisma.processMap.update({
          where: { id: linked.id },
          data: { name: dto.name.trim() },
        });
      }
    }

    return this.getNode(orgId, principal, mapId, nodeId);
  }

  private async replaceChecklist(
    nodeId: string,
    items: { id?: string; text: string }[],
  ) {
    await this.prisma.$transaction([
      this.prisma.processChecklistItem.deleteMany({
        where: { node_id: nodeId },
      }),
      this.prisma.processChecklistItem.createMany({
        data: items.map((it, idx) => ({
          id: it.id ?? randomUUID(),
          node_id: nodeId,
          text: it.text.trim(),
          sort_order: idx,
        })),
      }),
    ]);
  }

  async bulkPosition(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: BulkPositionDto,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const canEditWhole = await this.access.canEditMap(orgId, principal, mapId);
    const updates = [];
    for (const p of dto.positions) {
      const node = await this.prisma.processNode.findFirst({
        where: {
          id: p.id,
          map_id: mapId,
          organization_id: orgId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (!node) continue;
      if (
        !canEditWhole &&
        !(await this.access.canEditNode(orgId, principal, p.id))
      )
        continue;
      updates.push(
        this.prisma.processNode.update({
          where: { id: p.id },
          // Saving a position places the node — freeze it so the auto-layout never moves it again.
          data: {
            position_x: p.position_x,
            position_y: p.position_y,
            layout_frozen: true,
          },
        }),
      );
    }
    if (updates.length) await this.prisma.$transaction(updates);
    return { updated: updates.length };
  }

  async deleteNode(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);

    // Collect the node + all descendants (soft-delete the subtree).
    const all = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      select: {
        id: true,
        parent_node_id: true,
        pool: true,
        department_id: true,
      },
    });
    const nodeById = new Map(all.map((n) => [n.id, n]));
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parent_node_id) continue;
      (
        childrenOf.get(n.parent_node_id) ??
        childrenOf.set(n.parent_node_id, []).get(n.parent_node_id)!
      ).push(n.id);
    }
    const doomed: string[] = [];
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop()!;
      doomed.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }

    await this.prisma.$transaction([
      this.prisma.processConnection.deleteMany({
        where: {
          organization_id: orgId,
          map_id: mapId,
          OR: [
            { source_node_id: { in: doomed } },
            { target_node_id: { in: doomed } },
            { parent_node_id: { in: doomed } },
          ],
        },
      }),
      this.prisma.processNode.updateMany({
        where: { id: { in: doomed } },
        data: { is_deleted: true, deleted_at: new Date() },
      }),
    ]);

    // Removing the last step from an AUTO lane should take the (now empty) lane with it — otherwise
    // an empty band lingers on the map. Collect each deleted Company node's (level, department) and
    // prune any auto lane that's now empty. Manual lanes are left alone (kept on purpose).
    const lanePairs = new Map<
      string,
      { parent: string | null; dept: string }
    >();
    for (const id of doomed) {
      const n = nodeById.get(id);
      if (n?.pool === ProcessPool.company && n.department_id) {
        lanePairs.set(`${n.parent_node_id ?? 'root'}:${n.department_id}`, {
          parent: n.parent_node_id,
          dept: n.department_id,
        });
      }
    }
    for (const { parent, dept } of lanePairs.values()) {
      await this.lanes.cleanupAutoLane(orgId, mapId, parent, dept);
    }
    return { deleted: doomed.length };
  }
}
