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
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { FormField, inputCls, Spinner, ConfirmDeleteDialog } from './shared'

export default function TktPrioritiesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TicketPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', color: 'var(--danger)', sla_days: '', order_index: 0 })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    ticketsApi.listPriorities(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.label.trim()) { setFieldError('Enter a label.'); return }
    setSubmitting(true)
    try {
      const item = await ticketsApi.createPriority(orgId, { label: form.label.trim(), color: form.color, sla_days: form.sla_days ? parseInt(form.sla_days) : undefined, order_index: form.order_index, is_active: true })
      setItems((prev) => [...prev, item].sort((a, b) => a.order_index - b.order_index))
      setForm({ label: '', color: 'var(--danger)', sla_days: '', order_index: 0 }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    await ticketsApi.deletePriority(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmDeleteId(null)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete this priority?"
        description="This priority will be removed and can no longer be assigned to tickets."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} priorit{items.length !== 1 ? 'ies' : 'y'}</p>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> Add Priority</Button>
      </div>
      {creating && (
        <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label" required error={!form.label.trim() ? fieldError : undefined}><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Critical" className={inputCls} /></FormField>
            <FormField label="SLA days (optional)"><input type="number" min={1} value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value })} placeholder="Override SLA" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Order"><input type="number" value={form.order_index} onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value) || 0 })} className={inputCls} /></FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={submitting} loadingLabel="Creating">Create</Button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-text-secondary text-body">No priorities yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-body font-medium text-text-primary">{item.label}</span>
            {item.sla_days && <span className="text-meta text-text-secondary">SLA: {item.sla_days}d</span>}
            <span className="text-meta text-text-secondary">Order: {item.order_index}</span>
            <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={13} /></Button>
          </div>
        ))}
      </div>
    </div>
  )
}
