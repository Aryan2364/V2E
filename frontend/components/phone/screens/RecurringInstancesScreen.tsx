'use client'

import { fmtDate } from '@/lib/phone-format'
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { Task } from '@/lib/types/tasks'
import { PhoneEmptyState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'

/*
 * Recurring instances - plan-phone-2026-10-14.md §5.6 (slice 5): a normal
 * phone task list, scoped to one recurring template, newest first. Tapping
 * an instance opens the exact same task detail screen the My work and
 * Given tabs use (TaskDetailScreen) — no separate "recurring task detail".
 */

function statusBadge(task: Task): { label: string; bg: string; text: string } {
  if (task.status) return { label: task.status.label, bg: `${task.status.color}20`, text: task.status.color }
  return { label: 'Open', bg: '#EFF6FF', text: '#2563EB' }
}

export default function RecurringInstancesScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const pathname = usePathname()
  const orgId = user?.organizationId ?? ''
  const templateId = pathname.split('/').filter(Boolean).pop() ?? ''

  const [instances, setInstances] = React.useState<Task[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!orgId || !templateId) return
    setLoading(true)
    tasksApi
      .getRecurringInstances(orgId, templateId)
      .then((list) => setInstances([...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())))
      .catch(() => addToast('This recurring task could not be loaded.', 'error'))
      .finally(() => setLoading(false))
  }, [orgId, templateId, addToast])

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? RECURRING_TEMPLATES_HREF}>
      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex min-h-[56px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
              <span className="h-[14px] w-3/4 rounded-full bg-surface-control" />
              <span className="h-[10px] w-1/3 rounded-full bg-surface-control" />
            </div>
          ))}
        </div>
      ) : !instances || instances.length === 0 ? (
        <PhoneEmptyState
          icon={<CalendarClock />}
          heading="No instances yet"
          line="This recurring task hasn't created any instances yet. They'll show up here as they're spawned."
        />
      ) : (
        <ul className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {instances.map((t) => {
            const badge = statusBadge(t)
            return (
              <li key={t.id}>
                <Link
                  href={`/dashboard/tasks/${t.id}`}
                  className="flex min-h-[56px] items-center justify-between gap-[8px] px-[16px] py-[10px] text-left active:bg-surface-control"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-phone-body text-text-primary">
                      {t.deadline ? fmtDate(t.deadline) : t.title}
                    </span>
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-phone-meta font-semibold"
                    style={{ backgroundColor: badge.bg, color: badge.text }}
                  >
                    {badge.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PhoneScreen>
  )
}
