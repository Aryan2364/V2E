'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import HoverTip from '@/components/ui/tooltip'
import type {
  TicketReportResolutionTime,
  TicketReportBreakdown,
  TicketReportSlaBreaches,
  TicketReportRatings,
  TicketReportFirstResponse,
  TicketReportBacklogAging,
  TicketReportAgentLoad,
  TicketReportReopenRate,
} from '@/lib/types/tickets'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { Download, Clock, Tag, BarChart2, AlertTriangle, Star, Activity, Reply, Layers, Users, RotateCcw } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import DateRangePicker from '@/components/ui/DateRangePicker'

// Flatten the ResponsiveTable card so it blends into the tab content panel.
const FLAT_TABLE = 'border-0 shadow-none rounded-none'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exportCsv(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([lines], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const CHART_TOOLTIP_STYLE = { borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }

type ReportTab =
  | 'resolution' | 'first_response' | 'by_type' | 'by_category' | 'by_priority'
  | 'by_status' | 'sla' | 'backlog' | 'agent_load' | 'reopen' | 'ratings'

const TABS: { key: ReportTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: 'resolution', label: 'Resolution Time', icon: <Clock size={14} /> },
  { key: 'first_response', label: 'First Response', icon: <Reply size={14} /> },
  { key: 'by_type', label: 'By Type', icon: <Tag size={14} /> },
  { key: 'by_category', label: 'By Category', icon: <Tag size={14} /> },
  { key: 'by_priority', label: 'By Priority', icon: <BarChart2 size={14} /> },
  { key: 'by_status', label: 'By Status', icon: <Activity size={14} /> },
  { key: 'sla', label: 'SLA Breach', icon: <AlertTriangle size={14} /> },
  { key: 'backlog', label: 'Backlog Aging', icon: <Layers size={14} /> },
  { key: 'agent_load', label: 'Agent Load', icon: <Users size={14} /> },
  { key: 'reopen', label: 'Reopen Rate', icon: <RotateCcw size={14} /> },
  { key: 'ratings', label: 'Ratings', icon: <Star size={14} /> },
]

// ─── Resolution Time ──────────────────────────────────────────────────────────

function ResolutionTimeTab({
  orgId, from, to,
}: { orgId: string; from: string; to: string }) {
  const [data, setData] = useState<TicketReportResolutionTime[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getResolutionTime(orgId, from || undefined, to || undefined)
      .then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }, [orgId, from, to])

  if (loading) return <Spinner />

  const sorted = [...data].sort((a, b) => a.avg_days - b.avg_days)
  const chartData = sorted.map((d) => ({ name: d.user_id.slice(0, 8), avg_days: d.avg_days, tickets: d.ticket_count }))
  const avg = data.length > 0 ? (data.reduce((s, d) => s + d.avg_days, 0) / data.length) : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Assignees with data" value={data.length} color="var(--primary-text)" />
        <StatCard label="Avg resolution time" value={`${avg.toFixed(1)}d`} color="var(--text-secondary)" />
        <StatCard label="Fastest" value={sorted.length > 0 ? `${sorted[0].avg_days.toFixed(1)}d` : '—'} color="var(--success)" />
      </div>

      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} unit="d" />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)} days`, 'Avg resolution']} />
                <Bar dataKey="avg_days" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('resolution_time.csv',
              sorted.map((d) => [d.user_id, String(d.ticket_count), d.avg_days.toFixed(2)]),
              ['User ID', 'Ticket Count', 'Avg Days'],
            )} />
          </div>

          <ResponsiveTable
            className={FLAT_TABLE}
            columns={resolutionColumns}
            rows={sorted}
            rowKey={(d) => d.user_id}
          />
        </>
      )}
    </div>
  )
}

const resolutionColumns: ResponsiveColumn<TicketReportResolutionTime>[] = [
  {
    key: 'user_id',
    header: 'User ID',
    primary: true,
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (d) => d.user_id,
  },
  {
    key: 'ticket_count',
    header: 'Tickets Resolved',
    cellClassName: 'text-text-primary tabular-nums',
    render: (d) => d.ticket_count,
  },
  {
    key: 'avg_days',
    header: 'Avg Resolution Time',
    cellClassName: 'text-text-primary tabular-nums font-medium',
    render: (d) => `${d.avg_days.toFixed(1)} days`,
  },
]

// ─── Breakdown (type/category/priority/status) ────────────────────────────────

function BreakdownTab({
  label, data, loading, exportFilename,
}: {
  label: string; data: TicketReportBreakdown[]; loading: boolean; exportFilename: string
}) {
  if (loading) return <Spinner />

  const total = data.reduce((s, d) => s + d.count, 0)
  const pieData = data.map((d) => ({ name: d.label, value: d.count, color: d.color }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label={`Total ${label}`} value={data.length} color="var(--primary-text)" />
        <StatCard label="Total Tickets" value={total} color="var(--text-secondary)" />
      </div>

      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="w-full lg:w-52 shrink-0 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2} dataKey="value">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v} tickets`, '']} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              {data.map((d) => {
                const pct = total > 0 ? Math.round((d.count / total) * 100) : 0
                return (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-sm font-medium text-text-primary">{d.label}</span>
                      </div>
                      <span className="text-sm text-text-secondary tabular-nums">{d.count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-surface-control rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv(exportFilename,
              data.map((d) => [d.label, String(d.count), `${d.share.toFixed(1)}%`]),
              ['Label', 'Count', 'Share'],
            )} />
          </div>
        </>
      )}
    </div>
  )
}

