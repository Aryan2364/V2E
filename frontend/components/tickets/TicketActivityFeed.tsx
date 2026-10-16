'use client'

import type { TicketActivityLog, TicketActivityAction } from '@/lib/types/tickets'

interface Props {
  logs: TicketActivityLog[]
}

const ACTION_CONFIG: Record<TicketActivityAction, { label: string; color: string; bg: string }> = {
  created:                { label: 'Ticket created',               color: '#2563EB', bg: '#EFF6FF' },
  assigned:               { label: 'Ticket assigned',              color: '#0891B2', bg: '#E0F2FE' },
  reassigned:             { label: 'Ticket reassigned',            color: '#7C3AED', bg: '#EDE9FE' },
  status_changed:         { label: 'Status changed',               color: '#475569', bg: '#F1F5F9' },
  accepted:               { label: 'Ticket accepted',              color: '#2563EB', bg: '#EFF6FF' },
  resolved:               { label: 'Ticket resolved',              color: '#16A34A', bg: '#DCFCE7' },
  closed:                 { label: 'Ticket closed',                color: '#475569', bg: '#F1F5F9' },
  reopened:               { label: 'Ticket reopened',              color: '#D97706', bg: '#FEF9C3' },
  escalated:              { label: 'Ticket escalated',             color: '#D97706', bg: '#FEF3C7' },
  comment_added:          { label: 'Comment added',                color: '#475569', bg: '#F8FAFC' },
  comment_deleted:        { label: 'Comment deleted',              color: '#94A3B8', bg: '#F8FAFC' },
  proof_attached:         { label: 'Proof attached',               color: '#059669', bg: '#D1FAE5' },
  checklist_updated:      { label: 'Checklist updated',            color: '#475569', bg: '#F1F5F9' },
  rating_submitted:       { label: 'Rating submitted',             color: '#D97706', bg: '#FEF9C3' },
  deleted:                { label: 'Ticket deleted',               color: '#DC2626', bg: '#FEE2E2' },
  sla_breached:           { label: 'SLA breached',                 color: '#DC2626', bg: '#FEE2E2' },
  confirmation_requested: { label: 'Confirmation requested',       color: '#2563EB', bg: '#EFF6FF' },
  raiser_confirmed:       { label: 'Raiser confirmed resolution',  color: '#16A34A', bg: '#DCFCE7' },
  rejected:               { label: 'Ticket rejected to triage',    color: '#DC2626', bg: '#FEE2E2' },
  transferred:            { label: 'Ticket transferred',           color: '#7C3AED', bg: '#EDE9FE' },
  put_on_hold:            { label: 'Put on hold',                  color: '#6B7280', bg: '#F1F5F9' },
  resumed:                { label: 'Resumed from hold',            color: '#0891B2', bg: '#E0F2FE' },
  first_responded:        { label: 'First response',               color: '#16A34A', bg: '#DCFCE7' },
  response_breached:      { label: 'Response SLA breached',        color: '#DC2626', bg: '#FEE2E2' },
  claimed:                { label: 'Ticket claimed',               color: '#2563EB', bg: '#EFF6FF' },
}

function formatTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function TicketActivityFeed({ logs }: Props) {
  if (logs.length === 0) {
    return <p className="text-sm text-text-muted text-center py-6">No activity yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {logs.map((log) => {
        const cfg = ACTION_CONFIG[log.action] ?? { label: log.action, color: '#475569', bg: '#F8FAFC' }
        return (
          <div key={log.id} className="flex items-start gap-3 py-2 border-b border-border-light last:border-0">
            <div
              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold"
              style={{ backgroundColor: cfg.bg, color: cfg.color }}
            >
              {cfg.label.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{cfg.label}</p>
              {log.user_name && (
                <p className="text-xs text-text-secondary">by {log.user_name}</p>
              )}
              {!!(log.metadata && typeof log.metadata === 'object' && (log.metadata as Record<string, unknown>).resolution_note) && (
                <p className="text-xs text-text-secondary mt-0.5 italic">
                  &quot;{(log.metadata as Record<string, unknown>).resolution_note as string}&quot;
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs text-text-muted">{formatTime(log.created_at)}</span>
          </div>
        )
      })}
    </div>
  )
}
