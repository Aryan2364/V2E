'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { auditApi } from '@/lib/api/audit'
import type { AuditEntry } from '@/lib/types/audit'
import {
  ActorCell,
  ActionBadge,
  AuditExpandedDetail,
  hasChanges,
  fmtDateTime,
  triggerLabel,
} from './AuditDetail'

interface Props {
  orgId: string
  resource: string
  entityId: string
  /** Optional heading; omit to render bare. */
  title?: string
}

/**
 * Federated entity history — reads the central audit store filtered by
 * resource + entity_id and renders a compact, expandable timeline. Drop onto any
 * detail page that needs a "what happened to this" view.
 */
export default function EntityAuditHistory({ orgId, resource, entityId, title = 'History' }: Props) {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !entityId) return
    setLoading(true)
    auditApi
      .byEntity(orgId, resource, entityId)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [orgId, resource, entityId])

  if (loading) return <p className="text-body text-text-muted py-4">Loading history…</p>
  if (items.length === 0) return <p className="text-body text-text-muted text-center py-6">No activity yet.</p>

  return (
    <div>
      {title && (
        <h3 className="flex items-center gap-2 text-body font-medium text-text-primary mb-3">
          <History size={16} className="text-primary-text" /> {title}
        </h3>
      )}
      <div className="flex flex-col">
        {items.map((e) => {
          const open = expanded === e.id && hasChanges(e)
          return (
            <div key={e.id} className="border-b border-border-light last:border-0">
              <button
                type="button"
                onClick={() => hasChanges(e) && setExpanded((c) => (c === e.id ? null : e.id))}
                className={`w-full flex items-start gap-3 py-2.5 text-left ${hasChanges(e) ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActionBadge action={e.action} />
                    {e.actor_type === 'system' && e.trigger_source && (
                      <span
                        className="text-meta font-medium rounded-full px-2 py-0.5"
                        style={{ backgroundColor: 'var(--surface-control)', color: 'var(--text-secondary)' }}
                      >
                        {triggerLabel(e.trigger_source)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-meta text-text-secondary flex items-center gap-1.5">
                    <ActorCell entry={e} />
                  </div>
                </div>
                <span className="shrink-0 text-meta text-text-muted whitespace-nowrap">{fmtDateTime(e.occurred_at)}</span>
              </button>
              {open && (
                <div className="pb-3">
                  <AuditExpandedDetail entry={e} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
