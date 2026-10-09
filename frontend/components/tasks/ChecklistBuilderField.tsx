'use client'

import React from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'

/**
 * The least a template needs to be offered here. A task's ChecklistTemplate fits, and so
 * does the lighter list the workflows /meta endpoint serves (no order_index there: the
 * items arrive in order).
 */
export interface ChecklistTemplateOption {
  id: string
  name: string
  items?: { title: string; order_index?: number }[]
}

export interface ChecklistEntry {
  title: string
  // Set only when the item already exists on a task (edit flow). Threaded back to
  // the server so an edit preserves the item's identity — and with it every
  // assignee's per-person tick/skip progress — instead of deleting and recreating.
  id?: string
}

// A task can carry several checklists at once — e.g. one applied from a template
// plus a fresh custom one. Each group is an independent, editable section.
export interface ChecklistGroup {
  key: string // stable local id for React + edits
  title: string // section heading (shown only when 2+ groups exist)
  source: 'template' | 'custom'
  templateId?: string // set when source === 'template' (re-validated server-side)
  // The stored definition had a heading (edit prefill) — keep emitting it even for
  // a lone custom group, so a template-applied name survives an edit round-trip.
  keepLabel?: boolean
  items: ChecklistEntry[]
  draft: string // the in-progress "add item" text for this group
}

let groupSeq = 0
const nextGroupKey = () => `g${(groupSeq += 1)}`

// Flatten every checklist group into one ordered list. A group is labelled
// (keeps its heading) when there are 2+ groups OR when it came from a template
// — so a single applied template still shows its name. A lone blank checklist
// stays unlabelled and renders as a plain list.
export function buildChecklistItems(
  checklistGroups: ChecklistGroup[],
): { id?: string; title: string; order_index: number; group_title?: string }[] | undefined {
  const groups = checklistGroups.filter((g) => g.items.length > 0)
  if (groups.length === 0) return undefined
  const multiple = groups.length >= 2
  let order = 0
  return groups.flatMap((g) => {
    const labelled = multiple || g.source === 'template' || g.keepLabel === true
    return g.items.map((item) => ({
      // Emit `id` ONLY for pre-existing items (edit flow). Create never sets it, so
      // its payload stays id-free; the backend uses the id to keep an item's progress.
      ...(item.id ? { id: item.id } : {}),
      title: item.title,
      order_index: order++,
      group_title: labelled ? g.title.trim() || 'Checklist' : undefined,
    }))
  })
}

// Rebuild editable groups from a stored flat definition (edit-recurring prefill).
// Consecutive items sharing a group_title fold back into one group.
export function groupsFromChecklistItems(
  items: { id?: string; title: string; order_index: number; group_title?: string | null }[] | undefined | null,
): ChecklistGroup[] {
  if (!Array.isArray(items) || items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.order_index - b.order_index)
  const groups: ChecklistGroup[] = []
  for (const item of sorted) {
    const heading = item.group_title?.trim() || ''
    const last = groups[groups.length - 1]
    if (last && (last.title === heading || (!heading && last.title === 'Checklist' && groups.length === 1))) {
      last.items.push({ id: item.id, title: item.title })
    } else {
      groups.push({
        key: nextGroupKey(),
        title: heading || 'Checklist',
        source: 'custom',
        keepLabel: !!heading,
        items: [{ id: item.id, title: item.title }],
        draft: '',
      })
    }
  }
  return groups
}

interface Props {
  groups: ChecklistGroup[]
  onChange: (groups: ChecklistGroup[]) => void
  templates: ChecklistTemplateOption[]
  /** Card variant only: whether the body is expanded. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * 'card' (default): the collapsible card used by the task modals, its body scrolling
   * inside the modal. 'inline': always open with no toggle, and the body grows with its
   * content — for a form that already sits on a scrolling page (a workflow step).
   */
  variant?: 'card' | 'inline'
  /**
   * Template groups stay linked to their template (a workflow step): their items and
   * name follow the template and cannot be edited here, and a template already on the
   * list is not offered again. Off by default — a task copies the items and lets you edit.
   */
  linkedTemplates?: boolean
  /** Extra line shown under a group's header (e.g. whether its template is still live). */
  groupNote?: (group: ChecklistGroup) => React.ReactNode
  /** Show the checklists without any add, edit or remove control. */
  readOnly?: boolean
  /** The line explaining the choices while there is no checklist yet. */
  intro?: string
}

