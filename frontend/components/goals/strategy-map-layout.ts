// ─── Strategic Map layout ─────────────────────────────────────────────────────
// Pure geometry for the Goals strategy map: takes the flat goal list plus the
// link web and returns where every oval sits and the exact curve for every
// connector. No React, no DOM — so the numbers can be reasoned about (and
// changed) in one place, and the canvas component stays a renderer.
//
// The map is a Balanced-Scorecard "strategy map": four horizontal bands, one
// per focus area, top to bottom in cause-and-effect order (Finance is the
// outcome; Learning & Growth is what makes it possible). Goals sit as ovals in
// their band; a line is drawn wherever one goal supports another.

import {
  FOCUS_AREA_OPTIONS,
  type GoalFocusArea,
  type StrategyMapEdge,
  type StrategyMapGoal,
} from '@/lib/types/goals'

// ─── Geometry (px) ────────────────────────────────────────────────────────────
/** Ovals stay deliberately compact — a title, nothing else, so many fit a band. */
export const OVAL_W = 176
export const OVAL_H = 48
/** Gap between two ovals in the same band; wide enough for connectors to pass. */
export const COL_GAP = 44
export const PITCH = OVAL_W + COL_GAP
/**
 * Band height — kept close to the oval so a band reads as a lane, not a room
 * with an oval parked in it. What is left over above/below the oval is the
 * only space a same-band arc has to work in, hence `SLACK` below.
 */
export const BAND_H = 88

/** Vertical room between an oval and its band's edge. */
export const SLACK = (BAND_H - OVAL_H) / 2

/**
 * How high a same-band connector bows above its two ovals. Derived from the
 * slack (never a hardcoded number) so tightening the band can't push an arc
 * out into the band above it.
 */
export function sameBandRise(dx: number): number {
  return Math.min(SLACK - 4, 8 + Math.abs(dx) * 0.05)
}
/** Breathing room at the canvas' left/right edge. */
export const X_PAD = 36

/** How many barycentre passes to run when ordering each band (see `order`). */
const ORDER_SWEEPS = 6

/**
 * A fifth, subdued band for goals with no focus area. It is rendered ONLY when
 * such goals exist: hiding them would silently drop goals off the map and leave
 * their connectors dangling, which reads as a bug.
 */
export type BandKey = GoalFocusArea | 'untagged'

export const BAND_ORDER: BandKey[] = [...FOCUS_AREA_OPTIONS, 'untagged']

export interface MapNode {
  goal: StrategyMapGoal
  band: BandKey
  bandIndex: number
  /** Position within the band, left to right. */
  col: number
  /** Top-left of the oval box. */
  x: number
  y: number
  /** Centre of the oval — where connectors aim horizontally. */
  cx: number
  cy: number
}

export interface MapEdge {
  id: string
  from: MapNode
  to: MapNode
  /** SVG path: leaves the supporting goal, arrives at the goal it supports. */
  d: string
  sameBand: boolean
}

export interface MapBand {
  key: BandKey
  index: number
  /** Top of the band inside the canvas. */
  top: number
  nodes: MapNode[]
}

export interface MapLayout {
  bands: MapBand[]
  nodes: MapNode[]
  edges: MapEdge[]
  /** Undirected neighbour index, for hover highlighting. */
  neighbours: Map<string, Set<string>>
  width: number
  height: number
}

/**
 * Builds the whole map. `links` are directed (`supporting` helps `supported`);
 * duplicates and edges pointing at a goal that is no longer on the map are
 * dropped rather than drawn into nowhere.
 */
