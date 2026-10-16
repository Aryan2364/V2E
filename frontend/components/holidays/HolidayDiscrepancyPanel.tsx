'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronRight, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { holidaysApi } from '@/lib/api/holidays'
import type { HolidayDiscrepancy } from '@/lib/types/holidays'
import { parseLocalDate } from '@/lib/date'
import { formatDate } from '@/lib/format'

interface Props {
  orgId: string
  isAdmin: boolean
}

/**
 * Org-calendar compliance panel: which departments are out of sync with the org
 * holidays (i.e. have removed some), and what they removed — with one-click re-enforce.
 */
export default function HolidayDiscrepancyPanel({ orgId, isAdmin }: Props) {
  const [rows, setRows] = useState<HolidayDiscrepancy[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setRows(await holidaysApi.getHolidayDiscrepancies(orgId))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  function toggle(deptId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(deptId)) next.delete(deptId)
      else next.add(deptId)
      return next
    })
  }

  async function reEnforce(deptId: string, orgHolidayIds: string[]) {
    setBusy(`${deptId}:${orgHolidayIds.join(',')}`)
    try {
      await holidaysApi.undoOptOutOrgHolidaysForDept(orgId, deptId, orgHolidayIds)
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-surface border border-border-light rounded-card p-4 shadow-card flex items-center justify-center h-20">
        <Loader2 size={18} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border-light rounded-card p-4 shadow-card">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-section font-medium text-text-primary">Department sync</h2>
        {rows.length > 0 && (
          <span className="inline-flex items-center gap-1 text-meta font-medium px-2 py-0.5 rounded-full border bg-warning-bg text-warning border-warning-border">
            <AlertTriangle size={11} /> {rows.length} out of sync
          </span>
        )}
      </div>
      <p className="text-body text-text-secondary mb-4">Departments that have removed one or more org holidays from their calendar.</p>

      {rows.length === 0 ? (
        <div className="flex items-center gap-2 text-body text-success py-3">
          <CheckCircle2 size={16} />
          All departments are in sync with the org calendar.
        </div>
      ) : (
        <div className="divide-y divide-surface-control-pressed">
          {rows.map((d) => {
            const isOpen = expanded.has(d.department_id)
            const allIds = d.removed.map((r) => r.org_holiday_id)
            return (
              <div key={d.department_id} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(d.department_id)}
                    className="flex items-center gap-1.5 text-body font-medium text-text-primary hover:text-primary-text"
                  >
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    {d.department_name}
                    <span className="text-text-muted font-normal">— {d.removed.length} removed</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => reEnforce(d.department_id, allIds)}
                      disabled={busy === `${d.department_id}:${allIds.join(',')}`}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-body font-medium text-primary-text hover:bg-primary-subtle transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={13} /> Re-enforce all
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 ml-6 space-y-1.5">
                    {d.removed.map((r) => (
                      <div key={r.org_holiday_id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-surface-sunken">
                        <div className="flex-1 min-w-0">
                          <p className="text-body text-text-primary truncate">{r.name}</p>
                          <p className="text-meta text-text-muted">
                            {r.date ? formatDate(parseLocalDate(r.date)) : ''}
                            {r.applies_to_subtree ? ' · applied to sub-departments' : ''}
                            {r.opted_out_by_name ? ` · by ${r.opted_out_by_name}` : ''}
                          </p>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => reEnforce(d.department_id, [r.org_holiday_id])}
                            disabled={busy === `${d.department_id}:${r.org_holiday_id}`}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-body font-medium text-primary-text hover:bg-primary-subtle transition-colors disabled:opacity-50"
                          >
                            <RotateCcw size={13} /> Re-enforce
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
