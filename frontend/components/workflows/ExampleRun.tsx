'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarRange, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { workflowsApi, workflowErrorMessage, workflowErrorStatus } from '@/lib/api/workflows'
import type { TimelinePreview, TimingWarning, WorkflowDefinitionInput } from '@/lib/types/workflows'
import { Reveal, Skeleton, fmtDayDateTime, fmtSpan } from './shared'

/** Edits settle for this long before the example is worked out again. */
const DEBOUNCE_MS = 700

/**
 * A timing warning in words. `name` turns a step key into "Step 2 “Review”" for a
 * warning that only names the steps.
 */
export function warningText(w: TimingWarning, name?: (key: string) => string): string {
  if (typeof w === 'string') return w
  if (!w || typeof w !== 'object') return ''
  if (typeof w.message === 'string' && w.message.trim()) return w.message
  const key = w.step_key ?? w.key
  if (key && w.predecessor_key) {
    const n = name ?? ((k: string) => `Step ${k}`)
    return `${n(key)} is timed to start before ${n(w.predecessor_key)} is due, so it is planned later than its own date.`
  }
  return ''
}

export function warningStepKey(w: TimingWarning): string | null {
  if (typeof w !== 'object' || !w) return null
  const key = w.step_key ?? w.key
  return typeof key === 'string' && key ? key : null
}

type State =
  | { status: 'idle' }
  /** Not available here (e.g. the org has workflows in preview mode): nothing is shown. */
  | { status: 'hidden' }
  | { status: 'loading'; data: TimelinePreview | null }
  | { status: 'ready'; data: TimelinePreview }
  | { status: 'failed'; data: TimelinePreview | null; error: string }

/**
 * "Example run" under the steps: the dates the timing works out to, from the definition
 * being edited (nothing is saved). The server plans it with the engine's own code: the
 * next 3 scheduled runs, or one run starting now when it is only started by hand. It
 * updates a moment after each edit and never holds up editing.
 */
