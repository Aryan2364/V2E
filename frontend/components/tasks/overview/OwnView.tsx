'use client'

import React from 'react'
import type { TaskDashboard, WorkFlow, WorkQuery, WorkBucket } from '@/lib/types/tasks'
import KpiCards from './KpiCards'
import OverdueAgingPanel from './OverdueAgingPanel'
import DelegationPanel from './DelegationPanel'
import SourceTimingPanel from './SourceTimingPanel'
import { StatusTimingChart } from './lazy-charts'

/**
 * "Mine" layout — an individual's own work + what they delegated. Emphasizes where their
 * tasks come from (Immediate / Same-dept / External) and whether work they handed out is
 * slipping back onto them.
 */
export default function OwnView({
  dashboard,
  flow,
  userId,
  onSelectBucket,
  onOpenSegment,
}: {
  dashboard: TaskDashboard
  flow: WorkFlow | null
  userId: string
  onSelectBucket: (b: WorkBucket | null) => void
  onOpenSegment: (title: string, subtitle: string, extra: WorkQuery) => void
}) {
  return (
    <div className="space-y-3">
      <KpiCards kpis={dashboard.kpis} onSelectBucket={onSelectBucket} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <OverdueAgingPanel aging={dashboard.kpis.overdue_aging} onSelect={() => onOpenSegment('Overdue tasks', 'Open & past due', { timing: 'overdue' })} />
        {flow && (
          <DelegationPanel
            delegated={flow.delegated}
            outgoing={flow.outgoing}
            scopeLabel="you"
            onSelect={(kind) =>
              onOpenSegment(
                kind === 'overdue' ? 'Overdue tasks I assigned' : kind === 'open' ? 'Open tasks I assigned' : 'Tasks I assigned',
                'Assigned by me',
                { created_by_user_id: userId, ...(kind === 'overdue' ? { timing: 'overdue' as const } : {}) },
              )
            }
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {flow && (
          <SourceTimingPanel
            title="Where my work comes from"
            hint="who gives me work"
            items={flow.incoming_by_source}
            emptyText="No work assigned to you in this view."
          />
        )}
        <StatusTimingChart
          items={dashboard.by_status}
          onSegment={(id, label, timing) => onOpenSegment(label, 'Status × timing', { status_id: id, timing })}
        />
      </div>
    </div>
  )
}
