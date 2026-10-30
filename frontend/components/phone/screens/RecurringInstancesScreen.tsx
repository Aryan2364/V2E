'use client'

import { fmtDate } from '@/lib/phone-format'
import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { CalendarClock, MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { RecurringTemplate, Task } from '@/lib/types/tasks'
import { templateScheduleSummary } from '@/lib/tasks/recurring-schedule'
import { PhoneEmptyState, PhoneFailedState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { PhoneButton } from '../primitives'
import { RecurringActionsSheet } from '../RecurringActionsSheet'
import { RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'

/*
 * Recurring instances - plan-phone-2026-10-14.md §5.6 (slice 5): a normal
 * phone task list, scoped to one recurring template, newest first. Tapping
 * an instance opens the exact same task detail screen the My work and
 * Given tabs use (TaskDetailScreen) — no separate "recurring task detail".
 * A header above the list names the schedule and carries an Actions button
 * (each action gated on the template's can_edit / can_manage)
 * (RecurringActionsSheet: edit, pause / resume, run today, stop or delete),
 * the same actions desktop offers on a template. Deleting everything returns
 * to the templates list.
 */

function statusBadge(task: Task): { label: string; bg: string; text: string } {
  if (task.status) return { label: task.status.label, bg: `${task.status.color}20`, text: task.status.color }
  return { label: 'Open', bg: 'var(--primary-subtle)', text: 'var(--primary-text)' }
}

export default function RecurringInstancesScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const templateId = pathname.split('/').filter(Boolean).pop() ?? ''

  const [instances, setInstances] = React.useState<Task[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  const [template, setTemplate] = React.useState<RecurringTemplate | null>(null)
  const [actionsOpen, setActionsOpen] = React.useState(false)

  // The template itself (for the header and its permission flags). A miss
  // just hides the header; the instances list below does not depend on it.
  React.useEffect(() => {
    if (!orgId || !templateId) return
    tasksApi
      .getRecurringTemplates(orgId)
      .then((list) => setTemplate(list.find((t) => t.id === templateId) ?? null))
      .catch(() => setTemplate(null))
  }, [orgId, templateId])

  const reload = React.useCallback(() => {
    if (!orgId || !templateId) return
    setLoading(true)
    setFailed(false)
    tasksApi
      .getRecurringInstances(orgId, templateId)
      .then((list) => setInstances([...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [orgId, templateId])

  React.useEffect(() => {
    reload()
  }, [reload])

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? RECURRING_TEMPLATES_HREF}>
      {template ? (
        <div className="mb-[16px] flex items-center gap-[12px]">
          <div className="min-w-0 flex-1">
            <p className="wrap-break-word text-body font-medium text-text-primary">
              {template.title}
              {!template.is_active ? <span className="ml-[8px] text-meta font-normal text-text-secondary">Paused</span> : null}
            </p>
            <p className="wrap-break-word text-label text-text-secondary">{templateScheduleSummary(template.schedule_entries)}</p>
          </div>
          <PhoneButton onClick={() => setActionsOpen(true)} aria-label="Actions">
            <MoreHorizontal aria-hidden />
            Actions
          </PhoneButton>
        </div>
      ) : null}
      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex min-h-[56px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
              <span className="h-[14px] w-3/4 rounded-full bg-surface-control" />
              <span className="h-[10px] w-1/3 rounded-full bg-surface-control" />
            </div>
          ))}
        </div>
      ) : failed ? (
        <PhoneFailedState what="This recurring task" onRetry={reload} />
      ) : !instances || instances.length === 0 ? (
        <PhoneEmptyState
          icon={<CalendarClock />}
          heading="No tasks created yet"
          line="This recurring task has not created any tasks yet. They will show up here as they are created."
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
                    <span className="block truncate text-body text-text-primary">
                      {t.deadline ? fmtDate(t.deadline) : t.title}
                    </span>
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-meta font-medium"
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
      {template && actionsOpen ? (
        <RecurringActionsSheet
          orgId={orgId}
          template={template}
          open
          onOpenChange={setActionsOpen}
          onChanged={(patch) => setTemplate((cur) => (cur ? { ...cur, ...patch } : cur))}
          onRemoved={() => router.replace(RECURRING_TEMPLATES_HREF)}
        />
      ) : null}
    </PhoneScreen>
  )
}
