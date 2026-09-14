'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowLeft, ChevronRight, Inbox, ArrowUpDown } from 'lucide-react'
import type { AgeBucketKey, PendingTaskRow } from '@/lib/types/reports'
import { fmtDate, fmtAsOn, OVER_MONTH_BUCKETS } from '@/lib/reports/ageing-format'
import { useSort } from '@/lib/reports/use-sort'

/** What a click on the grid drills into. Any dimension left null = unconstrained. */
export interface DrillFilter {
  personId: string | null
  personName: string | null
  taskTitle: string | null
  buckets: AgeBucketKey[] | null // null = every band
  bandLabel: string | null       // chip text for the band constraint
}

/**
 * Focused drill list for the ageing grids. It filters the ALREADY-LOADED pending
 * set client-side — never a second fetch — so the number the reviewer clicked and
 * the rows shown are drawn from the same data and the same As-On date, and always
 * match exactly. Constraints show as removable chips; clearing one widens the list
 * in place. A row hands off to the real task screen via `onOpenTask`.
 */
export default function PendingDrillDrawer({
  pending,
  asOn,
  initial,
  onClose,
  onOpenTask,
}: {
  pending: PendingTaskRow[]
  asOn: string
  initial: DrillFilter
  onClose: () => void
  onOpenTask: (taskId: string) => void
}) {
  const [filter, setFilter] = useState<DrillFilter>(initial)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => setFilter(initial), [initial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = useMemo(() => {
    const bset = filter.buckets ? new Set(filter.buckets) : null
    return pending.filter((r) => {
      if (filter.personId && r.assigned_to_user_id !== filter.personId) return false
      if (filter.taskTitle && r.title !== filter.taskTitle) return false
      // An unconstrained band ("Total Pending", or a band chip the reviewer cleared)
      // must NOT pick up RELEASED rows: the backend keeps both `withdrawn` and
      // `handed_over` out of `total_pending`, so including them here would break the
      // contract that the clicked count equals the rows shown. They are reachable only
      // by clicking their own count, which passes that bucket explicitly.
      if (!bset) return r.bucket !== 'withdrawn' && r.bucket !== 'handed_over'
      if (!bset.has(r.bucket)) return false
      return true
    })
  }, [pending, filter])

  const singlePerson = !!filter.personId
  const singleTask = !!filter.taskTitle

  const { sorted, sortKey, dir, toggle } = useSort<PendingTaskRow>(
    rows,
    {
      title: (r) => r.title,
      assigned_to: (r) => r.assigned_to,
      frequency: (r) => r.frequency,
      assigned_by: (r) => r.assigned_by,
      due_date: (r) => r.due_date,
      days_late: (r) => r.days_late,
    },
    { key: 'days_late', dir: 'desc' },
  )

  // Live stats over the CURRENT (possibly widened) view.
  const total = rows.length
  const overMonth = useMemo(() => {
    const s = new Set(OVER_MONTH_BUCKETS)
    return rows.filter((r) => s.has(r.bucket)).length
  }, [rows])
  const oldest = useMemo(() => rows.reduce<number | null>((m, r) => (r.days_late !== null && (m === null || r.days_late > m) ? r.days_late : m), null), [rows])

  const heading = singlePerson ? filter.personName ?? 'Person' : singleTask ? filter.taskTitle! : 'All pending work'
  const sub = filter.bandLabel ?? (singlePerson || singleTask ? 'All pending work' : `${total} open ${total === 1 ? 'task' : 'tasks'}`)

  if (!mounted) return null

  const clearPerson = () => setFilter((f) => ({ ...f, personId: null, personName: null }))
  const clearTask = () => setFilter((f) => ({ ...f, taskTitle: null }))
  const clearBand = () => setFilter((f) => ({ ...f, buckets: null, bandLabel: null }))

  const SortTh = ({ id, label, className = '' }: { id: string; label: string; className?: string }) => (
    <th className={`px-3 py-2.5 font-semibold whitespace-nowrap ${className}`}>
      <button onClick={() => toggle(id)} className="inline-flex items-center gap-1 hover:text-[#0F172A] transition-colors">
        {label}
        <ArrowUpDown size={12} className={sortKey === id ? 'text-[#2563EB]' : 'text-[#CBD5E1]'} />
      </button>
    </th>
  )

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-[#0F172A]/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[760px] bg-white shadow-[-12px_0_40px_rgba(0,0,0,0.18)] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between border-b border-[#E2E8F0] shrink-0">
          <div className="min-w-0 flex items-start gap-3">
            <button
              onClick={onClose}
              className="mt-0.5 w-8 h-8 rounded-[8px] border border-[#E2E8F0] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] shrink-0"
              title="Back to grid"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#2563EB]">{sub}</div>
              <h3 className="text-lg font-bold tracking-tight text-[#0F172A] truncate">{heading}</h3>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[8px] border border-[#E2E8F0] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Filter chips */}
        <div className="px-5 py-2.5 flex items-center gap-2 flex-wrap border-b border-[#E2E8F0] bg-[#F8FAFC] shrink-0">
          {filter.personName && <Chip label={filter.personName} onRemove={clearPerson} />}
          {filter.taskTitle && <Chip label={filter.taskTitle} onRemove={clearTask} />}
          {filter.bandLabel && <Chip label={filter.bandLabel} onRemove={clearBand} />}
          <span className="inline-flex items-center rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-1 text-xs font-medium text-[#1D4ED8]">
            As on {fmtAsOn(asOn)}
          </span>
        </div>

        {/* Stat strip */}
        <div className="px-5 py-3 flex gap-6 border-b border-[#E2E8F0] shrink-0">
          <Stat label="Total pending" value={total} />
          <Stat label="More than a month late" value={overMonth} color={overMonth ? '#DC2626' : '#94A3B8'} />
          <Stat label="Oldest late task" value={oldest === null ? '—' : `${oldest} days`} color={oldest === null ? '#94A3B8' : '#B91C1C'} />
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto min-h-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center text-[#94A3B8]">
              <Inbox size={26} className="mb-2" />
              <p className="text-sm">No pending tasks in this view.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC] shadow-[0_1px_0_#E2E8F0]">
                <tr className="text-left text-[#475569]">
                  {!singleTask && <SortTh id="title" label="Task" />}
                  {!singlePerson && <SortTh id="assigned_to" label="Assigned To" />}
                  <SortTh id="frequency" label="Frequency" />
                  <SortTh id="assigned_by" label="Assigned By" />
                  <SortTh id="due_date" label="Due Date" />
                  <SortTh id="days_late" label="Days Late" className="text-right" />
                  <th className="px-3 py-2.5 font-semibold whitespace-nowrap">How Late</th>
                  <th className="px-2 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={`${r.task_id}:${r.assigned_to_user_id}`}
                    onClick={() => onOpenTask(r.task_id)}
                    className="group border-b border-[#F1F5F9] last:border-0 hover:bg-[#EFF6FF] cursor-pointer transition-colors align-top"
                    title="Open task"
                  >
                    {!singleTask && (
                      <td className="px-3 py-3 font-medium text-[#0F172A] max-w-[240px]">
                        <span className="line-clamp-2">{r.title}</span>
                      </td>
                    )}
                    {!singlePerson && (
                      <td className="px-3 py-3 text-[#0F172A] whitespace-nowrap">
                        {r.assigned_to}
                        {r.handover && (
                        <span className="block text-[11px] font-normal text-[#475569]" title={`Taken off ${r.assigned_to} on ${fmtDate(r.handover.at)}. This is no longer pending on them.`}>
                          → now with {r.handover.to.length ? r.handover.to.join(', ') : 'no one'}
                        </span>
                      )}
                      </td>
                    )}
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap">{r.frequency}</td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap">{r.assigned_by ?? '—'}</td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap tabular-nums">{fmtDate(r.due_date)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap" style={{ color: r.days_late === null ? '#94A3B8' : r.days_late > 30 ? '#DC2626' : '#B45309' }}>
                      {r.days_late === null ? '—' : r.days_late}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`text-xs font-medium ${r.status === 'Overdue' ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>{r.bucket_label}</span>
                    </td>
                    <td className="px-2 py-3 text-right"><ChevronRight size={15} className="text-[#CBD5E1] group-hover:text-[#2563EB]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#CBD5E1] pl-3 pr-1.5 py-1 text-xs font-semibold text-[#0F172A] max-w-[260px]">
      <span className="truncate">{label}</span>
      <button onClick={onRemove} className="w-4 h-4 rounded-full flex items-center justify-center text-[#94A3B8] hover:bg-[#FEE2E2] hover:text-[#DC2626] transition-colors shrink-0" title="Remove filter">
        <X size={12} strokeWidth={3} />
      </button>
    </span>
  )
}

function Stat({ label, value, color = '#0F172A' }: { label: string; value: number | string; color?: string }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
      <div className="text-xs mt-1 text-[#94A3B8]">{label}</div>
    </div>
  )
}
