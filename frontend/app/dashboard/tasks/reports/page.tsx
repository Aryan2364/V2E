'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { TaskReportData } from '@/lib/types/tasks'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { Download, Users, Building2, Tag, CheckCircle2, RotateCcw, BarChart2, AlertTriangle } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// Flatten the ResponsiveTable card so it blends into the section card it lives in.
const FLAT_TABLE = 'border-0 shadow-none rounded-none'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exportCsv(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([lines], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function completionRate(completed: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((completed / total) * 100)}%`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, onExport }: { icon: React.ReactNode; title: string; onExport: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="flex items-center gap-2 text-card-heading font-medium text-text-primary">
        {icon}
        {title}
      </h2>
      <Button variant="secondary" size="sm" onClick={onExport}>
        <Download size={14} />
        Export CSV
      </Button>
    </div>
  )
}

function StatBanner({ data }: { data: TaskReportData }) {
  const total = data.total_tasks
  const completed = data.user_performance.reduce((s, u) => s + u.completed, 0)
  const overdue = data.user_performance.reduce((s, u) => s + u.overdue, 0)
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0

  const stats = [
    { label: 'Total tasks', value: total, icon: <BarChart2 size={20} />, color: 'var(--primary-text)' },
    { label: 'Completed', value: completed, icon: <CheckCircle2 size={20} />, color: 'var(--success)' },
    { label: 'Overdue', value: overdue, icon: <AlertTriangle size={20} />, color: 'var(--danger)' },
    { label: 'Completion rate', value: `${rate}%`, icon: <BarChart2 size={20} />, color: 'var(--text-secondary)' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="bg-surface border border-border-light rounded-card shadow-card p-4 flex items-start gap-4"
        >
          <div
            className="w-10 h-10 rounded-control flex items-center justify-center shrink-0"
            style={{ backgroundColor: s.color + '18', color: s.color }}
          >
            {s.icon}
          </div>
          <div>
            <p className="text-page-title font-medium text-text-primary leading-tight tabular-nums">{s.value}</p>
            <p className="text-label text-text-secondary mt-0.5">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

const CHART_TOOLTIP_STYLE = { borderRadius: 8, border: '1px solid var(--border-light)', fontSize: 13 }

// ─── User Performance ─────────────────────────────────────────────────────────

function UserPerformanceSection({ data }: { data: TaskReportData }) {
  const rows = data.user_performance.sort((a, b) => b.total - a.total)

  const chartData = rows.slice(0, 10).map((u) => ({
    name: u.user?.name ?? 'Unknown',
    Total: u.total,
    Completed: u.completed,
    Overdue: u.overdue,
  }))

  function handleExport() {
    exportCsv('user_performance.csv',
      rows.map((u) => [
        u.user?.name ?? 'Unknown',
        u.user?.email ?? '',
        String(u.total),
        String(u.completed),
        String(u.overdue),
        completionRate(u.completed, u.total),
      ]),
      ['Name', 'Email', 'Total', 'Completed', 'Overdue', 'Completion Rate'],
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <SectionHeader icon={<Users size={16} className="text-primary-text" />} title="User performance" onExport={handleExport} />

      {rows.length === 0 ? (
        <p className="text-body text-text-secondary text-center py-8">No user data available for this period.</p>
      ) : (
        <div className="space-y-6">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Total" fill="var(--primary-border)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Completed" fill="var(--success)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Overdue" fill="var(--danger)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ResponsiveTable
            className={FLAT_TABLE}
            columns={userPerfColumns}
            rows={rows}
            rowKey={(u) => u.user_id}
          />
        </div>
      )}
    </div>
  )
}

type UserPerfRow = TaskReportData['user_performance'][number]

const userPerfColumns: ResponsiveColumn<UserPerfRow>[] = [
  {
    key: 'name',
    header: 'Name',
    primary: true,
    cellClassName: 'font-medium text-text-primary',
    render: (u) => u.user?.name ?? 'Unknown',
  },
  {
    key: 'email',
    header: 'Email',
    cellClassName: 'text-text-secondary',
    render: (u) => u.user?.email ?? '—',
  },
  {
    key: 'total',
    header: 'Total',
    cellClassName: 'text-text-primary tabular-nums',
    render: (u) => u.total,
  },
  {
    key: 'completed',
    header: 'Completed',
    cellClassName: 'text-success font-medium tabular-nums',
    render: (u) => u.completed,
  },
  {
    key: 'overdue',
    header: 'Overdue',
    cellClassName: 'text-danger font-medium tabular-nums',
    render: (u) => u.overdue,
  },
  {
    key: 'rate',
    header: 'Rate',
    render: (u) => {
      const rate = u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-surface-control rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${rate}%` }} />
          </div>
          <span className="text-meta font-medium text-text-secondary w-8 shrink-0">{rate}%</span>
        </div>
      )
    },
  },
]

