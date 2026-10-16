'use client'

import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import type { DashboardBreakdownItem } from '@/lib/types/tasks'

/** Category distribution for the current view. Click a bar to open that slice. */
export default function CategorySpreadChart({
  items,
  onSegment,
}: {
  items: DashboardBreakdownItem[]
  onSegment: (categoryId: string, label: string) => void
}) {
  const data = items
    .filter((c) => c.total > 0)
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((c) => ({ id: c.id, name: c.label, value: c.total, color: c.color || 'var(--text-secondary)' }))

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4 flex flex-col h-[320px]">
      <h3 className="text-body font-medium text-text-primary mb-3 shrink-0">Category spread</h3>
      {data.length === 0 ? (
        <p className="text-label text-text-secondary flex-1 grid place-items-center">No tasks in this view.</p>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={92} />
              <Tooltip cursor={{ fill: 'var(--primary-subtle)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 13 }} />
              <Bar dataKey="value" name="Tasks" radius={[0, 4, 4, 0]} fill="var(--text-secondary)" cursor="pointer" onClick={(d: any) => d?.id && onSegment(d.id, d.name)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
