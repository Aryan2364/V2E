'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, Info, Loader2 } from 'lucide-react'
import { meetingsApi } from '@/lib/api/meetings'
import type { BusyView } from '@/lib/types/meetings'

const KIND_META: Record<string, { label: string; bg: string; text: string }> = {
  meeting: { label: 'Meeting', bg: 'var(--primary-subtle)', text: 'var(--primary-text)' },
  leave: { label: 'Leave', bg: 'var(--warning-bg)', text: 'var(--warning)' },
  holiday: { label: 'Holiday', bg: 'var(--surface-control)', text: 'var(--text-secondary)' },
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Read-only busy grid: the organiser sees people's busy times BEFORE picking a slot.
 * He still picks the time himself; suggestions only rank. The caveat is always shown —
 * this reflects only what the app knows and is never a guarantee someone is free.
 */
export default function BusyTimesPanel({
  orgId, userIds, requiredIds, from, to, durationMin, onPick,
}: {
  orgId: string
  userIds: string[]
  requiredIds?: string[]
  from: string // ISO
  to: string // ISO
  durationMin?: number
  onPick?: (startIso: string, endIso: string) => void
}) {
  const [data, setData] = useState<BusyView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgId || userIds.length === 0 || !from || !to) { setData(null); return }
    let active = true
    setLoading(true); setError('')
    meetingsApi
      .busy(orgId, { user_ids: userIds, required_user_ids: requiredIds, from, to, duration_min: durationMin })
      .then((r) => { if (active) setData(r) })
      .catch((e: any) => { if (active) setError(e?.response?.data?.message ?? 'Could not load busy times') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, userIds.join(','), (requiredIds ?? []).join(','), from, to, durationMin])

  if (userIds.length === 0) return null

  return (
    <div className="border border-border-light rounded-[12px] bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
        <CalendarDays size={16} className="text-primary-text" />
        <h4 className="text-[15px] font-semibold text-text-primary">Busy times</h4>
        {loading && <Loader2 size={14} className="animate-spin text-text-muted ml-1" />}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-start gap-2 text-xs text-text-secondary bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2 mb-3">
          <Info size={14} className="mt-0.5 shrink-0 text-text-muted" />
          <span>{data?.caveat ?? 'Shows only meetings, leave and holidays this app knows about — not a guarantee someone is free.'}</span>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* Ranked suggestions (organiser still picks) */}
        {data && data.suggestions.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Clearest times</p>
            <div className="flex flex-col gap-1.5 max-h-[132px] overflow-y-auto">
              {data.suggestions.map((s, i) => {
                const clean = s.hard_conflicts.length === 0
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onPick?.(s.start, s.end)}
                    disabled={!onPick}
                    className="flex items-center justify-between gap-2 text-left border rounded-[8px] px-3 py-2 hover:border-primary disabled:cursor-default"
                    style={{ borderColor: clean ? 'var(--success-bg)' : 'var(--warning-bg)', backgroundColor: clean ? 'var(--success-bg)' : 'var(--warning-bg)' }}
                  >
                    <span className="text-sm text-text-primary">{fmt(s.start)}</span>
                    <span className="text-xs" style={{ color: clean ? 'var(--success)' : 'var(--warning)' }}>
                      {clean
                        ? 'No required clashes'
                        : `${s.hard_conflicts.length} required clash${s.hard_conflicts.length > 1 ? 'es' : ''}`}
                      {s.soft_conflicts.length > 0 ? ` · ${s.soft_conflicts.length} optional` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Per-person busy blocks */}
        <div className="max-h-[240px] overflow-y-auto flex flex-col gap-2">
          {data?.people.map((p) => (
            <div key={p.user_id} className="border border-border-light rounded-[8px] px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[15px] text-text-primary">{p.name}</span>
                {p.required
                  ? <span className="text-[11px] font-medium text-primary-text bg-primary-subtle rounded-full px-2 py-0.5">Required</span>
                  : <span className="text-[11px] font-medium text-text-muted bg-surface-control rounded-full px-2 py-0.5">Optional</span>}
              </div>
              {p.busy.length === 0 ? (
                <p className="text-xs text-success">Nothing on the calendar in this window.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {p.busy.map((b, i) => {
                    const meta = KIND_META[b.kind]
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="rounded-full px-2 py-0.5 font-medium shrink-0" style={{ backgroundColor: meta.bg, color: meta.text }}>{meta.label}</span>
                        <span className="text-text-secondary truncate">{b.kind === 'holiday' || b.kind === 'leave' ? b.label : `${fmt(b.start)} — ${b.label}`}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {data && data.people.length === 0 && !loading && (
            <p className="text-sm text-text-muted flex items-center gap-1.5"><AlertTriangle size={14} /> Add people to see their busy times.</p>
          )}
        </div>
      </div>
    </div>
  )
}
