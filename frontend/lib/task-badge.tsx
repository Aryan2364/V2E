'use client'

import React from 'react'
import { tasksApi } from './api/tasks'

/*
 * The phone's home-screen icon badge - KIT-PENDING-phone-task-tick.md item 6,
 * plan-phone-2026-10-14.md "6. Badge". The count is my tasks overdue or due
 * today (GET /tasks/badge-count, the same predicate as /tasks/my/grouped's
 * Overdue + Today).
 *
 * DEVIATION FROM SLICE 1: PhoneShell previously drove navigator.setAppBadge
 * from the notifications unread count (lib/service-worker.ts useAppBadge).
 * This slice's spec is explicit that v2e's badge is the task count, not the
 * notification count, so PhoneShell now mounts this provider instead and
 * the old useAppBadge(true, unreadCount) call is removed. The service
 * worker's own badge write (public/sw.js, on a push payload's `badge_count`)
 * is unchanged and already uses the same field name/semantics.
 *
 * Refreshed: on mount (app open), after every completing action (tick or
 * Finish-sheet complete) and after Undo, via the shared `refresh()` call.
 */

type TaskBadgeContextValue = {
  refresh: () => Promise<void>
}

const TaskBadgeContext = React.createContext<TaskBadgeContextValue | null>(null)

function setBadge(count: number) {
  if (typeof navigator === 'undefined') return
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {})
    else void nav.clearAppBadge?.()?.catch(() => {})
  } catch {
    /* Badging API not supported — ignored. */
  }
}

export function TaskBadgeProvider({
  orgId,
  children,
}: {
  orgId: string
  children: React.ReactNode
}) {
  const refresh = React.useCallback(async () => {
    if (!orgId) return
    try {
      const count = await tasksApi.getBadgeCount(orgId)
      setBadge(count)
    } catch {
      /* Best effort; the badge simply stays at its last known value. */
    }
  }, [orgId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const value = React.useMemo(() => ({ refresh }), [refresh])

  return <TaskBadgeContext.Provider value={value}>{children}</TaskBadgeContext.Provider>
}

export function useTaskBadge(): TaskBadgeContextValue {
  const ctx = React.useContext(TaskBadgeContext)
  if (!ctx) throw new Error('useTaskBadge must be used within a TaskBadgeProvider')
  return ctx
}
