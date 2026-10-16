'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import { ALL_STATUSES, STATUS_META, formatValue, type Goal, type GoalDashboard } from '@/lib/types/goals'
import { CountBadge, GoalStatusBadge, formatDate, PermissionsUnavailable, useGoalPermissions } from '@/components/goals/shared'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'

const ORDER = ALL_STATUSES

/**
 * Dashboard — deliberately minimal. Counts by status, then the three lists a
 * person actually acts on: what's at risk, what's overdue, and what has gone
 * quiet. No charts and no percentages, because nothing in this module is
 * computed.
 */
export default function GoalsDashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const {
    perms,
    loading: permsLoading,
    failed: permsFailed,
    retry: retryPerms,
  } = useGoalPermissions(orgId)

  const [data, setData] = useState<GoalDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setData(await goalsApi.dashboard(orgId))
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  // A failed lookup is not a denial — offer a retry instead of claiming the
  // role lacks access.
  if (permsFailed) return <PermissionsUnavailable onRetry={retryPerms} />

  if (!permsLoading && !perms.read) {
    return <AccessHiddenState orgId={orgId} leaf="goals" moduleLabel="Goals" />
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState variant="failed" heading="Couldn't load the dashboard" onAction={load}>
        Something went wrong fetching the numbers.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        meta={`${data.total} goal${data.total === 1 ? '' : 's'} · as on ${formatDate(data.as_on)}`}
      />

      {/* Counts by status — every tile the same size, zeros shown so the set reads
          as one block. Eight statuses, so four per row: no orphan tile. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ORDER.map((s) => {
          const m = STATUS_META[s]
          const n = data.counts[s] ?? 0
          return (
            <button
              key={s}
              onClick={() => router.push(`/goals/list?status=${s}`)}
              className="bg-surface border border-border-light rounded-card shadow-card p-4 text-left hover:border-border transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />
                <span className="text-meta font-medium text-text-secondary truncate">{m.label}</span>
              </span>
              <p className="text-page-title font-medium text-text-primary tabular-nums leading-none mt-2">{n}</p>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <GoalPanel
          icon={<AlertTriangle size={16} />}
          title="At risk"
          hint="The owner has called these amber or red."
          empty="Nothing flagged at risk."
          goals={data.at_risk}
          meta={(g) => (g.owner?.name ?? '—') + ' · due ' + formatDate(g.due_date)}
        />
        <GoalPanel
          icon={<Clock size={16} />}
          title="Overdue"
          hint="Past the deadline and still open."
          empty="Nothing past its deadline."
          goals={data.overdue}
          meta={(g) => {
            const late = (g as Goal & { days_late: number }).days_late
            return `${late} day${late === 1 ? '' : 's'} late · ${g.owner?.name ?? '—'}`
          }}
        />
        <GoalPanel
          icon={<CalendarClock size={16} />}
          title="Waiting on a check-in"
          hint="Nobody has told us where these stand."
          empty="Every goal is up to date."
          goals={data.needs_check_in}
          meta={(g) => (g as Goal & { due_reason: string }).due_reason + ' · ' + (g.owner?.name ?? '—')}
        />
      </div>
    </div>
  )
}

function GoalPanel({
  icon,
  title,
  hint,
  empty,
  goals,
  meta,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  empty: string
  goals: Goal[]
  meta: (g: Goal) => string
}) {
  const router = useRouter()
  return (
    // Fixed height + internal scroll so the three panels stay the same size
    // however lopsided the data is (DESIGN_RULES Part 2 / Part 3).
    <section className="bg-surface border border-border-light rounded-card shadow-card flex flex-col h-[400px]">
      <header className="px-4 py-4 border-b border-border-light shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-card-heading font-medium text-text-primary">
            <span className="text-text-secondary">{icon}</span>
            {title}
          </h2>
          <CountBadge count={goals.length} />
        </div>
        <p className="text-meta text-text-secondary mt-0.5">{hint}</p>
      </header>
      <div className="table-scroll flex-1 overflow-y-auto px-4 py-2">
        {goals.length === 0 ? (
          <p className="text-label text-text-secondary py-6">{empty}</p>
        ) : (
          <ul className="divide-y divide-surface-control">
            {goals.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => router.push(`/goals/${g.id}`)}
                  className="w-full text-left py-2.5 group"
                >
                  <p className="text-body font-medium text-text-primary group-hover:text-primary-text transition-colors truncate">
                    {g.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <GoalStatusBadge status={g.status} />
                    <span className="text-meta text-text-secondary">{meta(g)}</span>
                  </div>
                  {g.target_value !== null && g.target_value !== undefined && (
                    <p className="text-meta text-text-secondary mt-0.5 tabular-nums">
                      {g.current_value === null || g.current_value === undefined ? '—' : g.current_value}
                      {' of '}
                      {formatValue(g.target_value, g.unit)}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
