import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProcessAccessKind, ProcessAccessLevel, ProcessNodeKind, ProcessNodeStatus, ProcessPool, ProcessLaneOrigin } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { computeMapDiff, type MapDiff } from './process-diff';
import {
  UploadedFile,
  validateAttachmentFile,
  extensionOf,
} from '../tasks/task-attachments.service';
import { CreateMapDto, UpdateMapDto } from './dto/map.dto';
import { BulkPositionDto, CreateNodeDto, PasteNodesDto, UpdateNodeDto } from './dto/node.dto';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto';
import { CreateLaneDto } from './dto/lane.dto';
import { CreateArtifactDto, CreateMaterialDto, LinkArtifactDto, UpdateArtifactDto } from './dto/artifact.dto';
import { AddAccessRuleDto } from './dto/access.dto';
import { CreateSnapshotDto } from './dto/snapshot.dto';

/** Order nodes so every node appears after its parent — used before a bulk createMany so the
 *  parent_node_id self-FK can never reference a not-yet-inserted row when the batch is split.
 *  Nodes with a null/absent parent come first; a (defensive) cycle just gets appended as-is. */
function orderNodesParentFirst(rows: any[]): any[] {
  const present = new Set(rows.map((r) => r.id));
  const emitted = new Set<string>();
  const out: any[] = [];
  let progressed = true;
  while (out.length < rows.length && progressed) {
    progressed = false;
    for (const r of rows) {
      if (emitted.has(r.id)) continue;
      const p = r.parent_node_id;
      if (!p || !present.has(p) || emitted.has(p)) {
        out.push(r);
        emitted.add(r.id);
        progressed = true;
      }
    }
  }
  if (out.length < rows.length) for (const r of rows) if (!emitted.has(r.id)) out.push(r);
  return out;
}

