'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Archive, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { TicketArchiveEntry, Ticket } from '@/lib/types/tickets'
import TicketStatusBadge from '@/components/tickets/TicketStatusBadge'
import TicketTypeBadge from '@/components/tickets/TicketTypeBadge'
import { formatDate as formatDateToken } from '@/lib/format'

function formatDate(iso: string) {
  return formatDateToken(iso)
}

function SnapshotViewer({ ticket }: { ticket: Ticket }) {
  return (
    <div className="mt-3 p-4 bg-surface-sunken border border-border-light rounded-[10px] space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-meta">
        <div>
          <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Raised by</p>
          <p className="text-text-primary font-medium">{ticket.raised_by_user_id}</p>
        </div>
        <div>
          <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Assigned to</p>
          <p className="text-text-primary font-medium">{ticket.assigned_to_user_id ?? '—'}</p>
        </div>
        <div>
          <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">SLA</p>
          <p className="text-text-primary font-medium">{ticket.sla_days}d · {ticket.sla_breached ? '⚠ Breached' : 'OK'}</p>
        </div>
        <div>
          <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Created</p>
          <p className="text-text-primary font-medium">{formatDate(ticket.created_at)}</p>
        </div>
        {ticket.resolved_at && (
          <div>
            <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Resolved</p>
            <p className="text-text-primary font-medium">{formatDate(ticket.resolved_at)}</p>
          </div>
        )}
        {ticket.closed_at && (
          <div>
            <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Closed</p>
            <p className="text-text-primary font-medium">{formatDate(ticket.closed_at)}</p>
          </div>
        )}
        {ticket.rating && (
          <div>
            <p className="text-text-muted uppercase tracking-wide font-medium mb-0.5">Rating</p>
            <p className="text-text-primary font-medium">{'★'.repeat(ticket.rating)}{'☆'.repeat(5 - ticket.rating)} ({ticket.rating}/5)</p>
          </div>
        )}
      </div>

      {ticket.description && (
        <div>
          <p className="text-text-muted uppercase tracking-wide text-meta font-medium mb-1">Description</p>
          <p className="text-meta text-text-secondary whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
        </div>
      )}

      {ticket.resolution_note && (
        <div>
          <p className="text-text-muted uppercase tracking-wide text-meta font-medium mb-1">Resolution Note</p>
          <p className="text-meta text-text-secondary whitespace-pre-wrap leading-relaxed">{ticket.resolution_note}</p>
        </div>
      )}

      {ticket.checklist && ticket.checklist.length > 0 && (
        <div>
          <p className="text-text-muted uppercase tracking-wide text-meta font-medium mb-1">Checklist</p>
          <div className="space-y-1">
            {ticket.checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <div className={`w-3.5 h-3.5 rounded-xs border shrink-0 flex items-center justify-center ${item.is_completed ? 'bg-success border-success' : 'border-border'}`}>
                  {item.is_completed && <span className="text-white text-meta font-medium">✓</span>}
                </div>
                <span className={`text-meta ${item.is_completed ? 'line-through text-text-muted' : 'text-text-secondary'}`}>{item.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ArchiveRow({ entry }: { entry: TicketArchiveEntry }) {
  const [expanded, setExpanded] = useState(false)
  const snapshot = entry.ticket_snapshot

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-surface-sunken transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-mono text-meta text-text-muted shrink-0">{snapshot.ticket_number}</span>

        {snapshot.ticket_type && <TicketTypeBadge type={snapshot.ticket_type} />}

        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-text-primary truncate">{snapshot.title}</p>
          {snapshot.category && (
            <p className="text-meta text-text-muted truncate">{snapshot.category.name}</p>
          )}
        </div>

        {snapshot.status && <TicketStatusBadge status={snapshot.status} />}

        <div className="text-right shrink-0">
          <p className="text-meta text-text-secondary">Deleted {formatDate(entry.deleted_at)}</p>
          <p className="text-meta text-text-muted truncate max-w-[140px]">{entry.deletion_reason}</p>
        </div>

        <span className="text-text-muted shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>

      {expanded && <SnapshotViewer ticket={snapshot} />}
    </div>
  )
}

export default function TicketArchivePage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [entries, setEntries] = useState<TicketArchiveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setEntries(await ticketsApi.listArchive(orgId))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = entries.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.ticket_snapshot.ticket_number.toLowerCase().includes(q) ||
      e.ticket_snapshot.title.toLowerCase().includes(q) ||
      e.deletion_reason.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title font-medium text-text-primary">Ticket Archive</h1>
          <p className="text-body text-text-secondary mt-0.5">Read-only snapshots of deleted tickets</p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-meta font-medium text-text-secondary bg-surface-control border border-border-light">
          <Archive size={13} />
          {entries.length} archived
        </span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by ticket number, title, or deletion reason..."
        className="w-full px-3 py-2 border border-border rounded-[8px] text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden"
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-surface-control rounded-[12px] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border-light rounded-[12px]">
          <Archive size={28} className="text-muted mb-3" />
          <p className="text-body font-medium text-text-primary">{search ? 'No matching archived tickets' : 'No archived tickets'}</p>
          {search && <p className="text-meta text-text-secondary mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((entry) => (
            <ArchiveRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