// ─── SLA Breach ───────────────────────────────────────────────────────────────

function SlaTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [data, setData] = useState<TicketReportSlaBreaches | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getSlaBreaches(orgId, from || undefined, to || undefined)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [orgId, from, to])

  if (loading) return <Spinner />
  if (!data) return <Empty />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Tickets" value={data.total} color="var(--primary-text)" />
        <StatCard label="SLA Breached" value={data.breached} color="var(--danger)" />
        <StatCard label="Breach Rate" value={`${data.breach_rate.toFixed(1)}%`} color="var(--warning)" />
      </div>

      {data.tickets.length === 0 ? (
        <div className="text-center py-12 text-sm text-text-secondary">No SLA breaches in this period.</div>
      ) : (
        <>
          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('sla_breaches.csv',
              data.tickets.map((t) => [t.ticket_number, t.title, t.sla_due_at, t.created_at]),
              ['Ticket #', 'Title', 'SLA Due', 'Created At'],
            )} />
          </div>
          <ResponsiveTable
            className={FLAT_TABLE}
            columns={slaColumns}
            rows={data.tickets}
            rowKey={(t) => t.id}
          />
        </>
      )}
    </div>
  )
}

type SlaTicketRow = TicketReportSlaBreaches['tickets'][number]

const slaColumns: ResponsiveColumn<SlaTicketRow>[] = [
  {
    key: 'ticket_number',
    header: 'Ticket #',
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (t) => t.ticket_number,
  },
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'text-text-primary font-medium',
    render: (t) => t.title,
  },
  {
    key: 'sla_due',
    header: 'SLA Due',
    cellClassName: 'text-danger tabular-nums',
    render: (t) => new Date(t.sla_due_at).toLocaleDateString('en-IN'),
  },
  {
    key: 'status',
    header: 'Status',
    render: () => (
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger-bg text-danger">Breached</span>
    ),
  },
]

// ─── Ratings ─────────────────────────────────────────────────────────────────

function RatingsTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [data, setData] = useState<TicketReportRatings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getRatings(orgId, from || undefined, to || undefined)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [orgId, from, to])

  if (loading) return <Spinner />
  if (!data) return <Empty />

  const chartData = data.distribution.map((d) => ({
    name: `${'★'.repeat(d.rating)}`,
    count: d.count,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Ratings" value={data.total_ratings} color="var(--warning)" />
        <StatCard label="Avg Rating" value={`${data.avg_rating.toFixed(2)} / 5`} color="var(--primary-text)" />
      </div>

      {data.total_ratings === 0 ? (
        <div className="text-center py-12 text-sm text-text-secondary">No ratings in this period.</div>
      ) : (
        <>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="name" tick={{ fontSize: 13, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v} tickets`, '']} />
                <Bar dataKey="count" fill="var(--warning)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('ratings.csv',
              data.tickets.map((t) => [t.ticket_number, t.title, String(t.rating), t.rating_comment ?? '', t.rated_at]),
              ['Ticket #', 'Title', 'Rating', 'Comment', 'Rated At'],
            )} />
          </div>

          <ResponsiveTable
            className={FLAT_TABLE}
            columns={ratingsColumns}
            rows={data.tickets}
            rowKey={(t) => t.ticket_number}
          />
        </>
      )}
    </div>
  )
}

type RatingTicketRow = TicketReportRatings['tickets'][number]

const ratingsColumns: ResponsiveColumn<RatingTicketRow>[] = [
  {
    key: 'ticket_number',
    header: 'Ticket #',
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (t) => t.ticket_number,
  },
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'text-text-primary font-medium',
    render: (t) => t.title,
  },
  {
    key: 'rating',
    header: 'Rating',
    cellClassName: 'text-warning font-semibold',
    render: (t) => '★'.repeat(t.rating),
  },
  {
    key: 'comment',
    header: 'Comment',
    cellClassName: 'text-text-secondary max-w-[180px] truncate',
    render: (t) => t.rating_comment ?? '—',
  },
  {
    key: 'rated_at',
    header: 'Rated At',
    cellClassName: 'text-text-secondary tabular-nums',
    render: (t) => new Date(t.rated_at).toLocaleDateString('en-IN'),
  },
]

// ─── First Response ───────────────────────────────────────────────────────────

function FirstResponseTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [data, setData] = useState<TicketReportFirstResponse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getFirstResponse(orgId, from || undefined, to || undefined)
      .then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }, [orgId, from, to])

  if (loading) return <Spinner />

  const sorted = [...data].sort((a, b) => a.avg_hours - b.avg_hours)
  const totalResponded = data.reduce((s, d) => s + d.responded_count, 0)
  const totalBreached = data.reduce((s, d) => s + d.breached_count, 0)
  const avgHours = totalResponded > 0
    ? data.reduce((s, d) => s + d.avg_hours * d.responded_count, 0) / totalResponded
    : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Resolvers with data" value={data.length} color="var(--primary-text)" />
        <StatCard label="Responses" value={totalResponded} color="var(--text-secondary)" />
        <StatCard label="Avg first response" value={`${avgHours.toFixed(1)}h`} color="var(--success)" />
        <StatCard label="Response breaches" value={totalBreached} color="var(--danger)" />
      </div>

      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('first_response.csv',
              sorted.map((d) => [d.user_id, String(d.responded_count), d.avg_hours.toFixed(2), String(d.breached_count)]),
              ['User ID', 'Responded', 'Avg Hours', 'Breached'],
            )} />
          </div>
          <ResponsiveTable
            className={FLAT_TABLE}
            columns={firstResponseColumns}
            rows={sorted}
            rowKey={(d) => d.user_id}
          />
        </>
      )}
    </div>
  )
}

const firstResponseColumns: ResponsiveColumn<TicketReportFirstResponse>[] = [
  {
    key: 'user_id',
    header: 'User ID',
    primary: true,
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (d) => d.user_id,
  },
  {
    key: 'responded_count',
    header: 'Responded',
    cellClassName: 'text-text-primary tabular-nums',
    render: (d) => d.responded_count,
  },
  {
    key: 'avg_hours',
    header: 'Avg First Response',
    cellClassName: 'text-text-primary tabular-nums font-medium',
    render: (d) => `${d.avg_hours.toFixed(1)} h`,
  },
  {
    key: 'breached_count',
    header: 'Breached',
    cellClassName: 'tabular-nums font-medium',
    render: (d) => (
      <span className={d.breached_count > 0 ? 'text-danger font-semibold' : 'text-text-secondary'}>
        {d.breached_count}
      </span>
    ),
  },
]

// ─── Backlog Aging ────────────────────────────────────────────────────────────

const BACKLOG_BUCKET_COLORS = ['var(--success)', 'var(--text-secondary)', 'var(--primary-text)', 'var(--warning)', 'var(--danger)']

function BacklogAgingTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<TicketReportBacklogAging | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getBacklogAging(orgId)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <Spinner />
  if (!data) return <Empty />

  const chartData = data.buckets.map((b, i) => ({
    name: b.label,
    count: b.count,
    color: BACKLOG_BUCKET_COLORS[i % BACKLOG_BUCKET_COLORS.length],
  }))

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-secondary -mt-1">Live snapshot of currently open tickets — not affected by the date range.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Open" value={data.total_open} color="var(--primary-text)" />
        <StatCard label="Oldest (days)" value={data.oldest.length > 0 ? data.oldest[0].age_days : '—'} color="var(--warning)" />
      </div>

      {data.total_open === 0 ? (
        <div className="text-center py-12 text-sm text-text-secondary">No open tickets in the backlog.</div>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v} tickets`, 'Open']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {data.oldest.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Oldest open tickets</h3>
              <ResponsiveTable
                className={FLAT_TABLE}
                columns={backlogColumns}
                rows={data.oldest}
                rowKey={(t) => t.id}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

type BacklogRow = TicketReportBacklogAging['oldest'][number]

const backlogColumns: ResponsiveColumn<BacklogRow>[] = [
  {
    key: 'ticket_number',
    header: 'Ticket #',
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (t) => t.ticket_number,
  },
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'text-text-primary font-medium',
    render: (t) => (
      <span className="flex items-center gap-2">
        {t.sla_breached && <HoverTip label="SLA breached"><span className="w-2 h-2 rounded-full bg-danger shrink-0" /></HoverTip>}
        <span className="truncate">{t.title}</span>
      </span>
    ),
  },
  {
    key: 'age_days',
    header: 'Age',
    cellClassName: 'text-text-primary tabular-nums font-medium',
    render: (t) => `${t.age_days}d`,
  },
  {
    key: 'status',
    header: 'Status',
    cellClassName: 'text-text-secondary',
    render: (t) => t.status,
  },
]

// ─── Agent Load ───────────────────────────────────────────────────────────────

function AgentLoadTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<TicketReportAgentLoad[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getAgentLoad(orgId)
      .then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <Spinner />

  const sorted = [...data].sort((a, b) => b.total - a.total)
  const totalOpen = data.reduce((s, d) => s + d.open + d.in_progress + d.on_hold, 0)
  const totalBreached = data.reduce((s, d) => s + d.breached, 0)

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-secondary -mt-1">Live snapshot of resolver workload — not affected by the date range.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Resolvers" value={data.length} color="var(--primary-text)" />
        <StatCard label="Active workload" value={totalOpen} color="var(--text-secondary)" />
        <StatCard label="Breached" value={totalBreached} color="var(--danger)" />
      </div>

      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('agent_load.csv',
              sorted.map((d) => [d.user_id, String(d.open), String(d.in_progress), String(d.on_hold), String(d.breached), String(d.resolved), String(d.total)]),
              ['User ID', 'Open', 'In Progress', 'On Hold', 'Breached', 'Resolved', 'Total'],
            )} />
          </div>
          <ResponsiveTable
            className={FLAT_TABLE}
            columns={agentLoadColumns}
            rows={sorted}
            rowKey={(d) => d.user_id}
          />
        </>
      )}
    </div>
  )
}

const agentLoadColumns: ResponsiveColumn<TicketReportAgentLoad>[] = [
  {
    key: 'user_id',
    header: 'User ID',
    primary: true,
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (d) => d.user_id,
  },
  { key: 'open', header: 'Open', cellClassName: 'text-text-primary tabular-nums', render: (d) => d.open },
  { key: 'in_progress', header: 'In Progress', cellClassName: 'text-text-primary tabular-nums', render: (d) => d.in_progress },
  { key: 'on_hold', header: 'On Hold', cellClassName: 'text-text-primary tabular-nums', render: (d) => d.on_hold },
  {
    key: 'breached',
    header: 'Breached',
    cellClassName: 'tabular-nums font-medium',
    render: (d) => (
      <span className={d.breached > 0 ? 'text-danger font-semibold' : 'text-text-secondary'}>{d.breached}</span>
    ),
  },
  { key: 'resolved', header: 'Resolved', cellClassName: 'text-success tabular-nums', render: (d) => d.resolved },
  { key: 'total', header: 'Total', cellClassName: 'text-text-primary tabular-nums font-semibold', render: (d) => d.total },
]

// ─── Reopen Rate ──────────────────────────────────────────────────────────────

function ReopenRateTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [data, setData] = useState<TicketReportReopenRate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ticketsApi.getReopenRate(orgId, from || undefined, to || undefined)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [orgId, from, to])

  if (loading) return <Spinner />
  if (!data) return <Empty />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Reopen Rate" value={`${data.reopen_rate.toFixed(1)}%`} color="var(--warning)" />
        <StatCard label="Reopened Tickets" value={data.reopened_tickets} color="var(--primary-text)" />
        <StatCard label="Total Tickets" value={data.total_tickets} color="var(--text-secondary)" />
        <StatCard label="Total Reopens" value={data.total_reopens} color="var(--danger)" />
      </div>

      {data.most_reopened.length === 0 ? (
        <div className="text-center py-12 text-sm text-text-secondary">No reopened tickets in this period.</div>
      ) : (
        <>
          <div className="flex justify-end">
            <ExportBtn onClick={() => exportCsv('reopen_rate.csv',
              data.most_reopened.map((t) => [t.ticket_number, t.title, String(t.reopen_count)]),
              ['Ticket #', 'Title', 'Reopens'],
            )} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Most reopened tickets</h3>
            <ResponsiveTable
              className={FLAT_TABLE}
              columns={reopenColumns}
              rows={data.most_reopened}
              rowKey={(t) => t.id}
            />
          </div>
        </>
      )}
    </div>
  )
}

