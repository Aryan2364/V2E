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
import { FormField, inputCls, Spinner } from './shared'

export default function PrioritiesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name or label field after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [items, setItems] = useState<TaskPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', color: 'var(--danger)' })
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
    if (!form.label.trim()) { setFieldError('Enter a label.'); return }
    setSubmitting(true)
    try {
      // New priorities go to the bottom of the list; rank is derived from position, never typed.
      const item = await tasksApi.createPriority(orgId, { label: form.label.trim(), color: form.color, order_index: items.length, is_active: true })
      setItems((prev) => [...prev, item])
      setForm({ label: '', color: 'var(--danger)' })
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
          <p className="text-body text-text-secondary">{items.length} priorit{items.length !== 1 ? 'ies' : 'y'}</p>
          {items.length > 1 && <p className="text-meta text-text-muted mt-0.5">Ordered highest → lowest. Drag the handle or use the arrows to rearrange.</p>}
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0"><Plus size={14} /> Add Priority</Button>
      </div>
      {creating && (
        <div className="bg-surface-sunken border border-border-light rounded-control p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Label" required error={!form.label.trim() ? fieldError : undefined}><input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. High" className={inputCls} /></FormField>
            <FormField label="Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-[38px] rounded-control border border-border cursor-pointer" />
                <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} />
              </div>
            </FormField>
          </div>
          <p className="text-meta text-text-muted">Added to the bottom of the list. Drag it into position afterwards — the rank number updates automatically.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={submitting} loadingLabel="Creating">Create</Button>
          </div>
        </div>
      )}
      {items.length === 0 && !creating && <div className="text-center py-12 text-text-secondary text-label">No priorities yet.</div>}
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
              className={`bg-surface border rounded-control pl-2 pr-3 py-3 flex items-center gap-2.5 transition-colors ${isDropTarget ? 'border-primary bg-primary-subtle' : 'border-border-light'} ${dragIndex === idx ? 'opacity-50' : ''}`}
            >
              <Tooltip label="Drag to reorder"><span className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary shrink-0" aria-label="Drag to reorder"><GripVertical size={16} /></span></Tooltip>
              <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-primary-subtle text-primary-text text-meta font-medium">{idx + 1}</span>
              <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="flex-1 min-w-0 truncate text-body font-medium text-text-primary">{item.label}</span>
              {rankLabel && <span className="hidden sm:inline text-meta font-medium text-text-secondary">{rankLabel}</span>}
              <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Inactive'}</span>
              <div className="flex flex-col shrink-0">
                <Button type="button" variant="ghost" size="icon-sm" className="h-5" disabled={idx === 0 || savingOrder} onClick={() => move(idx, idx - 1)} aria-label="Move up"><ChevronUp size={15} /></Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-5" disabled={idx === items.length - 1 || savingOrder} onClick={() => move(idx, idx + 1)} aria-label="Move down"><ChevronDown size={15} /></Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
