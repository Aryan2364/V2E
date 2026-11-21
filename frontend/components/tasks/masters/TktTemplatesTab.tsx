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
import { getRoles } from '@/lib/api/roles'
import { getEmployees } from '@/lib/api/employees'
import ChecklistAccessEditor, { type LocalRule, newRuleKey } from '@/components/tasks/ChecklistAccessEditor'
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
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import StyledSelect from '@/components/ui/StyledSelect'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2, Save, X, Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell, GripVertical, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { FormField, apiError, inputCls, CountPill, Spinner, ConfirmDeleteDialog } from './shared'

export default function TktTemplatesTab({ orgId }: { orgId: string }) {
  const [fieldError, setFieldError] = useState('')
  const [titleTemplateError, setTitleTemplateError] = useState('')
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
    if (!form.name.trim() || !form.title_template.trim()) {
      setFieldError(form.name.trim() ? '' : 'Enter a name for the template.')
      setTitleTemplateError(form.title_template.trim() ? '' : 'Enter the title that new tickets start with.')
      return
    }
    setFieldError(''); setTitleTemplateError('')

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

  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)

  async function handleArchive(id: string) {
    await ticketsApi.archiveTemplate(orgId, id).catch(() => null)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmArchiveId(null)
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
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-section font-medium text-text-primary leading-tight">{editingId ? 'Edit Ticket Template' : 'New Ticket Template'}</h2>
            <p className="text-body text-text-secondary">Pre-fill ticket fields and choose who can use this template.</p>
          </div>
        </div>

        <div className="bg-surface border border-border-light rounded-card shadow-card p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Template name" required error={!form.name.trim() ? fieldError : undefined}><input type="text" autoFocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (error) setError(null) }} placeholder="e.g. VPN Access Request" className={inputCls} /></FormField>
            <FormField label="Type">
              <div className="flex gap-2">
                {(['simple', 'full'] as TicketTemplateType[]).map((t) => (
                  <button key={t} type="button" onClick={() => setForm({ ...form, template_type: t })} className={`flex-1 py-[9px] rounded-control text-body font-medium border-2 outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors ${form.template_type === t ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-light text-text-secondary'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Ticket type (optional)">
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
            <FormField label="Catalog department (optional)">
              <DepartmentSelect
                value={form.department_id}
                onChange={(id) => setForm({ ...form, department_id: id })}
                departments={departments}
                placeholder="No grouping…"
                inline
              />
            </FormField>
            <FormField label="Group label (optional)"><input type="text" value={form.group_label} onChange={(e) => setForm({ ...form, group_label: e.target.value })} placeholder="e.g. Access Requests" className={inputCls} /></FormField>
            <FormField label="SLA Override (days, optional)"><input type="number" min={1} value={form.sla_days} onChange={(e) => setForm({ ...form, sla_days: e.target.value })} placeholder="Inherits from type/category" className={inputCls} /></FormField>
            <FormField label="Response SLA (hours, optional)"><input type="number" min={1} value={form.response_sla_hours} onChange={(e) => setForm({ ...form, response_sla_hours: e.target.value })} placeholder="Inherits from type/category" className={inputCls} /></FormField>
          </div>

          <div className={`flex items-start gap-3 p-3 rounded-control border-2 cursor-pointer transition-all ${form.lock_priority ? 'border-primary bg-primary-subtle' : 'border-border-light'}`} onClick={() => setForm({ ...form, lock_priority: !form.lock_priority })}>
            <div className={`relative w-9 h-5 rounded-full mt-0.5 shrink-0 transition-colors duration-200 ${form.lock_priority ? 'bg-primary' : 'bg-surface-control-pressed'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-surface rounded-full shadow-xs transition-transform duration-200 ${form.lock_priority ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className={`text-body font-medium ${form.lock_priority ? 'text-primary-text' : 'text-text-primary'}`}>Lock priority</p>
              <p className="text-meta text-text-secondary mt-0.5">The raiser can&apos;t change the priority when using this template.</p>
            </div>
          </div>

          <FormField label="Title template" required error={!form.title_template.trim() ? titleTemplateError : undefined}><input type="text" value={form.title_template} onChange={(e) => { setForm({ ...form, title_template: e.target.value }); if (error) setError(null) }} placeholder="For example, Laptop request" className={inputCls} /></FormField>
          <FormField label="Description template (optional)">
            <textarea value={form.description_template} onChange={(e) => setForm({ ...form, description_template: e.target.value })} rows={2} placeholder="Pre-filled description..." className={`${inputCls} resize-none`} />
          </FormField>
          <div>
            <Label className="mb-2">Checklist items</Label>
            {checklistItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mb-2 max-w-xl">
                <input type="text" value={item} onChange={(e) => setChecklistItems((prev) => prev.map((v, i) => i === idx ? e.target.value : v))} placeholder={`Item ${idx + 1}`} className={inputCls} />
                <Button variant="ghost" size="icon-sm" className="hover:text-danger" onClick={() => setChecklistItems((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove item"><X size={14} /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setChecklistItems((prev) => [...prev, ''])}><Plus size={13} /> Add item</Button>
          </div>
        </div>

        {/* Access rules — who can pick this template when raising a ticket */}
        <div className="bg-surface border border-border-light rounded-card shadow-card p-4">
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

        {error && <p className="text-body font-medium text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button onClick={handleSubmit} loading={submitting} loadingLabel="Saving">{editingId ? 'Save Changes' : 'Create Template'}</Button>
          <Button variant="secondary" onClick={closeForm}>Cancel</Button>
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
      <ConfirmDeleteDialog
        open={confirmArchiveId !== null}
        onOpenChange={(open) => { if (!open) setConfirmArchiveId(null) }}
        title="Archive this template?"
        confirmLabel="Archive"
        description="It will no longer appear for new tickets."
        onConfirm={() => confirmArchiveId && handleArchive(confirmArchiveId)}
      />
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">{items.length} template{items.length !== 1 ? 's' : ''}</p>
        <Button onClick={openCreate}><Plus size={14} /> Add template</Button>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-text-secondary text-label">No templates yet.</div>}
      {sections.map((section) => (
        <div key={section.label} className="space-y-2">
          <div className="flex items-center gap-2 pt-1">
            <h3 className="text-meta font-medium uppercase tracking-wide text-text-muted">{section.label}</h3>
            <CountPill n={section.templates.length} />
          </div>
          {section.templates.map((item) => (
            <div key={item.id} className="bg-surface border border-border-light rounded-control px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="text-body font-medium text-text-primary">{item.name}</p>
                  <span className={`text-meta font-medium px-2 py-0.5 rounded-full border ${item.template_type === 'full' ? 'bg-primary-subtle text-primary-text border-primary-border' : 'bg-surface-sunken text-text-secondary border-border-light'}`}>{item.template_type}</span>
                  {item.resolver_group?.name && <span className="text-meta font-medium px-2 py-0.5 rounded-full bg-surface-control text-text-secondary">{item.resolver_group.name}</span>}
                  {item.lock_priority && <span className="text-meta font-medium px-2 py-0.5 rounded-full bg-warning-bg text-warning">Priority locked</span>}
                </div>
                <p className="text-meta text-text-muted truncate">{item.title_template}</p>
              </div>
              <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${(item.access_mode ?? 'everyone') === 'restricted' ? 'bg-warning-bg text-warning' : 'bg-surface-control text-text-secondary'}`}>{accessSummary(item)}</span>
              {item.checklist_items.length > 0 && <span className="text-meta text-text-secondary">{item.checklist_items.length} items</span>}
              <span className={`text-meta font-medium rounded-[999px] px-2 py-0.5 ${item.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{item.is_active ? 'Active' : 'Archived'}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(item)} aria-label="Edit"><Pencil size={13} /></Button>
                {item.is_active && (
                  <Tooltip label="Archive">
                    <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => setConfirmArchiveId(item.id)} aria-label="Archive"><Trash2 size={13} /></Button>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
