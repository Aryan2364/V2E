'use client'

import React from 'react'
import { CheckCircle2, Plus, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { MyGroupedTasks, Task } from '@/lib/types/tasks'
import { canQuickComplete } from '@/lib/tasks/finish-rules'
import { COMPLETED_UNDO_MESSAGE, completeForMe, undoCompleteForMe } from '@/lib/tasks/complete-for-me'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { TaskPhoneRow, TaskPhoneRowSkeleton, type RowPhase } from '../TaskPhoneRow'
import { FinishTaskSheet } from '../FinishTaskSheet'
import { useUndoToast } from '../UndoToast'
import { useTaskBadge } from '@/lib/task-badge'
import { cx } from '../primitives'
import type { PhoneRoute } from '@/lib/phone-routes'

/*
 * My work - the phone's home (plan-phone-2026-10-14.md §5.1). Overdue /
 * Today / Tomorrow / Later / No date, each task row carrying the completion
 * circle (KIT-PENDING-phone-task-tick.md). Replaces slice 1's
 * ComingNextScreen placeholder for the 'my-work' route key only - routing
 * itself (PhoneShell's GuardedScreen switch) is unchanged.
 */

type BucketKey = 'overdue' | 'today' | 'tomorrow' | 'later' | 'noDate'
const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'later', label: 'Later' },
  { key: 'noDate', label: 'No date' },
]

type RowState = { phase: RowPhase }

