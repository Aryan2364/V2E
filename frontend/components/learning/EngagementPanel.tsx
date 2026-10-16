'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Eye, CheckCircle2, Users } from 'lucide-react'
import { getEngagement } from '@/lib/api/learning'
import type { PathEngagement } from '@/lib/types/learning'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/Tooltip'

/**
 * "Who accessed what" for a path: per-material open/complete counts and a
 * per-learner breakdown. Views come from LearningItemView (opening a material),
 * completions from LearningItemProgress — the gap between them is the useful signal.
 */
export default function EngagementPanel({ orgId, pathId }: { orgId: string; pathId: string }) {
  const [data, setData] = useState<PathEngagement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !pathId) return
    getEngagement(orgId, pathId).then(setData).finally(() => setLoading(false))
  }, [orgId, pathId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!data) return null

  if (data.total_assigned === 0) {
    return (
      <div className="bg-white border border-dashed border-[#CBD5E1] rounded-[12px] py-12 flex flex-col items-center text-center">
        <BarChart3 size={28} className="text-[#94A3B8] mb-3" />
        <p className="text-sm font-medium text-[#0F172A] mb-1">No engagement yet</p>
        <p className="text-xs text-[#64748B]">Assign this course to people to start tracking who opens each material.</p>
      </div>
    )
  }

  const itemColumns: ResponsiveColumn<PathEngagement['items'][number]>[] = [
    {
      key: 'title',
      header: 'Material',
      primary: true,
      render: (it) => <span className="font-medium text-[#0F172A]">{it.title}</span>,
    },
    {
      key: 'viewed',
      header: 'Opened by',
      render: (it) => (
        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="flex-1 h-2 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div className="h-full bg-[#2563EB]" style={{ width: `${pct(it.viewed, it.assigned)}%` }} />
          </div>
          <span className="text-xs text-[#475569] tabular-nums">{it.viewed}/{it.assigned}</span>
        </div>
      ),
    },
    {
      key: 'opens',
      header: 'Total opens',
      render: (it) => <span className="text-sm text-[#475569] tabular-nums">{it.total_opens}</span>,
    },
    {
      key: 'completed',
      header: 'Completed',
      render: (it) => (
        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="flex-1 h-2 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div className="h-full bg-[#16A34A]" style={{ width: `${pct(it.completed, it.assigned)}%` }} />
          </div>
          <span className="text-xs text-[#475569] tabular-nums">{it.completed}/{it.assigned}</span>
        </div>
      ),
    },
  ]

  const learnerColumns: ResponsiveColumn<PathEngagement['learners'][number]>[] = [
    {
      key: 'name',
      header: 'Person',
      primary: true,
      render: (l) => (
        <>
          <div className="font-medium text-[#0F172A]">{l.name}</div>
          <div className="text-xs text-[#64748B]">{l.role ?? l.email ?? ''}</div>
        </>
      ),
    },
    {
      key: 'opened',
      header: 'Materials opened',
      render: (l) => <span className="text-sm text-[#475569] tabular-nums">{l.opened_count}/{data.total_items}</span>,
    },
    {
      key: 'completed',
      header: 'Completed',
      render: (l) => <span className="text-sm text-[#475569] tabular-nums">{l.completed_count}/{data.total_items}</span>,
    },
    {
      key: 'dots',
      header: 'Per material',
      render: (l) => (
        <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
          {l.items.map((it) => (
            <Tooltip
              key={it.item_id}
              label={it.completed ? 'Completed' : it.viewed ? `Opened ${it.views}×` : 'Not opened'}
            >
              <span
                className={[
                  'w-3 h-3 rounded-xs',
                  it.completed ? 'bg-[#16A34A]' : it.viewed ? 'bg-[#2563EB]' : 'bg-[#E2E8F0]',
                ].join(' ')}
              />
            </Tooltip>
          ))}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile icon={Users} label="Assigned" value={data.total_assigned} />
        <Tile icon={BarChart3} label="Materials" value={data.total_items} />
        <Tile icon={Eye} label="Opened ≥1 material" value={data.learners.filter((l) => l.opened_count > 0).length} tone="blue" />
        <Tile icon={CheckCircle2} label="Finished all" value={data.learners.filter((l) => l.completed_count === data.total_items && data.total_items > 0).length} tone="green" />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-[#64748B]">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-xs bg-[#16A34A]" /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-xs bg-[#2563EB]" /> Opened</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-xs bg-[#E2E8F0]" /> Not opened</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[#0F172A] mb-2">By material</h3>
        <ResponsiveTable columns={itemColumns} rows={data.items} rowKey={(it) => it.item_id} />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[#0F172A] mb-2">By person</h3>
        <ResponsiveTable columns={learnerColumns} rows={data.learners} rowKey={(l) => l.employee_profile_id} />
      </div>
    </div>
  )
}

function Tile({ icon: Icon, label, value, tone = 'slate' }: { icon: any; label: string; value: number; tone?: 'slate' | 'blue' | 'green' }) {
  const toneClasses = tone === 'blue' ? 'text-[#2563EB]' : tone === 'green' ? 'text-[#16A34A]' : 'text-[#475569]'
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[10px] p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-[#64748B] mb-1">
        <Icon size={13} className={toneClasses} /> {label}
      </div>
      <div className="text-[22px] font-bold text-[#0F172A] tabular-nums">{value}</div>
    </div>
  )
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0
}
