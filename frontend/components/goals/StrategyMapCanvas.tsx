'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { FOCUS_AREA_META, type StrategyMap } from '@/lib/types/goals'
import {
  BAND_H,
  OVAL_H,
  OVAL_W,
  X_PAD,
  buildStrategyMap,
  type BandKey,
  type MapEdge,
} from './strategy-map-layout'

/** Palette per band. The four focus areas reuse the Balanced-Scorecard colours
 *  so a goal's colour means the same thing here as on the scorecard; the
 *  "Not tagged" band is deliberately grey — it is a to-do, not a perspective. */
const BAND_META: Record<BandKey, { label: string; bg: string; text: string; border: string; dot: string }> = {
  ...FOCUS_AREA_META,
  untagged: {
    label: 'Not tagged',
    bg: '#F1F5F9',
    text: '#475569',
    border: '#E2E8F0',
    dot: '#94A3B8',
  },
}

/** Idle connector colour — neutral, so the ovals' colours stay the loud thing. */
const EDGE_IDLE = '#94A3B8'

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  )
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

interface Props {
  map: StrategyMap
  /** Shows the per-band "+" — gated on the real goals `write` permission. */
  canCreate: boolean
  onAddInBand: (band: BandKey) => void
}

/**
 * The strategy map itself: four horizontal bands (Finance → Customer →
 * Internal Process → Learning & Growth), each holding its goals as compact
 * ovals, with a line wherever one goal supports another.
 *
 * One scroll box owns both axes and the band-label rail is pinned to its left
 * edge, so scrolling sideways through a crowded band never loses the labels and
 * the four bands can never drift out of step with each other (they share a
 * single coordinate space — that is also what lets a connector run from a
 * Learning goal straight up to a Finance one).
 *
 * Hovering an oval traces its web: its own connectors and the goals at the
 * other end stay lit while everything else fades back.
 */
