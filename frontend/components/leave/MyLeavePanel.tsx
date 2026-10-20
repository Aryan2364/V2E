'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, CalendarOff, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { toast } from '@/components/ui/sonner'
import DatePicker from '@/components/ui/DatePicker'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import LeaveStateBadge from '@/components/leave/LeaveStateBadge'
import { leaveApi } from '@/lib/api/leave'
import type { Leave } from '@/lib/types/leave'
import { formatDate } from '@/lib/format'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'

function fmt(iso: string): string {
  return formatDate(new Date(iso))
}

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return typeof m === 'string' && m ? m : fallback
}

const cardCls = 'bg-surface border border-border-light rounded-card shadow-card p-6'

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 pb-3 border-b border-border-light flex items-baseline gap-2 flex-wrap">
      <h2 className="text-card-heading font-medium text-text-primary">{title}</h2>
      {subtitle && <span className="text-meta text-text-secondary">{subtitle}</span>}
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

  const [leaves, setLeaves] = useState<Leave[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [declare, setDeclare] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dateErrors, setDateErrors] = useState<{ start?: string; end?: string }>({})

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
    if (!start || !end || end < start) {
      setDateErrors({
        start: start ? undefined : 'Choose the first day of your leave.',
        end: !end ? 'Choose the last day of your leave.' : end < start ? 'Choose an end date on or after the start date.' : undefined,
      })
      requestAnimationFrame(() => document.getElementById(start ? 'leave-end' : 'leave-start')?.focus())
      return
    }
    setDateErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      await leaveApi.apply(orgId, { start_date: start, end_date: end, reason: reason.trim() || undefined, declare })
      setStart(''); setEnd(''); setReason(''); setDeclare(false)
      toast.success(declare ? 'Leave declared' : 'Leave request sent')
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
      toast.success('Leave taken anyway')
      await load()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update this leave. Try again.'))
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
      toast.success('Leave cancelled')
      setCancelTarget(null)
      await load()
    } catch (e) {
      setCancelError(errorMessage(e, 'Could not cancel this leave. Try again.'))
    } finally {
      setCancelling(false)
    }
  }

  const inputCls =
    'w-full border border-border rounded-lg px-3 py-[10px] text-card-heading sm:text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary focus:outline-hidden bg-surface disabled:bg-surface-sunken disabled:text-text-muted'

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
      {/* Apply */}
      <div className={`${cardCls} xl:col-span-2`}>
        <CardHeader title="Apply for leave" subtitle={readOnly ? 'Preview — changes are disabled' : undefined} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2" htmlFor="leave-start" required>From</Label>
            <DatePicker id="leave-start" invalid={!!dateErrors.start} value={start} onChange={(v) => { setStart(v); setDateErrors((p) => ({ ...p, start: undefined })) }} min={todayStr} placeholder="Select date" disabled={readOnly} />
            <InlineFieldError>{dateErrors.start}</InlineFieldError>
          </div>
          <div>
            <Label className="mb-2" htmlFor="leave-end" required>To</Label>
            <DatePicker id="leave-end" invalid={!!dateErrors.end} value={end} onChange={(v) => { setEnd(v); setDateErrors((p) => ({ ...p, end: undefined })) }} min={start || todayStr} placeholder="Select date" disabled={readOnly} />
            <InlineFieldError>{dateErrors.end}</InlineFieldError>
          </div>
        </div>
        <div className="mt-4">
          <Label htmlFor="leave-reason" className="mb-2">Reason</Label>
          <input
            id="leave-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example, Family function"
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
            className="accent-primary mt-1"
          />
          <span className="text-body text-text-primary">Declare as unplanned leave, such as sick leave. It is booked now without waiting for approval.</span>
        </label>
        {formError && (
          <div className="mt-4 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body text-danger">{formError}</div>
        )}
        <Button type="button" onClick={apply} disabled={submitting || readOnly} loading={submitting} loadingLabel="Sending" className="mt-4 w-full sm:w-auto">
          <Plus size={15} />
          {declare ? 'Declare leave' : 'Send leave request'}
        </Button>
      </div>

      {/* My leave list */}
      <div className={`${cardCls} xl:col-span-3`}>
        <CardHeader title="My leave" />
        {status === 'loading' ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-[60px] rounded-lg bg-surface-control animate-pulse" />)}
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <p className="text-body text-text-primary font-medium">Your leave could not be loaded</p>
            <p className="text-meta text-text-secondary">Check your connection and try again.</p>
            <Button type="button" onClick={() => { setStatus('loading'); load() }} variant="secondary">
              <RefreshCw size={14} /> Retry
            </Button>
          </div>
        ) : leaves.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <CalendarOff size={22} className="text-text-secondary" />
            <p className="text-body text-text-primary font-medium">No leave yet</p>
            <p className="text-meta text-text-secondary">Leave you apply for or declare will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {leaves.map((l) => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 rounded-lg border border-border-light bg-surface-sunken">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body font-medium text-text-primary">{fmt(l.start_date)} → {fmt(l.end_date)}</span>
                    <LeaveStateBadge leave={l} />
                  </div>
                  {l.reason && <p className="text-meta text-text-secondary mt-1 wrap-break-word">{l.reason}</p>}
                  {l.state === 'rejected' && l.decision_note && (
                    <p className="text-meta text-danger mt-1 wrap-break-word">Reason: {l.decision_note}</p>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-2 shrink-0">
                    {l.state === 'rejected' && !l.overridden && (
                      <Button
                        type="button"
                        disabled={busyId === l.id}
                        onClick={() => takeAnyway(l)}
                        variant="secondary"
                        size="sm"
                      >
                        {busyId === l.id && <Loader2 size={12} className="animate-spin" />}
                        Take anyway
                      </Button>
                    )}
                    {l.state !== 'cancelled' && (
                      <Button
                        type="button"
                        onClick={() => { setCancelError(null); setCancelTarget(l) }}
                        variant="secondary"
                        size="sm"
                      >
                        Cancel leave
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(next) => { if (!next && !cancelling) setCancelTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this leave?</AlertDialogTitle>
            {cancelTarget ? (
              <AlertDialogDescription>
                Your leave from {fmt(cancelTarget.start_date)} to {fmt(cancelTarget.end_date)} will be
                cancelled and you will show as available on those days. This cannot be undone.
              </AlertDialogDescription>
            ) : null}
            {cancelError ? (
              <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body text-danger">
                {cancelError}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep leave</AlertDialogCancel>
            <AlertDialogAction variant="danger" disabled={cancelling} onClick={confirmCancel}>
              {cancelling ? <Loader2 size={15} className="animate-spin" /> : null}
              Cancel leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
