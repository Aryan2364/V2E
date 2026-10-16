'use client'

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DashboardKpis } from '@/lib/types/tasks'

export type AgingBand = 'd0_7' | 'd8_30' | 'd30_plus'

/**
 * Overdue-aging strip: how long the open, past-due work has been slipping. A wall of
 * 30d+ overdue is a very different signal from a flat overdue count. Each band opens the
 * matching slice (overdue tasks within that age window).
 */
export default function OverdueAgingPanel({
  aging,
  onSelect,
}: {
  aging: DashboardKpis['overdue_aging']
  onSelect?: (band: AgingBand) => void
}) {
  const bands: { key: AgingBand; label: string; value: number; color: string }[] = [
    { key: 'd0_7', label: '1–7 days', value: aging.d0_7, color: 'var(--warning)' },
    { key: 'd8_30', label: '8–30 days', value: aging.d8_30, color: 'var(--danger)' },
    { key: 'd30_plus', label: '30+ days', value: aging.d30_plus, color: 'var(--danger)' },
  ]
  const total = bands.reduce((s, b) => s + b.value, 0)

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-danger-bg text-danger grid place-items-center"><AlertTriangle size={15} /></span>
        <h3 className="text-[15px] font-medium text-text-primary">Overdue aging</h3>
        <span className="text-xs text-text-muted ml-auto">{total} open & past due</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {bands.map((b) => {
          const Tag = onSelect ? 'button' : 'div'
          return (
            <Tag
              key={b.key}
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(b.key) } : {})}
              className={`text-left rounded-lg border border-border-light px-3.5 py-3 transition-colors ${onSelect ? 'hover:border-primary hover:bg-surface-sunken' : ''}`}
            >
              <div className="text-2xl font-medium tabular-nums leading-none" style={{ color: b.value > 0 ? b.color : 'var(--text-muted)' }}>{b.value}</div>
              <div className="text-[13px] text-text-secondary mt-1">{b.label}</div>
            </Tag>
          )
        })}
      </div>
    </div>
  )
}
