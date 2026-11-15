'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog'
import { User, Clock, History } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format'
import type { TaskActivityLog } from '@/lib/types/tasks'

function ActivityItem({ log }: { log: TaskActivityLog }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-primary-subtle flex items-center justify-center shrink-0 mt-0.5">
        <Clock size={13} className="text-primary-text" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body text-text-primary">
          <span className="font-medium">{log.performed_by?.name ?? 'Someone'}</span>{' '}
          <span className="text-text-secondary">{log.action.replace(/_/g, ' ')}</span>
        </p>
        {!!log.metadata?.reason && (
          <p className="text-meta text-text-secondary mt-0.5 italic">&quot;{String(log.metadata.reason)}&quot;</p>
        )}
        <p className="text-meta text-text-muted mt-0.5">{formatDate(log.created_at)}</p>
      </div>
    </div>
  )
}

export function TaskActivityDialog({ open, onOpenChange, logs }: { open: boolean; onOpenChange: (open: boolean) => void; logs: TaskActivityLog[] }) {
  const activityLogs = logs
  const showActivity = open
  const setShowActivity = onOpenChange
  return (
    <Dialog open={showActivity} onOpenChange={setShowActivity}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History size={16} /> Activity Log</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {activityLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <User size={24} className="text-text-muted mb-3" />
              <p className="text-body text-text-secondary">No activity recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activityLogs.map((log) => (
                <ActivityItem key={log.id} log={log} />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
