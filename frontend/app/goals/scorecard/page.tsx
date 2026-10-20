'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Target } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import {
  FOCUS_AREA_META,
  FOCUS_AREA_OPTIONS,
  formatValue,
  type Goal,
  type GoalFocusArea,
} from '@/lib/types/goals'
import {
  GoalStatusBadge,
  PermissionsUnavailable,
  formatDate,
  useGoalPermissions,
  useGoalRefData,
} from '@/components/goals/shared'
import CreateGoalModal from '@/components/goals/CreateGoalModal'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'

/**
 * Balance Scorecard — the four Balanced-Scorecard perspectives (Finance,
 * Customer, Internal Process, Learning & Growth) side by side, each showing
 * only the goals tagged with that focus area. Nothing computed here beyond
 * the grouping itself; goals with no focus area simply don't appear.
 */
export default function BalanceScorecardPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const {
    perms,
    loading: permsLoading,
    failed: permsFailed,
    retry: retryPerms,
  } = useGoalPermissions(orgId)
  const { employees } = useGoalRefData(orgId)

  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [createFocus, setCreateFocus] = useState<GoalFocusArea | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setGoals(await goalsApi.list(orgId))
    } catch {
      setGoals([])
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
    <div className="space-y-6">
      <PageHeader
        title="Balance scorecard"
        meta="Every goal, grouped by which part of the business it moves."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-label text-text-secondary py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {FOCUS_AREA_OPTIONS.map((focus) => (
            <PerspectiveCard
              key={focus}
              focus={focus}
              goals={goals.filter((g) => g.focus_area === focus)}
              canCreate={perms.write}
              onAdd={() => setCreateFocus(focus)}
            />
          ))}
        </div>
      )}

      <CreateGoalModal
        isOpen={createFocus !== null}
        onClose={() => setCreateFocus(null)}
        orgId={orgId}
        employees={employees}
        defaultFocusArea={createFocus ?? undefined}
        onCreated={(goal) => setGoals((prev) => [goal, ...prev])}
      />
    </div>
  )
}

function PerspectiveCard({
  focus,
  goals,
  canCreate,
  onAdd,
}: {
  focus: GoalFocusArea
  goals: Goal[]
  canCreate: boolean
  onAdd: () => void
}) {
  const router = useRouter()
  const m = FOCUS_AREA_META[focus]
  return (
    // Fixed height + internal scroll so all four quadrants stay the same size
    // however lopsided the data is (DESIGN_RULES Part 2 / Part 3).
    <section
      className="bg-surface border rounded-card shadow-card flex flex-col h-[420px]"
      style={{ borderColor: m.border }}
    >
      <header
        className="flex items-center justify-between gap-3 px-4 py-4 border-b shrink-0 rounded-t-[12px]"
        style={{ backgroundColor: m.bg, borderColor: m.border }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />
          <h2 className="text-card-heading font-medium truncate" style={{ color: m.text }}>
            {m.label}
          </h2>
          <span
            className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-primary-foreground text-meta font-medium"
            style={{ backgroundColor: m.dot }}
          >
            {goals.length}
          </span>
        </div>
        {canCreate && (
          <Tooltip label={`New ${m.label} goal`}>
            <Button variant="secondary" size="icon" onClick={onAdd} aria-label={`New ${m.label} goal`} className="shrink-0">
              <Plus size={16} />
            </Button>
          </Tooltip>
        )}
      </header>
      <div className="table-scroll flex-1 overflow-y-auto px-4 py-2">
        {goals.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <Target size={22} className="text-text-muted" />
            <p className="text-label text-text-secondary">No {m.label.toLowerCase()} goals yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-control-pressed">
            {goals.map((g) => (
              <li key={g.id}>
                <button onClick={() => router.push(`/goals/${g.id}`)} className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring rounded-xs w-full text-left py-3 group">
                  <p className="text-body font-medium text-text-primary group-hover:text-primary-text transition-colors truncate">
                    {g.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="shrink-0">
                      <GoalStatusBadge status={g.status} />
                    </span>
                    <span className="text-meta text-text-secondary truncate">
                      {(g.owner?.name ?? '—') + ' · due ' + formatDate(g.due_date)}
                      {g.target_value !== null && g.target_value !== undefined && (
                        <>
                          {' · '}
                          {g.current_value === null || g.current_value === undefined ? '—' : g.current_value}
                          {' of '}
                          {formatValue(g.target_value, g.unit)}
                        </>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
