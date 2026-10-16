'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, X, Inbox, RefreshCw, UserX } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { toast } from '@/components/ui/sonner'
import Modal from '@/components/ui/Modal'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { leaveApi } from '@/lib/api/leave'
import type { Leave } from '@/lib/types/leave'
import { formatDate } from '@/lib/format'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'

function fmt(iso: string): string {
  return formatDate(iso)
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
      toast.success('Leave approved')
      // Update in place — drop just this row, no full reload flash.
      setPending((p) => p.filter((x) => x.id !== l.id))
    } catch (e) {
      toast.error(errorMessage(e, 'Could not approve this request'))
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
      toast.success('Leave rejected')
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
      render: (l) => <span className="font-medium text-text-primary">{l.applicant_name ?? 'Employee'}</span>,
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (l) => (
        <span className="text-text-primary whitespace-nowrap">
          {fmt(l.start_date)} → {fmt(l.end_date)}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      align: 'right',
      render: (l) => <span className="text-text-primary tabular-nums">{dayCount(l)}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      desktopHiddenBelow: 'lg',
      render: (l) =>
        l.reason ? (
          <span className="text-text-secondary wrap-break-word">{l.reason}</span>
        ) : (
          <span className="text-text-secondary italic">No reason given</span>
        ),
    },
    {
      key: 'requested',
      header: 'Requested',
      desktopHiddenBelow: 'xl',
      render: (l) => <span className="text-text-secondary whitespace-nowrap">{fmt(l.created_at)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      mobileLabel: '',
      align: 'right',
      render: (l) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={readOnly}
            loading={busy === l.id}
            loadingLabel="Approving"
            onClick={() => approve(l)}
          >
            <Check size={13} /> Approve
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy === l.id || readOnly}
            onClick={() => openReject(l)}
          >
            <X size={13} /> Reject
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave Approvals"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta="Leave requests waiting for your decision."
      />

      {status === 'loading' ? (
        <div className="bg-surface border border-border-light rounded-card p-4 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-control" />)}
        </div>
      ) : status === 'failed' ? (
        <StateCard
          icon={<RefreshCw size={22} className="text-text-secondary" />}
          title="Leave requests could not be loaded"
          line="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => { setStatus('loading'); load() }}>
              Retry
            </Button>
          }
        />
      ) : status === 'not-approver' ? (
        <StateCard
          icon={<UserX size={22} className="text-text-secondary" />}
          title="You don't approve leave"
          line="Leave requests go to each person's manager or to the approvers named in your organization's leave rules. Your own leave is on your profile."
          action={
            <Link
              href="/dashboard/profile?tab=leave"
              className="px-4 py-2 text-body font-medium text-primary-text border-2 border-primary rounded-control hover:bg-primary-subtle transition-colors"
            >
              Go to my leave
            </Link>
          }
        />
      ) : pending.length === 0 ? (
        <StateCard
          icon={<Inbox size={22} className="text-text-secondary" />}
          title="No pending requests"
          line="Leave requests you can approve will appear here."
        />
      ) : (
        <ResponsiveTable columns={columns} rows={pending} rowKey={(l) => l.id} maxBodyHeight="min(65vh, 640px)" />
      )}

      <Modal isOpen={!!rejectTarget} onClose={closeReject} title="Reject leave" size="sm" closeOnEscape={!rejecting}>
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-body text-text-primary">
              <span className="font-medium">{rejectTarget.applicant_name ?? 'This employee'}</span> asked for leave from{' '}
              {fmt(rejectTarget.start_date)} to {fmt(rejectTarget.end_date)}. They will be told it was rejected, with your reason.
            </p>
            <div>
              <Label htmlFor="reject-note" className="mb-1.5">
                Reason (optional)
              </Label>
              <Textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                maxLength={500}
                autoFocus
                placeholder="e.g. Quarter-end close needs full team"
              />
            </div>
            {rejectError && (
              <div className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-body text-danger">{rejectError}</div>
            )}
            <div className="flex justify-end">
              <Button
                variant="danger"
                className="w-full sm:w-auto"
                onClick={confirmReject}
                loading={rejecting}
                loadingLabel="Rejecting"
              >
                Reject leave
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StateCard({ icon, title, line, action }: { icon: React.ReactNode; title: string; line: string; action?: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center text-center gap-2 px-6 py-12">
      {icon}
      <p className="text-body text-text-primary font-medium">{title}</p>
      <p className="text-body text-text-secondary max-w-md">{line}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