export default function MyWorkScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { loading: permsLoading } = usePermissions()
  const { addToast } = useToast()
  const { showUndo } = useUndoToast()
  const { refresh: refreshBadge } = useTaskBadge()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id

  const [grouped, setGrouped] = React.useState<MyGroupedTasks | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [rowStates, setRowStates] = React.useState<Record<string, RowState>>({})
  const [sheetTaskId, setSheetTaskId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!orgId) return
    const data = await tasksApi.getMyGrouped(orgId)
    setGrouped(data)
  }, [orgId])

  React.useEffect(() => {
    if (!orgId) return
    setLoading(true)
    load()
      .catch(() => addToast('My work could not be loaded. Pull down to try again.', 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await load()
    } catch {
      addToast('Could not refresh. Try again.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  function findTask(taskId: string): { bucket: BucketKey; index: number; task: Task } | null {
    if (!grouped) return null
    for (const { key } of BUCKETS) {
      const list = grouped[key]
      const index = list.findIndex((t) => t.id === taskId)
      if (index !== -1) return { bucket: key, index, task: list[index] }
    }
    return null
  }

  function updateTaskInPlace(updated: Task) {
    setGrouped((cur) => {
      if (!cur) return cur
      const next = { ...cur }
      for (const { key } of BUCKETS) {
        const idx = next[key].findIndex((t) => t.id === updated.id)
        if (idx !== -1) {
          const list = next[key].slice()
          list[idx] = updated
          next[key] = list
          break
        }
      }
      return next
    })
  }

  function removeTask(taskId: string): { bucket: BucketKey; index: number; task: Task } | null {
    const found = findTask(taskId)
    if (!found || !grouped) return found
    setGrouped((cur) => {
      if (!cur) return cur
      const next = { ...cur }
      next[found.bucket] = next[found.bucket].filter((t) => t.id !== taskId)
      return next
    })
    return found
  }

  function reinsertTask(entry: { bucket: BucketKey; index: number; task: Task }) {
    setGrouped((cur) => {
      if (!cur) return cur
      const next = { ...cur }
      const list = next[entry.bucket].slice()
      list.splice(Math.min(entry.index, list.length), 0, entry.task)
      next[entry.bucket] = list
      return next
    })
  }

  /** Runs the actual complete call per completion_mode (plan §5.1, item 4) - shared with the detail screen. */
  const callComplete = (task: Task) => completeForMe(orgId, task)
  const callUndo = (task: Task) => undoCompleteForMe(orgId, task)

  /** The tap-to-complete flow (KIT-PENDING item 2): optimistic, animated, undoable. */
  function completeOptimistically(task: Task) {
    const entry = findTask(task.id)
    if (!entry) return

    // 1. Circle fills + checkmark, title strikes through.
    setRowStates((s) => ({ ...s, [task.id]: { phase: 'done' } }))

    const apiCall = callComplete(task)

    // 2. After ~300ms, collapse the row out of the list (same DOM node, no flicker).
    window.setTimeout(() => {
      setRowStates((s) => ({ ...s, [task.id]: { phase: 'collapsed' } }))
      window.setTimeout(() => {
        removeTask(task.id)
        setRowStates((s) => {
          const next = { ...s }
          delete next[task.id]
          return next
        })
      }, 300)
    }, 300)

    apiCall
      .then(() => {
        void refreshBadge()
        showUndo(COMPLETED_UNDO_MESSAGE, async () => {
          try {
            await callUndo(task)
            reinsertTask(entry)
            void refreshBadge()
          } catch {
            addToast('Could not undo. Reopen the task from its record.', 'error')
          }
        })
      })
      .catch(() => {
        // Revert the whole visual change and restore the row (optimistic failure).
        setRowStates((s) => {
          const next = { ...s }
          delete next[task.id]
          return next
        })
        reinsertTask(entry)
        addToast('Could not complete the task. Try again.', 'error')
      })
  }

  function onTapCircle(task: Task) {
    if (rowStates[task.id]?.phase && rowStates[task.id].phase !== 'idle') return
    if (canQuickComplete(task, userId)) {
      completeOptimistically(task)
    } else {
      setSheetTaskId(task.id)
    }
  }

  const sheetEntry = sheetTaskId ? findTask(sheetTaskId) : null

  const canCreate = permsLoading ? false : true // POST /tasks has no dedicated permission leaf; any org member may give a task (backend: org membership only).
  const anyTasks = grouped ? BUCKETS.some(({ key }) => grouped[key].length > 0) : false

  return (
    <PhoneScreen title={route.title}>
      <PullHint refreshing={refreshing} onRefresh={onRefresh} />

      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 5 }).map((_, i) => (
            <TaskPhoneRowSkeleton key={i} />
          ))}
        </div>
      ) : !anyTasks ? (
        <PhoneEmptyState
          icon={<CheckCircle2 />}
          heading="Nothing is waiting for you"
          line="Tasks assigned to you will show up here, grouped by when they're due."
        />
      ) : (
        <div className="flex flex-col gap-[20px]">
          {BUCKETS.map(({ key, label }) => {
            const list = grouped?.[key] ?? []
            if (list.length === 0) return null
            return (
              <section key={key} aria-labelledby={`my-work-${key}`} className="flex flex-col gap-[8px]">
                <h2
                  id={`my-work-${key}`}
                  className={cx(
                    'text-label font-medium',
                    key === 'overdue' ? 'text-danger' : 'text-text-secondary',
                  )}
                >
                  {label}
                </h2>
                <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
                  {list.map((task) => (
                    <TaskPhoneRow
                      key={task.id}
                      task={task}
                      userId={userId}
                      phase={rowStates[task.id]?.phase ?? 'idle'}
                      onTapCircle={() => onTapCircle(task)}
                      href={`/dashboard/tasks/${task.id}`}
                      dayKnown={key === 'today' || key === 'tomorrow'}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {sheetEntry ? (
        <FinishTaskSheet
          open
          onOpenChange={(open) => {
            if (!open) setSheetTaskId(null)
          }}
          orgId={orgId}
          userId={userId}
          task={sheetEntry.task}
          onTaskUpdate={updateTaskInPlace}
          onComplete={() => {
            setSheetTaskId(null)
            completeOptimistically(sheetEntry.task)
          }}
        />
      ) : null}

      {canCreate ? (
        <Link
          href="/dashboard/tasks/new"
          aria-label="Give task"
          className={cx(
            'fixed z-(--z-shell) flex size-[56px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-dialog active:bg-primary-pressed',
            'right-[max(16px,var(--safe-right))] bottom-[calc(var(--bottom-bar)+var(--safe-bottom)+16px)]',
          )}
        >
          <Plus aria-hidden className="size-[26px]" />
        </Link>
      ) : null}
    </PhoneScreen>
  )
}

/**
 * A minimal pull-to-refresh (plan §5.1): a pointer-tracked pull from the top
 * of the content reveals a refresh affordance; releasing past the threshold
 * refreshes. The phone's own overscroll is disabled (globals.css, 41.5 rule
 * 16: the browser's pull-to-refresh would reload the whole page), so this is
 * the list's own.
 */
function PullHint({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const [pull, setPull] = React.useState(0)
  const start = React.useRef<number | null>(null)
  const THRESHOLD = 64

  const onPointerDown = (e: React.PointerEvent) => {
    if (window.scrollY > 0) return
    start.current = e.clientY
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current === null || refreshing) return
    const dy = e.clientY - start.current
    if (dy > 0 && window.scrollY === 0) setPull(Math.min(dy, THRESHOLD * 1.5))
  }
  const onPointerUp = () => {
    if (pull >= THRESHOLD) onRefresh()
    setPull(0)
    start.current = null
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ height: refreshing ? 40 : pull }}
      className="flex items-center justify-center overflow-hidden transition-[height] duration-(--duration-fast)"
    >
      {refreshing || pull > 8 ? (
        <RotateCw
          aria-hidden
          className={cx('size-[20px] text-text-secondary', refreshing && 'animate-spin')}
        />
      ) : null}
    </div>
  )
}
