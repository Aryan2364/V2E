'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Filter, Square, SquareCheck, SquareMinus, AlertTriangle } from 'lucide-react'
import type { Task, TaskCategory, TaskPriority, TaskStatus, TaskTagRef } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import { tagDotClass } from '@/lib/tasks/tagColors'
import PeopleDeptFilter, { type DeptGroup } from './PeopleDeptFilter'
import {
  type TaskFilters,
  type DeadlineKey,
  EMPTY_TASK_FILTERS,
  countActiveFilters,
  applyTaskFilters,
} from './TaskFilterBar'

const ALL_DEADLINES: DeadlineKey[] = ['overdue', 'upcoming']
const DEADLINE_LABEL: Record<DeadlineKey, string> = { overdue: 'Overdue', upcoming: 'Upcoming' }

// ─── Little building blocks ─────────────────────────────────────────────────────

// `color` is a master's stored hex (statuses, priorities, categories); `dotClassName` is
// the class-based alternative used by tags, whose colours live only in globals.css.
function Pill({ active, onClick, color, dotClassName, count, children }: { active: boolean; onClick: () => void; color?: string; dotClassName?: string; count?: number; children: React.ReactNode }) {
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
      {count !== undefined && <span className={`tabular-nums ${active ? 'text-[#2563EB]' : 'text-[#94A3B8]'}`}>{count}</span>}
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

// Tri-state of a selected Set against the full list of available values.
function tick<T>(set: Set<T>, all: T[]): TickState {
  if (all.length > 0 && all.every((x) => set.has(x))) return 'all'
  return set.size === 0 ? 'none' : 'some'
}
const eqSet = <T,>(set: Set<T>, all: T[]) => set.size === all.length && all.every((x) => set.has(x))

// Everything the popover is editing, held as explicit id sets so a section can be
// emptied while drafting (the current applied filters use "empty = all").
interface Draft {
  statuses: Set<string>
  deadlines: Set<DeadlineKey>
  priorities: Set<string>
  categories: Set<string>
  users: Set<string>
  tags: Set<string>
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Collapsed filter control. Opening it edits a DRAFT — the underlying list does not
 * change until "Apply". Every section is a multi-select; the draft may be emptied
 * mid-edit, and Apply is blocked (with a warning naming the empty sections) until each
 * one has at least one selection. The panel is an in-flow absolute element (never a
 * portal) so it moves with the toolbar and never drifts — see memory `no-overflow-parent`.
 */
export default function TaskFilterPopover({
  tasks,
  statuses,
  priorities,
  categories,
  filters,
  onChange,
}: {
  tasks: Task[]
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  categories: TaskCategory[]
  filters: TaskFilters
  onChange: (f: TaskFilters) => void
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

  // ── Available option sets ──────────────────────────────────────────────────────
  const openStatuses = useMemo(() => statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type)).sort((a, b) => a.order_index - b.order_index), [statuses])
  const closedStatuses = useMemo(() => statuses.filter((s) => TERMINAL_STATUS_PHASES.includes(s.type)).sort((a, b) => a.order_index - b.order_index), [statuses])
  const allStatusIds = useMemo(() => statuses.map((s) => s.id), [statuses])
  const openStatusIds = useMemo(() => openStatuses.map((s) => s.id), [openStatuses])
  const allPriorityIds = useMemo(() => priorities.map((p) => p.id), [priorities])
  const allCategoryIds = useMemo(() => categories.map((c) => c.id), [categories])

  // Tags actually on the tasks in view (not the whole master list), so every option can
  // match something. Sorted by name; the section hides when no task here has a tag.
  const tagOptions = useMemo<TaskTagRef[]>(() => {
    const byId = new Map<string, TaskTagRef>()
    for (const t of tasks) for (const tag of t.tags ?? []) if (!byId.has(tag.id)) byId.set(tag.id, tag)
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [tasks])
  const allTagIds = useMemo(() => tagOptions.map((t) => t.id), [tagOptions])

  // People appearing on these tasks, grouped by department, each with their job role.
  const peopleGroups = useMemo<DeptGroup[]>(() => {
    const byId = new Map<string, { name: string; role?: string | null; dept: string }>()
    for (const t of tasks) {
      for (const a of t.assignees ?? []) {
        if (byId.has(a.user_id)) continue
        const name = a.user?.name ?? a.user_name
        if (!name) continue
        byId.set(a.user_id, { name, role: a.user?.role_title, dept: a.user?.department || 'No department' })
      }
    }
    const groups = new Map<string, { id: string; name: string; role?: string | null }[]>()
    byId.forEach((info, id) => {
      if (!groups.has(info.dept)) groups.set(info.dept, [])
      groups.get(info.dept)!.push({ id, name: info.name, role: info.role })
    })
    return Array.from(groups, ([department, people]) => ({ department, people }))
  }, [tasks])
  const allUserIds = useMemo(() => peopleGroups.flatMap((g) => g.people.map((p) => p.id)), [peopleGroups])

  // ── Draft (explicit sets; "empty applied" expands to the full set) ───────────────
  const buildDraft = (f: TaskFilters): Draft => ({
    statuses: new Set(f.statusMode === 'all' ? allStatusIds : f.statusMode === 'open' ? openStatusIds : f.statusIds),
    deadlines: new Set(f.deadlines.length ? f.deadlines : ALL_DEADLINES),
    priorities: new Set(f.priorityIds.length ? f.priorityIds : allPriorityIds),
    categories: new Set(f.categoryIds.length ? f.categoryIds : allCategoryIds),
    users: new Set(f.userIds.length ? f.userIds : allUserIds),
    // A stored tag that is no longer on any task in view cannot be shown or matched;
    // drop it, and treat "nothing left" as the default (every tag).
    tags: (() => {
      const known = f.tagIds.filter((id) => allTagIds.includes(id))
      return new Set(known.length ? known : allTagIds)
    })(),
  })
  const [draft, setDraft] = useState<Draft>(() => buildDraft(filters))

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

  const activeCount = countActiveFilters(filters)

  // ── Draft mutators ──────────────────────────────────────────────────────────────
  const toggleValue = <K extends keyof Draft>(key: K, value: Draft[K] extends Set<infer V> ? V : never) => {
    setDraft((d) => {
      const next = new Set(d[key] as Set<unknown>)
      next.has(value) ? next.delete(value) : next.add(value)
      return { ...d, [key]: next }
    })
  }
  const toggleMany = <K extends keyof Draft>(key: K, values: (Draft[K] extends Set<infer V> ? V : never)[]) => {
    setDraft((d) => {
      const cur = d[key] as Set<unknown>
      const allOn = values.length > 0 && values.every((v) => cur.has(v))
      const next = new Set(cur)
      values.forEach((v) => (allOn ? next.delete(v) : next.add(v)))
      return { ...d, [key]: next }
    })
  }

  // ── Validation ────────────────────────────────────────────────────────────────
  const empties = useMemo(() => {
    const list: string[] = []
    if (allStatusIds.length > 0 && draft.statuses.size === 0) list.push('Status')
    if (draft.deadlines.size === 0) list.push('Deadline')
    if (allPriorityIds.length > 0 && draft.priorities.size === 0) list.push('Priority')
    if (allCategoryIds.length > 0 && draft.categories.size === 0) list.push('Category')
    if (allUserIds.length > 0 && draft.users.size === 0) list.push('Assignee')
    if (allTagIds.length > 0 && draft.tags.size === 0) list.push('Tags')
    return list
  }, [draft, allStatusIds.length, allPriorityIds.length, allCategoryIds.length, allUserIds.length, allTagIds.length])

  // ── Per-option task counts ──────────────────────────────────────────────────────
  // For each section, count tasks matching each option AFTER applying every OTHER
  // section's current draft selection — so a count always equals what picking it shows.
  // An empty or fully-selected section is treated as "no narrowing" for this purpose.
  const statusApplied = (): Pick<TaskFilters, 'statusMode' | 'statusIds'> => {
    if (draft.statuses.size === 0 || eqSet(draft.statuses, allStatusIds)) return { statusMode: 'all', statusIds: [] }
    if (eqSet(draft.statuses, openStatusIds)) return { statusMode: 'open', statusIds: [] }
    return { statusMode: 'custom', statusIds: Array.from(draft.statuses) }
  }
  const draftToFilters = (exclude: keyof Draft): TaskFilters => {
    const subset = <T,>(key: keyof Draft, set: Set<T>, all: T[]): T[] =>
      exclude === key || set.size === 0 || eqSet(set, all) ? [] : Array.from(set)
    return {
      ...(exclude === 'statuses' ? { statusMode: 'all' as const, statusIds: [] } : statusApplied()),
      deadlines: subset('deadlines', draft.deadlines, ALL_DEADLINES),
      priorityIds: subset('priorities', draft.priorities, allPriorityIds),
      categoryIds: subset('categories', draft.categories, allCategoryIds),
      userIds: subset('users', draft.users, allUserIds),
      tagIds: subset('tags', draft.tags, allTagIds),
    }
  }
  const counts = useMemo(() => {
    const tally = (list: Task[], key: (t: Task) => string | null | undefined) => {
      const m = new Map<string, number>()
      for (const t of list) { const k = key(t); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
      return m
    }
    const dl = applyTaskFilters(tasks, draftToFilters('deadlines'), statuses)
    const userList = applyTaskFilters(tasks, draftToFilters('users'), statuses)
    const users = new Map<string, number>()
    for (const t of userList) {
      const seen = new Set<string>()
      for (const a of t.assignees ?? []) {
        if (!seen.has(a.user_id)) { seen.add(a.user_id); users.set(a.user_id, (users.get(a.user_id) ?? 0) + 1) }
      }
    }
    // A task carries several tags, so each of its tags counts it once.
    const tags = new Map<string, number>()
    for (const t of applyTaskFilters(tasks, draftToFilters('tags'), statuses)) {
      const seen = new Set<string>()
      for (const tag of t.tags ?? []) {
        if (!seen.has(tag.id)) { seen.add(tag.id); tags.set(tag.id, (tags.get(tag.id) ?? 0) + 1) }
      }
    }
    return {
      status: tally(applyTaskFilters(tasks, draftToFilters('statuses'), statuses), (t) => t.status_id),
      deadline: { overdue: dl.filter((t) => t.is_overdue).length, upcoming: dl.filter((t) => !t.is_overdue).length } as Record<DeadlineKey, number>,
      priority: tally(applyTaskFilters(tasks, draftToFilters('priorities'), statuses), (t) => t.priority_id),
      category: tally(applyTaskFilters(tasks, draftToFilters('categories'), statuses), (t) => t.category_id),
      user: users,
      tag: tags,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, draft, statuses, allStatusIds, openStatusIds, allPriorityIds, allCategoryIds, allUserIds, allTagIds])

  // How many tasks the ENTIRE current draft matches (all sections combined) — the top
  // line, so a narrowing combo that yields nothing (e.g. Overdue + Low) is obvious. An
  // emptied section means nothing can match.
  const matchCount = useMemo(() => {
    if (empties.length > 0) return 0
    const f: TaskFilters = {
      ...statusApplied(),
      deadlines: eqSet(draft.deadlines, ALL_DEADLINES) ? [] : Array.from(draft.deadlines),
      priorityIds: eqSet(draft.priorities, allPriorityIds) ? [] : Array.from(draft.priorities),
      categoryIds: eqSet(draft.categories, allCategoryIds) ? [] : Array.from(draft.categories),
      userIds: eqSet(draft.users, allUserIds) ? [] : Array.from(draft.users),
      tagIds: eqSet(draft.tags, allTagIds) ? [] : Array.from(draft.tags),
    }
    return applyTaskFilters(tasks, f, statuses).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, draft, empties.length, statuses, allStatusIds, openStatusIds, allPriorityIds, allCategoryIds, allUserIds, allTagIds])

  const apply = () => {
    if (empties.length) return
    const status = eqSet(draft.statuses, allStatusIds)
      ? { statusMode: 'all' as const, statusIds: [] }
      : eqSet(draft.statuses, openStatusIds)
        ? { statusMode: 'open' as const, statusIds: [] }
        : { statusMode: 'custom' as const, statusIds: Array.from(draft.statuses) }
    onChange({
      ...status,
      deadlines: eqSet(draft.deadlines, ALL_DEADLINES) ? [] : Array.from(draft.deadlines),
      priorityIds: eqSet(draft.priorities, allPriorityIds) ? [] : Array.from(draft.priorities),
      categoryIds: eqSet(draft.categories, allCategoryIds) ? [] : Array.from(draft.categories),
      userIds: eqSet(draft.users, allUserIds) ? [] : Array.from(draft.users),
      tagIds: eqSet(draft.tags, allTagIds) ? [] : Array.from(draft.tags),
    })
    setOpen(false)
  }
  const clearAll = () => setDraft(buildDraft(EMPTY_TASK_FILTERS))

  const statusGroup = (title: string, group: TaskStatus[]) => {
    if (group.length === 0) return null
    return (
      <div>
        <div className="mb-1.5">
          <CheckToggle state={tick(draft.statuses, group.map((s) => s.id))} label={title} onClick={() => toggleMany('statuses', group.map((s) => s.id))} />
        </div>
        <div className="flex flex-wrap gap-1.5 pl-[22px]">
          {group.map((s) => (
            <Pill key={s.id} active={draft.statuses.has(s.id)} onClick={() => toggleValue('statuses', s.id)} color={s.color} count={counts.status.get(s.id) ?? 0}>
              {s.label}
            </Pill>
          ))}
        </div>
      </div>
    )
  }

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
          {/* Sticky header: title · Clear all · Apply */}
          <div className="sticky top-0 z-10 px-3.5 py-2.5 border-b border-[#E2E8F0] bg-white">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-[#0F172A]">Filters</span>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  <span className="font-semibold text-[#0F172A] tabular-nums">{matchCount}</span> of {tasks.length} task{tasks.length !== 1 ? 's' : ''} match
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={clearAll} className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A]">Reset</button>
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
          <Section title="Status" right={<CheckToggle state={tick(draft.statuses, allStatusIds)} label="All" onClick={() => toggleMany('statuses', allStatusIds)} />}>
            <div className="space-y-2.5">
              {statusGroup('Open', openStatuses)}
              {statusGroup('Closed', closedStatuses)}
            </div>
          </Section>

          {/* Deadline */}
          <Section title="Deadline" right={<CheckToggle state={tick(draft.deadlines, ALL_DEADLINES)} label="All" onClick={() => toggleMany('deadlines', ALL_DEADLINES)} />}>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DEADLINES.map((k) => (
                <Pill key={k} active={draft.deadlines.has(k)} onClick={() => toggleValue('deadlines', k)} count={counts.deadline[k]}>
                  {DEADLINE_LABEL[k]}
                </Pill>
              ))}
            </div>
          </Section>

          {/* Priority */}
          {priorities.length > 0 && (
            <Section title="Priority" right={<CheckToggle state={tick(draft.priorities, allPriorityIds)} label="All" onClick={() => toggleMany('priorities', allPriorityIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {priorities.map((p) => (
                  <Pill key={p.id} active={draft.priorities.has(p.id)} onClick={() => toggleValue('priorities', p.id)} color={p.color} count={counts.priority.get(p.id) ?? 0}>
                    {p.label}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Category — only when the org actually has categories. */}
          {categories.length > 0 && (
            <Section title="Category" right={<CheckToggle state={tick(draft.categories, allCategoryIds)} label="All" onClick={() => toggleMany('categories', allCategoryIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <Pill key={c.id} active={draft.categories.has(c.id)} onClick={() => toggleValue('categories', c.id)} color={c.color} count={counts.category.get(c.id) ?? 0}>
                    {c.name}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Tags — only the tags on the tasks in view; hidden when none of them has one.
              Picking several matches a task carrying ANY of them. */}
          {tagOptions.length > 0 && (
            <Section title="Tags" right={<CheckToggle state={tick(draft.tags, allTagIds)} label="All" onClick={() => toggleMany('tags', allTagIds)} />}>
              <div className="flex flex-wrap gap-1.5">
                {tagOptions.map((tag) => (
                  <Pill key={tag.id} active={draft.tags.has(tag.id)} onClick={() => toggleValue('tags', tag.id)} dotClassName={tagDotClass(tag.color, !tag.is_active)} count={counts.tag.get(tag.id) ?? 0}>
                    {tag.name}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {/* Assignee — department-grouped multi-select over people present on these tasks. */}
          <PeopleDeptFilter
            title="Assignee"
            groups={peopleGroups}
            selected={Array.from(draft.users)}
            counts={counts.user}
            onChange={(ids) => setDraft((d) => ({ ...d, users: new Set(ids) }))}
          />
        </div>
      )}
    </div>
  )
}
