'use client'

import React from 'react'
import { RotateCcw, Pause, Shield } from 'lucide-react'
import type { RecurringTemplate, TaskCategory, TaskPriority } from '@/lib/types/tasks'
import { scheduleLabel, formatDate } from '@/lib/tasks/recurrence-label'
import Tooltip from '@/components/ui/Tooltip'
import TagList from './TagList'

function peopleSummary(names: string[] | undefined): string {
  if (!names || names.length === 0) return '—'
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
}

/**
 * Company-view table for recurring templates — the "who made it, for whom, how often"
 * scan. Filtering is driven by the page's shared filter bar; rows open the template.
 */
export default function RecurringTable({
  rows,
  categories,
  priorities,
  onOpen,
  onManageAccess,
}: {
  rows: RecurringTemplate[]
  categories: TaskCategory[]
  priorities: TaskPriority[]
  onOpen: (id: string) => void
  onManageAccess: (t: RecurringTemplate) => void
}) {
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const prioMap = new Map(priorities.map((p) => [p.id, p]))

  const TH = 'text-left text-[12px] font-semibold uppercase tracking-wide text-[#64748B] px-3 py-2.5 whitespace-nowrap'
  const TD = 'px-3 py-3 text-sm text-[#0F172A] align-middle'

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[1200px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className={TH}>Template</th>
              <th className={TH}>Created by</th>
              <th className={TH}>Assigned to</th>
              <th className={TH}>Department</th>
              <th className={TH}>Cadence</th>
              <th className={TH}>Status</th>
              <th className={TH}>Category</th>
              <th className={TH}>Tags</th>
              <th className={TH}>Priority</th>
              <th className={`${TH} text-right`}>Occur.</th>
              <th className={TH}>Next run</th>
              <th className={TH}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const cat = t.category_id ? catMap.get(t.category_id) : undefined
              const prio = t.priority_id ? prioMap.get(t.priority_id) : undefined
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                >
                  <td className={`${TD} max-w-[260px]`}>
                    <p className="font-medium text-[#0F172A] truncate">{t.title}</p>
                    {t.description && <p className="text-[12px] text-[#94A3B8] truncate">{t.description}</p>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{t.created_by_name ?? '—'}</td>
                  <Tooltip label={(t.assignee_names ?? []).join(', ')}>
                    <td className={`${TD} whitespace-nowrap`}>{peopleSummary(t.assignee_names)}</td>
                  </Tooltip>
                  <td className={`${TD} whitespace-nowrap`}>{t.department_name ?? '—'}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-1.5 text-[#475569]">
                      <RotateCcw size={12} className="text-[#94A3B8]" /> {scheduleLabel(t)}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className={[
                      'inline-flex items-center gap-1 rounded-[999px] px-2 py-0.5 text-[11px] font-medium border',
                      t.is_active ? 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]' : 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
                    ].join(' ')}>
                      {t.is_active ? 'Active' : <><Pause size={9} /> Paused</>}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color ?? '#CBD5E1' }} />
                        {cat.name}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {/* Two chips + "+N"; chips truncate with a tooltip. The list stops its
                        own clicks, so opening "+N" never opens the template. */}
                    {t.tags && t.tags.length > 0 ? <TagList tags={t.tags} max={2} className="max-w-[240px]" /> : '—'}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {prio ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: prio.color ?? '#CBD5E1' }} />
                        {prio.label}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{t.occurrences ?? 0}</td>
                  <td className={`${TD} whitespace-nowrap`}>{t.next_run ? formatDate(t.next_run) : '—'}</td>
                  <td className={TD}>
                    {t.can_manage && (
                      <Tooltip label="Manage access">
                        <button
                          onClick={(e) => { e.stopPropagation(); onManageAccess(t) }}
                          aria-label="Manage access"
                          className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                        >
                          <Shield size={14} />
                        </button>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
