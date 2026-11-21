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
import { getDepartments } from '@/lib/api/departments'
import { getEmployees } from '@/lib/api/employees'
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
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { FormField, apiError, inputCls, CountPill, Spinner, ConfirmDeleteDialog } from './shared'

const ASSIGNMENT_STRATEGIES: { value: TicketAssignmentStrategy; label: string; desc: string }[] = [
  { value: 'round_robin', label: 'Round-robin', desc: 'Auto-assign one member in rotation' },
  { value: 'claim', label: 'Claim', desc: 'Members pick tickets from the pool' },
  { value: 'manual', label: 'Manual', desc: 'An admin assigns each ticket' },
]

export default function TktResolverGroupsTab({ orgId }: { orgId: string }) {
  const [fieldError, setFieldError] = useState('')
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
    if (!form.name.trim()) { setFieldError('Enter a name for the group.'); return }
    setFieldError('')
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    await ticketsApi.deleteResolverGroup(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((g) => g.id !== id))
    setConfirmDeleteId(null)
  }

  if (loading) return <Spinner />

  if (formOpen) {
    const activeEmployees = employees.filter((e) => e.status === 'active')
    const q = memberQuery.trim().toLowerCase()
    const filteredEmployees = q
      ? activeEmployees.filter((e) => (e.user?.name ?? '').toLowerCase().includes(q) || (e.role?.title ?? '').toLowerCase().includes(q) || (e.department?.name ?? '').toLowerCase().includes(q))
      : activeEmployees
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-section font-medium text-text-primary leading-tight">{editingId ? 'Edit Resolver Group' : 'New Resolver Group'}</h2>
            <p className="text-body text-text-secondary">A pool of people who resolve tickets routed to this group.</p>
          </div>
        </div>

        <div className="bg-surface border border-border-light rounded-card shadow-card p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Group name" required error={!form.name.trim() ? fieldError : undefined}><input type="text" autoFocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (error) setError(null) }} placeholder="e.g. IT Support" className={inputCls} /></FormField>
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

          <FormField label="Assignment strategy">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {ASSIGNMENT_STRATEGIES.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setForm({ ...form, assignment_strategy: opt.value })}
                  className={`flex flex-col items-start gap-0.5 p-3 rounded-control border-2 text-left outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-all ${form.assignment_strategy === opt.value ? 'border-primary bg-primary-subtle' : 'border-border-light hover:border-border'}`}>
                  <span className={`text-body font-medium ${form.assignment_strategy === opt.value ? 'text-primary-text' : 'text-text-primary'}`}>{opt.label}</span>
                  <span className="text-meta text-text-secondary leading-snug">{opt.desc}</span>
                </button>
              ))}
            </div>
          </FormField>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Label>Members</Label>
              <CountPill n={form.member_user_ids.length} />
            </div>
            <div className="border border-border-light rounded-control overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-surface-sunken">
                <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search people…" className="flex-1 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden bg-transparent" />
              </div>
              <div className="max-h-[280px] overflow-y-auto divide-y divide-surface-control">
                {filteredEmployees.length === 0 && <p className="px-3 py-4 text-body text-text-muted text-center">No people found.</p>}
                {filteredEmployees.map((e) => {
                  const checked = form.member_user_ids.includes(e.user_id)
                  return (
                    <label key={e.user_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-sunken transition-colors">
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(e.user_id)} className="accent-primary w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-body text-text-primary truncate">{e.user?.name ?? 'Unknown'}</p>
                        <p className="text-meta text-text-muted truncate">{[e.role?.title, e.department?.name].filter(Boolean).join(' · ')}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-body font-medium text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSubmit} loading={submitting} loadingLabel="Saving">{editingId ? 'Save Changes' : 'Create Group'}</Button>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete this resolver group?"
        description="Tickets routed to it will need a new group."
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} group{items.length !== 1 ? 's' : ''}</p>
        <Button onClick={openCreate}><Plus size={14} /> Add group</Button>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-text-secondary text-body">No resolver groups yet. Create one to route tickets to a pool of resolvers.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        {items.map((g) => {
          const strategy = ASSIGNMENT_STRATEGIES.find((s) => s.value === g.assignment_strategy)
          const deptName = g.department_id ? deptById.get(g.department_id)?.name : null
          return (
            <div key={g.id} className={['bg-surface border rounded-control p-4 transition-all', g.is_active ? 'border-border-light hover:border-border' : 'border-dashed border-border bg-surface-sunken'].join(' ')}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={['text-body font-medium leading-snug truncate', g.is_active ? 'text-text-primary' : 'text-text-muted'].join(' ')}>{g.name}</p>
                    <CountPill n={g.members.length} />
                  </div>
                  {g.description && <p className="text-meta text-text-secondary truncate mt-0.5">{g.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(g)} aria-label="Edit"><Pencil size={13} /></Button>
                  <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmDeleteId(g.id)} aria-label="Delete"><Trash2 size={13} /></Button>
                </div>
              </div>
              <div className="mt-2 max-h-[120px] overflow-y-auto space-y-1">
                {g.members.length === 0 ? (
                  <p className="text-meta text-text-muted">No members yet.</p>
                ) : g.members.map((m) => (
                  <p key={m.id} className="text-meta text-text-secondary truncate">{empByUserId.get(m.user_id)?.user?.name ?? 'Unknown'}</p>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-light flex-wrap">
                {deptName && <span className="text-meta font-medium rounded-[999px] px-2 py-0.5 bg-surface-control text-text-secondary">{deptName}</span>}
                <span className="text-meta font-medium rounded-[999px] px-2 py-0.5 bg-primary-subtle text-primary-text">{strategy?.label ?? g.assignment_strategy}</span>
                <span className={['text-meta font-medium rounded-[999px] px-2 py-0.5', g.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'].join(' ')}>{g.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