export default function ExampleRun({
  orgId,
  definition,
  manualOnly,
  order,
  onOpenStep,
  shownElsewhere,
}: {
  orgId: string
  /** The definition being edited; null = nothing to work out yet (no steps). */
  definition: WorkflowDefinitionInput | null
  /** No schedule: one example run starting now. */
  manualOnly: boolean
  /** Step key → its number, for the order and the badges. */
  order: Map<string, number>
  onOpenStep: (key: string) => void
  /** Problems already shown on the steps themselves — not repeated here. */
  shownElsewhere?: Set<string>
}) {
  const [open, setOpen] = useState(true)
  const [state, setState] = useState<State>({ status: 'idle' })
  const [runIndex, setRunIndex] = useState(0)
  const [retryKey, setRetryKey] = useState(0)
  const body = definition ? JSON.stringify(definition) : null
  const lastData = useRef<TimelinePreview | null>(null)

  useEffect(() => {
    if (!orgId || !body) {
      setState({ status: 'idle' })
      return
    }
    setState({ status: 'loading', data: lastData.current })
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const data = await workflowsApi.previewTimeline(orgId, JSON.parse(body) as WorkflowDefinitionInput, ctrl.signal)
        if (ctrl.signal.aborted) return
        lastData.current = data
        setState({ status: 'ready', data })
      } catch (e) {
        if (ctrl.signal.aborted) return
        if (workflowErrorStatus(e) === 403) {
          setState({ status: 'hidden' })
          return
        }
        setState({ status: 'failed', data: lastData.current, error: workflowErrorMessage(e, 'The example run could not be worked out.') })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [orgId, body, retryKey])

  if (!definition || state.status === 'hidden') return null

  const data = state.status === 'idle' ? null : state.data
  const runs = data?.runs ?? []
  const idx = Math.min(runIndex, Math.max(0, runs.length - 1))
  const run = runs[idx]
  const nameOf = (key: string) => {
    const n = order.get(key)
    const title = runs.flatMap((r) => r.steps).find((s) => s.key === key)?.title?.trim()
    return `Step ${n ?? '?'}${title ? ` “${title}”` : ''}`
  }
  const warnings = (data?.warnings ?? []).filter((w) => {
    const text = warningText(w, nameOf)
    return !!text && !shownElsewhere?.has(text)
  })
  const steps = (run?.steps ?? []).slice().sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  const busy = state.status === 'loading'

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="example-run"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-[12px] hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      >
        <CalendarRange size={16} className="text-[#2563EB] shrink-0" />
        <span className="text-[15px] font-semibold text-[#0F172A] shrink-0">Example run</span>
        <span className="text-[13px] text-[#475569] truncate">When each step would start and be due.</span>
        {busy && data && (
          <span className="inline-flex items-center gap-1 text-[12px] text-[#475569] shrink-0" aria-live="polite">
            <Loader2 size={12} className="animate-spin" /> Updating
          </span>
        )}
        {warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#92400E] shrink-0">
            <AlertTriangle size={12} /> {warnings.length === 1 ? '1 thing to check' : `${warnings.length} things to check`}
          </span>
        )}
        <ChevronDown size={16} className={`ml-auto shrink-0 text-[#475569] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <Reveal open={open} id="example-run">
        <div className="px-4 pb-4 pt-3 border-t border-[#F1F5F9] flex flex-col gap-3">
          {state.status === 'failed' && (
            <div role="alert" className="flex flex-wrap items-start gap-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0 break-words">
                {state.error}
                {data ? ' The dates below are from before your last change.' : ''}
              </span>
              <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="inline-flex items-center gap-1 text-[13px] font-semibold underline shrink-0">
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          )}

          {!data && busy && (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}

          {data && runs.length === 0 && (
            <p className="text-sm text-[#475569]">
              {manualOnly ? 'No example could be worked out yet.' : 'The schedule has no upcoming runs, so there is nothing to show. Check when it starts and ends.'}
            </p>
          )}

          {run && (
            <>
              {runs.length > 1 && (
                <div role="tablist" aria-label="Example runs" className="flex flex-wrap gap-1.5">
                  {runs.map((r, i) => (
                    <button
                      key={`${r.starts_at}-${i}`}
                      type="button"
                      role="tab"
                      aria-selected={i === idx}
                      onClick={() => setRunIndex(i)}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-[8px] border text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                        i === idx ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'bg-white border-[#CBD5E1] text-[#334155] hover:border-[#2563EB] hover:text-[#1D4ED8]'
                      }`}
                    >
                      {fmtDayDateTime(r.starts_at)}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-sm text-[#1E293B]">
                {manualOnly ? 'If someone starts it on ' : 'If it runs on '}
                <span className="font-semibold text-[#0F172A]">{fmtDayDateTime(run.starts_at)}</span>:
              </p>
              <ol className={`flex flex-col divide-y divide-[#F1F5F9] rounded-[10px] border border-[#E2E8F0] transition-opacity duration-150 ${busy ? 'opacity-70' : ''}`}>
                {steps.map((s) => {
                  const n = order.get(s.key)
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => onOpenStep(s.key)}
                        className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 text-left hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]"
                      >
                        <span className="flex items-center gap-2 min-w-0 sm:w-[40%]">
                          <span className="min-w-[22px] h-[22px] px-1 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                            {n ?? '•'}
                          </span>
                          <span className="text-sm font-medium text-[#0F172A] truncate">{s.title || 'Untitled step'}</span>
                        </span>
                        <span className="text-[13px] text-[#334155] tabular-nums sm:flex-1 pl-[30px] sm:pl-0">{fmtSpan(s.planned_start_at, s.planned_due_at)}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          )}

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5">
              {warnings.map((w, i) => {
                const key = warningStepKey(w)
                return (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[#78350F]">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[#B45309]" />
                    <span className="flex-1 min-w-0 break-words">{warningText(w, nameOf)}</span>
                    {key && order.has(key) && (
                      <button type="button" onClick={() => onOpenStep(key)} className="font-semibold underline shrink-0">
                        Show step
                      </button>
                    )}
                  </li>
                )
              })}
              <li className="text-[12px] text-[#78350F] pl-[22px]">These don’t stop you saving.</li>
            </ul>
          )}

          <p className="text-[12px] text-[#475569]">
            Holidays and weekly offs are taken into account. In a real run, steps still wait for the steps before them to be done.
          </p>
        </div>
      </Reveal>
    </div>
  )
}
