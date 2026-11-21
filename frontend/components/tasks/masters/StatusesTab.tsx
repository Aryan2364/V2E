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
import Tooltip from '@/components/ui/tooltip'
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
import { FormField, apiError, inputCls, Spinner, ConfirmDeleteDialog } from './shared'

// Statuses are shown as one top-to-bottom flow: Not Started → In Progress stages (ordered)
// → Completed → Incomplete. The three singletons are plain one-line rows; only In Progress
// is a section you can add to and reorder.

export default function StatusesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ label: '', color: 'var(--primary-text)' })
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState({ label: '', color: 'var(--text-secondary)' })
  const [submitting, setSubmitting] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    tasksApi.getStatuses(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])
  useEffect(() => { load() }, [load])

  const single = (type: string) => items.find((s) => s.type === type) ?? null
  const inProgress = items.filter((s) => s.type === 'in_progress').sort((a, b) => a.order_index - b.order_index)

  function startEdit(item: TaskStatus) {
    setEditingId(item.id); setEditForm({ label: item.label, color: item.color }); setError(null)
  }

  async function handleAdd() {
    if (!addForm.label.trim()) { setFieldError('Enter a label.'); return }
    setSubmitting(true); setError(null)
    try {
      const maxOrder = items.reduce((m, s) => Math.max(m, s.order_index), 0)
      const item = await tasksApi.createStatus(orgId, { label: addForm.label.trim(), type: 'in_progress', color: addForm.color, order_index: maxOrder + 1, is_active: true } as Omit<TaskStatus, 'id' | 'organization_id'>)
      setItems((prev) => [...prev, item])
      setAddForm({ label: '', color: 'var(--text-secondary)' }); setAdding(false)
    } catch (e) { setError(apiError(e) ?? 'Could not add stage.') } finally { setSubmitting(false) }
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.label.trim()) { setFieldError('Enter a label.'); return }
    setSubmitting(true); setError(null)
    try {
      const updated = await tasksApi.updateStatus(orgId, id, { label: editForm.label.trim(), color: editForm.color })
      setItems((prev) => prev.map((s) => (s.id === id ? updated : s)))
      setEditingId(null)
    } catch (e) { setError(apiError(e) ?? 'Could not save changes.') } finally { setSubmitting(false) }
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setError(null)
    try {
      await tasksApi.deleteStatus(orgId, id)
      setItems((prev) => prev.filter((s) => s.id !== id))
    } catch (e) { setError(apiError(e) ?? 'Could not remove stage.') } finally { setConfirmDeleteId(null) }
  }

  // Reorder among In Progress, then renumber every status into canonical phase order
  // (not_started → in_progress… → completed → incomplete) so order_index never collides.
  async function applyOrder(newInProgress: TaskStatus[]) {
    const ordered = [single('not_started'), ...newInProgress, single('completed'), single('partially_completed'), single('incomplete')].filter(Boolean) as TaskStatus[]
    const updates = ordered.map((s, i) => ({ id: s.id, order_index: i }))
    setSavingOrder(true)
    setItems((prev) => prev.map((s) => { const u = updates.find((x) => x.id === s.id); return u ? { ...s, order_index: u.order_index } : s }))
    try { await tasksApi.reorderStatuses(orgId, updates) } catch { load() } finally { setSavingOrder(false) }
  }
  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= inProgress.length) return
    const arr = [...inProgress]
    const [moved] = arr.splice(idx, 1)
    arr.splice(target, 0, moved)
    applyOrder(arr)
  }

  function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <div className="flex gap-2 items-center">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      </div>
    )
  }

  function EditRow({ id }: { id: string }) {
    return (
      <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Label" required error={!editForm.label.trim() ? fieldError : undefined}><input type="text" autoFocus value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} className={inputCls} /></FormField>
          <FormField label="Color"><ColorPicker value={editForm.color} onChange={(c) => setEditForm({ ...editForm, color: c })} /></FormField>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
          <Button onClick={() => handleSaveEdit(id)} loading={submitting} loadingLabel="Saving"><Save size={14} /> Save</Button>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />

  const notStarted = single('not_started')
  const completed = single('completed')
  const partiallyCompleted = single('partially_completed')
  const incomplete = single('incomplete')

  // One flow row. `role` is the fixed phase shown muted on the left; In Progress stages show
  // a step number + reorder/delete instead, since their order is the workflow order.
  const lineFor = (item: TaskStatus, role: string, stage: boolean, idx: number) => {
    if (editingId === item.id) return <EditRow key={item.id} id={item.id} />
    return (
      <div key={item.id} className="flex items-center gap-2.5 bg-surface border border-border-light rounded-control pl-3 pr-2 py-2">
        <span className="w-[78px] shrink-0 flex items-center">
          {stage
            ? <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary-subtle text-primary-text text-meta font-medium">{idx + 1}</span>
            : <span className="text-meta font-medium uppercase tracking-wide text-text-muted">{role}</span>}
        </span>
        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
        <span className="flex-1 min-w-0 truncate text-body font-medium text-text-primary">{item.label}</span>
        {stage && (
          <div className="flex items-center shrink-0">
            <Button type="button" variant="ghost" size="icon-sm" disabled={idx === 0 || savingOrder} onClick={() => move(idx, -1)} aria-label="Move up"><ChevronUp size={15} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={idx === inProgress.length - 1 || savingOrder} onClick={() => move(idx, 1)} aria-label="Move down"><ChevronDown size={15} /></Button>
          </div>
        )}
        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => startEdit(item)} aria-label="Rename"><Pencil size={13} /></Button>
        {stage && (
          <Tooltip label={inProgress.length <= 1 ? 'At least one In Progress stage is required' : 'Remove stage'}>
            <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmDeleteId(item.id)} disabled={inProgress.length <= 1} aria-label="Remove stage"><Trash2 size={13} /></Button>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5 max-w-2xl">
      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Remove this In Progress stage?"
        confirmLabel="Remove stage"
        description="Tasks currently on this stage will move to the nearest remaining one."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      {error && <div className="text-body text-danger bg-danger-bg border border-danger-border rounded-control px-3 py-2 mb-1">{error}</div>}

      {notStarted && lineFor(notStarted, 'Start', false, -1)}

      {inProgress.map((s, i) => lineFor(s, 'In progress', true, i))}

      {adding ? (
        <div className="flex items-center gap-2.5 bg-surface-sunken border border-border-light rounded-control pl-3 pr-2 py-2">
          <span className="w-[78px] shrink-0" />
          <input type="color" value={addForm.color} onChange={(e) => setAddForm({ ...addForm, color: e.target.value })} className="w-7 h-7 shrink-0 rounded-control border border-border cursor-pointer p-0" />
          <input type="text" autoFocus value={addForm.label} onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setAddForm({ label: '', color: 'var(--text-secondary)' }) } }} placeholder="New stage name (e.g. In Review)" className="flex-1 min-w-0 border border-border rounded-control px-2.5 py-1.5 text-body text-text-primary placeholder:text-text-muted focus:border-2 focus:border-primary focus:outline-hidden bg-surface" />
          <Button size="sm" className="shrink-0" onClick={handleAdd} disabled={!addForm.label.trim()} loading={submitting} loadingLabel="Adding">Add</Button>
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => { setAdding(false); setAddForm({ label: '', color: 'var(--text-secondary)' }) }} aria-label="Cancel"><X size={15} /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="w-[78px] shrink-0" />
          <Button variant="ghost" size="sm" onClick={() => { setAdding(true); setError(null) }}><Plus size={14} /> Add In Progress stage</Button>
        </div>
      )}

      {completed && lineFor(completed, 'Completed', false, -1)}
      {partiallyCompleted && lineFor(partiallyCompleted, 'Partial', false, -1)}
      {incomplete && lineFor(incomplete, 'Incomplete', false, -1)}
    </div>
  )
}
