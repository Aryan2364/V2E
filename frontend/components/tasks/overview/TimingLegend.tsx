'use client'

import React from 'react'
import { TIMINGS, TIMING_META, type Timing, type TimingCounts } from '@/lib/types/tasks'

/**
 * Shared legend for the timing palette. Optionally shows per-bucket counts and lets the
 * caller filter by clicking a swatch (used to set the timing slice in the breakdowns).
 */
export default function TimingLegend({
  counts,
  active,
  onPick,
  className = '',
}: {
  counts?: TimingCounts
  active?: Timing | null
  onPick?: (t: Timing) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
      {TIMINGS.map((t) => {
        const isActive = active === t
        const interactive = !!onPick
        return (
          <button
            key={t}
            type="button"
            disabled={!interactive}
            onClick={() => onPick?.(t)}
            className={`flex items-center gap-1.5 text-[12px] transition-colors ${
              interactive ? 'cursor-pointer hover:text-text-primary' : 'cursor-default'
            } ${isActive ? 'font-medium text-text-primary' : 'text-text-secondary'}`}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TIMING_META[t].color }} />
            {TIMING_META[t].label}
            {counts && <span className="tabular-nums font-medium text-text-primary">{counts[t]}</span>}
          </button>
        )
      })}
    </div>
  )
}
