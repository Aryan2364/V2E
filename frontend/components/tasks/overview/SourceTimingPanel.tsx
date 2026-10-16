'use client'

import React from 'react'
import type { SourceItem } from '@/lib/types/tasks'
import TimingMiniBar from './TimingMiniBar'
import TimingLegend from './TimingLegend'

/**
 * A "where work comes from" panel: each source row (Immediate / Same-dept / External, or a
 * department) shown as a timing bar + total + overdue%. Click a row to open its task list.
 * Reused across Own / Team / Org for source, incoming, external-load and outgoing cuts.
 */
export default function SourceTimingPanel({
  title,
  hint,
  items,
  onSelect,
  emptyText = 'No work in this view.',
}: {
  title: string
  hint?: string
  items: SourceItem[]
  onSelect?: (item: SourceItem) => void
  emptyText?: string
}) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary py-8 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((it) => {
            const overdueRate = it.total ? Math.round((it.timing.overdue / it.total) * 100) : 0
            const Row = onSelect ? 'button' : 'div'
            return (
              <Row
                key={it.id}
                {...(onSelect ? { onClick: () => onSelect(it), type: 'button' as const } : {})}
                className={`w-full text-left rounded-[10px] border border-border-light px-3.5 py-2.5 transition-colors ${onSelect ? 'hover:border-primary hover:bg-surface-sunken' : ''}`}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="font-semibold text-sm text-text-primary truncate">{it.label}</span>
                  <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: overdueRate >= 25 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    <span className="font-bold">{overdueRate}%</span> overdue · {it.total}
                  </span>
                </div>
                <TimingMiniBar timing={it.timing} />
              </Row>
            )
          })}
        </div>
      )}
      <div className="pt-3 mt-1"><TimingLegend /></div>
    </div>
  )
}
