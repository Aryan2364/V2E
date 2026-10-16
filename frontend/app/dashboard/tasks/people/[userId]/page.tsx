'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskStatus, EmployeeReport, WorkBucket } from '@/lib/types/tasks'
import KpiTiles from '@/components/tasks/overview/KpiTiles'
import TaskRow from '@/components/tasks/overview/TaskRow'
import TaskDrawer from '@/components/tasks/overview/TaskDrawer'
import { ArrowLeft, Inbox, Send, Lock } from 'lucide-react'

const PAGE_SIZE = 25
type Lens = 'assignee' | 'assigner'

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

export default function EmployeeReportPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const orgId = user?.organizationId ?? ''
  const userId = String(params.userId ?? '')

  const [report, setReport] = useState<EmployeeReport | null>(null)
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  const [lens, setLens] = useState<Lens>('assignee')
  const [bucket, setBucket] = useState<WorkBucket | null>(null)
  const [rows, setRows] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !userId) return
    setLoading(true); setDenied(false)
    Promise.all([
      tasksApi.getEmployeeReport(orgId, userId).catch((e) => { if (e?.response?.status === 403) setDenied(true); return null }),
      tasksApi.getStatuses(orgId).catch(() => []),
    ]).then(([r, s]) => { setReport(r); setStatuses(s) }).finally(() => setLoading(false))
  }, [orgId, userId])

  const listFilter = useCallback(() => (
    lens === 'assignee' ? { assignee_user_id: userId } : { created_by_user_id: userId }
  ), [lens, userId])

  const fetchList = useCallback(async (pageNum: number, replace: boolean) => {
    if (!orgId || !userId) return
    if (replace) setListLoading(true)
    try {
      const res = await tasksApi.listTasksPaged(orgId, { ...listFilter(), bucket: bucket ?? undefined, page: pageNum, page_size: PAGE_SIZE, sort: 'deadline_asc' })
      setRows((prev) => (replace ? res.items : [...prev, ...res.items]))
      setTotal(res.total); setHasMore(res.has_more); setPage(res.page)
    } finally {
      if (replace) setListLoading(false)
    }
  }, [orgId, userId, lens, bucket]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchList(1, true) }, [fetchList])

  const kpis = lens === 'assignee' ? report?.as_assignee : report?.as_assigner

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-center">
        <div className="w-14 h-14 rounded-full bg-danger-bg flex items-center justify-center mb-4"><Lock size={24} className="text-danger" /></div>
        <p className="font-medium text-text-primary text-base">This employee is outside your scope</p>
        <p className="text-text-secondary text-sm mt-1 max-w-sm">You can only open the work report of people within your visibility scope.</p>
        <button onClick={() => router.push('/dashboard/tasks')} className="mt-4 px-4 py-2 rounded-control border border-border-light text-sm font-medium text-text-secondary hover:bg-surface-control">Back to Overview</button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/dashboard/tasks')} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
        <ArrowLeft size={15} /> Back to Overview
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary text-white text-lg font-medium flex items-center justify-center shrink-0">
          {report ? initials(report.employee.name) : '…'}
        </div>
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium text-text-primary leading-tight truncate">{report?.employee.name ?? 'Loading…'}</h1>
          <p className="text-[14px] text-text-secondary truncate">
            {[report?.employee.role_title, report?.employee.department_name].filter(Boolean).join(' · ') || report?.employee.email}
          </p>
        </div>
      </div>

      {/* Lens tabs */}
      <div className="inline-flex items-center border border-border-light rounded-control bg-surface p-0.5 gap-0.5">
        {([
          { key: 'assignee', label: 'Their Work', icon: <Inbox size={15} /> },
          { key: 'assigner', label: 'Delegated by Them', icon: <Send size={15} /> },
        ] as const).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => { setLens(key); setBucket(null) }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-control text-sm font-medium transition-colors ${lens === key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-control'}`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      {kpis && <KpiTiles kpis={kpis} active={bucket} onSelect={setBucket} />}

      {/* Tasks */}
      <p className="text-sm text-text-secondary">
        {listLoading ? 'Loading…' : <><span className="font-medium text-text-primary tabular-nums">{total}</span> task{total !== 1 ? 's' : ''}</>}
      </p>
      {listLoading ? (
        <div className="flex items-center justify-center h-40"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card py-14 text-center">
          <p className="font-medium text-text-primary">Nothing here</p>
          <p className="text-sm text-text-secondary mt-1">No tasks in this view.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((t) => <TaskRow key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />)}
          {hasMore && (
            <button onClick={() => fetchList(page + 1, false)} className="mt-2 mx-auto px-5 py-2.5 rounded-control border border-border-light bg-surface text-sm font-medium text-text-secondary hover:bg-surface-control">
              Load more ({total - rows.length} left)
            </button>
          )}
        </div>
      )}

      {openTaskId && (
        <TaskDrawer orgId={orgId} taskId={openTaskId} statuses={statuses} onClose={() => setOpenTaskId(null)} onChanged={() => fetchList(1, true)} />
      )}
    </div>
  )
}
