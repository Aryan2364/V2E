// Swimlane layout for the process explorer (Phase 2).
//
// Arranges one flow level's steps into stacked BPMN pools with department lanes:
//   Customer (top) · Company [dept lanes…] · Vendor · then lane-less steps below (no band).
// Each lane is a single left→right row: a step is placed in the next free column of its
// lane, so new steps land to the RIGHT of existing ones, never stacked underneath. Columns
// still respect the flow order (longest-path depth) so connected steps read left→right and
// downstream steps sit further right. Connections within a pool are solid; across pools dotted.
import type React from 'react'
import { type Edge, type Node } from 'reactflow'
import type { FlowLevel, ProcessNode, ProcessPool } from '@/lib/api/process-hierarchy'
import type { ProcessNodeData, SwimlaneBandData } from './nodes'

const DRILLABLE = new Set(['container', 'subprocess'])

const POOL_LABEL_W = 30 // left strip for the pool label (vertical text)
const LANE_LABEL_W = 30 // second strip for the lane (department) label
export const CONTENT_X = POOL_LABEL_W + LANE_LABEL_W + 20 // left edge of content; also the min x for a dragged node
const COL_GAP = 56
const ROW_H = 112 // height of a lane's single row (all steps sit on one line; no row-dropping)
const BAND_PAD = 14 // vertical padding inside a lane band
const LANE_BOTTOM_ROOM = 92 // extra room below a lane's last row so a new step can be dropped underneath and still land IN the lane
const NODE_H = 96 // baseline (min) wrapper height for a step; taller content (checklist/docs) grows it
const RIGHT_PAD = 80
const LOOSE_GAP = 44 // gap below the pools where lane-less steps sit

function sizeForKind(kind: string): { w: number; h: number } {
  if (kind === 'container') return { w: 220, h: 88 }
  if (kind === 'decision') return { w: 96, h: 96 }
  if (kind === 'start_event' || kind === 'end_event') return { w: 60, h: 60 }
  return { w: 170, h: 64 } // task, subprocess
}

// A node's pool "group" for the cross-pool (message-flow) test. Lane-less steps group as
// 'none' — a connection between two of those stays solid.
type PoolGroup = ProcessPool | 'none'
const groupOf = (n: Pick<ProcessNode, 'pool'>): PoolGroup => (n.pool ?? 'none')

export interface SwimlaneOpts {
  selectedNodeId: string | null
  canEdit: boolean
  isTouch?: boolean // touch device: steps are view + drill only (never draggable), so a tap opens them
  diffStatus?: Record<string, any> | null
  onEdit: (realNodeId: string) => void
  // Add a step straight into a lane (from the lane's "+"). deptId is null for Customer/Vendor.
  onAddInLane?: (pool: ProcessPool, departmentId: string | null) => void
  // Rename a lane = re-point it at a different department (its steps move with it).
  onRenameLane?: (laneId: string, departmentId: string, currentName: string) => void
  // Drag a lane's grip to reorder it among the department lanes; drag a pool's grip to reorder pools.
  // The identifier is the lane's DEPARTMENT id (matches the band DOM key); the canvas maps it back
  // to lane ids when it saves the new order.
  onLaneReorderStart?: (e: React.PointerEvent, departmentId: string) => void
  onPoolReorderStart?: (e: React.PointerEvent, pool: ProcessPool) => void
}

interface Band { key: string; variant: 'pool' | 'lane'; label: string; pool: ProcessPool; deptId: string | null; laneId?: string }

export interface LaneBand { pool: ProcessPool; deptId: string | null; yTop: number; yBottom: number; offset: number }

