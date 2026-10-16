'use client'

import React, { useMemo } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { addTiming, emptyTiming, type PersonNode, type TimingCounts } from '@/lib/types/tasks'
import TimingMiniBar from './TimingMiniBar'
import TimingLegend from './TimingLegend'
import Tooltip from '@/components/ui/tooltip'

interface PersonStat {
  user_id: string
  name: string
  role_title: string | null
  isManager: boolean
  teamSize: number
  personal: TimingCounts
  personalTotal: number
  team: TimingCounts
  teamTotal: number
  teamOverdueRate: number
}

function useForest(nodes: PersonNode[]) {
  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.user_id, n]))
    const childrenOf = new Map<string | null, PersonNode[]>()
    for (const n of nodes) {
      const parent = n.reporting_to_user_id && byId.has(n.reporting_to_user_id) ? n.reporting_to_user_id : null
      const key = parent === n.user_id ? null : parent
      if (!childrenOf.has(key)) childrenOf.set(key, [])
      childrenOf.get(key)!.push(n)
    }
    const subtree = (id: string): PersonNode[] => {
      const kids = childrenOf.get(id) ?? []
      return [byId.get(id)!, ...kids.flatMap((k) => subtree(k.user_id))]
    }
    const stat = (n: PersonNode): PersonStat => {
      const team = subtree(n.user_id)
      const teamTiming = team.reduce((acc, p) => addTiming(acc, p.assignee_timing), emptyTiming())
      const teamTotal = Object.values(teamTiming).reduce((a, b) => a + b, 0)
      const personalTotal = Object.values(n.assignee_timing).reduce((a, b) => a + b, 0)
      return {
        user_id: n.user_id,
        name: n.name,
        role_title: n.role_title,
        isManager: (childrenOf.get(n.user_id)?.length ?? 0) > 0,
        teamSize: team.length - 1,
        personal: n.assignee_timing,
        personalTotal,
        team: teamTiming,
        teamTotal,
        teamOverdueRate: teamTotal ? Math.round((teamTiming.overdue / teamTotal) * 100) : 0,
      }
    }
    return { byId, childrenOf, stat }
  }, [nodes])
}

/**
 * People lens: for each person, their personal track record vs their whole team's (subtree
 * roll-up over the reporting tree). Managers drill into their reports; anyone can be opened
 * as a full employee report. Ranked by team overdue share.
 */
export default function PeopleLeaderboard({
  nodes,
  drillUserId,
  onDrill,
  onOpenReport,
}: {
  nodes: PersonNode[]
  drillUserId: string | null
  onDrill: (userId: string) => void
  onOpenReport: (userId: string) => void
}) {
  const { childrenOf, stat } = useForest(nodes)

  const rows = useMemo(() => {
    const list = drillUserId ? childrenOf.get(drillUserId) ?? [] : childrenOf.get(null) ?? []
    return list.map(stat).sort((a, b) => b.teamOverdueRate - a.teamOverdueRate || b.teamTotal - a.teamTotal)
  }, [drillUserId, childrenOf, stat])

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card flex flex-col h-[460px]">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <h3 className="text-body font-medium text-text-primary">People · personal vs team</h3>
        <span className="text-meta text-text-muted">click a manager to drill in</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-2">
        {rows.length === 0 ? (
          <p className="text-label text-text-secondary py-12 text-center">No people in this view.</p>
        ) : (
          rows.map((s) => (
            <div key={s.user_id} className="rounded-lg border border-border-light px-3.5 py-2.5 hover:border-border transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <button
                  onClick={() => (s.isManager ? onDrill(s.user_id) : onOpenReport(s.user_id))}
                  className="flex items-center gap-2 min-w-0 group text-left"
                >
                  <span className="font-medium text-body text-text-primary truncate group-hover:text-primary-text">{s.name}</span>
                  {s.isManager ? (
                    <span className="text-meta font-medium rounded-full px-2 py-0.5 bg-primary-subtle text-primary-text shrink-0">team of {s.teamSize}</span>
                  ) : (
                    <span className="text-meta font-medium rounded-full px-2 py-0.5 bg-surface-control text-text-secondary shrink-0">individual</span>
                  )}
                  {s.isManager && <ChevronRight size={14} className="text-text-muted group-hover:text-primary-text shrink-0" />}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-meta tabular-nums whitespace-nowrap" style={{ color: s.teamOverdueRate >= 25 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    <span className="font-medium">{s.teamOverdueRate}%</span> overdue{s.isManager ? ' (team)' : ''}
                  </span>
                  <Tooltip label="Open report">
                    <button onClick={() => onOpenReport(s.user_id)} aria-label="Open report" className="text-text-muted hover:text-primary-text">
                      <ExternalLink size={13} />
                    </button>
                  </Tooltip>
                </div>
              </div>
              <div className="grid items-center gap-x-2.5 gap-y-1" style={{ gridTemplateColumns: '58px 1fr auto' }}>
                <span className="text-meta text-text-muted">Personal</span>
                <TimingMiniBar timing={s.personal} />
                <span className="text-meta tabular-nums text-text-secondary">{s.personalTotal}</span>
                {s.isManager && (
                  <>
                    <span className="text-meta font-medium text-primary-text">Team</span>
                    <TimingMiniBar timing={s.team} />
                    <span className="text-meta tabular-nums font-medium text-text-primary">{s.teamTotal}</span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-border-light shrink-0">
        <TimingLegend />
      </div>
    </div>
  )
}
