'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import { CADENCE_META, formatValue, type GoalCheckInDue } from '@/lib/types/goals'
import CheckInModal from '@/components/goals/CheckInModal'
import {
  CountBadge,
  GoalStatusBadge,
  formatDate,
  PermissionsUnavailable,
  useGoalPermissions,
} from '@/components/goals/shared'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'

/**
 * My check-ins — the screen that keeps this module alive.
 *
 * It is deliberately the shortest path in the app: the goals you owe a
 * check-in on, each with a single button that opens the check-in and nothing
 * else. It must be completable on a phone in well under a minute, so there are
 * no filters, no tabs and no configuration here.
 */
export default function MyCheckInsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const {
    perms,
    loading: permsLoading,
    failed: permsFailed,
    retry: retryPerms,
  } = useGoalPermissions(orgId)

  const [rows, setRows] = useState<GoalCheckInDue[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<GoalCheckInDue | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setRows(await goalsApi.myCheckIns(orgId).catch(() => []))
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

  return (
    <div>
      <PageHeader
        title="My check-ins"
        meta={
          <>
            Goals you own that are waiting on you. A check-in is one number, one traffic light and a
            line of context. <CountBadge count={rows.length} />
          </>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card">
          <EmptyState variant="nothing-waiting">
            Every goal you own is checked in and up to date. You'll be nudged here — and by
            notification — when the next one comes due.
          </EmptyState>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((g) => {
            const late = (g.days_overdue ?? 0) > 0
            return (
              <li
                key={g.id}
                className="bg-surface border border-border-light rounded-card shadow-card p-4 sm:p-4"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => router.push(`/goals/${g.id}`)}
                      className="group text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-card-heading font-medium text-text-primary group-hover:text-primary-text transition-colors">
                          {g.title}
                        </span>
                        <ArrowUpRight
                          size={14}
                          className="text-text-muted group-hover:text-primary-text shrink-0 transition-colors"
                        />
                      </span>
                    </button>

                    <div className="flex items-center gap-2.5 flex-wrap mt-2">
                      <span
                        className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-meta font-medium"
                        style={
                          late
                            ? { backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }
                            : { backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }
                        }
                      >
                        {g.due_reason}
                      </span>
                      <GoalStatusBadge status={g.status} />
                      <span className="text-meta text-text-secondary">
                        {CADENCE_META[g.review_cadence].label}
                      </span>
                    </div>

                    {g.target_value !== null && g.target_value !== undefined && (
                      <p className="text-label text-text-secondary mt-2 tabular-nums">
                        Last recorded{' '}
                        <span className="font-medium text-text-primary">
                          {g.current_value === null || g.current_value === undefined
                            ? '—'
                            : g.current_value}
                        </span>{' '}
                        of {formatValue(g.target_value, g.unit)} · deadline {formatDate(g.due_date)}
                      </p>
                    )}
                  </div>

                  {perms.edit && (
                    <button
                      onClick={() => setActive(g)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-control bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium transition-colors shrink-0 w-full sm:w-auto min-h-[44px]"
                    >
                      <CheckCircle2 size={16} /> Check in
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {active && (
        <CheckInModal
          isOpen
          onClose={() => setActive(null)}
          orgId={orgId}
          goal={active}
          onDone={load}
        />
      )}
    </div>
  )
}
