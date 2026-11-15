'use client'

import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

// A 5-series qualitative chart palette (kit section 21): position, not hex
// identity, is what distinguishes the slices, so this reads chart-1..5.
const PIE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function MeetingLoadChart({ data: loadData }: { data: { name: string; meetings: number }[] }) {
  return (
<ResponsiveContainer width="100%" height={220}>
                  <BarChart data={loadData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                    <Tooltip />
                    <Bar dataKey="meetings" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
  )
}

export function LinkageChart({ data: linkData }: { data: { name: string; value: number }[] }) {
  return (
<ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={linkData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.name} (${e.value}h)`}>
                        {linkData.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
  )
}
