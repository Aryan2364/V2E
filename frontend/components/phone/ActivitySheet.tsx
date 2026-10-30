'use client'

import React from 'react'
import { tasksApi } from '@/lib/api/tasks'
import { fmtDateTime } from '@/lib/phone-format'
import type { TaskActivityLog } from '@/lib/types/tasks'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, ROW_BLOCK } from './primitives'

/*
 * The task's activity log (GET :id/logs - the same call desktop's Activity
 * log dialog makes), in the order the server returns it: who, what, the
 * reason when there is one, and when. Loaded each time the sheet opens.
 */
export function ActivitySheet({
  open,
  onOpenChange,
  orgId,
  taskId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  taskId: string
}) {
  const [logs, setLogs] = React.useState<TaskActivityLog[] | null>(null)
  const [failed, setFailed] = React.useState(false)

  const load = React.useCallback(() => {
    tasksApi
      .getLogs(orgId, taskId)
      .then((rows) => {
        setFailed(false)
        setLogs(rows)
      })
      .catch(() => setFailed(true))
  }, [orgId, taskId])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} title="Activity" fullHeight>
      {failed ? (
        <div className="flex flex-col items-start gap-[8px]">
          <p className="text-body text-text-secondary">Activity could not be loaded. Check your connection, then try again.</p>
          <PhoneButton variant="secondary" onClick={load}>
            Try again
          </PhoneButton>
        </div>
      ) : logs === null ? (
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[16px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/2 rounded-full bg-surface-control" />
        </div>
      ) : logs.length === 0 ? (
        <p className="text-body text-text-secondary">No activity recorded yet.</p>
      ) : (
        <ul className={ROW_BLOCK}>
          {logs.map((log) => (
            <li key={log.id} className="flex flex-col gap-[2px] px-[16px] py-[12px]">
              <p className="text-body text-text-primary">
                <span className="font-medium">{log.performed_by?.name ?? 'Someone'}</span>{' '}
                <span className="text-text-secondary">{log.action.replace(/_/g, ' ')}</span>
              </p>
              {log.metadata?.reason ? (
                <p className="text-label italic text-text-secondary">“{String(log.metadata.reason)}”</p>
              ) : null}
              <p className="text-meta text-text-secondary">{fmtDateTime(log.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </PhoneSheet>
  )
}
