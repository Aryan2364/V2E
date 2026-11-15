import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProcessNodeKind, ProcessPool } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { extensionOf } from '../tasks/task-attachments.service';
import { PasteNodesDto } from './dto/node.dto';
import { requireProcessNode } from './process-helpers';
import { ProcessLaneService } from './process-lane.service';
import { ProcessNodeService } from './process-node.service';
import { ProcessSnapshotService } from './process-snapshot.service';

@Injectable()
export class ProcessNodeCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly r2: R2Service,
    private readonly lanes: ProcessLaneService,
    private readonly nodes: ProcessNodeService,
    private readonly snapshots: ProcessSnapshotService,
  ) {}

  // Clone a serialized map tree into a brand-new map. Inner references (linked_map_id)
  // are preserved as-is — so a detached copy shares the maps its own children point at
  // (clone the top, keep inner refs shared).
  async instantiateTree(
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
      parent_node_id: n.parent_node_id
        ? (nodeId.get(n.parent_node_id) ?? null)
        : null,
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
      .filter(
        (c: any) =>
          nodeId.has(c.source_node_id) && nodeId.has(c.target_node_id),
      )
      .map((c: any) => ({
        id: randomUUID(),
        organization_id: orgId,
        map_id: map.id,
        parent_node_id: c.parent_node_id
          ? (nodeId.get(c.parent_node_id) ?? null)
          : null,
        source_node_id: nodeId.get(c.source_node_id)!,
        target_node_id: nodeId.get(c.target_node_id)!,
        label: c.label ?? null,
        condition_kind: c.condition_kind ?? 'none',
      }));

    const linkRows = (tree.links ?? [])
      .filter(
        (l: any) => nodeId.has(l.node_id) && artifactId.has(l.artifact_id),
      )
      .map((l: any) => ({
        id: randomUUID(),
        node_id: nodeId.get(l.node_id)!,
        artifact_id: artifactId.get(l.artifact_id)!,
        direction: l.direction,
      }));

    const checklistRows = (tree.checklist ?? [])
      .filter((c: any) => nodeId.has(c.node_id))
      .map((c: any) => ({
        id: randomUUID(),
        node_id: nodeId.get(c.node_id)!,
        text: c.text,
        sort_order: c.sort_order ?? 0,
      }));

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
      if (artifactRows.length)
        await tx.processArtifact.createMany({ data: artifactRows });
      if (nodeRows.length) await tx.processNode.createMany({ data: nodeRows });
      if (connectionRows.length)
        await tx.processConnection.createMany({ data: connectionRows });
      if (linkRows.length)
        await tx.processNodeArtifact.createMany({ data: linkRows });
      if (checklistRows.length)
        await tx.processChecklistItem.createMany({ data: checklistRows });
      if (accessRows.length)
        await tx.processNodeAccess.createMany({ data: accessRows });
    });

    return map;
  }

  // Detach a reference into its own independent copy (copy-on-write). Snapshots the
  // referenced map into a new child map here, then repoints this node at the copy.
  async detachNode(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
  ) {
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    if (!node.linked_map_id)
      throw new BadRequestException(
        'This node does not reference a map to copy',
      );
    await this.access.assertCanViewMap(orgId, principal, node.linked_map_id);
    const src = await this.prisma.processMap.findFirst({
      where: {
        id: node.linked_map_id,
        organization_id: orgId,
        is_deleted: false,
      },
      select: { name: true },
    });
    const tree = await this.snapshots.serializeMap(orgId, node.linked_map_id);
    const clone = await this.instantiateTree(
      orgId,
      principal.userId,
      tree,
      `${src?.name ?? node.name} (copy)`,
      { parentMapId: mapId },
    );
    await this.prisma.processNode.update({
      where: { id: nodeId },
      data: { linked_map_id: clone.id },
    });
    return this.nodes.getNode(orgId, principal, mapId, nodeId);
  }

  // Serialize the subtree *under* a node (its children become the new map's top level),
  // re-rooting so connections at the node's own level land at the top of the new map.
  private async serializeSubtree(orgId: string, mapId: string, rootId: string) {
    const [allNodes, allConns] = await Promise.all([
      this.prisma.processNode.findMany({
        where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      }),
      this.prisma.processConnection.findMany({
        where: { organization_id: orgId, map_id: mapId },
      }),
    ]);
    const childrenOf = new Map<string | null, typeof allNodes>();
    for (const n of allNodes) {
      const list = childrenOf.get(n.parent_node_id) ?? [];
      list.push(n);
      childrenOf.set(n.parent_node_id, list);
    }
    const desc: typeof allNodes = [];
    const collect = (pid: string) => {
      for (const c of childrenOf.get(pid) ?? []) {
        desc.push(c);
        collect(c.id);
      }
    };
    collect(rootId);
    const descIds = new Set(desc.map((n) => n.id));

    // Direct children of the root move to the top level; the connection level that lived
    // "inside the root" (parent_node_id === root) becomes the new map's top level too.
    const nodes = desc.map((n) => ({
      ...n,
      parent_node_id: n.parent_node_id === rootId ? null : n.parent_node_id,
    }));
    const connections = allConns
      .filter(
        (c) =>
          (c.parent_node_id === rootId ||
            (c.parent_node_id && descIds.has(c.parent_node_id))) &&
          descIds.has(c.source_node_id) &&
          descIds.has(c.target_node_id),
      )
      .map((c) => ({
        ...c,
        parent_node_id: c.parent_node_id === rootId ? null : c.parent_node_id,
      }));

    const nodeIds = [...descIds];
    const [links, checklist, access] = await Promise.all([
      this.prisma.processNodeArtifact.findMany({
        where: { node_id: { in: nodeIds } },
      }),
      this.prisma.processChecklistItem.findMany({
        where: { node_id: { in: nodeIds } },
      }),
      this.prisma.processNodeAccess.findMany({
        where: { node_id: { in: nodeIds } },
      }),
    ]);
    const artifactIds = [...new Set(links.map((l) => l.artifact_id))];
    const artifacts = artifactIds.length
      ? await this.prisma.processArtifact.findMany({
          where: { id: { in: artifactIds } },
        })
      : [];
    return {
      tree: JSON.parse(
        JSON.stringify({
          version: 1,
          nodes,
          connections,
          artifacts,
          links,
          checklist,
          access,
        }),
      ),
      descIds: nodeIds,
    };
  }

  // "Make reusable": turn a container/sub-process into a standalone map that can be
  // referenced (dropped as a line item) in any map. Build-in-place areas are already
  // maps — we just promote them to top-level + listed; a drill-down container's contents
  // are extracted into a fresh standalone map, and the container becomes a reference to it.
  async makeNodeReusable(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
  ) {
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    if (
      node.kind !== ProcessNodeKind.container &&
      node.kind !== ProcessNodeKind.subprocess
    ) {
      throw new BadRequestException(
        'Only a container or sub-process can become a reusable map',
      );
    }

    // Already a map (build-in-place child, or a shared reference) → just promote it to a
    // top-level, listed master so it shows in the maps list and the reference picker.
    if (node.linked_map_id) {
      const target = await this.prisma.processMap.findFirst({
        where: {
          id: node.linked_map_id,
          organization_id: orgId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Linked map not found');
      await this.prisma.processMap.update({
        where: { id: target.id },
        data: { parent_map_id: null, is_listed: true },
      });
      return this.nodes.getNode(orgId, principal, mapId, nodeId);
    }

    // Drill-down container → extract its contents into a new standalone map, then repoint
    // the container at that map and drop its now-moved in-map children.
    const { tree, descIds } = await this.serializeSubtree(orgId, mapId, nodeId);
    const created = await this.instantiateTree(
      orgId,
      principal.userId,
      tree,
      node.name,
      { parentMapId: null },
    );
    await this.prisma.$transaction(async (tx) => {
      if (descIds.length) {
        await tx.processConnection.deleteMany({
          where: {
            organization_id: orgId,
            map_id: mapId,
            OR: [
              { source_node_id: { in: descIds } },
              { target_node_id: { in: descIds } },
              { parent_node_id: { in: descIds } },
            ],
          },
        });
        await tx.processNodeArtifact.deleteMany({
          where: { node_id: { in: descIds } },
        });
        await tx.processChecklistItem.deleteMany({
          where: { node_id: { in: descIds } },
        });
        await tx.processNodeAccess.deleteMany({
          where: { node_id: { in: descIds } },
        });
        await tx.processNode.updateMany({
          where: { id: { in: descIds } },
          data: { is_deleted: true },
        });
      }
      // The connection level that lived inside this container is gone with the children.
      await tx.processConnection.deleteMany({
        where: {
          organization_id: orgId,
          map_id: mapId,
          parent_node_id: nodeId,
        },
      });
      await tx.processNode.update({
        where: { id: nodeId },
        data: { linked_map_id: created.id },
      });
    });
    return this.nodes.getNode(orgId, principal, mapId, nodeId);
  }

  // Copy/paste: duplicate the given nodes (with their sub-trees, documents, checklist,
  // access and internal connections) into a target map/level. Inner map references stay
  // shared; documents are copied to the target map when pasting across maps.
  async pasteNodes(
    orgId: string,
    principal: Principal,
    targetMapId: string,
    dto: PasteNodesDto,
  ) {
    await this.access.assertCanEditMap(orgId, principal, targetMapId);
    const targetParent = dto.parent_node_id ?? null;
    if (targetParent)
      await this.access.assertCanEditNode(orgId, principal, targetParent);
    await this.access.assertCanViewMap(orgId, principal, dto.source_map_id);

    const srcNodes = await this.prisma.processNode.findMany({
      where: {
        organization_id: orgId,
        map_id: dto.source_map_id,
        is_deleted: false,
      },
    });
    const byId = new Map(srcNodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string | null, typeof srcNodes>();
    for (const n of srcNodes) {
      const l = childrenOf.get(n.parent_node_id) ?? [];
      l.push(n);
      childrenOf.set(n.parent_node_id, l);
    }
    const roots = dto.node_ids.filter((id) => byId.has(id));
    if (!roots.length) throw new BadRequestException('Nothing to paste');
    // Pasting a container inside its own copied sub-tree would recurse; roots are the
    // selection's top level, so just collect each root's descendants once.
    const included = new Set<string>();
    const collect = (id: string) => {
      if (included.has(id)) return;
      included.add(id);
      for (const c of childrenOf.get(id) ?? []) collect(c.id);
    };
    roots.forEach(collect);
    const nodeIdsArr = [...included];

    const [srcConns, links, checklist, access] = await Promise.all([
      this.prisma.processConnection.findMany({
        where: { organization_id: orgId, map_id: dto.source_map_id },
      }),
      this.prisma.processNodeArtifact.findMany({
        where: { node_id: { in: nodeIdsArr } },
      }),
      this.prisma.processChecklistItem.findMany({
        where: { node_id: { in: nodeIdsArr } },
      }),
      this.prisma.processNodeAccess.findMany({
        where: { node_id: { in: nodeIdsArr } },
      }),
    ]);
    const includedConns = srcConns.filter(
      (c) => included.has(c.source_node_id) && included.has(c.target_node_id),
    );

    const newNodeId = new Map<string, string>();
    nodeIdsArr.forEach((id) => newNodeId.set(id, randomUUID()));

    // Documents: reuse the same artifacts on a same-map paste; copy them (and their R2
    // files) into the target map when pasting across maps, so nothing is shared by chance.
    const usedArtifactIds = [...new Set(links.map((l) => l.artifact_id))];
    const newArtifactId = new Map<string, string>();
    const artifactRows: any[] = [];
    if (targetMapId !== dto.source_map_id && usedArtifactIds.length) {
      const arts = await this.prisma.processArtifact.findMany({
        where: { id: { in: usedArtifactIds } },
      });
      for (const a of arts) {
        const nid = randomUUID();
        newArtifactId.set(a.id, nid);
        let storageKey: string | null = a.storage_key ?? null;
        if (a.storage_key) {
          const destKey = `orgs/${orgId}/process-artifacts/${targetMapId}/${nid}.${extensionOf(a.file_name ?? '')}`;
          try {
            await this.r2.copyObject(a.storage_key, destKey);
            storageKey = destKey;
          } catch {
            storageKey = a.storage_key;
          }
        }
        artifactRows.push({
          id: nid,
          organization_id: orgId,
          map_id: targetMapId,
          name: a.name,
          description: a.description,
          artifact_type: a.artifact_type,
          content_type: a.content_type,
          url: a.url,
          content_body: a.content_body,
          allow_download: a.allow_download,
          file_name: a.file_name,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          storage_key: storageKey,
          created_by_user_id: principal.userId,
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
        id: newNodeId.get(id)!,
        organization_id: orgId,
        map_id: targetMapId,
        parent_node_id: isRoot
          ? targetParent
          : (newNodeId.get(n.parent_node_id!) ?? targetParent),
        kind: n.kind,
        name: n.name,
        description: n.description,
        status: n.status,
        responsible_role_id: n.responsible_role_id,
        responsible_user_id: n.responsible_user_id,
        // Swimlane placement (pool + department lane) MUST be copied — without it the paste lands
        // in no lane and no swimlane is drawn. layout_frozen is copied too so the cluster keeps its
        // exact shape (positions honoured, not re-flowed).
        pool: n.pool,
        department_id: n.department_id,
        layout_frozen: n.layout_frozen,
        position_x: isRoot ? baseX + (n.position_x - minX) : n.position_x,
        position_y: isRoot ? baseY + (n.position_y - minY) : n.position_y,
        sort_order: n.sort_order,
        linked_map_id: n.linked_map_id,
        created_by_user_id: principal.userId,
      };
    });
    const connRows = includedConns.map((c) => ({
      id: randomUUID(),
      organization_id: orgId,
      map_id: targetMapId,
      parent_node_id:
        c.parent_node_id && newNodeId.has(c.parent_node_id)
          ? newNodeId.get(c.parent_node_id)!
          : targetParent,
      source_node_id: newNodeId.get(c.source_node_id)!,
      target_node_id: newNodeId.get(c.target_node_id)!,
      label: c.label,
      condition_kind: c.condition_kind,
      // Keep the designer's chosen connection dots so lines paste attached exactly as drawn.
      source_side: c.source_side,
      target_side: c.target_side,
    }));
    const linkRows = links.map((l) => ({
      id: randomUUID(),
      node_id: newNodeId.get(l.node_id)!,
      artifact_id: newArtifactId.get(l.artifact_id) ?? l.artifact_id,
      direction: l.direction,
    }));
    const checklistRows = checklist.map((c) => ({
      id: randomUUID(),
      node_id: newNodeId.get(c.node_id)!,
      text: c.text,
      sort_order: c.sort_order,
    }));
    const accessRows = access.map((a) => ({
      id: randomUUID(),
      organization_id: orgId,
      node_id: newNodeId.get(a.node_id)!,
      kind: a.kind,
      level: a.level,
      department_id: a.department_id,
      include_sub_departments: a.include_sub_departments,
      role_id: a.role_id,
      user_id: a.user_id,
      created_by_user_id: principal.userId,
    }));

    await this.prisma.$transaction(async (tx) => {
      if (artifactRows.length)
        await tx.processArtifact.createMany({ data: artifactRows });
      await tx.processNode.createMany({ data: nodeRows });
      if (connRows.length)
        await tx.processConnection.createMany({ data: connRows });
      if (linkRows.length)
        await tx.processNodeArtifact.createMany({ data: linkRows });
      if (checklistRows.length)
        await tx.processChecklistItem.createMany({ data: checklistRows });
      if (accessRows.length)
        await tx.processNodeAccess.createMany({ data: accessRows });
    });

    // A pasted Company node needs its department lane to exist at its new level, or the swimlane
    // band won't be drawn. Ensure one per distinct (level, department) among the pasted nodes.
    const lanePairs = new Map<
      string,
      { parent: string | null; dept: string }
    >();
    for (const r of nodeRows) {
      if (r.pool === ProcessPool.company && r.department_id) {
        lanePairs.set(`${r.parent_node_id ?? 'root'}:${r.department_id}`, {
          parent: r.parent_node_id ?? null,
          dept: r.department_id,
        });
      }
    }
    for (const { parent, dept } of lanePairs.values()) {
      await this.lanes.ensureAutoLane(
        orgId,
        principal.userId,
        targetMapId,
        parent,
        dept,
      );
    }

    return { pasted_node_ids: roots.map((id) => newNodeId.get(id)!) };
  }
}
