'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { RefreshCw, Ticket as TicketIcon, Link2, CheckSquare, Clock, AlertTriangle, PauseCircle, PlayCircle, XCircle, ArrowRightLeft, RotateCcw } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { Ticket, TicketComment, TicketActivityLog, TicketMasterConfig, TicketResolverGroup } from '@/lib/types/tickets'
import TicketStatusBadge from '@/components/tickets/TicketStatusBadge'
import TicketTypeBadge from '@/components/tickets/TicketTypeBadge'
import SLAIndicator from '@/components/tickets/SLAIndicator'
import ConfirmResolutionBanner from '@/components/tickets/ConfirmResolutionBanner'
import RatingWidget from '@/components/tickets/RatingWidget'
import TicketCommentThread from '@/components/tickets/TicketCommentThread'
import TicketActivityFeed from '@/components/tickets/TicketActivityFeed'
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import ReasonDialog from '@/components/tasks/ReasonDialog'
import StyledSelect from '@/components/ui/StyledSelect'
import { formatDate as formatDateToken, formatDateTime as formatDateTimeToken } from '@/lib/format'

type DetailTab = 'details' | 'activity'

function formatDateTime(d: string) {
  return formatDateTimeToken(d)
}

function formatDate(d: string) {
  return formatDateToken(d)
}

function timeDiff(from: string, to?: string) {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  return `${d}d ${h}h`
}

