import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { computeMapDiff, type MapDiff } from './process-diff';
import { CreateSnapshotDto } from './dto/snapshot.dto';
import { orderNodesParentFirst } from './process-helpers';

@Injectable()
export class ProcessSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
  ) {}

  // ─── Snapshots (create + restore; DIFF is Phase 2) ─────────────────────────────

  async listSnapshots(orgId: string, principal: Principal, mapId: string) {
    await this.access.assertCanViewMap(orgId, principal, mapId);
    return this.prisma.processSnapshot.findMany({
      where: { organization_id: orgId, map_id: mapId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        label: true,
        status: true,
        created_by_user_id: true,
        created_at: true,
      },
    });
  }

  async createSnapshot(
    orgId: string,
    principal: Principal,
    mapId: string,
    dto: CreateSnapshotDto,
  ) {
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
      select: {
        id: true,
        label: true,
        status: true,
        created_by_user_id: true,
        created_at: true,
      },
    });
  }

  async serializeMap(orgId: string, mapId: string) {
    // Only NON-deleted nodes go in the blob, so every sub-resource must be scoped to THAT set —
    // otherwise a connection / link / checklist / access row that still references a soft-deleted
    // node would be in the blob but its node wouldn't, and restore (wipe + recreate) would hit a
    // foreign-key violation recreating that orphan. Scope everything to the included node ids.
    const nodes = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
    });
    const nodeIds = nodes.map((n) => n.id);
    const nodeIdSet = new Set(nodeIds);
    const [connectionsAll, artifacts, lanes, links, checklist, access] =
      await Promise.all([
        this.prisma.processConnection.findMany({
          where: { organization_id: orgId, map_id: mapId },
        }),
        this.prisma.processArtifact.findMany({
          where: { organization_id: orgId, map_id: mapId },
        }),
        this.prisma.processLane.findMany({
          where: { organization_id: orgId, map_id: mapId },
        }),
        nodeIds.length
          ? this.prisma.processNodeArtifact.findMany({
              where: { node_id: { in: nodeIds } },
            })
          : [],
        nodeIds.length
          ? this.prisma.processChecklistItem.findMany({
              where: { node_id: { in: nodeIds } },
            })
          : [],
        nodeIds.length
          ? this.prisma.processNodeAccess.findMany({
              where: { organization_id: orgId, node_id: { in: nodeIds } },
            })
          : [],
      ]);
    // Drop any connection whose endpoints aren't both in the (non-deleted) node set.
    const connections = connectionsAll.filter(
      (c) => nodeIdSet.has(c.source_node_id) && nodeIdSet.has(c.target_node_id),
    );
    // JSON round-trip converts Date instances to ISO strings so the value satisfies
    // Prisma's Json input type (and restore feeds the strings straight back to createMany,
    // which accepts ISO-8601 for DateTime columns). Lanes are captured too, else undo would
    // silently lose swimlane add/remove/reorder (lanes reference no node, so they restore freely).
    return JSON.parse(
      JSON.stringify({
        version: 1,
        nodes,
        connections,
        artifacts,
        lanes,
        links,
        checklist,
        access,
      }),
    );
  }

  async restoreSnapshot(
    orgId: string,
    principal: Principal,
    mapId: string,
    snapshotId: string,
  ) {
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
  async restoreState(
    orgId: string,
    principal: Principal,
    mapId: string,
    tree: any,
  ) {
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
  async applyTree(orgId: string, mapId: string, tree: any) {
    const withOrgMap = (rows: any[] | undefined) =>
      (rows ?? []).map((r) => ({
        ...r,
        organization_id: orgId,
        map_id: mapId,
      }));
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
      n.parent_node_id && !nodeIdSet.has(n.parent_node_id)
        ? { ...n, parent_node_id: null }
        : n,
    );
    // Insert parents before children. A single multi-row INSERT checks the self-FK at statement end
    // (order-independent), but Prisma may split a large createMany into several statements — each of
    // which is checked on its own — so order defensively to guarantee a parent is never referenced
    // before it exists.
    const nodes = orderNodesParentFirst(nodesSanitised);
    const connections = withOrgMap(tree.connections).filter(
      (c) => nodeIdSet.has(c.source_node_id) && nodeIdSet.has(c.target_node_id),
    );
    const links = (tree.links ?? []).filter(
      (l: any) => nodeIdSet.has(l.node_id) && artIdSet.has(l.artifact_id),
    ); // node_id + artifact_id only
    const checklist = (tree.checklist ?? []).filter((c: any) =>
      nodeIdSet.has(c.node_id),
    ); // node_id only
    const access = withOrg(tree.access).filter((a) => nodeIdSet.has(a.node_id));

    await this.prisma.$transaction(
      async (tx) => {
        // Wipe the working tree (hard delete — the supplied state is the source of truth).
        await tx.processConnection.deleteMany({
          where: { organization_id: orgId, map_id: mapId },
        });
        await tx.processNodeArtifact.deleteMany({
          where: { node: { organization_id: orgId, map_id: mapId } },
        });
        await tx.processChecklistItem.deleteMany({
          where: { node: { organization_id: orgId, map_id: mapId } },
        });
        await tx.processNodeAccess.deleteMany({
          where: { organization_id: orgId, node: { map_id: mapId } },
        });
        await tx.processLane.deleteMany({
          where: { organization_id: orgId, map_id: mapId },
        });
        await tx.processNode.deleteMany({
          where: { organization_id: orgId, map_id: mapId },
        });
        await tx.processArtifact.deleteMany({
          where: { organization_id: orgId, map_id: mapId },
        });

        // Recreate (ids preserved so relations resolve).
        if (artifacts.length)
          await tx.processArtifact.createMany({ data: artifacts });
        if (nodes.length) await tx.processNode.createMany({ data: nodes });
        if (lanes.length) await tx.processLane.createMany({ data: lanes });
        if (connections.length)
          await tx.processConnection.createMany({ data: connections });
        if (links.length)
          await tx.processNodeArtifact.createMany({ data: links });
        if (checklist.length)
          await tx.processChecklistItem.createMany({ data: checklist });
        if (access.length)
          await tx.processNodeAccess.createMany({ data: access });
      },
      // Wipe + rebuild of a whole map is far heavier than a single write; the 5s interactive-transaction
      // default 500s on large production maps. Give it room.
      { timeout: 30000, maxWait: 10000 },
    );
  }

  // ─── Diff (as-is vs to-be) ─────────────────────────────────────────────────────

  /** Resolve a tree ref: 'live' → serialize the working map; else a snapshot id. */
  async treeFor(orgId: string, mapId: string, ref: string): Promise<any> {
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
    const [b, t] = await Promise.all([
      this.treeFor(orgId, mapId, base),
      this.treeFor(orgId, mapId, target),
    ]);
    return { base, target, ...computeMapDiff(b, t) };
  }
}
