'use client'

import React from 'react'
import { ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import type { MonthlyTrendPoint } from '@/lib/types/tasks'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function label(month: string) {
  const d = new Date(month)
  return `${MONTHS[d.getMonth()]}`
}

/** Monthly due vs completed (by deadline) with an on-time-% line. Click a month to drill in. */
export default function MonthlyTrendChart({
  trend,
  onMonth,
}: {
  trend: MonthlyTrendPoint[]
  onMonth?: (month: string, label: string) => void
}) {
  const data = (trend ?? []).map((t) => ({ ...t, label: label(t.month) }))
  const empty = data.every((d) => d.due === 0 && d.completed === 0)

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 flex flex-col h-[320px]">
      <h3 className="text-[15px] font-semibold text-text-primary mb-3 shrink-0">Monthly trend · due vs completed</h3>
      {empty ? (
        <p className="text-sm text-text-secondary flex-1 grid place-items-center">No activity in this window.</p>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
              onClick={(e: any) => {
                const p = e?.activePayload?.[0]?.payload
                if (p && onMonth) onMonth(p.month, p.label)
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--border-light)" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="l" dataKey="due" name="Due" fill="var(--primary-subtle)" stroke="var(--primary-border)" strokeWidth={1.5} />
              <Bar yAxisId="l" dataKey="completed" name="Completed" barSize={16} radius={[3, 3, 0, 0]} fill="var(--primary)" cursor="pointer" />
              <Line yAxisId="r" dataKey="on_time_rate" name="On-time %" stroke="var(--warning)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
