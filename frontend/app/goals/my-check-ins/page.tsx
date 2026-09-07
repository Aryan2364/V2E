'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, CheckCircle2, Loader2, PartyPopper } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import { CADENCE_META, formatValue, type GoalCheckInDue } from '@/lib/types/goals'
import CheckInModal from '@/components/goals/CheckInModal'
import {
  CountBadge,
  EmptyState,
  GoalStatusBadge,
  formatDate,
  PermissionsUnavailable,
  useGoalPermissions,
} from '@/components/goals/shared'

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
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">My check-ins</h1>
          <CountBadge count={rows.length} />
        </div>
        <p className="text-sm text-[#475569] mt-1">
          Goals you own that are waiting on you. A check-in is one number, one traffic light and a
          line of context.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#475569] py-16 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]">
          <EmptyState
            icon={<PartyPopper size={26} />}
            title="Nothing owed"
            subtitle="Every goal you own is checked in and up to date. You'll be nudged here — and by notification — when the next one comes due."
            action={
              <button
                onClick={() => router.push('/goals')}
                className="mt-1 text-sm font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                See all goals
              </button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((g) => {
            const late = (g.days_overdue ?? 0) > 0
            return (
              <li
                key={g.id}
                className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => router.push(`/goals/${g.id}`)}
                      className="group text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-[17px] font-semibold text-[#0F172A] group-hover:text-[#2563EB] transition-colors">
                          {g.title}
                        </span>
                        <ArrowUpRight
                          size={14}
                          className="text-[#94A3B8] group-hover:text-[#2563EB] shrink-0 transition-colors"
                        />
                      </span>
                    </button>

                    <div className="flex items-center gap-2.5 flex-wrap mt-2">
                      <span
                        className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold"
                        style={
                          late
                            ? { backgroundColor: '#FEE2E2', borderColor: '#FECACA', color: '#DC2626' }
                            : { backgroundColor: '#FEF9C3', borderColor: '#FDE68A', color: '#CA8A04' }
                        }
                      >
                        {g.due_reason}
                      </span>
                      <GoalStatusBadge status={g.status} />
                      <span className="text-[12px] text-[#475569]">
                        {CADENCE_META[g.review_cadence].label}
                      </span>
                    </div>

                    {g.target_value !== null && g.target_value !== undefined && (
                      <p className="text-[13px] text-[#475569] mt-2 tabular-nums">
                        Last recorded{' '}
                        <span className="font-semibold text-[#0F172A]">
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
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors shrink-0 w-full sm:w-auto min-h-[44px]"
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
