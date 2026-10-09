'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, CalendarOff, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import DatePicker from '@/components/ui/DatePicker'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import LeaveStateBadge from '@/components/leave/LeaveStateBadge'
import { leaveApi } from '@/lib/api/leave'
import type { Leave } from '@/lib/types/leave'

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return typeof m === 'string' && m ? m : fallback
}

const cardCls = 'bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6'

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 pb-3 border-b border-[#F1F5F9] flex items-baseline gap-2 flex-wrap">
      <h2 className="text-base font-semibold text-[#0F172A]">{title}</h2>
      {subtitle && <span className="text-xs text-[#475569]">{subtitle}</span>}
    </div>
  )
}

/**
 * The signed-in person's own leave: apply / declare, and their history with
 * cancel and take-anyway. Lives on My Profile → Leave. Leave is per org member —
 * no employee profile is required (the backend keys it on the user).
 *
 * `readOnly` is for an org whose leave module is in preview: history is visible,
 * every change is disabled.
 */
export default function MyLeavePanel({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()

  const [leaves, setLeaves] = useState<Leave[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [declare, setDeclare] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Cancelling is irreversible, so it confirms in-app first.
  const [cancelTarget, setCancelTarget] = useState<Leave | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const todayStr = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      setLeaves(await leaveApi.mine(orgId))
      setStatus('ready')
    } catch {
      setStatus('failed')
    }
  }, [orgId])

  useEffect(() => {
    setStatus('loading')
    load()
  }, [load])

  async function apply() {
    if (!start || !end) { setFormError('Pick a start and an end date.'); return }
    if (end < start) { setFormError('The end date cannot be before the start date.'); return }
    setFormError(null)
    setSubmitting(true)
    try {
      await leaveApi.apply(orgId, { start_date: start, end_date: end, reason: reason.trim() || undefined, declare })
      setStart(''); setEnd(''); setReason(''); setDeclare(false)
      addToast(declare ? 'Leave declared' : 'Leave request sent', 'success')
      await load()
    } catch (e) {
      setFormError(errorMessage(e, 'Could not submit your leave. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function takeAnyway(l: Leave) {
    setBusyId(l.id)
    try {
      await leaveApi.override(orgId, l.id)
      addToast('Leave taken anyway', 'success')
      await load()
    } catch (e) {
      addToast(errorMessage(e, 'Could not update this leave'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    setCancelError(null)
    try {
      await leaveApi.cancel(orgId, cancelTarget.id)
      addToast('Leave cancelled', 'success')
      setCancelTarget(null)
      await load()
    } catch (e) {
      setCancelError(errorMessage(e, 'Could not cancel this leave. Try again.'))
    } finally {
      setCancelling(false)
    }
  }

  const inputCls =
    'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-[10px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none bg-white disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]'

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
      {/* Apply */}
      <div className={`${cardCls} xl:col-span-2`}>
        <CardHeader title="Apply for leave" subtitle={readOnly ? 'Preview — changes are disabled' : undefined} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">From</label>
            <DatePicker value={start} onChange={setStart} min={todayStr} placeholder="Start date" disabled={readOnly} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">To</label>
            <DatePicker value={end} onChange={setEnd} min={start || todayStr} placeholder="End date" disabled={readOnly} />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="leave-reason" className="block text-sm font-medium text-[#374151] mb-1.5">Reason (optional)</label>
          <input
            id="leave-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Family function"
            disabled={readOnly}
            className={inputCls}
          />
        </div>
        <label className={`flex items-start gap-2 mt-3 ${readOnly ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={declare}
            onChange={(e) => setDeclare(e.target.checked)}
            disabled={readOnly}
            className="accent-[#2563EB] mt-1"
          />
          <span className="text-sm text-[#1E293B]">Declare as unplanned leave (e.g. sick) — book now without waiting for approval</span>
        </label>
        {formError && (
          <div className="mt-4 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{formError}</div>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={submitting || readOnly}
          className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-[10px] min-h-[44px] sm:min-h-0 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {submitting ? 'Submitting…' : declare ? 'Declare leave' : 'Submit request'}
        </button>
      </div>

      {/* My leave list */}
      <div className={`${cardCls} xl:col-span-3`}>
        <CardHeader title="My leave" />
        {status === 'loading' ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-[60px] rounded-[8px] bg-[#F1F5F9] animate-pulse" />)}
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <p className="text-sm text-[#0F172A] font-medium">Your leave could not be loaded</p>
            <p className="text-xs text-[#475569]">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => { setStatus('loading'); load() }}
              className="mt-2 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : leaves.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <CalendarOff size={22} className="text-[#475569]" />
            <p className="text-sm text-[#0F172A] font-medium">No leave yet</p>
            <p className="text-xs text-[#475569]">Leave you apply for or declare will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {leaves.map((l) => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[#0F172A]">{fmt(l.start_date)} → {fmt(l.end_date)}</span>
                    <LeaveStateBadge leave={l} />
                  </div>
                  {l.reason && <p className="text-xs text-[#475569] mt-1 break-words">{l.reason}</p>}
                  {l.state === 'rejected' && l.decision_note && (
                    <p className="text-xs text-[#DC2626] mt-1 break-words">Reason: {l.decision_note}</p>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-2 shrink-0">
                    {l.state === 'rejected' && !l.overridden && (
                      <button
                        type="button"
                        disabled={busyId === l.id}
                        onClick={() => takeAnyway(l)}
                        className="flex items-center gap-1 text-xs font-semibold text-[#7C3AED] border border-[#DDD6FE] bg-[#F5F3FF] rounded-[6px] px-2.5 py-1.5 min-h-[36px] hover:bg-[#EDE9FE] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] transition-colors"
                      >
                        {busyId === l.id && <Loader2 size={12} className="animate-spin" />}
                        Take anyway
                      </button>
                    )}
                    {l.state !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => { setCancelError(null); setCancelTarget(l) }}
                        className="text-xs font-semibold text-[#475569] border border-[#CBD5E1] bg-white rounded-[6px] px-2.5 py-1.5 min-h-[36px] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
                      >
                        Cancel leave
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        danger
        title="Cancel this leave?"
        message={
          cancelTarget
            ? `Your leave from ${fmt(cancelTarget.start_date)} to ${fmt(cancelTarget.end_date)} will be cancelled and you will show as available on those days. This cannot be undone.`
            : undefined
        }
        confirmLabel="Cancel leave"
        cancelLabel="Keep leave"
        loading={cancelling}
        error={cancelError}
        onConfirm={confirmCancel}
        onCancel={() => { if (!cancelling) setCancelTarget(null) }}
      />
    </div>
  )
}
