'use client'

import React from 'react'
import { TIMINGS, TIMING_META, type TimingCounts } from '@/lib/types/tasks'
import Tooltip from '@/components/ui/Tooltip'

/**
 * The stacked completion-timing bar used across the dashboard (leaderboards, breakdowns).
 * Segments are proportional to each bucket's share of the row total, colored by the
 * brand-system timing palette. Zero-width buckets are omitted.
 */
export default function TimingMiniBar({
  timing,
  height = 7,
  className = '',
}: {
  timing: TimingCounts
  height?: number
  className?: string
}) {
  const total = TIMINGS.reduce((s, t) => s + (timing[t] || 0), 0)
  if (!total) {
    return <div className={`text-[12px] text-text-muted ${className}`} style={{ height }}>No tasks</div>
  }
  return (
    <div className={`flex w-full rounded-full overflow-hidden bg-surface-control ${className}`} style={{ height }}>
      {TIMINGS.map((t) =>
        timing[t] > 0 ? (
          <Tooltip key={t} label={`${TIMING_META[t].label}: ${timing[t]}`}>
            <div
              style={{ width: `${(timing[t] / total) * 100}%`, backgroundColor: TIMING_META[t].color }}
            />
          </Tooltip>
        ) : null,
      )}
    </div>
  )
}
