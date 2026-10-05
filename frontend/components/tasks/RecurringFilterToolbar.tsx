'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Filter, Search, X, Square, SquareCheck, SquareMinus, AlertTriangle } from 'lucide-react'
import type { TaskCategory, TaskPriority, TaskTagRef } from '@/lib/types/tasks'
import { tagDotClass } from '@/lib/tasks/tagColors'
import PeopleDeptFilter, { type DeptGroup } from './PeopleDeptFilter'

// ─── Filter model ───────────────────────────────────────────────────────────────

export type RecurringStatusKey = 'active' | 'paused'
const ALL_STATUSES: RecurringStatusKey[] = ['active', 'paused']
const STATUS_META: Record<RecurringStatusKey, { label: string; color: string }> = {
  active: { label: 'Active', color: '#16A34A' },
  paused: { label: 'Paused', color: '#DC2626' },
}

export interface RecurringFilters {
  /** Selected statuses — empty = all (active + paused). */
  statuses: RecurringStatusKey[]
  /** Selected priority ids — empty = all. */
  priorityIds: string[]
  /** Selected category ids — empty = all. */
  categoryIds: string[]
  /** Selected assignee ids — empty = all (Anyone). */
  assigneeIds: string[]
  /** Selected tag ids — empty = all. A template matches when it carries ANY of them. */
  tagIds: string[]
}

export const EMPTY_RECURRING_FILTERS: RecurringFilters = {
  statuses: [],
  priorityIds: [],
  categoryIds: [],
  assigneeIds: [],
  tagIds: [],
}

/**
 * Fill in any section a stored filter object is missing. Filters persist in
 * sessionStorage, so an object saved before a section existed (e.g. `tagIds`) must
 * still load: missing or malformed fields fall back to "all".
 */
export function normalizeRecurringFilters(raw: Partial<RecurringFilters> | null | undefined): RecurringFilters {
  const r = (raw ?? {}) as Partial<RecurringFilters>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    statuses: arr<RecurringStatusKey>(r.statuses).filter((k) => ALL_STATUSES.includes(k)),
    priorityIds: arr(r.priorityIds),
    categoryIds: arr(r.categoryIds),
    assigneeIds: arr(r.assigneeIds),
    tagIds: arr(r.tagIds),
  }
}

export function isRecurringFiltered(f: RecurringFilters): boolean {
  return f.statuses.length > 0 || f.priorityIds.length > 0 || f.categoryIds.length > 0 || f.assigneeIds.length > 0 || f.tagIds.length > 0
}

