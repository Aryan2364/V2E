'use client'

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layoutFlow } from './flow'

export type FlowTone = 'default' | 'done' | 'current' | 'attention' | 'waiting' | 'upcoming' | 'skipped'
export type EdgeTone = 'default' | 'done' | 'muted'

export interface FlowDiagramNode {
  id: string
  deps: string[]
  order: number
  /** The lane (track) the box sits in. Unknown or missing = the first lane. */
  lane?: string
  /** Accessible name of the box, e.g. "Step B2: Approve budget". */
  label: string
  /** Labels of the steps in OTHER lanes it also waits for ("3", "B2") — shown above the box. */
  alsoWaitsFor?: string[]
  tone?: FlowTone
  content: React.ReactNode
  onClick?: () => void
  /** Draws a selection ring (the step whose details are open). */
  selected?: boolean
}

export interface FlowLane {
  key: string
  /** "Main path", "Finance", "Path B". */
  label: string
  /** e.g. "After 1" / "After start of run". */
  hint?: string
}

// Each tone carries a border and a fill; text inside stays dark for contrast.
const BOX: Record<FlowTone, string> = {
  default: 'bg-white border-[#CBD5E1]',
  done: 'bg-white border-[#86EFAC]',
  current: 'bg-[#EFF6FF] border-[#2563EB] ring-2 ring-[#BFDBFE]',
  attention: 'bg-[#FEF2F2] border-[#DC2626] ring-2 ring-[#FECACA]',
  waiting: 'bg-[#F5F3FF] border-[#7C3AED] ring-2 ring-[#DDD6FE]',
  upcoming: 'bg-[#F8FAFC] border-[#CBD5E1] border-dashed opacity-70',
  skipped: 'bg-[#F8FAFC] border-[#CBD5E1] opacity-80',
}

const EDGE: Record<EdgeTone, { stroke: string; dash?: string; marker: string }> = {
  default: { stroke: '#64748B', marker: 'wf-arrow-default' },
  done: { stroke: '#16A34A', marker: 'wf-arrow-done' },
  muted: { stroke: '#94A3B8', dash: '5 4', marker: 'wf-arrow-muted' },
}

interface Edge {
  key: string
  d: string
  tone: EdgeTone
  /** Crosses lanes (a split or a merge): drawn last, over a halo, so crossings read clearly. */
  cross: boolean
}

