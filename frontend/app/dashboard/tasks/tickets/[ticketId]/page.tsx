'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Ticket as TicketIcon, Link2, CheckSquare, Clock, AlertTriangle, PauseCircle, PlayCircle, XCircle, ArrowRightLeft, RotateCcw } from 'lucide-react'
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
import StyledSelect from '@/components/ui/StyledSelect'

type DetailTab = 'details' | 'activity'

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [resolutionNote, setResolutionNote] = useState('')
  const [showResolveForm, setShowResolveForm] = useState(false)
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')

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
        <div className="h-8 w-64 bg-[#F1F5F9] rounded-xs" />
        <div className="h-64 bg-[#F1F5F9] rounded-[12px]" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <TicketIcon size={36} className="text-[#CBD5E1] mb-3" />
        <p className="text-[#0F172A] font-semibold">Ticket not found</p>
        <button type="button" onClick={() => router.back()} className="mt-4 text-sm text-[#2563EB] hover:underline">Go back</button>
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
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <button type="button" onClick={() => router.back()} className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] transition-colors shrink-0 mt-1">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-[#94A3B8]">{ticket.ticket_number}</span>
            <h1 className="text-[20px] font-bold text-[#0F172A] truncate">{ticket.title}</h1>
            {ticket.status && <TicketStatusBadge status={ticket.status} />}
            {ticket.on_hold && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#FEF9C3] text-[#CA8A04] border border-[#FDE68A]">
                <PauseCircle size={11} /> On hold
              </span>
            )}
            {ticket.reopen_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]">
                <RotateCcw size={11} /> Reopened ×{ticket.reopen_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {ticket.ticket_type && <TicketTypeBadge type={ticket.ticket_type} />}
            {ticket.priority && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: ticket.priority.color + '22', color: ticket.priority.color, border: `1px solid ${ticket.priority.color}44` }}>
                {ticket.priority.label}
              </span>
            )}
            {ticket.category && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: ticket.category.color + '22', color: ticket.category.color, border: `1px solid ${ticket.category.color}44` }}>
                {ticket.category.name}
              </span>
            )}
            <SLAIndicator sla_due_at={ticket.sla_due_at} sla_breached={ticket.sla_breached} status_type={ticket.status?.type} created_at={ticket.created_at} />
            {ticket.response_breached ? (
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]">
                Response breached
              </span>
            ) : ticket.responded_at ? (
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]">
                Responded {formatDate(ticket.responded_at)}
              </span>
            ) : ticket.response_due_at ? (
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF9C3] text-[#D97706] border border-[#FDE68A]">
                Response due {formatDate(ticket.response_due_at)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">Raised {formatDateTime(ticket.created_at)}</p>
        </div>
        <button type="button" onClick={load} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[7px] text-sm font-medium text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
          <RefreshCw size={14} />
        </button>
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
        <div className="flex items-center gap-3 p-4 bg-[#FEE2E2] border border-[#FECACA] rounded-[10px]">
          <AlertTriangle size={18} className="text-[#DC2626] shrink-0" />
          <p className="text-sm font-medium text-[#DC2626]">SLA has been breached. The assignee has been notified.</p>
        </div>
      )}

      {/* Two panels */}
      <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">
        {/* Left panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex border-b border-[#E2E8F0]">
            {(['details', 'activity'] as DetailTab[]).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`px-5 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${tab === t ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#475569] hover:text-[#0F172A]'}`}>
                {t === 'details' ? 'Details' : 'Activity Log'}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <div className="flex flex-col gap-5">
              {/* Description */}
              <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Description</p>
                {ticket.description ? (
                  <p className="text-sm text-[#1E293B] whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
                ) : (
                  <p className="text-sm text-[#94A3B8] italic">No description provided.</p>
                )}
              </div>

              {/* Checklist */}
              {(ticket.checklist ?? []).length > 0 && (
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <CheckSquare size={13} /> Checklist
                    <span className="ml-auto text-[#0F172A]">
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
                          className="w-4 h-4 rounded-xs border-[#CBD5E1] text-[#2563EB]"
                        />
                        <span className={`text-sm ${item.is_completed ? 'line-through text-[#94A3B8]' : 'text-[#0F172A]'}`}>{item.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Proof */}
              {ticket.proof_required && (
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Proof of Resolution</p>
                  {ticket.proof_url ? (
                    <a href={ticket.proof_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-[#2563EB] hover:underline">
                      <Link2 size={14} /> View proof
                    </a>
                  ) : isAssignee ? (
                    <div className="flex gap-2">
                      <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="Paste proof URL..." className="flex-1 px-3 py-1.5 border border-[#CBD5E1] rounded-[6px] text-sm focus:border-[#2563EB] focus:outline-hidden" />
                      <button type="button" disabled={!proofUrl.trim() || actionLoading} onClick={() => action(() => ticketsApi.submitProof(orgId, ticketId, proofUrl).then(() => {}))}
                        className="px-3 py-1.5 rounded-[6px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60">
                        Submit
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-[#94A3B8]">No proof attached yet.</p>
                  )}
                </div>
              )}

              {/* Resolution note */}
              {ticket.resolution_note && (
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Resolution Note</p>
                  <p className="text-sm text-[#1E293B] whitespace-pre-wrap">{ticket.resolution_note}</p>
                  {ticket.resolved_at && <p className="text-xs text-[#94A3B8] mt-2">Resolved {formatDateTime(ticket.resolved_at)}</p>}
                </div>
              )}

              {/* Rating */}
              {(showRating || ticket.rated_at) && (
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Satisfaction Rating</p>
                  <RatingWidget
                    existingRating={ticket.rating ?? undefined}
                    existingComment={ticket.rating_comment ?? undefined}
                    submitting={actionLoading}
                    onSubmit={(r, c) => action(() => ticketsApi.rate(orgId, ticketId, r, c).then(() => {}))}
                  />
                </div>
              )}

              {/* Comments */}
              <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-4">Comments</p>
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
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5">
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-4">Activity Log</p>
              <TicketActivityFeed logs={logs} />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-4">
          {/* Meta */}
          <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Raised By</p>
              <p className="text-sm font-medium text-[#0F172A]">{ticket.raised_by_user_id}</p>
              <p className="text-xs text-[#475569]">{formatDate(ticket.created_at)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Assigned To</p>
              {ticket.assigned_to_user_id ? (
                <>
                  <p className="text-sm font-medium text-[#0F172A]">{ticket.assigned_to_user_id}</p>
                  {ticket.assigned_at && <p className="text-xs text-[#475569]">Since {formatDate(ticket.assigned_at)}</p>}
                </>
              ) : (
                <p className="text-sm text-[#94A3B8]">Unassigned</p>
              )}
            </div>

            {/* SLA Details */}
            <div>
              <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock size={11} /> SLA Details
              </p>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Target</span>
                  <span className="font-medium text-[#0F172A]">{slaTargetDays} days</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Created</span>
                  <span className="font-medium text-[#0F172A]">{formatDate(ticket.created_at)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Due</span>
                  <span className={`font-medium ${ticket.sla_breached ? 'text-[#DC2626]' : 'text-[#0F172A]'}`}>
                    {formatDateTime(ticket.sla_due_at)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Elapsed</span>
                  <span className="font-medium text-[#0F172A]">{timeDiff(ticket.created_at, ticket.closed_at)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Status</span>
                  {ticket.sla_breached ? (
                    <span className="font-semibold text-[#DC2626]">Breached</span>
                  ) : (
                    <span className="font-semibold text-[#16A34A]">Within SLA</span>
                  )}
                </div>
              </div>
            </div>

            {/* Escalations */}
            {(ticket.escalations ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Escalation Levels</p>
                <div className="flex flex-col gap-1.5">
                  {ticket.escalations!.map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-xs">
                      <span className="text-[#475569]">Level {e.level}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#0F172A] font-medium">{e.escalate_to_user_id.slice(0, 8)}...</span>
                        {e.escalated_at ? (
                          <span className="text-[#DC2626] font-semibold">Escalated</span>
                        ) : (
                          <span className="text-[#16A34A]">Pending</span>
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
              <button type="button" disabled={actionLoading} onClick={() => action(() => ticketsApi.accept(orgId, ticketId).then(() => {}))}
                className="w-full py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">
                Accept Ticket
              </button>
            )}

            {isAssignee && ticket.status?.type === 'in_progress' && (
              <>
                {!showResolveForm ? (
                  <button type="button" onClick={() => setShowResolveForm(true)}
                    className="w-full py-2 rounded-[8px] text-sm font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] transition-colors">
                    Mark Resolved
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px]">
                    <textarea value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={3} placeholder="Resolution note (required)..." className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[6px] text-sm resize-none focus:border-[#16A34A] focus:outline-hidden" />
                    <div className="flex gap-2">
                      <button type="button" disabled={!resolutionNote.trim() || actionLoading}
                        onClick={() => action(() => ticketsApi.resolve(orgId, ticketId, resolutionNote).then(() => setShowResolveForm(false)))}
                        className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60">
                        Confirm
                      </button>
                      <button type="button" onClick={() => setShowResolveForm(false)} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <button type="button" disabled={actionLoading} onClick={() => action(() => ticketsApi.close(orgId, ticketId, 'closed_unresolved').then(() => {}))}
                  className="w-full py-2 rounded-[8px] text-sm font-semibold text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] disabled:opacity-60 transition-colors">
                  Close — Unresolved
                </button>
              </>
            )}

            {/* Put on hold */}
            {canHold && (
              actionPanel === 'hold' ? (
                <div className="flex flex-col gap-2 p-3 bg-[#FEFCE8] border border-[#FDE68A] rounded-[10px]">
                  <p className="text-xs font-semibold text-[#0F172A]">Put ticket on hold</p>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)..." className="w-full px-2 py-1.5 border border-[#FDE68A] rounded-[6px] text-sm resize-none focus:border-[#CA8A04] focus:outline-hidden bg-white" />
                  <div className="flex gap-2">
                    <button type="button" disabled={actionLoading}
                      onClick={() => action(() => ticketsApi.hold(orgId, ticketId, reason.trim() || undefined).then(() => closePanel()))}
                      className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#CA8A04] hover:bg-[#A16207] disabled:opacity-60">
                      Put on hold
                    </button>
                    <button type="button" onClick={closePanel} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={actionLoading} onClick={() => openPanel('hold')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-sm font-semibold text-[#CA8A04] border border-[#FDE68A] hover:bg-[#FEFCE8] disabled:opacity-60 transition-colors">
                  <PauseCircle size={15} /> Put on Hold
                </button>
              )
            )}

            {/* Resume */}
            {canResume && (
              <button type="button" disabled={actionLoading} onClick={() => action(() => ticketsApi.resume(orgId, ticketId).then(() => {}))}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">
                <PlayCircle size={15} /> Resume
              </button>
            )}

            {/* Transfer */}
            {canTransfer && (
              actionPanel === 'transfer' ? (
                <div className="flex flex-col gap-2 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px]">
                  <p className="text-xs font-semibold text-[#0F172A]">Transfer to resolver group</p>
                  <StyledSelect
                    value={transferGroupId}
                    onChange={(v) => setTransferGroupId(v)}
                    placeholder="Select a resolver group..."
                    options={[
                      { value: '', label: 'Select a resolver group...' },
                      ...resolverGroups.map((g) => ({ value: g.id, label: g.name })),
                    ]}
                  />
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)..." className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[6px] text-sm resize-none focus:border-[#2563EB] focus:outline-hidden bg-white" />
                  <div className="flex gap-2">
                    <button type="button" disabled={!transferGroupId || actionLoading}
                      onClick={() => action(() => ticketsApi.transfer(orgId, ticketId, { resolver_group_id: transferGroupId, reason: reason.trim() || undefined }).then(() => closePanel()))}
                      className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]">
                      Transfer
                    </button>
                    <button type="button" onClick={closePanel} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={actionLoading} onClick={() => openPanel('transfer')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-60 transition-colors">
                  <ArrowRightLeft size={15} /> Transfer
                </button>
              )
            )}

            {/* Reject */}
            {canReject && (
              actionPanel === 'reject' ? (
                <div className="flex flex-col gap-2 p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[10px]">
                  <p className="text-xs font-semibold text-[#0F172A]">Reject ticket</p>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for rejection (required)..." className="w-full px-2 py-1.5 border border-[#FECACA] rounded-[6px] text-sm resize-none focus:border-[#DC2626] focus:outline-hidden bg-white" />
                  <div className="flex gap-2">
                    <button type="button" disabled={!reason.trim() || actionLoading}
                      onClick={() => action(() => ticketsApi.reject(orgId, ticketId, reason.trim()).then(() => closePanel()))}
                      className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]">
                      Reject
                    </button>
                    <button type="button" onClick={closePanel} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={actionLoading} onClick={() => openPanel('reject')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-sm font-semibold text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] disabled:opacity-60 transition-colors">
                  <XCircle size={15} /> Reject
                </button>
              )
            )}

            {/* Reopen */}
            {canReopen && (
              actionPanel === 'reopen' ? (
                <div className="flex flex-col gap-2 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px]">
                  <p className="text-xs font-semibold text-[#0F172A]">Reopen ticket</p>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)..." className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[6px] text-sm resize-none focus:border-[#2563EB] focus:outline-hidden bg-white" />
                  <div className="flex gap-2">
                    <button type="button" disabled={actionLoading}
                      onClick={() => action(() => ticketsApi.reopen(orgId, ticketId, reason.trim() || undefined).then(() => closePanel()))}
                      className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60">
                      Reopen
                    </button>
                    <button type="button" onClick={closePanel} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={actionLoading} onClick={() => openPanel('reopen')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-60 transition-colors">
                  <RotateCcw size={15} /> Reopen
                </button>
              )
            )}

            {isAdminOrHR && !isClosed && (
              <>
                {!showDeleteForm ? (
                  <button type="button" onClick={() => setShowDeleteForm(true)} className="w-full py-2 rounded-[8px] text-sm font-semibold text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors">
                    Delete Ticket
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[10px]">
                    <textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} rows={2} placeholder="Reason for deletion (required)..." className="w-full px-2 py-1.5 border border-[#FECACA] rounded-[6px] text-sm resize-none focus:border-[#DC2626] focus:outline-hidden" />
                    <div className="flex gap-2">
                      <button type="button" disabled={!deleteReason.trim() || actionLoading}
                        onClick={() => action(async () => { await ticketsApi.deleteTicket(orgId, ticketId, deleteReason); router.push('/dashboard/tasks/tickets') })}
                        className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-60">
                        Confirm Delete
                      </button>
                      <button type="button" onClick={() => setShowDeleteForm(false)} className="flex-1 py-1.5 rounded-[6px] text-xs font-semibold text-[#475569] border border-[#E2E8F0] hover:bg-[#F1F5F9]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