export function buildStrategyMap(goals: StrategyMapGoal[], links: StrategyMapEdge[]): MapLayout {
  const byId = new Map(goals.map((g) => [g.id, g]))

  const edgePairs: Array<{ from: string; to: string }> = []
  const seen = new Set<string>()
  for (const l of links) {
    if (!byId.has(l.supporting_goal_id) || !byId.has(l.supported_goal_id)) continue
    if (l.supporting_goal_id === l.supported_goal_id) continue
    const key = `${l.supporting_goal_id}->${l.supported_goal_id}`
    if (seen.has(key)) continue
    seen.add(key)
    edgePairs.push({ from: l.supporting_goal_id, to: l.supported_goal_id })
  }

  const neighbours = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set())
    neighbours.get(a)!.add(b)
  }
  for (const e of edgePairs) {
    touch(e.from, e.to)
    touch(e.to, e.from)
  }

  // Group into bands, keeping the server's order (soonest deadline first) as
  // the starting point before the crossing-reduction pass.
  const grouped = new Map<BandKey, StrategyMapGoal[]>()
  for (const key of BAND_ORDER) grouped.set(key, [])
  for (const g of goals) grouped.get(g.focus_area ?? 'untagged')!.push(g)

  // The four real bands always show, even empty, so the map's frame is stable.
  const activeBands = BAND_ORDER.filter((k) => k !== 'untagged' || grouped.get(k)!.length > 0)

  const orders = new Map<BandKey, string[]>()
  for (const k of activeBands) orders.set(k, grouped.get(k)!.map((g) => g.id))
  order(activeBands, orders, neighbours)

  const nodes: MapNode[] = []
  const bands: MapBand[] = activeBands.map((key, bandIndex) => {
    const top = bandIndex * BAND_H
    const ids = orders.get(key)!
    const lookup = new Map(grouped.get(key)!.map((g) => [g.id, g]))
    const bandNodes = ids.map((id, col) => {
      const x = X_PAD + col * PITCH
      const y = top + (BAND_H - OVAL_H) / 2
      const node: MapNode = {
        goal: lookup.get(id)!,
        band: key,
        bandIndex,
        col,
        x,
        y,
        cx: x + OVAL_W / 2,
        cy: y + OVAL_H / 2,
      }
      nodes.push(node)
      return node
    })
    return { key, index: bandIndex, top, nodes: bandNodes }
  })

  const nodeById = new Map(nodes.map((n) => [n.goal.id, n]))
  const edges: MapEdge[] = edgePairs.map((e) => {
    const from = nodeById.get(e.from)!
    const to = nodeById.get(e.to)!
    return {
      id: `${e.from}->${e.to}`,
      from,
      to,
      sameBand: from.bandIndex === to.bandIndex,
      d: edgePath(from, to),
    }
  })

  const widest = activeBands.reduce((m, k) => Math.max(m, orders.get(k)!.length), 0)
  return {
    bands,
    nodes,
    edges,
    neighbours,
    width: widest === 0 ? X_PAD * 2 : X_PAD * 2 + widest * PITCH - COL_GAP,
    height: activeBands.length * BAND_H,
  }
}

/**
 * Crossing reduction (barycentre heuristic). Each band is re-sorted so a goal
 * sits above/below the goals it is linked to, which is what makes the web
 * readable instead of a ball of wool. Neighbours in ANY other band count — not
 * just the adjacent one — because a Learning goal may support Finance directly.
 *
 * A goal with no links keeps its current place, so ordering stays stable and
 * the deadline order still shows through wherever links don't dictate it.
 */
function order(
  bands: BandKey[],
  orders: Map<BandKey, string[]>,
  neighbours: Map<string, Set<string>>,
) {
  const colOf = new Map<string, number>()
  const reindex = () => {
    colOf.clear()
    for (const b of bands) orders.get(b)!.forEach((id, i) => colOf.set(id, i))
  }
  reindex()

  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    // Alternate direction so information travels both up and down the bands.
    const sequence = sweep % 2 === 0 ? bands : [...bands].reverse()
    for (const band of sequence) {
      const ids = orders.get(band)!
      if (ids.length < 2) continue
      const own = new Set(ids)
      const scored = ids.map((id, i) => {
        // Columns of this goal's neighbours that live in some OTHER band.
        const cols: number[] = []
        neighbours.get(id)?.forEach((n) => {
          if (own.has(n)) return
          const c = colOf.get(n)
          if (c !== undefined) cols.push(c)
        })
        const bary = cols.length ? cols.reduce((sum, c) => sum + c, 0) / cols.length : i
        return { id, bary, i }
      })
      scored.sort((a, b) => a.bary - b.bary || a.i - b.i)
      orders.set(
        band,
        scored.map((s) => s.id),
      )
      reindex()
    }
  }
}

/**
 * The connector between two ovals. Cross-band links leave the supporting goal's
 * edge and arrive at the supported goal's opposite edge, so a line never
 * crosses the oval it belongs to. Same-band links take a shallow arc through
 * the band's own slack, which keeps them clear of the neighbouring bands.
 */
function edgePath(a: MapNode, b: MapNode): string {
  const r = (n: number) => Math.round(n * 10) / 10
  if (a.bandIndex === b.bandIndex) {
    const rise = sameBandRise(b.cx - a.cx)
    return `M ${r(a.cx)} ${r(a.y)} C ${r(a.cx)} ${r(a.y - rise)} ${r(b.cx)} ${r(b.y - rise)} ${r(b.cx)} ${r(b.y)}`
  }
  const downward = a.bandIndex < b.bandIndex
  const y1 = downward ? a.y + OVAL_H : a.y
  const y2 = downward ? b.y : b.y + OVAL_H
  const k = (y2 - y1) * 0.5
  return `M ${r(a.cx)} ${r(y1)} C ${r(a.cx)} ${r(y1 + k)} ${r(b.cx)} ${r(y2 - k)} ${r(b.cx)} ${r(y2)}`
}
