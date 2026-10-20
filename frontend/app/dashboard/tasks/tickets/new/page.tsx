'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { TicketTemplate, TicketType, TicketCategory, TicketPriority } from '@/lib/types/tickets'
import TicketTemplateCard from '@/components/tickets/TicketTemplateCard'
import StyledSelect from '@/components/ui/StyledSelect'
import { PageHeader } from '@/components/shell/page-header'
import { SHOW_MORE_LINK } from '@/components/ui/truncate'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

type Step = 'template' | 'form'

interface ChecklistItem { title: string }

export default function NewTicketPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [step, setStep] = useState<Step>('template')
  const [templates, setTemplates] = useState<TicketTemplate[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [priorities, setPriorities] = useState<TicketPriority[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<TicketTemplate | null>(null)
  const [templateSearch, setTemplateSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [typeId, setTypeId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [priorityId, setPriorityId] = useState('')
  const [proofRequired, setProofRequired] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [newChecklistItem, setNewChecklistItem] = useState('')
  // Field errors sit under the field that is wrong (kit 11.3 rule 6).
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; type?: string }>({})
  // Raising a ticket creates a record: leaving a filled-in form asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: step === 'form' && !submitting && (title.trim() !== '' || description.trim() !== '' || typeId !== '' || categoryId !== '' || priorityId !== '' || checklist.length > 0),
    noun: 'ticket',
    mode: 'create',
  })

  useEffect(() => {
    if (!orgId) return
    Promise.all([
      ticketsApi.listAccessibleTemplates(orgId),
      ticketsApi.listTypes(orgId),
      ticketsApi.listCategories(orgId),
      ticketsApi.listPriorities(orgId),
    ]).then(([t, ty, ca, pr]) => {
      setTemplates(t)
      setTypes(ty.filter((x) => x.is_active))
      setCategories(ca.filter((x) => x.is_active))
      setPriorities(pr.filter((x) => x.is_active))
    }).finally(() => setLoading(false))
  }, [orgId])

  function selectTemplate(template: TicketTemplate | null) {
    setSelectedTemplate(template)
    if (template) {
      setTitle(template.title_template)
      setDescription(template.description_template ?? '')
      setTypeId(template.ticket_type_id ?? '')
      setCategoryId(template.category_id ?? '')
      setPriorityId(template.priority_id ?? '')
      setChecklist(template.checklist_items.map((item) => ({ title: item.title })))
    } else {
      setTitle('')
      setDescription('')
      setTypeId('')
      setCategoryId('')
      setPriorityId('')
      setChecklist([])
    }
    setStep('form')
  }

  const priorityLocked = !!selectedTemplate?.lock_priority
  const filteredCategories = categories.filter((c) => !typeId || !c.ticket_type_id || c.ticket_type_id === typeId)
  const filteredTemplates = templates.filter(
    (t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())
  )

  // Group templates by their group_label (fallback bucket "General"), preserving encounter order.
  const groupedTemplates = filteredTemplates.reduce<{ label: string; items: TicketTemplate[] }[]>((acc, t) => {
    const label = t.group_label?.trim() || 'General'
    let group = acc.find((g) => g.label === label)
    if (!group) { group = { label, items: [] }; acc.push(group) }
    group.items.push(t)
    return acc
  }, [])

  async function handleSubmit() {
    if (!title.trim() || !typeId) {
      setFieldErrors({
        title: title.trim() ? undefined : 'Enter a title for the ticket.',
        type: typeId ? undefined : 'Choose a ticket type.',
      })
      requestAnimationFrame(() => document.getElementById(title.trim() ? 'raise-ticket-type' : 'raise-ticket-title')?.focus())
      return
    }
    setFieldErrors({})
    setSubmitting(true)
    setError('')
    try {
      const ticket = await ticketsApi.raise(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        ticket_type_id: typeId,
        category_id: categoryId || undefined,
        priority_id: priorityId || undefined,
        template_id: selectedTemplate?.id,
        proof_required: proofRequired,
        checklist_items: checklist.filter((c) => c.title.trim()),
      })
      router.push(`/dashboard/tasks/tickets/${ticket.id}`)
    } catch {
      setError('Could not raise the ticket. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2.5 border border-border rounded-[8px] text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden bg-surface'

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse max-w-2xl">
        <div className="h-8 w-48 bg-surface-control rounded-xs" />
        <div className="h-64 bg-surface-control rounded-[12px]" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {unsaved.warning}
      <PageHeader
        title="Raise ticket"
        trail={[
          { label: 'Tickets', href: '/dashboard/tasks/tickets' },
          { label: 'Raise ticket', href: '/dashboard/tasks/tickets/new' },
        ]}
        meta={step === 'template' ? 'Step 1: Choose a template or start from scratch' : 'Step 2: Fill in ticket details'}
      />

      {step === 'form' && (
        <button type="button" onClick={() => setStep('template')} className={SHOW_MORE_LINK}>
          Back to templates
        </button>
      )}

      {step === 'template' && (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-8 pr-3 py-2 border border-border rounded-[8px] text-body focus:border-primary focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => selectTemplate(null)}
            className="w-full text-left p-4 rounded-[12px] border-2 border-dashed border-border hover:border-primary hover:bg-surface-sunken transition-all"
          >
            <p className="text-body font-medium text-text-secondary">Start from scratch</p>
            <p className="text-meta text-text-muted mt-0.5">Fill in all details manually</p>
          </button>

          {groupedTemplates.map((group) => (
            <div key={group.label} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-meta font-medium text-text-secondary ">{group.label}</p>
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-meta font-medium">
                  {group.items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.items.map((t) => (
                  <TicketTemplateCard
                    key={t.id}
                    template={t}
                    selected={selectedTemplate?.id === t.id}
                    onSelect={() => selectTemplate(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === 'form' && (
        <div className="flex flex-col gap-4">
          {selectedTemplate && (
            <div className="flex items-center gap-2 px-3 py-2 bg-primary-subtle border border-primary-border rounded-[8px]">
              <span className="text-meta text-primary-text font-medium">Using template: {selectedTemplate.name}</span>
              <button type="button" onClick={() => setStep('template')} className="ml-auto text-primary-text hover:text-primary-text">
                <X size={14} />
              </button>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-danger-bg border border-danger-border rounded-[8px] text-body text-danger">{error}</div>
          )}

          <div>
            <Label className="mb-2" htmlFor="raise-ticket-title" required>Title</Label>
            <input id="raise-ticket-title" type="text" value={title} onChange={(e) => { setTitle(e.target.value); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }} placeholder="For example, Printer on floor 2 is not working" aria-invalid={fieldErrors.title ? true : undefined} className={`${inputCls} aria-invalid:border-danger`} />
            <InlineFieldError>{fieldErrors.title}</InlineFieldError>
          </div>

          <div>
            <Label className="mb-2">Description</Label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
          </div>

          <div>
            <Label className="mb-2" required>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  id={t === types[0] ? 'raise-ticket-type' : undefined}
                  type="button"
                  onClick={() => { setTypeId(t.id); setCategoryId(''); setFieldErrors((p) => (p.type ? { ...p, type: undefined } : p)) }}
                  className={`flex items-center gap-2 p-3 rounded-[8px] border-2 text-body font-medium transition-colors ${
                    typeId === t.id ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-light text-text-secondary hover:bg-surface-sunken'
                  }`}
                >
                  <span>{t.icon}</span> {t.name}
                </button>
              ))}
            </div>
            <InlineFieldError>{fieldErrors.type}</InlineFieldError>
          </div>

          {filteredCategories.length > 0 && (
            <div>
              <Label className="mb-2">Category</Label>
              <StyledSelect
                value={categoryId}
                onChange={(v) => setCategoryId(v)}
                placeholder="Select category"
                options={[
                  { value: '', label: 'Select category' },
                  ...filteredCategories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                ]}
              />
            </div>
          )}

          {priorities.length > 0 && (
            <div>
              <Label className="mb-2">Priority</Label>
              <StyledSelect
                value={priorityId}
                onChange={(v) => setPriorityId(v)}
                disabled={priorityLocked}
                placeholder="Select priority"
                options={[
                  { value: '', label: 'Select priority' },
                  ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
                ]}
              />
              {priorityLocked && (
                <p className="text-meta text-text-muted mt-1">Locked by template</p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={proofRequired} onChange={(e) => setProofRequired(e.target.checked)} className="w-4 h-4 rounded-xs border-border text-primary-text" />
            <span className="text-body text-text-secondary">Proof of resolution required</span>
          </label>

          {/* Checklist */}
          {checklist.length > 0 && (
            <div>
              <p className="text-body font-medium text-text-secondary mb-2">Checklist</p>
              <div className="flex flex-col gap-1.5">
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={item.title} onChange={(e) => setChecklist((c) => c.map((x, j) => j === i ? { title: e.target.value } : x))} className="flex-1 px-2 py-1.5 border border-border-light rounded-[6px] text-body" />
                    <button type="button" onClick={() => setChecklist((c) => c.filter((_, j) => j !== i))} className="text-text-muted hover:text-danger"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newChecklistItem.trim()) {
                  setChecklist((c) => [...c, { title: newChecklistItem.trim() }])
                  setNewChecklistItem('')
                }
              }}
              placeholder="Add checklist item (Enter to add)"
              className="flex-1 px-3 py-1.5 border border-border-light rounded-[6px] text-body"
            />
            <button type="button" onClick={() => { if (newChecklistItem.trim()) { setChecklist((c) => [...c, { title: newChecklistItem.trim() }]); setNewChecklistItem('') } }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-[6px] text-body text-primary-text border border-primary-border hover:bg-primary-subtle">
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" data-leaves-page onClick={() => router.push("/dashboard/tasks/tickets")} disabled={submitting}>Cancel</Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting} loading={submitting} loadingLabel="Raising">Raise ticket</Button>
          </div>
        </div>
      )}
    </div>
  )
}
