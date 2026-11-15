import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProcessAccessKind,
  ProcessNodeKind,
  ProcessPool,
  ProcessLaneOrigin,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { CreateMapDto, UpdateMapDto } from './dto/map.dto';
import { requireProcessNode } from './process-helpers';
import { swallow } from '../common/swallow';

@Injectable()
export class ProcessMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
  ) {}

  // ─── Maps ──────────────────────────────────────────────────────────────────────

  async listMaps(orgId: string, principal: Principal) {
    const maps = await this.prisma.processMap.findMany({
      where: { organization_id: orgId, is_deleted: false },
      orderBy: { updated_at: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        parent_map_id: true,
        is_pinned: true,
        created_by_user_id: true,
        created_at: true,
        updated_at: true,
        // Sticky notes aren't steps, so they don't count toward a map's node count.
        _count: {
          select: { nodes: { where: { kind: { not: ProcessNodeKind.note } } } },
        },
      },
    });
    const visible = await this.access.visibleMapIds(orgId, principal, maps);
    return maps
      .filter((m) => visible.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        parent_map_id: m.parent_map_id,
        is_pinned: m.is_pinned,
        node_count: m._count.nodes,
        is_owner: m.created_by_user_id === principal.userId,
        can_edit:
          principal.isAdmin || m.created_by_user_id === principal.userId,
        created_at: m.created_at,
        updated_at: m.updated_at,
      }));
  }

  async createMap(orgId: string, userId: string, dto: CreateMapDto) {
    if (dto.parent_map_id) {
      const parent = await this.prisma.processMap.findFirst({
        where: {
          id: dto.parent_map_id,
          organization_id: orgId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('Parent map not found');
    }
    return this.prisma.processMap.create({
      data: {
        organization_id: orgId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        parent_map_id: dto.parent_map_id ?? null,
        created_by_user_id: userId,
      },
    });
  }

  async getMap(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId, organization_id: orgId, is_deleted: false },
      select: {
        id: true,
        name: true,
        chart_type: true,
        description: true,
        created_by_user_id: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!map) throw new NotFoundException('Process map not found');
    return {
      ...map,
      is_owner: map.created_by_user_id === principal.userId,
      can_edit: await this.access.canEditMap(orgId, principal, mapId),
    };
  }

  async updateMap(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: UpdateMapDto,
  ) {
    await this.access.assertCanEditMap(orgId, principal, mapId);

    // Move in the tree: validate destination is in-org and not a cycle (can't put a
    // map under itself or one of its own descendants).
    if (dto.parent_map_id !== undefined && dto.parent_map_id !== null) {
      if (dto.parent_map_id === mapId)
        throw new BadRequestException('A map cannot be its own parent');
      const all = await this.prisma.processMap.findMany({
        where: { organization_id: orgId, is_deleted: false },
        select: { id: true, parent_map_id: true },
      });
      const byId = new Map(all.map((m) => [m.id, m]));
      if (!byId.has(dto.parent_map_id))
        throw new BadRequestException('Parent map not found');
      let cur: string | null = dto.parent_map_id;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === mapId)
          throw new BadRequestException('Cannot move a map inside itself');
        seen.add(cur);
        cur = byId.get(cur)?.parent_map_id ?? null;
      }
    }

    return this.prisma.processMap.update({
      where: { id: mapId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.parent_map_id !== undefined
          ? { parent_map_id: dto.parent_map_id }
          : {}),
        ...(dto.is_pinned !== undefined ? { is_pinned: dto.is_pinned } : {}),
      },
    });
  }

  async deleteMap(orgId: string, principal: Principal, mapId: string) {
    // Route already gates the `delete` action (admin). Confirm existence in-org.
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId, organization_id: orgId, is_deleted: false },
      select: { id: true },
    });
    if (!map) throw new NotFoundException('Process map not found');
    await this.prisma.processMap.update({
      where: { id: mapId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by_user_id: principal.userId,
      },
    });
    return { success: true };
  }

  // ─── Flow (one drill level at a time) ───────────────────────────────────────────

  async getFlow(
    orgId: string,
    principal: Principal,
    mapId: string,
    parentNodeId?: string | null,
  ) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const parent = parentNodeId
      ? await requireProcessNode(this.prisma, orgId, mapId, parentNodeId)
      : null;
    if (parent)
      await this.access.assertCanViewNode(orgId, principal, parentNodeId!);

    const nodes = await this.prisma.processNode.findMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        is_deleted: false,
        parent_node_id: parentNodeId ?? null,
      },
      orderBy: { sort_order: 'asc' },
    });

    // Hide nodes explicitly excluded from this user (view cascades from the parent,
    // so the only new restriction at this level is an exclude_user on the child).
    let visibleNodes = nodes;
    if (!principal.isAdmin) {
      const owner = await this.prisma.processMap.findFirst({
        where: { id: mapId },
        select: { created_by_user_id: true },
      });
      if (owner?.created_by_user_id !== principal.userId && nodes.length) {
        const excluded = await this.prisma.processNodeAccess.findMany({
          where: {
            organization_id: orgId,
            node_id: { in: nodes.map((n) => n.id) },
            kind: ProcessAccessKind.exclude_user,
            user_id: principal.userId,
          },
          select: { node_id: true },
        });
        const hidden = new Set(excluded.map((e) => e.node_id));
        visibleNodes = nodes.filter((n) => !hidden.has(n.id));
      }
    }

    const nodeIds = visibleNodes.map((n) => n.id);
    const connections = await this.prisma.processConnection.findMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
        source_node_id: { in: nodeIds },
        target_node_id: { in: nodeIds },
      },
    });

    // Child counts so the canvas knows which nodes are drillable.
    const childCounts = await this.prisma.processNode.groupBy({
      by: ['parent_node_id'],
      where: {
        organization_id: orgId,
        map_id: mapId,
        is_deleted: false,
        kind: { not: ProcessNodeKind.note },
        parent_node_id: { in: nodeIds },
      },
      _count: { _all: true },
    });
    const childCountBy = new Map(
      childCounts.map((c) => [c.parent_node_id, c._count._all]),
    );

    const canEdit = parent
      ? await this.access.canEditNode(orgId, principal, parentNodeId!)
      : await this.access.canEditMap(orgId, principal, mapId);

    // Per-node artifact links (id + name) so the canvas can render the document that
    // flows across a connection (output of source ∩ input of target).
    const links = nodeIds.length
      ? await this.prisma.processNodeArtifact.findMany({
          where: { node_id: { in: nodeIds } },
          select: {
            node_id: true,
            direction: true,
            artifact: { select: { id: true, name: true, content_type: true } },
          },
        })
      : [];
    const linksByNode = new Map<
      string,
      {
        input: { id: string; name: string }[];
        output: { id: string; name: string }[];
      }
    >();
    for (const l of links) {
      const entry = linksByNode.get(l.node_id) ?? { input: [], output: [] };
      entry[l.direction].push({ id: l.artifact.id, name: l.artifact.name });
      linksByNode.set(l.node_id, entry);
    }

    // Checklist items per node, so a task can show/expand its checklist on the canvas.
    const checklistItems = nodeIds.length
      ? await this.prisma.processChecklistItem.findMany({
          where: { node_id: { in: nodeIds } },
          select: { id: true, node_id: true, text: true },
          orderBy: { sort_order: 'asc' },
        })
      : [];
    const checklistByNode = new Map<string, { id: string; text: string }[]>();
    for (const c of checklistItems) {
      const list = checklistByNode.get(c.node_id) ?? [];
      list.push({ id: c.id, text: c.text });
      checklistByNode.set(c.node_id, list);
    }

    // Names of cross-linked maps referenced at this level (for the link badge).
    const linkedIds = Array.from(
      new Set(
        visibleNodes
          .map((n) => n.linked_map_id)
          .filter((x): x is string => !!x),
      ),
    );
    const linkedMaps = linkedIds.length
      ? await this.prisma.processMap.findMany({
          where: {
            id: { in: linkedIds },
            organization_id: orgId,
            is_deleted: false,
          },
          select: { id: true, name: true },
        })
      : [];
    const linkedNameById = new Map(linkedMaps.map((m) => [m.id, m.name]));

    // Swimlanes for THIS level (Company-pool department bands), ordered top→bottom.
    const laneRowsAll = await this.prisma.processLane.findMany({
      where: {
        organization_id: orgId,
        map_id: mapId,
        parent_node_id: parentNodeId ?? null,
      },
      orderBy: { sort_order: 'asc' },
    });
    // An AUTO lane only exists to hold a node; once its last step is gone it should disappear (an
    // empty band shouldn't linger). Prune empty auto lanes lazily here; manual lanes are kept even
    // when empty (created on purpose). Best-effort delete so a read never fails on it.
    const occupiedDepts = new Set(
      nodes
        .filter((n) => n.pool === ProcessPool.company && n.department_id)
        .map((n) => n.department_id),
    );
    const emptyAutoLaneIds = laneRowsAll
      .filter(
        (l) =>
          l.origin === ProcessLaneOrigin.auto &&
          !occupiedDepts.has(l.department_id),
      )
      .map((l) => l.id);
    if (emptyAutoLaneIds.length) {
      this.prisma.processLane
        .deleteMany({ where: { id: { in: emptyAutoLaneIds } } })
        .catch(swallow('process-hierarchy.getFlow'));
    }
    const laneRows = laneRowsAll.filter(
      (l) => !emptyAutoLaneIds.includes(l.id),
    );
    const laneDeptIds = Array.from(
      new Set(laneRows.map((l) => l.department_id)),
    );
    const deptRows = laneDeptIds.length
      ? await this.prisma.department.findMany({
          where: { id: { in: laneDeptIds }, organization_id: orgId },
          select: { id: true, name: true },
        })
      : [];
    const deptNameById = new Map(deptRows.map((d) => [d.id, d.name]));
    const lanes = laneRows.map((l) => ({
      id: l.id,
      department_id: l.department_id,
      department_name: deptNameById.get(l.department_id) ?? 'Department',
      origin: l.origin,
      sort_order: l.sort_order,
    }));

    // Stored pool order for THIS level (customer/company/vendor top→bottom); null → default order.
    const poolOrderRow = await this.prisma.processMap.findFirst({
      where: { id: mapId },
      select: { pool_order: true },
    });
    const poolOrderAll =
      poolOrderRow?.pool_order &&
      typeof poolOrderRow.pool_order === 'object' &&
      !Array.isArray(poolOrderRow.pool_order)
        ? (poolOrderRow.pool_order as Record<string, unknown>)
        : {};
    const poolOrderLevel = poolOrderAll[parentNodeId ?? 'root'];
    const pool_order: string[] | null = Array.isArray(poolOrderLevel)
      ? (poolOrderLevel as string[])
      : null;

    // Renderer family for THIS level: the container's chart_type, or the map's at the root.
    const levelChartType = parent
      ? ((parent as { chart_type?: string }).chart_type ?? 'swimlane')
      : ((
          await this.prisma.processMap.findFirst({
            where: { id: mapId },
            select: { chart_type: true },
          })
        )?.chart_type ?? 'swimlane');

    return {
      map_id: mapId,
      parent_node_id: parentNodeId ?? null,
      chart_type: levelChartType,
      breadcrumb: await this.breadcrumb(orgId, mapId, parentNodeId ?? null),
      can_edit: canEdit,
      nodes: visibleNodes.map((n) => ({
        ...n,
        child_count: childCountBy.get(n.id) ?? 0,
        linked_map_name: n.linked_map_id
          ? (linkedNameById.get(n.linked_map_id) ?? null)
          : null,
        inputs: linksByNode.get(n.id)?.input ?? [],
        outputs: linksByNode.get(n.id)?.output ?? [],
        checklist: checklistByNode.get(n.id) ?? [],
      })),
      connections,
      lanes,
      pool_order,
    };
  }

  /**
   * Flat list of every node in the map — powers the outline tree and search on the
   * client (which builds the hierarchy from parent_node_id). Applies the same
   * exclude-user visibility as getFlow, and additionally hides the descendants of
   * any excluded node so a hidden branch never leaks names through the tree.
   */
  async getTree(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const nodes = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      orderBy: [{ sort_order: 'asc' }],
      select: {
        id: true,
        parent_node_id: true,
        kind: true,
        name: true,
        status: true,
        sort_order: true,
        linked_map_id: true,
      },
    });

    let visible = nodes;
    if (!principal.isAdmin && nodes.length) {
      const owner = await this.prisma.processMap.findFirst({
        where: { id: mapId },
        select: { created_by_user_id: true },
      });
      if (owner?.created_by_user_id !== principal.userId) {
        const excluded = await this.prisma.processNodeAccess.findMany({
          where: {
            organization_id: orgId,
            node_id: { in: nodes.map((n) => n.id) },
            kind: ProcessAccessKind.exclude_user,
            user_id: principal.userId,
          },
          select: { node_id: true },
        });
        if (excluded.length) {
          const childrenBy = new Map<string | null, string[]>();
          for (const n of nodes) {
            const list = childrenBy.get(n.parent_node_id) ?? [];
            list.push(n.id);
            childrenBy.set(n.parent_node_id, list);
          }
          const hidden = new Set<string>();
          const stack = excluded.map((e) => e.node_id);
          while (stack.length) {
            const id = stack.pop()!;
            if (hidden.has(id)) continue;
            hidden.add(id);
            for (const c of childrenBy.get(id) ?? []) stack.push(c);
          }
          visible = nodes.filter((n) => !hidden.has(n.id));
        }
      }
    }

    // Names of cross-linked maps (so the tree can show a link badge).
    const linkedIds = Array.from(
      new Set(
        visible.map((n) => n.linked_map_id).filter((x): x is string => !!x),
      ),
    );
    const linkedMaps = linkedIds.length
      ? await this.prisma.processMap.findMany({
          where: {
            id: { in: linkedIds },
            organization_id: orgId,
            is_deleted: false,
          },
          select: { id: true, name: true },
        })
      : [];
    const linkedNameById = new Map(linkedMaps.map((m) => [m.id, m.name]));

    return {
      map_id: mapId,
      can_edit: await this.access.canEditMap(orgId, principal, mapId),
      nodes: visible.map((n) => ({
        ...n,
        linked_map_name: n.linked_map_id
          ? (linkedNameById.get(n.linked_map_id) ?? null)
          : null,
      })),
    };
  }

  private async breadcrumb(
    orgId: string,
    mapId: string,
    parentNodeId: string | null,
  ) {
    const crumbs: { id: string | null; name: string }[] = [];
    if (parentNodeId) {
      const all = await this.prisma.processNode.findMany({
        where: { organization_id: orgId, map_id: mapId },
        select: { id: true, name: true, parent_node_id: true },
      });
      const byId = new Map(all.map((n) => [n.id, n]));
      let cur: string | null = parentNodeId;
      const seen = new Set<string>();
      const chain: { id: string; name: string }[] = [];
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const n = byId.get(cur);
        if (!n) break;
        chain.unshift({ id: n.id, name: n.name });
        cur = n.parent_node_id;
      }
      crumbs.push(...chain);
    }
    return crumbs; // root (the map itself) is rendered by the frontend
  }
}