/**
 * Collapsible "Checklist" card shared by the Create Task modal (both modes) and
 * the Edit Recurring modal. Supports multiple groups — applied from a template
 * or built by hand — each independently editable.
 */
export default function ChecklistBuilderField({
  groups,
  onChange,
  templates,
  open: openProp = false,
  onOpenChange,
  variant = 'card',
  linkedTemplates = false,
  groupNote,
  readOnly = false,
  intro = 'Apply a template, build your own, or combine both. You can add several checklists to one task.',
}: Props) {
  const inline = variant === 'inline'
  const open = inline || openProp
  // A linked template is listed once; copied templates may be applied again.
  const usedTemplateIds = new Set(groups.filter((g) => g.source === 'template' && g.templateId).map((g) => g.templateId))
  const templateOptions = (linkedTemplates ? templates.filter((t) => !usedTemplateIds.has(t.id)) : templates).map((t) => ({
    value: t.id,
    label: t.name,
  }))

  // Add a checklist sourced from a template — its items are copied in and stay
  // fully editable. Applying a template never wipes other checklists; it adds one.
  function addTemplateGroup(templateId: string) {
    if (!templateId) return
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    const sorted = [...(tpl.items ?? [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    onChange([
      ...groups,
      {
        key: nextGroupKey(),
        title: tpl.name,
        source: 'template',
        templateId: tpl.id,
        items: sorted.map((i) => ({ title: i.title })),
        draft: '',
      },
    ])
  }

  // Add an empty checklist the user fills in themselves.
  function addBlankGroup() {
    onChange([
      ...groups,
      {
        key: nextGroupKey(),
        title: groups.length === 0 ? 'Checklist' : `Checklist ${groups.length + 1}`,
        source: 'custom',
        items: [],
        draft: '',
      },
    ])
  }

  function removeGroup(key: string) {
    onChange(groups.filter((g) => g.key !== key))
  }
  function updateGroupTitle(key: string, title: string) {
    onChange(groups.map((g) => (g.key === key ? { ...g, title } : g)))
  }
  function updateGroupDraft(key: string, draft: string) {
    onChange(groups.map((g) => (g.key === key ? { ...g, draft } : g)))
  }
  function addItemToGroup(key: string) {
    onChange(
      groups.map((g) => {
        if (g.key !== key) return g
        const t = g.draft.trim()
        if (!t) return g
        return { ...g, items: [...g.items, { title: t }], draft: '' }
      }),
    )
  }
  function removeItemFromGroup(key: string, idx: number) {
    onChange(groups.map((g) => (g.key === key ? { ...g, items: g.items.filter((_, i) => i !== idx) } : g)))
  }

  const countBadge = groups.length > 0 && (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
      {groups.length}
    </span>
  )

  return (
    <div>
      <div className="rounded-[12px] border border-[#E2E8F0] bg-white overflow-visible">
        {inline ? (
          // Inline header — always open, so nothing to toggle.
          <div className="flex items-center gap-2 px-3 py-3">
            <span className="text-sm font-medium text-[#374151]">Checklist</span>
            <span className="text-xs font-normal text-[#475569]">Optional</span>
            {countBadge}
          </div>
        ) : (
          /* Card header — click anywhere to toggle; + button on the right */
          <button
            type="button"
            onClick={() => onOpenChange?.(!open)}
            aria-expanded={open}
            className="w-full flex items-center gap-2 px-3 py-3 text-left rounded-t-[12px] hover:bg-[#F8FAFC] transition-colors"
          >
            <label className="text-sm font-medium text-[#374151] cursor-pointer">Checklist</label>
            <span className="text-xs font-normal text-[#475569]">Optional</span>
            {countBadge}
            <span
              className={[
                'ml-auto flex items-center justify-center w-6 h-6 rounded-[6px] text-[#2563EB] transition-transform',
                open ? 'rotate-45' : '',
              ].join(' ')}
              aria-hidden
            >
              <Plus size={18} />
            </span>
          </button>
        )}

        {!open ? null : groups.length === 0 ? (
          readOnly ? (
            <p className="px-4 pb-4 text-sm text-[#475569]">No checklist.</p>
          ) : (
          <>
            {/* Body — explain the choice, then the two ways to add one */}
            <div className="px-4 pb-4 pt-0">
              <p className="text-xs text-[#475569] mb-3">{intro}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                {templateOptions.length > 0 && (
                  <StyledSelect
                    value=""
                    onChange={addTemplateGroup}
                    placeholder="Apply a template…"
                    wrapperClassName="sm:flex-1"
                    options={templateOptions}
                  />
                )}
                <button
                  type="button"
                  onClick={addBlankGroup}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-[#2563EB] border border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors whitespace-nowrap"
                >
                  <Plus size={14} />
                  Blank checklist
                </button>
              </div>
            </div>
          </>
          )
        ) : (
          <>
            {/* Scrollable body — multiple checklists live here and scroll internally
                so the card never stretches the modal, no matter how many you add. */}
            <div className={inline ? 'p-3 pt-0 space-y-3' : 'max-h-[300px] overflow-y-auto p-3 space-y-3'}>
              {groups.map((g) => {
                const multi = groups.length >= 2
                // A linked template's name and items follow the template itself.
                const locked = readOnly || (linkedTemplates && g.source === 'template')
                const note = groupNote?.(g)
                return (
                  <div key={g.key} className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    {/* Group header: editable name (only meaningful with 2+ groups) + template tag + remove */}
                    <div className="flex items-center gap-2 mb-2">
                      {multi && !locked ? (
                        <input
                          type="text"
                          value={g.title}
                          onChange={(e) => updateGroupTitle(g.key, e.target.value)}
                          placeholder="Checklist name"
                          className="flex-1 min-w-0 border-b border-transparent hover:border-[#E2E8F0] focus:border-[#2563EB] px-0.5 py-0.5 text-sm font-semibold text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none bg-transparent"
                        />
                      ) : (
                        <span className="flex-1 text-sm font-semibold text-[#0F172A]">{g.title.trim() || 'Checklist'}</span>
                      )}
                      {g.source === 'template' && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-full px-2 py-0.5">
                          {linkedTemplates && <Link2 size={11} aria-hidden />}
                          {linkedTemplates ? 'Linked template' : 'Template'}
                        </span>
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeGroup(g.key)}
                          className="shrink-0 text-[#94A3B8] hover:text-[#DC2626] transition-colors"
                          aria-label={`Remove checklist “${g.title.trim() || 'Checklist'}”`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {note && <div className="mb-2">{note}</div>}

                    {/* Items */}
                    {g.items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <div className="w-4 h-4 rounded border border-[#CBD5E1] shrink-0" />
                        <span className="flex-1 min-w-0 break-words text-sm text-[#0F172A]">{item.title}</span>
                        {!locked && (
                          <button
                            type="button"
                            onClick={() => removeItemFromGroup(g.key, idx)}
                            className="text-[#94A3B8] hover:text-[#DC2626] transition-colors"
                            aria-label={`Remove “${item.title}”`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {g.items.length === 0 && locked && <p className="text-[13px] text-[#475569]">This template has no items.</p>}

                    {/* Add item to this group */}
                    {!locked && (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="text"
                        value={g.draft}
                        onChange={(e) => updateGroupDraft(g.key, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItemToGroup(g.key) } }}
                        placeholder="Add an item…"
                        className="flex-1 border border-[#CBD5E1] rounded-[8px] px-3 py-[8px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => addItemToGroup(g.key)}
                        className="flex items-center gap-1.5 px-3 py-[8px] text-sm font-medium text-[#2563EB] border border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
                      >
                        <Plus size={14} />
                        Add
                      </button>
                    </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Sticky footer — stays put while the checklists above scroll */}
            {!readOnly && (
            <div className={`flex flex-col sm:flex-row gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] p-3 ${inline ? 'rounded-b-[12px]' : ''}`}>
              {templateOptions.length > 0 && (
                <StyledSelect
                  value=""
                  onChange={addTemplateGroup}
                  placeholder="Add from a template…"
                  wrapperClassName="sm:flex-1"
                  options={templateOptions}
                />
              )}
              <button
                type="button"
                onClick={addBlankGroup}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-[#2563EB] border border-[#2563EB] rounded-[8px] bg-white hover:bg-[#EFF6FF] transition-colors whitespace-nowrap"
              >
                <Plus size={14} />
                Add checklist
              </button>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
