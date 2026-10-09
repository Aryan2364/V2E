'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import type { WorkflowInstance } from '@/lib/types/workflows'
import { instanceTitle } from './instanceLabel'
import { BTN, RunStatusBadge, fmtDateTime, runDisplayStatus, runHref } from './shared'

const PAGE = 25

const CURRENT = new Set(['active', 'overdue', 'sent_back', 'moved_on'])

export function instanceProgress(i: WorkflowInstance): { total: number; completed: number; current: string | null } {
  const rows = (i.steps ?? []).filter((s) => !s.is_branch)
  const currentRows = rows.filter((s) => CURRENT.has(s.status)).sort((a, b) => a.order_index - b.order_index)
  const fromRows = currentRows.length ? currentRows.map((r) => r.title).join(', ') : null
  const fromServer = i.progress?.current_step_titles?.length ? i.progress.current_step_titles.join(', ') : i.progress?.current_step_title ?? null
  if (i.progress) return { total: i.progress.total, completed: i.progress.completed, current: fromRows ?? fromServer }
  return {
    total: rows.length,
    completed: rows.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
    current: fromRows,
  }
}

export function ProgressBar({ completed, total, run }: { completed: number; total: number; run: Pick<WorkflowInstance, 'status' | 'display_status' | 'last_error' | 'steps'> }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const ds = runDisplayStatus(run)
  const color =
    ds === 'needs_attention'
      ? 'bg-[#DC2626]'
      : ds === 'completed'
        ? 'bg-[#16A34A]'
        : ds === 'cancelled'
          ? 'bg-[#64748B]'
          : ds === 'falling_behind'
            ? 'bg-[#D97706]'
            : ds === 'waiting_for_info'
              ? 'bg-[#7C3AED]'
              : 'bg-[#2563EB]'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-[#E2E8F0] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-label="Steps done">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[13px] text-[#334155] whitespace-nowrap tabular-nums">
        {completed} of {total}
      </span>
    </div>
  )
}

/** Instances as a table (cards below md). Each row opens its instance; the name is a real link. */
export default function InstanceList({
  instances,
  showWorkflow = false,
  emptyState,
  loading = false,
  templateId,
}: {
  templateId?: string
  instances: WorkflowInstance[]
  showWorkflow?: boolean
  emptyState?: React.ReactNode
  loading?: boolean
}) {
  const router = useRouter()
  const [limit, setLimit] = useState(PAGE)
  const rows = instances.slice(0, limit)
  const tid = (i: WorkflowInstance) => i.template?.id ?? templateId ?? ''

  const columns: ResponsiveColumn<WorkflowInstance>[] = [
    {
      key: 'name',
      header: 'Instance',
      primary: true,
      render: (i) => (
        <div className="min-w-0 max-w-[420px]">
          <Link
            href={runHref(tid(i), i.id)}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-[#0F172A] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded break-words"
          >
            {i.name}
          </Link>
          {(i.instance_number || (showWorkflow && i.template?.name)) && (
            <p className="text-[13px] text-[#475569] truncate">
              {[i.instance_number ? instanceTitle(i.instance_number) : null, showWorkflow ? i.template?.name : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <RunStatusBadge run={i} /> },
    {
      key: 'progress',
      header: 'Progress',
      render: (i) => {
        const p = instanceProgress(i)
        return <ProgressBar completed={p.completed} total={p.total} run={i} />
      },
    },
    {
      key: 'current',
      header: 'Current steps',
      desktopHiddenBelow: 'lg',
      render: (i) => {
        const p = instanceProgress(i)
        return <span className="block max-w-[260px] truncate text-[#334155]">{i.status === 'running' || i.status === 'stuck' ? p.current ?? '—' : '—'}</span>
      },
    },
    {
      key: 'started',
      header: 'Started',
      align: 'right',
      render: (i) => <span className="whitespace-nowrap tabular-nums text-[#334155]">{fmtDateTime(i.started_at)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <ResponsiveTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(i) => i.id}
        onRowClick={(i) => {
          if (window.getSelection()?.toString()) return
          router.push(runHref(tid(i), i.id))
        }}
        emptyState={emptyState}
      />
      {!loading && instances.length > limit && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#475569]">
            1–{rows.length} of {instances.length}
          </span>
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={BTN.quiet}>
            Show more
          </button>
        </div>
      )}
    </div>
  )
}
