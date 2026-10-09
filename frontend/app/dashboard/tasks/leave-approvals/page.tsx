'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, X, Inbox, RefreshCw, UserX } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { leaveApi } from '@/lib/api/leave'
import type { Leave } from '@/lib/types/leave'

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function dayCount(l: Pick<Leave, 'start_date' | 'end_date'>): number {
  const s = Date.UTC(...ymd(l.start_date))
  const e = Date.UTC(...ymd(l.end_date))
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}
function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m - 1, d]
}

function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(m)) return m.join(', ')
  return typeof m === 'string' && m ? m : fallback
}

type Status = 'loading' | 'ready' | 'failed' | 'not-approver'

/**
 * Leave Approvals — pending leave requests the signed-in person may decide.
 * Who approves is decided by the org's leave policy (Settings → Leave rules):
 * the applicant's manager and/or named approvers; org admins decide everything.
 * The server answers both "am I an approver?" and "which requests are mine".
 */
export default function LeaveApprovalsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()
  const { state: entState } = useEntitlements()
  const readOnly = entState('ecs') === 'preview'

  const [pending, setPending] = useState<Leave[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState<string | null>(null)

  // Reject dialog (replaces the old native prompt)
  const [rejectTarget, setRejectTarget] = useState<Leave | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const [elig, list] = await Promise.all([leaveApi.approvalEligibility(orgId), leaveApi.approvals(orgId)])
      // Someone who is not an approver today may still hold older requests (e.g. the
      // policy changed) — if the server hands them requests, show them.
      if (!elig.can_approve && list.length === 0) {
        setStatus('not-approver')
        return
      }
      setPending(list)
      setStatus('ready')
    } catch {
      setStatus('failed')
    }
  }, [orgId])

  useEffect(() => {
    setStatus('loading')
    load()
  }, [load])

  async function approve(l: Leave) {
    setBusy(l.id)
    try {
      await leaveApi.decide(orgId, l.id, { decision: 'approved' })
      addToast('Leave approved', 'success')
      // Update in place — drop just this row, no full reload flash.
      setPending((p) => p.filter((x) => x.id !== l.id))
    } catch (e) {
      addToast(errorMessage(e, 'Could not approve this request'), 'error')
      await load()
    } finally {
      setBusy(null)
    }
  }

  function openReject(l: Leave) {
    setRejectTarget(l)
    setRejectNote('')
    setRejectError(null)
  }

  function closeReject() {
    if (rejecting) return
    setRejectTarget(null)
  }

  async function confirmReject() {
    if (!rejectTarget) return
    setRejecting(true)
    setRejectError(null)
    try {
      await leaveApi.decide(orgId, rejectTarget.id, { decision: 'rejected', note: rejectNote.trim() || undefined })
      addToast('Leave rejected', 'success')
      const id = rejectTarget.id
      setPending((p) => p.filter((x) => x.id !== id))
      setRejectTarget(null)
    } catch (e) {
      setRejectError(errorMessage(e, 'Could not reject this request. Try again.'))
    } finally {
      setRejecting(false)
    }
  }

  const columns: ResponsiveColumn<Leave>[] = [
    {
      key: 'employee',
      header: 'Employee',
      primary: true,
      render: (l) => <span className="font-medium text-[#0F172A]">{l.applicant_name ?? 'Employee'}</span>,
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (l) => (
        <span className="text-[#1E293B] whitespace-nowrap">
          {fmt(l.start_date)} → {fmt(l.end_date)}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      align: 'right',
      render: (l) => <span className="text-[#1E293B] tabular-nums">{dayCount(l)}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      desktopHiddenBelow: 'lg',
      render: (l) =>
        l.reason ? (
          <span className="text-[#475569] break-words">{l.reason}</span>
        ) : (
          <span className="text-[#475569] italic">No reason given</span>
        ),
    },
    {
      key: 'requested',
      header: 'Requested',
      desktopHiddenBelow: 'xl',
      render: (l) => <span className="text-[#475569] whitespace-nowrap">{fmt(l.created_at)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      mobileLabel: '',
      align: 'right',
      render: (l) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy === l.id || readOnly}
            onClick={() => approve(l)}
            className="flex items-center gap-1 text-xs font-semibold text-white bg-[#16A34A] rounded-[6px] px-3 py-1.5 min-h-[36px] hover:bg-[#15803D] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
          >
            {busy === l.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
          </button>
          <button
            type="button"
            disabled={busy === l.id || readOnly}
            onClick={() => openReject(l)}
            className="flex items-center gap-1 text-xs font-semibold text-[#DC2626] border border-[#FECACA] bg-white rounded-[6px] px-3 py-1.5 min-h-[36px] hover:bg-[#FEF2F2] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:cursor-not-allowed transition-colors"
          >
            <X size={13} /> Reject
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] leading-tight">Leave Approvals</h1>
        <p className="text-sm text-[#475569] mt-0.5">Leave requests waiting for your decision.</p>
      </div>

      {status === 'loading' ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5 space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-[8px] bg-[#F1F5F9] animate-pulse" />)}
        </div>
      ) : status === 'failed' ? (
        <StateCard
          icon={<RefreshCw size={22} className="text-[#475569]" />}
          title="Leave requests could not be loaded"
          line="Check your connection and try again."
          action={
            <button
              type="button"
              onClick={() => { setStatus('loading'); load() }}
              className="px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
            >
              Retry
            </button>
          }
        />
      ) : status === 'not-approver' ? (
        <StateCard
          icon={<UserX size={22} className="text-[#475569]" />}
          title="You don't approve leave"
          line="Leave requests go to each person's manager or to the approvers named in your organization's leave rules. Your own leave is on your profile."
          action={
            <Link
              href="/dashboard/profile?tab=leave"
              className="px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
            >
              Go to my leave
            </Link>
          }
        />
      ) : pending.length === 0 ? (
        <StateCard
          icon={<Inbox size={22} className="text-[#475569]" />}
          title="No pending requests"
          line="Leave requests you can approve will appear here."
        />
      ) : (
        <ResponsiveTable columns={columns} rows={pending} rowKey={(l) => l.id} maxBodyHeight="min(65vh, 640px)" />
      )}

      <Modal isOpen={!!rejectTarget} onClose={closeReject} title="Reject leave" size="sm" closeOnEscape={!rejecting}>
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[#1E293B]">
              <span className="font-semibold">{rejectTarget.applicant_name ?? 'This employee'}</span> asked for leave from{' '}
              {fmt(rejectTarget.start_date)} to {fmt(rejectTarget.end_date)}. They will be told it was rejected, with your reason.
            </p>
            <div>
              <label htmlFor="reject-note" className="block text-sm font-medium text-[#374151] mb-1.5">
                Reason (optional)
              </label>
              <textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                maxLength={500}
                autoFocus
                placeholder="e.g. Quarter-end close needs full team"
                className="w-full px-3 py-2.5 border border-[#CBD5E1] rounded-[8px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none"
              />
            </div>
            {rejectError && (
              <div className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{rejectError}</div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={confirmReject}
                disabled={rejecting}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-[8px] transition-colors disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed"
              >
                {rejecting && <Loader2 size={15} className="animate-spin" />}
                Reject leave
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StateCard({ icon, title, line, action }: { icon: React.ReactNode; title: string; line: string; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center text-center gap-2 px-6 py-12">
      {icon}
      <p className="text-sm text-[#0F172A] font-semibold">{title}</p>
      <p className="text-sm text-[#475569] max-w-md">{line}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
