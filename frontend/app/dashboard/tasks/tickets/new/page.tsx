'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Search, Plus, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ticketsApi } from '@/lib/api/tickets'
import type { TicketTemplate, TicketType, TicketCategory, TicketPriority } from '@/lib/types/tickets'
import TicketTemplateCard from '@/components/tickets/TicketTemplateCard'
import StyledSelect from '@/components/ui/StyledSelect'

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
    if (!title.trim()) { setError('Title is required'); return }
    if (!typeId) { setError('Ticket type is required'); return }
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
      setError('Failed to raise ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2.5 border border-[#CBD5E1] rounded-[8px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-hidden bg-white'

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse max-w-2xl">
        <div className="h-8 w-48 bg-[#F1F5F9] rounded-xs" />
        <div className="h-64 bg-[#F1F5F9] rounded-[12px]" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => step === 'form' ? setStep('template') : router.back()}
          className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-[22px] font-bold text-[#0F172A]">Raise Ticket</h1>
          <p className="text-sm text-[#475569] mt-0.5">
            {step === 'template' ? 'Step 1: Choose a template or start from scratch' : 'Step 2: Fill in ticket details'}
          </p>
        </div>
      </div>

      {step === 'template' && (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-9 pr-3 py-2 border border-[#CBD5E1] rounded-[8px] text-sm focus:border-[#2563EB] focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => selectTemplate(null)}
            className="w-full text-left p-4 rounded-[12px] border-2 border-dashed border-[#CBD5E1] hover:border-[#2563EB] hover:bg-[#F8FAFF] transition-all"
          >
            <p className="text-sm font-semibold text-[#475569]">Start from scratch</p>
            <p className="text-xs text-[#94A3B8] mt-0.5">Fill in all details manually</p>
          </button>

          {groupedTemplates.map((group) => (
            <div key={group.label} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider">{group.label}</p>
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
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
            <div className="flex items-center gap-2 px-3 py-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px]">
              <span className="text-xs text-[#2563EB] font-medium">Using template: {selectedTemplate.name}</span>
              <button type="button" onClick={() => setStep('template')} className="ml-auto text-[#2563EB] hover:text-[#1D4ED8]">
                <X size={14} />
              </button>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] text-sm text-[#DC2626]">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Title <span className="text-[#DC2626]">*</span></label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Briefly describe the issue" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Provide details..." className={`${inputCls} resize-none`} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Type <span className="text-[#DC2626]">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTypeId(t.id); setCategoryId('') }}
                  className={`flex items-center gap-2 p-3 rounded-[8px] border-2 text-sm font-medium transition-colors ${
                    typeId === t.id ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]' : 'border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC]'
                  }`}
                >
                  <span>{t.icon}</span> {t.name}
                </button>
              ))}
            </div>
          </div>

          {filteredCategories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Category</label>
              <StyledSelect
                value={categoryId}
                onChange={(v) => setCategoryId(v)}
                placeholder="Select category (optional)"
                options={[
                  { value: '', label: 'Select category (optional)' },
                  ...filteredCategories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                ]}
              />
            </div>
          )}

          {priorities.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
              <StyledSelect
                value={priorityId}
                onChange={(v) => setPriorityId(v)}
                disabled={priorityLocked}
                placeholder="Select priority (optional)"
                options={[
                  { value: '', label: 'Select priority (optional)' },
                  ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
                ]}
              />
              {priorityLocked && (
                <p className="text-xs text-[#64748B] mt-1">Locked by template</p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={proofRequired} onChange={(e) => setProofRequired(e.target.checked)} className="w-4 h-4 rounded-xs border-[#CBD5E1] text-[#2563EB]" />
            <span className="text-sm text-[#374151]">Proof of resolution required</span>
          </label>

          {/* Checklist */}
          {checklist.length > 0 && (
            <div>
              <p className="text-sm font-medium text-[#374151] mb-2">Checklist</p>
              <div className="flex flex-col gap-1.5">
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={item.title} onChange={(e) => setChecklist((c) => c.map((x, j) => j === i ? { title: e.target.value } : x))} className="flex-1 px-2 py-1.5 border border-[#E2E8F0] rounded-[6px] text-sm" />
                    <button type="button" onClick={() => setChecklist((c) => c.filter((_, j) => j !== i))} className="text-[#94A3B8] hover:text-[#DC2626]"><X size={14} /></button>
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
              className="flex-1 px-3 py-1.5 border border-[#E2E8F0] rounded-[6px] text-sm"
            />
            <button type="button" onClick={() => { if (newChecklistItem.trim()) { setChecklist((c) => [...c, { title: newChecklistItem.trim() }]); setNewChecklistItem('') } }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-[6px] text-sm text-[#2563EB] border border-[#BFDBFE] hover:bg-[#EFF6FF]">
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors">
              {submitting ? 'Raising...' : 'Raise Ticket'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
