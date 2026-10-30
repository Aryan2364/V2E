'use client'

import React from 'react'
import { Eye } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { TERMINAL_STATUS_PHASES, type Task } from '@/lib/types/tasks'
import { GivenTaskRow, GivenTaskRowSkeleton } from '../GivenTaskRow'
import { PhoneEmptyState, PhoneFailedState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { cx } from '../primitives'
import { MORE_HREF, type PhoneRoute } from '@/lib/phone-routes'

/*
 * CC'd to me - the phone form of desktop app/dashboard/tasks/cc: the same
 * call (GET tasks/cc, tasksApi.getMyCCTasks), the same read-only meaning.
 * Someone copied on a task can open it and comment but not finish it, so the
 * rows are the Given tab's two-line rows (no completion circle) and a tap
 * opens the task record. Open ones first with a "Done" view one tap away; a
 * task is open until its status reaches a terminal phase, as on desktop's
 * "open" count. Desktop's search / sort / grouping toolbar is the
 * computer's; open vs done is the cut that matters on a phone.
 */

type Tab = 'open' | 'done'

function isDone(task: Task): boolean {
  const phase = task.status?.type
  return !!phase && TERMINAL_STATUS_PHASES.includes(phase)
}

export default function CcTasksScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = React.useState<Task[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('open')

  const reload = React.useCallback(() => {
    if (!orgId) return
    setLoading(true)
    setFailed(false)
    tasksApi
      .getMyCCTasks(orgId)
      .then(setTasks)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [orgId])

  React.useEffect(() => {
    reload()
  }, [reload])

  const open = (tasks ?? []).filter((t) => !isDone(t))
  const done = (tasks ?? []).filter((t) => isDone(t))
  const list = tab === 'open' ? open : done

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? MORE_HREF}>
      <div className="mb-[16px] flex gap-[8px]" role="tablist" aria-label="CC'd to me">
        {(['open', 'done'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx(
              'min-h-(--h-control) rounded-full px-[16px] py-[6px] text-label font-medium',
              tab === key
                ? 'border border-primary bg-primary-subtle text-primary-text'
                : 'border border-border bg-surface text-text-secondary',
            )}
          >
            {key === 'open' ? `Open${open.length ? ` · ${open.length}` : ''}` : `Done${done.length ? ` · ${done.length}` : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <GivenTaskRowSkeleton key={i} />
          ))}
        </div>
      ) : failed ? (
        <PhoneFailedState what="CC'd tasks" onRetry={reload} />
      ) : list.length === 0 ? (
        <PhoneEmptyState
          icon={<Eye />}
          heading={tab === 'open' ? 'Nothing CC’d to you' : 'Nothing finished yet'}
          line={
            tab === 'open'
              ? 'Tasks where you are copied in to keep an eye on will show up here.'
              : 'CC’d tasks that are finished will show up here.'
          }
        />
      ) : (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {list.map((t) => (
            <GivenTaskRow key={t.id} task={t} href={`/dashboard/tasks/${t.id}`} />
          ))}
        </div>
      )}
    </PhoneScreen>
  )
}
