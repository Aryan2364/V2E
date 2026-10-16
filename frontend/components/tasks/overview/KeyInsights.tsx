'use client'

import React, { useMemo } from 'react'
import type { TaskDashboard } from '@/lib/types/tasks'

/** Derive a short, plain-language read of the current view from its aggregates. */
function generateInsights(d: TaskDashboard): string[] {
  const out: string[] = []
  const k = d.kpis

  // Worst department by overdue share (needs a meaningful base).
  const depts = d.by_department
    .filter((x) => x.total >= 3)
    .map((x) => ({ label: x.label, total: x.total, rate: Math.round((x.timing.overdue / x.total) * 100) }))
    .sort((a, b) => b.rate - a.rate)
  if (depts[0] && depts[0].rate > 0) {
    out.push(`${depts[0].label} needs the most attention — ${depts[0].rate}% of its tasks are overdue.`)
  }

  if (k.critical_high_open > 0) {
    out.push(`${k.critical_high_open} critical / high-priority task${k.critical_high_open > 1 ? 's are' : ' is'} still open.`)
  }

  // On-time delivery direction over the monthly series.
  const rated = d.trend_monthly.filter((m) => m.on_time_rate != null) as { on_time_rate: number }[]
  if (rated.length >= 4) {
    const half = Math.floor(rated.length / 2)
    const earlier = rated.slice(0, half)
    const recent = rated.slice(half)
    const avg = (a: { on_time_rate: number }[]) => Math.round(a.reduce((s, x) => s + x.on_time_rate, 0) / a.length)
    const e = avg(earlier), r = avg(recent)
    if (r < e - 8) out.push(`On-time delivery is slipping — ${e}% earlier down to ${r}% recently.`)
    else if (r > e + 8) out.push(`On-time delivery is improving — up to ${r}% recently.`)
  }

  if (k.delta != null && Math.abs(k.delta) >= 3) {
    out.push(`Completion rate is ${k.delta >= 0 ? 'up' : 'down'} ${Math.abs(k.delta)} pts vs last month (now ${k.completion_rate}%).`)
  }

  if (k.completed > 0 && out.length < 5) {
    out.push(`Overall: ${k.completion_rate}% complete, ${k.on_time_rate}% of those delivered on time.`)
  }

  if (!out.length) out.push('Not enough activity in this view to surface trends yet.')
  return out.slice(0, 5)
}

export default function KeyInsights({ dashboard, contextLabel }: { dashboard: TaskDashboard; contextLabel?: string }) {
  const insights = useMemo(() => generateInsights(dashboard), [dashboard])
  return (
    <div className="rounded-xl p-4 bg-text-primary text-white shadow-card flex flex-col h-[320px]">
      <h3 className="text-[15px] font-medium text-white mb-3 shrink-0">
        Key insights{contextLabel && <span className="text-on-brand-accent font-normal"> · {contextLabel}</span>}
      </h3>
      <ul className="space-y-3 overflow-y-auto flex-1 pr-1">
        {insights.map((t, i) => (
          <li key={i} className="text-sm leading-snug flex gap-2 text-white/90">
            <span className="text-on-brand-accent shrink-0">—</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
