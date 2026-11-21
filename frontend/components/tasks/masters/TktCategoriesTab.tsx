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
import { FormField, inputCls, Spinner, ConfirmDeleteDialog } from './shared'

export default function TktCategoriesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TicketCategory[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [groups, setGroups] = useState<TicketResolverGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const emptyForm = { name: '', color: 'var(--text-secondary)', ticket_type_id: '', default_sla_days: '', default_response_sla_hours: '', resolver_group_id: '', description: '' }
  const [form, setForm] = useState({ ...emptyForm })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([ticketsApi.listCategories(orgId), ticketsApi.listTypes(orgId), ticketsApi.listResolverGroups(orgId)])
      .then(([cats, tys, grps]) => { setItems(cats); setTypes(tys); setGroups(grps) })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.name.trim()) { setFieldError('Enter a name.'); return }
    setSubmitting(true)
    try {
      const item = await ticketsApi.createCategory(orgId, {
        name: form.name.trim(),
        color: form.color,
        ticket_type_id: form.ticket_type_id || undefined,
        default_sla_days: form.default_sla_days ? parseInt(form.default_sla_days) : undefined,
        default_response_sla_hours: form.default_response_sla_hours ? parseInt(form.default_response_sla_hours) : null,
        resolver_group_id: form.resolver_group_id || null,
        description: form.description.trim() || undefined,
        is_active: true,
      })
      setItems((prev) => [...prev, item]); setForm({ ...emptyForm }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    await ticketsApi.deleteCategory(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmDeleteId(null)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete this category?"
        description="This category will be removed and can no longer be assigned to tickets."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} categor{items.length !== 1 ? 'ies' : 'y'}</p>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> Add Category</Button>
      </div>
      {creating && (
        <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" required error={!form.name.trim() ? fieldError : undefined}><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Network" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Ticket type (optional)">
              <StyledSelect
                value={form.ticket_type_id}
                onChange={(v) => setForm({ ...form, ticket_type_id: v })}
                placeholder="All types"
                options={[
                  { value: '', label: 'All types' },
                  ...types.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}`, color: t.color })),
                ]}
              />
            </FormField>
            <FormField label="SLA Override (days, optional)"><input type="number" min={1} value={form.default_sla_days} onChange={(e) => setForm({ ...form, default_sla_days: e.target.value })} placeholder="Inherits from type" className={inputCls} /></FormField>
            <FormField label="Response SLA (hours, optional)"><input type="number" min={1} value={form.default_response_sla_hours} onChange={(e) => setForm({ ...form, default_response_sla_hours: e.target.value })} placeholder="Inherits from type" className={inputCls} /></FormField>
            <FormField label="Resolver group (optional)">
              <StyledSelect
                value={form.resolver_group_id}
                onChange={(v) => setForm({ ...form, resolver_group_id: v })}
                placeholder="None"
                options={[
                  { value: '', label: 'None' },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </FormField>
          </div>
          <FormField label="Description (optional)"><input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} /></FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={submitting} loadingLabel="Creating">Create</Button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-text-secondary text-body">No categories yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-text-primary">{item.name}</p>
              {item.ticket_type && <p className="text-meta text-text-muted">{item.ticket_type.icon} {item.ticket_type.name}</p>}
            </div>
            {item.default_sla_days && <span className="text-meta text-text-secondary">SLA: {item.default_sla_days}d</span>}
            <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={13} /></Button>
          </div>
        ))}
      </div>
    </div>
  )
}
