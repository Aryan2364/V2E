'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  FilePlus2,
  FileX2,
  FastForward,
  History,
  PlayCircle,
  RefreshCw,
  Siren,
  SkipForward,
  Undo2,
  CornerDownRight,
  StickyNote,
  type LucideIcon,
} from 'lucide-react'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowRunEvent } from '@/lib/types/workflows'
import { BTN, Skeleton, fmtDateTime } from './shared'

const PAGE = 15

const EVENT: Record<string, { Icon: LucideIcon; cls: string }> = {
  run_started: { Icon: PlayCircle, cls: 'text-primary-text bg-primary-subtle' },
  step_started: { Icon: PlayCircle, cls: 'text-primary-text bg-primary-subtle' },
  step_waiting: { Icon: CalendarClock, cls: 'text-primary-text bg-primary-subtle' },
  step_completed: { Icon: CheckCircle2, cls: 'text-success bg-success-bg' },
  step_late: { Icon: Clock, cls: 'text-danger bg-danger-bg' },
  step_moved_on: { Icon: FastForward, cls: 'text-warning bg-warning-bg' },
  step_escalated: { Icon: Siren, cls: 'text-danger bg-danger-bg' },
  sent_back: { Icon: Undo2, cls: 'text-text-secondary bg-surface-control' },
  returned: { Icon: CornerDownRight, cls: 'text-text-secondary bg-surface-control' },
  step_skipped: { Icon: SkipForward, cls: 'text-text-secondary bg-surface-control' },
  run_completed: { Icon: CheckCircle2, cls: 'text-success bg-success-bg' },
  run_cancelled: { Icon: Ban, cls: 'text-text-secondary bg-surface-control' },
  run_stuck: { Icon: AlertTriangle, cls: 'text-danger bg-danger-bg' },
  retried: { Icon: RefreshCw, cls: 'text-primary-text bg-primary-subtle' },
  file_added: { Icon: FilePlus2, cls: 'text-text-secondary bg-surface-control' },
  file_removed: { Icon: FileX2, cls: 'text-text-secondary bg-surface-control' },
  note_added: { Icon: StickyNote, cls: 'text-warning bg-warning-bg' },
  note_deleted: { Icon: StickyNote, cls: 'text-text-secondary bg-surface-control' },
  // Same events under their instance names.
  instance_started: { Icon: PlayCircle, cls: 'text-primary-text bg-primary-subtle' },
  instance_completed: { Icon: CheckCircle2, cls: 'text-success bg-success-bg' },
  instance_cancelled: { Icon: Ban, cls: 'text-text-secondary bg-surface-control' },
  instance_stuck: { Icon: AlertTriangle, cls: 'text-danger bg-danger-bg' },
}

/** What happened in an instance, newest first. `refreshKey` reloads it after an action. */
export default function RunHistory({
  orgId,
  templateId,
  instanceId,
  refreshKey,
  stepLabels,
}: {
  orgId: string
  templateId: string
  instanceId: string
  refreshKey: number
  /** Instance row id → its number ("1", "B2"), to tag what each entry is about. */
  stepLabels?: Map<string, string>
}) {
  const [events, setEvents] = useState<WorkflowRunEvent[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const load = useCallback(async () => {
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      const list = await workflowsApi.listEvents(orgId, templateId, instanceId)
      setEvents((Array.isArray(list) ? list : []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)))
      setStatus('ready')
    } catch (e) {
      setError(workflowErrorMessage(e, 'Check your connection and try again.'))
      setStatus('failed')
    }
  }, [orgId, templateId, instanceId])

  useEffect(() => {
    if (orgId) load()
  }, [load, refreshKey, orgId])

  return (
    <section aria-labelledby="run-history" className="bg-surface border border-border-light rounded-card shadow-card p-4 sm:p-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <History size={16} className="text-text-secondary" />
        <h2 id="run-history" className="text-[18px] font-medium text-text-primary">
          History
        </h2>
      </div>
      {status === 'loading' ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : status === 'failed' ? (
        <div className="flex flex-col gap-2 text-sm text-danger">
          <span>History could not be loaded. {error}</span>
          <button type="button" onClick={load} className={`${BTN.quiet} self-start`}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-text-secondary">No activity yet.</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {events.slice(0, limit).map((e, i) => {
              const meta = EVENT[e.type] ?? { Icon: History, cls: 'text-text-secondary bg-surface-control' }
              const Icon = meta.Icon
              const reason = typeof e.metadata?.reason === 'string' ? (e.metadata.reason as string) : null
              // Some messages leave out who did it ("added “x.pdf”"): put the name in front.
              const named = !!e.actor && /^[a-z]/.test(e.message)
              const text = named ? `${e.actor!.name} ${e.message}` : e.message
              const stepLabel = e.instance_step_id ? stepLabels?.get(e.instance_step_id) : undefined
              return (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < Math.min(limit, events.length) - 1 && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-px bg-surface-control-pressed" />}
                  <span className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.cls}`}>
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm text-text-primary wrap-break-word">{text}</p>
                    {reason && !e.message.includes(reason) && (
                      <p className="mt-1 text-[13px] text-text-secondary rounded-[8px] bg-surface-sunken border border-border-light px-2.5 py-1.5 whitespace-pre-wrap wrap-break-word">“{reason}”</p>
                    )}
                    <p className="text-[12px] text-text-secondary">
                      {stepLabel && (
                        <span className="inline-flex items-center mr-1.5 rounded-full border border-border bg-white px-1.5 text-[11px] font-medium text-text-secondary">
                          Step {stepLabel}
                        </span>
                      )}
                      {e.actor && !named && !e.message.includes(e.actor.name) ? `${e.actor.name} · ` : ''}
                      {fmtDateTime(e.created_at)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {events.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={`${BTN.quiet} self-start`}>
              Show {Math.min(PAGE, events.length - limit)} more
            </button>
          )}
        </>
      )}
    </section>
  )
}
