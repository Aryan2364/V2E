'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { TaskArchiveItem } from '@/lib/types/tasks'
// import QuadrantBadge from '@/components/tasks/QuadrantBadge'
import { Archive, X } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Snapshot modal ───────────────────────────────────────────────────────────

function SnapshotModal({ item, onClose }: { item: TaskArchiveItem; onClose: () => void }) {
  const task = item.task_snapshot

  useEffect(() => {
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h2 className="text-[18px] font-semibold text-[#0F172A]">Archived Task Snapshot</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">Read-only view of deleted task</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Title */}
          <div className="flex items-start gap-3">
            {/* <QuadrantBadge quadrant={task.quadrant} /> */}
            <h3 className="text-[22px] font-bold text-[#0F172A] leading-tight flex-1">{task.title}</h3>
          </div>

          {task.description && (
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Description</p>
              <p className="text-sm text-[#1E293B] leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Status</p>
              <p className="text-sm text-[#1E293B]">{task.status?.label ?? task.status_id}</p>
            </div>
            {task.deadline && (
              <div>
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Deadline</p>
                <p className="text-sm text-[#1E293B]">{formatDate(task.deadline)}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Type</p>
              <p className="text-sm text-[#1E293B] capitalize">{task.type.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1">Completion Mode</p>
              <p className="text-sm text-[#1E293B]">
                {task.completion_mode === 'all_must_complete' ? 'All must complete' : 'Any can complete'}
              </p>
            </div>
          </div>

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Assignees</p>
              <div className="flex flex-wrap gap-2">
                {task.assignees.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-[6px] px-2.5 py-1 text-sm text-[#0F172A]"
                  >
                    {a.user_name}
                    {a.is_cc && (
                      <span className="text-[10px] font-semibold bg-[#FEF9C3] text-[#D97706] border border-[#FDE68A] rounded-xs px-1">CC</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Checklist */}
          {task.checklist && task.checklist.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Checklist</p>
              <div className="space-y-1.5">
                {task.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-xs border-2 shrink-0 flex items-center justify-center ${item.is_completed ? 'bg-[#16A34A] border-[#16A34A]' : 'border-[#CBD5E1]'}`}>
                      {item.is_completed && (
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2.5" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-sm ${item.is_completed ? 'line-through text-[#94A3B8]' : 'text-[#1E293B]'}`}>
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deletion info */}
          <div className="bg-[#FEF9C3] border border-[#FDE68A] rounded-[8px] p-4 space-y-1">
            <p className="text-xs font-semibold text-[#D97706] uppercase tracking-wider">Deletion Info</p>
            <p className="text-sm text-[#1E293B]">
              Deleted on <span className="font-medium">{formatDate(item.deleted_at)}</span>
            </p>
            {item.deletion_reason && (
              <p className="text-sm text-[#1E293B]">
                Reason: <span className="font-medium">{item.deletion_reason}</span>
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 flex justify-end px-6 py-4 border-t border-[#E2E8F0]">
          <button
            onClick={onClose}
            className="px-5 py-[10px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArchivePage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [archive, setArchive] = useState<TaskArchiveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TaskArchiveItem | null>(null)

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    tasksApi.getArchive(orgId).then(setArchive).catch(() => setArchive([])).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-[#0F172A]">No organization found</p>
      </div>
    )
  }

  const columns: ResponsiveColumn<TaskArchiveItem>[] = [
    {
      key: 'title',
      header: 'Title',
      primary: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          {/* <QuadrantBadge quadrant={item.task_snapshot.quadrant} /> */}
          <span className="font-medium text-[#0F172A] truncate max-w-[200px]">
            {item.task_snapshot.title}
          </span>
        </div>
      ),
    },
    {
      key: 'deleted_by',
      header: 'Deleted By',
      desktopHiddenBelow: 'md',
      cellClassName: 'text-[#475569]',
      render: (item) => item.deleted_by?.name ?? `${item.deleted_by_user_id.slice(0, 8)}…`,
    },
    {
      key: 'reason',
      header: 'Reason',
      desktopHiddenBelow: 'lg',
      cellClassName: 'text-[#475569] max-w-[160px]',
      render: (item) => <span className="truncate block">{item.deletion_reason ?? '—'}</span>,
    },
    {
      key: 'deleted_at',
      header: 'Deleted At',
      cellClassName: 'text-[#475569]',
      render: (item) => formatDate(item.deleted_at),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      hideOnMobile: true,
      render: (item) => (
        <button
          onClick={(e) => { e.stopPropagation(); setSelected(item) }}
          className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
        >
          View
        </button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight">Task Archive</h1>
        <p className="mt-1 text-[15px] text-[#475569]">
          Deleted tasks stored for record-keeping.
        </p>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={archive}
        rowKey={(item) => item.id}
        onRowClick={(item) => setSelected(item)}
        emptyState={
          <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
              <Archive size={24} className="text-[#94A3B8]" />
            </div>
            <p className="font-semibold text-[#0F172A]">Archive is empty</p>
            <p className="text-sm text-[#475569] mt-1">Deleted tasks will appear here.</p>
          </div>
        }
      />

      {selected && (
        <SnapshotModal item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
