'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ticketsApi } from '@/lib/api/tickets'
import type {
  TaskMasterConfig,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  ChecklistTemplate,
  ChecklistAccessMode,
} from '@/lib/types/tasks'
import type { Department, Role, EmployeeProfile } from '@/lib/types'
import type {
  TicketMasterConfig,
  TicketType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketTemplate,
  TicketReassignmentMode,
  TicketStatusType,
  TicketTemplateType,
  TicketResolverGroup,
  TicketAssignmentStrategy,
  TicketTemplateAccessMode,
} from '@/lib/types/tickets'
import StyledSelect from '@/components/ui/StyledSelect'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { FormField, inputCls, Spinner } from './shared'

export default function TktStatusesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TicketStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', type: 'open' as TicketStatusType, color: 'var(--primary-text)', order_index: 0, is_default: false })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    ticketsApi.listStatuses(orgId).then((s) => setItems(s.sort((a, b) => a.order_index - b.order_index))).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.label.trim()) { setFieldError('Enter a label.'); return }
    setSubmitting(true)
    try {
      const item = await ticketsApi.createStatus(orgId, { label: form.label.trim(), type: form.type, color: form.color, order_index: form.order_index, is_default: form.is_default, is_active: true })
      setItems((prev) => [...prev, item].sort((a, b) => a.order_index - b.order_index))
      setForm({ label: '', type: 'open', color: 'var(--primary-text)', order_index: 0, is_default: false }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const statusTypes: TicketStatusType[] = ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed_resolved', 'closed_unresolved']

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} status{items.length !== 1 ? 'es' : ''}</p>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> Add Status</Button>
      </div>
      {creating && (
        <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label" required error={!form.label.trim() ? fieldError : undefined}><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Pending Review" className={inputCls} /></FormField>
            <FormField label="Type">
              <StyledSelect
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as TicketStatusType })}
                options={statusTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
              />
            </FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Order"><input type="number" value={form.order_index} onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value) || 0 })} className={inputCls} /></FormField>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-primary w-4 h-4" />
            <span className="text-body text-text-primary">Set as default status</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={submitting} loadingLabel="Creating">Create</Button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-text-secondary text-body">No statuses yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-body font-medium text-text-primary">{item.label}</span>
            <span className="text-meta text-text-secondary capitalize">{item.type.replace(/_/g, ' ')}</span>
            {item.is_default && <span className="text-meta font-medium rounded-[999px] px-2 py-0.5 bg-primary-subtle text-primary-text border border-primary-border">Default</span>}
            <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