// ─── Department Performance ───────────────────────────────────────────────────

function DeptPerformanceSection({ data }: { data: TaskReportData }) {
  const rows = data.department_performance.sort((a, b) => b.total - a.total)

  const chartData = rows.map((d) => ({
    name: d.department?.name ?? 'No Department',
    Total: d.total,
    Completed: d.completed,
    Overdue: d.overdue,
  }))

  function handleExport() {
    exportCsv('department_performance.csv',
      rows.map((d) => [
        d.department?.name ?? 'No Department',
        String(d.total),
        String(d.completed),
        String(d.overdue),
        completionRate(d.completed, d.total),
      ]),
      ['Department', 'Total', 'Completed', 'Overdue', 'Completion Rate'],
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <SectionHeader icon={<Building2 size={16} className="text-text-secondary" />} title="Department performance" onExport={handleExport} />

      {rows.length === 0 ? (
        <p className="text-body text-text-secondary text-center py-8">No department data available for this period.</p>
      ) : (
        <div className="space-y-6">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Total" fill="var(--primary-border)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Completed" fill="var(--success)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Overdue" fill="var(--danger)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ResponsiveTable
            className={FLAT_TABLE}
            columns={deptPerfColumns}
            rows={rows}
            rowKey={(d) => d.department_id ?? 'none'}
          />
        </div>
      )}
    </div>
  )
}

type DeptPerfRow = TaskReportData['department_performance'][number]

const deptPerfColumns: ResponsiveColumn<DeptPerfRow>[] = [
  {
    key: 'department',
    header: 'Department',
    primary: true,
    cellClassName: 'font-medium text-text-primary',
    render: (d) => d.department?.name ?? 'No Department',
  },
  {
    key: 'total',
    header: 'Total',
    cellClassName: 'text-text-primary tabular-nums',
    render: (d) => d.total,
  },
  {
    key: 'completed',
    header: 'Completed',
    cellClassName: 'text-success font-medium tabular-nums',
    render: (d) => d.completed,
  },
  {
    key: 'overdue',
    header: 'Overdue',
    cellClassName: 'text-danger font-medium tabular-nums',
    render: (d) => d.overdue,
  },
  {
    key: 'rate',
    header: 'Rate',
    render: (d) => {
      const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-surface-control rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${rate}%` }} />
          </div>
          <span className="text-meta font-medium text-text-secondary w-8 shrink-0">{rate}%</span>
        </div>
      )
    },
  },
]

// ─── Breakdown Pie ─────────────────────────────────────────────────────────────

interface BreakdownRow { label: string; color: string; total: number; completed: number; overdue: number }

function BreakdownSection({
  icon, title, rows, exportFilename,
}: {
  icon: React.ReactNode; title: string; rows: BreakdownRow[]; exportFilename: string
}) {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const pieData = rows.map((r) => ({ name: r.label, value: r.total, color: r.color }))

  function handleExport() {
    exportCsv(exportFilename,
      rows.map((r) => [r.label, String(r.total), String(r.completed), String(r.overdue), completionRate(r.completed, r.total)]),
      ['Label', 'Total', 'Completed', 'Overdue', 'Completion Rate'],
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <SectionHeader icon={icon} title={title} onExport={handleExport} />

      {rows.length === 0 ? (
        <p className="text-body text-text-secondary text-center py-8">No data available for this period.</p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-48 shrink-0 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v} tasks`, '']} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1 min-w-0">
            <ResponsiveTable
              className={FLAT_TABLE}
              columns={[
                {
                  key: 'label',
                  header: 'Label',
                  primary: true,
                  render: (r) => (
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="font-medium text-text-primary truncate">{r.label}</span>
                    </div>
                  ),
                },
                { key: 'total', header: 'Total', cellClassName: 'text-text-primary tabular-nums', render: (r) => r.total },
                { key: 'completed', header: 'Completed', cellClassName: 'text-success font-medium tabular-nums', render: (r) => r.completed },
                { key: 'overdue', header: 'Overdue', cellClassName: 'text-danger font-medium tabular-nums', render: (r) => r.overdue },
                {
                  key: 'rate',
                  header: 'Rate',
                  cellClassName: 'text-text-secondary tabular-nums',
                  render: (r) => `${r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0}%`,
                },
                {
                  key: 'share',
                  header: 'Share',
                  cellClassName: 'text-text-secondary tabular-nums',
                  render: (r) => `${grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0}%`,
                },
              ]}
              rows={rows}
              rowKey={(r) => r.label}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────

function StatusBreakdownSection({ data }: { data: TaskReportData }) {
  const rows = data.status_breakdown
  const total = rows.reduce((s, r) => s + r.total, 0)
  const pieData = rows.map((r) => ({ name: r.label, value: r.total, color: r.color }))

  function handleExport() {
    exportCsv('status_breakdown.csv',
      rows.map((r) => [r.label, String(r.total), total > 0 ? `${Math.round((r.total / total) * 100)}%` : '0%']),
      ['Status', 'Count', 'Share'],
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <SectionHeader icon={<CheckCircle2 size={16} className="text-success" />} title="Status distribution" onExport={handleExport} />

      {rows.length === 0 ? (
        <p className="text-body text-text-secondary text-center py-8">No status data available.</p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-48 shrink-0 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v} tasks`, '']} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1 space-y-2.5">
            {rows.map((r) => {
              const pct = total > 0 ? Math.round((r.total / total) * 100) : 0
              return (
                <div key={r.label}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="text-body font-medium text-text-primary">{r.label}</span>
                    </div>
                    <span className="text-label text-text-secondary tabular-nums">{r.total} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-surface-control rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: r.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Frequency Breakdown ──────────────────────────────────────────────────────

function FrequencySection({ data }: { data: TaskReportData }) {
  const { recurring, one_time } = data.frequency_breakdown
  const total = recurring.total + one_time.total

  const chartData = [
    { name: 'Recurring', Total: recurring.total, Completed: recurring.completed },
    { name: 'One-Time', Total: one_time.total, Completed: one_time.completed },
  ]

  function handleExport() {
    exportCsv('frequency_breakdown.csv',
      [
        ['Recurring', String(recurring.total), String(recurring.completed), completionRate(recurring.completed, recurring.total)],
        ['One-Time', String(one_time.total), String(one_time.completed), completionRate(one_time.completed, one_time.total)],
      ],
      ['Type', 'Total', 'Completed', 'Completion Rate'],
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <SectionHeader icon={<RotateCcw size={16} className="text-warning" />} title="Task frequency" onExport={handleExport} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Total" fill="var(--primary-border)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completed" fill="var(--success)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-3">
          {[
            { label: 'Recurring', data: recurring, color: 'var(--warning)' },
            { label: 'One-Time', data: one_time, color: 'var(--primary-text)' },
          ].map(({ label, data: d, color }) => {
            const pct = total > 0 ? Math.round((d.total / total) * 100) : 0
            const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0
            return (
              <div key={label} className="border border-border-light rounded-control p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-text-primary">{label}</span>
                  <span
                    className="text-meta font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: color + '18', color }}
                  >
                    {pct}% of all tasks
                  </span>
                </div>
                <div className="flex gap-4 text-body">
                  <span className="text-text-secondary">Total: <strong className="text-text-primary">{d.total}</strong></span>
                  <span className="text-text-secondary">Completed: <strong className="text-success">{d.completed}</strong></span>
                  <span className="text-text-secondary">Rate: <strong className="text-text-primary">{rate}%</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [data, setData] = useState<TaskReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    tasksApi.getReports(orgId, {
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [orgId, fromDate, toDate])

  useEffect(() => { loadData() }, [loadData])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta="Organization-wide task analytics — completion, priority, category and status breakdowns."
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-[220px]">
              <DateRangePicker from={fromDate} to={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} />
            </div>
            {(fromDate || toDate) && (
              <Button
                variant="secondary"
                onClick={() => { setFromDate(''); setToDate('') }}
              >
                Clear
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-card" />
        </div>
      ) : !data ? (
        <div className="flex flex-col items-center justify-center h-64">
          <p className="font-medium text-text-primary">Failed to load reports</p>
          <Button className="mt-3" onClick={loadData}>Retry</Button>
        </div>
      ) : (
        <>
          <StatBanner data={data} />
          <UserPerformanceSection data={data} />
          <DeptPerformanceSection data={data} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BreakdownSection
              icon={<Tag size={16} className="text-warning" />}
              title="Priority breakdown"
              rows={data.priority_breakdown}
              exportFilename="priority_breakdown.csv"
            />
            <BreakdownSection
              icon={<Tag size={16} className="text-text-secondary" />}
              title="Category breakdown"
              rows={data.category_breakdown}
              exportFilename="category_breakdown.csv"
            />
          </div>

          <StatusBreakdownSection data={data} />
          <FrequencySection data={data} />
        </>
      )}
    </div>
  )
}
