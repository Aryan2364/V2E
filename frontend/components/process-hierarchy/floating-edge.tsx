'use client'

import { useStore, getBezierPath, getSmoothStepPath, BaseEdge, EdgeLabelRenderer, Position, type EdgeProps, type Node } from 'reactflow'

// ─── Floating-edge geometry ──────────────────────────────────────────────────
// Computes where the line between two node centres crosses each node's boundary,
// so a connection always leaves/enters the *nearest* side — no fixed left→right
// handles, no "S" shape when a node sits below another.

interface Box { x: number; y: number; width: number; height: number }

function boxOf(node: Node): Box {
  const pos = node.positionAbsolute ?? node.position
  return { x: pos.x, y: pos.y, width: node.width ?? 0, height: node.height ?? 0 }
}

// Intersection of the centre-to-centre line with `node`'s rectangle.
function intersection(node: Box, other: Box) {
  const w = node.width / 2
  const h = node.height / 2
  const x2 = node.x + w
  const y2 = node.y + h
  const x1 = other.x + other.width / 2
  const y1 = other.y + other.height / 2
  if (!w || !h) return { x: x2, y: y2 }
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 }
}

function sideOf(node: Box, point: { x: number; y: number }): Position {
  const px = Math.round(point.x)
  const py = Math.round(point.y)
  if (px <= Math.round(node.x) + 1) return Position.Left
  if (px >= Math.round(node.x + node.width) - 1) return Position.Right
  if (py <= Math.round(node.y) + 1) return Position.Top
  return Position.Bottom
}

function edgeParams(source: Box, target: Box) {
  const sp = intersection(source, target)
  const tp = intersection(target, source)
  return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y, sourcePos: sideOf(source, sp), targetPos: sideOf(target, tp) }
}

// ─── Orthogonal single-bend geometry (swimlane) ──────────────────────────────
// A connection makes ONE clean 90° turn: same row → straight across; another lane → leaves the
// source's bottom/top (so a decision's branches drop out of its base) and, if the target is
// offset, turns once into the target's near side. Never an S or a line that doubles back.
type StepGeom = { sx: number; sy: number; sourcePos: Position; tx: number; ty: number; targetPos: Position }
type Side = 'top' | 'right' | 'bottom' | 'left'
// The attachment point (and Position) at a given side of a box — used when the designer has
// explicitly picked which dot a line uses.
function sidePoint(b: Box, side: Side): { x: number; y: number; pos: Position } {
  switch (side) {
    case 'left': return { x: b.x, y: b.y + b.height / 2, pos: Position.Left }
    case 'right': return { x: b.x + b.width, y: b.y + b.height / 2, pos: Position.Right }
    case 'top': return { x: b.x + b.width / 2, y: b.y, pos: Position.Top }
    default: return { x: b.x + b.width / 2, y: b.y + b.height, pos: Position.Bottom } // bottom
  }
}

