'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { TaskArchiveItem } from '@/lib/types/tasks'
// import QuadrantBadge from '@/components/tasks/QuadrantBadge'
import { PageHeader } from '@/components/shell/page-header'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { formatDateTime } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(str: string): string {
  return formatDateTime(str)
}

// ─── Snapshot modal ───────────────────────────────────────────────────────────

function SnapshotModal({ item, onClose }: { item: TaskArchiveItem; onClose: () => void }) {
  const task = item.task_snapshot

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Archived task snapshot</DialogTitle>
          <DialogDescription>Read-only view of deleted task</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Title */}
          <div className="flex items-start gap-3">
            {/* <QuadrantBadge quadrant={task.quadrant} /> */}
            <h3 className="text-section font-medium text-text-primary leading-tight flex-1">{task.title}</h3>
          </div>

          {task.description && (
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Description</p>
              <p className="text-body text-text-primary leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Status</p>
              <p className="text-body text-text-primary">{task.status?.label ?? task.status_id}</p>
            </div>
            {task.deadline && (
              <div>
                <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Deadline</p>
                <p className="text-body text-text-primary">{formatDate(task.deadline)}</p>
              </div>
            )}
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Type</p>
              <p className="text-body text-text-primary capitalize">{task.type.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-1">Completion Mode</p>
              <p className="text-body text-text-primary">
                {task.completion_mode === 'all_must_complete' ? 'All must complete' : 'Any can complete'}
              </p>
            </div>
          </div>

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-2">Assignees</p>
              <div className="flex flex-wrap gap-2">
                {task.assignees.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 bg-surface-control border border-border-light rounded-control px-2.5 py-1 text-body text-text-primary"
                  >
                    {a.user_name}
                    {a.is_cc && (
                      <span className="text-meta font-medium bg-warning-bg text-warning border border-warning-border rounded-xs px-1">CC</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Checklist */}
          {task.checklist && task.checklist.length > 0 && (
            <div>
              <p className="text-meta font-medium text-text-muted uppercase tracking-wider mb-2">Checklist</p>
              <div className="space-y-1.5">
                {task.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-xs border-2 shrink-0 flex items-center justify-center ${item.is_completed ? 'bg-success border-success' : 'border-border'}`}>
                      {item.is_completed && (
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2.5" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-body ${item.is_completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deletion info */}
          <div className="bg-warning-bg border border-warning-border rounded-control p-4 space-y-1">
            <p className="text-meta font-medium text-warning uppercase tracking-wider">Deletion Info</p>
            <p className="text-body text-text-primary">
              Deleted on <span className="font-medium">{formatDate(item.deleted_at)}</span>
            </p>
            {item.deletion_reason && (
              <p className="text-body text-text-primary">
                Reason: <span className="font-medium">{item.deletion_reason}</span>
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <p className="font-medium text-text-primary">No organization found</p>
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
          <span className="font-medium text-text-primary truncate max-w-[200px]">
            {item.task_snapshot.title}
          </span>
        </div>
      ),
    },
    {
      key: 'deleted_by',
      header: 'Deleted By',
      desktopHiddenBelow: 'md',
      cellClassName: 'text-text-secondary',
      render: (item) => item.deleted_by?.name ?? `${item.deleted_by_user_id.slice(0, 8)}…`,
    },
    {
      key: 'reason',
      header: 'Reason',
      desktopHiddenBelow: 'lg',
      cellClassName: 'text-text-secondary max-w-[160px]',
      render: (item) => <span className="truncate block">{item.deletion_reason ?? '—'}</span>,
    },
    {
      key: 'deleted_at',
      header: 'Deleted At',
      cellClassName: 'text-text-secondary',
      render: (item) => formatDate(item.deleted_at),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      hideOnMobile: true,
      render: (item) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => { e.stopPropagation(); setSelected(item) }}
        >
          View
        </Button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Task Archive"
          trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
          meta="Deleted tasks stored for record-keeping."
        />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-control" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task Archive"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta="Deleted tasks stored for record-keeping."
      />

      <ResponsiveTable
        columns={columns}
        rows={archive}
        rowKey={(item) => item.id}
        onRowClick={(item) => setSelected(item)}
        emptyState={
          <EmptyState variant="nothing-yet" heading="Archive is empty">
            Deleted tasks will appear here.
          </EmptyState>
        }
      />

      {selected && (
        <SnapshotModal item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
