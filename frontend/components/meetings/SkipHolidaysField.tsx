'use client'

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { meetingsApi } from '@/lib/api/meetings'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'

/**
 * "Skip company holidays" toggle for a recurring meeting/rhythm, with an info
 * tooltip and a live preview of exactly which upcoming occurrence dates would be
 * skipped (from the backend, so it matches what the spawner actually does).
 */
export default function SkipHolidaysField({
  orgId, sched, value, onChange,
}: {
  orgId: string
  sched: ScheduleEntryDraft
  value: boolean
  onChange: (v: boolean) => void
}) {
  const [preview, setPreview] = useState<{ date: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    if (!value || !sched.start_date) { setPreview([]); return }
    let active = true
    setLoading(true)
    const t = setTimeout(() => {
      meetingsApi
        .rhythmHolidayPreview(orgId, {
          schedule_type: sched.schedule_type,
          every: sched.every,
          days: sched.days,
          month_days: sched.month_days,
          yearly_dates: sched.yearly_dates,
          time: sched.time,
          start_date: new Date(`${sched.start_date}T00:00`).toISOString(),
          end_condition: sched.end_condition,
          end_date: sched.end_date ? new Date(`${sched.end_date}T00:00`).toISOString() : undefined,
          end_after: sched.end_after,
        })
        .then((r) => { if (active) setPreview(r) })
        .catch(() => { if (active) setPreview([]) })
        .finally(() => { if (active) setLoading(false) })
    }, 400)
    return () => { active = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, value, JSON.stringify(sched)])

  return (
    <div className="mt-3 pt-3 border-t border-border-light">
      <label className="inline-flex items-center gap-2 text-body font-medium text-text-secondary cursor-pointer select-none">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-primary" />
        Skip company holidays
        <button type="button" onClick={() => setShowInfo((v) => !v)} className="text-text-muted hover:text-primary-text" aria-label="What does this do?">
          <Info size={14} />
        </button>
      </label>

      {showInfo && (
        <p className="text-meta text-text-secondary mt-1.5 bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2 leading-relaxed">
          When on, any occurrence that lands on a company/department holiday is <b>skipped</b> — the meeting is not moved to another day, and for “after N times” a skipped holiday does <b>not</b> use up one of your N. Employee leaves are not considered. Turn off to hold the meeting on the holiday anyway.
        </p>
      )}

      {value && (loading || preview.length > 0) && (
        <div className="mt-2">
          <p className="text-meta text-text-secondary font-medium mb-1">
            {loading ? 'Checking holidays…' : `${preview.length} upcoming occurrence${preview.length === 1 ? '' : 's'} will be skipped:`}
          </p>
          {!loading && (
            <div className="flex flex-col gap-1 max-h-[128px] overflow-y-auto pr-1">
              {preview.map((p) => (
                <div key={p.date} className="flex items-center gap-2 text-meta">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                  <span className="text-text-primary">{new Date(`${p.date}T00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="text-text-muted truncate">· {p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
