import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Order nodes so every node appears after its parent — used before a bulk createMany so the
 *  parent_node_id self-FK can never reference a not-yet-inserted row when the batch is split.
 *  Nodes with a null/absent parent come first; a (defensive) cycle just gets appended as-is. */
export function orderNodesParentFirst(rows: any[]): any[] {
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
  if (out.length < rows.length)
    for (const r of rows) if (!emitted.has(r.id)) out.push(r);
  return out;
}

/** Load a live (non-deleted) node scoped to its map + org, or 404. Does NOT check access. */
export async function requireProcessNode(
  prisma: PrismaService,
  orgId: string,
  mapId: string,
  nodeId: string,
) {
  const node = await prisma.processNode.findFirst({
    where: {
      id: nodeId,
      map_id: mapId,
      organization_id: orgId,
      is_deleted: false,
    },
  });
  if (!node) throw new NotFoundException('Process node not found');
  return node;
}
