'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, AlertTriangle, Info } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import type { MeetingReport } from '@/lib/types/meetings'
import { useMeetingPermissions } from '@/components/meetings/shared'
import DateRangePicker from '@/components/ui/DateRangePicker'
import AccessHiddenState from '@/components/ui/AccessHiddenState'

function Stat({ label, value, color = 'var(--text-primary)', sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] p-4">
      <p className="text-[26px] font-medium leading-none" style={{ color }}>{value}</p>
      <p className="text-sm text-text-secondary mt-1">{label}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

export default function MeetingReportsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { perms, loading: permsLoading } = useMeetingPermissions(orgId)

  const [report, setReport] = useState<MeetingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const filters: Record<string, string | undefined> = {}
    if (from) filters.from_date = new Date(`${from}T00:00`).toISOString()
    if (to) filters.to_date = new Date(`${to}T23:59`).toISOString()
    meetingsApi.report(orgId, filters).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false))
  }, [orgId, from, to])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <Link href="/dashboard/governance/meetings" className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary w-fit mb-4"><ArrowLeft size={15} /> Meetings</Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[26px] font-medium text-text-primary leading-tight flex items-center gap-2"><BarChart3 size={24} className="text-primary-text" /> Meeting governance</h1>
          <p className="text-sm text-text-secondary mt-1">Who’s actually showing up, across the meetings and rhythms you run.</p>
        </div>
        <div className="w-[260px] shrink-0">
          <DateRangePicker from={from} to={to} onChange={(s, e) => { setFrom(s); setTo(e) }} />
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-text-secondary bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2 mb-4">
        <Info size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span>You see only the meetings and rhythms you created. Attendance rates count only meetings where attendance was actually recorded — an ungraded meeting is never counted as everyone no-showing.</span>
      </div>

      {!permsLoading && !perms.read ? (
        <AccessHiddenState orgId={orgId} leaf="meetings" moduleLabel="Meetings" />
      ) : loading ? (
        <div className="p-8 text-center text-sm text-text-secondary">Loading…</div>
      ) : !report ? (
        <div className="p-8 text-center text-sm text-text-muted">No data.</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Meetings" value={report.activity.meetings_count} color="var(--primary-text)" />
            <Stat label="Total hours" value={report.activity.total_hours} />
            <Stat label="Avg duration" value={`${report.activity.avg_duration_min}m`} />
            <Stat label="Avg overrun" value={`${report.activity.avg_overrun_min}m`} color={report.activity.avg_overrun_min > 0 ? 'var(--warning)' : 'var(--success)'} />
          </div>

          <div>
            <h2 className="text-[18px] font-medium text-text-primary mb-2">Attendance</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Attendance rate" value={`${report.attendance.attendance_rate}%`} color="var(--success)" sub="recorded meetings only" />
              <Stat label="No-show rate" value={`${report.attendance.no_show_rate}%`} color={report.attendance.no_show_rate > 0 ? 'var(--danger)' : 'var(--success)'} sub="recorded meetings only" />
              <Stat label="Declined rate" value={`${report.attendance.declined_rate}%`} color="var(--warning)" />
              <Stat label="Declined (required)" value={report.attendance.declined_required} color={report.attendance.declined_required ? 'var(--danger)' : 'var(--success)'} />
              <Stat label="Started on time" value={`${report.attendance.started_on_time_rate}%`} />
            </div>
            {report.attendance.unrecorded_meetings > 0 && (
              <div className="flex items-start gap-2 bg-surface-control border border-border-light rounded-[8px] px-3 py-2 text-sm text-text-secondary mt-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-text-muted" />
                <span>{report.attendance.unrecorded_meetings} meeting(s) have no attendance recorded — excluded from the rates above, not counted as no-shows.</span>
              </div>
            )}
          </div>

          {/* Per-person over the series */}
          <div className="bg-white border border-border-light rounded-[12px] overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light"><h2 className="text-[16px] font-medium text-text-primary">Per person</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary border-b border-border-light">
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium text-right">Expected</th>
                    <th className="px-3 py-2 font-medium text-right">Attended</th>
                    <th className="px-3 py-2 font-medium text-right">No-show</th>
                    <th className="px-3 py-2 font-medium text-right">Declined</th>
                    <th className="px-4 py-2 font-medium text-right">Declined (required)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_person.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-text-muted">No attendees yet.</td></tr>
                  )}
                  {report.by_person.map((p) => (
                    <tr key={p.user_id} className="border-b border-border-light">
                      <td className="px-4 py-2 text-text-primary">{p.name}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{p.expected}</td>
                      <td className="px-3 py-2 text-right text-success">{p.attended}</td>
                      <td className="px-3 py-2 text-right" style={{ color: p.no_show ? 'var(--danger)' : 'var(--text-secondary)' }}>{p.no_show}</td>
                      <td className="px-3 py-2 text-right text-warning">{p.declined}</td>
                      <td className="px-4 py-2 text-right" style={{ color: p.declined_required ? 'var(--danger)' : 'var(--text-secondary)' }}>{p.declined_required}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Output */}
          <div>
            <h2 className="text-[18px] font-medium text-text-primary mb-2">Output</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Decisions" value={report.output.decisions_total} />
              <Stat label="Per meeting" value={report.output.decisions_per_meeting} />
              <Stat label="Zero-decision meetings" value={report.output.zero_decision_meetings} color={report.output.zero_decision_meetings ? 'var(--warning)' : 'var(--success)'} />
              <Stat label="Action items" value={report.output.action_items_created} />
              <Stat label="Linked to tasks" value={`${report.output.pct_linked_to_tasks}%`} />
              <Stat label="Linked tasks done" value={`${report.output.pct_linked_tasks_completed}%`} color="var(--success)" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
