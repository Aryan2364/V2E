'use client'

import React from 'react'
import Link from 'next/link'
import { Pause, Pencil, Play, Trash2, Zap } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { useToast } from '@/components/ui/Toast'
import type { RecurringTemplate } from '@/lib/types/tasks'
import { recurringEditHref } from '@/lib/phone-routes'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, ROW, ROW_BLOCK, cx } from './primitives'

/*
 * The actions on one recurring template, as a phone sheet. Mirrors the
 * desktop RecurringCard (app/dashboard/tasks/recurring/page.tsx):
 *   - Edit, Run today, Pause / Resume need template.can_edit (creator, admin
 *     or edit-share; assignees cannot). Run today only while active.
 *   - Stop / delete need template.can_manage (creator or admin).
 *   - Stop / delete asks first, with the desktop's exact wording
 *     (DELETE_COPY): stop keeps every task, "delete-future" also removes open
 *     tasks, "delete-all" removes the template and everything it created.
 * An action the person may not do is not offered, the way desktop hides it
 * (the server would refuse it anyway). Mount it only while open: its
 * confirm step resets with each opening.
 */

export type DeleteMode = 'stop' | 'delete-future' | 'delete-all'

const DELETE_COPY: Record<DeleteMode, { title: string; body: string; confirm: string; danger: boolean; hint: string }> = {
  stop: {
    title: 'Stop this recurring task?',
    body: 'No new tasks will be created from it. Every task it already created stays untouched. You can Resume it any time.',
    confirm: 'Stop',
    danger: false,
    hint: 'No new tasks; existing ones stay',
  },
  'delete-future': {
    title: 'Stop and remove open tasks?',
    body: 'No new tasks will be created, and its still-open tasks are removed. Tasks that were already completed or closed are kept.',
    confirm: 'Stop & remove open tasks',
    danger: true,
    hint: 'Completed ones are kept',
  },
  'delete-all': {
    title: 'Delete everything?',
    body: 'The recurring task AND every task it ever created, including completed ones, will be deleted. This cannot be undone.',
    confirm: 'Delete everything',
    danger: true,
    hint: 'Removes it and every task it created',
  },
}

const DELETE_LABEL: Record<DeleteMode, string> = {
  stop: 'Stop (keep all tasks)',
  'delete-future': 'Stop & remove open tasks',
  'delete-all': 'Delete everything',
}

/** The server's own message from a failed call, if it sent one. */
function apiMessage(e: unknown): string | undefined {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message
}

const ACTION_ROW = cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:text-text-muted')

