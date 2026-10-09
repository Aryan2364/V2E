'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { tasksApi } from '@/lib/api/tasks'
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
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import { getEmployees } from '@/lib/api/employees'
import ChecklistAccessEditor, { type LocalRule, newRuleKey } from '@/components/tasks/ChecklistAccessEditor'
import Tooltip from '@/components/ui/Tooltip'
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
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import StyledSelect from '@/components/ui/StyledSelect'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, Loader2, GripVertical, ChevronUp, ChevronDown, ArrowLeft, Upload } from 'lucide-react'
import { notificationsApi, type NotificationMaster } from '@/lib/api/notifications'
import { AssigneeVisibilityTab } from '@/components/tasks/AssigneeVisibilityTab'
import ImportChecklistsModal from '@/components/tasks/ImportChecklistsModal'
import TagsTab from '@/components/tasks/masters/TagsTab'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// NestJS validation errors arrive as a string or string[] under response.data.message.
function apiError(e: unknown): string | null {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(msg)) return msg[0] ?? null
  return msg ?? null
}

const inputCls = 'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-[8px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white'

/** Solid blue count pill beside a heading; hidden when the count is 0. */
function CountPill({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold leading-none">
      {n}
    </span>
  )
}

function Spinner() {
  return (
    <div className="h-40 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ─── Task Masters Tabs ────────────────────────────────────────────────────────

type TaskMasterTab = 'config' | 'categories' | 'tags' | 'priorities' | 'statuses' | 'checklists' | 'assignee_visibility'

function ConfigTab({ orgId }: { orgId: string }) {
  const [config, setConfig] = useState<TaskMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    tasksApi.getConfig(orgId).then(setConfig).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await tasksApi.updateConfig(orgId, config)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  if (loading) return <Spinner />
  if (!config) return <p className="text-sm text-[#475569]">Could not load configuration.</p>

  return (
    <div className="space-y-6 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Default Reminder Days Before">
          <input type="number" min={0} value={config.default_reminder_days_before}
            onChange={(e) => setConfig({ ...config, default_reminder_days_before: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Undo window (minutes)">
          <input type="number" min={0} value={config.reopen_window_minutes}
            onChange={(e) => setConfig({ ...config, reopen_window_minutes: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Escalation Levels">
          <input type="number" min={0} value={config.escalation_levels}
            onChange={(e) => setConfig({ ...config, escalation_levels: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors">
        <Save size={15} />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Configuration'}
      </button>
    </div>
  )
}

function CategoriesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TaskCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', color: '#2563EB' })
  const [editForm, setEditForm] = useState({ name: '', description: '', color: '#2563EB' })
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(() => {
    setLoading(true)
    tasksApi.getCategories(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  async function handleCreate() {
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      const item = await tasksApi.createCategory(orgId, { name: form.name.trim(), description: form.description.trim() || undefined, color: form.color, is_active: true })
      setItems((prev) => [...prev, item])
      setForm({ name: '', description: '', color: '#2563EB' })
      setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleEdit(id: string) {
    if (!editForm.name.trim()) return
    setSubmitting(true)
    try {
      const updated = await tasksApi.updateCategory(orgId, id, { name: editForm.name.trim(), description: editForm.description.trim() || undefined, color: editForm.color })
      setItems((prev) => prev.map((i) => i.id === id ? updated : i))
      setEditingId(null)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this category?')) return
    await tasksApi.deleteCategory(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} categor{items.length !== 1 ? 'ies' : 'y'}</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors">
          <Plus size={14} /> Add Category
        </button>
      </div>
      {creating && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Category name" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
          </div>
          <FormField label="Description (optional)"><input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description..." className={inputCls} /></FormField>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No categories yet.</div>}
      <div className="space-y-2">
        {items.map((item) => editingId === item.id ? (
          <div key={item.id} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name"><input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} /></FormField>
              <FormField label="Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                  <input type="text" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className={inputCls} />
                </div>
              </FormField>
            </div>
            <FormField label="Description"><input type="text" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputCls} /></FormField>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(item.id)} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#0F172A]">{item.name}</p>
              {item.description && <p className="text-xs text-[#475569] truncate">{item.description}</p>}
            </div>
            <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, description: item.description ?? '', color: item.color }) }} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"><Pencil size={13} /></button>
              <button onClick={() => handleDelete(item.id)} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PrioritiesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TaskPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', color: '#DC2626' })
  const [submitting, setSubmitting] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    tasksApi.getPriorities(orgId)
      .then((p) => {
        const sorted = [...p].sort((a, b) => a.order_index - b.order_index)
        // Legacy rows may share an order or have gaps. Heal them to a clean 0..N-1 sequence once.
        const needsNormalize = sorted.some((it, i) => it.order_index !== i)
        if (needsNormalize && sorted.length > 0) {
          const fixed = sorted.map((it, i) => ({ ...it, order_index: i }))
          setItems(fixed)
          tasksApi.reorderPriorities(orgId, fixed.map((it) => ({ id: it.id, order_index: it.order_index }))).catch(() => { /* read-only viewer or offline — display stays correct */ })
        } else {
          setItems(sorted)
        }
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.label.trim()) return
    setSubmitting(true)
    try {
      // New priorities go to the bottom of the list; rank is derived from position, never typed.
      const item = await tasksApi.createPriority(orgId, { label: form.label.trim(), color: form.color, order_index: items.length, is_active: true })
      setItems((prev) => [...prev, item])
      setForm({ label: '', color: '#DC2626' })
      setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  // Renumber the whole list 0..N-1 (so two priorities can never share a rank) and persist it.
  // Optimistic update with rollback if the reorder call fails.
  async function persistOrder(next: TaskPriority[]) {
    const renumbered = next.map((it, i) => ({ ...it, order_index: i }))
    const previous = items
    setItems(renumbered)
    setSavingOrder(true)
    try {
      await tasksApi.reorderPriorities(orgId, renumbered.map((it) => ({ id: it.id, order_index: it.order_index })))
    } catch {
      setItems(previous)
    } finally {
      setSavingOrder(false)
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    persistOrder(next)
  }

  function handleDrop(target: number) {
    if (dragIndex !== null) move(dragIndex, target)
    setDragIndex(null)
    setOverIndex(null)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[#475569]">{items.length} priorit{items.length !== 1 ? 'ies' : 'y'}</p>
          {items.length > 1 && <p className="text-xs text-[#94A3B8] mt-0.5">Ordered highest → lowest. Drag the handle or use the arrows to rearrange.</p>}
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors shrink-0"><Plus size={14} /> Add Priority</button>
      </div>
      {creating && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label"><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. High" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
          </div>
          <p className="text-xs text-[#64748B]">Added to the bottom of the list. Drag it into position afterwards — the rank number updates automatically.</p>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No priorities yet.</div>}
      <div className="space-y-2">
        {items.map((item, idx) => {
          const rankLabel = items.length > 1 ? (idx === 0 ? 'Highest' : idx === items.length - 1 ? 'Lowest' : null) : null
          const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx
          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => { e.preventDefault(); if (overIndex !== idx) setOverIndex(idx) }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx) }}
              className={`bg-white border rounded-[8px] pl-2 pr-3 py-3 flex items-center gap-2.5 transition-colors ${isDropTarget ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0]'} ${dragIndex === idx ? 'opacity-50' : ''}`}
            >
              <Tooltip label="Drag to reorder"><span className="cursor-grab active:cursor-grabbing text-[#94A3B8] hover:text-[#475569] shrink-0" aria-label="Drag to reorder"><GripVertical size={16} /></span></Tooltip>
              <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] text-xs font-bold">{idx + 1}</span>
              <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="flex-1 min-w-0 truncate text-sm font-semibold text-[#0F172A]">{item.label}</span>
              {rankLabel && <span className="hidden sm:inline text-[11px] font-medium text-[#475569]">{rankLabel}</span>}
              <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
              <div className="flex flex-col shrink-0">
                <button type="button" disabled={idx === 0 || savingOrder} onClick={() => move(idx, idx - 1)} aria-label="Move up" className="w-7 h-5 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] disabled:text-[#E2E8F0] disabled:hover:bg-transparent transition-colors"><ChevronUp size={15} /></button>
                <button type="button" disabled={idx === items.length - 1 || savingOrder} onClick={() => move(idx, idx + 1)} aria-label="Move down" className="w-7 h-5 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] disabled:text-[#E2E8F0] disabled:hover:bg-transparent transition-colors"><ChevronDown size={15} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Statuses are shown as one top-to-bottom flow: Not Started → In Progress stages (ordered)
// → Completed → Incomplete. The three singletons are plain one-line rows; only In Progress
// is a section you can add to and reorder.

function StatusesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ label: '', color: '#2563EB' })
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState({ label: '', color: '#0891B2' })
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
    if (!addForm.label.trim()) return
    setSubmitting(true); setError(null)
    try {
      const maxOrder = items.reduce((m, s) => Math.max(m, s.order_index), 0)
      const item = await tasksApi.createStatus(orgId, { label: addForm.label.trim(), type: 'in_progress', color: addForm.color, order_index: maxOrder + 1, is_active: true } as Omit<TaskStatus, 'id' | 'organization_id'>)
      setItems((prev) => [...prev, item])
      setAddForm({ label: '', color: '#0891B2' }); setAdding(false)
    } catch (e) { setError(apiError(e) ?? 'Could not add stage.') } finally { setSubmitting(false) }
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.label.trim()) return
    setSubmitting(true); setError(null)
    try {
      const updated = await tasksApi.updateStatus(orgId, id, { label: editForm.label.trim(), color: editForm.color })
      setItems((prev) => prev.map((s) => (s.id === id ? updated : s)))
      setEditingId(null)
    } catch (e) { setError(apiError(e) ?? 'Could not save changes.') } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this In Progress stage?')) return
    setError(null)
    try {
      await tasksApi.deleteStatus(orgId, id)
      setItems((prev) => prev.filter((s) => s.id !== id))
    } catch (e) { setError(apiError(e) ?? 'Could not remove stage.') }
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
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      </div>
    )
  }

  function EditRow({ id }: { id: string }) {
    return (
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Label"><input type="text" autoFocus value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} className={inputCls} /></FormField>
          <FormField label="Color"><ColorPicker value={editForm.color} onChange={(c) => setEditForm({ ...editForm, color: c })} /></FormField>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSaveEdit(id)} disabled={submitting} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"><Save size={14} /> {submitting ? 'Saving...' : 'Save'}</button>
          <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
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
      <div key={item.id} className="flex items-center gap-2.5 bg-white border border-[#E2E8F0] rounded-[8px] pl-3 pr-2 py-2">
        <span className="w-[78px] shrink-0 flex items-center">
          {stage
            ? <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] text-[11px] font-bold">{idx + 1}</span>
            : <span className="text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">{role}</span>}
        </span>
        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-[#0F172A]">{item.label}</span>
        {stage && (
          <div className="flex items-center shrink-0">
            <button type="button" disabled={idx === 0 || savingOrder} onClick={() => move(idx, -1)} aria-label="Move up" className="w-6 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] disabled:text-[#E2E8F0] disabled:hover:bg-transparent transition-colors"><ChevronUp size={15} /></button>
            <button type="button" disabled={idx === inProgress.length - 1 || savingOrder} onClick={() => move(idx, 1)} aria-label="Move down" className="w-6 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] disabled:text-[#E2E8F0] disabled:hover:bg-transparent transition-colors"><ChevronDown size={15} /></button>
          </div>
        )}
        <button type="button" onClick={() => startEdit(item)} aria-label="Rename" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors shrink-0"><Pencil size={13} /></button>
        {stage && (
          <Tooltip label={inProgress.length <= 1 ? 'At least one In Progress stage is required' : 'Remove stage'}><button type="button" onClick={() => handleDelete(item.id)} disabled={inProgress.length <= 1} aria-label="Remove stage" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] disabled:text-[#E2E8F0] disabled:hover:bg-transparent transition-colors shrink-0"><Trash2 size={13} /></button></Tooltip>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5 max-w-2xl">
      {error && <div className="text-sm text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-3 py-2 mb-1">{error}</div>}

      {notStarted && lineFor(notStarted, 'Start', false, -1)}

      {inProgress.map((s, i) => lineFor(s, 'In progress', true, i))}

      {adding ? (
        <div className="flex items-center gap-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] pl-3 pr-2 py-2">
          <span className="w-[78px] shrink-0" />
          <input type="color" value={addForm.color} onChange={(e) => setAddForm({ ...addForm, color: e.target.value })} className="w-7 h-7 shrink-0 rounded-[6px] border border-[#CBD5E1] cursor-pointer p-0" />
          <input type="text" autoFocus value={addForm.label} onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setAddForm({ label: '', color: '#0891B2' }) } }} placeholder="New stage name (e.g. In Review)" className="flex-1 min-w-0 border border-[#CBD5E1] rounded-[6px] px-2.5 py-1.5 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white" />
          <button onClick={handleAdd} disabled={submitting || !addForm.label.trim()} className="px-3 py-1.5 text-sm font-semibold text-white bg-[#2563EB] rounded-[6px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors shrink-0">{submitting ? 'Adding…' : 'Add'}</button>
          <button onClick={() => { setAdding(false); setAddForm({ label: '', color: '#0891B2' }) }} aria-label="Cancel" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors shrink-0"><X size={15} /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="w-[78px] shrink-0" />
          <button onClick={() => { setAdding(true); setError(null) }} className="flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] py-1 transition-colors"><Plus size={14} /> Add In Progress stage</button>
        </div>
      )}

      {completed && lineFor(completed, 'Completed', false, -1)}
      {partiallyCompleted && lineFor(partiallyCompleted, 'Partial', false, -1)}
      {incomplete && lineFor(incomplete, 'Incomplete', false, -1)}
    </div>
  )
}

function ChecklistTemplatesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templateItems, setTemplateItems] = useState<string[]>([''])
  const [accessMode, setAccessMode] = useState<ChecklistAccessMode>('everyone')
  const [accessRules, setAccessRules] = useState<LocalRule[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Access-rule data sources (loaded once).
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [showImport, setShowImport] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const itemRefs = useRef<(HTMLInputElement | null)[]>([])
  const undoStack = useRef<string[][]>([])
  const itemsRef = useRef(templateItems)
  const editingLine = useRef<number | null>(null)
  useEffect(() => { itemsRef.current = templateItems }, [templateItems])

  // Snapshot the list before a structural change so Ctrl+Z can restore it.
  function pushHistory() {
    undoStack.current.push(itemsRef.current)
    editingLine.current = null
  }

  function restoreLastSnapshot() {
    const snapshot = undoStack.current.pop()
    if (snapshot) { setTemplateItems(snapshot); editingLine.current = null }
  }

  function handleItemChange(idx: number, value: string) {
    // Coalesce consecutive edits of the same line into one undo step, capturing
    // the state (with its text) from before editing started.
    if (editingLine.current !== idx) {
      undoStack.current.push(itemsRef.current)
      editingLine.current = idx
    }
    setTemplateItems((prev) => prev.map((p, i) => i === idx ? value : p))
    if (error) setError(null)
  }

  function handleItemKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    // Undo line removals / edits (falls through to native text undo when empty)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && undoStack.current.length > 0) {
      e.preventDefault()
      restoreLastSnapshot()
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    // Empty line: don't open a new entry
    if (!templateItems[idx].trim()) return
    editingLine.current = null
    if (idx === templateItems.length - 1) {
      // Last line: append a fresh line and focus it
      setTemplateItems((prev) => [...prev, ''])
      requestAnimationFrame(() => itemRefs.current[idx + 1]?.focus())
    } else {
      // Move to the next existing line
      itemRefs.current[idx + 1]?.focus()
    }
  }

  function handleItemBlur(idx: number) {
    // An emptied line collapses when you leave it. The pre-edit snapshot (taken
    // in handleItemChange) already holds the text, so Ctrl+Z restores line + text.
    editingLine.current = null
    setTemplateItems((prev) => {
      if (prev.length <= 1 || prev[idx].trim()) return prev
      return prev.filter((_, i) => i !== idx)
    })
  }

  const reloadTemplates = useCallback(() => {
    return tasksApi.getChecklistTemplates(orgId).then(setItems).catch(() => setItems([]))
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    reloadTemplates().finally(() => setLoading(false))
    getDepartments(orgId).then(setDepartments).catch(() => setDepartments([]))
    getRoles(orgId).then(setRoles).catch(() => setRoles([]))
    getEmployees(orgId).then(setEmployees).catch(() => setEmployees([]))
  }, [orgId, reloadTemplates])

  async function toggleActive(t: ChecklistTemplate) {
    setTogglingId(t.id)
    try {
      const updated = await tasksApi.updateChecklistTemplate(orgId, t.id, { is_active: !t.is_active })
      setItems((prev) => prev.map((x) => (x.id === t.id ? updated : x)))
    } catch { /* ignore */ } finally { setTogglingId(null) }
  }

  function resetForm() {
    setTemplateName(''); setTemplateItems(['']); setAccessMode('everyone'); setAccessRules([])
    setError(null); undoStack.current = []; editingLine.current = null
  }

  function openCreate() {
    resetForm(); setEditingId(null); setFormOpen(true)
  }

  function openEdit(t: ChecklistTemplate) {
    resetForm()
    setEditingId(t.id)
    setTemplateName(t.name)
    const titles = (t.items ?? []).map((i) => i.title)
    setTemplateItems(titles.length > 0 ? titles : [''])
    setAccessMode(t.access_mode ?? 'everyone')
    setAccessRules(
      (t.access_rules ?? []).map((r) => ({
        _key: newRuleKey(),
        kind: r.kind,
        department_id: r.department_id ?? undefined,
        include_sub_departments: r.include_sub_departments,
        role_id: r.role_id ?? undefined,
        user_id: r.user_id ?? undefined,
      })),
    )
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false); setEditingId(null); resetForm()
  }

  async function handleSubmit() {
    const name = templateName.trim()
    const cleanItems = templateItems.filter((t) => t.trim())
    if (!name && cleanItems.length === 0) { setError('Add a template name and at least one item.'); return }
    if (!name) { setError('Template name is required.'); return }
    if (cleanItems.length === 0) { setError('Add at least one checklist item.'); return }

    // Validate access rules when restricted: each grant must name a target.
    // exclude_user rows (removed-people exceptions) ride along but aren't grants.
    let rulesPayload: { kind: 'department' | 'role' | 'user' | 'exclude_user' | 'exclude_role'; department_id?: string; include_sub_departments?: boolean; role_id?: string; user_id?: string }[] = []
    if (accessMode === 'restricted') {
      rulesPayload = accessRules
        .filter((r) =>
          (r.kind === 'department' && r.department_id) ||
          ((r.kind === 'role' || r.kind === 'exclude_role') && r.role_id) ||
          ((r.kind === 'user' || r.kind === 'exclude_user') && r.user_id),
        )
        .map((r) => ({
          kind: r.kind,
          department_id: r.kind === 'department' ? r.department_id : undefined,
          include_sub_departments: r.kind === 'department' ? (r.include_sub_departments ?? true) : undefined,
          role_id: r.kind === 'role' || r.kind === 'exclude_role' ? r.role_id : undefined,
          user_id: r.kind === 'user' || r.kind === 'exclude_user' ? r.user_id : undefined,
        }))
      if (!rulesPayload.some((r) => r.kind === 'department' || r.kind === 'role' || r.kind === 'user')) {
        setError('Restricted access needs at least one department, role, or person — or switch to Everyone.')
        return
      }
    }

    setError(null)
    setSubmitting(true)
    const payload = {
      name,
      items: cleanItems.map((t, i) => ({ title: t.trim(), order_index: i })),
      access_mode: accessMode,
      access_rules: rulesPayload,
    }
    try {
      if (editingId) {
        const updated = await tasksApi.updateChecklistTemplate(orgId, editingId, payload)
        setItems((prev) => prev.map((t) => (t.id === editingId ? updated : t)))
      } else {
        const created = await tasksApi.createChecklistTemplate(orgId, payload)
        setItems((prev) => [...prev, created])
      }
      closeForm()
    } catch (e) { setError(apiError(e) ?? 'Could not save the template. Please try again.') } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    try {
      await tasksApi.deleteChecklistTemplate(orgId, id)
      setItems((prev) => prev.filter((t) => t.id !== id))
    } catch { /* ignore */ }
  }

  if (loading) return <Spinner />

  const accessSummary = (t: ChecklistTemplate): string => {
    if ((t.access_mode ?? 'everyone') === 'everyone') return 'Everyone'
    const rules = t.access_rules ?? []
    const d = rules.filter((r) => r.kind === 'department').length
    const r = rules.filter((x) => x.kind === 'role').length
    const u = rules.filter((x) => x.kind === 'user').length
    const parts: string[] = []
    if (d) parts.push(`${d} dept${d !== 1 ? 's' : ''}`)
    if (r) parts.push(`${r} role${r !== 1 ? 's' : ''}`)
    if (u) parts.push(`${u} ${u !== 1 ? 'people' : 'person'}`)
    return parts.length ? `Restricted · ${parts.join(', ')}` : 'Restricted'
  }

  if (formOpen) {
    return (
      <div className="space-y-5 max-w-6xl">
        <div className="flex items-center gap-3">
          <button onClick={closeForm} aria-label="Back to templates" className="w-9 h-9 flex items-center justify-center rounded-[8px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9] transition-colors shrink-0"><ArrowLeft size={18} /></button>
          <div>
            <h2 className="text-[22px] font-semibold text-[#0F172A] leading-tight">{editingId ? 'Edit Checklist Template' : 'New Checklist Template'}</h2>
            <p className="text-sm text-[#475569]">{editingId ? 'Update the name, items, and who can use this template.' : 'Name the template, add its items, and choose who can use it.'}</p>
          </div>
        </div>

        {/* Single column: name + items card on top, access card full-width below. */}
        <div className="space-y-6">
          {/* Name + items */}
          <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 space-y-5">
            <FormField label="Template Name"><input type="text" autoFocus value={templateName} onChange={(e) => { setTemplateName(e.target.value); if (error) setError(null) }} placeholder="e.g. Onboarding Checklist" className={`${inputCls} max-w-xl`} /></FormField>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Items</label>
              <p className="text-xs text-[#64748B] mb-2">Press Enter to add the next item. Ctrl+Z undoes a removal.</p>
              {templateItems.map((item, idx) => (
                <div key={idx} className="relative mb-2 max-w-xl">
                  <input ref={(el) => { itemRefs.current[idx] = el }} type="text" value={item} onChange={(e) => handleItemChange(idx, e.target.value)} onKeyDown={(e) => handleItemKeyDown(e, idx)} onBlur={() => handleItemBlur(idx)} placeholder={`Item ${idx + 1}`} className={`${inputCls} pr-9`} />
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => { pushHistory(); setTemplateItems((prev) => prev.length <= 1 ? [''] : prev.filter((_, i) => i !== idx)) }} className="absolute top-0 right-0 h-[38px] w-9 flex items-center justify-center text-[#94A3B8] hover:text-[#DC2626] transition-colors" aria-label="Remove item"><X size={14} /></button>
                </div>
              ))}
              <button onClick={() => { pushHistory(); setTemplateItems((prev) => [...prev, '']) }} className="flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors mt-1"><Plus size={13} /> Add item</button>
            </div>
          </div>

          {/* Access rules card — full width below items */}
          <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
            <ChecklistAccessEditor
              mode={accessMode}
              rules={accessRules}
              onModeChange={setAccessMode}
              onRulesChange={setAccessRules}
              departments={departments}
              roles={roles}
              employees={employees}
            />
          </div>
        </div>

        {error && <p className="text-sm font-medium text-[#DC2626]">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Create Template'}</button>
          <button onClick={closeForm} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showImport && (
        <ImportChecklistsModal
          orgId={orgId}
          onClose={() => setShowImport(false)}
          onImported={reloadTemplates}
        />
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} template{items.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"><Upload size={14} /> Import Checklists</button>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Template</button>
        </div>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-[#475569] text-sm">No checklist templates yet.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        {items.map((t) => {
          const count = (t.items ?? []).length
          const restricted = (t.access_mode ?? 'everyone') === 'restricted'
          const active = t.is_active
          return (
            <div key={t.id} className={['bg-white border rounded-[10px] p-4 hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all', active ? 'border-[#E2E8F0] hover:border-[#CBD5E1]' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC]'].join(' ')}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className={['text-sm font-semibold leading-snug', active ? 'text-[#0F172A]' : 'text-[#64748B]'].join(' ')}>{t.name}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(t)} aria-label="Edit" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"><Pencil size={13} /></button>
                  <button onClick={() => handleDelete(t.id)} aria-label="Delete" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="space-y-1.5">
                {(t.items ?? []).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="w-3.5 h-3.5 rounded-[4px] border border-[#CBD5E1] shrink-0 mt-0.5" />
                    <span className="text-xs text-[#475569] leading-snug">{item.title}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F1F5F9] flex-wrap">
                <span className="text-[11px] font-medium rounded-[999px] px-2 py-0.5 bg-[#EFF6FF] text-[#2563EB]">{count} item{count !== 1 ? 's' : ''}</span>
                <span className={['text-[11px] font-medium rounded-[999px] px-2 py-0.5', restricted ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#F1F5F9] text-[#475569]'].join(' ')}>{accessSummary(t)}</span>
                <span className={['text-[11px] font-medium rounded-[999px] px-2 py-0.5', active ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F1F5F9] text-[#64748B]'].join(' ')}>{active ? 'Active' : 'Inactive'}</span>
                <button
                  onClick={() => toggleActive(t)}
                  disabled={togglingId === t.id}
                  className={['ml-auto text-[12px] font-semibold rounded-[6px] px-2.5 py-1 transition-colors disabled:opacity-60', active ? 'text-[#475569] bg-white border border-[#E2E8F0] hover:bg-[#F1F5F9]' : 'text-white bg-[#16A34A] hover:bg-[#15803D]'].join(' ')}
                >
                  {togglingId === t.id ? '…' : active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Ticket Masters Tabs ──────────────────────────────────────────────────────

type TicketMasterTab = 'config' | 'types' | 'categories' | 'priorities' | 'statuses' | 'resolver-groups' | 'templates'

function TktConfigTab({ orgId }: { orgId: string }) {
  const [config, setConfig] = useState<TicketMasterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ticketsApi.getConfig(orgId).then(setConfig).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await ticketsApi.updateConfig(orgId, config)
      setConfig(updated); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  if (loading) return <Spinner />
  if (!config) return <p className="text-sm text-[#475569]">Could not load configuration.</p>

  const modeOptions: { value: TicketReassignmentMode; label: string; desc: string }[] = [
    { value: 'both', label: 'Both', desc: 'Assignee and administrators can reassign' },
    { value: 'assignee_only', label: 'Assignee Only', desc: 'Only the current assignee can reassign' },
    { value: 'admin_manager_only', label: 'Administrators Only', desc: 'Only administrators can reassign' },
  ]

  return (
    <div className="space-y-6 max-w-xl">
      <FormField label="Reassignment Mode">
        <div className="space-y-2">
          {modeOptions.map((opt) => (
            <button key={opt.value} type="button" onClick={() => setConfig({ ...config, reassignment_mode: opt.value })}
              className={`w-full flex items-start gap-3 p-3 rounded-[8px] border-2 text-left transition-all ${config.reassignment_mode === opt.value ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:border-[#CBD5E1]'}`}>
              <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${config.reassignment_mode === opt.value ? 'border-[#2563EB] bg-[#2563EB]' : 'border-[#CBD5E1]'}`} />
              <div>
                <p className={`text-sm font-semibold ${config.reassignment_mode === opt.value ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{opt.label}</p>
                <p className="text-xs text-[#475569]">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Default Escalation Levels">
          <input type="number" min={0} max={5} value={config.default_escalation_levels}
            onChange={(e) => setConfig({ ...config, default_escalation_levels: parseInt(e.target.value) || 0 })}
            className={inputCls} />
        </FormField>
        <FormField label="Escalation Interval (hours)">
          <input type="number" min={1} value={config.escalation_interval_hours}
            onChange={(e) => setConfig({ ...config, escalation_interval_hours: parseInt(e.target.value) || 1 })}
            className={inputCls} />
        </FormField>
        <FormField label="Default Response SLA (hours, optional)">
          <input type="number" min={1} value={config.default_response_sla_hours ?? ''}
            onChange={(e) => setConfig({ ...config, default_response_sla_hours: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="No response SLA" className={inputCls} />
        </FormField>
      </div>

      <div className="space-y-3">
        {[
          { key: 'require_raiser_confirmation' as const, label: 'Require raiser confirmation before closing', desc: 'Ticket stays in "Resolved" until the raiser confirms their issue is fixed' },
          { key: 'enable_rating' as const, label: 'Enable ticket rating', desc: 'Raiser can rate the resolution quality (1–5 stars) after ticket is closed' },
          { key: 'allow_requester_reopen' as const, label: 'Allow requester to reopen', desc: 'The person who raised the ticket can reopen it after it is resolved or closed' },
          { key: 'allow_assignee_reopen' as const, label: 'Allow assignee to reopen', desc: 'The assigned resolver can reopen a ticket after it is resolved or closed' },
        ].map(({ key, label, desc }) => (
          <div key={key} className={`flex items-start gap-3 p-3 rounded-[8px] border-2 cursor-pointer transition-all ${config[key] ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0]'}`} onClick={() => setConfig({ ...config, [key]: !config[key] })}>
            <div className={`relative w-9 h-5 rounded-full mt-0.5 shrink-0 transition-colors duration-200 ${config[key] ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${config[key] ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${config[key] ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{label}</p>
              <p className="text-xs text-[#475569] mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors">
        <Save size={15} /> {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Configuration'}
      </button>
    </div>
  )
}

function TktTypesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketType[]>([])
  const [groups, setGroups] = useState<TicketResolverGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const emptyForm = { name: '', icon: '🎫', color: '#2563EB', default_sla_days: 3, default_response_sla_hours: '', resolver_group_id: '', description: '' }
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
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      const item = await ticketsApi.createType(orgId, { name: form.name.trim(), icon: form.icon, color: form.color, default_sla_days: form.default_sla_days, default_response_sla_hours: form.default_response_sla_hours ? parseInt(form.default_response_sla_hours) : null, resolver_group_id: form.resolver_group_id || null, description: form.description.trim() || undefined, is_active: true })
      setItems((prev) => [...prev, item]); setForm({ ...emptyForm }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleEdit(id: string) {
    if (!editForm.name.trim()) return
    setSubmitting(true)
    try {
      const updated = await ticketsApi.updateType(orgId, id, { name: editForm.name.trim(), icon: editForm.icon, color: editForm.color, default_sla_days: editForm.default_sla_days, default_response_sla_hours: editForm.default_response_sla_hours ? parseInt(editForm.default_response_sla_hours) : null, resolver_group_id: editForm.resolver_group_id || null, description: editForm.description.trim() || undefined })
      setItems((prev) => prev.map((i) => i.id === id ? updated : i)); setEditingId(null)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this type?')) return
    await ticketsApi.deleteType(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function TypeForm({ f, setF, onSave, onCancel, label }: { f: typeof emptyForm; setF: (v: typeof emptyForm) => void; onSave: () => void; onCancel: () => void; label: string }) {
    return (
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Issue" className={inputCls} /></FormField>
          <FormField label="Icon (emoji)"><input type="text" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} className={inputCls} /></FormField>
          <FormField label="Color">
            <div className="flex gap-2 items-center">
              <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
              <input type="text" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className={inputCls} />
            </div>
          </FormField>
          <FormField label="Default SLA Days"><input type="number" min={1} value={f.default_sla_days} onChange={(e) => setF({ ...f, default_sla_days: parseInt(e.target.value) || 1 })} className={inputCls} /></FormField>
          <FormField label="Default Response SLA (hours, optional)"><input type="number" min={1} value={f.default_response_sla_hours} onChange={(e) => setF({ ...f, default_response_sla_hours: e.target.value })} placeholder="No response SLA" className={inputCls} /></FormField>
          <FormField label="Resolver Group (optional)">
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
        <FormField label="Description (optional)"><input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Brief description..." className={inputCls} /></FormField>
        <div className="flex gap-2">
          <button onClick={onSave} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Saving...' : label}</button>
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} type{items.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Type</button>
      </div>
      {creating && <TypeForm f={form} setF={setForm} onSave={handleCreate} onCancel={() => setCreating(false)} label="Create" />}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No ticket types yet. Click "Add Type" to create one.</div>}
      <div className="space-y-2">
        {items.map((item) => editingId === item.id ? (
          <TypeForm key={item.id} f={editForm} setF={setEditForm} onSave={() => handleEdit(item.id)} onCancel={() => setEditingId(null)} label="Save" />
        ) : (
          <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
            <span className="text-xl">{item.icon}</span>
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#0F172A]">{item.name}</p>
              {item.description && <p className="text-xs text-[#475569] truncate">{item.description}</p>}
            </div>
            <span className="text-xs text-[#475569]">SLA: {item.default_sla_days}d</span>
            <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, icon: item.icon, color: item.color, default_sla_days: item.default_sla_days, default_response_sla_hours: item.default_response_sla_hours?.toString() ?? '', resolver_group_id: item.resolver_group_id ?? '', description: item.description ?? '' }) }} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"><Pencil size={13} /></button>
              <button onClick={() => handleDelete(item.id)} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TktCategoriesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketCategory[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [groups, setGroups] = useState<TicketResolverGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const emptyForm = { name: '', color: '#0891B2', ticket_type_id: '', default_sla_days: '', default_response_sla_hours: '', resolver_group_id: '', description: '' }
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
    if (!form.name.trim()) return
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this category?')) return
    await ticketsApi.deleteCategory(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} categor{items.length !== 1 ? 'ies' : 'y'}</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Category</button>
      </div>
      {creating && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Network" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Ticket Type (optional)">
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
            <FormField label="Resolver Group (optional)">
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
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No categories yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#0F172A]">{item.name}</p>
              {item.ticket_type && <p className="text-xs text-[#94A3B8]">{item.ticket_type.icon} {item.ticket_type.name}</p>}
            </div>
            {item.default_sla_days && <span className="text-xs text-[#475569]">SLA: {item.default_sla_days}d</span>}
            <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <button onClick={() => handleDelete(item.id)} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TktPrioritiesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', color: '#DC2626', sla_days: '', order_index: 0 })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    ticketsApi.listPriorities(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.label.trim()) return
    setSubmitting(true)
    try {
      const item = await ticketsApi.createPriority(orgId, { label: form.label.trim(), color: form.color, sla_days: form.sla_days ? parseInt(form.sla_days) : undefined, order_index: form.order_index, is_active: true })
      setItems((prev) => [...prev, item].sort((a, b) => a.order_index - b.order_index))
      setForm({ label: '', color: '#DC2626', sla_days: '', order_index: 0 }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this priority?')) return
    await ticketsApi.deletePriority(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} priorit{items.length !== 1 ? 'ies' : 'y'}</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Priority</button>
      </div>
      {creating && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label"><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Critical" className={inputCls} /></FormField>
            <FormField label="SLA Days (optional)"><input type="number" min={1} value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value })} placeholder="Override SLA" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Order"><input type="number" value={form.order_index} onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value) || 0 })} className={inputCls} /></FormField>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No priorities yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-sm font-semibold text-[#0F172A]">{item.label}</span>
            {item.sla_days && <span className="text-xs text-[#475569]">SLA: {item.sla_days}d</span>}
            <span className="text-xs text-[#475569]">Order: {item.order_index}</span>
            <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
            <button onClick={() => handleDelete(item.id)} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TktStatusesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', type: 'open' as TicketStatusType, color: '#2563EB', order_index: 0, is_default: false })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    ticketsApi.listStatuses(orgId).then((s) => setItems(s.sort((a, b) => a.order_index - b.order_index))).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate() {
    if (!form.label.trim()) return
    setSubmitting(true)
    try {
      const item = await ticketsApi.createStatus(orgId, { label: form.label.trim(), type: form.type, color: form.color, order_index: form.order_index, is_default: form.is_default, is_active: true })
      setItems((prev) => [...prev, item].sort((a, b) => a.order_index - b.order_index))
      setForm({ label: '', type: 'open', color: '#2563EB', order_index: 0, is_default: false }); setCreating(false)
    } catch { /* ignore */ } finally { setSubmitting(false) }
  }

  const statusTypes: TicketStatusType[] = ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed_resolved', 'closed_unresolved']

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} status{items.length !== 1 ? 'es' : ''}</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Status</button>
      </div>
      {creating && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label"><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Pending Review" className={inputCls} /></FormField>
            <FormField label="Type">
              <StyledSelect
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as TicketStatusType })}
                options={statusTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
              />
            </FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-[6px] border border-[#CBD5E1] cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
            <FormField label="Order"><input type="number" value={form.order_index} onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value) || 0 })} className={inputCls} /></FormField>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-[#2563EB] w-4 h-4" />
            <span className="text-sm text-[#1E293B]">Set as default status</span>
          </label>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-[#475569] text-sm">No statuses yet.</div>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="flex-1 text-sm font-semibold text-[#0F172A]">{item.label}</span>
            <span className="text-xs text-[#475569] capitalize">{item.type.replace(/_/g, ' ')}</span>
            {item.is_default && <span className="text-[11px] font-medium rounded-[999px] px-2 py-0.5 bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">Default</span>}
            <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ASSIGNMENT_STRATEGIES: { value: TicketAssignmentStrategy; label: string; desc: string }[] = [
  { value: 'round_robin', label: 'Round-robin', desc: 'Auto-assign one member in rotation' },
  { value: 'claim', label: 'Claim', desc: 'Members pick tickets from the pool' },
  { value: 'manual', label: 'Manual', desc: 'An admin assigns each ticket' },
]

function TktResolverGroupsTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketResolverGroup[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const emptyForm = { name: '', description: '', department_id: '', assignment_strategy: 'round_robin' as TicketAssignmentStrategy, member_user_ids: [] as string[] }
  const [form, setForm] = useState({ ...emptyForm })
  const [memberQuery, setMemberQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    ticketsApi.listResolverGroups(orgId).then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => {
    load()
    getDepartments(orgId).then(setDepartments).catch(() => setDepartments([]))
    getEmployees(orgId).then(setEmployees).catch(() => setEmployees([]))
  }, [orgId, load])

  const empByUserId = React.useMemo(() => new Map(employees.map((e) => [e.user_id, e])), [employees])
  const deptById = React.useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  function resetForm() { setForm({ ...emptyForm }); setMemberQuery(''); setError(null) }
  function openCreate() { resetForm(); setEditingId(null); setFormOpen(true) }
  function openEdit(g: TicketResolverGroup) {
    setForm({
      name: g.name,
      description: g.description ?? '',
      department_id: g.department_id ?? '',
      assignment_strategy: g.assignment_strategy,
      member_user_ids: g.members.map((m) => m.user_id),
    })
    setMemberQuery(''); setError(null); setEditingId(g.id); setFormOpen(true)
  }
  function closeForm() { setFormOpen(false); setEditingId(null); resetForm() }

  function toggleMember(uid: string) {
    setForm((f) => ({
      ...f,
      member_user_ids: f.member_user_ids.includes(uid)
        ? f.member_user_ids.filter((x) => x !== uid)
        : [...f.member_user_ids, uid],
    }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('Group name is required.'); return }
    setSubmitting(true); setError(null)
    const dto = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      department_id: form.department_id || null,
      assignment_strategy: form.assignment_strategy,
      member_user_ids: form.member_user_ids,
    }
    try {
      if (editingId) {
        const updated = await ticketsApi.updateResolverGroup(orgId, editingId, dto)
        setItems((prev) => prev.map((g) => (g.id === editingId ? updated : g)))
      } else {
        const created = await ticketsApi.createResolverGroup(orgId, dto)
        setItems((prev) => [...prev, created])
      }
      closeForm()
    } catch (e) { setError(apiError(e) ?? 'Could not save the resolver group.') } finally { setSubmitting(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this resolver group? Tickets routed to it will need a new group.')) return
    await ticketsApi.deleteResolverGroup(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((g) => g.id !== id))
  }

  if (loading) return <Spinner />

  if (formOpen) {
    const activeEmployees = employees.filter((e) => e.status === 'active')
    const q = memberQuery.trim().toLowerCase()
    const filteredEmployees = q
      ? activeEmployees.filter((e) => (e.user?.name ?? '').toLowerCase().includes(q) || (e.role?.title ?? '').toLowerCase().includes(q) || (e.department?.name ?? '').toLowerCase().includes(q))
      : activeEmployees
    return (
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <button onClick={closeForm} aria-label="Back to resolver groups" className="w-9 h-9 flex items-center justify-center rounded-[8px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9] transition-colors shrink-0"><ArrowLeft size={18} /></button>
          <div>
            <h2 className="text-[22px] font-semibold text-[#0F172A] leading-tight">{editingId ? 'Edit Resolver Group' : 'New Resolver Group'}</h2>
            <p className="text-sm text-[#475569]">A pool of people who resolve tickets routed to this group.</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Group Name"><input type="text" autoFocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (error) setError(null) }} placeholder="e.g. IT Support" className={inputCls} /></FormField>
            <FormField label="Department (optional)">
              <DepartmentSelect
                value={form.department_id}
                onChange={(id) => setForm({ ...form, department_id: id })}
                departments={departments}
                placeholder="Any department…"
                inline
              />
            </FormField>
          </div>
          <FormField label="Description (optional)"><input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this group handles…" className={inputCls} /></FormField>

          <FormField label="Assignment Strategy">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {ASSIGNMENT_STRATEGIES.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setForm({ ...form, assignment_strategy: opt.value })}
                  className={`flex flex-col items-start gap-0.5 p-3 rounded-[8px] border-2 text-left transition-all ${form.assignment_strategy === opt.value ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:border-[#CBD5E1]'}`}>
                  <span className={`text-sm font-semibold ${form.assignment_strategy === opt.value ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{opt.label}</span>
                  <span className="text-[11px] text-[#475569] leading-snug">{opt.desc}</span>
                </button>
              ))}
            </div>
          </FormField>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="block text-sm font-medium text-[#374151]">Members</label>
              <CountPill n={form.member_user_ids.length} />
            </div>
            <div className="border border-[#E2E8F0] rounded-[10px] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F1F5F9] bg-[#F8FAFC]">
                <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search people…" className="flex-1 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none bg-transparent" />
              </div>
              <div className="max-h-[280px] overflow-y-auto divide-y divide-[#F1F5F9]">
                {filteredEmployees.length === 0 && <p className="px-3 py-4 text-sm text-[#94A3B8] text-center">No people found.</p>}
                {filteredEmployees.map((e) => {
                  const checked = form.member_user_ids.includes(e.user_id)
                  return (
                    <label key={e.user_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#F8FAFC] transition-colors">
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(e.user_id)} className="accent-[#2563EB] w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-[#0F172A] truncate">{e.user?.name ?? 'Unknown'}</p>
                        <p className="text-[11px] text-[#94A3B8] truncate">{[e.role?.title, e.department?.name].filter(Boolean).join(' · ')}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-sm font-medium text-[#DC2626]">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Create Group'}</button>
            <button onClick={closeForm} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} group{items.length !== 1 ? 's' : ''}</p>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Group</button>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-[#475569] text-sm">No resolver groups yet. Create one to route tickets to a pool of resolvers.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        {items.map((g) => {
          const strategy = ASSIGNMENT_STRATEGIES.find((s) => s.value === g.assignment_strategy)
          const deptName = g.department_id ? deptById.get(g.department_id)?.name : null
          return (
            <div key={g.id} className={['bg-white border rounded-[10px] p-4 transition-all', g.is_active ? 'border-[#E2E8F0] hover:border-[#CBD5E1]' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC]'].join(' ')}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={['text-sm font-semibold leading-snug truncate', g.is_active ? 'text-[#0F172A]' : 'text-[#64748B]'].join(' ')}>{g.name}</p>
                    <CountPill n={g.members.length} />
                  </div>
                  {g.description && <p className="text-xs text-[#475569] truncate mt-0.5">{g.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(g)} aria-label="Edit" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"><Pencil size={13} /></button>
                  <button onClick={() => handleDelete(g.id)} aria-label="Delete" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="mt-2 max-h-[120px] overflow-y-auto space-y-1">
                {g.members.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">No members yet.</p>
                ) : g.members.map((m) => (
                  <p key={m.id} className="text-xs text-[#475569] truncate">{empByUserId.get(m.user_id)?.user?.name ?? 'Unknown'}</p>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F1F5F9] flex-wrap">
                {deptName && <span className="text-[11px] font-medium rounded-[999px] px-2 py-0.5 bg-[#F1F5F9] text-[#475569]">{deptName}</span>}
                <span className="text-[11px] font-medium rounded-[999px] px-2 py-0.5 bg-[#EFF6FF] text-[#2563EB]">{strategy?.label ?? g.assignment_strategy}</span>
                <span className={['text-[11px] font-medium rounded-[999px] px-2 py-0.5', g.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'].join(' ')}>{g.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TktTemplatesTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<TicketTemplate[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [priorities, setPriorities] = useState<TicketPriority[]>([])
  const [groups, setGroups] = useState<TicketResolverGroup[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const emptyForm = { name: '', template_type: 'simple' as TicketTemplateType, ticket_type_id: '', category_id: '', priority_id: '', resolver_group_id: '', department_id: '', group_label: '', title_template: '', description_template: '', sla_days: '', response_sla_hours: '', lock_priority: false }
  const [form, setForm] = useState({ ...emptyForm })
  const [checklistItems, setChecklistItems] = useState<string[]>([])
  const [accessMode, setAccessMode] = useState<ChecklistAccessMode>('everyone')
  const [accessRules, setAccessRules] = useState<LocalRule[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadTemplates = useCallback(() => ticketsApi.listTemplates(orgId).then(setItems).catch(() => setItems([])), [orgId])

  useEffect(() => {
    setLoading(true)
    Promise.all([reloadTemplates(), ticketsApi.listTypes(orgId).then(setTypes), ticketsApi.listCategories(orgId).then(setCategories), ticketsApi.listPriorities(orgId).then(setPriorities), ticketsApi.listResolverGroups(orgId).then(setGroups)])
      .catch(() => null)
      .finally(() => setLoading(false))
    getDepartments(orgId).then(setDepartments).catch(() => setDepartments([]))
    getRoles(orgId).then(setRoles).catch(() => setRoles([]))
    getEmployees(orgId).then(setEmployees).catch(() => setEmployees([]))
  }, [orgId, reloadTemplates])

  const deptById = React.useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  function resetForm() { setForm({ ...emptyForm }); setChecklistItems([]); setAccessMode('everyone'); setAccessRules([]); setError(null) }
  function openCreate() { resetForm(); setEditingId(null); setFormOpen(true) }
  function openEdit(t: TicketTemplate) {
    setForm({
      name: t.name,
      template_type: t.template_type,
      ticket_type_id: t.ticket_type_id ?? '',
      category_id: t.category_id ?? '',
      priority_id: t.priority_id ?? '',
      resolver_group_id: t.resolver_group_id ?? '',
      department_id: t.department_id ?? '',
      group_label: t.group_label ?? '',
      title_template: t.title_template,
      description_template: t.description_template ?? '',
      sla_days: t.sla_days?.toString() ?? '',
      response_sla_hours: t.response_sla_hours?.toString() ?? '',
      lock_priority: t.lock_priority,
    })
    setChecklistItems((t.checklist_items ?? []).map((c) => c.title))
    setAccessMode(t.access_mode ?? 'everyone')
    setAccessRules((t.access_rules ?? []).map((r) => ({
      _key: newRuleKey(),
      kind: r.kind,
      department_id: r.department_id ?? undefined,
      include_sub_departments: r.include_sub_departments,
      role_id: r.role_id ?? undefined,
      user_id: r.user_id ?? undefined,
    })))
    setEditingId(t.id); setError(null); setFormOpen(true)
  }
  function closeForm() { setFormOpen(false); setEditingId(null); resetForm() }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('Template name is required.'); return }
    if (!form.title_template.trim()) { setError('A title template is required.'); return }

    let rulesPayload: { kind: 'department' | 'role' | 'user' | 'exclude_user' | 'exclude_role'; department_id?: string; include_sub_departments?: boolean; role_id?: string; user_id?: string }[] = []
    if (accessMode === 'restricted') {
      rulesPayload = accessRules
        .filter((r) =>
          (r.kind === 'department' && r.department_id) ||
          ((r.kind === 'role' || r.kind === 'exclude_role') && r.role_id) ||
          ((r.kind === 'user' || r.kind === 'exclude_user') && r.user_id),
        )
        .map((r) => ({
          kind: r.kind,
          department_id: r.kind === 'department' ? r.department_id : undefined,
          include_sub_departments: r.kind === 'department' ? (r.include_sub_departments ?? true) : undefined,
          role_id: r.kind === 'role' || r.kind === 'exclude_role' ? r.role_id : undefined,
          user_id: r.kind === 'user' || r.kind === 'exclude_user' ? r.user_id : undefined,
        }))
      if (!rulesPayload.some((r) => r.kind === 'department' || r.kind === 'role' || r.kind === 'user')) {
        setError('Restricted access needs at least one department, role, or person — or switch to Everyone.')
        return
      }
    }

    setSubmitting(true); setError(null)
    const dto = {
      name: form.name.trim(),
      template_type: form.template_type,
      ticket_type_id: form.ticket_type_id || undefined,
      category_id: form.category_id || undefined,
      priority_id: form.priority_id || undefined,
      resolver_group_id: form.resolver_group_id || null,
      department_id: form.department_id || null,
      group_label: form.group_label.trim() || null,
      title_template: form.title_template.trim(),
      description_template: form.description_template.trim() || undefined,
      sla_days: form.sla_days ? parseInt(form.sla_days) : undefined,
      response_sla_hours: form.response_sla_hours ? parseInt(form.response_sla_hours) : null,
      lock_priority: form.lock_priority,
      checklist_items: checklistItems.filter((c) => c.trim()).map((c) => ({ title: c.trim() })),
      access_mode: accessMode,
      access_rules: rulesPayload,
      is_active: true,
    }
    try {
      if (editingId) {
        const updated = await ticketsApi.updateTemplate(orgId, editingId, dto)
        setItems((prev) => prev.map((i) => (i.id === editingId ? updated : i)))
      } else {
        const created = await ticketsApi.createTemplate(orgId, dto)
        setItems((prev) => [created, ...prev])
      }
      closeForm()
    } catch (e) { setError(apiError(e) ?? 'Could not save the template.') } finally { setSubmitting(false) }
  }

  async function handleArchive(id: string) {
    if (!confirm('Archive this template? It will no longer appear for new tickets.')) return
    await ticketsApi.archiveTemplate(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const accessSummary = (t: TicketTemplate): string => {
    if ((t.access_mode ?? 'everyone') === 'everyone') return 'Everyone'
    const rules = t.access_rules ?? []
    const d = rules.filter((r) => r.kind === 'department').length
    const r = rules.filter((x) => x.kind === 'role').length
    const u = rules.filter((x) => x.kind === 'user').length
    const parts: string[] = []
    if (d) parts.push(`${d} dept${d !== 1 ? 's' : ''}`)
    if (r) parts.push(`${r} role${r !== 1 ? 's' : ''}`)
    if (u) parts.push(`${u} ${u !== 1 ? 'people' : 'person'}`)
    return parts.length ? `Restricted · ${parts.join(', ')}` : 'Restricted'
  }

  if (loading) return <Spinner />

  if (formOpen) {
    return (
      <div className="space-y-5 max-w-6xl">
        <div className="flex items-center gap-3">
          <button onClick={closeForm} aria-label="Back to templates" className="w-9 h-9 flex items-center justify-center rounded-[8px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9] transition-colors shrink-0"><ArrowLeft size={18} /></button>
          <div>
            <h2 className="text-[22px] font-semibold text-[#0F172A] leading-tight">{editingId ? 'Edit Ticket Template' : 'New Ticket Template'}</h2>
            <p className="text-sm text-[#475569]">Pre-fill ticket fields and choose who can use this template.</p>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Template Name"><input type="text" autoFocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (error) setError(null) }} placeholder="e.g. VPN Access Request" className={inputCls} /></FormField>
            <FormField label="Type">
              <div className="flex gap-2">
                {(['simple', 'full'] as TicketTemplateType[]).map((t) => (
                  <button key={t} type="button" onClick={() => setForm({ ...form, template_type: t })} className={`flex-1 py-[9px] rounded-[8px] text-sm font-semibold border-2 transition-colors ${form.template_type === t ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E2E8F0] text-[#475569]'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Ticket Type (optional)">
              <StyledSelect
                value={form.ticket_type_id}
                onChange={(v) => setForm({ ...form, ticket_type_id: v })}
                placeholder="Any type"
                options={[
                  { value: '', label: 'Any type' },
                  ...types.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}`, color: t.color })),
                ]}
              />
            </FormField>
            <FormField label="Category (optional)">
              <StyledSelect
                value={form.category_id}
                onChange={(v) => setForm({ ...form, category_id: v })}
                placeholder="Any category"
                options={[
                  { value: '', label: 'Any category' },
                  ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                ]}
              />
            </FormField>
            <FormField label="Priority (optional)">
              <StyledSelect
                value={form.priority_id}
                onChange={(v) => setForm({ ...form, priority_id: v })}
                placeholder="Any priority"
                options={[
                  { value: '', label: 'Any priority' },
                  ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
                ]}
              />
            </FormField>
            <FormField label="Resolver Group (optional)">
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
            <FormField label="Catalog Department (optional)">
              <DepartmentSelect
                value={form.department_id}
                onChange={(id) => setForm({ ...form, department_id: id })}
                departments={departments}
                placeholder="No grouping…"
                inline
              />
            </FormField>
            <FormField label="Group Label (optional)"><input type="text" value={form.group_label} onChange={(e) => setForm({ ...form, group_label: e.target.value })} placeholder="e.g. Access Requests" className={inputCls} /></FormField>
            <FormField label="SLA Override (days, optional)"><input type="number" min={1} value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value })} placeholder="Inherits from type/category" className={inputCls} /></FormField>
            <FormField label="Response SLA (hours, optional)"><input type="number" min={1} value={form.response_sla_hours} onChange={(e) => setForm({ ...form, response_sla_hours: e.target.value })} placeholder="Inherits from type/category" className={inputCls} /></FormField>
          </div>

          <div className={`flex items-start gap-3 p-3 rounded-[8px] border-2 cursor-pointer transition-all ${form.lock_priority ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0]'}`} onClick={() => setForm({ ...form, lock_priority: !form.lock_priority })}>
            <div className={`relative w-9 h-5 rounded-full mt-0.5 shrink-0 transition-colors duration-200 ${form.lock_priority ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.lock_priority ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${form.lock_priority ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>Lock priority</p>
              <p className="text-xs text-[#475569] mt-0.5">The raiser can&apos;t change the priority when using this template.</p>
            </div>
          </div>

          <FormField label="Title Template *"><input type="text" value={form.title_template} onChange={(e) => { setForm({ ...form, title_template: e.target.value }); if (error) setError(null) }} placeholder="Pre-filled ticket title" className={inputCls} /></FormField>
          <FormField label="Description Template (optional)">
            <textarea value={form.description_template} onChange={(e) => setForm({ ...form, description_template: e.target.value })} rows={2} placeholder="Pre-filled description..." className={`${inputCls} resize-none`} />
          </FormField>
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Checklist Items</label>
            {checklistItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mb-2 max-w-xl">
                <input type="text" value={item} onChange={(e) => setChecklistItems((prev) => prev.map((v, i) => i === idx ? e.target.value : v))} placeholder={`Item ${idx + 1}`} className={inputCls} />
                <button onClick={() => setChecklistItems((prev) => prev.filter((_, i) => i !== idx))} className="w-8 h-[38px] flex items-center justify-center text-[#94A3B8] hover:text-[#DC2626] transition-colors"><X size={14} /></button>
              </div>
            ))}
            <button onClick={() => setChecklistItems((prev) => [...prev, ''])} className="flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors mt-1"><Plus size={13} /> Add item</button>
          </div>
        </div>

        {/* Access rules — who can pick this template when raising a ticket */}
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
          <ChecklistAccessEditor
            mode={accessMode}
            rules={accessRules}
            onModeChange={setAccessMode}
            onRulesChange={setAccessRules}
            departments={departments}
            roles={roles}
            employees={employees}
          />
        </div>

        {error && <p className="text-sm font-medium text-[#DC2626]">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">{submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Create Template'}</button>
          <button onClick={closeForm} className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  // Group templates by catalog department / group label for scannable section headers.
  const sections = (() => {
    const map = new Map<string, { label: string; templates: TicketTemplate[] }>()
    for (const t of items) {
      const deptName = t.department_id ? deptById.get(t.department_id)?.name : null
      const label = [deptName, t.group_label].filter(Boolean).join(' · ') || 'Ungrouped'
      const key = `${t.department_id ?? ''}::${t.group_label ?? ''}`
      if (!map.has(key)) map.set(key, { label, templates: [] })
      map.get(key)!.templates.push(t)
    }
    return Array.from(map.values()).sort((a, b) => (a.label === 'Ungrouped' ? 1 : b.label === 'Ungrouped' ? -1 : a.label.localeCompare(b.label)))
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">{items.length} template{items.length !== 1 ? 's' : ''}</p>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"><Plus size={14} /> Add Template</button>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-[#475569] text-sm">No templates yet.</div>}
      {sections.map((section) => (
        <div key={section.label} className="space-y-2">
          <div className="flex items-center gap-2 pt-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">{section.label}</h3>
            <CountPill n={section.templates.length} />
          </div>
          {section.templates.map((item) => (
            <div key={item.id} className="bg-white border border-[#E2E8F0] rounded-[8px] px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="text-sm font-semibold text-[#0F172A]">{item.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${item.template_type === 'full' ? 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]' : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]'}`}>{item.template_type}</span>
                  {item.resolver_group?.name && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569]">{item.resolver_group.name}</span>}
                  {item.lock_priority && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309]">Priority locked</span>}
                </div>
                <p className="text-xs text-[#94A3B8] truncate">{item.title_template}</p>
              </div>
              <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${(item.access_mode ?? 'everyone') === 'restricted' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#F1F5F9] text-[#475569]'}`}>{accessSummary(item)}</span>
              {item.checklist_items.length > 0 && <span className="text-xs text-[#475569]">{item.checklist_items.length} items</span>}
              <span className={`text-[11px] font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>{item.is_active ? 'Active' : 'Archived'}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(item)} aria-label="Edit" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"><Pencil size={13} /></button>
                {item.is_active && (
                  <Tooltip label="Archive"><button onClick={() => handleArchive(item.id)} aria-label="Archive" className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"><Trash2 size={13} /></button></Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Notification Masters ─────────────────────────────────────────────────────

const NOTIF_EVENT_LABELS: Record<string, string> = {
  task_assigned: 'Task assigned (incl. CC)',
  task_completed: 'Task completed',
  task_reopened: 'Task reopened',
  task_comment: 'New comment on a task',
  task_reminder: 'Task reminder',
  task_overdue: 'Task overdue',
  task_overdue_followup: 'Task still overdue (follow-up)',
  task_escalated: 'Task escalated',
  recurring_spawned: 'Recurring task created',
  project_created: 'Project created',
  project_member_added: 'Added to a project',
  milestone_completed: 'Milestone achieved',
  workflow_triggered: 'Workflow started (new instance)',
  workflow_step_assigned: 'Workflow step assigned',
  workflow_step_upcoming: 'Your workflow step is starting soon',
  workflow_step_overdue: 'Workflow step overdue',
  workflow_upstream_delay: 'Upstream step delayed',
  workflow_completed: 'Workflow instance completed',
  workflow_stuck: 'Workflow instance stuck — needs attention',
  workflow_task_withdrawn: 'Workflow task withdrawn',
  workflow_sent_back: 'Workflow step sent back to you',
  workflow_step_late: 'Workflow step late',
  workflow_note_added: 'Message left for your workflow step',
  workflow_discussion: 'New message in a workflow instance discussion',
  workflow_mention: 'Mentioned in a workflow instance discussion',
  workflow_creator_changed: 'Made creator of a workflow',
  ticket_raised: 'Ticket raised / assigned',
  ticket_status_changed: 'Ticket status changed',
  ticket_sla_breached: 'Ticket SLA breached',
  ticket_escalated: 'Ticket escalated',
  ticket_comment: 'New comment on a ticket',
}

const NOTIF_MODULE_LABELS: Record<string, string> = {
  tasks: 'Tasks',
  projects: 'Projects',
  workflows: 'Workflows',
  tickets: 'Tickets',
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className={[
        'inline-flex items-center w-9 h-5 rounded-full px-0.5 transition-colors shrink-0',
        on ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]',
      ].join(' ')}
    >
      <span
        className={[
          'block w-4 h-4 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

function NotificationsMasterTab({ orgId }: { orgId: string }) {
  const [master, setMaster] = useState<NotificationMaster | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    notificationsApi.getMaster(orgId).then(setMaster).catch(() => null).finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <Spinner />
  if (!master) return <p className="text-sm text-[#475569]">Could not load notification settings.</p>

  const toggles = master.event_toggles ?? {}
  const isOn = (event: string) => toggles[event] !== false // absent ⇒ on

  function flip(event: string) {
    setMaster((prev) => prev && ({
      ...prev,
      event_toggles: { ...(prev.event_toggles ?? {}), [event]: !isOn(event) },
    }))
  }

  async function handleSave() {
    if (!master) return
    setSaving(true)
    try {
      const updated = await notificationsApi.updateMaster(orgId, {
        event_toggles: master.event_toggles,
        overdue_followup_days: master.overdue_followup_days,
      })
      setMaster({ ...updated, catalog: master.catalog })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const catalog = master.catalog ?? {}
  const modules = Object.keys(NOTIF_MODULE_LABELS).filter((m) => (catalog[m] ?? []).length > 0)

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-[#475569]">
        Switch individual notifications on or off for everyone in this organization.
      </p>

      {modules.map((mod) => (
        <div key={mod} className="border border-[#E2E8F0] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0]">
            <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider">{NOTIF_MODULE_LABELS[mod]}</p>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {(catalog[mod] ?? []).map((event) => (
              <div key={event} className="flex items-center justify-between px-4 py-2.5 gap-4">
                <span className="text-sm text-[#0F172A]">{NOTIF_EVENT_LABELS[event] ?? event}</span>
                <Toggle on={isOn(event)} onChange={() => flip(event)} />
              </div>
            ))}
            {mod === 'tasks' && (
              <div className="flex items-center justify-between px-4 py-2.5 gap-4 bg-[#FFFBEB]/50">
                <span className="text-sm text-[#0F172A]">Overdue follow-up after (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={master.overdue_followup_days}
                  onChange={(e) => setMaster({ ...master, overdue_followup_days: parseInt(e.target.value) || 1 })}
                  className="w-20 border border-[#CBD5E1] rounded-[8px] px-2 py-1.5 text-sm text-[#0F172A] focus:border-[#2563EB] focus:outline-none bg-white text-center"
                />
              </div>
            )}
          </div>
        </div>
      ))}

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors">
        <Save size={15} />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Notification Settings'}
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const taskTabs: { key: TaskMasterTab; label: string; icon: React.ReactNode }[] = [
  { key: 'assignee_visibility', label: 'Assignee Visibility', icon: <Users size={15} /> },
  { key: 'checklists', label: 'Checklist Templates', icon: <List size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'tags', label: 'Tags', icon: <Tags size={15} /> },
  { key: 'priorities', label: 'Priorities', icon: <BarChart size={15} /> },
  { key: 'statuses', label: 'Statuses', icon: <Activity size={15} /> },
  { key: 'config', label: 'Config', icon: <Settings2 size={15} /> },
]

// Each Task Masters tab is gated by the matching access-rights leaf. A user sees a
// tab only if they (or admin) hold any manage action on it; the backend re-enforces
// each action. Ticket Masters / Notifications remain admin-only as before.
const TASK_TAB_LEAF: Record<TaskMasterTab, string> = {
  config: 'tasks.config.settings.manage',
  categories: 'tasks.config.categories.manage',
  tags: 'tasks.config.tags.manage',
  priorities: 'tasks.config.priorities.manage',
  statuses: 'tasks.config.statuses.manage',
  checklists: 'tasks.config.checklist_templates.manage',
  assignee_visibility: 'tasks.config.assignee_visibility.manage',
}

const ticketTabs: { key: TicketMasterTab; label: string; icon: React.ReactNode }[] = [
  { key: 'config', label: 'Configuration', icon: <Settings2 size={15} /> },
  { key: 'types', label: 'Types', icon: <TicketIcon size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'priorities', label: 'Priorities', icon: <BarChart size={15} /> },
  { key: 'statuses', label: 'Statuses', icon: <Activity size={15} /> },
  { key: 'resolver-groups', label: 'Resolver Groups', icon: <Users size={15} /> },
  { key: 'templates', label: 'Templates', icon: <CheckSquare size={15} /> },
]

const TASK_TAB_KEYS: TaskMasterTab[] = ['config', 'categories', 'tags', 'priorities', 'statuses', 'checklists', 'assignee_visibility']
const TICKET_TAB_KEYS: TicketMasterTab[] = ['config', 'types', 'categories', 'priorities', 'statuses', 'resolver-groups', 'templates']

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function MastersPage() {
  const { user } = useAuth()
  const { can, isAdmin, loading: permsLoading } = usePermissions()
  const router = useRouter()
  const pathname = usePathname()
  const orgId = user?.organizationId ?? ''
  const [masterSection, setMasterSection] = useState<'tasks' | 'tickets' | 'notifications'>(() => {
    const s = readParam('section')
    return s === 'tickets' || s === 'notifications' ? s : 'tasks'
  })
  const [taskTab, setTaskTab] = useState<TaskMasterTab>(() => {
    const t = readParam('tab') as TaskMasterTab | null
    return t && TASK_TAB_KEYS.includes(t) ? t : 'assignee_visibility'
  })
  const [ticketTab, setTicketTab] = useState<TicketMasterTab>(() => {
    const t = readParam('tab') as TicketMasterTab | null
    return t && TICKET_TAB_KEYS.includes(t) ? t : 'config'
  })

  // Reflect the active section + tab in the URL so a reload (or a shared link)
  // lands on the same place. Uses replace so it doesn't pollute browser history.
  const syncUrl = useCallback((section: string, tab: string) => {
    const params = new URLSearchParams()
    params.set('section', section)
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-[#0F172A]">No organization found</p>
      </div>
    )
  }

  if (permsLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#64748B]">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  const canManage = (leaf: string) =>
    isAdmin || can(leaf, 'write') || can(leaf, 'edit') || can(leaf, 'delete')

  // Task Masters tabs the user may configure; Ticket Masters / Notifications stay admin-only.
  const visibleTaskTabs = taskTabs.filter((t) => canManage(TASK_TAB_LEAF[t.key]))
  const canViewTaskMasters = visibleTaskTabs.length > 0

  const availableSections = (
    [
      canViewTaskMasters ? (['tasks', 'Task'] as const) : null,
      isAdmin ? (['tickets', 'Ticket'] as const) : null,
      isAdmin ? (['notifications', 'Notifications'] as const) : null,
    ].filter(Boolean) as ReadonlyArray<readonly ['tasks' | 'tickets' | 'notifications', string]>
  )

  if (availableSections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="font-semibold text-[#0F172A]">No access to task configuration</p>
        <p className="mt-1 text-sm text-[#64748B]">
          You don&apos;t have permission to configure task masters. Contact an administrator.
        </p>
      </div>
    )
  }

  // Clamp the active section/tab to what's actually available for this user.
  const effectiveSection = availableSections.some(([k]) => k === masterSection)
    ? masterSection
    : availableSections[0][0]
  const effectiveTaskTab = visibleTaskTabs.some((t) => t.key === taskTab)
    ? taskTab
    : (visibleTaskTabs[0]?.key ?? 'config')

  const notifTabs: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: 'config', label: 'Notification Settings', icon: <Bell size={15} /> },
  ]
  const activeTabs = effectiveSection === 'tasks' ? visibleTaskTabs : effectiveSection === 'tickets' ? ticketTabs : notifTabs

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight">Work Settings</h1>
        <p className="mt-1 text-[15px] text-[#475569]">Configure system settings for tasks and tickets.</p>
      </div>

      {/* Top-level switcher */}
      <div className="flex gap-2 p-1 bg-[#F1F5F9] rounded-[10px] w-fit">
        {availableSections.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setMasterSection(key)
              const tab = key === 'tasks' ? taskTab : key === 'tickets' ? ticketTab : 'config'
              syncUrl(key, tab)
            }}
            className={[
              'px-4 py-2 rounded-[8px] text-sm font-semibold transition-colors',
              effectiveSection === key ? 'bg-white text-[#0F172A] shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-[#475569] hover:text-[#0F172A]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col min-h-[calc(100vh-17rem)] bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {/* Tab bar */}
        <div className="flex-none flex border-b border-[#E2E8F0] overflow-x-auto">
          {activeTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (effectiveSection === 'tasks') {
                  setTaskTab(t.key as TaskMasterTab)
                  syncUrl('tasks', t.key)
                } else if (effectiveSection === 'tickets') {
                  setTicketTab(t.key as TicketMasterTab)
                  syncUrl('tickets', t.key)
                }
              }}
              className={[
                'flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
                (effectiveSection === 'tasks' ? effectiveTaskTab : effectiveSection === 'tickets' ? ticketTab : 'config') === t.key
                  ? 'text-[#2563EB] border-[#2563EB]'
                  : 'text-[#475569] border-transparent hover:text-[#0F172A]',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content — card grows with content; the page scrolls when it overflows */}
        <div className="flex-1 p-6">
          {effectiveSection === 'tasks' && (
            <>
              {effectiveTaskTab === 'config' && <ConfigTab orgId={orgId} />}
              {effectiveTaskTab === 'categories' && <CategoriesTab orgId={orgId} />}
              {effectiveTaskTab === 'tags' && <TagsTab orgId={orgId} />}
              {effectiveTaskTab === 'priorities' && <PrioritiesTab orgId={orgId} />}
              {effectiveTaskTab === 'statuses' && <StatusesTab orgId={orgId} />}
              {effectiveTaskTab === 'checklists' && <ChecklistTemplatesTab orgId={orgId} />}
              {effectiveTaskTab === 'assignee_visibility' && <AssigneeVisibilityTab orgId={orgId} />}
            </>
          )}
          {effectiveSection === 'tickets' && (
            <>
              {ticketTab === 'config' && <TktConfigTab orgId={orgId} />}
              {ticketTab === 'types' && <TktTypesTab orgId={orgId} />}
              {ticketTab === 'categories' && <TktCategoriesTab orgId={orgId} />}
              {ticketTab === 'priorities' && <TktPrioritiesTab orgId={orgId} />}
              {ticketTab === 'statuses' && <TktStatusesTab orgId={orgId} />}
              {ticketTab === 'resolver-groups' && <TktResolverGroupsTab orgId={orgId} />}
              {ticketTab === 'templates' && <TktTemplatesTab orgId={orgId} />}
            </>
          )}
          {effectiveSection === 'notifications' && <NotificationsMasterTab orgId={orgId} />}
        </div>
      </div>
    </div>
  )
}