export function buildSwimlane(
  flow: FlowLevel,
  opts: SwimlaneOpts,
): { nodes: Node<any>[]; edges: Edge[]; meta: Record<string, { mapId: string; realId: string }>; laneBands: LaneBand[]; autoPositions: Record<string, { x: number; y: number }> } {
  const steps = flow.nodes.filter((n) => n.kind !== 'note')
  const nodeById = new Map(steps.map((n) => [n.id, n]))
  const idset = new Set(steps.map((n) => n.id))

  // ── Longest-path depth per node (respects the drawn flow). ──
  const outgoing = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  steps.forEach((n) => { outgoing.set(n.id, []); indeg.set(n.id, 0) })
  flow.connections.forEach((c) => {
    if (idset.has(c.source_node_id) && idset.has(c.target_node_id)) {
      outgoing.get(c.source_node_id)!.push(c.target_node_id)
      indeg.set(c.target_node_id, (indeg.get(c.target_node_id) || 0) + 1)
    }
  })
  const layerOf = new Map<string, number>()
  const remaining = new Map(indeg)
  const q = steps.map((n) => n.id).filter((id) => (indeg.get(id) || 0) === 0)
  q.forEach((id) => layerOf.set(id, 0))
  let guard = 0
  while (q.length && guard++ < steps.length * steps.length + steps.length) {
    const id = q.shift()!
    const l = layerOf.get(id) || 0
    for (const t of outgoing.get(id)!) {
      layerOf.set(t, Math.max(layerOf.get(t) ?? 0, l + 1))
      remaining.set(t, (remaining.get(t) || 1) - 1)
      if ((remaining.get(t) || 0) <= 0) q.push(t)
    }
  }
  steps.forEach((n) => { if (!layerOf.has(n.id)) layerOf.set(n.id, 0) })

  const bandKeyOf = (n: ProcessNode): string => {
    if (n.pool === 'company' && n.department_id) return 'lane:' + n.department_id
    if (n.pool === 'customer') return 'pool:customer'
    if (n.pool === 'vendor') return 'pool:vendor'
    return 'loose'
  }

  // ── Per-lane left→right cascade: within a lane, each step takes the next free column
  // (max of its flow-depth and the lane's running column), so steps never stack. ──
  const ordered = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const colOf = new Map<string, number>()
  const laneNext = new Map<string, number>()
  for (const n of ordered) {
    const key = bandKeyOf(n)
    const col = Math.max(layerOf.get(n.id) ?? 0, laneNext.get(key) ?? 0)
    colOf.set(n.id, col)
    laneNext.set(key, col + 1)
  }

  const maxCol = colOf.size ? Math.max(...Array.from(colOf.values())) : 0
  const widthOfCol = new Map<number, number>()
  for (const n of steps) {
    const c = colOf.get(n.id)!
    widthOfCol.set(c, Math.max(widthOfCol.get(c) ?? 0, sizeForKind(n.kind).w))
  }
  // A connection's label sits in the gap between its two columns — widen that gap so the label
  // isn't squeezed and the line stays visible on both sides of it.
  const labelText = (c: FlowLevel['connections'][number]) => c.label || (c.condition_kind !== 'none' ? c.condition_kind.toUpperCase() : '')
  const gapForCol = new Map<number, number>()
  for (const c of flow.connections) {
    const sc = colOf.get(c.source_node_id), tc = colOf.get(c.target_node_id)
    const lab = labelText(c)
    if (sc == null || tc == null || !lab || tc <= sc) continue
    const need = lab.length * 7 + 40 // rough label width + breathing room for line on each side
    for (let g = sc; g < tc; g++) gapForCol.set(g, Math.max(gapForCol.get(g) ?? 0, Math.ceil(need / (tc - sc))))
  }
  const colX = new Map<number, number>()
  let cx = CONTENT_X
  for (let c = 0; c <= maxCol; c++) {
    colX.set(c, cx)
    cx += (widthOfCol.get(c) ?? 170) + Math.max(COL_GAP, gapForCol.get(c) ?? 0)
  }
  // Where the user *wants* a node horizontally: its hand-dragged x if set, else its auto column.
  // (Vertical is always the lane row — horizontal is the only thing the user places by hand.)
  const desiredX = (id: string) => {
    const px = nodeById.get(id)?.position_x ?? 0
    return px >= CONTENT_X ? px : (colX.get(colOf.get(id) ?? 0) ?? CONTENT_X)
  }

  // ── Rows within a lane. Only a decision with MORE THAN ONE branch drops its extra branch(es)
  // to lower rows so they don't overlap (Yes stays on the line, No drops below). A single branch
  // never drops (no needless inverted-S). Downstream inherits its row; merges rejoin upward. ──
  const rankCond = (c: string) => (c === 'yes' ? 0 : c === 'no' ? 1 : 2)
  const outBySource = new Map<string, { target: string; cond: string }[]>()
  const incoming = new Map<string, { src: string; cond: string }[]>()
  flow.connections.forEach((c) => {
    if (!idset.has(c.source_node_id) || !idset.has(c.target_node_id)) return
    ;(outBySource.get(c.source_node_id) ?? outBySource.set(c.source_node_id, []).get(c.source_node_id)!).push({ target: c.target_node_id, cond: c.condition_kind })
    ;(incoming.get(c.target_node_id) ?? incoming.set(c.target_node_id, []).get(c.target_node_id)!).push({ src: c.source_node_id, cond: c.condition_kind })
  })
  const branchOffset = new Map<string, number>() // "src->target" → extra rows below the source
  for (const [src, outs] of Array.from(outBySource.entries())) {
    if (nodeById.get(src)?.kind !== 'decision' || outs.length <= 1) continue
    // Only branches that land in the SAME lane collide — stack those. Branches in different lanes
    // are already separated, so they stay on their own row 0.
    const byTargetBand = new Map<string, { target: string; cond: string }[]>()
    for (const o of outs) {
      const tn = nodeById.get(o.target)
      const bk = tn ? bandKeyOf(tn) : 'loose'
      ;(byTargetBand.get(bk) ?? byTargetBand.set(bk, []).get(bk)!).push(o)
    }
    for (const group of Array.from(byTargetBand.values())) {
      if (group.length > 1) group.sort((a, b) => rankCond(a.cond) - rankCond(b.cond)).forEach((o, i) => branchOffset.set(src + '->' + o.target, i))
    }
  }
  const rowOf = new Map<string, number>()
  steps.forEach((n) => rowOf.set(n.id, 0))
  const byCol = [...steps].sort((a, b) => (colOf.get(a.id)! - colOf.get(b.id)!) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)))
  for (const n of byCol) {
    const ins = incoming.get(n.id) ?? []
    if (!ins.length) continue
    let r = Infinity
    for (const e of ins) r = Math.min(r, (rowOf.get(e.src) ?? 0) + (branchOffset.get(e.src + '->' + n.id) ?? 0))
    if (r !== Infinity) rowOf.set(n.id, r)
  }

  // ── Horizontal placement: honour a hand-dragged x, but a node can't sit BEHIND a step that
  // flows INTO it (same lane = past its right edge; another lane = not left of it). This is the
  // only constraint — it applies to CONNECTED steps only. An unconnected node (a decision or a new
  // task you haven't wired yet) is left exactly where you drop it, so you can freely drag one back
  // to insert it between others. (Walk in flow-column order so a predecessor is placed first.) ──
  const xFinal = new Map<string, number>()
  for (const n of byCol) {
    const lane = bandKeyOf(n)
    let floor = CONTENT_X
    for (const e of (incoming.get(n.id) ?? [])) {
      const sx = xFinal.get(e.src)
      if (sx == null) continue // predecessor not placed yet (rare column inversion) — skip its floor
      const src = nodeById.get(e.src)!
      floor = Math.max(floor, bandKeyOf(src) === lane ? sx + sizeForKind(src.kind).w + COL_GAP : sx)
    }
    xFinal.set(n.id, Math.max(desiredX(n.id), floor))
  }
  const xOf = (id: string) => xFinal.get(id) ?? CONTENT_X

  // ── Bands, top→bottom. Pool order follows the stored pool_order for this level (fall back to the
  // conventional Customer · Company · Vendor); department lanes within Company keep their sort_order.
  // No "Unassigned" band. ──
  const hasCustomer = steps.some((n) => n.pool === 'customer')
  const hasVendor = steps.some((n) => n.pool === 'vendor')
  const hasCompany = flow.lanes.length > 0 || steps.some((n) => n.pool === 'company')
  const poolGroup: Record<ProcessPool, Band[]> = {
    customer: hasCustomer ? [{ key: 'pool:customer', variant: 'pool', label: 'Customer', pool: 'customer', deptId: null }] : [],
    company: hasCompany ? flow.lanes.map((lane) => ({ key: 'lane:' + lane.department_id, variant: 'lane' as const, label: lane.department_name, pool: 'company' as ProcessPool, deptId: lane.department_id, laneId: lane.id })) : [],
    vendor: hasVendor ? [{ key: 'pool:vendor', variant: 'pool', label: 'Vendor', pool: 'vendor', deptId: null }] : [],
  }
  const DEFAULT_POOL_ORDER: ProcessPool[] = ['customer', 'company', 'vendor']
  const storedOrder = (flow.pool_order ?? []).filter((p): p is ProcessPool => p === 'customer' || p === 'company' || p === 'vendor')
  const poolOrder = [...storedOrder, ...DEFAULT_POOL_ORDER.filter((p) => !storedOrder.includes(p))]
  const bands: Band[] = []
  let companyStart = 0, companyEnd = 0
  for (const pool of poolOrder) {
    if (pool === 'company') { companyStart = bands.length; bands.push(...poolGroup.company); companyEnd = bands.length }
    else bands.push(...poolGroup[pool])
  }

  // A lane is as many rows tall as its deepest branch needs (≥1).
  const byBand = new Map<string, string[]>()
  for (const n of steps) { const k = bandKeyOf(n); (byBand.get(k) ?? byBand.set(k, []).get(k)!).push(n.id) }

  // Estimate a step's rendered height so a lane can grow to CONTAIN a tall step (long name that
  // wraps, a checklist line, doc chips) instead of the node spilling past the swimlane border.
  // Biased to slightly over-estimate — extra whitespace is fine, a clipped node isn't.
  const estStepHeight = (n: ProcessNode): number => {
    const perLine = Math.max(10, Math.floor((sizeForKind(n.kind).w - 46) / 7)) // ~7px/char at 13px, less icon+padding
    const nameLines = Math.max(1, Math.ceil((n.name?.length || 1) / perLine))
    let h = 22 + nameLines * 18 // vertical padding + wrapped name
    if (((n.inputs?.length ?? 0) + (n.outputs?.length ?? 0)) > 0 || DRILLABLE.has(n.kind) || n.linked_map_name) h += 20 // doc / open row
    if ((n.checklist?.length ?? 0) > 0) h += 26 // checklist summary line
    return Math.max(NODE_H, h)
  }
  // Per-lane row height: tall enough for the lane's biggest step, never below the baseline.
  const ROW_GAP = 18
  const rowHOf = new Map<string, number>()
  for (const [key, ids] of Array.from(byBand)) {
    const tallest = ids.length ? Math.max(...ids.map((id: string) => estStepHeight(nodeById.get(id)!))) : NODE_H
    rowHOf.set(key, Math.max(ROW_H, tallest + ROW_GAP))
  }
  const rowHFor = (key: string) => rowHOf.get(key) ?? ROW_H

  const bandHeightOf = (b: Band) => {
    const ids = byBand.get(b.key) ?? []
    const rows = ids.length ? Math.max(...ids.map((id) => rowOf.get(id) ?? 0)) + 1 : 1
    return rows * rowHFor(b.key) + 2 * BAND_PAD
  }

  // Stack bands top→bottom. Lanes inside the Company pool are flush; a gap separates the
  // three pools (Customer / Company / Vendor) so they don't share borders.
  const POOL_GAP = 28
  const bandY = new Map<string, number>()
  const bandH = new Map<string, number>()
  let y = 0
  let prevPool: ProcessPool | null = null
  for (const b of bands) {
    if (prevPool !== null && b.pool !== prevPool) y += POOL_GAP
    const h = bandHeightOf(b)
    bandY.set(b.key, y); bandH.set(b.key, h); y += h
    prevPool = b.pool
  }
  const bandsBottom = y

  const maxRight = steps.length ? Math.max(...steps.map((n) => xOf(n.id) + sizeForKind(n.kind).w)) : CONTENT_X
  const totalWidth = maxRight + RIGHT_PAD

  // Band backgrounds are pushed AFTER the step nodes below, so each band can be drawn to wrap its
  // members' ACTUAL (frozen/stored) positions rather than a connection-derived height. bandY/bandH
  // above stay only as the fallback layout for not-yet-frozen nodes.
  const nodes: Node<any>[] = []
  const meta: Record<string, { mapId: string; realId: string }> = {}
  const autoPositions: Record<string, { x: number; y: number }> = {}

  // ── PASS 1 — the "raw" spot each step wants: a frozen node's stored (x,y), else the auto
  // (column, row) position from the graph. We don't render at these directly; we use them only to
  // measure each lane's own vertical spread. ──
  const rawX = new Map<string, number>()
  const rawY = new Map<string, number>()
  const oldLooseTop = bandsBottom + LOOSE_GAP
  for (const n of steps) {
    const key = bandKeyOf(n)
    const rowH = rowHFor(key)
    const rowTop = (key === 'loose' ? oldLooseTop : (bandY.get(key) ?? 0)) + BAND_PAD + (rowOf.get(n.id) ?? 0) * rowH
    const autoX = xOf(n.id)
    const autoY = rowTop + (rowH - estStepHeight(n)) / 2
    rawX.set(n.id, n.layout_frozen ? Math.max(CONTENT_X, n.position_x ?? autoX) : autoX)
    rawY.set(n.id, n.layout_frozen ? (n.position_y ?? autoY) : autoY)
  }

  // Each lane's height comes from its OWN members' vertical spread (never the connections), then the
  // lanes are STACKED top→bottom, flush within a pool. So there are never gaps or overlaps between
  // lanes no matter where the nodes' stored y-values happen to be (e.g. pasted from another map),
  // yet each node keeps its position WITHIN its lane, and deleting a line moves nothing.
  const laneMinY = new Map<string, number>()
  const laneHeight = new Map<string, number>()
  for (const b of bands) {
    const ids = byBand.get(b.key) ?? []
    if (!ids.length) { laneMinY.set(b.key, 0); laneHeight.set(b.key, rowHFor(b.key) + 2 * BAND_PAD); continue }
    const min = Math.min(...ids.map((id) => rawY.get(id)!))
    const maxB = Math.max(...ids.map((id) => rawY.get(id)! + estStepHeight(nodeById.get(id)!)))
    laneMinY.set(b.key, min)
    laneHeight.set(b.key, (maxB - min) + 2 * BAND_PAD + LANE_BOTTOM_ROOM)
  }
  const laneTop = new Map<string, number>()
  let stackY = 0
  let stackPrevPool: ProcessPool | null = null
  for (const b of bands) {
    if (stackPrevPool !== null && b.pool !== stackPrevPool) stackY += POOL_GAP
    laneTop.set(b.key, stackY); stackY += laneHeight.get(b.key)!
    stackPrevPool = b.pool
  }
  const looseTopFinal = stackY + LOOSE_GAP

  // ── PASS 2 — final placement. A lane node sits at its lane's stacked top plus its offset within
  // the lane; a lane-less (loose) node keeps its free spot (shifted below the re-stacked pools). ──
  for (const n of steps) {
    const key = bandKeyOf(n)
    const px = rawX.get(n.id)!
    const ry = rawY.get(n.id)!
    const py = key === 'loose'
      ? (n.layout_frozen ? ry : looseTopFinal + (ry - oldLooseTop))
      : (laneTop.get(key) ?? 0) + BAND_PAD + (ry - (laneMinY.get(key) ?? 0))
    autoPositions[n.id] = { x: px, y: py }
    meta[n.id] = { mapId: flow.map_id, realId: n.id }
    nodes.push({
      id: n.id, type: 'process', position: { x: px, y: py },
      draggable: opts.canEdit && !opts.isTouch, selectable: true, zIndex: 2,
      // No wrapper min-height: the react-flow node hugs its real content, so the four connection
      // dots — and a line entering/leaving the top or bottom — sit exactly on the visible box's
      // edges for every node kind.
      data: {
        name: n.name, kind: n.kind, childCount: n.child_count ?? 0,
        docCount: (n.inputs?.length ?? 0) + (n.outputs?.length ?? 0),
        checklist: n.checklist ?? [],
        drillable: DRILLABLE.has(n.kind),
        selected: n.id === opts.selectedNodeId,
        diff: opts.diffStatus?.[n.id],
        linkedMapName: n.linked_map_name ?? null,
        onEdit: () => opts.onEdit(n.id),
      } as ProcessNodeData,
    })
  }

  // ── Band backgrounds — each drawn at its stacked slot (flush, content-sized). laneBands (returned
  // for drop-detection) uses the same geometry. ──
  const geoFor = (key: string): { top: number; bottom: number } => {
    const t = laneTop.get(key) ?? 0
    return { top: t, bottom: t + (laneHeight.get(key) ?? ROW_H) }
  }
  if (companyEnd > companyStart) {
    let top = Infinity, bottom = -Infinity
    for (let i = companyStart; i < companyEnd; i++) { const g = geoFor(bands[i].key); top = Math.min(top, g.top); bottom = Math.max(bottom, g.bottom) }
    nodes.push({
      id: 'band::pool:company', type: 'swimlane', position: { x: 0, y: top },
      draggable: false, selectable: false, zIndex: 0,
      style: { width: totalWidth, height: bottom - top, pointerEvents: 'none' },
      data: {
        label: 'Company', variant: 'pool',
        onReorderStart: opts.onPoolReorderStart ? (e) => opts.onPoolReorderStart!(e, 'company') : undefined,
      } as SwimlaneBandData,
    })
  }
  const laneBands: LaneBand[] = []
  for (const b of bands) {
    const g = geoFor(b.key)
    const isLane = b.variant === 'lane'
    nodes.push({
      id: 'band::' + b.key, type: 'swimlane',
      position: { x: isLane ? POOL_LABEL_W : 0, y: g.top },
      draggable: false, selectable: false, zIndex: 1,
      style: { width: totalWidth - (isLane ? POOL_LABEL_W : 0), height: g.bottom - g.top, pointerEvents: 'none' },
      data: {
        label: b.label, variant: b.variant,
        onAdd: opts.onAddInLane ? () => opts.onAddInLane!(b.pool, b.deptId) : undefined,
        onRename: b.variant === 'lane' && b.laneId && b.deptId && opts.onRenameLane
          ? () => opts.onRenameLane!(b.laneId!, b.deptId!, b.label)
          : undefined,
        onReorderStart: isLane
          ? (b.deptId && opts.onLaneReorderStart ? (e) => opts.onLaneReorderStart!(e, b.deptId!) : undefined)
          : (opts.onPoolReorderStart ? (e) => opts.onPoolReorderStart!(e, b.pool) : undefined),
      } as SwimlaneBandData,
    })
    // offset = how much a stored (lane-relative) y is shifted to get the rendered y, i.e.
    // rendered = offset + storedY. The drag handler subtracts it to turn a dropped absolute y back
    // into the value to store, so a dragged lane node lands (and stays) exactly where it's dropped.
    laneBands.push({ pool: b.pool, deptId: b.deptId, yTop: g.top, yBottom: g.bottom, offset: g.top + BAND_PAD - (laneMinY.get(b.key) ?? 0) })
  }

  // A node is a cross-lane "middle" when it has BOTH a cross-lane (different band) incoming AND
  // outgoing connection. Its inbound lines then enter its LEFT and outbound leave its RIGHT, so an
  // A→B→C hopping through another lane never overlaps into one ambiguous line. A node at an end
  // (only in, or only out) is not a middle node and keeps the default bottom/top routing.
  const xIn = new Set<string>(), xOut = new Set<string>()
  for (const c of flow.connections) {
    const s = nodeById.get(c.source_node_id), t = nodeById.get(c.target_node_id)
    if (!s || !t || bandKeyOf(s) === bandKeyOf(t)) continue
    xOut.add(s.id); xIn.add(t.id)
  }
  const isMiddle = (id: string) => xIn.has(id) && xOut.has(id)

  // ── Edges: solid within a pool, dotted (message) across pools. The FloatingStepEdge picks the
  // sides that make one clean 90° turn from the live node geometry, so there's no manual handle
  // choice here (and no S-shapes / back-tracking lines). Yes/No rides as the edge label. ──
  const edges: Edge[] = []
  for (const c of flow.connections) {
    const s = nodeById.get(c.source_node_id)
    const t = nodeById.get(c.target_node_id)
    if (!s || !t) continue
    const crossPool = groupOf(s) !== groupOf(t)
    const crossLane = bandKeyOf(s) !== bandKeyOf(t)
    const label = c.label || (c.condition_kind !== 'none' ? c.condition_kind.toUpperCase() : '')
    const color = crossPool ? 'var(--text-muted)' : 'var(--text-secondary)'
    edges.push({
      id: c.id,
      source: c.source_node_id,
      target: c.target_node_id,
      type: 'floatingStep',
      data: {
        label: label || undefined,
        enterLeft: crossLane && isMiddle(t.id), // this line goes INTO a middle node → enter its left
        exitRight: crossLane && isMiddle(s.id), // this line comes OUT of a middle node → leave its right
        // A dot the designer explicitly picked wins over the auto rules above.
        sourceSide: (c.source_side ?? undefined) as ('top' | 'right' | 'bottom' | 'left' | undefined),
        targetSide: (c.target_side ?? undefined) as ('top' | 'right' | 'bottom' | 'left' | undefined),
      },
      style: { stroke: color, strokeWidth: 1.6, ...(crossPool ? { strokeDasharray: '5 4' } : {}) },
      zIndex: 1,
    } as Edge)
  }

  return { nodes, edges, meta, laneBands, autoPositions }
}
