'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import { goalsApi } from '@/lib/api/goals'
import type { MeetingReport } from '@/lib/types/meetings'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'

// A 5-series qualitative chart palette (kit section 21): position, not hex
// identity, is what distinguishes the slices, so this reads chart-1..5.
const PIE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const LINK_LABEL: Record<string, string> = { goal: 'Goal', project: 'Project', task: 'Task', ticket: 'Ticket', ad_hoc: 'Ad-hoc' }

function Stat({ label, value, color = 'var(--text-primary)', flag }: { label: string; value: string | number; color?: string; flag?: boolean }) {
  return (
    <div className={['bg-surface border rounded-xl p-4', flag ? 'border-danger-border' : 'border-border-light'].join(' ')}>
      <p className="text-[26px] font-medium leading-none flex items-center gap-1" style={{ color }}>{flag && <AlertTriangle size={18} className="text-danger" />}{value}</p>
      <p className="text-sm text-text-secondary mt-1">{label}</p>
    </div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-[18px] font-medium text-text-primary mb-3">{title}</h2>
      {children}
    </div>
  )
}

export default function MeetingReportsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [data, setData] = useState<MeetingReport | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [goals, setGoals] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    meetingsApi.report(orgId, { from_date: from || undefined, to_date: to || undefined })
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [orgId, from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!orgId) return
    getEmployees(orgId).then((emps: any[]) => setNames(new Map(emps.map((e) => [e.user_id, e.user?.name ?? 'Unknown'])))).catch(() => {})
    goalsApi.list(orgId).then((gs) => setGoals(new Map(gs.map((g) => [g.id, g.title])))).catch(() => {})
  }, [orgId])

  const loadData = useMemo(() => (data?.activity.load_per_person ?? []).slice(0, 8).map((r) => ({ name: names.get(r.user_id) ?? '—', meetings: r.meetings })), [data, names])
  const linkData = useMemo(() => (data?.linkage.hours_by_type ?? []).map((r) => ({ name: LINK_LABEL[r.type] ?? r.type, value: r.hours })), [data])

  function exportCsv() {
    if (!data) return
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Meetings', String(data.activity.meetings_count)],
      ['Total hours', String(data.activity.total_hours)],
      ['Avg duration (min)', String(data.activity.avg_duration_min)],
      ['Avg overrun (min)', String(data.activity.avg_overrun_min)],
      ['Attendance rate %', String(data.attendance.attendance_rate)],
      ['No-show rate %', String(data.attendance.no_show_rate)],
      ['Started on time %', String(data.attendance.started_on_time_rate)],
      ['Decisions total', String(data.output.decisions_total)],
      ['Decisions / meeting', String(data.output.decisions_per_meeting)],
      ['Zero-decision meetings', String(data.output.zero_decision_meetings)],
      ['Action items created', String(data.output.action_items_created)],
      ['% linked to tasks', String(data.output.pct_linked_to_tasks)],
      ['% linked tasks completed', String(data.output.pct_linked_tasks_completed)],
    ]
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'meeting-report.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Meeting reports"
        meta="Scoped to what you can see. Reports are only as honest as the capture."
        actions={
          <>
            <div className="w-[220px]">
              <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
            </div>
            <Button variant="secondary" onClick={exportCsv}><Download size={15} /> CSV</Button>
          </>
        }
      />

      {loading ? <div className="p-8 text-center text-sm text-text-secondary">Loading…</div> : !data ? <div className="p-8 text-center text-sm text-text-muted">No data.</div> : (
        <>
          <Section title="Activity">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Stat label="Meetings" value={data.activity.meetings_count} color="var(--primary-text)" />
              <Stat label="Total hours" value={data.activity.total_hours} />
              <Stat label="Avg duration (min)" value={data.activity.avg_duration_min} />
              <Stat label="Avg overrun (min)" value={data.activity.avg_overrun_min} color={data.activity.avg_overrun_min > 0 ? 'var(--warning)' : 'var(--success)'} />
            </div>
            {loadData.length > 0 && (
              <div className="bg-white border border-border-light rounded-[12px] p-4">
                <p className="text-sm font-medium text-text-secondary mb-2">Meeting load per person</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={loadData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                    <Tooltip />
                    <Bar dataKey="meetings" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <Section title="Attendance & discipline">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat label="Attendance rate" value={`${data.attendance.attendance_rate}%`} color="var(--success)" />
              <Stat label="No-show rate" value={`${data.attendance.no_show_rate}%`} color={data.attendance.no_show_rate > 20 ? 'var(--danger)' : 'var(--text-primary)'} />
              <Stat label="Started on time" value={`${data.attendance.started_on_time_rate}%`} />
            </div>
          </Section>

          <Section title="Output">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Stat label="Decisions / meeting" value={data.output.decisions_per_meeting} color="var(--primary-text)" />
              <Stat label="Zero-decision meetings" value={data.output.zero_decision_meetings} color="var(--danger)" flag={data.output.zero_decision_meetings > 0} />
              <Stat label="Decisions total" value={data.output.decisions_total} />
              <Stat label="Action items created" value={data.output.action_items_created} />
              <Stat label="% linked to tasks" value={`${data.output.pct_linked_to_tasks}%`} />
              <Stat label="% of those completed" value={`${data.output.pct_linked_tasks_completed}%`} color="var(--success)" />
            </div>
          </Section>

          <Section title="Linkage">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white border border-border-light rounded-[12px] p-4">
                <p className="text-sm font-medium text-text-secondary mb-2">Meeting hours by linkage</p>
                {linkData.length === 0 ? <p className="text-sm text-text-muted">No data.</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={linkData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.name} (${e.value}h)`}>
                        {linkData.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="bg-white border border-border-light rounded-[12px] p-4">
                <p className="text-sm font-medium text-text-secondary mb-2">Goals getting attention</p>
                {data.linkage.goal_attention.length === 0 ? <p className="text-sm text-text-muted">No goal-linked meetings.</p> : (
                  <div className="flex flex-col gap-1.5">
                    {data.linkage.goal_attention.slice(0, 8).map((g) => (
                      <div key={g.goal_id} className="flex items-center justify-between text-sm">
                        <span className="text-text-primary truncate">{goals.get(g.goal_id) ?? 'Goal'}</span>
                        <span className="text-text-secondary shrink-0">{g.meetings} mtg · {g.hours}h</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
