'use client'

import React from 'react'
import { ChevronRight, Repeat } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { RecurringTemplate } from '@/lib/types/tasks'
import { templateScheduleSummary } from '@/lib/tasks/recurring-schedule'
import { PhoneEmptyState } from '../PhoneEmptyState'
import PhoneScreen from '../PhoneScreen'
import { ROW, cx } from '../primitives'
import { GIVEN_HREF, recurringInstancesHref, type PhoneRoute } from '@/lib/phone-routes'

/*
 * Recurring templates - plan-phone-2026-10-14.md §5.6 (slice 5). Each row:
 * title, schedule in plain words, assignee(s). Tapping a row opens its
 * instances. Pausing/resuming and editing a schedule stay computer-only
 * (not in this slice's scope) — a template row is read-only on the phone.
 */

function assigneeLine(t: RecurringTemplate): string {
  const names = t.assignee_names ?? []
  if (names.length === 0) return 'No one assigned'
  return names.join(', ')
}

export default function RecurringTemplatesScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [templates, setTemplates] = React.useState<RecurringTemplate[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!orgId) return
    setLoading(true)
    tasksApi
      .getRecurringTemplates(orgId)
      .then(setTemplates)
      .catch(() => addToast('Recurring tasks could not be loaded.', 'error'))
      .finally(() => setLoading(false))
  }, [orgId, addToast])

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
      ) : !templates || templates.length === 0 ? (
        <PhoneEmptyState
          icon={<Repeat />}
          heading="No recurring tasks"
          line="Tasks set to repeat (daily, weekly or monthly) will show up here. Set one up from Give task, or on a computer for more options."
        />
      ) : (
        <ul className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {templates.map((t) => (
            <li key={t.id}>
              <a href={recurringInstancesHref(t.id)} className={cx(ROW, 'min-h-[64px] items-start py-[12px]')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-phone-body font-semibold text-text-primary">
                    {t.title}
                    {!t.is_active ? <span className="ml-[8px] text-phone-meta font-normal text-text-secondary">(paused)</span> : null}
                  </span>
                  <span className="block truncate text-phone-label text-text-secondary">{templateScheduleSummary(t.schedule_entries)}</span>
                  <span className="block truncate text-phone-meta text-text-secondary">{assigneeLine(t)}</span>
                </span>
                <ChevronRight aria-hidden className="mt-[4px] size-[18px] shrink-0 text-text-secondary" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </PhoneScreen>
  )
}
