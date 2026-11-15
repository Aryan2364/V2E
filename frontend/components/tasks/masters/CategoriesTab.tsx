'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { tasksApi } from '@/lib/api/tasks'
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
import { FormField, inputCls, Spinner, ConfirmDeleteDialog } from './shared'

export default function CategoriesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TaskCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', color: 'var(--primary-text)' })
  const [editForm, setEditForm] = useState({ name: '', description: '', color: 'var(--primary-text)' })
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(() => {
    setLoading(true)
    tasksApi.getCategories(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  async function handleCreate() {
    if (!form.name.trim()) { setFieldError('Enter a name.'); return }
    setSubmitting(true)
    try {
      const item = await tasksApi.createCategory(orgId, { name: form.name.trim(), description: form.description.trim() || undefined, color: form.color, is_active: true })
      setItems((prev) => [...prev, item])
      setForm({ name: '', description: '', color: 'var(--primary-text)' })
      setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleEdit(id: string) {
    if (!editForm.name.trim()) { setFieldError('Enter a name.'); return }
    setSubmitting(true)
    try {
      const updated = await tasksApi.updateCategory(orgId, id, { name: editForm.name.trim(), description: editForm.description.trim() || undefined, color: editForm.color })
      setItems((prev) => prev.map((i) => i.id === id ? updated : i))
      setEditingId(null)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    await tasksApi.deleteCategory(orgId, id).catch(() => null)
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
        description="This category will be removed and can no longer be assigned to tasks."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} categor{items.length !== 1 ? 'ies' : 'y'}</p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} /> Add Category
        </Button>
      </div>
      {creating && (
        <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" required error={!form.name.trim() ? fieldError : undefined}><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Category name" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
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
        {items.map((item) => editingId === item.id ? (
          <div key={item.id} className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" required error={!editForm.name.trim() ? fieldError : undefined}><input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} /></FormField>
              <FormField label="Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                  <input type="text" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className={inputCls} />
                </div>
              </FormField>
            </div>
            <FormField label="Description"><input type="text" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputCls} /></FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
              <Button onClick={() => handleEdit(item.id)} loading={submitting} loadingLabel="Saving">Save</Button>
            </div>
          </div>
        ) : (
          <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-text-primary">{item.name}</p>
              {item.description && <p className="text-meta text-text-secondary truncate">{item.description}</p>}
            </div>
            <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, description: item.description ?? '', color: item.color }) }}><Pencil size={13} /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setConfirmDeleteId(item.id)} className="hover:text-danger hover:bg-danger-bg"><Trash2 size={13} /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