function stepParams(source: Box, target: Box, opts?: { enterLeft?: boolean; exitRight?: boolean; sourceSide?: Side; targetSide?: Side }): StepGeom {
  // Until both nodes are measured, fall back to a plain right→left link so the path always has a
  // real end point and the arrowhead orients (a degenerate 0-size box makes the marker vanish).
  if (!source.width || !source.height || !target.width || !target.height) {
    return {
      sx: source.x + source.width, sy: source.y + source.height / 2, sourcePos: Position.Right,
      tx: target.x, ty: target.y + target.height / 2, targetPos: Position.Left,
    }
  }
  const scx = source.x + source.width / 2, scy = source.y + source.height / 2
  const tcx = target.x + target.width / 2, tcy = target.y + target.height / 2
  const dx = tcx - scx, dy = tcy - scy
  const sameRow = Math.abs(dy) <= Math.max(source.height, target.height) / 2
  const sameCol = Math.abs(dx) <= Math.max(source.width, target.width) / 2
  const rightward = dx >= 0
  const srcSideX = rightward ? source.x + source.width : source.x
  const srcSidePos = rightward ? Position.Right : Position.Left
  const tgtNearX = rightward ? target.x : target.x + target.width
  const tgtNearPos = rightward ? Position.Left : Position.Right

  let r: StepGeom
  if (sameRow) {
    // Same lane/row → straight across. Use a shared Y (within both boxes) so a short step and a
    // taller one — which have different centre heights — still connect with a dead-straight line.
    const y = Math.min(scy, tcy)
    r = { sx: srcSideX, sy: y, sourcePos: srcSidePos, tx: tgtNearX, ty: y, targetPos: tgtNearPos }
  } else if (dy >= 0) {
    // Target in a LOWER lane → drop out the source's BOTTOM (so a decision's branch leaves its
    // base): straight into the target's top if aligned, else one turn into its near side.
    r = sameCol
      ? { sx: scx, sy: source.y + source.height, sourcePos: Position.Bottom, tx: tcx, ty: target.y, targetPos: Position.Top }
      : { sx: scx, sy: source.y + source.height, sourcePos: Position.Bottom, tx: tgtNearX, ty: tcy, targetPos: tgtNearPos }
  } else {
    // Target in a HIGHER lane → carry on forward out the source's SIDE and rise into the target's
    // BOTTOM. Aligned → straight up.
    r = sameCol
      ? { sx: scx, sy: source.y, sourcePos: Position.Top, tx: tcx, ty: target.y + target.height, targetPos: Position.Bottom }
      : { sx: srcSideX, sy: scy, sourcePos: Position.Top, tx: tcx, ty: target.y + target.height, targetPos: Position.Bottom }
  }

  // Middle-node separation: a cross-lane node sandwiched between a predecessor and a successor
  // (both in other lanes) sends its INBOUND line into its LEFT and its OUTBOUND line out its
  // RIGHT — so A→B→C hopping through a lane reads as two distinct lines instead of overlapping
  // into one. Ends (only in, or only out) keep the bottom/top routing chosen above.
  if (opts?.exitRight) { r.sx = source.x + source.width; r.sy = scy; r.sourcePos = Position.Right }
  if (opts?.enterLeft) { r.tx = target.x; r.ty = tcy; r.targetPos = Position.Left }

  // Designer's explicit choice wins over any auto rule: leave the source from the dot they dragged
  // from, enter the target at the dot they dropped on.
  if (opts?.sourceSide) { const p = sidePoint(source, opts.sourceSide); r.sx = p.x; r.sy = p.y; r.sourcePos = p.pos }
  if (opts?.targetSide) { const p = sidePoint(target, opts.targetSide); r.tx = p.x; r.ty = p.y; r.targetPos = p.pos }

  // Land BOTH ends exactly on the node's connector dot (the midpoint of whichever side was chosen),
  // so a line/arrow can never point at empty space beside a node — it always meets the blue dot.
  const midOf = (b: Box, pos: Position) => {
    switch (pos) {
      case Position.Left: return { x: b.x, y: b.y + b.height / 2 }
      case Position.Right: return { x: b.x + b.width, y: b.y + b.height / 2 }
      case Position.Top: return { x: b.x + b.width / 2, y: b.y }
      default: return { x: b.x + b.width / 2, y: b.y + b.height } // Bottom
    }
  }
  const sm = midOf(source, r.sourcePos); r.sx = sm.x; r.sy = sm.y
  const tm = midOf(target, r.targetPos); r.tx = tm.x; r.ty = tm.y

  // Straighten a near-aligned hop by moving the SOURCE end onto the target's dot line — the arrow
  // stays exactly on the target dot, the source line just leaves at the matching X/Y — so a tiny
  // centre mismatch no longer leaves a little step you can't nudge away. Horizontal hop (left/right
  // sides) shares a Y; vertical hop (top/bottom sides) shares an X.
  const horiz = (r.sourcePos === Position.Left || r.sourcePos === Position.Right)
    && (r.targetPos === Position.Left || r.targetPos === Position.Right)
  const vert = (r.sourcePos === Position.Top || r.sourcePos === Position.Bottom)
    && (r.targetPos === Position.Top || r.targetPos === Position.Bottom)
  if (horiz && Math.abs(r.sy - r.ty) <= 60) r.sy = r.ty
  if (vert && Math.abs(r.sx - r.tx) <= 60) r.sx = r.tx
  return r
}

// Arrowhead drawn explicitly (not via ReactFlow's shared marker, which failed to orient on
// bottom/top entries). A filled triangle whose tip sits at the entry point, pointing INTO the
// node from whichever side the edge arrives.
function arrowPoints(tx: number, ty: number, pos: Position) {
  const L = 8, W = 5 // length back from the tip; half-width of the base
  switch (pos) {
    case Position.Left: return `${tx},${ty} ${tx - L},${ty - W} ${tx - L},${ty + W}`
    case Position.Right: return `${tx},${ty} ${tx + L},${ty - W} ${tx + L},${ty + W}`
    case Position.Top: return `${tx},${ty} ${tx - W},${ty - L} ${tx + W},${ty - L}`
    default: return `${tx},${ty} ${tx - W},${ty + L} ${tx + W},${ty + L}` // Bottom
  }
}

export function FloatingStepEdge({ id, source, target, style, data }: EdgeProps<{ label?: string; enterLeft?: boolean; exitRight?: boolean; sourceSide?: Side; targetSide?: Side }>) {
  const sourceNode = useStore((s) => s.nodeInternals.get(source))
  const targetNode = useStore((s) => s.nodeInternals.get(target))
  if (!sourceNode || !targetNode) return null

  const { sx, sy, tx, ty, sourcePos, targetPos } = stepParams(boxOf(sourceNode), boxOf(targetNode), { enterLeft: data?.enterLeft, exitRight: data?.exitRight, sourceSide: data?.sourceSide, targetSide: data?.targetSide })
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx, sourceY: sy, sourcePosition: sourcePos,
    targetX: tx, targetY: ty, targetPosition: targetPos, borderRadius: 8,
  })
  const color = (style?.stroke as string) ?? 'var(--text-secondary)'

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <polygon points={arrowPoints(tx, ty, targetPos)} fill={color} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-[4px] bg-white/90 px-1 py-0.5 text-[11px] font-semibold text-text-secondary"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// ─── Edge component ──────────────────────────────────────────────────────────
export default function FloatingEdge({ id, source, target, markerEnd, style, data }: EdgeProps<{ label?: string }>) {
  const sourceNode = useStore((s) => s.nodeInternals.get(source))
  const targetNode = useStore((s) => s.nodeInternals.get(target))
  if (!sourceNode || !targetNode) return null

  const { sx, sy, tx, ty, sourcePos, targetPos } = edgeParams(boxOf(sourceNode), boxOf(targetNode))
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx, sourceY: sy, sourcePosition: sourcePos,
    targetX: tx, targetY: ty, targetPosition: targetPos,
  })

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-[4px] bg-white/90 px-1 py-0.5 text-[11px] font-semibold text-text-secondary"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