/** The tags on a set of templates (not the whole master list), de-duplicated and sorted by name. */
export function tagsOnTemplates(templates: { tags?: TaskTagRef[] }[]): TaskTagRef[] {
  const byId = new Map<string, TaskTagRef>()
  for (const t of templates) for (const tag of t.tags ?? []) if (!byId.has(tag.id)) byId.set(tag.id, tag)
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function countActiveRecurringFilters(f: RecurringFilters): number {
  return (
    (f.statuses.length > 0 ? 1 : 0) +
    (f.priorityIds.length > 0 ? 1 : 0) +
    (f.categoryIds.length > 0 ? 1 : 0) +
    (f.assigneeIds.length > 0 ? 1 : 0) +
    (f.tagIds.length > 0 ? 1 : 0)
  )
}

// ─── Little building blocks (mirror TaskFilterPopover) ───────────────────────────

// `color` is a master's stored hex; `dotClassName` is the class-based alternative used by
// tags, whose colours live only in globals.css.
function Pill({ active, onClick, color, dotClassName, children }: { active: boolean; onClick: () => void; color?: string; dotClassName?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-[999px] border transition-colors ${
        active ? 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE] font-medium' : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#94A3B8]'
      }`}
    >
      {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      {!color && dotClassName && <span className={`w-2 h-2 rounded-full shrink-0 ${dotClassName}`} />}
      {children}
    </button>
  )
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2 border-b border-[#E2E8F0] last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[12px] font-medium text-[#475569]">{title}</p>
        {right}
      </div>
      {children}
    </div>
  )
}

type TickState = 'all' | 'some' | 'none'
function Tick({ state }: { state: TickState }) {
  if (state === 'all') return <SquareCheck size={16} className="text-[#2563EB] shrink-0" />
  if (state === 'some') return <SquareMinus size={16} className="text-[#2563EB] shrink-0" />
  return <Square size={16} className="text-[#CBD5E1] shrink-0" />
}
function CheckToggle({ state, label, onClick }: { state: TickState; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 group">
      <Tick state={state} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B] group-hover:text-[#475569] transition-colors">{label}</span>
    </button>
  )
}
function tick<T>(set: Set<T>, all: T[]): TickState {
  if (all.length > 0 && all.every((x) => set.has(x))) return 'all'
  return set.size === 0 ? 'none' : 'some'
}
const eqSet = <T,>(set: Set<T>, all: T[]) => set.size === all.length && all.every((x) => set.has(x))

interface RDraft {
  statuses: Set<RecurringStatusKey>
  priorities: Set<string>
  categories: Set<string>
  assignees: Set<string>
  tags: Set<string>
}

// ─── Collapsed Filters popover ───────────────────────────────────────────────────

/**
 * Collapsed filter control for recurring templates — the draft/Apply twin of the Tasks
 * screens' TaskFilterPopover. Selections edit a draft; the list changes only on Apply,
 * which is blocked (with a warning) until every section has at least one selection.
 */
function RecurringFilterPopover({
  filters,
  onChange,
  priorities,
  categories,
  tags,
  peopleGroups,
}: {
  filters: RecurringFilters
  onChange: (f: RecurringFilters) => void
  priorities: TaskPriority[]
  categories: TaskCategory[]
  /** Tags on the templates in view — the only ones that can match. */
  tags: TaskTagRef[]
  peopleGroups: DeptGroup[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const DESIRED_MAX = 560
  const MARGIN = 12
  const [panelMaxH, setPanelMaxH] = useState(DESIRED_MAX)
  const [dropUp, setDropUp] = useState(false)

  const measure = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN
    const spaceAbove = rect.top - MARGIN
    const up = spaceBelow < 280 && spaceAbove > spaceBelow
    setDropUp(up)
    const room = Math.max(0, up ? spaceAbove : spaceBelow)
    setPanelMaxH(Math.max(220, Math.min(DESIRED_MAX, room)))
  }

  const allPriorityIds = useMemo(() => priorities.map((p) => p.id), [priorities])
  const allCategoryIds = useMemo(() => categories.map((c) => c.id), [categories])
  const allUserIds = useMemo(() => peopleGroups.flatMap((g) => g.people.map((p) => p.id)), [peopleGroups])
  const allTagIds = useMemo(() => tags.map((t) => t.id), [tags])

  const buildDraft = (f: RecurringFilters): RDraft => ({
    statuses: new Set(f.statuses.length ? f.statuses : ALL_STATUSES),
    priorities: new Set(f.priorityIds.length ? f.priorityIds : allPriorityIds),
    categories: new Set(f.categoryIds.length ? f.categoryIds : allCategoryIds),
    assignees: new Set(f.assigneeIds.length ? f.assigneeIds : allUserIds),
    // A stored tag no longer on any template in view cannot be shown; drop it, and treat
    // "nothing left" as the default (every tag).
    tags: (() => {
      const known = f.tagIds.filter((id) => allTagIds.includes(id))
      return new Set(known.length ? known : allTagIds)
    })(),
  })
  const [draft, setDraft] = useState<RDraft>(() => buildDraft(filters))

  const openPanel = () => { setDraft(buildDraft(filters)); measure(); setOpen(true) }
  const toggle = () => (open ? setOpen(false) : openPanel())

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    const onResize = () => measure()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const activeCount = countActiveRecurringFilters(filters)

  const toggleValue = <K extends keyof RDraft>(key: K, value: RDraft[K] extends Set<infer V> ? V : never) => {
    setDraft((d) => {
      const next = new Set(d[key] as Set<unknown>)
      next.has(value) ? next.delete(value) : next.add(value)
      return { ...d, [key]: next }
    })
  }
  const toggleAllIn = <K extends keyof RDraft>(key: K, values: (RDraft[K] extends Set<infer V> ? V : never)[]) => {
    setDraft((d) => {
      const cur = d[key] as Set<unknown>
      const allOn = values.length > 0 && values.every((v) => cur.has(v))
      const next = new Set(cur)
      values.forEach((v) => (allOn ? next.delete(v) : next.add(v)))
      return { ...d, [key]: next }
    })
  }

  const empties = useMemo(() => {
    const list: string[] = []
    if (draft.statuses.size === 0) list.push('Status')
    if (allPriorityIds.length > 0 && draft.priorities.size === 0) list.push('Priority')
    if (allCategoryIds.length > 0 && draft.categories.size === 0) list.push('Category')
    if (allUserIds.length > 0 && draft.assignees.size === 0) list.push('Assignee')
    if (allTagIds.length > 0 && draft.tags.size === 0) list.push('Tags')
    return list
  }, [draft, allPriorityIds.length, allCategoryIds.length, allUserIds.length, allTagIds.length])

  const apply = () => {
    if (empties.length) return
    onChange({
      statuses: eqSet(draft.statuses, ALL_STATUSES) ? [] : Array.from(draft.statuses),
      priorityIds: eqSet(draft.priorities, allPriorityIds) ? [] : Array.from(draft.priorities),
      categoryIds: eqSet(draft.categories, allCategoryIds) ? [] : Array.from(draft.categories),
      assigneeIds: eqSet(draft.assignees, allUserIds) ? [] : Array.from(draft.assignees),
      tagIds: eqSet(draft.tags, allTagIds) ? [] : Array.from(draft.tags),
    })
    setOpen(false)
  }
  const clearAll = () => setDraft(buildDraft(EMPTY_RECURRING_FILTERS))

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-2 h-[38px] px-3 rounded-[8px] border text-sm font-medium transition-colors ${
          activeCount > 0 || open ? 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]' : 'bg-[#F8FAFC] text-[#475569] border-[#CBD5E1] hover:border-[#94A3B8]'
        }`}
      >
        <Filter size={16} />
        Filters
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">{activeCount}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          style={{ maxHeight: panelMaxH }}
          className={`absolute right-0 ${dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'} z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-[12px] border border-[#E2E8F0] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)]`}
        >
          <div className="sticky top-0 z-10 px-3.5 py-2.5 border-b border-[#E2E8F0] bg-white">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#0F172A]">Filters</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={clearAll} className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A]">Clear all</button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={empties.length > 0}
                  className="text-[12px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#CBD5E1] disabled:cursor-not-allowed rounded-[7px] px-3 py-1 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
            {empties.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 rounded-[8px] bg-[#FEF9C3] border border-[#FDE68A] px-2.5 py-1.5">
                <AlertTriangle size={13} className="text-[#CA8A04] shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#854D0E]">Select at least one in {empties.join(', ')} to apply.</p>
              </div>
            )}
          </div>

          {/* Status */}
          <Section title="Status" right={<CheckToggle state={tick(draft.statuses, ALL_STATUSES)} label="All" onClick={() => toggleAllIn('statuses', ALL_STATUSES)} />}>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((k) => (
                <Pill key={k} active={draft.statuses.has(k)} onClick={() => toggleValue('statuses', k)} color={STATUS_META[k].color}>
                  {STATUS_META[k].label}
                </Pill>
              ))}
            </div>
          </Section>

          {/* Priority */}
          {priorities.length > 0 && (
            <Section title="Priority" right={<CheckToggle state={tick(draft.priorities, allPriorityIds)} label="All" onClick={() => toggleAllIn('priorities', allPriorityIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {priorities.map((p) => (
                  <Pill key={p.id} active={draft.priorities.has(p.id)} onClick={() => toggleValue('priorities', p.id)} color={p.color}>
                    {p.label}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Category — only when the org actually has categories. */}
          {categories.length > 0 && (
            <Section title="Category" right={<CheckToggle state={tick(draft.categories, allCategoryIds)} label="All" onClick={() => toggleAllIn('categories', allCategoryIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <Pill key={c.id} active={draft.categories.has(c.id)} onClick={() => toggleValue('categories', c.id)} color={c.color}>
                    {c.name}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Tags — only the tags on the templates in view; hidden when none has one. */}
          {tags.length > 0 && (
            <Section title="Tags" right={<CheckToggle state={tick(draft.tags, allTagIds)} label="All" onClick={() => toggleAllIn('tags', allTagIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Pill key={tag.id} active={draft.tags.has(tag.id)} onClick={() => toggleValue('tags', tag.id)} dotClassName={tagDotClass(tag.color, !tag.is_active)}>
                    {tag.name}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Assignee — department-grouped multi-select over the people on these templates. */}
          <PeopleDeptFilter
            title="Assignee"
            groups={peopleGroups}
            selected={Array.from(draft.assignees)}
            onChange={(ids) => setDraft((d) => ({ ...d, assignees: new Set(ids) }))}
          />
        </div>
      )}
    </div>
  )
}

// ─── Removable active-filter chips ───────────────────────────────────────────────

function RecurringFilterChips({
  filters,
  onChange,
  priorities,
  categories,
  tags,
  peopleGroups,
}: {
  filters: RecurringFilters
  onChange: (f: RecurringFilters) => void
  priorities: TaskPriority[]
  categories: TaskCategory[]
  tags: TaskTagRef[]
  peopleGroups: DeptGroup[]
}) {
  const set = (patch: Partial<RecurringFilters>) => onChange({ ...filters, ...patch })
  const chips: { key: string; label: string; onRemove: () => void }[] = []

  if (filters.statuses.length > 0) {
    const label = filters.statuses.map((s) => STATUS_META[s].label).join(', ')
    chips.push({ key: 'status', label: `Status: ${label}`, onRemove: () => set({ statuses: [] }) })
  }
  if (filters.priorityIds.length > 0) {
    const names = filters.priorityIds.map((id) => priorities.find((x) => x.id === id)?.label ?? '—')
    const label = names.length <= 2 ? `Priority: ${names.join(', ')}` : `Priority: ${names.length} selected`
    chips.push({ key: 'priority', label, onRemove: () => set({ priorityIds: [] }) })
  }
  if (filters.categoryIds.length > 0) {
    const names = filters.categoryIds.map((id) => categories.find((x) => x.id === id)?.name ?? '—')
    const label = names.length <= 2 ? `Category: ${names.join(', ')}` : `Category: ${names.length} selected`
    chips.push({ key: 'category', label, onRemove: () => set({ categoryIds: [] }) })
  }
  if (filters.tagIds.length > 0) {
    const names = filters.tagIds.map((id) => tags.find((x) => x.id === id)?.name ?? 'Unknown tag')
    const label = names.length <= 2 ? `Tags: ${names.join(', ')}` : `Tags: ${names.length} selected`
    chips.push({ key: 'tags', label, onRemove: () => set({ tagIds: [] }) })
  }
  if (filters.assigneeIds.length > 0) {
    const nameOf = (id: string) => peopleGroups.flatMap((g) => g.people).find((p) => p.id === id)?.name ?? '—'
    const names = filters.assigneeIds.map(nameOf)
    const label = names.length <= 2 ? `Assignee: ${names.join(', ')}` : `Assignee: ${names.length} selected`
    chips.push({ key: 'assignee', label, onRemove: () => set({ assigneeIds: [] }) })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 text-[12px] pl-2.5 pr-1.5 py-1 rounded-[999px] bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove ${chip.label} filter`}
            className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-[#DBEAFE] transition-colors"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...EMPTY_RECURRING_FILTERS })}
        className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A] px-1.5 py-1 transition-colors"
      >
        Clear all
      </button>
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────────

/**
 * The one-row recurring toolbar — mirrors TaskListToolbar so Recurring reads identically
 * to My Tasks / Assigned: a grow-to-fit search box, the collapsed Filters popover (with an
 * active-count badge), an optional trailing slot (the cards/table view toggle), and the
 * removable filter chips underneath.
 */
export default function RecurringFilterToolbar({
  search,
  onSearch,
  filters,
  onFilters,
  priorities,
  categories,
  tags = [],
  peopleGroups,
  trailing,
}: {
  search: string
  onSearch: (v: string) => void
  filters: RecurringFilters
  onFilters: (f: RecurringFilters) => void
  priorities: TaskPriority[]
  categories: TaskCategory[]
  /** Tags on the templates in view (see `tagsOnTemplates`). Omit or [] to hide the section. */
  tags?: TaskTagRef[]
  peopleGroups: DeptGroup[]
  trailing?: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search templates by title, tag, category or person"
            className="w-full h-[38px] pl-9 pr-9 rounded-[8px] border border-[#CBD5E1] bg-[#F8FAFC] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:bg-white transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569] transition-colors"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <RecurringFilterPopover
          filters={filters}
          onChange={onFilters}
          priorities={priorities}
          categories={categories}
          tags={tags}
          peopleGroups={peopleGroups}
        />
        {trailing}
      </div>
      <RecurringFilterChips
        filters={filters}
        onChange={onFilters}
        priorities={priorities}
        categories={categories}
        tags={tags}
        peopleGroups={peopleGroups}
      />
    </div>
  )
}
