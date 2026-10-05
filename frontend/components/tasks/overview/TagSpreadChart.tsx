'use client'

import React from 'react'
import type { DashboardBreakdownItem } from '@/lib/types/tasks'
import { tagDotClass } from '@/lib/tasks/tagColors'
import Tooltip from '@/components/ui/Tooltip'

const MAX_ROWS = 8

/**
 * Tag distribution for the current view (dashboard `by_tag`). Click a row to open that
 * slice in the segment drawer.
 *
 * Drawn as HTML bars rather than a recharts chart: each bar takes its tag's own palette
 * colour through the tag classes (kit §1 — no colour outside globals.css), which an SVG
 * fill attribute cannot reach. The tag name labels its bar directly, so no legend is
 * needed (kit §21 rule 3), and the bars share one zero baseline (rule 4).
 *
 * A task with several tags counts once under each, so the rows can add up to more than
 * the task total — the footnote says so. Renders nothing when there is no tag data.
 */
export default function TagSpreadChart({
  items,
  onSegment,
}: {
  items: DashboardBreakdownItem[] | undefined
  onSegment: (tagId: string, label: string) => void
}) {
  const data = (items ?? [])
    .filter((t) => t.id && t.total > 0)
    .slice()
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  if (data.length === 0) return null

  const shown = data.slice(0, MAX_ROWS)
  const hidden = data.length - shown.length
  const max = Math.max(...shown.map((t) => t.total))

  return (
    <div className="bg-white border border-border rounded-card shadow-card p-4 flex flex-col h-[320px]">
      <h3 className="text-[15px] font-semibold text-heading mb-3 shrink-0">By tag</h3>
      <ul className="flex-1 min-h-0 flex flex-col gap-1">
        {shown.map((t) => (
          <li key={t.id!}>
            <button
              type="button"
              onClick={() => onSegment(t.id!, t.label)}
              className="w-full grid grid-cols-[92px_1fr_auto] items-center gap-2 rounded-btn px-1 py-1 text-left hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              aria-label={`${t.label}: ${t.total} task${t.total === 1 ? '' : 's'}`}
            >
              <Tooltip label={t.label}>
                <span className="text-xs text-secondary truncate">{t.label}</span>
              </Tooltip>
              <span className="h-3 rounded-full bg-border/60 overflow-hidden">
                <span
                  className={`block h-full rounded-full ${tagDotClass(t.color)}`}
                  style={{ width: `${Math.max(4, (t.total / max) * 100)}%` }}
                />
              </span>
              <span className="text-xs font-medium text-heading tabular-nums min-w-[2ch] text-right">{t.total}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 shrink-0 text-xs text-secondary">
        {hidden > 0 ? `Top ${MAX_ROWS} of ${data.length} tags. ` : ''}A task with several tags counts under each.
      </p>
    </div>
  )
}