export function RecurringActionsSheet({
  orgId,
  template,
  open,
  onOpenChange,
  onChanged,
  onRemoved,
}: {
  orgId: string
  template: RecurringTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The template changed in place (paused, resumed, stopped): update its row. */
  onChanged: (patch: Partial<RecurringTemplate>) => void
  /** "Delete everything" succeeded: the template no longer exists. */
  onRemoved: () => void
}) {
  const { addToast } = useToast()
  const [confirming, setConfirming] = React.useState<DeleteMode | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    try {
      if (template.is_active) await tasksApi.pauseRecurring(orgId, template.id)
      else await tasksApi.resumeRecurring(orgId, template.id)
      onChanged({ is_active: !template.is_active })
      addToast(template.is_active ? 'Paused' : 'Resumed', 'success')
      onOpenChange(false)
    } catch (e) {
      addToast(apiMessage(e) ?? 'Could not change status.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function runToday() {
    setBusy(true)
    try {
      const r = await tasksApi.spawnTodayRecurring(orgId, template.id)
      addToast(r.spawned > 0 ? `${r.spawned} task${r.spawned !== 1 ? 's' : ''} created` : 'Already created today', 'success')
      onOpenChange(false)
    } catch (e) {
      addToast(apiMessage(e) ?? "Could not create today's task.", 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await tasksApi.deleteRecurring(orgId, template.id, confirming)
      if (confirming === 'delete-all') onRemoved()
      else onChanged({ is_active: false })
      onOpenChange(false)
    } catch (e) {
      setError(apiMessage(e) ?? 'Could not do this. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = confirming ? DELETE_COPY[confirming] : null

  return (
    <PhoneSheet
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o)
      }}
      title={copy ? copy.title : template.title}
      footer={
        copy ? (
          <>
            <PhoneButton disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </PhoneButton>
            <PhoneButton
              variant="primary"
              loading={busy}
              onClick={() => void confirmDelete()}
              className={cx(
                copy.danger &&
                  'border-danger bg-danger active:border-danger active:bg-danger disabled:border-surface-control-pressed disabled:bg-surface-control-pressed',
              )}
            >
              {copy.confirm}
            </PhoneButton>
          </>
        ) : undefined
      }
    >
      {copy ? (
        <div className="flex flex-col gap-[12px]">
          <p className="text-body text-text-primary wrap-break-word">
            <span className="font-medium">&ldquo;{template.title}&rdquo;</span>: {copy.body}
          </p>
          {error ? <p className="text-label text-danger">{error}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-[16px]">
          <ul className={ROW_BLOCK}>
            <ActionRow allowed={template.can_edit} reason={EDIT_REASON}>
              {template.can_edit ? (
                <Link href={recurringEditHref(template.id)} className={ACTION_ROW}>
                  <Pencil aria-hidden className="text-text-secondary" />
                  Edit schedule
                </Link>
              ) : (
                <button type="button" disabled className={ACTION_ROW}>
                  <Pencil aria-hidden />
                  Edit schedule
                </button>
              )}
            </ActionRow>
            <ActionRow allowed={template.can_edit} reason={EDIT_REASON}>
              <button type="button" disabled={busy || !template.can_edit} onClick={() => void toggle()} className={ACTION_ROW}>
                {template.is_active ? <Pause aria-hidden className="text-text-secondary" /> : <Play aria-hidden className="text-text-secondary" />}
                {template.is_active ? 'Pause' : 'Resume'}
              </button>
            </ActionRow>
            {template.is_active ? (
              <ActionRow allowed={template.can_edit} reason={EDIT_REASON}>
                <button type="button" disabled={busy || !template.can_edit} onClick={() => void runToday()} className={ACTION_ROW}>
                  <Zap aria-hidden className="text-text-secondary" />
                  Run today
                </button>
              </ActionRow>
            ) : null}
          </ul>
          <ul className={ROW_BLOCK}>
            {(['stop', 'delete-future', 'delete-all'] as const).map((mode) => (
              <ActionRow key={mode} allowed={template.can_manage} reason={MANAGE_REASON}>
                <button type="button" disabled={busy || !template.can_manage} onClick={() => setConfirming(mode)} className={cx(ACTION_ROW, 'items-start')}>
                  <Trash2 aria-hidden className={template.can_manage && DELETE_COPY[mode].danger ? 'text-danger' : 'text-text-secondary'} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={template.can_manage && DELETE_COPY[mode].danger ? 'text-danger' : undefined}>{DELETE_LABEL[mode]}</span>
                    <span className="text-label text-text-secondary">{DELETE_COPY[mode].hint}</span>
                  </span>
                </button>
              </ActionRow>
            ))}
          </ul>
        </div>
      )}
    </PhoneSheet>
  )
}

const EDIT_REASON = 'Only the person who set this up, an admin, or someone allowed to edit it can do this'
const MANAGE_REASON = 'Only the person who set this up, or an admin, can do this'

/*
 * An action the person may not use stays on the sheet, disabled, and says who
 * may use it (kit 4: individual actions are shown, not hidden). The tooltip
 * sits on PermissionTooltip's focusable wrapper because a disabled button
 * never fires one.
 */
function ActionRow({ allowed, reason, children }: { allowed: boolean | undefined; reason: string; children: React.ReactNode }) {
  return (
    <li className="[&>span]:flex [&>span]:w-full">
      <PermissionTooltip allowed={allowed} reason={reason}>
        {children}
      </PermissionTooltip>
    </li>
  )
}
