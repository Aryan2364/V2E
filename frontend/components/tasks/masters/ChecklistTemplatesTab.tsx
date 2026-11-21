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
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import { getEmployees } from '@/lib/api/employees'
import ChecklistAccessEditor, { type LocalRule, newRuleKey } from '@/components/tasks/ChecklistAccessEditor'
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
import ImportChecklistsModal from '@/components/tasks/ImportChecklistsModal'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { FormField, apiError, inputCls, Spinner } from './shared'

export default function ChecklistTemplatesTab({ orgId }: { orgId: string }) {
  // Shown under the empty name field and the empty items list after a failed save (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState('')
  const [itemsError, setItemsError] = useState('')
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
    if (!name || cleanItems.length === 0) {
      setFieldError(name ? '' : 'Enter a name for the template.')
      setItemsError(cleanItems.length === 0 ? 'Add at least one checklist item.' : '')
      return
    }
    setFieldError(''); setItemsError('')

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
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-section font-medium text-text-primary leading-tight">{editingId ? 'Edit Checklist Template' : 'New Checklist Template'}</h2>
            <p className="text-body text-text-secondary">{editingId ? 'Update the name, items, and who can use this template.' : 'Name the template, add its items, and choose who can use it.'}</p>
          </div>
        </div>

        {/* Single column: name + items card on top, access card full-width below. */}
        <div className="space-y-6">
          {/* Name + items */}
          <div className="bg-surface border border-border-light rounded-card shadow-card p-4 space-y-4">
            <FormField label="Template name" required error={!templateName.trim() ? fieldError : undefined}><input type="text" autoFocus value={templateName} onChange={(e) => { setTemplateName(e.target.value); if (error) setError(null) }} placeholder="e.g. Onboarding Checklist" className={`${inputCls} max-w-xl`} /></FormField>

            <div>
              <Label className="mb-2" required>Items</Label>
              <p className="text-meta text-text-muted mb-2">Press Enter to add the next item. Ctrl+Z undoes a removal.</p>
              {templateItems.map((item, idx) => (
                <div key={idx} className="relative mb-2 max-w-xl">
                  <input ref={(el) => { itemRefs.current[idx] = el }} type="text" value={item} onChange={(e) => handleItemChange(idx, e.target.value)} onKeyDown={(e) => handleItemKeyDown(e, idx)} onBlur={() => handleItemBlur(idx)} placeholder={`Item ${idx + 1}`} className={`${inputCls} pr-8`} />
                  <Button type="button" variant="ghost" size="icon-sm" className="absolute top-0 right-0 h-[38px] hover:text-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => { pushHistory(); setTemplateItems((prev) => prev.length <= 1 ? [''] : prev.filter((_, i) => i !== idx)) }} aria-label="Remove item"><X size={14} /></Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => { pushHistory(); setTemplateItems((prev) => [...prev, '']) }}><Plus size={13} /> Add item</Button>
              <InlineFieldError>{templateItems.some((t) => t.trim()) ? undefined : itemsError}</InlineFieldError>
            </div>
          </div>

          {/* Access rules card — full width below items */}
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
        </div>

        {error && <p className="text-body font-medium text-danger">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSubmit} loading={submitting} loadingLabel="Saving">{editingId ? 'Save Changes' : 'Create Template'}</Button>
          <Button variant="secondary" onClick={closeForm}>Cancel</Button>
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
        <p className="text-body text-text-secondary">{items.length} template{items.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}><Upload size={14} /> Import Checklists</Button>
          <Button onClick={openCreate}><Plus size={14} /> Add template</Button>
        </div>
      </div>
      {items.length === 0 && <div className="text-center py-12 text-text-secondary text-body">No checklist templates yet.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        {items.map((t) => {
          const count = (t.items ?? []).length
          const restricted = (t.access_mode ?? 'everyone') === 'restricted'
          const active = t.is_active
          return (
            <div key={t.id} className={['bg-surface border rounded-control p-4 hover:shadow-card transition-all', active ? 'border-border-light hover:border-border' : 'border-dashed border-border bg-surface-sunken'].join(' ')}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className={['text-body font-medium leading-snug', active ? 'text-text-primary' : 'text-text-muted'].join(' ')}>{t.name}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(t)} aria-label="Edit"><Pencil size={13} /></Button>
                  <Button variant="ghost" size="icon-sm" className="hover:text-danger hover:bg-danger-bg" onClick={() => handleDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></Button>
                </div>
              </div>
              <div className="space-y-1.5">
                {(t.items ?? []).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="w-3.5 h-3.5 rounded-[4px] border border-border shrink-0 mt-0.5" />
                    <span className="text-meta text-text-secondary leading-snug">{item.title}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-light flex-wrap">
                <span className="text-meta font-medium rounded-[999px] px-2 py-0.5 bg-primary-subtle text-primary-text">{count} item{count !== 1 ? 's' : ''}</span>
                <span className={['text-meta font-medium rounded-[999px] px-2 py-0.5', restricted ? 'bg-warning-bg text-warning' : 'bg-surface-control text-text-secondary'].join(' ')}>{accessSummary(t)}</span>
                <span className={['text-meta font-medium rounded-[999px] px-2 py-0.5', active ? 'bg-success-bg text-success' : 'bg-surface-control text-text-muted'].join(' ')}>{active ? 'Active' : 'Inactive'}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={['ml-auto', active ? 'text-text-secondary' : 'text-success hover:text-success'].join(' ')}
                  onClick={() => toggleActive(t)}
                  loading={togglingId === t.id}
                  loadingLabel="…"
                >
                  {active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
