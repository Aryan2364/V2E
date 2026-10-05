'use client'

import React from 'react'
import type { TaskDashboard, WorkFlow, PeopleTree, WorkQuery, WorkBucket } from '@/lib/types/tasks'
import KpiCards from './KpiCards'
import SourceTimingPanel from './SourceTimingPanel'
import DelegationPanel from './DelegationPanel'
import PeopleLeaderboard from './PeopleLeaderboard'
import StatusTimingChart from './StatusTimingChart'
import PrioritySpreadChart from './PrioritySpreadChart'
import CategorySpreadChart from './CategorySpreadChart'
import TagSpreadChart from './TagSpreadChart'

/**
 * "My Team" layout — a lead's view of the load on their team: who's giving them work
 * (within / same-dept / external), which outside departments load them most, what the team
 * pushed outside its control, plus the team roster and the usual status/priority/category (and tag) cuts.
 */
export default function TeamView({
  dashboard,
  flow,
  tree,
  scopeLabel,
  onSelectBucket,
  onOpenSegment,
  onOpenReport,
}: {
  dashboard: TaskDashboard
  flow: WorkFlow | null
  tree: PeopleTree | null
  scopeLabel: string
  onSelectBucket: (b: WorkBucket | null) => void
  onOpenSegment: (title: string, subtitle: string, extra: WorkQuery) => void
  onOpenReport: (userId: string) => void
}) {
  const hasTagBreakdown = !!dashboard.by_tag?.some((t) => t.id && t.total > 0)
  return (
    <div className="space-y-3">
      <KpiCards kpis={dashboard.kpis} onSelectBucket={onSelectBucket} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {flow && (
          <SourceTimingPanel
            title="Incoming work — by source"
            hint="who's loading the team"
            items={flow.incoming_by_source}
            emptyText="No incoming work classified yet."
          />
        )}
        {flow && (
          <SourceTimingPanel
            title="Outside departments loading us"
            hint="click a department"
            items={flow.external_by_dept}
            onSelect={(it) => onOpenSegment(`${it.label} → ${scopeLabel}`, 'External load', { assigner_person_dept_id: it.id })}
            emptyText="No external work right now."
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {flow && (
          <SourceTimingPanel
            title={`Work ${scopeLabel} pushed outside`}
            hint="click a department"
            items={flow.outgoing.by_dept}
            onSelect={(it) => onOpenSegment(`${scopeLabel} → ${it.label}`, 'Pushed outside', { assignee_person_dept_id: it.id })}
            emptyText="Nothing assigned outside the team."
          />
        )}
        {flow && <DelegationPanel delegated={flow.delegated} outgoing={flow.outgoing} scopeLabel={scopeLabel} />}
      </div>

      {tree && tree.nodes.length > 0 && (
        <PeopleLeaderboard
          nodes={tree.nodes}
          drillUserId={tree.root_user_id}
          onDrill={onOpenReport}
          onOpenReport={onOpenReport}
        />
      )}

      {/* With a tag breakdown there are four charts: two by two, not three and a stray. */}
      <div className={`grid grid-cols-1 gap-3 ${hasTagBreakdown ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
        <StatusTimingChart items={dashboard.by_status} onSegment={(id, label, timing) => onOpenSegment(label, 'Status × timing', { status_id: id, timing })} />
        <PrioritySpreadChart items={dashboard.by_priority} onSegment={(id, label) => onOpenSegment(`${label} priority`, 'Current view', { priority_id: id })} />
        <CategorySpreadChart items={dashboard.by_category} onSegment={(id, label) => onOpenSegment(label, 'Category', { category_id: id })} />
        <TagSpreadChart items={dashboard.by_tag} onSegment={(id, label) => onOpenSegment(label, 'Tag', { tag_ids: [id] })} />
      </div>
    </div>
  )
}
