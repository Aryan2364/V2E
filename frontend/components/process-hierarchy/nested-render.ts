// Recursive nested-canvas renderer for the process explorer.
//
// Turns the current map's flow — plus the flows of any *expanded* referenced areas —
// into ReactFlow nodes/edges. An expanded area renders as a "band" (a group node) with
// its child map laid out inside it (children clamped via extent:'parent'); this recurses
// to any depth. The top level keeps the user's stored positions; the inside of every band
// is auto-laid-out with a *size-aware* layered layout so nested bands never overlap.
import { MarkerType, type Edge, type Node } from 'reactflow'
import type { FlowLevel, ProcessNode } from '@/lib/api/process-hierarchy'
import type { ProcessNodeData } from './nodes'
import { DOC_CHIP_W, DOC_CHIP_H } from './nodes'

const DRILLABLE = new Set(['container', 'subprocess'])
const TITLE = 32 // band title-bar height
const PAD = 16 // inner padding inside a band
const COL_GAP = 60
const ROW_GAP = 40

function sizeForKind(kind: string): { w: number; h: number } {
  if (kind === 'container') return { w: 220, h: 88 }
  if (kind === 'decision') return { w: 96, h: 96 }
  if (kind === 'start_event' || kind === 'end_event') return { w: 60, h: 60 }
  if (kind === 'note') return { w: 190, h: 96 }
  return { w: 170, h: 64 } // task, subprocess (collapsed)
}

// Size-aware layered layout (left→right). Columns are spaced by the widest node in the
// previous column; rows by each node's height. Returns top-left positions.
function layoutSized(
  nodes: ProcessNode[],
  connections: FlowLevel['connections'],
  sizeOf: (id: string) => { w: number; h: number },
): Record<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id)
  const idset = new Set(ids)
  const outgoing = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  ids.forEach((id) => { outgoing.set(id, []); indeg.set(id, 0) })
  connections.forEach((c) => {
    if (idset.has(c.source_node_id) && idset.has(c.target_node_id)) {
      outgoing.get(c.source_node_id)!.push(c.target_node_id)
      indeg.set(c.target_node_id, (indeg.get(c.target_node_id) || 0) + 1)
    }
  })
  const layer = new Map<string, number>()
  const remainingIn = new Map(indeg)
  const q = ids.filter((id) => (indeg.get(id) || 0) === 0)
  q.forEach((id) => layer.set(id, 0))
  let guard = 0
  while (q.length && guard++ < ids.length * ids.length + ids.length) {
    const id = q.shift()!
    const l = layer.get(id) || 0
    for (const t of outgoing.get(id)!) {
      layer.set(t, Math.max(layer.get(t) ?? 0, l + 1))
      remainingIn.set(t, (remainingIn.get(t) || 1) - 1)
      if ((remainingIn.get(t) || 0) <= 0) q.push(t)
    }
  }
  ids.forEach((id) => { if (!layer.has(id)) layer.set(id, 0) })

  const order = new Map(ids.map((id, i) => [id, i]))
  const byLayer = new Map<number, string[]>()
  ids.forEach((id) => {
    const l = layer.get(id)!
    const arr = byLayer.get(l) ?? []
    arr.push(id); byLayer.set(l, arr)
  })
  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b)

  const pos: Record<string, { x: number; y: number }> = {}
  let x = 0
  for (const l of layers) {
    const col = byLayer.get(l)!.sort((a, b) => order.get(a)! - order.get(b)!)
    let y = 0
    let maxW = 0
    for (const id of col) {
      const s = sizeOf(id)
      pos[id] = { x, y }
      y += s.h + ROW_GAP
      maxW = Math.max(maxW, s.w)
    }
    x += maxW + COL_GAP
  }
  return pos
}

