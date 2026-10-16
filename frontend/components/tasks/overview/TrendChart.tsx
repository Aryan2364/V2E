'use client'

import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import type { TrendPoint } from '@/lib/types/tasks'

function label(week: string): string {
  const d = new Date(week)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Weekly created-vs-completed trend (last 8 weeks) for the current scope/filters. */
export default function TrendChart({ trend }: { trend: TrendPoint[] }) {
  if (!trend || trend.length === 0) return null
  const data = trend.map((t) => ({ ...t, label: label(t.week) }))
  const empty = data.every((d) => d.created === 0 && d.completed === 0)

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
      <p className="text-[13px] font-semibold text-text-primary mb-3">Trend · created vs completed (8 weeks)</p>
      {empty ? (
        <p className="text-[13px] text-text-muted py-8 text-center">No activity in this window.</p>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }}
                labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="created" name="Created" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="completed" name="Completed" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
