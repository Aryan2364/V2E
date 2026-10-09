'use client'

import { Settings2 } from 'lucide-react'
import type { AuditEntry } from '@/lib/types/audit'

export const ACTION_META: Record<string, { label: string; bg: string; text: string }> = {
  create: { label: 'Create', bg: '#DCFCE7', text: '#16A34A' },
  update: { label: 'Update', bg: '#E0F2FE', text: '#0369A1' },
  delete: { label: 'Delete', bg: '#FEE2E2', text: '#DC2626' },
}

/** Human label for a system trigger source. */
const TRIGGER_LABELS: Record<string, string> = {
  sla_breach: 'SLA breach',
  auto_overdue: 'Deadline passed',
  workflow_overdue: 'Workflow step overdue',
  workflow_schedule: 'Scheduled workflow start',
  date_trigger: 'Scheduled date trigger',
  recurring_spawn: 'Recurring schedule',
  demand_spawn: 'Recurring log demand',
  reminder: 'Reminder sweep',
  meeting_reminder: 'Meeting reminder',
  escalation: 'Escalation',
  milestone_autocomplete: 'Milestone auto-completion',
}

export function triggerLabel(src: string | null): string {
  if (!src) return ''
  return TRIGGER_LABELS[src] ?? src.replace(/_/g, ' ')
}

export function humanizeField(key: string): string {
  return key
    .replace(/_id$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    if (ISO_DATE.test(v)) {
      const d = new Date(v)
      if (!isNaN(d.getTime()))
        return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
    return v
  }
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Actor as a name, or a ⚙ System chip when the entry is system-triggered. */
export function ActorCell({ entry }: { entry: AuditEntry }) {
  if (entry.actor_type === 'system') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px] font-medium rounded-full px-2 py-0.5"
        style={{ backgroundColor: '#EEF2FF', color: '#4338CA' }}
      >
        <Settings2 size={12} /> System
      </span>
    )
  }
  return <span className="text-sm text-[#0F172A]">{entry.actor?.name ?? '—'}</span>
}

export function ActionBadge({ action }: { action: string }) {
  const am = ACTION_META[action] ?? { label: action, bg: '#F1F5F9', text: '#475569' }
  return (
    <span className="text-[12px] font-medium rounded-full px-2.5 py-0.5" style={{ backgroundColor: am.bg, color: am.text }}>
      {am.label}
    </span>
  )
}

export function hasChanges(entry: AuditEntry): boolean {
  return !!entry.changes && Object.keys(entry.changes).length > 0
}

/** Full-width drill-down region: resolved before→after, actor/trigger, business time. */
export function AuditExpandedDetail({ entry }: { entry: AuditEntry }) {
  const changes = entry.changes ?? {}
  const showCreated = entry.created_at && entry.occurred_at && entry.created_at.slice(0, 16) !== entry.occurred_at.slice(0, 16)

  return (
    <div className="rounded-[10px] border border-[#E2E8F0] bg-white p-4">
      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-[13px] text-[#475569]">
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-[#374151]">By:</span>
          <ActorCell entry={entry} />
        </span>
        {entry.actor_type === 'system' && entry.trigger_source && (
          <span
            className="text-[12px] font-medium rounded-full px-2 py-0.5"
            style={{ backgroundColor: '#E0F2FE', color: '#0369A1' }}
          >
            Triggered by: {triggerLabel(entry.trigger_source)}
          </span>
        )}
        <span>
          <span className="font-medium text-[#374151]">When:</span> {fmtDateTime(entry.occurred_at)}
        </span>
        {showCreated && (
          <span className="text-[#64748B]">(recorded {fmtDateTime(entry.created_at)})</span>
        )}
      </div>

      {/* Field-level changes */}
      {Object.keys(changes).length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {Object.entries(changes).map(([field, ch]) => (
            <div key={field} className="text-sm flex items-start gap-2 flex-wrap">
              <span className="font-medium text-[#374151]">{humanizeField(field)}:</span>
              <span className="text-[#DC2626] line-through break-all">{formatValue(ch.before)}</span>
              <span className="text-[#94A3B8]">→</span>
              <span className="text-[#16A34A] break-all">{formatValue(ch.after)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#64748B]">No field-level changes recorded.</p>
      )}
    </div>
  )
}