export default function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id ?? ''

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<TicketComment[]>([])
  const [logs, setLogs] = useState<TicketActivityLog[]>([])
  const [config, setConfig] = useState<TicketMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<DetailTab>('details')
  const [actionLoading, setActionLoading] = useState(false)
  const [proofUrl, setProofUrl] = useState('')
  const [showResolveForm, setShowResolveForm] = useState(false)
  const [showDeleteForm, setShowDeleteForm] = useState(false)

  // Lifecycle action panels (only one open at a time)
  const [actionPanel, setActionPanel] = useState<'hold' | 'reject' | 'transfer' | 'reopen' | null>(null)
  const [reason, setReason] = useState('')
  const [transferGroupId, setTransferGroupId] = useState('')
  const [resolverGroups, setResolverGroups] = useState<TicketResolverGroup[]>([])

  function openPanel(panel: 'hold' | 'reject' | 'transfer' | 'reopen') {
    setReason('')
    setTransferGroupId('')
    setActionPanel(panel)
    if (panel === 'transfer' && orgId) {
      ticketsApi.listResolverGroups(orgId)
        .then((g) => setResolverGroups(g.filter((x) => x.is_active)))
        .catch(() => setResolverGroups([]))
    }
  }
  function closePanel() {
    setActionPanel(null)
    setReason('')
    setTransferGroupId('')
  }

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [t, c, l, cfg] = await Promise.all([
        ticketsApi.getTicket(orgId, ticketId),
        ticketsApi.getComments(orgId, ticketId),
        ticketsApi.getLogs(orgId, ticketId),
        ticketsApi.getConfig(orgId),
      ])
      setTicket(t)
      setComments(c)
      setLogs(l)
      setConfig(cfg)
    } catch {
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [orgId, ticketId])

  useEffect(() => { load() }, [load])

  async function action(fn: () => Promise<void>) {
    setActionLoading(true)
    try {
      await fn()
      await load()
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-8 w-64 bg-surface-control rounded-xs" />
        <div className="h-64 bg-surface-control rounded-[12px]" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <TicketIcon size={36} className="text-muted mb-3" />
        <p className="text-text-primary font-medium">Ticket not found</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.back()}>Go back</Button>
      </div>
    )
  }

  const isRaiser = ticket.raised_by_user_id === userId
  const isAssignee = ticket.assigned_to_user_id === userId
  const isAdminOrHR = !!user?.is_admin
  const isClosed = ticket.status?.type === 'closed_resolved' || ticket.status?.type === 'closed_unresolved'
  const isResolved = ticket.status?.type === 'resolved'
  const canManage = isAssignee || isAdminOrHR

  const canHold = canManage && !ticket.on_hold && (ticket.status?.type === 'assigned' || ticket.status?.type === 'in_progress')
  const canResume = canManage && ticket.on_hold
  const canReject = canManage && !isClosed && !isResolved
  const canTransfer = canManage && !isClosed
  const canReopen = (isRaiser || isAssignee || isAdminOrHR) && (isResolved || isClosed)

  const showConfirmBanner =
    ticket.status?.type === 'resolved' &&
    ticket.requires_raiser_confirmation &&
    !ticket.raiser_confirmed_at &&
    isRaiser

  const showRating =
    !!ticket.closed_at &&
    (config?.enable_rating ?? false) &&
    isRaiser &&
    !ticket.rated_at

  const sla_due = new Date(ticket.sla_due_at)
  const sla_created = new Date(ticket.created_at)
  const slaTargetDays = ticket.sla_days

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/dashboard/tasks/tickets" />}>Tickets</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{ticket.ticket_number}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-body text-text-muted">{ticket.ticket_number}</span>
            <h1 className="text-section font-medium text-text-primary truncate">{ticket.title}</h1>
            {ticket.status && <TicketStatusBadge status={ticket.status} />}
            {ticket.on_hold && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium bg-warning-bg text-warning border border-warning-border">
                <PauseCircle size={11} /> On hold
              </span>
            )}
            {ticket.reopen_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium bg-surface-control text-text-secondary border border-border-light">
                <RotateCcw size={11} /> Reopened ×{ticket.reopen_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {ticket.ticket_type && <TicketTypeBadge type={ticket.ticket_type} />}
            {ticket.priority && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium"
                style={{ backgroundColor: ticket.priority.color + '22', color: ticket.priority.color, border: `1px solid ${ticket.priority.color}44` }}>
                {ticket.priority.label}
              </span>
            )}
            {ticket.category && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium"
                style={{ backgroundColor: ticket.category.color + '22', color: ticket.category.color, border: `1px solid ${ticket.category.color}44` }}>
                {ticket.category.name}
              </span>
            )}
            <SLAIndicator sla_due_at={ticket.sla_due_at} sla_breached={ticket.sla_breached} status_type={ticket.status?.type} created_at={ticket.created_at} />
            {ticket.response_breached ? (
              <span className="inline-flex items-center text-meta font-medium px-2 py-0.5 rounded-full bg-danger-bg text-danger border border-danger-border">
                Response breached
              </span>
            ) : ticket.responded_at ? (
              <span className="inline-flex items-center text-meta font-medium px-2 py-0.5 rounded-full bg-success-bg text-success border border-success-border">
                Responded {formatDate(ticket.responded_at)}
              </span>
            ) : ticket.response_due_at ? (
              <span className="inline-flex items-center text-meta font-medium px-2 py-0.5 rounded-full bg-warning-bg text-warning border border-warning-border">
                Response due {formatDate(ticket.response_due_at)}
              </span>
            ) : null}
          </div>
          <p className="text-meta text-text-muted mt-1">Raised {formatDateTime(ticket.created_at)}</p>
        </div>
        <Tooltip label="Refresh">
          <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh ticket" className="shrink-0">
            <RefreshCw size={16} />
          </Button>
        </Tooltip>
      </div>

      {/* Confirm resolution banner */}
      {showConfirmBanner && (
        <ConfirmResolutionBanner
          ticketNumber={ticket.ticket_number}
          loading={actionLoading}
          onConfirm={() => action(() => ticketsApi.confirm(orgId, ticketId).then(() => {}))}
          onClose={() => action(() => ticketsApi.close(orgId, ticketId, 'closed_unresolved').then(() => {}))}
        />
      )}

      {/* SLA breach warning */}
      {ticket.sla_breached && !isClosed && (
        <div className="flex items-center gap-3 p-4 bg-danger-bg border border-danger-border rounded-[10px]">
          <AlertTriangle size={18} className="text-danger shrink-0" />
          <p className="text-body font-medium text-danger">SLA has been breached. The assignee has been notified.</p>
        </div>
      )}

      {/* Two panels */}
      <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">
        {/* Left panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex border-b border-border-light">
            {(['details', 'activity'] as DetailTab[]).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`px-6 py-2.5 text-body font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-primary text-primary-text' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                {t === 'details' ? 'Details' : 'Activity Log'}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <div className="flex flex-col gap-6">
              {/* Description */}
              <div className="bg-white border border-border-light rounded-[12px] p-6">
                <p className="text-meta font-medium text-text-muted  mb-3">Description</p>
                {ticket.description ? (
                  <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
                ) : (
                  <p className="text-body text-text-muted italic">No description provided.</p>
                )}
              </div>

              {/* Checklist */}
              {(ticket.checklist ?? []).length > 0 && (
                <div className="bg-white border border-border-light rounded-[12px] p-6">
                  <p className="text-meta font-medium text-text-muted  mb-3 flex items-center gap-1.5">
                    <CheckSquare size={13} /> Checklist
                    <span className="ml-auto text-text-primary">
                      {ticket.checklist!.filter((c) => c.is_completed).length}/{ticket.checklist!.length}
                    </span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {ticket.checklist!.map((item) => (
                      <label key={item.id} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.is_completed}
                          onChange={() => action(() => ticketsApi.toggleChecklist(orgId, ticketId, item.id).then(() => {}))}
                          className="w-4 h-4 rounded-xs border-border text-primary-text"
                        />
                        <span className={`text-body ${item.is_completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>{item.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Proof */}
              {ticket.proof_required && (
                <div className="bg-white border border-border-light rounded-[12px] p-6">
                  <p className="text-meta font-medium text-text-muted  mb-3">Proof of resolution</p>
                  {ticket.proof_url ? (
                    <a href={ticket.proof_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-body text-primary-text hover:underline">
                      <Link2 size={14} /> View proof
                    </a>
                  ) : isAssignee ? (
                    <div className="flex gap-2">
                      <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="Paste proof URL..." className="flex-1 px-3 py-1.5 border border-border rounded-[6px] text-body focus:border-primary focus:outline-hidden" />
                      <Button disabled={!proofUrl.trim()} loading={actionLoading} loadingLabel="Submitting" onClick={() => action(() => ticketsApi.submitProof(orgId, ticketId, proofUrl).then(() => {}))}>
                        Submit
                      </Button>
                    </div>
                  ) : (
                    <p className="text-body text-text-muted">No proof attached yet.</p>
                  )}
                </div>
              )}

              {/* Resolution note */}
              {ticket.resolution_note && (
                <div className="bg-white border border-border-light rounded-[12px] p-6">
                  <p className="text-meta font-medium text-text-muted  mb-2">Resolution note</p>
                  <p className="text-body text-text-primary whitespace-pre-wrap">{ticket.resolution_note}</p>
                  {ticket.resolved_at && <p className="text-meta text-text-muted mt-2">Resolved {formatDateTime(ticket.resolved_at)}</p>}
                </div>
              )}

              {/* Rating */}
              {(showRating || ticket.rated_at) && (
                <div className="bg-white border border-border-light rounded-[12px] p-6">
                  <p className="text-meta font-medium text-text-muted  mb-3">Satisfaction rating</p>
                  <RatingWidget
                    existingRating={ticket.rating ?? undefined}
                    existingComment={ticket.rating_comment ?? undefined}
                    submitting={actionLoading}
                    onSubmit={(r, c) => action(() => ticketsApi.rate(orgId, ticketId, r, c).then(() => {}))}
                  />
                </div>
              )}

              {/* Comments */}
              <div className="bg-white border border-border-light rounded-[12px] p-6">
                <p className="text-meta font-medium text-text-muted  mb-4">Comments</p>
                <TicketCommentThread
                  comments={comments}
                  currentUserId={userId}
                  onAdd={async (body, replyTo, attachmentUrl) => {
                    await ticketsApi.addComment(orgId, ticketId, { body, reply_to_comment_id: replyTo, attachment_urls: attachmentUrl ? [attachmentUrl] : [] })
                    const updated = await ticketsApi.getComments(orgId, ticketId)
                    setComments(updated)
                  }}
                  onDelete={async (cid) => {
                    await ticketsApi.deleteComment(orgId, ticketId, cid)
                    const updated = await ticketsApi.getComments(orgId, ticketId)
                    setComments(updated)
                  }}
                />
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div className="bg-white border border-border-light rounded-[12px] p-6">
              <p className="text-meta font-medium text-text-muted  mb-4">Activity log</p>
              <TicketActivityFeed logs={logs} />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
          {/* Meta */}
          <div className="bg-white border border-border-light rounded-[12px] p-6 flex flex-col gap-4">
            <div>
              <p className="text-meta font-medium text-text-muted  mb-2">Raised by</p>
              <p className="text-body font-medium text-text-primary">{ticket.raised_by_user_id}</p>
              <p className="text-meta text-text-secondary">{formatDate(ticket.created_at)}</p>
            </div>
            <div>
              <p className="text-meta font-medium text-text-muted  mb-2">Assigned to</p>
              {ticket.assigned_to_user_id ? (
                <>
                  <p className="text-body font-medium text-text-primary">{ticket.assigned_to_user_id}</p>
                  {ticket.assigned_at && <p className="text-meta text-text-secondary">Since {formatDate(ticket.assigned_at)}</p>}
                </>
              ) : (
                <p className="text-body text-text-muted">Unassigned</p>
              )}
            </div>

            {/* SLA Details */}
            <div>
              <p className="text-meta font-medium text-text-muted  mb-2 flex items-center gap-1.5">
                <Clock size={11} /> SLA Details
              </p>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-meta">
                  <span className="text-text-secondary">Target</span>
                  <span className="font-medium text-text-primary">{slaTargetDays} days</span>
                </div>
                <div className="flex justify-between text-meta">
                  <span className="text-text-secondary">Created</span>
                  <span className="font-medium text-text-primary">{formatDate(ticket.created_at)}</span>
                </div>
                <div className="flex justify-between text-meta">
                  <span className="text-text-secondary">Due</span>
                  <span className={`font-medium ${ticket.sla_breached ? 'text-danger' : 'text-text-primary'}`}>
                    {formatDateTime(ticket.sla_due_at)}
                  </span>
                </div>
                <div className="flex justify-between text-meta">
                  <span className="text-text-secondary">Elapsed</span>
                  <span className="font-medium text-text-primary">{timeDiff(ticket.created_at, ticket.closed_at)}</span>
                </div>
                <div className="flex justify-between text-meta">
                  <span className="text-text-secondary">Status</span>
                  {ticket.sla_breached ? (
                    <span className="font-medium text-danger">Breached</span>
                  ) : (
                    <span className="font-medium text-success">Within SLA</span>
                  )}
                </div>
              </div>
            </div>

            {/* Escalations */}
            {(ticket.escalations ?? []).length > 0 && (
              <div>
                <p className="text-meta font-medium text-text-muted  mb-2">Escalation levels</p>
                <div className="flex flex-col gap-1.5">
                  {ticket.escalations!.map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-meta">
                      <span className="text-text-secondary">Level {e.level}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-primary font-medium">{e.escalate_to_user_id.slice(0, 8)}...</span>
                        {e.escalated_at ? (
                          <span className="text-danger font-medium">Escalated</span>
                        ) : (
                          <span className="text-success">Pending</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {isAssignee && ticket.status?.type === 'assigned' && (
              <Button className="w-full" loading={actionLoading} loadingLabel="Accepting"
                onClick={() => action(() => ticketsApi.accept(orgId, ticketId).then(() => {}))}>
                Accept ticket
              </Button>
            )}

            {isAssignee && ticket.status?.type === 'in_progress' && (
              <>
                <Button className="w-full" onClick={() => setShowResolveForm(true)}>
                  Mark resolved
                </Button>
                <Button variant="secondary" className="w-full" disabled={actionLoading}
                  onClick={() => action(() => ticketsApi.close(orgId, ticketId, 'closed_unresolved').then(() => {}))}>
                  Close as unresolved
                </Button>
              </>
            )}

            {/* Put on hold */}
            {canHold && (
              <Button variant="secondary" className="w-full" disabled={actionLoading} onClick={() => openPanel('hold')}>
                <PauseCircle size={16} /> Put on hold
              </Button>
            )}

            {/* Resume */}
            {canResume && (
              <Button className="w-full" loading={actionLoading} loadingLabel="Resuming"
                onClick={() => action(() => ticketsApi.resume(orgId, ticketId).then(() => {}))}>
                <PlayCircle size={16} /> Resume
              </Button>
            )}

            {/* Transfer */}
            {canTransfer && (
              <Button variant="secondary" className="w-full" disabled={actionLoading} onClick={() => openPanel('transfer')}>
                <ArrowRightLeft size={16} /> Transfer
              </Button>
            )}

            {/* Reject */}
            {canReject && (
              <Button variant="secondary" className="w-full" disabled={actionLoading} onClick={() => openPanel('reject')}>
                <XCircle size={16} /> Reject
              </Button>
            )}

            {/* Reopen */}
            {canReopen && (
              <Button variant="secondary" className="w-full" disabled={actionLoading} onClick={() => openPanel('reopen')}>
                <RotateCcw size={16} /> Reopen
              </Button>
            )}

            {isAdminOrHR && !isClosed && (
              <Button variant="danger" className="w-full" onClick={() => setShowDeleteForm(true)}>
                Delete ticket
              </Button>
            )}
          </div>

          {/* Reason prompts - one kit dialog each (kit 24, 11.3). */}
          <ReasonDialog
            open={showResolveForm}
            onCancel={() => setShowResolveForm(false)}
            onConfirm={(r) => action(() => ticketsApi.resolve(orgId, ticketId, r).then(() => setShowResolveForm(false)))}
            title="Mark ticket resolved"
            description="Tell the requester what was done. They will be asked to confirm."
            label="Resolution note"
            placeholder="What was done to resolve this?"
            confirmLabel="Mark resolved"
            loadingLabel="Saving"
            loading={actionLoading}
          />
          <ReasonDialog
            open={actionPanel === 'hold'}
            onCancel={closePanel}
            onConfirm={(r) => action(() => ticketsApi.hold(orgId, ticketId, r || undefined).then(() => closePanel()))}
            title="Put ticket on hold"
            label="Reason"
            placeholder="Why is this ticket on hold?"
            required={false}
            confirmLabel="Put on hold"
            loadingLabel="Saving"
            loading={actionLoading}
          />
          <ReasonDialog
            open={actionPanel === 'transfer'}
            onCancel={closePanel}
            onConfirm={(r) => action(() => ticketsApi.transfer(orgId, ticketId, { resolver_group_id: transferGroupId, reason: r || undefined }).then(() => closePanel()))}
            title="Transfer to resolver group"
            label="Reason"
            placeholder="Why is this being transferred?"
            required={false}
            confirmLabel="Transfer"
            loadingLabel="Transferring"
            loading={actionLoading}
            confirmDisabled={!transferGroupId}
          >
            <div className="flex flex-col gap-2">
              <Label required>Resolver group</Label>
              <StyledSelect
                value={transferGroupId}
                onChange={(v) => setTransferGroupId(v)}
                placeholder="Select a resolver group"
                options={[
                  { value: '', label: 'Select a resolver group' },
                  ...resolverGroups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>
          </ReasonDialog>
          <ReasonDialog
            open={actionPanel === 'reject'}
            onCancel={closePanel}
            onConfirm={(r) => action(() => ticketsApi.reject(orgId, ticketId, r).then(() => closePanel()))}
            title="Reject ticket"
            label="Reason for rejection"
            placeholder="Why is this ticket being rejected?"
            confirmLabel="Reject ticket"
            loadingLabel="Rejecting"
            destructive
            loading={actionLoading}
          />
          <ReasonDialog
            open={actionPanel === 'reopen'}
            onCancel={closePanel}
            onConfirm={(r) => action(() => ticketsApi.reopen(orgId, ticketId, r || undefined).then(() => closePanel()))}
            title="Reopen ticket"
            label="Reason"
            placeholder="Why is this ticket being reopened?"
            required={false}
            confirmLabel="Reopen ticket"
            loadingLabel="Reopening"
            loading={actionLoading}
          />
          <ReasonDialog
            open={showDeleteForm}
            onCancel={() => setShowDeleteForm(false)}
            onConfirm={(r) => action(async () => { await ticketsApi.deleteTicket(orgId, ticketId, r); router.push('/dashboard/tasks/tickets') })}
            title="Delete ticket"
            description="The ticket is removed for everyone. A reason is required."
            label="Reason for deletion"
            placeholder="Why is this ticket being deleted?"
            confirmLabel="Delete ticket"
            loadingLabel="Deleting"
            destructive
            loading={actionLoading}
          />
        </div>
      </div>
    </div>
  )
}
