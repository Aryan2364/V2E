'use client'

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layoutFlow } from './flow'

export type FlowTone = 'default' | 'done' | 'current' | 'attention' | 'waiting' | 'upcoming' | 'skipped'
export type EdgeTone = 'default' | 'done' | 'muted'

export interface FlowDiagramNode {
  id: string
  deps: string[]
  order: number
  /** Accessible name of the box, e.g. "Step 2: Approve budget". */
  label: string
  tone?: FlowTone
  content: React.ReactNode
  onClick?: () => void
  /** Draws a selection ring (the step whose details are open). */
  selected?: boolean
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
}

/**
 * A read-only picture of the flow: one row per level, steps on the same level side by
 * side, an arrow from every step to each step that starts after it (a step with several
 * arrows coming in waits for all of them). Lines are an SVG layer measured from the
 * boxes, so they follow any box size. Wide flows scroll sideways inside their own box.
 */
export default function FlowDiagram({
  nodes,
  edgeTone,
  compact = false,
}: {
  nodes: FlowDiagramNode[]
  /** Colour of the line from `from` to `to`. Default: neutral. */
  edgeTone?: (from: string, to: string) => EdgeTone
  compact?: boolean
}) {
  const layout = useMemo(() => layoutFlow(nodes.map((n) => ({ id: n.id, deps: n.deps, order: n.order }))), [nodes])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
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
        const mid = Math.max(12, (ty - fy) / 2)
        out.push({
          key: `${from}-${to}`,
          d: `M ${fx} ${fy} C ${fx} ${fy + mid}, ${tx} ${ty - mid}, ${tx} ${ty - 2}`,
          tone: toneRef.current?.(from, to) ?? 'default',
        })
      })
    })
    setEdges(out)
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

  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div ref={innerRef} className={`relative mx-auto w-max min-w-full flex flex-col items-center ${compact ? 'gap-8' : 'gap-10'} py-1`}>
        <svg
          aria-hidden
          className="absolute left-0 top-0 pointer-events-none overflow-visible"
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
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke={EDGE[e.tone].stroke}
              strokeWidth={1.75}
              strokeDasharray={EDGE[e.tone].dash}
              markerEnd={`url(#${EDGE[e.tone].marker})`}
            />
          ))}
        </svg>

        {layout.levels.map((row, li) => (
          <div key={li} className={`relative flex items-start justify-center ${compact ? 'gap-3' : 'gap-4'}`}>
            {row.map((id) => {
              const n = byId.get(id)
              if (!n) return null
              const tone = n.tone ?? 'default'
              const joins = (layout.deps.get(id) ?? []).length
              const box = (
                <div
                  className={`w-full h-full text-left rounded-[12px] border px-3 py-2.5 ${BOX[tone]} ${
                    n.selected ? 'outline outline-2 outline-offset-2 outline-[#2563EB]' : ''
                  }`}
                >
                  {n.content}
                </div>
              )
              return (
                <div
                  key={id}
                  ref={(el) => {
                    if (el) boxRefs.current.set(id, el)
                    else boxRefs.current.delete(id)
                  }}
                  className={`relative flex flex-col items-stretch ${compact ? 'w-[200px]' : 'w-[220px] sm:w-[236px]'}`}
                >
                  {joins >= 2 && (
                    <span className="self-center mb-1 inline-flex items-center rounded-full border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-medium text-[#334155]">
                      Waits for all {joins}
                    </span>
                  )}
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
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
