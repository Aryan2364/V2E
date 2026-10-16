'use client'

import React, { useEffect, useState } from 'react'
import { tasksApi } from '@/lib/api/tasks'
import WorkflowTaskBadge, { taskWorkflow } from '@/components/tasks/WorkflowTaskBadge'
import { TIMING_META, taskTiming, TERMINAL_STATUS_PHASES, type Task, type WorkQuery } from '@/lib/types/tasks'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

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

  const completed = rows.filter((r) => r.status?.type === 'completed').length
  const overdue = rows.filter((r) => taskTiming(r) === 'overdue').length

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right" className="w-full max-w-[460px] flex flex-col p-0">
        <SheetHeader>
          <div className="min-w-0">
            {subtitle && <div className="text-meta font-medium text-on-brand-muted">{subtitle}</div>}
            <SheetTitle className="truncate">{title}</SheetTitle>
          </div>
        </SheetHeader>

        <SheetBody className="p-0 flex flex-1 flex-col overflow-hidden">
        <div className="px-4 py-3 flex gap-6 border-b border-border-light bg-surface-sunken shrink-0">
          <Stat label="Tasks" value={total} />
          <Stat label="Completed" value={completed} color="var(--success)" />
          <Stat label="Overdue" value={overdue} color={overdue ? 'var(--danger)' : 'var(--text-muted)'} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState variant="nothing-waiting" heading="No tasks in this view" headingLevel={3}>
              Nothing matches this slice right now.
            </EmptyState>
          ) : (
            rows.map((r) => {
              const t = taskTiming(r)
              const due = dueLabel(r)
              return (
                <button
                  key={r.id}
                  onClick={() => onOpenTask(r.id)}
                  className="w-full text-left px-4 py-3.5 border-b border-border-light hover:bg-primary-subtle transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="font-medium text-body leading-snug text-text-primary">{r.title}</div>
                    {r.priority && (
                      <span className="text-meta font-medium rounded-full px-2 py-0.5 shrink-0" style={{ backgroundColor: (r.priority.color || 'var(--text-secondary)') + '22', color: r.priority.color || 'var(--text-secondary)' }}>
                        {r.priority.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-meta text-text-secondary mb-2 flex-wrap">
                    {r.assignees?.filter((a) => !a.is_cc).slice(0, 2).map((a) => (
                      <span key={a.user_id} className="font-medium text-text-primary">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                    ))}
                    {taskWorkflow(r) ? (
                      <WorkflowTaskBadge workflow={taskWorkflow(r)!} />
                    ) : (
                      r.created_by?.name && <><span className="text-text-muted">·</span><span>by {r.created_by.name}</span></>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-meta">
                    <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: TIMING_META[t].color }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIMING_META[t].color }} />
                      {TIMING_META[t].label}
                    </span>
                    <span className="tabular-nums text-text-muted">
                      Due {fmt(r.deadline)}{due && <span className="text-text-secondary font-medium"> · {due}</span>}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value, color = 'var(--text-primary)' }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-card-heading font-medium tabular-nums leading-none" style={{ color }}>{value}</div>
      <div className="text-meta mt-0.5 text-text-muted">{label}</div>
    </div>
  )
}
