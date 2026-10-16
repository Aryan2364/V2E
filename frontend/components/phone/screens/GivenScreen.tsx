'use client'

import React from 'react'
import Link from 'next/link'
import { Plus, RotateCw, Repeat, UserCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { TERMINAL_STATUS_PHASES, type Task } from '@/lib/types/tasks'
import { GivenTaskRow, GivenTaskRowSkeleton } from '../GivenTaskRow'
import { PhoneEmptyState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { cx } from '../primitives'
import { RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'

/*
 * Given - plan-phone-2026-10-14.md §5.2 (slice 5). Tasks I gave to others
 * (GET tasks/assigned-by-me), open ones by default with a "Done" view one
 * tap away, no completion circle (D7). A pinned "Recurring tasks ›" row at
 * the top is the primary entry point into the Recurring screens (§7/D8);
 * More carries the secondary one.
 */

type Tab = 'open' | 'done'

function isDone(task: Task): boolean {
  const phase = task.status?.type
  return !!phase && TERMINAL_STATUS_PHASES.includes(phase)
}

export default function GivenScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { loading: permsLoading } = usePermissions()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = React.useState<Task[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('open')

  const load = React.useCallback(async () => {
    if (!orgId) return
    const data = await tasksApi.getAssignedByMe(orgId)
    setTasks(data)
  }, [orgId])

  React.useEffect(() => {
    if (!orgId) return
    setLoading(true)
    load()
      .catch(() => addToast('Given could not be loaded. Pull down to try again.', 'error'))
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

  const open = (tasks ?? []).filter((t) => !isDone(t))
  const done = (tasks ?? []).filter((t) => isDone(t))
  const list = tab === 'open' ? open : done
  const canCreate = permsLoading ? false : true // POST /tasks: org membership only, no dedicated permission leaf.

  return (
    <PhoneScreen title={route.title}>
      <PullHint refreshing={refreshing} onRefresh={onRefresh} />

      <Link
        href={RECURRING_TEMPLATES_HREF}
        className="mb-[16px] flex min-h-[48px] items-center justify-between rounded-[8px] border border-phone-border-light bg-phone-surface px-[12px] active:bg-phone-surface-control"
      >
        <span className="inline-flex items-center gap-[8px] text-phone-body font-medium text-phone-text-primary">
          <Repeat aria-hidden className="size-[18px] text-phone-text-secondary" />
          Recurring tasks
        </span>
        <span aria-hidden className="text-phone-text-secondary">
          ›
        </span>
      </Link>

      <div className="mb-[16px] flex gap-[8px]" role="tablist" aria-label="Given">
        {(['open', 'done'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx(
              'min-h-[36px] rounded-full px-[14px] py-[6px] text-phone-label font-medium',
              tab === key
                ? 'border border-phone-primary bg-phone-primary-subtle text-phone-primary-text'
                : 'border border-phone-border bg-phone-surface text-phone-text-secondary',
            )}
          >
            {key === 'open' ? `Open${open.length ? ` · ${open.length}` : ''}` : `Done${done.length ? ` · ${done.length}` : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mx-[-16px] divide-y divide-phone-border-light border-y border-phone-border-light bg-phone-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <GivenTaskRowSkeleton key={i} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <PhoneEmptyState
          icon={<UserCheck />}
          heading={tab === 'open' ? 'Nothing given yet' : 'Nothing finished yet'}
          line={tab === 'open' ? 'Tasks you give to others will show up here, open first.' : 'Tasks you gave that are finished will show up here.'}
        />
      ) : (
        <div className="mx-[-16px] mb-[88px] divide-y divide-phone-border-light border-y border-phone-border-light bg-phone-surface">
          {list.map((t) => (
            <GivenTaskRow key={t.id} task={t} href={`/dashboard/tasks/${t.id}`} />
          ))}
        </div>
      )}

      {canCreate ? (
        <Link
          href="/dashboard/tasks/new"
          aria-label="Give task"
          className={cx(
            'fixed z-30 flex size-[56px] items-center justify-center rounded-full bg-phone-primary text-phone-primary-foreground shadow-phone-dialog active:bg-phone-primary-pressed',
            'right-[max(16px,var(--safe-right))] bottom-[calc(var(--bottom-bar)+var(--safe-bottom)+16px)]',
          )}
        >
          <Plus aria-hidden className="size-[26px]" />
        </Link>
      ) : null}
    </PhoneScreen>
  )
}

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
        <RotateCw aria-hidden className={cx('size-[20px] text-phone-text-secondary', refreshing && 'animate-spin')} />
      ) : null}
    </div>
  )
}
