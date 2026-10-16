'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { meetingsApi } from '@/lib/api/meetings'
import { getEmployees } from '@/lib/api/employees'
import type { MeetingDecision } from '@/lib/types/meetings'
import { fmtDate } from '@/components/meetings/shared'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const inputClass = 'border border-border rounded-lg px-3 py-2 text-body text-text-primary bg-surface focus:outline-hidden focus:border-primary'

export default function DecisionLogPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const [decisions, setDecisions] = useState<MeetingDecision[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    meetingsApi.decisionLog(orgId, { search: search || undefined, from_date: from || undefined, to_date: to || undefined })
      .then(setDecisions).catch(() => setDecisions([])).finally(() => setLoading(false))
  }, [orgId, search, from, to])

  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t) }, [load, search])
  useEffect(() => { if (orgId) getEmployees(orgId).then((emps: any[]) => setNames(new Map(emps.map((e) => [e.user_id, e.user?.name ?? 'Unknown'])))).catch(() => {}) }, [orgId])

  const columns = useMemo<ResponsiveColumn<MeetingDecision>[]>(() => [
    {
      key: 'decision',
      header: 'Decision',
      primary: true,
      render: (d) => (
        <>
          <p className="text-[15px] text-text-primary font-medium">{d.decision}</p>
          {d.reason && <p className="text-meta text-text-muted mt-0.5">{d.reason}</p>}
        </>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (d) => <span className="text-body text-text-primary">{d.owner_user_id ? names.get(d.owner_user_id) ?? '—' : '—'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      desktopHiddenBelow: 'md',
      render: (d) => <span className="text-body text-text-secondary">{fmtDate(d.decided_on)}</span>,
    },
    {
      key: 'meeting',
      header: 'Meeting',
      render: (d) =>
        d.meeting ? (
          <button onClick={() => router.push(`/dashboard/governance/meetings/${d.meeting!.id}`)} className="text-body text-primary-text hover:underline">{d.meeting.title}</button>
        ) : (
          '—'
        ),
    },
  ], [names, router])

  return (
    <div>
      <PageHeader
        title="Decision log"
        meta="Every decision recorded across meetings, with a line of sight back to where it was made."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input className={`${inputClass} w-full pl-8`} placeholder="Search decisions…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-[220px]">
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        </div>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={decisions}
        rowKey={(d) => d.id}
        loading={loading}
        emptyState={
          <EmptyState variant="nothing-yet" heading="No decisions logged">
            Decisions made in meetings will appear here.
          </EmptyState>
        }
      />
    </div>
  )
}
