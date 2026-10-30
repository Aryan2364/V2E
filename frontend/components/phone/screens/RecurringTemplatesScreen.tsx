'use client'

import React from 'react'
import { MoreHorizontal, Repeat } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { RecurringTemplate } from '@/lib/types/tasks'
import { templateScheduleSummary } from '@/lib/tasks/recurring-schedule'
import Link from 'next/link'
import { PhoneEmptyState, PhoneFailedState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { PhoneLinkButton, ROW, cx } from '../primitives'
import { RecurringActionsSheet } from '../RecurringActionsSheet'
import { GIVEN_HREF, recurringInstancesHref, type PhoneRoute } from '@/lib/phone-routes'

/*
 * Recurring templates - plan-phone-2026-10-14.md §5.6 (slice 5). Each row:
 * title, schedule in plain words, assignee(s). Tapping a row opens its
 * instances. The "..." button on a row opens the same actions desktop has
 * (RecurringActionsSheet): edit, pause / resume, run today, stop or delete,
 * each gated on that template's own can_edit / can_manage flags. An action the
 * person may not use is shown disabled with who may use it. Pause / resume / stop update the row in
 * place; "delete everything" drops it.
 */

function assigneeLine(t: RecurringTemplate): string {
  const names = t.assignee_names ?? []
  if (names.length === 0) return 'No one assigned'
  return names.join(', ')
}

export default function RecurringTemplatesScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [templates, setTemplates] = React.useState<RecurringTemplate[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  const [actionsFor, setActionsFor] = React.useState<string | null>(null)
  const actionTemplate = templates?.find((t) => t.id === actionsFor) ?? null

  const reload = React.useCallback(() => {
    if (!orgId) return
    setLoading(true)
    setFailed(false)
    tasksApi
      .getRecurringTemplates(orgId)
      .then(setTemplates)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [orgId])

  React.useEffect(() => {
    reload()
  }, [reload])

  return (
    <PhoneScreen title={route.title} parent={route.parent ?? GIVEN_HREF}>
      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex min-h-[64px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
              <span className="h-[16px] w-3/4 rounded-full bg-surface-control" />
              <span className="h-[12px] w-1/2 rounded-full bg-surface-control" />
            </div>
          ))}
        </div>
      ) : failed ? (
        <PhoneFailedState what="Recurring tasks" onRetry={reload} />
      ) : !templates || templates.length === 0 ? (
        <PhoneEmptyState
          icon={<Repeat />}
          heading="No recurring tasks"
          line="Tasks set to repeat (daily, weekly or monthly) will show up here. Set one up from Give task, or on a computer for more options."
        >
          <PhoneLinkButton href="/dashboard/tasks/new" fullWidth>
            Give task
          </PhoneLinkButton>
        </PhoneEmptyState>
      ) : (
        <ul className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {templates.map((t) => (
            <li key={t.id} className="flex items-stretch">
              <Link href={recurringInstancesHref(t.id)} className={cx(ROW, 'min-h-[64px] min-w-0 flex-1 items-start py-[12px]')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-text-primary">
                    {t.title}
                    {!t.is_active ? <span className="ml-[8px] text-meta font-normal text-text-secondary">Paused</span> : null}
                  </span>
                  <span className="block truncate text-label text-text-secondary">{templateScheduleSummary(t.schedule_entries)}</span>
                  <span className="block truncate text-meta text-text-secondary">{assigneeLine(t)}</span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Actions for ${t.title}`}
                onClick={() => setActionsFor(t.id)}
                className="flex w-[48px] shrink-0 items-center justify-center text-text-secondary outline-hidden active:bg-surface-control focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
              >
                <MoreHorizontal aria-hidden className="size-[22px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {actionTemplate ? (
        <RecurringActionsSheet
          orgId={orgId}
          template={actionTemplate}
          open
          onOpenChange={(o) => {
            if (!o) setActionsFor(null)
          }}
          onChanged={(patch) =>
            setTemplates((cur) => (cur ? cur.map((x) => (x.id === actionTemplate.id ? { ...x, ...patch } : x)) : cur))
          }
          onRemoved={() => setTemplates((cur) => (cur ? cur.filter((x) => x.id !== actionTemplate.id) : cur))}
        />
      ) : null}
    </PhoneScreen>
  )
}
