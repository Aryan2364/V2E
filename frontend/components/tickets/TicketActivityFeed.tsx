'use client'

import type { TicketActivityLog, TicketActivityAction } from '@/lib/types/tickets'
import { formatDateTime } from '@/lib/format'

interface Props {
  logs: TicketActivityLog[]
}

const ACTION_CONFIG: Record<TicketActivityAction, { label: string; color: string; bg: string }> = {
  created:                { label: 'Ticket created',               color: 'var(--primary-text)', bg: 'var(--primary-subtle)' },
  assigned:               { label: 'Ticket assigned',              color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  reassigned:             { label: 'Ticket reassigned',            color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  status_changed:         { label: 'Status changed',               color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  accepted:               { label: 'Ticket accepted',              color: 'var(--primary-text)', bg: 'var(--primary-subtle)' },
  resolved:               { label: 'Ticket resolved',              color: 'var(--success)', bg: 'var(--success-bg)' },
  closed:                 { label: 'Ticket closed',                color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  reopened:               { label: 'Ticket reopened',              color: 'var(--warning)', bg: 'var(--warning-bg)' },
  escalated:              { label: 'Ticket escalated',             color: 'var(--warning)', bg: 'var(--warning-bg)' },
  comment_added:          { label: 'Comment added',                color: 'var(--text-secondary)', bg: 'var(--surface-sunken)' },
  comment_deleted:        { label: 'Comment deleted',              color: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  proof_attached:         { label: 'Proof attached',               color: 'var(--success)', bg: 'var(--success-bg)' },
  checklist_updated:      { label: 'Checklist updated',            color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  rating_submitted:       { label: 'Rating submitted',             color: 'var(--warning)', bg: 'var(--warning-bg)' },
  deleted:                { label: 'Ticket deleted',               color: 'var(--danger)', bg: 'var(--danger-bg)' },
  sla_breached:           { label: 'SLA breached',                 color: 'var(--danger)', bg: 'var(--danger-bg)' },
  confirmation_requested: { label: 'Confirmation requested',       color: 'var(--primary-text)', bg: 'var(--primary-subtle)' },
  raiser_confirmed:       { label: 'Raiser confirmed resolution',  color: 'var(--success)', bg: 'var(--success-bg)' },
  rejected:               { label: 'Ticket rejected to triage',    color: 'var(--danger)', bg: 'var(--danger-bg)' },
  transferred:            { label: 'Ticket transferred',           color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  put_on_hold:            { label: 'Put on hold',                  color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  resumed:                { label: 'Resumed from hold',            color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  first_responded:        { label: 'First response',               color: 'var(--success)', bg: 'var(--success-bg)' },
  response_breached:      { label: 'Response SLA breached',        color: 'var(--danger)', bg: 'var(--danger-bg)' },
  claimed:                { label: 'Ticket claimed',               color: 'var(--primary-text)', bg: 'var(--primary-subtle)' },
}

function formatTime(d: string) {
  return formatDateTime(d)
}

export default function TicketActivityFeed({ logs }: Props) {
  if (logs.length === 0) {
    return <p className="text-sm text-text-muted text-center py-6">No activity yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {logs.map((log) => {
        const cfg = ACTION_CONFIG[log.action] ?? { label: log.action, color: 'var(--text-secondary)', bg: 'var(--surface-sunken)' }
        return (
          <div key={log.id} className="flex items-start gap-3 py-2 border-b border-border-light last:border-0">
            <div
              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-medium"
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
