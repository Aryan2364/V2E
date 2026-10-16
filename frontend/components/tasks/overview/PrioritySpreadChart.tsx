'use client'

import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts'
import type { DashboardBreakdownItem } from '@/lib/types/tasks'

/** Priority distribution for the current view. Click a bar to open that slice. */
export default function PrioritySpreadChart({
  items,
  onSegment,
}: {
  items: DashboardBreakdownItem[]
  onSegment: (priorityId: string, label: string) => void
}) {
  const data = items.filter((p) => p.total > 0).map((p) => ({ id: p.id, name: p.label, value: p.total, color: p.color || '#2563EB' }))

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 flex flex-col h-[320px]">
      <h3 className="text-[15px] font-semibold text-text-primary mb-3 shrink-0">Priority spread</h3>
      {data.length === 0 ? (
        <p className="text-sm text-text-secondary flex-1 grid place-items-center">No tasks in this view.</p>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
              <Tooltip cursor={{ fill: '#EFF6FF' }} contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }} />
              <Bar dataKey="value" name="Tasks" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d: any) => d?.id && onSegment(d.id, d.name)}>
                {data.map((d) => <Cell key={d.id ?? d.name} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
