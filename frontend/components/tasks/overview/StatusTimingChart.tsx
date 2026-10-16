'use client'

import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { TIMINGS, TIMING_META, type DashboardBreakdownItem, type Timing } from '@/lib/types/tasks'
import TimingLegend from './TimingLegend'

/** Status × completion-timing — are tasks in each status on track or slipping? */
export default function StatusTimingChart({
  items,
  onSegment,
}: {
  items: DashboardBreakdownItem[]
  onSegment: (statusId: string, label: string, timing: Timing) => void
}) {
  const data = items
    .filter((s) => s.total > 0)
    .map((s) => ({ id: s.id, label: s.label, ...s.timing }))

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4 flex flex-col h-[320px]">
      <h3 className="text-body font-medium text-text-primary mb-3 shrink-0">Status · on track vs slipping</h3>
      {data.length === 0 ? (
        <p className="text-label text-text-secondary flex-1 grid place-items-center">No tasks in this view.</p>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={104} />
              <Tooltip cursor={{ fill: 'var(--primary-subtle)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 13 }} />
              {TIMINGS.map((t) => (
                <Bar
                  key={t}
                  dataKey={t}
                  name={TIMING_META[t].label}
                  stackId="a"
                  fill={TIMING_META[t].color}
                  cursor="pointer"
                  onClick={(d: any) => d?.id && onSegment(d.id, d.label, t)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="pt-3 shrink-0"><TimingLegend /></div>
    </div>
  )
}