export default function StrategyMapCanvas({ map, canCreate, onAddInBand }: Props) {
  const router = useRouter()
  const [hovered, setHovered] = useState<string | null>(null)

  const layout = useMemo(() => buildStrategyMap(map.goals, map.links), [map])

  const lit = useMemo(() => {
    if (!hovered) return null
    const set = new Set<string>([hovered])
    layout.neighbours.get(hovered)?.forEach((n) => set.add(n))
    return set
  }, [hovered, layout])

  const isLit = (id: string) => !lit || lit.has(id)
  const edgeLit = (e: MapEdge) => !hovered || e.from.goal.id === hovered || e.to.goal.id === hovered

  // Lit connectors are drawn last so a traced line is never buried under a
  // faded one (DESIGN_RULES Part 10 — the acted-on thing goes on top).
  const edges = useMemo(
    () => [...layout.edges].sort((a, b) => Number(edgeLit(a)) - Number(edgeLit(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, hovered],
  )

  return (
    // max-h-full, not flex-1: the card hugs its bands (no dead white space
    // below the last one) and only starts scrolling once the map is taller
    // than the room available.
    <div className="max-h-full rounded-[12px] border border-[#E2E8F0] bg-white overflow-auto shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex min-w-full" style={{ minHeight: layout.height }}>
        {/* ── Band labels: pinned to the left edge of the scroll box ───────── */}
        <div className="sticky left-0 z-20 shrink-0 border-r border-[#E2E8F0] w-[152px] md:w-[240px]">
          {layout.bands.map((band) => {
            const m = BAND_META[band.key]
            return (
              <div
                key={band.key}
                className="border-b flex flex-col gap-1 px-3 sm:px-4 pt-2.5"
                style={{ height: BAND_H, backgroundColor: m.bg, borderColor: m.border }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: m.dot }}
                    />
                    <h2
                      className="text-[12.5px] font-bold uppercase tracking-[0.06em] leading-tight min-w-0"
                      style={{ color: m.text }}
                    >
                      {m.label}
                    </h2>
                    {band.nodes.length > 0 && (
                      <span
                        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-semibold shrink-0"
                        style={{ backgroundColor: m.dot }}
                      >
                        {band.nodes.length}
                      </span>
                    )}
                  </div>
                  {canCreate && band.key !== 'untagged' && (
                    <Tooltip label={`New ${m.label} goal`}>
                      <button
                        onClick={() => onAddInBand(band.key)}
                        aria-label={`New ${m.label} goal`}
                        className="w-7 h-7 shrink-0 rounded-[8px] text-white flex items-center justify-center transition-[filter] duration-200"
                        style={{ backgroundColor: m.dot }}
                        onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(0.9)')}
                        onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
                      >
                        <Plus size={16} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {band.key === 'untagged' && (
                  <p className="text-[11px] text-[#64748B] leading-snug">
                    Edit a goal to place it in a band.
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* ── The canvas: one coordinate space for all bands ───────────────── */}
        <div
          className="relative flex-1"
          style={{ minWidth: layout.width, height: layout.height }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Band stripes. Drawn full-width so a band reads as one continuous
              lane even when its goals stop short of the right edge. */}
          {layout.bands.map((band) => {
            const m = BAND_META[band.key]
            return (
              <div
                key={band.key}
                className="absolute left-0 right-0 border-b"
                style={{
                  top: band.top,
                  height: BAND_H,
                  backgroundColor: rgba(m.bg, 0.45),
                  borderColor: m.border,
                }}
              >
                {band.nodes.length === 0 && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 text-[12.5px] text-[#64748B] whitespace-nowrap"
                    style={{ left: X_PAD }}
                  >
                    No goals in this band yet.
                  </span>
                )}
              </div>
            )
          })}

          {/* Connectors, behind the ovals. */}
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              {/* markerUnits=userSpaceOnUse so the arrowhead keeps one size when
                  a traced line thickens on hover. refX puts its tip exactly on
                  the path's end — i.e. on the oval's edge. */}
              <marker
                id="sm-arrow-idle"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 z" fill={EDGE_IDLE} />
              </marker>
              {Object.entries(BAND_META).map(([key, m]) => (
                <marker
                  key={key}
                  id={`sm-arrow-${key}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="10"
                  markerHeight="10"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M 0 1 L 7 4 L 0 7 z" fill={m.dot} />
                </marker>
              ))}
            </defs>
            {edges.map((e) => {
              const active = edgeLit(e)
              const m = BAND_META[e.from.band]
              return (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  stroke={hovered && active ? m.dot : EDGE_IDLE}
                  strokeWidth={hovered && active ? 2.2 : 1.5}
                  strokeLinecap="round"
                  markerEnd={`url(#sm-arrow-${hovered && active ? e.from.band : 'idle'})`}
                  opacity={active ? (hovered ? 1 : 0.75) : 0.18}
                  className="transition-[opacity,stroke-width] duration-200 ease-out"
                />
              )
            })}
          </svg>

          {/* The goals. An oval carries the title and nothing else — everything
              else about the goal is one click away on the goal itself. */}
          {layout.nodes.map((n) => {
            const m = BAND_META[n.band]
            const on = isLit(n.goal.id)
            const focused = hovered === n.goal.id
            return (
              <button
                key={n.goal.id}
                onClick={() => router.push(`/goals/${n.goal.id}`)}
                onMouseEnter={() => setHovered(n.goal.id)}
                onFocus={() => setHovered(n.goal.id)}
                onBlur={() => setHovered(null)}
                title={n.goal.title}
                className={[
                  'absolute rounded-full flex items-center justify-center text-center px-4',
                  'transition-[opacity,box-shadow,transform,background-color] duration-200 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2',
                  focused ? 'z-10 -translate-y-0.5' : 'z-[1]',
                ].join(' ')}
                style={{
                  left: n.x,
                  top: n.y,
                  width: OVAL_W,
                  height: OVAL_H,
                  backgroundColor: focused ? m.bg : '#FFFFFF',
                  border: `1.5px solid ${focused ? m.dot : rgba(m.dot, 0.5)}`,
                  boxShadow: focused
                    ? `0 6px 16px ${rgba(m.dot, 0.28)}`
                    : '0 1px 2px rgba(15,23,42,0.08)',
                  opacity: on ? 1 : 0.35,
                }}
              >
                <span
                  className="text-[12.5px] font-semibold leading-[1.25] line-clamp-2 break-words"
                  style={{ color: m.text }}
                >
                  {n.goal.title}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