export interface NestedOpts {
  childFlows: Record<string, FlowLevel>
  expandedIds: Set<string>
  currentMapId: string
  canEdit: boolean
  isTouch?: boolean // touch device: nodes are view + drill only (never draggable), so a tap opens them
  selectedNodeId: string | null
  diffStatus?: Record<string, any> | null
  visibleNodeIds: Set<string> | null
  onEdit: (realNodeId: string) => void
  onToggleExpand: (renderedId: string, desc: SubDesc) => void
  // Open a document (input/output) for preview straight from the canvas.
  onOpenDoc?: (artifactId: string) => void
  // Semantic zoom: when true (zoomed far out), render every area as a box regardless
  // of its expand state — the fine detail would be unreadable anyway.
  lodCollapse?: boolean
}

// How to fetch an area's inner flow: a referenced map (getFlow(linkedMapId, null)) or
// a drill-down container's children (getFlow(mapId, nodeId)). `contentKey` caches it.
export interface SubDesc { contentKey: string; linkedMapId: string | null; mapId: string; nodeId: string }

// A referenced map (composition) OR a drill-down container with children — either can
// be unfolded in place. Returns the cache key + how to load it, or null if it's a leaf.
function subDescOf(n: ProcessNode, mapId: string): SubDesc | null {
  if (n.linked_map_id) return { contentKey: `map:${n.linked_map_id}`, linkedMapId: n.linked_map_id, mapId, nodeId: n.id }
  if (DRILLABLE.has(n.kind) && (n.child_count ?? 0) > 0) return { contentKey: `node:${mapId}:${n.id}`, linkedMapId: null, mapId, nodeId: n.id }
  return null
}

// A map's single way in / way out (for phase connections). Prefer BPMN Start/End
// markers; else the node with no incoming / no outgoing; else first / last.
function entryExitOf(flow: FlowLevel): { entry: string | null; exit: string | null } {
  const ns = flow.nodes.filter((n) => n.kind !== 'note') // notes are annotations, not flow
  if (!ns.length) return { entry: null, exit: null }
  const hasIn = new Set(flow.connections.map((c) => c.target_node_id))
  const hasOut = new Set(flow.connections.map((c) => c.source_node_id))
  const start = ns.find((n) => n.kind === 'start_event')
  const end = ns.find((n) => n.kind === 'end_event')
  const source = ns.find((n) => !hasIn.has(n.id))
  const sink = ns.find((n) => !hasOut.has(n.id))
  return {
    entry: (start ?? source ?? ns[0]).id,
    exit: (end ?? sink ?? ns[ns.length - 1]).id,
  }
}

// renderedId → the real map + node it stands for (for cross-map navigation on click).
export type NodeMeta = Record<string, { mapId: string; realId: string }>

interface Built { nodes: Node<ProcessNodeData>[]; edges: Edge[]; width: number; height: number }