/** An orthogonal path through these points with softly rounded corners. */
function rounded(points: [number, number][], radius = 8): string {
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    const inLen = Math.hypot(x - px, y - py)
    const outLen = Math.hypot(nx - x, ny - y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 0.5) {
      d += ` L ${x} ${y}`
      continue
    }
    const ax = x - ((x - px) / inLen) * r
    const ay = y - ((y - py) / inLen) * r
    const bx = x + ((nx - x) / outLen) * r
    const by = y + ((ny - y) / outLen) * r
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`
  }
  const last = points[points.length - 1]
  return `${d} L ${last[0]} ${last[1]}`
}

/**
 * A read-only picture of the flow, one LANE per track: lanes side by side (scrolling
 * sideways inside their own box when they don't fit), steps going down their lane in
 * order, each row a moment in the flow (a step sits one row below the deepest step it
 * waits for). Arrows: down the lane from step to step, from a split step across into
 * the first step of the track that starts after it, and from each step another one
 * also waits for into that step. Lines are an SVG layer measured from the boxes, so
 * they follow any box size.
 */
export default function FlowDiagram({
  nodes,
  lanes,
  edgeTone,
  compact = false,
}: {
  nodes: FlowDiagramNode[]
  /** The tracks in order. Omitted = one lane. Lanes with no boxes are left out. */
  lanes?: FlowLane[]
  /** Colour of the line from `from` to `to`. Default: neutral. */
  edgeTone?: (from: string, to: string) => EdgeTone
  compact?: boolean
}) {
  const layout = useMemo(() => layoutFlow(nodes.map((n) => ({ id: n.id, deps: n.deps, order: n.order }))), [nodes])

  // Lanes that have boxes, in order; a box in an unknown lane joins the first.
  const shownLanes = useMemo(() => {
    const all = lanes?.length ? lanes : [{ key: '__one', label: '' }]
    const known = new Set(all.map((l) => l.key))
    const laneOf = (n: FlowDiagramNode) => (n.lane && known.has(n.lane) ? n.lane : all[0].key)
    const used = new Set(nodes.map(laneOf))
    return { list: all.filter((l) => used.has(l.key)), laneOf }
  }, [lanes, nodes])

  // Grid placement: column = lane, row = level. Two boxes never share a cell.
  const cells = useMemo(() => {
    const col = new Map(shownLanes.list.map((l, i) => [l.key, i]))
    const taken = new Set<string>()
    const at = new Map<string, { col: number; row: number }>()
    nodes
      .slice()
      .sort((a, b) => (layout.levelOf.get(a.id) ?? 0) - (layout.levelOf.get(b.id) ?? 0) || a.order - b.order)
      .forEach((n) => {
        const c = col.get(shownLanes.laneOf(n)) ?? 0
        let r = layout.levelOf.get(n.id) ?? 0
        while (taken.has(`${c}:${r}`)) r++
        taken.add(`${c}:${r}`)
        at.set(n.id, { col: c, row: r })
      })
    const rows = Math.max(0, ...Array.from(at.values()).map((p) => p.row + 1))
    return { at, rows }
  }, [nodes, layout, shownLanes])

  const innerRef = useRef<HTMLDivElement>(null)
  const boxRefs = useRef(new Map<string, HTMLDivElement>())
  const [edges, setEdges] = useState<Edge[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const toneRef = useRef(edgeTone)
  toneRef.current = edgeTone

  const measure = useCallback(() => {
    const inner = innerRef.current
    if (!inner) return
    const base = inner.getBoundingClientRect()
    const out: Edge[] = []
    layout.deps.forEach((ds, to) => {
      const toEl = boxRefs.current.get(to)
      if (!toEl) return
      const t = toEl.getBoundingClientRect()
      const tx = t.left - base.left + t.width / 2
      const ty = t.top - base.top
      ds.forEach((from) => {
        const fromEl = boxRefs.current.get(from)
        if (!fromEl) return
        const f = fromEl.getBoundingClientRect()
        const fx = f.left - base.left + f.width / 2
        const fy = f.bottom - base.top
        const sameLane = Math.abs(fx - tx) < 1
        let d: string
        if (sameLane) {
          d = `M ${fx} ${fy} L ${tx} ${ty - 2}`
        } else {
          // Across lanes (a split or a merge): down into the gap under the box, across to
          // the corridor beside the target's lane, down it, then across and into the top —
          // never through another box.
          const yGap = fy + Math.min(14, Math.max(6, (ty - fy) / 2))
          const yTop = ty - Math.min(14, Math.max(6, (ty - fy) / 2))
          if (yTop - yGap < 24) {
            const y = (fy + ty) / 2
            d = rounded([[fx, fy], [fx, y], [tx, y], [tx, ty - 2]])
          } else {
            const cx = tx > fx ? t.left - base.left - 14 : t.right - base.left + 14
            d = rounded([[fx, fy], [fx, yGap], [cx, yGap], [cx, yTop], [tx, yTop], [tx, ty - 2]])
          }
        }
        out.push({ key: `${from}-${to}`, d, tone: toneRef.current?.(from, to) ?? 'default', cross: !sameLane })
      })
    })
    setEdges(out.sort((a, b) => Number(a.cross) - Number(b.cross)))
    setSize({ w: inner.scrollWidth, h: inner.scrollHeight })
  }, [layout])

  useLayoutEffect(() => {
    measure()
    const inner = innerRef.current
    if (!inner || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(inner)
    boxRefs.current.forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [measure, nodes])

  if (!nodes.length) return null

  const laneCount = shownLanes.list.length
  const withHeaders = !!lanes?.length && (laneCount > 1 || shownLanes.list[0]?.key !== 'main' || !!shownLanes.list[0]?.hint)
  const boxW = compact ? 'w-[200px]' : 'w-[220px] sm:w-[236px]'
  const rowOffset = withHeaders ? 2 : 1

  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div
        ref={innerRef}
        className={`relative mx-auto w-max min-w-full grid justify-center ${compact ? 'gap-x-4' : 'gap-x-6'}`}
        style={{ gridTemplateColumns: `repeat(${laneCount}, max-content)` }}
      >
        {/* A band behind each lane (only when there are several), under the lines. */}
        {laneCount > 1 &&
          shownLanes.list.map((l, ci) => (
            <div
              key={`band-${l.key}`}
              aria-hidden
              className="rounded-[12px] bg-[#F8FAFC] border border-[#EEF2F7]"
              style={{ gridColumn: ci + 1, gridRow: `1 / ${cells.rows + rowOffset}` }}
            />
          ))}

        <svg
          aria-hidden
          className="absolute left-0 top-0 pointer-events-none overflow-visible z-[1]"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
        >
          <defs>
            {(Object.keys(EDGE) as EdgeTone[]).map((k) => (
              <marker key={k} id={EDGE[k].marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE[k].stroke} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => (
            <React.Fragment key={e.key}>
              {e.cross && <path d={e.d} fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />}
              <path
                d={e.d}
                fill="none"
                stroke={EDGE[e.tone].stroke}
                strokeWidth={1.75}
                strokeDasharray={EDGE[e.tone].dash}
                markerEnd={`url(#${EDGE[e.tone].marker})`}
              />
            </React.Fragment>
          ))}
        </svg>

        {withHeaders &&
          shownLanes.list.map((l, ci) => (
            <div key={`h-${l.key}`} className={`relative z-[2] px-3 pt-2.5 pb-1 ${boxW} box-content`} style={{ gridColumn: ci + 1, gridRow: 1 }}>
              <span className="block text-[13px] font-semibold text-[#0F172A] truncate">{l.label}</span>
              {l.hint && <span className="block text-[12px] text-[#475569] truncate">{l.hint}</span>}
            </div>
          ))}

        {nodes.map((n) => {
          const p = cells.at.get(n.id)
          if (!p) return null
          const tone = n.tone ?? 'default'
          const box = (
            <div
              className={`w-full h-full text-left rounded-[12px] border px-3 py-2.5 ${BOX[tone]} ${
                n.selected ? 'outline outline-2 outline-offset-2 outline-[#2563EB]' : ''
              }`}
            >
              {n.alsoWaitsFor && n.alsoWaitsFor.length > 0 && (
                <span className="flex mb-1.5">
                  <span className="inline-flex items-center rounded-full border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-medium text-[#334155] max-w-full truncate">
                    Also waits for {n.alsoWaitsFor.join(', ')}
                  </span>
                </span>
              )}
              {n.content}
            </div>
          )
          return (
            <div
              key={n.id}
              className={`relative z-[2] px-3 ${compact ? 'py-3' : 'py-4'} box-content ${boxW}`}
              style={{ gridColumn: p.col + 1, gridRow: p.row + rowOffset }}
            >
              <div
                ref={(el) => {
                  if (el) boxRefs.current.set(n.id, el)
                  else boxRefs.current.delete(n.id)
                }}
                className="w-full"
              >
                {n.onClick ? (
                  <button
                    type="button"
                    onClick={n.onClick}
                    aria-label={n.label}
                    className="block w-full rounded-[12px] transition-[transform,box-shadow] duration-150 hover:shadow-[0_4px_14px_rgba(15,23,42,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
                  >
                    {box}
                  </button>
                ) : (
                  <div role="group" aria-label={n.label}>
                    {box}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
