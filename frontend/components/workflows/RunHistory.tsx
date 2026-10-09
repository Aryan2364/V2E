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
  type LucideIcon,
} from 'lucide-react'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowRunEvent } from '@/lib/types/workflows'
import { BTN, Skeleton, fmtDateTime } from './shared'

const PAGE = 15

const EVENT: Record<string, { Icon: LucideIcon; cls: string }> = {
  run_started: { Icon: PlayCircle, cls: 'text-[#1D4ED8] bg-[#EFF6FF]' },
  step_started: { Icon: PlayCircle, cls: 'text-[#1D4ED8] bg-[#EFF6FF]' },
  step_waiting: { Icon: CalendarClock, cls: 'text-[#1E3A8A] bg-[#EFF6FF]' },
  step_completed: { Icon: CheckCircle2, cls: 'text-[#15803D] bg-[#DCFCE7]' },
  step_late: { Icon: Clock, cls: 'text-[#B91C1C] bg-[#FEE2E2]' },
  step_moved_on: { Icon: FastForward, cls: 'text-[#92400E] bg-[#FEF3C7]' },
  step_escalated: { Icon: Siren, cls: 'text-[#B91C1C] bg-[#FEE2E2]' },
  sent_back: { Icon: Undo2, cls: 'text-[#5B21B6] bg-[#F5F3FF]' },
  returned: { Icon: CornerDownRight, cls: 'text-[#5B21B6] bg-[#F5F3FF]' },
  step_skipped: { Icon: SkipForward, cls: 'text-[#475569] bg-[#F1F5F9]' },
  run_completed: { Icon: CheckCircle2, cls: 'text-[#15803D] bg-[#DCFCE7]' },
  run_cancelled: { Icon: Ban, cls: 'text-[#475569] bg-[#F1F5F9]' },
  run_stuck: { Icon: AlertTriangle, cls: 'text-[#B91C1C] bg-[#FEE2E2]' },
  retried: { Icon: RefreshCw, cls: 'text-[#1D4ED8] bg-[#EFF6FF]' },
  file_added: { Icon: FilePlus2, cls: 'text-[#334155] bg-[#F1F5F9]' },
  file_removed: { Icon: FileX2, cls: 'text-[#334155] bg-[#F1F5F9]' },
}

/** What happened in a run, newest first. `refreshKey` reloads it after an action. */
export default function RunHistory({
  orgId,
  templateId,
  instanceId,
  refreshKey,
}: {
  orgId: string
  templateId: string
  instanceId: string
  refreshKey: number
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
    <section aria-labelledby="run-history" className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <History size={16} className="text-[#475569]" />
        <h2 id="run-history" className="text-[18px] font-semibold text-[#0F172A]">
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
        <div className="flex flex-col gap-2 text-sm text-[#B91C1C]">
          <span>History could not be loaded. {error}</span>
          <button type="button" onClick={load} className={`${BTN.quiet} self-start`}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-[#475569]">Nothing has happened yet.</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {events.slice(0, limit).map((e, i) => {
              const meta = EVENT[e.type] ?? { Icon: History, cls: 'text-[#334155] bg-[#F1F5F9]' }
              const Icon = meta.Icon
              const reason = typeof e.metadata?.reason === 'string' ? (e.metadata.reason as string) : null
              // Some messages leave out who did it ("added “x.pdf”"): put the name in front.
              const named = !!e.actor && /^[a-z]/.test(e.message)
              const text = named ? `${e.actor!.name} ${e.message}` : e.message
              return (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < Math.min(limit, events.length) - 1 && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-px bg-[#E2E8F0]" />}
                  <span className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.cls}`}>
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm text-[#0F172A] break-words">{text}</p>
                    {reason && !e.message.includes(reason) && (
                      <p className="mt-1 text-[13px] text-[#334155] rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-2.5 py-1.5 whitespace-pre-wrap break-words">“{reason}”</p>
                    )}
                    <p className="text-[12px] text-[#475569]">
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
