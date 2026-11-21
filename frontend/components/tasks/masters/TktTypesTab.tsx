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

export default function TktTypesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TicketType[]>([])
  const [groups, setGroups] = useState<TicketResolverGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const emptyForm = { name: '', icon: '🎫', color: 'var(--primary-text)', default_sla_days: 3, default_response_sla_hours: '', resolver_group_id: '', description: '' }
  const [form, setForm] = useState({ ...emptyForm })
  const [editForm, setEditForm] = useState({ ...emptyForm })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([ticketsApi.listTypes(orgId), ticketsApi.listResolverGroups(orgId)])
      .then(([tys, grps]) => { setItems(tys); setGroups(grps) })
      .catch(() => { setItems([]); setGroups([]) })
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    if (!form.name.trim()) { setFieldError('Enter a name.'); return }
    setSubmitting(true)
    try {
      const item = await ticketsApi.createType(orgId, { name: form.name.trim(), icon: form.icon, color: form.color, default_sla_days: form.default_sla_days, default_response_sla_hours: form.default_response_sla_hours ? parseInt(form.default_response_sla_hours) : null, resolver_group_id: form.resolver_group_id || null, description: form.description.trim() || undefined, is_active: true })
      setItems((prev) => [...prev, item]); setForm({ ...emptyForm }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleEdit(id: string) {
    if (!editForm.name.trim()) { setFieldError('Enter a name.'); return }
    setSubmitting(true)
    try {
      const updated = await ticketsApi.updateType(orgId, id, { name: editForm.name.trim(), icon: editForm.icon, color: editForm.color, default_sla_days: editForm.default_sla_days, default_response_sla_hours: editForm.default_response_sla_hours ? parseInt(editForm.default_response_sla_hours) : null, resolver_group_id: editForm.resolver_group_id || null, description: editForm.description.trim() || undefined })
      setItems((prev) => prev.map((i) => i.id === id ? updated : i)); setEditingId(null)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    await ticketsApi.deleteType(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmDeleteId(null)
  }

  function TypeForm({ f, setF, onSave, onCancel, label }: { f: typeof emptyForm; setF: (v: typeof emptyForm) => void; onSave: () => void; onCancel: () => void; label: string }) {
    return (
      <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Name" required error={!f.name.trim() ? fieldError : undefined}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Issue" className={inputCls} /></FormField>
          <FormField label="Icon (emoji)"><input type="text" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} className={inputCls} /></FormField>
          <FormField label="Color">
            <div className="flex gap-2 items-center">
              <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
              <input type="text" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className={inputCls} />
            </div>
          </FormField>
          <FormField label="Default SLA days"><input type="number" min={1} value={f.default_sla_days} onChange={(e) => setF({ ...f, default_sla_days: parseInt(e.target.value) || 1 })} className={inputCls} /></FormField>
          <FormField label="Default Response SLA (hours, optional)"><input type="number" min={1} value={f.default_response_sla_hours} onChange={(e) => setF({ ...f, default_response_sla_hours: e.target.value })} placeholder="No response SLA" className={inputCls} /></FormField>
          <FormField label="Resolver group (optional)">
            <StyledSelect
              value={f.resolver_group_id}
              onChange={(v) => setF({ ...f, resolver_group_id: v })}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          </FormField>
        </div>
        <FormField label="Description (optional)"><input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} /></FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} loadingLabel="Saving">{label}</Button>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Deactivate this type?"
        confirmLabel="Deactivate"
        description="This ticket type will stop appearing for new tickets."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} type{items.length !== 1 ? 's' : ''}</p>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> Add Type</Button>
      </div>
      {creating && <TypeForm f={form} setF={setForm} onSave={handleCreate} onCancel={() => setCreating(false)} label="Create" />}
      {items.length === 0 && !creating && <div className="text-center py-12 text-text-secondary text-label">No ticket types yet. Click "Add Type" to create one.</div>}
      <div className="space-y-2">
        {items.map((item) => editingId === item.id ? (
          <TypeForm key={item.id} f={editForm} setF={setEditForm} onSave={() => handleEdit(item.id)} onCancel={() => setEditingId(null)} label="Save" />
        ) : (
          <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
            <span className="text-section">{item.icon}</span>
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-text-primary">{item.name}</p>
              {item.description && <p className="text-meta text-text-secondary truncate">{item.description}</p>}
            </div>
            <span className="text-meta text-text-secondary">SLA: {item.default_sla_days}d</span>
            <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon-sm" onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, icon: item.icon, color: item.color, default_sla_days: item.default_sla_days, default_response_sla_hours: item.default_response_sla_hours?.toString() ?? '', resolver_group_id: item.resolver_group_id ?? '', description: item.description ?? '' }) }}><Pencil size={13} /></Button>
              <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={13} /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