// Build the rendered content of one map. `parentId` = the band this content sits inside
// (undefined at the top level, where stored positions + the visibility filter apply).
function buildContent(
  flow: FlowLevel, prefix: string, parentId: string | undefined, mapId: string,
  opts: NestedOpts, meta: NodeMeta,
): Built {
  const top = parentId === undefined
  // Deeper areas stack above shallower ones so an unfolded band's content is never
  // hidden behind a neighbouring collapsed box (which would otherwise paint on top).
  const depth = (prefix.match(/::/g) || []).length

  const descOf = new Map(flow.nodes.map((n) => [n.id, subDescOf(n, mapId)]))

  // Recurse into expanded areas first, so we know each band's size. When zoomed far
  // out (lodCollapse) we skip this, so everything renders as boxes. An area's inner
  // flow lives in its linked map (reference) or in this same map (drill-down child).
  const sub = new Map<string, Built>()
  if (!opts.lodCollapse) {
    for (const n of flow.nodes) {
      const rid = prefix + n.id
      const desc = descOf.get(n.id)
      if (opts.expandedIds.has(rid) && desc && opts.childFlows[desc.contentKey]) {
        const childMapId = desc.linkedMapId ?? mapId
        sub.set(n.id, buildContent(opts.childFlows[desc.contentKey], rid + '::', rid, childMapId, opts, meta))
      }
    }
  }
  const kindOf = new Map(flow.nodes.map((n) => [n.id, n.kind]))
  const sizeOf = (id: string) => sub.has(id) ? { w: sub.get(id)!.width, h: sub.get(id)!.height } : sizeForKind(kindOf.get(id)!)

  // Push-down: at the top level, when an area is unfolded (taller than its collapsed
  // box) the areas sharing its column below it shift down just enough to clear it.
  // Computed from stored positions every render, so collapsing reverts exactly — and
  // when nothing is unfolded, display heights == box heights and nothing moves.
  const PUSH_GAP = 24
  const displayY: Record<string, number> = {}
  if (top) {
    // Notes float freely — they never push steps or get pushed (they keep their position
    // via the posOf fallback below).
    const ordered = [...flow.nodes].filter((n) => n.kind !== 'note').sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x)
    for (const n of ordered) {
      const nw = sizeOf(n.id).w
      let shift = 0
      for (const m of ordered) {
        if (m.id === n.id) continue
        // only nodes placed above n (already resolved); skip peers below or to the side
        if (m.position_y > n.position_y || (m.position_y === n.position_y && m.position_x >= n.position_x)) continue
        const ms = sizeOf(m.id)
        const overlapX = Math.min(n.position_x + nw, m.position_x + ms.w) - Math.max(n.position_x, m.position_x)
        if (overlapX <= 0) continue // different column — no push
        // Only EXPANSION (an unfolded container growing past its base height) pushes the nodes
        // below it down, cascaded. A node that hasn't grown contributes NO push — so stored
        // positions are honoured exactly and every node (start markers included) drags freely,
        // up or down, and stays where it's dropped instead of snapping back.
        const grow = Math.max(0, ms.h - sizeForKind(kindOf.get(m.id)!).h)
        const mShift = (displayY[m.id] - m.position_y) + (grow > 0.5 ? grow + PUSH_GAP : 0)
        if (mShift > shift) shift = mShift
      }
      displayY[n.id] = n.position_y + shift
    }
  }

  const auto = top ? null : layoutSized(flow.nodes, flow.connections, sizeOf)
  const posOf = (n: ProcessNode) => top
    ? { x: n.position_x, y: displayY[n.id] ?? n.position_y }
    : { x: (auto![n.id]?.x ?? 0) + PAD, y: (auto![n.id]?.y ?? 0) + TITLE }

  const nodes: Node<ProcessNodeData>[] = []
  const edges: Edge[] = []
  let maxX = 0, maxY = 0

  for (const n of flow.nodes) {
    if (top && opts.visibleNodeIds && !opts.visibleNodeIds.has(n.id)) continue
    const rid = prefix + n.id
    const desc = descOf.get(n.id) ?? null
    meta[rid] = { mapId, realId: n.id }
    const p = posOf(n)
    const s = sizeOf(n.id)
    maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h)

    if (sub.has(n.id)) {
      const c = sub.get(n.id)!
      nodes.push({
        id: rid, type: 'band', position: p,
        parentNode: parentId, extent: parentId ? 'parent' : undefined,
        draggable: top && opts.canEdit && !opts.isTouch, selectable: false,
        zIndex: 1000 + depth,
        style: { width: s.w, height: s.h },
        data: {
          name: n.name, kind: n.kind, childCount: 0, drillable: false,
          selected: top && n.id === opts.selectedNodeId,
          onToggleExpand: () => desc && opts.onToggleExpand(rid, desc),
        },
      })
      nodes.push(...c.nodes)
      edges.push(...c.edges)
    } else {
      nodes.push({
        id: rid, type: 'process', position: p,
        parentNode: parentId, extent: parentId ? 'parent' : undefined,
        draggable: top && opts.canEdit && !opts.isTouch, selectable: top,
        zIndex: parentId ? 1000 + depth : undefined,
        data: {
          name: n.name, kind: n.kind, childCount: n.child_count ?? 0,
          docCount: (n.inputs?.length ?? 0) + (n.outputs?.length ?? 0),
          checklist: n.checklist ?? [],
          drillable: DRILLABLE.has(n.kind),
          selected: top && n.id === opts.selectedNodeId,
          diff: top ? opts.diffStatus?.[n.id] : undefined,
          linkedMapName: n.linked_map_name ?? null,
          onEdit: top ? () => opts.onEdit(n.id) : undefined,
          canExpand: !!desc,
          onToggleExpand: desc ? () => opts.onToggleExpand(rid, desc) : undefined,
        },
      })
    }

    // Document chips: each input hangs above the node (line comes down into it), each
    // output below (line goes out to it), both clickable to preview. Only at the top
    // level and only when zoomed in enough to read them.
    if (top && !opts.lodCollapse) {
      const DOC_VGAP = 34, DOC_HGAP = 10
      for (const row of [
        { io: 'input' as const, docs: n.inputs ?? [], y: p.y - DOC_CHIP_H - DOC_VGAP, color: 'var(--text-secondary)' },
        { io: 'output' as const, docs: n.outputs ?? [], y: p.y + s.h + DOC_VGAP, color: 'var(--text-secondary)' },
      ]) {
        if (!row.docs.length) continue
        const totalW = row.docs.length * DOC_CHIP_W + (row.docs.length - 1) * DOC_HGAP
        const startX = p.x + s.w / 2 - totalW / 2
        row.docs.forEach((a, i) => {
          const cid = `${rid}::doc::${row.io}::${a.id}`
          nodes.push({
            id: cid, type: 'document', draggable: false, selectable: false,
            position: { x: startX + i * (DOC_CHIP_W + DOC_HGAP), y: row.y },
            data: { name: a.name, contentType: a.content_type ?? 'file', io: row.io, onOpen: () => opts.onOpenDoc?.(a.id) },
          } as Node<any>)
          edges.push({
            id: cid + '::assoc',
            source: row.io === 'input' ? cid : rid,
            target: row.io === 'input' ? rid : cid,
            type: 'floating',
            markerEnd: { type: MarkerType.ArrowClosed, color: row.color, width: 11, height: 11 },
            style: { stroke: row.color, strokeWidth: 1.3, strokeDasharray: '4 3' },
          } as Edge)
        })
        maxX = Math.max(maxX, startX + totalW)
        maxY = Math.max(maxY, row.y + DOC_CHIP_H)
      }
    }
  }

  // Connectors at this level (decision Yes/No labels; documents render as chips above).
  for (const c of flow.connections) {
    const fromDecision = kindOf.get(c.source_node_id) === 'decision'
    const label = c.label || (c.condition_kind !== 'none' ? c.condition_kind.toUpperCase() : '')

    // Phase connection: if an endpoint is unfolded, wire to the *exit* of its map
    // (source) or the *entry* of its map (target) — "end of A hands off to start of B".
    let src = prefix + c.source_node_id
    let tgt = prefix + c.target_node_id
    if (sub.has(c.source_node_id)) {
      const d = descOf.get(c.source_node_id)
      const cf = d ? opts.childFlows[d.contentKey] : null
      const ex = cf ? entryExitOf(cf).exit : null
      if (ex) src = prefix + c.source_node_id + '::' + ex
    }
    if (sub.has(c.target_node_id)) {
      const d = descOf.get(c.target_node_id)
      const cf = d ? opts.childFlows[d.contentKey] : null
      const en = cf ? entryExitOf(cf).entry : null
      if (en) tgt = prefix + c.target_node_id + '::' + en
    }

    edges.push({
      id: prefix + c.id,
      source: src,
      target: tgt,
      sourceHandle: fromDecision && src === prefix + c.source_node_id ? (c.condition_kind === 'no' ? 'no' : 'yes') : undefined,
      type: 'floating',
      data: { label: label || undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: top ? 'var(--text-muted)' : 'var(--text-muted)' },
      style: { stroke: top ? 'var(--text-muted)' : 'var(--text-muted)', strokeWidth: top ? 1.5 : 1.2 },
    } as Edge)
  }

  return { nodes, edges, width: maxX + PAD, height: maxY + PAD }
}

export function buildNested(flow: FlowLevel, opts: NestedOpts): { nodes: Node<ProcessNodeData>[]; edges: Edge[]; meta: NodeMeta } {
  const meta: NodeMeta = {}
  const built = buildContent(flow, '', undefined, opts.currentMapId, opts, meta)
  return { nodes: built.nodes, edges: built.edges, meta }
}