type ReopenRow = TicketReportReopenRate['most_reopened'][number]

const reopenColumns: ResponsiveColumn<ReopenRow>[] = [
  {
    key: 'ticket_number',
    header: 'Ticket #',
    cellClassName: 'font-mono text-xs text-text-secondary',
    render: (t) => t.ticket_number,
  },
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'text-text-primary font-medium',
    render: (t) => t.title,
  },
  {
    key: 'reopen_count',
    header: 'Reopens',
    cellClassName: 'text-warning tabular-nums font-semibold',
    render: (t) => t.reopen_count,
  },
]

// ─── Shared micro-components ──────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-text-secondary text-center py-12">No data available for this period.</p>
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-[7px] text-sm font-medium text-primary-text border border-primary rounded-[8px] hover:bg-primary-subtle transition-colors"
    >
      <Download size={14} />
      Export CSV
    </button>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
      <p className="text-xs font-medium text-text-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketReportsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [activeTab, setActiveTab] = useState<ReportTab>('resolution')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Breakdown data loaded per-tab
  const [typeData, setTypeData] = useState<TicketReportBreakdown[]>([])
  const [typeLoading, setTypeLoading] = useState(false)
  const [catData, setCatData] = useState<TicketReportBreakdown[]>([])
  const [catLoading, setCatLoading] = useState(false)
  const [priData, setPriData] = useState<TicketReportBreakdown[]>([])
  const [priLoading, setPriLoading] = useState(false)
  const [stData, setStData] = useState<TicketReportBreakdown[]>([])
  const [stLoading, setStLoading] = useState(false)

  const loadBreakdown = useCallback((tab: ReportTab) => {
    if (!orgId) return
    const f = from || undefined
    const t = to || undefined
    if (tab === 'by_type') { setTypeLoading(true); ticketsApi.getByType(orgId, f, t).then(setTypeData).catch(() => setTypeData([])).finally(() => setTypeLoading(false)) }
    if (tab === 'by_category') { setCatLoading(true); ticketsApi.getByCategory(orgId, f, t).then(setCatData).catch(() => setCatData([])).finally(() => setCatLoading(false)) }
    if (tab === 'by_priority') { setPriLoading(true); ticketsApi.getByPriority(orgId, f, t).then(setPriData).catch(() => setPriData([])).finally(() => setPriLoading(false)) }
    if (tab === 'by_status') { setStLoading(true); ticketsApi.getByStatus(orgId, f, t).then(setStData).catch(() => setStData([])).finally(() => setStLoading(false)) }
  }, [orgId, from, to])

  useEffect(() => { loadBreakdown(activeTab) }, [activeTab, loadBreakdown])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-text-primary">No organization found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-text-primary">Ticket Reports</h1>
          <p className="text-sm text-text-secondary mt-0.5">Analytics and insights for your ticket system</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-[220px]">
            <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
          </div>
          {(from || to) && (
            <button
              onClick={() => { setFrom(''); setTo('') }}
              className="px-3 py-[7px] text-sm font-medium text-danger border border-danger-border bg-danger-bg rounded-[8px] hover:bg-danger-bg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Tab container */}
      <div className="flex gap-6">
        {/* Left sidebar tabs */}
        <div className="w-44 shrink-0 flex flex-col gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                'flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-sm font-medium text-left transition-colors',
                activeTab === tab.key
                  ? 'bg-primary-subtle text-primary-text'
                  : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
              ].join(' ')}
            >
              <span className="shrink-0">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6">
          {activeTab === 'resolution' && <ResolutionTimeTab orgId={orgId} from={from} to={to} />}
          {activeTab === 'first_response' && <FirstResponseTab orgId={orgId} from={from} to={to} />}
          {activeTab === 'by_type' && <BreakdownTab label="types" data={typeData} loading={typeLoading} exportFilename="by_type.csv" />}
          {activeTab === 'by_category' && <BreakdownTab label="categories" data={catData} loading={catLoading} exportFilename="by_category.csv" />}
          {activeTab === 'by_priority' && <BreakdownTab label="priorities" data={priData} loading={priLoading} exportFilename="by_priority.csv" />}
          {activeTab === 'by_status' && <BreakdownTab label="statuses" data={stData} loading={stLoading} exportFilename="by_status.csv" />}
          {activeTab === 'sla' && <SlaTab orgId={orgId} from={from} to={to} />}
          {activeTab === 'backlog' && <BacklogAgingTab orgId={orgId} />}
          {activeTab === 'agent_load' && <AgentLoadTab orgId={orgId} />}
          {activeTab === 'reopen' && <ReopenRateTab orgId={orgId} from={from} to={to} />}
          {activeTab === 'ratings' && <RatingsTab orgId={orgId} from={from} to={to} />}
        </div>
      </div>
    </div>
  )
}