@Injectable()
export class ProcessHierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly r2: R2Service,
    private readonly notifications: NotificationsService,
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
        _count: { select: { nodes: { where: { kind: { not: ProcessNodeKind.note } } } } },
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
        can_edit: principal.isAdmin || m.created_by_user_id === principal.userId,
        created_at: m.created_at,
        updated_at: m.updated_at,
      }));
  }

  async createMap(orgId: string, userId: string, dto: CreateMapDto) {
    if (dto.parent_map_id) {
      const parent = await this.prisma.processMap.findFirst({
        where: { id: dto.parent_map_id, organization_id: orgId, is_deleted: false },
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

  async updateMap(orgId: string, principal: Principal, mapId: string, dto: UpdateMapDto) {
    await this.access.assertCanEditMap(orgId, principal, mapId);

    // Move in the tree: validate destination is in-org and not a cycle (can't put a
    // map under itself or one of its own descendants).
    if (dto.parent_map_id !== undefined && dto.parent_map_id !== null) {
      if (dto.parent_map_id === mapId) throw new BadRequestException('A map cannot be its own parent');
      const all = await this.prisma.processMap.findMany({
        where: { organization_id: orgId, is_deleted: false },
        select: { id: true, parent_map_id: true },
      });
      const byId = new Map(all.map((m) => [m.id, m]));
      if (!byId.has(dto.parent_map_id)) throw new BadRequestException('Parent map not found');
      let cur: string | null = dto.parent_map_id;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === mapId) throw new BadRequestException('Cannot move a map inside itself');
        seen.add(cur);
        cur = byId.get(cur)?.parent_map_id ?? null;
      }
    }

    return this.prisma.processMap.update({
      where: { id: mapId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.parent_map_id !== undefined ? { parent_map_id: dto.parent_map_id } : {}),
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
      data: { is_deleted: true, deleted_at: new Date(), deleted_by_user_id: principal.userId },
    });
    return { success: true };
  }

  // ─── Flow (one drill level at a time) ───────────────────────────────────────────

  async getFlow(orgId: string, principal: Principal, mapId: string, parentNodeId?: string | null) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const parent = parentNodeId
      ? await this.requireNode(orgId, mapId, parentNodeId)
      : null;
    if (parent) await this.access.assertCanViewNode(orgId, principal, parentNodeId!);

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
      where: { organization_id: orgId, map_id: mapId, is_deleted: false, kind: { not: ProcessNodeKind.note }, parent_node_id: { in: nodeIds } },
      _count: { _all: true },
    });
    const childCountBy = new Map(childCounts.map((c) => [c.parent_node_id, c._count._all]));

    const canEdit = parent
      ? await this.access.canEditNode(orgId, principal, parentNodeId!)
      : await this.access.canEditMap(orgId, principal, mapId);

    // Per-node artifact links (id + name) so the canvas can render the document that
    // flows across a connection (output of source ∩ input of target).
    const links = nodeIds.length
      ? await this.prisma.processNodeArtifact.findMany({
          where: { node_id: { in: nodeIds } },
          select: { node_id: true, direction: true, artifact: { select: { id: true, name: true, content_type: true } } },
        })
      : [];
    const linksByNode = new Map<string, { input: { id: string; name: string }[]; output: { id: string; name: string }[] }>();
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
    const linkedIds = Array.from(new Set(visibleNodes.map((n) => n.linked_map_id).filter((x): x is string => !!x)));
    const linkedMaps = linkedIds.length
      ? await this.prisma.processMap.findMany({
          where: { id: { in: linkedIds }, organization_id: orgId, is_deleted: false },
          select: { id: true, name: true },
        })
      : [];
    const linkedNameById = new Map(linkedMaps.map((m) => [m.id, m.name]));

    // Swimlanes for THIS level (Company-pool department bands), ordered top→bottom.
    const laneRowsAll = await this.prisma.processLane.findMany({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null },
      orderBy: { sort_order: 'asc' },
    });
    // An AUTO lane only exists to hold a node; once its last step is gone it should disappear (an
    // empty band shouldn't linger). Prune empty auto lanes lazily here; manual lanes are kept even
    // when empty (created on purpose). Best-effort delete so a read never fails on it.
    const occupiedDepts = new Set(
      nodes.filter((n) => n.pool === ProcessPool.company && n.department_id).map((n) => n.department_id),
    );
    const emptyAutoLaneIds = laneRowsAll
      .filter((l) => l.origin === ProcessLaneOrigin.auto && !occupiedDepts.has(l.department_id))
      .map((l) => l.id);
    if (emptyAutoLaneIds.length) {
      this.prisma.processLane.deleteMany({ where: { id: { in: emptyAutoLaneIds } } }).catch(() => {});
    }
    const laneRows = laneRowsAll.filter((l) => !emptyAutoLaneIds.includes(l.id));
    const laneDeptIds = Array.from(new Set(laneRows.map((l) => l.department_id)));
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
    const poolOrderRow = await this.prisma.processMap.findFirst({ where: { id: mapId }, select: { pool_order: true } });
    const poolOrderAll =
      poolOrderRow?.pool_order && typeof poolOrderRow.pool_order === 'object' && !Array.isArray(poolOrderRow.pool_order)
        ? (poolOrderRow.pool_order as Record<string, unknown>)
        : {};
    const poolOrderLevel = poolOrderAll[parentNodeId ?? 'root'];
    const pool_order: string[] | null = Array.isArray(poolOrderLevel) ? (poolOrderLevel as string[]) : null;

    // Renderer family for THIS level: the container's chart_type, or the map's at the root.
    const levelChartType = parent
      ? ((parent as { chart_type?: string }).chart_type ?? 'swimlane')
      : ((await this.prisma.processMap.findFirst({ where: { id: mapId }, select: { chart_type: true } }))?.chart_type ?? 'swimlane');

    return {
      map_id: mapId,
      parent_node_id: parentNodeId ?? null,
      chart_type: levelChartType,
      breadcrumb: await this.breadcrumb(orgId, mapId, parentNodeId ?? null),
      can_edit: canEdit,
      nodes: visibleNodes.map((n) => ({
        ...n,
        child_count: childCountBy.get(n.id) ?? 0,
        linked_map_name: n.linked_map_id ? linkedNameById.get(n.linked_map_id) ?? null : null,
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
      new Set(visible.map((n) => n.linked_map_id).filter((x): x is string => !!x)),
    );
    const linkedMaps = linkedIds.length
      ? await this.prisma.processMap.findMany({
          where: { id: { in: linkedIds }, organization_id: orgId, is_deleted: false },
          select: { id: true, name: true },
        })
      : [];
    const linkedNameById = new Map(linkedMaps.map((m) => [m.id, m.name]));

    return {
      map_id: mapId,
      can_edit: await this.access.canEditMap(orgId, principal, mapId),
      nodes: visible.map((n) => ({
        ...n,
        linked_map_name: n.linked_map_id ? linkedNameById.get(n.linked_map_id) ?? null : null,
      })),
    };
  }

  private async breadcrumb(orgId: string, mapId: string, parentNodeId: string | null) {
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

  // ─── Nodes ──────────────────────────────────────────────────────────────────────

  private async requireNode(orgId: string, mapId: string, nodeId: string) {
    const node = await this.prisma.processNode.findFirst({
      where: { id: nodeId, map_id: mapId, organization_id: orgId, is_deleted: false },
    });
    if (!node) throw new NotFoundException('Process node not found');
    return node;
  }

  async createNode(orgId: string, principal: Principal, mapId: string, dto: CreateNodeDto) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    if (dto.parent_node_id) {
      await this.requireNode(orgId, mapId, dto.parent_node_id);
      await this.access.assertCanEditNode(orgId, principal, dto.parent_node_id);
    } else {
      await this.access.assertCanEditMap(orgId, principal, mapId);
    }
    const maxSort = await this.prisma.processNode.aggregate({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: dto.parent_node_id ?? null, is_deleted: false },
      _max: { sort_order: true },
    });

    // Composition. Either reference an existing map, or (build-in-place) create a fresh
    // child map for a container/sub-process so the area is instantly its own map.
    const isArea = dto.kind === ProcessNodeKind.container || dto.kind === ProcessNodeKind.subprocess;
    let linkedMapId: string | null = null;
    if (dto.linked_map_id) {
      if (dto.linked_map_id === mapId) throw new BadRequestException('A node cannot reference its own map');
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
    const { pool, departmentId } = await this.resolveLane(orgId, dto.pool ?? null, dto.department_id ?? null);
    if (pool === ProcessPool.company && departmentId) {
      await this.ensureAutoLane(orgId, principal.userId, mapId, dto.parent_node_id ?? null, departmentId);
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

  // ─── Swimlane helpers ───────────────────────────────────────────────────────────

  // Validate a pool/department pair: a Company node MUST have a real department; a
  // Customer/Vendor (or unset) node never carries one.
  private async resolveLane(
    orgId: string,
    pool: ProcessPool | null,
    departmentId: string | null,
  ): Promise<{ pool: ProcessPool | null; departmentId: string | null }> {
    if (pool === ProcessPool.company) {
      if (!departmentId) throw new BadRequestException('A step in the Company pool needs a department (lane).');
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
  private async ensureAutoLane(orgId: string, userId: string, mapId: string, parentNodeId: string | null, departmentId: string) {
    const existing = await this.prisma.processLane.findFirst({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null, department_id: departmentId },
      select: { id: true },
    });
    if (existing) return;
    const max = await this.prisma.processLane.aggregate({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null },
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
  private async cleanupAutoLane(orgId: string, mapId: string, parentNodeId: string | null, departmentId: string) {
    const lane = await this.prisma.processLane.findFirst({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null, department_id: departmentId },
      select: { id: true },
    });
    if (!lane) return;
    const count = await this.prisma.processNode.count({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null, department_id: departmentId, is_deleted: false },
    });
    if (count === 0) await this.prisma.processLane.delete({ where: { id: lane.id } });
  }

  // Create an empty lane by hand (origin = manual, so it persists even while empty). If a
  // lane for that department already exists at this level, promote it to manual and reuse it.
  async createLane(orgId: string, principal: Principal, mapId: string, dto: CreateLaneDto) {
    const parentId = dto.parent_node_id ?? null;
    if (parentId) {
      await this.requireNode(orgId, mapId, parentId);
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
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentId, department_id: dto.department_id },
    });
    if (existing) {
      if (existing.origin === ProcessLaneOrigin.auto) {
        return this.prisma.processLane.update({ where: { id: existing.id }, data: { origin: ProcessLaneOrigin.manual } });
      }
      return existing;
    }
    const max = await this.prisma.processLane.aggregate({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentId },
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
  async deleteLane(orgId: string, principal: Principal, mapId: string, laneId: string, moveToDepartmentId?: string) {
    const lane = await this.prisma.processLane.findFirst({
      where: { id: laneId, map_id: mapId, organization_id: orgId },
    });
    if (!lane) throw new NotFoundException('Lane not found');
    if (lane.parent_node_id) await this.access.assertCanEditNode(orgId, principal, lane.parent_node_id);
    else await this.access.assertCanEditMap(orgId, principal, mapId);

    const nodesInLane = await this.prisma.processNode.count({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: lane.parent_node_id, department_id: lane.department_id, is_deleted: false },
    });
    if (nodesInLane > 0) {
      if (!moveToDepartmentId) throw new BadRequestException('This lane has steps — choose a lane to move them to first.');
      if (moveToDepartmentId === lane.department_id) throw new BadRequestException('Choose a different lane to move the steps into.');
      const dest = await this.prisma.processLane.findFirst({
        where: { organization_id: orgId, map_id: mapId, parent_node_id: lane.parent_node_id, department_id: moveToDepartmentId },
        select: { id: true },
      });
      if (!dest) throw new BadRequestException('Destination lane not found');
      await this.prisma.processNode.updateMany({
        where: { organization_id: orgId, map_id: mapId, parent_node_id: lane.parent_node_id, department_id: lane.department_id, is_deleted: false },
        data: { department_id: moveToDepartmentId },
      });
    }
    await this.prisma.processLane.delete({ where: { id: lane.id } });
    return { success: true };
  }

  // Re-point a lane at a DIFFERENT department (rename the lane) — every step in the lane moves to
  // the new department with it. If a lane for the new department already exists at this level, the
  // steps merge into it and this lane is removed; otherwise this lane is simply retargeted.
  async reassignLane(orgId: string, principal: Principal, mapId: string, laneId: string, newDepartmentId: string) {
    const lane = await this.prisma.processLane.findFirst({
      where: { id: laneId, map_id: mapId, organization_id: orgId },
    });
    if (!lane) throw new NotFoundException('Lane not found');
    if (lane.parent_node_id) await this.access.assertCanEditNode(orgId, principal, lane.parent_node_id);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    if (newDepartmentId === lane.department_id) return { updated: 0 };

    const dept = await this.prisma.department.findFirst({
      where: { id: newDepartmentId, organization_id: orgId },
      select: { id: true },
    });
    if (!dept) throw new BadRequestException('Department not found');

    // Move every step in the lane to the new department.
    const moved = await this.prisma.processNode.updateMany({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: lane.parent_node_id, department_id: lane.department_id, pool: ProcessPool.company, is_deleted: false },
      data: { department_id: newDepartmentId },
    });

    const existingDest = await this.prisma.processLane.findFirst({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: lane.parent_node_id, department_id: newDepartmentId },
      select: { id: true, origin: true },
    });
    if (existingDest) {
      // Merge into the existing lane (keep it manual if either side was), drop this one.
      if (lane.origin === ProcessLaneOrigin.manual && existingDest.origin === ProcessLaneOrigin.auto) {
        await this.prisma.processLane.update({ where: { id: existingDest.id }, data: { origin: ProcessLaneOrigin.manual } });
      }
      await this.prisma.processLane.delete({ where: { id: lane.id } });
    } else {
      await this.prisma.processLane.update({ where: { id: lane.id }, data: { department_id: newDepartmentId } });
    }
    return { updated: moved.count };
  }

  // Set the top→bottom order of the department lanes at a level. Steps ride along with their lane
  // (they're positioned lane-relative), so this only changes the visual arrangement — nothing moves
  // between lanes and nothing is deleted. Ids not belonging to this level are ignored; any lane the
  // client omitted is appended so no lane loses its place.
  async reorderLanes(orgId: string, principal: Principal, mapId: string, parentNodeId: string | null, laneIds: string[]) {
    if (parentNodeId) await this.access.assertCanEditNode(orgId, principal, parentNodeId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    const lanes = await this.prisma.processLane.findMany({
      where: { organization_id: orgId, map_id: mapId, parent_node_id: parentNodeId ?? null },
      select: { id: true },
    });
    const known = new Set(lanes.map((l) => l.id));
    const seen = new Set<string>();
    const ordered = laneIds.filter((id) => known.has(id) && !seen.has(id) && (seen.add(id), true));
    for (const l of lanes) if (!seen.has(l.id)) ordered.push(l.id);
    await this.prisma.$transaction(
      ordered.map((id, i) => this.prisma.processLane.update({ where: { id }, data: { sort_order: i } })),
    );
    return { success: true };
  }

  // Set the top→bottom order of the pools (customer/company/vendor) at a level. Stored per level on
  // the map's pool_order JSON (keyed by parent_node_id or "root"); an unset level falls back to the
  // default customer→company→vendor. Purely visual — no step or lane changes.
  async setPoolOrder(orgId: string, principal: Principal, mapId: string, parentNodeId: string | null, pools: ProcessPool[]) {
    if (parentNodeId) await this.access.assertCanEditNode(orgId, principal, parentNodeId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId, organization_id: orgId, is_deleted: false },
      select: { pool_order: true },
    });
    if (!map) throw new NotFoundException('Map not found');
    const levelKey = parentNodeId ?? 'root';
    const current: Record<string, unknown> =
      map.pool_order && typeof map.pool_order === 'object' && !Array.isArray(map.pool_order)
        ? { ...(map.pool_order as Record<string, unknown>) }
        : {};
    const valid = pools.filter((p, i) => Object.values(ProcessPool).includes(p) && pools.indexOf(p) === i);
    current[levelKey] = valid;
    await this.prisma.processMap.update({ where: { id: mapId }, data: { pool_order: current as Prisma.InputJsonValue } });
    return { success: true };
  }

  async getNode(orgId: string, principal: Principal, mapId: string, nodeId: string) {
    await this.access.assertCanViewNode(orgId, principal, nodeId);
    const node = await this.requireNode(orgId, mapId, nodeId);
    const [checklist, artifactLinks, accessRules, childCount] = await Promise.all([
      this.prisma.processChecklistItem.findMany({ where: { node_id: nodeId }, orderBy: { sort_order: 'asc' } }),
      this.prisma.processNodeArtifact.findMany({
        where: { node_id: nodeId },
        include: { artifact: true },
      }),
      this.prisma.processNodeAccess.findMany({ where: { organization_id: orgId, node_id: nodeId } }),
      this.prisma.processNode.count({ where: { organization_id: orgId, map_id: mapId, parent_node_id: nodeId, is_deleted: false, kind: { not: ProcessNodeKind.note } } }),
    ]);

    const [responsibleUser, responsibleRole] = await Promise.all([
      node.responsible_user_id
        ? this.prisma.user.findUnique({ where: { id: node.responsible_user_id }, select: { id: true, name: true } })
        : Promise.resolve(null),
      node.responsible_role_id
        ? this.prisma.role.findUnique({ where: { id: node.responsible_role_id }, select: { id: true, title: true } })
        : Promise.resolve(null),
    ]);

    const linkedMapRow = node.linked_map_id
      ? await this.prisma.processMap.findFirst({
          where: { id: node.linked_map_id, organization_id: orgId, is_deleted: false },
          select: { id: true, name: true, parent_map_id: true },
        })
      : null;
    // "owned" = built in place here (a single-use child), so detach doesn't apply.
    // "shared" = references a map owned elsewhere, where detach makes a local variant.
    const linkedMap = linkedMapRow
      ? { id: linkedMapRow.id, name: linkedMapRow.name, owned: linkedMapRow.parent_map_id === node.map_id }
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
      access_rules: await this.enrichAccessRules(orgId, accessRules),
    };
  }

  async updateNode(orgId: string, principal: Principal, mapId: string, nodeId: string, dto: UpdateNodeDto) {
    const node = await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);

    // Change node type — only the safe conversions. Start/End are structural markers
    // and never convert; an "area" (container/sub-process) may only become a step
    // once it's empty, so its contents are never stranded.
    if (dto.kind !== undefined && dto.kind !== node.kind) {
      const AREA: ProcessNodeKind[] = [ProcessNodeKind.container, ProcessNodeKind.subprocess];
      const STEP: ProcessNodeKind[] = [ProcessNodeKind.task, ProcessNodeKind.decision];
      const isEvent = (k: ProcessNodeKind) => k === ProcessNodeKind.start_event || k === ProcessNodeKind.end_event;
      if (isEvent(node.kind) || isEvent(dto.kind)) {
        throw new BadRequestException('Start and End markers cannot change type');
      }
      if (AREA.includes(node.kind) && STEP.includes(dto.kind)) {
        const children = await this.prisma.processNode.count({
          where: { organization_id: orgId, map_id: mapId, parent_node_id: nodeId, is_deleted: false },
        });
        if (children > 0) {
          throw new BadRequestException('This area has steps inside it — move or remove them before turning it into a single step');
        }
      }
    }

    // Cross-map link: only to a map the actor can see, never to this same map.
    if (dto.linked_map_id) {
      if (dto.linked_map_id === mapId) throw new BadRequestException('A node cannot link to its own map');
      await this.access.assertCanViewMap(orgId, principal, dto.linked_map_id);
    }

    // Re-parent (move to another container/level). Validate same-map, permission on
    // the destination, and no cycle (can't move a node inside itself/its own subtree).
    let reparent: { parent_node_id: string | null; sort_order: number; position_x: number; position_y: number } | null = null;
    if (dto.parent_node_id !== undefined) {
      const newParent = dto.parent_node_id ?? null;
      if (newParent === nodeId) throw new BadRequestException('A node cannot be its own parent');
      const all = await this.prisma.processNode.findMany({
        where: { organization_id: orgId, map_id: mapId, is_deleted: false },
        select: { id: true, parent_node_id: true },
      });
      const byId = new Map(all.map((n) => [n.id, n]));
      if (newParent) {
        if (!byId.has(newParent)) throw new BadRequestException('Target location is not in this map');
        // Walk up from the destination — if we reach this node, the move is a cycle.
        let cur: string | null = newParent;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          if (cur === nodeId) throw new BadRequestException('Cannot move a node inside itself');
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
        where: { organization_id: orgId, map_id: mapId, parent_node_id: newParent, is_deleted: false, id: { not: nodeId } },
        select: { sort_order: true, position_y: true },
      });
      const nextY = sibs.length ? Math.max(...sibs.map((s) => s.position_y)) + 170 : 60;
      const nextSort = sibs.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
      reparent = { parent_node_id: newParent, sort_order: nextSort, position_x: 60, position_y: nextY };
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
    let laneUpdate: { pool: ProcessPool | null; department_id: string | null } | null = null;
    if (dto.pool !== undefined || dto.department_id !== undefined) {
      const desiredPool = dto.pool !== undefined ? (dto.pool ?? null) : node.pool;
      const desiredDept = dto.department_id !== undefined ? (dto.department_id ?? null) : node.department_id;
      const resolved = await this.resolveLane(orgId, desiredPool, desiredDept);
      laneUpdate = { pool: resolved.pool, department_id: resolved.departmentId };
    }
    const finalParent = reparent ? reparent.parent_node_id : node.parent_node_id;
    const effPool = laneUpdate ? laneUpdate.pool : node.pool;
    const effDept = laneUpdate ? laneUpdate.department_id : node.department_id;
    // Ensure the target lane exists for the node's final level (covers dept change AND re-parent).
    if (effPool === ProcessPool.company && effDept) {
      await this.ensureAutoLane(orgId, principal.userId, mapId, finalParent, effDept);
    }

    await this.prisma.processNode.update({
      where: { id: nodeId },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.responsible_role_id !== undefined ? { responsible_role_id: dto.responsible_role_id } : {}),
        ...(dto.responsible_user_id !== undefined ? { responsible_user_id: dto.responsible_user_id } : {}),
        ...(laneUpdate ? { pool: laneUpdate.pool, department_id: laneUpdate.department_id } : {}),
        ...(dto.position_x !== undefined ? { position_x: dto.position_x } : {}),
        ...(dto.position_y !== undefined ? { position_y: dto.position_y } : {}),
        // Any explicit position move (e.g. dragging onto another lane) places the node → freeze it.
        ...(dto.position_x !== undefined || dto.position_y !== undefined ? { layout_frozen: true } : {}),
        ...(dto.linked_map_id !== undefined ? { linked_map_id: dto.linked_map_id } : {}),
        ...(reparent ? reparent : {}),
      },
    });

    // If the node left an auto lane (dept changed, pool left Company, or it moved levels),
    // remove that lane when it's now empty. Manual lanes are kept.
    const levelChanged = !!reparent && (reparent.parent_node_id ?? null) !== (node.parent_node_id ?? null);
    if (node.department_id && (effDept !== node.department_id || effPool !== ProcessPool.company || levelChanged)) {
      await this.cleanupAutoLane(orgId, mapId, node.parent_node_id, node.department_id);
    }

    if (dto.checklist !== undefined) {
      await this.replaceChecklist(nodeId, dto.checklist);
    }

    // Keep a build-in-place area's child map named the same as its node. Ownership
    // signal: the linked map's parent is this node's map (it was built here). A
    // shared reference (linked to a map owned elsewhere) is left untouched.
    if (dto.name !== undefined && node.linked_map_id) {
      const linked = await this.prisma.processMap.findFirst({
        where: { id: node.linked_map_id, organization_id: orgId, is_deleted: false },
        select: { id: true, parent_map_id: true },
      });
      if (linked && linked.parent_map_id === node.map_id) {
        await this.prisma.processMap.update({ where: { id: linked.id }, data: { name: dto.name.trim() } });
      }
    }

    return this.getNode(orgId, principal, mapId, nodeId);
  }

  private async replaceChecklist(nodeId: string, items: { id?: string; text: string }[]) {
    await this.prisma.$transaction([
      this.prisma.processChecklistItem.deleteMany({ where: { node_id: nodeId } }),
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

  async bulkPosition(orgId: string, principal: Principal, mapId: string, dto: BulkPositionDto) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const canEditWhole = await this.access.canEditMap(orgId, principal, mapId);
    const updates = [];
    for (const p of dto.positions) {
      const node = await this.prisma.processNode.findFirst({
        where: { id: p.id, map_id: mapId, organization_id: orgId, is_deleted: false },
        select: { id: true },
      });
      if (!node) continue;
      if (!canEditWhole && !(await this.access.canEditNode(orgId, principal, p.id))) continue;
      updates.push(
        this.prisma.processNode.update({
          where: { id: p.id },
          // Saving a position places the node — freeze it so the auto-layout never moves it again.
          data: { position_x: p.position_x, position_y: p.position_y, layout_frozen: true },
        }),
      );
    }
    if (updates.length) await this.prisma.$transaction(updates);
    return { updated: updates.length };
  }

  async deleteNode(orgId: string, principal: Principal, mapId: string, nodeId: string) {
    await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);

    // Collect the node + all descendants (soft-delete the subtree).
    const all = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      select: { id: true, parent_node_id: true, pool: true, department_id: true },
    });
    const nodeById = new Map(all.map((n) => [n.id, n]));
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parent_node_id) continue;
      (childrenOf.get(n.parent_node_id) ?? childrenOf.set(n.parent_node_id, []).get(n.parent_node_id)!).push(n.id);
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
    const lanePairs = new Map<string, { parent: string | null; dept: string }>();
    for (const id of doomed) {
      const n = nodeById.get(id);
      if (n?.pool === ProcessPool.company && n.department_id) {
        lanePairs.set(`${n.parent_node_id ?? 'root'}:${n.department_id}`, { parent: n.parent_node_id, dept: n.department_id });
      }
    }
    for (const { parent, dept } of lanePairs.values()) {
      await this.cleanupAutoLane(orgId, mapId, parent, dept);
    }
    return { deleted: doomed.length };
  }

  // ─── Connections ─────────────────────────────────────────────────────────────

  async createConnection(orgId: string, principal: Principal, mapId: string, dto: CreateConnectionDto) {
    const parentId = dto.parent_node_id ?? null;
    const [source, target] = await Promise.all([
      this.requireNode(orgId, mapId, dto.source_node_id),
      this.requireNode(orgId, mapId, dto.target_node_id),
    ]);
    if (source.parent_node_id !== parentId || target.parent_node_id !== parentId) {
      throw new BadRequestException('A connection can only join two steps in the same flow');
    }
    if (dto.source_node_id === dto.target_node_id) {
      throw new BadRequestException('A step cannot connect to itself');
    }
    if (parentId) await this.access.assertCanEditNode(orgId, principal, parentId);
    else await this.access.assertCanEditMap(orgId, principal, mapId);

    // Output limits: a decision branches into exactly one Yes and one No. Every other step may lead
    // to as many next steps as it has FREE connector points — a point (a node side) is in use once a
    // line attaches to it, as this step's outgoing source_side OR an incoming target_side. So a step
    // can fan out from each of its free dots. (Authoritative guard — the client enforces the same.)
    const attached = await this.prisma.processConnection.findMany({
      where: {
        organization_id: orgId, map_id: mapId, parent_node_id: parentId,
        OR: [{ source_node_id: dto.source_node_id }, { target_node_id: dto.source_node_id }],
      },
      select: { source_node_id: true, target_node_id: true, source_side: true, target_side: true, condition_kind: true },
    });
    const outs = attached.filter((c) => c.source_node_id === dto.source_node_id);
    const cond = dto.condition_kind ?? 'none';
    if (source.kind === ProcessNodeKind.decision) {
      if (cond !== 'none' && outs.some((o) => o.condition_kind === cond)) {
        throw new BadRequestException(`This decision already has a ${cond === 'yes' ? 'Yes' : 'No'} branch.`);
      }
      if (outs.length >= 2) throw new BadRequestException('A decision can only branch into Yes and No.');
    } else {
      const usedPoints = new Set<string>();
      for (const c of attached) {
        if (c.source_node_id === dto.source_node_id && c.source_side) usedPoints.add(c.source_side);
        if (c.target_node_id === dto.source_node_id && c.target_side) usedPoints.add(c.target_side);
      }
      const side = dto.source_side ?? null;
      if (side && usedPoints.has(side)) {
        throw new BadRequestException('That connection point is already in use — draw from a free dot.');
      }
      if (!side && outs.length >= 4) {
        throw new BadRequestException('This step already uses all its connection points.');
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

  async updateConnection(orgId: string, principal: Principal, mapId: string, connId: string, dto: UpdateConnectionDto) {
    const conn = await this.prisma.processConnection.findFirst({
      where: { id: connId, map_id: mapId, organization_id: orgId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.parent_node_id) await this.access.assertCanEditNode(orgId, principal, conn.parent_node_id);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    return this.prisma.processConnection.update({
      where: { id: connId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.condition_kind !== undefined ? { condition_kind: dto.condition_kind } : {}),
        ...(dto.source_side !== undefined ? { source_side: dto.source_side } : {}),
        ...(dto.target_side !== undefined ? { target_side: dto.target_side } : {}),
      },
    });
  }

  async deleteConnection(orgId: string, principal: Principal, mapId: string, connId: string) {
    const conn = await this.prisma.processConnection.findFirst({
      where: { id: connId, map_id: mapId, organization_id: orgId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.parent_node_id) await this.access.assertCanEditNode(orgId, principal, conn.parent_node_id);
    else await this.access.assertCanEditMap(orgId, principal, mapId);
    await this.prisma.processConnection.delete({ where: { id: connId } });
    return { success: true };
  }

  // ─── Artifacts ──────────────────────────────────────────────────────────────

  async listArtifacts(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.prisma.processArtifact.findMany({
      where: { organization_id: orgId, map_id: mapId },
      orderBy: { created_at: 'desc' },
    });
  }

  async createArtifact(orgId: string, principal: Principal, mapId: string, dto: CreateArtifactDto) {
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

  async uploadArtifact(orgId: string, principal: Principal, mapId: string, dto: CreateArtifactDto, file: UploadedFile) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    validateAttachmentFile(file);
    const key = `orgs/${orgId}/process-artifacts/${mapId}/${randomUUID()}.${extensionOf(file.originalname)}`;
    await this.r2.putObject(key, file.buffer, file.mimetype);
    // Multipart sends booleans as strings; treat only an explicit "false" as view-only.
    const allowDownload = !(dto.allow_download === false || dto.allow_download === 'false');
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
  async createMaterial(orgId: string, principal: Principal, mapId: string, dto: CreateMaterialDto) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const isLink = !!dto.url;
    const isArticle = dto.content_body !== undefined && dto.content_body !== null;
    if (isLink === isArticle) {
      throw new BadRequestException('Add either a link or an article, not both.');
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

  async updateArtifact(orgId: string, principal: Principal, mapId: string, artifactId: string, dto: UpdateArtifactDto) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    return this.prisma.processArtifact.update({
      where: { id: artifact.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim().slice(0, 50) } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.artifact_type !== undefined ? { artifact_type: dto.artifact_type } : {}),
        ...(dto.url !== undefined && artifact.content_type === 'link' ? { url: dto.url } : {}),
        ...(dto.content_body !== undefined && artifact.content_type === 'article' ? { content_body: dto.content_body } : {}),
        ...(dto.allow_download !== undefined && artifact.content_type === 'file' ? { allow_download: dto.allow_download } : {}),
      },
    });
  }

  async deleteArtifact(orgId: string, principal: Principal, mapId: string, artifactId: string) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (artifact.storage_key) await this.r2.deleteObject(artifact.storage_key);
    await this.prisma.processArtifact.delete({ where: { id: artifact.id } }); // cascades node links
    return { success: true };
  }

  // Full detail for one artifact — used to preview a document straight from the canvas
  // (decide link vs file vs article, read the url/body). View access to the map is enough.
  async getArtifact(orgId: string, principal: Principal, mapId: string, artifactId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.requireArtifact(orgId, mapId, artifactId);
  }

  // Inline URL for previewing a file (does NOT bypass view-only — that only blocks
  // the download button; previewing is always allowed to anyone who can view the map).
  async viewArtifact(orgId: string, principal: Principal, mapId: string, artifactId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key) throw new BadRequestException('This material has no file to preview');
    const url = await this.r2.getSignedDownloadUrl(artifact.storage_key, artifact.file_name ?? artifact.name);
    return { url, file_name: artifact.file_name, mime_type: artifact.mime_type, allow_download: artifact.allow_download };
  }

  async downloadArtifact(orgId: string, principal: Principal, mapId: string, artifactId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key) throw new BadRequestException('This artifact has no attached file');
    if (!artifact.allow_download) throw new ForbiddenException('This file is view-only');
    const url = await this.r2.getSignedDownloadUrl(artifact.storage_key, artifact.file_name ?? artifact.name);
    return { url };
  }

  // Raw bytes, streamed same-origin (so pdf.js / OfficeViewer avoid R2 CORS). Preview
  // is always allowed to map viewers; view-only only blocks the Download button.
  async getArtifactBytes(orgId: string, principal: Principal, mapId: string, artifactId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const artifact = await this.requireArtifact(orgId, mapId, artifactId);
    if (!artifact.storage_key) throw new BadRequestException('This material has no file to preview');
    const buffer = await this.r2.getObjectBuffer(artifact.storage_key);
    return { buffer, mime: artifact.mime_type ?? 'application/octet-stream', fileName: artifact.file_name ?? artifact.name };
  }

  private async requireArtifact(orgId: string, mapId: string, artifactId: string) {
    const artifact = await this.prisma.processArtifact.findFirst({
      where: { id: artifactId, map_id: mapId, organization_id: orgId },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return artifact;
  }

  async linkArtifact(orgId: string, principal: Principal, mapId: string, nodeId: string, dto: LinkArtifactDto) {
    await this.requireNode(orgId, mapId, nodeId);
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
      create: { node_id: nodeId, artifact_id: dto.artifact_id, direction: dto.direction },
      update: {},
    });
  }

  async unlinkArtifact(orgId: string, principal: Principal, mapId: string, nodeId: string, linkId: string) {
    await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const res = await this.prisma.processNodeArtifact.deleteMany({ where: { id: linkId, node_id: nodeId } });
    if (res.count === 0) throw new NotFoundException('Artifact link not found');
    return { success: true };
  }

  // ─── Access / sharing ─────────────────────────────────────────────────────────

  async listNodeAccess(orgId: string, principal: Principal, mapId: string, nodeId: string) {
    await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId); // managing sharing is an edit concern
    const rules = await this.prisma.processNodeAccess.findMany({ where: { organization_id: orgId, node_id: nodeId } });
    return this.enrichAccessRules(orgId, rules);
  }

  async addAccessRule(orgId: string, principal: Principal, mapId: string, nodeId: string, dto: AddAccessRuleDto) {
    await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    this.validateAccessDto(dto);
    const rule = await this.prisma.processNodeAccess.create({
      data: {
        organization_id: orgId,
        node_id: nodeId,
        kind: dto.kind,
        level: dto.kind === ProcessAccessKind.exclude_user ? ProcessAccessLevel.view : dto.level ?? ProcessAccessLevel.view,
        department_id: dto.kind === ProcessAccessKind.department ? dto.department_id ?? null : null,
        include_sub_departments: dto.include_sub_departments ?? true,
        role_id: dto.kind === ProcessAccessKind.role ? dto.role_id ?? null : null,
        user_id:
          dto.kind === ProcessAccessKind.user || dto.kind === ProcessAccessKind.exclude_user
            ? dto.user_id ?? null
            : null,
        created_by_user_id: principal.userId,
      },
    });
    return (await this.enrichAccessRules(orgId, [rule]))[0];
  }

  async removeAccessRule(orgId: string, principal: Principal, mapId: string, nodeId: string, ruleId: string) {
    await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const res = await this.prisma.processNodeAccess.deleteMany({ where: { id: ruleId, node_id: nodeId, organization_id: orgId } });
    if (res.count === 0) throw new NotFoundException('Access rule not found');
    return { success: true };
  }

  private validateAccessDto(dto: AddAccessRuleDto) {
    if (dto.kind === ProcessAccessKind.department && !dto.department_id) {
      throw new BadRequestException('Choose a department to attach.');
    }
    if (dto.kind === ProcessAccessKind.role && !dto.role_id) {
      throw new BadRequestException('Choose a role to attach.');
    }
    if ((dto.kind === ProcessAccessKind.user || dto.kind === ProcessAccessKind.exclude_user) && !dto.user_id) {
      throw new BadRequestException('Choose a person to attach.');
    }
  }

  /** Attach human-readable labels (dept name / role title / person name) for the UI. */
  private async enrichAccessRules(orgId: string, rules: any[]) {
    if (rules.length === 0) return [];
    const deptIds = rules.map((r) => r.department_id).filter(Boolean) as string[];
    const roleIds = rules.map((r) => r.role_id).filter(Boolean) as string[];
    const userIds = rules.map((r) => r.user_id).filter(Boolean) as string[];
    const [depts, roles, users] = await Promise.all([
      deptIds.length ? this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [],
      roleIds.length ? this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, title: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ]);
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    const roleName = new Map(roles.map((r) => [r.id, r.title]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return rules.map((r) => ({
      ...r,
      label:
        r.kind === 'department'
          ? deptName.get(r.department_id) ?? 'Department'
          : r.kind === 'role'
            ? roleName.get(r.role_id) ?? 'Role'
            : userName.get(r.user_id) ?? 'Person',
    }));
  }

  // ─── Snapshots (create + restore; DIFF is Phase 2) ─────────────────────────────

  async listSnapshots(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.prisma.processSnapshot.findMany({
      where: { organization_id: orgId, map_id: mapId },
      orderBy: { created_at: 'desc' },
      select: { id: true, label: true, status: true, created_by_user_id: true, created_at: true },
    });
  }

  async createSnapshot(orgId: string, principal: Principal, mapId: string, dto: CreateSnapshotDto) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const tree = await this.serializeMap(orgId, mapId);
    return this.prisma.processSnapshot.create({
      data: {
        organization_id: orgId,
        map_id: mapId,
        label: dto.label.trim(),
        status: dto.status ?? 'draft',
        tree_json: tree,
        created_by_user_id: principal.userId,
      },
      select: { id: true, label: true, status: true, created_by_user_id: true, created_at: true },
    });
  }

  private async serializeMap(orgId: string, mapId: string) {
    // Only NON-deleted nodes go in the blob, so every sub-resource must be scoped to THAT set —
    // otherwise a connection / link / checklist / access row that still references a soft-deleted
    // node would be in the blob but its node wouldn't, and restore (wipe + recreate) would hit a
    // foreign-key violation recreating that orphan. Scope everything to the included node ids.
    const nodes = await this.prisma.processNode.findMany({ where: { organization_id: orgId, map_id: mapId, is_deleted: false } });
    const nodeIds = nodes.map((n) => n.id);
    const nodeIdSet = new Set(nodeIds);
    const [connectionsAll, artifacts, lanes, links, checklist, access] = await Promise.all([
      this.prisma.processConnection.findMany({ where: { organization_id: orgId, map_id: mapId } }),
      this.prisma.processArtifact.findMany({ where: { organization_id: orgId, map_id: mapId } }),
      this.prisma.processLane.findMany({ where: { organization_id: orgId, map_id: mapId } }),
      nodeIds.length ? this.prisma.processNodeArtifact.findMany({ where: { node_id: { in: nodeIds } } }) : [],
      nodeIds.length ? this.prisma.processChecklistItem.findMany({ where: { node_id: { in: nodeIds } } }) : [],
      nodeIds.length ? this.prisma.processNodeAccess.findMany({ where: { organization_id: orgId, node_id: { in: nodeIds } } }) : [],
    ]);
    // Drop any connection whose endpoints aren't both in the (non-deleted) node set.
    const connections = connectionsAll.filter((c) => nodeIdSet.has(c.source_node_id) && nodeIdSet.has(c.target_node_id));
    // JSON round-trip converts Date instances to ISO strings so the value satisfies
    // Prisma's Json input type (and restore feeds the strings straight back to createMany,
    // which accepts ISO-8601 for DateTime columns). Lanes are captured too, else undo would
    // silently lose swimlane add/remove/reorder (lanes reference no node, so they restore freely).
    return JSON.parse(JSON.stringify({ version: 1, nodes, connections, artifacts, lanes, links, checklist, access }));
  }

  async restoreSnapshot(orgId: string, principal: Principal, mapId: string, snapshotId: string) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    const snap = await this.prisma.processSnapshot.findFirst({
      where: { id: snapshotId, map_id: mapId, organization_id: orgId },
    });
    if (!snap) throw new NotFoundException('Snapshot not found');
    await this.applyTree(orgId, mapId, snap.tree_json as any);
    return { success: true };
  }

  // ─── Undo/redo state (session history) ─────────────────────────────────────────
  // The editor keeps a client-side undo stack of serialized map states; these two
  // endpoints let it capture the current state and rebuild the map from a captured
  // one WITHOUT creating a user-facing snapshot/version row.

  /** Serialize the whole map to a JSON blob the client can hold for undo/redo. */
  async exportState(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    return this.serializeMap(orgId, mapId);
  }

  /** Rebuild the map from a client-held state blob (undo/redo step). */
  async restoreState(orgId: string, principal: Principal, mapId: string, tree: any) {
    await this.access.assertCanEditMap(orgId, principal, mapId);
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.nodes)) {
      throw new BadRequestException('Invalid map state');
    }
    await this.applyTree(orgId, mapId, tree);
    return { success: true };
  }

  /** Wipe a map's working tree and rebuild it from a serialized state (ids preserved so
   *  relations resolve). org/map are FORCED on every row, so a supplied tree can only ever
   *  write into THIS map — never cross-org/map — regardless of what the blob claims. */
  private async applyTree(orgId: string, mapId: string, tree: any) {
    const withOrgMap = (rows: any[] | undefined) =>
      (rows ?? []).map((r) => ({ ...r, organization_id: orgId, map_id: mapId }));
    const withOrg = (rows: any[] | undefined) =>
      (rows ?? []).map((r) => ({ ...r, organization_id: orgId }));
    const artifacts = withOrgMap(tree.artifacts);
    const rawNodes = withOrgMap(tree.nodes);
    const lanes = withOrgMap(tree.lanes);
    // Defensive: drop / neutralise any reference to a node/artifact NOT being recreated, so a stale
    // or hand-built blob (e.g. an old snapshot, or a live map with a soft-deleted parent whose child
    // survived) can never break the whole restore with a foreign-key violation. Serialization now
    // avoids most of these, but restore must be safe for ANY blob it's handed.
    const nodeIdSet = new Set<string>(rawNodes.map((n) => n.id));
    const artIdSet = new Set<string>(artifacts.map((a) => a.id));
    // parent_node_id is a self-FK on process_nodes. serializeMap only keeps non-deleted nodes, so a
    // child whose parent was soft-deleted points at an id that isn't in the blob — inserting it would
    // violate process_nodes_parent_node_id_fkey and 500 the whole undo. Null the dangling ref so the
    // node re-appears at top level instead (every OTHER cross-ref below is already sanitised the same way).
    const nodesSanitised = rawNodes.map((n) =>
      n.parent_node_id && !nodeIdSet.has(n.parent_node_id) ? { ...n, parent_node_id: null } : n,
    );
    // Insert parents before children. A single multi-row INSERT checks the self-FK at statement end
    // (order-independent), but Prisma may split a large createMany into several statements — each of
    // which is checked on its own — so order defensively to guarantee a parent is never referenced
    // before it exists.
    const nodes = orderNodesParentFirst(nodesSanitised);
    const connections = withOrgMap(tree.connections).filter(
      (c) => nodeIdSet.has(c.source_node_id) && nodeIdSet.has(c.target_node_id),
    );
    const links = (tree.links ?? []).filter((l: any) => nodeIdSet.has(l.node_id) && artIdSet.has(l.artifact_id)); // node_id + artifact_id only
    const checklist = (tree.checklist ?? []).filter((c: any) => nodeIdSet.has(c.node_id)); // node_id only
    const access = withOrg(tree.access).filter((a) => nodeIdSet.has(a.node_id));

    await this.prisma.$transaction(
      async (tx) => {
        // Wipe the working tree (hard delete — the supplied state is the source of truth).
        await tx.processConnection.deleteMany({ where: { organization_id: orgId, map_id: mapId } });
        await tx.processNodeArtifact.deleteMany({ where: { node: { organization_id: orgId, map_id: mapId } } });
        await tx.processChecklistItem.deleteMany({ where: { node: { organization_id: orgId, map_id: mapId } } });
        await tx.processNodeAccess.deleteMany({ where: { organization_id: orgId, node: { map_id: mapId } } });
        await tx.processLane.deleteMany({ where: { organization_id: orgId, map_id: mapId } });
        await tx.processNode.deleteMany({ where: { organization_id: orgId, map_id: mapId } });
        await tx.processArtifact.deleteMany({ where: { organization_id: orgId, map_id: mapId } });

        // Recreate (ids preserved so relations resolve).
        if (artifacts.length) await tx.processArtifact.createMany({ data: artifacts });
        if (nodes.length) await tx.processNode.createMany({ data: nodes });
        if (lanes.length) await tx.processLane.createMany({ data: lanes });
        if (connections.length) await tx.processConnection.createMany({ data: connections });
        if (links.length) await tx.processNodeArtifact.createMany({ data: links });
        if (checklist.length) await tx.processChecklistItem.createMany({ data: checklist });
        if (access.length) await tx.processNodeAccess.createMany({ data: access });
      },
      // Wipe + rebuild of a whole map is far heavier than a single write; the 5s interactive-transaction
      // default 500s on large production maps. Give it room.
      { timeout: 30000, maxWait: 10000 },
    );
  }

  // ─── Diff (as-is vs to-be) ─────────────────────────────────────────────────────

  /** Resolve a tree ref: 'live' → serialize the working map; else a snapshot id. */
  private async treeFor(orgId: string, mapId: string, ref: string): Promise<any> {
    if (ref === 'live') return this.serializeMap(orgId, mapId);
    const snap = await this.prisma.processSnapshot.findFirst({
      where: { id: ref, map_id: mapId, organization_id: orgId },
      select: { tree_json: true },
    });
    if (!snap) throw new NotFoundException('Snapshot not found');
    return snap.tree_json;
  }

  async diff(
    orgId: string,
    principal: Principal,
    mapId: string,
    base: string,
    target: string,
  ): Promise<MapDiff & { base: string; target: string }> {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const [b, t] = await Promise.all([this.treeFor(orgId, mapId, base), this.treeFor(orgId, mapId, target)]);
    return { base, target, ...computeMapDiff(b, t) };
  }

  // ─── Status workflow (draft → in_review → final) ───────────────────────────────

  /** node + all descendants (ids), scoped to the map. */
  private async subtreeIds(orgId: string, mapId: string, nodeId: string): Promise<string[]> {
    const all = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      select: { id: true, parent_node_id: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parent_node_id) continue;
      (childrenOf.get(n.parent_node_id) ?? childrenOf.set(n.parent_node_id, []).get(n.parent_node_id)!).push(n.id);
    }
    const out: string[] = [];
    const stack = [nodeId];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  }

  async requestReview(orgId: string, principal: Principal, mapId: string, nodeId: string, cascade: boolean) {
    const node = await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const ids = cascade ? await this.subtreeIds(orgId, mapId, nodeId) : [nodeId];
    await this.prisma.processNode.updateMany({
      where: { id: { in: ids }, organization_id: orgId },
      data: { status: ProcessNodeStatus.in_review },
    });
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId },
      select: { created_by_user_id: true, name: true },
    });
    if (map && map.created_by_user_id !== principal.userId) {
      const who = await this.notifications.userName(principal.userId).catch(() => 'Someone');
      await this.notifications.emit({
        orgId,
        module: 'process_hierarchy',
        event_type: 'process_review_requested',
        recipients: [map.created_by_user_id],
        title: 'Process review requested',
        body: `${who} sent "${node.name}" in ${map.name} for review.`,
        link: `/dashboard/process-hierarchy/${mapId}`,
        entity: { type: 'process_node', id: nodeId },
        dedupe: true,
      });
    }
    return { updated: ids.length };
  }

  async decideStatus(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    status: ProcessNodeStatus,
    cascade: boolean,
  ) {
    const node = await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditMap(orgId, principal, mapId); // approve / send-back = owner or admin
    const ids = cascade ? await this.subtreeIds(orgId, mapId, nodeId) : [nodeId];
    await this.prisma.processNode.updateMany({
      where: { id: { in: ids }, organization_id: orgId },
      data: { status },
    });
    const recipients = Array.from(
      new Set(
        [node.responsible_user_id, node.created_by_user_id].filter(
          (x): x is string => !!x && x !== principal.userId,
        ),
      ),
    );
    if (recipients.length && (status === ProcessNodeStatus.final || status === ProcessNodeStatus.draft)) {
      const map = await this.prisma.processMap.findFirst({ where: { id: mapId }, select: { name: true } });
      await this.notifications.emit({
        orgId,
        module: 'process_hierarchy',
        event_type: status === ProcessNodeStatus.final ? 'process_finalized' : 'process_sent_back',
        recipients,
        title: status === ProcessNodeStatus.final ? 'Process marked final' : 'Process sent back to draft',
        body: `"${node.name}" in ${map?.name ?? 'a process map'} was ${
          status === ProcessNodeStatus.final ? 'marked final' : 'sent back to draft'
        }.`,
        link: `/dashboard/process-hierarchy/${mapId}`,
        entity: { type: 'process_node', id: nodeId },
      });
    }
    return { updated: ids.length };
  }

  // ─── Templates (reusable process blueprints) ───────────────────────────────────

  async saveAsTemplate(orgId: string, principal: Principal, mapId: string, name: string, description?: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    const tree = await this.serializeMap(orgId, mapId);
    return this.prisma.processTemplate.create({
      data: {
        organization_id: orgId,
        name: name.trim(),
        description: description ?? null,
        tree_json: tree,
        source_map_id: mapId,
        created_by_user_id: principal.userId,
      },
      select: { id: true, name: true, description: true, created_by_user_id: true, created_at: true },
    });
  }

  async listTemplates(orgId: string) {
    return this.prisma.processTemplate.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, description: true, created_by_user_id: true, created_at: true },
    });
  }

  async deleteTemplate(orgId: string, principal: Principal, templateId: string) {
    const tpl = await this.prisma.processTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { id: true, created_by_user_id: true },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    if (!principal.isAdmin && tpl.created_by_user_id !== principal.userId) {
      throw new ForbiddenException('Only the template creator or an administrator can delete it');
    }
    await this.prisma.processTemplate.delete({ where: { id: templateId } });
    return { success: true };
  }

  /** Create a brand-new map from a template, cloning the tree with fresh ids. */
  async instantiateTemplate(orgId: string, principal: Principal, templateId: string, name: string) {
    const tpl = await this.prisma.processTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return this.instantiateTree(orgId, principal.userId, tpl.tree_json as any, name);
  }

  // Clone a serialized map tree into a brand-new map. Inner references (linked_map_id)
  // are preserved as-is — so a detached copy shares the maps its own children point at
  // (clone the top, keep inner refs shared).
  private async instantiateTree(
    orgId: string,
    userId: string,
    tree: any,
    name: string,
    opts?: { parentMapId?: string | null; description?: string | null },
  ) {
    const map = await this.prisma.processMap.create({
      data: {
        organization_id: orgId,
        name: name.trim(),
        description: opts?.description ?? null,
        parent_map_id: opts?.parentMapId ?? null,
        created_by_user_id: userId,
      },
    });

    // Fresh-id maps so every internal reference is rewired to the new rows.
    const nodeId = new Map<string, string>();
    const artifactId = new Map<string, string>();
    for (const n of tree.nodes ?? []) nodeId.set(n.id, randomUUID());
    for (const a of tree.artifacts ?? []) artifactId.set(a.id, randomUUID());

    // Copy any real files to new R2 keys so deleting one map never orphans another's bytes.
    const artifactRows: any[] = [];
    for (const a of tree.artifacts ?? []) {
      const newId = artifactId.get(a.id)!;
      let storageKey: string | null = a.storage_key ?? null;
      if (a.storage_key) {
        const destKey = `orgs/${orgId}/process-artifacts/${map.id}/${newId}.${extensionOf(a.file_name ?? '')}`;
        try {
          await this.r2.copyObject(a.storage_key, destKey);
          storageKey = destKey;
        } catch {
          storageKey = a.storage_key; // fall back to sharing the object if copy is unavailable
        }
      }
      artifactRows.push({
        id: newId,
        organization_id: orgId,
        map_id: map.id,
        name: a.name,
        description: a.description ?? null,
        artifact_type: a.artifact_type,
        content_type: a.content_type ?? 'file',
        url: a.url ?? null,
        content_body: a.content_body ?? null,
        allow_download: a.allow_download ?? true,
        file_name: a.file_name ?? null,
        mime_type: a.mime_type ?? null,
        size_bytes: a.size_bytes ?? null,
        storage_key: storageKey,
        created_by_user_id: userId,
      });
    }

    const nodeRows = (tree.nodes ?? []).map((n: any) => ({
      id: nodeId.get(n.id)!,
      organization_id: orgId,
      map_id: map.id,
      parent_node_id: n.parent_node_id ? nodeId.get(n.parent_node_id) ?? null : null,
      kind: n.kind,
      name: n.name,
      description: n.description ?? null,
      status: n.status,
      responsible_role_id: n.responsible_role_id ?? null,
      responsible_user_id: n.responsible_user_id ?? null,
      position_x: n.position_x ?? 0,
      position_y: n.position_y ?? 0,
      sort_order: n.sort_order ?? 0,
      linked_map_id: n.linked_map_id ?? null, // inner references stay shared
      created_by_user_id: userId,
    }));

    const connectionRows = (tree.connections ?? [])
      .filter((c: any) => nodeId.has(c.source_node_id) && nodeId.has(c.target_node_id))
      .map((c: any) => ({
        id: randomUUID(),
        organization_id: orgId,
        map_id: map.id,
        parent_node_id: c.parent_node_id ? nodeId.get(c.parent_node_id) ?? null : null,
        source_node_id: nodeId.get(c.source_node_id)!,
        target_node_id: nodeId.get(c.target_node_id)!,
        label: c.label ?? null,
        condition_kind: c.condition_kind ?? 'none',
      }));

    const linkRows = (tree.links ?? [])
      .filter((l: any) => nodeId.has(l.node_id) && artifactId.has(l.artifact_id))
      .map((l: any) => ({
        id: randomUUID(),
        node_id: nodeId.get(l.node_id)!,
        artifact_id: artifactId.get(l.artifact_id)!,
        direction: l.direction,
      }));

    const checklistRows = (tree.checklist ?? [])
      .filter((c: any) => nodeId.has(c.node_id))
      .map((c: any) => ({ id: randomUUID(), node_id: nodeId.get(c.node_id)!, text: c.text, sort_order: c.sort_order ?? 0 }));

    const accessRows = (tree.access ?? [])
      .filter((a: any) => nodeId.has(a.node_id))
      .map((a: any) => ({
        id: randomUUID(),
        organization_id: orgId,
        node_id: nodeId.get(a.node_id)!,
        kind: a.kind,
        level: a.level,
        department_id: a.department_id ?? null,
        include_sub_departments: a.include_sub_departments ?? true,
        role_id: a.role_id ?? null,
        user_id: a.user_id ?? null,
        created_by_user_id: userId,
      }));

    await this.prisma.$transaction(async (tx) => {
      if (artifactRows.length) await tx.processArtifact.createMany({ data: artifactRows });
      if (nodeRows.length) await tx.processNode.createMany({ data: nodeRows });
      if (connectionRows.length) await tx.processConnection.createMany({ data: connectionRows });
      if (linkRows.length) await tx.processNodeArtifact.createMany({ data: linkRows });
      if (checklistRows.length) await tx.processChecklistItem.createMany({ data: checklistRows });
      if (accessRows.length) await tx.processNodeAccess.createMany({ data: accessRows });
    });

    return map;
  }

  // Detach a reference into its own independent copy (copy-on-write). Snapshots the
  // referenced map into a new child map here, then repoints this node at the copy.
  async detachNode(orgId: string, principal: Principal, mapId: string, nodeId: string) {
    const node = await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    if (!node.linked_map_id) throw new BadRequestException('This node does not reference a map to copy');
    await this.access.assertCanViewMap(orgId, principal, node.linked_map_id);
    const src = await this.prisma.processMap.findFirst({
      where: { id: node.linked_map_id, organization_id: orgId, is_deleted: false },
      select: { name: true },
    });
    const tree = await this.serializeMap(orgId, node.linked_map_id);
    const clone = await this.instantiateTree(orgId, principal.userId, tree, `${src?.name ?? node.name} (copy)`, { parentMapId: mapId });
    await this.prisma.processNode.update({ where: { id: nodeId }, data: { linked_map_id: clone.id } });
    return this.getNode(orgId, principal, mapId, nodeId);
  }

  // Serialize the subtree *under* a node (its children become the new map's top level),
  // re-rooting so connections at the node's own level land at the top of the new map.
  private async serializeSubtree(orgId: string, mapId: string, rootId: string) {
    const [allNodes, allConns] = await Promise.all([
      this.prisma.processNode.findMany({ where: { organization_id: orgId, map_id: mapId, is_deleted: false } }),
      this.prisma.processConnection.findMany({ where: { organization_id: orgId, map_id: mapId } }),
    ]);
    const childrenOf = new Map<string | null, typeof allNodes>();
    for (const n of allNodes) {
      const list = childrenOf.get(n.parent_node_id) ?? [];
      list.push(n);
      childrenOf.set(n.parent_node_id, list);
    }
    const desc: typeof allNodes = [];
    const collect = (pid: string) => { for (const c of childrenOf.get(pid) ?? []) { desc.push(c); collect(c.id); } };
    collect(rootId);
    const descIds = new Set(desc.map((n) => n.id));

    // Direct children of the root move to the top level; the connection level that lived
    // "inside the root" (parent_node_id === root) becomes the new map's top level too.
    const nodes = desc.map((n) => ({ ...n, parent_node_id: n.parent_node_id === rootId ? null : n.parent_node_id }));
    const connections = allConns
      .filter((c) => (c.parent_node_id === rootId || (c.parent_node_id && descIds.has(c.parent_node_id))) && descIds.has(c.source_node_id) && descIds.has(c.target_node_id))
      .map((c) => ({ ...c, parent_node_id: c.parent_node_id === rootId ? null : c.parent_node_id }));

    const nodeIds = [...descIds];
    const [links, checklist, access] = await Promise.all([
      this.prisma.processNodeArtifact.findMany({ where: { node_id: { in: nodeIds } } }),
      this.prisma.processChecklistItem.findMany({ where: { node_id: { in: nodeIds } } }),
      this.prisma.processNodeAccess.findMany({ where: { node_id: { in: nodeIds } } }),
    ]);
    const artifactIds = [...new Set(links.map((l) => l.artifact_id))];
    const artifacts = artifactIds.length
      ? await this.prisma.processArtifact.findMany({ where: { id: { in: artifactIds } } })
      : [];
    return {
      tree: JSON.parse(JSON.stringify({ version: 1, nodes, connections, artifacts, links, checklist, access })),
      descIds: nodeIds,
    };
  }

  // "Make reusable": turn a container/sub-process into a standalone map that can be
  // referenced (dropped as a line item) in any map. Build-in-place areas are already
  // maps — we just promote them to top-level + listed; a drill-down container's contents
  // are extracted into a fresh standalone map, and the container becomes a reference to it.
  async makeNodeReusable(orgId: string, principal: Principal, mapId: string, nodeId: string) {
    const node = await this.requireNode(orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    if (node.kind !== ProcessNodeKind.container && node.kind !== ProcessNodeKind.subprocess) {
      throw new BadRequestException('Only a container or sub-process can become a reusable map');
    }

    // Already a map (build-in-place child, or a shared reference) → just promote it to a
    // top-level, listed master so it shows in the maps list and the reference picker.
    if (node.linked_map_id) {
      const target = await this.prisma.processMap.findFirst({
        where: { id: node.linked_map_id, organization_id: orgId, is_deleted: false },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Linked map not found');
      await this.prisma.processMap.update({ where: { id: target.id }, data: { parent_map_id: null, is_listed: true } });
      return this.getNode(orgId, principal, mapId, nodeId);
    }

    // Drill-down container → extract its contents into a new standalone map, then repoint
    // the container at that map and drop its now-moved in-map children.
    const { tree, descIds } = await this.serializeSubtree(orgId, mapId, nodeId);
    const created = await this.instantiateTree(orgId, principal.userId, tree, node.name, { parentMapId: null });
    await this.prisma.$transaction(async (tx) => {
      if (descIds.length) {
        await tx.processConnection.deleteMany({ where: { organization_id: orgId, map_id: mapId, OR: [{ source_node_id: { in: descIds } }, { target_node_id: { in: descIds } }, { parent_node_id: { in: descIds } }] } });
        await tx.processNodeArtifact.deleteMany({ where: { node_id: { in: descIds } } });
        await tx.processChecklistItem.deleteMany({ where: { node_id: { in: descIds } } });
        await tx.processNodeAccess.deleteMany({ where: { node_id: { in: descIds } } });
        await tx.processNode.updateMany({ where: { id: { in: descIds } }, data: { is_deleted: true } });
      }
      // The connection level that lived inside this container is gone with the children.
      await tx.processConnection.deleteMany({ where: { organization_id: orgId, map_id: mapId, parent_node_id: nodeId } });
      await tx.processNode.update({ where: { id: nodeId }, data: { linked_map_id: created.id } });
    });
    return this.getNode(orgId, principal, mapId, nodeId);
  }

  // Copy/paste: duplicate the given nodes (with their sub-trees, documents, checklist,
  // access and internal connections) into a target map/level. Inner map references stay
  // shared; documents are copied to the target map when pasting across maps.
  async pasteNodes(orgId: string, principal: Principal, targetMapId: string, dto: PasteNodesDto) {
    await this.access.assertCanEditMap(orgId, principal, targetMapId);
    const targetParent = dto.parent_node_id ?? null;
    if (targetParent) await this.access.assertCanEditNode(orgId, principal, targetParent);
    await this.access.assertCanViewMap(orgId, principal, dto.source_map_id);

    const srcNodes = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: dto.source_map_id, is_deleted: false },
    });
    const byId = new Map(srcNodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string | null, typeof srcNodes>();
    for (const n of srcNodes) { const l = childrenOf.get(n.parent_node_id) ?? []; l.push(n); childrenOf.set(n.parent_node_id, l); }
    const roots = dto.node_ids.filter((id) => byId.has(id));
    if (!roots.length) throw new BadRequestException('Nothing to paste');
    // Pasting a container inside its own copied sub-tree would recurse; roots are the
    // selection's top level, so just collect each root's descendants once.
    const included = new Set<string>();
    const collect = (id: string) => { if (included.has(id)) return; included.add(id); for (const c of childrenOf.get(id) ?? []) collect(c.id); };
    roots.forEach(collect);
    const nodeIdsArr = [...included];

    const [srcConns, links, checklist, access] = await Promise.all([
      this.prisma.processConnection.findMany({ where: { organization_id: orgId, map_id: dto.source_map_id } }),
      this.prisma.processNodeArtifact.findMany({ where: { node_id: { in: nodeIdsArr } } }),
      this.prisma.processChecklistItem.findMany({ where: { node_id: { in: nodeIdsArr } } }),
      this.prisma.processNodeAccess.findMany({ where: { node_id: { in: nodeIdsArr } } }),
    ]);
    const includedConns = srcConns.filter((c) => included.has(c.source_node_id) && included.has(c.target_node_id));

    const newNodeId = new Map<string, string>();
    nodeIdsArr.forEach((id) => newNodeId.set(id, randomUUID()));

    // Documents: reuse the same artifacts on a same-map paste; copy them (and their R2
    // files) into the target map when pasting across maps, so nothing is shared by chance.
    const usedArtifactIds = [...new Set(links.map((l) => l.artifact_id))];
    const newArtifactId = new Map<string, string>();
    const artifactRows: any[] = [];
    if (targetMapId !== dto.source_map_id && usedArtifactIds.length) {
      const arts = await this.prisma.processArtifact.findMany({ where: { id: { in: usedArtifactIds } } });
      for (const a of arts) {
        const nid = randomUUID();
        newArtifactId.set(a.id, nid);
        let storageKey: string | null = a.storage_key ?? null;
        if (a.storage_key) {
          const destKey = `orgs/${orgId}/process-artifacts/${targetMapId}/${nid}.${extensionOf(a.file_name ?? '')}`;
          try { await this.r2.copyObject(a.storage_key, destKey); storageKey = destKey; } catch { storageKey = a.storage_key; }
        }
        artifactRows.push({
          id: nid, organization_id: orgId, map_id: targetMapId, name: a.name, description: a.description,
          artifact_type: a.artifact_type, content_type: a.content_type, url: a.url, content_body: a.content_body,
          allow_download: a.allow_download, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes,
          storage_key: storageKey, created_by_user_id: principal.userId,
        });
      }
    } else {
      usedArtifactIds.forEach((id) => newArtifactId.set(id, id));
    }

    // Keep the copied cluster's shape, dropped at the paste point (or nudged off the
    // originals when no point is given, e.g. a same-spot duplicate).
    const rootSet = new Set(roots);
    const rootNodes = roots.map((id) => byId.get(id)!);
    const minX = Math.min(...rootNodes.map((n) => n.position_x));
    const minY = Math.min(...rootNodes.map((n) => n.position_y));
    const baseX = dto.position_x ?? minX + 40;
    const baseY = dto.position_y ?? minY + 40;

    const nodeRows = nodeIdsArr.map((id) => {
      const n = byId.get(id)!;
      const isRoot = rootSet.has(id);
      return {
        id: newNodeId.get(id)!, organization_id: orgId, map_id: targetMapId,
        parent_node_id: isRoot ? targetParent : newNodeId.get(n.parent_node_id!) ?? targetParent,
        kind: n.kind, name: n.name, description: n.description, status: n.status,
        responsible_role_id: n.responsible_role_id, responsible_user_id: n.responsible_user_id,
        // Swimlane placement (pool + department lane) MUST be copied — without it the paste lands
        // in no lane and no swimlane is drawn. layout_frozen is copied too so the cluster keeps its
        // exact shape (positions honoured, not re-flowed).
        pool: n.pool, department_id: n.department_id, layout_frozen: n.layout_frozen,
        position_x: isRoot ? baseX + (n.position_x - minX) : n.position_x,
        position_y: isRoot ? baseY + (n.position_y - minY) : n.position_y,
        sort_order: n.sort_order, linked_map_id: n.linked_map_id, created_by_user_id: principal.userId,
      };
    });
    const connRows = includedConns.map((c) => ({
      id: randomUUID(), organization_id: orgId, map_id: targetMapId,
      parent_node_id: c.parent_node_id && newNodeId.has(c.parent_node_id) ? newNodeId.get(c.parent_node_id)! : targetParent,
      source_node_id: newNodeId.get(c.source_node_id)!, target_node_id: newNodeId.get(c.target_node_id)!,
      label: c.label, condition_kind: c.condition_kind,
      // Keep the designer's chosen connection dots so lines paste attached exactly as drawn.
      source_side: c.source_side, target_side: c.target_side,
    }));
    const linkRows = links.map((l) => ({ id: randomUUID(), node_id: newNodeId.get(l.node_id)!, artifact_id: newArtifactId.get(l.artifact_id) ?? l.artifact_id, direction: l.direction }));
    const checklistRows = checklist.map((c) => ({ id: randomUUID(), node_id: newNodeId.get(c.node_id)!, text: c.text, sort_order: c.sort_order }));
    const accessRows = access.map((a) => ({
      id: randomUUID(), organization_id: orgId, node_id: newNodeId.get(a.node_id)!, kind: a.kind, level: a.level,
      department_id: a.department_id, include_sub_departments: a.include_sub_departments, role_id: a.role_id,
      user_id: a.user_id, created_by_user_id: principal.userId,
    }));

    await this.prisma.$transaction(async (tx) => {
      if (artifactRows.length) await tx.processArtifact.createMany({ data: artifactRows });
      await tx.processNode.createMany({ data: nodeRows });
      if (connRows.length) await tx.processConnection.createMany({ data: connRows });
      if (linkRows.length) await tx.processNodeArtifact.createMany({ data: linkRows });
      if (checklistRows.length) await tx.processChecklistItem.createMany({ data: checklistRows });
      if (accessRows.length) await tx.processNodeAccess.createMany({ data: accessRows });
    });

    // A pasted Company node needs its department lane to exist at its new level, or the swimlane
    // band won't be drawn. Ensure one per distinct (level, department) among the pasted nodes.
    const lanePairs = new Map<string, { parent: string | null; dept: string }>();
    for (const r of nodeRows) {
      if (r.pool === ProcessPool.company && r.department_id) {
        lanePairs.set(`${r.parent_node_id ?? 'root'}:${r.department_id}`, { parent: r.parent_node_id ?? null, dept: r.department_id });
      }
    }
    for (const { parent, dept } of lanePairs.values()) {
      await this.ensureAutoLane(orgId, principal.userId, targetMapId, parent, dept);
    }

    return { pasted_node_ids: roots.map((id) => newNodeId.get(id)!) };
  }
}
