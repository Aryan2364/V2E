import { Injectable } from '@nestjs/common';
import { ProcessNodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { requireProcessNode } from './process-helpers';

@Injectable()
export class ProcessReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Status workflow (draft → in_review → final) ───────────────────────────────

  /** node + all descendants (ids), scoped to the map. */
  private async subtreeIds(
    orgId: string,
    mapId: string,
    nodeId: string,
  ): Promise<string[]> {
    const all = await this.prisma.processNode.findMany({
      where: { organization_id: orgId, map_id: mapId, is_deleted: false },
      select: { id: true, parent_node_id: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parent_node_id) continue;
      (
        childrenOf.get(n.parent_node_id) ??
        childrenOf.set(n.parent_node_id, []).get(n.parent_node_id)!
      ).push(n.id);
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

  async requestReview(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    cascade: boolean,
  ) {
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const ids = cascade
      ? await this.subtreeIds(orgId, mapId, nodeId)
      : [nodeId];
    await this.prisma.processNode.updateMany({
      where: { id: { in: ids }, organization_id: orgId },
      data: { status: ProcessNodeStatus.in_review },
    });
    const map = await this.prisma.processMap.findFirst({
      where: { id: mapId },
      select: { created_by_user_id: true, name: true },
    });
    if (map && map.created_by_user_id !== principal.userId) {
      const who = await this.notifications
        .userName(principal.userId)
        .catch(() => 'Someone');
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
    const node = await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditMap(orgId, principal, mapId); // approve / send-back = owner or admin
    const ids = cascade
      ? await this.subtreeIds(orgId, mapId, nodeId)
      : [nodeId];
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
    if (
      recipients.length &&
      (status === ProcessNodeStatus.final || status === ProcessNodeStatus.draft)
    ) {
      const map = await this.prisma.processMap.findFirst({
        where: { id: mapId },
        select: { name: true },
      });
      await this.notifications.emit({
        orgId,
        module: 'process_hierarchy',
        event_type:
          status === ProcessNodeStatus.final
            ? 'process_finalized'
            : 'process_sent_back',
        recipients,
        title:
          status === ProcessNodeStatus.final
            ? 'Process marked final'
            : 'Process sent back to draft',
        body: `"${node.name}" in ${map?.name ?? 'a process map'} was ${
          status === ProcessNodeStatus.final
            ? 'marked final'
            : 'sent back to draft'
        }.`,
        link: `/dashboard/process-hierarchy/${mapId}`,
        entity: { type: 'process_node', id: nodeId },
      });
    }
    return { updated: ids.length };
  }
}
