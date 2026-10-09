'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import WorkflowTaskBadge, { taskWorkflow } from '@/components/tasks/WorkflowTaskBadge'
import { TIMING_META, taskTiming, TERMINAL_STATUS_PHASES, type Task, type WorkQuery } from '@/lib/types/tasks'

function fmt(d?: string) {
  if (!d) return '—'
  const date = new Date(d)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

function dueLabel(t: Task): string | null {
  if (!t.deadline || TERMINAL_STATUS_PHASES.includes(t.status?.type as any)) return null
  const days = Math.round((new Date(t.deadline).getTime() - Date.now()) / 86_400_000)
  return days >= 0 ? `${days}d left` : `${Math.abs(days)}d over`
}

/**
 * Right-side drill drawer listing the tasks behind a clicked chart segment / KPI. Fetches a
 * scoped, filtered slice (the same WorkQuery the board uses) so counts and rows always agree.
 * Clicking a row hands off to the full task drawer via `onOpenTask`.
 */
export default function SegmentDrawer({
  orgId,
  title,
  subtitle,
  query,
  onClose,
  onOpenTask,
}: {
  orgId: string
  title: string
  subtitle?: string
  query: WorkQuery
  onClose: () => void
  onOpenTask: (taskId: string) => void
}) {
  const [rows, setRows] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    tasksApi
      .listTasksPaged(orgId, { ...query, page: 1, page_size: 100, sort: 'deadline_asc' })
      .then((res) => { if (!cancelled) { setRows(res.items); setTotal(res.total) } })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, JSON.stringify(query)])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  const completed = rows.filter((r) => r.status?.type === 'completed').length
  const overdue = rows.filter((r) => taskTiming(r) === 'overdue').length

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-[#0F172A]/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[460px] bg-white shadow-[-12px_0_40px_rgba(0,0,0,0.18)] flex flex-col">
        <div className="px-5 py-4 flex items-start justify-between border-b border-[#E2E8F0]">
          <div className="min-w-0">
            {subtitle && <div className="text-xs font-medium text-[#2563EB]">{subtitle}</div>}
            <h3 className="text-lg font-bold tracking-tight text-[#0F172A] truncate">{title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[8px] border border-[#E2E8F0] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 flex gap-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <Stat label="Tasks" value={total} />
          <Stat label="Completed" value={completed} color="#16A34A" />
          <Stat label="Overdue" value={overdue} color={overdue ? '#DC2626' : '#94A3B8'} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[#475569]">No tasks in this view.</p>
          ) : (
            rows.map((r) => {
              const t = taskTiming(r)
              const due = dueLabel(r)
              return (
                <button
                  key={r.id}
                  onClick={() => onOpenTask(r.id)}
                  className="w-full text-left px-5 py-3.5 border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="font-semibold text-sm leading-snug text-[#0F172A]">{r.title}</div>
                    {r.priority && (
                      <span className="text-[11px] font-medium rounded-full px-2 py-0.5 shrink-0" style={{ backgroundColor: (r.priority.color || '#475569') + '22', color: r.priority.color || '#475569' }}>
                        {r.priority.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[#475569] mb-2 flex-wrap">
                    {r.assignees?.filter((a) => !a.is_cc).slice(0, 2).map((a) => (
                      <span key={a.user_id} className="font-medium text-[#0F172A]">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                    ))}
                    {taskWorkflow(r) ? (
                      <WorkflowTaskBadge workflow={taskWorkflow(r)!} />
                    ) : (
                      r.created_by?.name && <><span className="text-[#94A3B8]">·</span><span>by {r.created_by.name}</span></>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: TIMING_META[t].color }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIMING_META[t].color }} />
                      {TIMING_META[t].label}
                    </span>
                    <span className="tabular-nums text-[#94A3B8]">
                      Due {fmt(r.deadline)}{due && <span className="text-[#475569] font-semibold"> · {due}</span>}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Stat({ label, value, color = '#0F172A' }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5 text-[#94A3B8]">{label}</div>
    </div>
  )
}
