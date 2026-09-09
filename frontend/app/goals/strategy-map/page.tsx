'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import type { GoalFocusArea, StrategyMap } from '@/lib/types/goals'
import { PermissionsUnavailable, useGoalPermissions, useGoalRefData } from '@/components/goals/shared'
import CreateGoalModal from '@/components/goals/CreateGoalModal'
import StrategyMapCanvas from '@/components/goals/StrategyMapCanvas'
import type { BandKey } from '@/components/goals/strategy-map-layout'

/**
 * Strategic Map — the whole company's goals on one canvas, laid out the way a
 * Balanced-Scorecard strategy map is read: four bands top to bottom, Finance
 * (the outcome) down to Learning & Growth (what makes it possible), with a line
 * wherever one goal supports another.
 *
 * It is a VIEW of the existing web, not a second place to define it: links are
 * still made on a goal, so the map can never disagree with the goals.
 */
export default function StrategyMapPage() {
  const router = useRouter()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { perms, loading: permsLoading, failed: permsFailed, retry: retryPerms } = useGoalPermissions(orgId)
  const { employees } = useGoalRefData(orgId)

  const [map, setMap] = useState<StrategyMap>({ goals: [], links: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [createFocus, setCreateFocus] = useState<GoalFocusArea | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(false)
    try {
      setMap(await goalsApi.strategyMap(orgId))
    } catch {
      setMap({ goals: [], links: [] })
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  // A failed permission lookup is not a denial — offer a retry instead of
  // claiming the role lacks access.
  if (permsFailed) return <PermissionsUnavailable onRetry={retryPerms} />

  if (!permsLoading && !perms.read) {
    return <AccessHiddenState orgId={orgId} leaf="goals" moduleLabel="Goals" />
  }

  const linkCount = map.links.length

  return (
    // Full-bleed, fixed-height column: the header and band labels stay put and
    // only the canvas scrolls (DESIGN_RULES Part 3 — sticky chrome).
    <div className="flex flex-col gap-3 h-[calc(100dvh-56px)] -mt-6 lg:-mt-8 -mb-6 lg:-mb-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-4 pb-4 overflow-hidden">
      {/* Breadcrumb — the way back out of the canvas, always visible. */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-[13px] text-[#64748B] shrink-0"
      >
        <button
          onClick={() => router.push('/goals/list')}
          className="font-medium text-[#475569] hover:text-[#2563EB] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          Goals
        </button>
        <span className="text-[#CBD5E1]">›</span>
        <span className="font-semibold text-[#0F172A]" aria-current="page">
          Strategic Map
        </span>
      </nav>

      <div className="shrink-0">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">Strategic Map</h1>
          <p className="text-sm text-[#475569] mt-1">
            Every goal in its band, with a line to the goals it supports.{' '}
            {!loading && (
              <span className="text-[#64748B]">
                {map.goals.length} goal{map.goals.length === 1 ? '' : 's'} · {linkCount} connection
                {linkCount === 1 ? '' : 's'}
                {linkCount > 0 && ' · click a goal to keep its links traced, double-click to open it'}
              </span>
            )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 rounded-[12px] border border-[#E2E8F0] bg-white flex items-center justify-center gap-2 text-sm text-[#475569]">
          <Loader2 size={16} className="animate-spin" /> Loading the map…
        </div>
      ) : error ? (
        <div className="flex-1 min-h-0 rounded-[12px] border border-[#E2E8F0] bg-white flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-sm text-[#475569]">The map couldn&apos;t be loaded.</p>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[8px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8] transition-colors"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <StrategyMapCanvas
            map={map}
            canCreate={perms.write}
            onAddInBand={(band: BandKey) =>
              setCreateFocus(band === 'untagged' ? null : (band as GoalFocusArea))
            }
          />
        </div>
      )}

      <CreateGoalModal
        isOpen={createFocus !== null}
        onClose={() => setCreateFocus(null)}
        orgId={orgId}
        employees={employees}
        defaultFocusArea={createFocus ?? undefined}
        onCreated={() => void load()}
      />
    </div>
  )
}
