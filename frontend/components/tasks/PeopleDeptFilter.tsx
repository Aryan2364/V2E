'use client'

import React, { useMemo, useState } from 'react'
import { Search, Square, SquareCheck, SquareMinus } from 'lucide-react'

// One selectable person inside a department group.
export interface PersonRow {
  id: string
  name: string
  /** Job role / title — shown read-only on the right of the row. */
  role?: string | null
}

// A department and the people (present on the current work set) who belong to it.
export interface DeptGroup {
  department: string
  people: PersonRow[]
}

type TickState = 'all' | 'some' | 'none'
function Tick({ state }: { state: TickState }) {
  if (state === 'all') return <SquareCheck size={16} className="text-primary-text shrink-0" />
  if (state === 'some') return <SquareMinus size={16} className="text-primary-text shrink-0" />
  return <Square size={16} className="text-[#CBD5E1] shrink-0" />
}

/**
 * Department-grouped people picker used by the task and recurring filter popovers.
 * Modelled on the Status section: a master "All" beside the title, a checkbox on
 * every department that selects/clears everyone in it, and per-person rows with the
 * job role shown read-only on the right. It only lists people who actually appear on
 * the current work — no point offering someone with nothing here.
 *
 * Selection is a plain id list where **empty means "Anyone"** (no narrowing); picking
 * everyone collapses back to that. Search matches department, name, or role.
 */
export default function PeopleDeptFilter({
  title,
  groups,
  selected,
  counts,
  onChange,
}: {
  title: string
  groups: DeptGroup[]
  selected: string[]
  /** Optional per-person task counts, shown read-only on the right of each row. */
  counts?: Map<string, number>
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')

  const allIds = useMemo(
    () => Array.from(new Set(groups.flatMap((g) => g.people.map((p) => p.id)))),
    [groups],
  )
  // Fully controlled: `selected` is the exact set (empty = none). Emptiness is allowed
  // here — the parent's Apply step validates "at least one" and shows the warning.
  const effective = useMemo(() => new Set(selected), [selected])

  const togglePerson = (id: string) => {
    const next = new Set(effective)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange(Array.from(next))
  }
  const toggleDept = (people: PersonRow[]) => {
    const ids = people.map((p) => p.id)
    const allOn = ids.length > 0 && ids.every((id) => effective.has(id))
    const next = new Set(effective)
    if (allOn) ids.forEach((id) => next.delete(id))
    else ids.forEach((id) => next.add(id))
    onChange(Array.from(next))
  }
  const deptState = (people: PersonRow[]): TickState => {
    const on = people.filter((p) => effective.has(p.id)).length
    return on === 0 ? 'none' : on === people.length ? 'all' : 'some'
  }
  const masterState: TickState = allIds.length > 0 && allIds.every((id) => effective.has(id)) ? 'all' : effective.size === 0 ? 'none' : 'some'
  const toggleAll = () => onChange(masterState === 'all' ? [] : [...allIds])

  // Sort (dept name, then person name) and apply search: a matching department name
  // keeps the whole group; otherwise keep the people whose name or role matches.
  const filteredGroups = useMemo(() => {
    const sorted = groups
      .map((g) => ({ ...g, people: [...g.people].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.department.localeCompare(b.department))
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted
      .map((g) => {
        if (g.department.toLowerCase().includes(q)) return g
        const people = g.people.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.role ?? '').toLowerCase().includes(q),
        )
        return { ...g, people }
      })
      .filter((g) => g.people.length > 0)
  }, [groups, query])

  // Nothing to filter by — render nothing (keeps the section out of the popover).
  if (allIds.length === 0) return null

  return (
    <div className="px-3.5 py-2 border-b border-border-light last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[12px] font-medium text-text-secondary">{title}</p>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-text-muted">{allIds.length} {allIds.length === 1 ? 'person' : 'people'}</span>
          <button type="button" onClick={toggleAll} className="flex items-center gap-1.5 group">
            <Tick state={masterState} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted group-hover:text-text-secondary transition-colors">All</span>
          </button>
        </div>
      </div>

      {/* Search — matches department, name, or role. */}
      <div className="flex items-center gap-2 h-[30px] px-2.5 mb-2 rounded-[8px] border border-border-light bg-surface-sunken">
        <Search size={14} className="text-text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search department, name or role"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted focus:outline-hidden"
        />
      </div>

      {/* Grouped, internally-scrolling list — long rosters stay contained. */}
      <div className="flex flex-col gap-0.5 max-h-[210px] overflow-y-auto overscroll-contain">
        {filteredGroups.map((g) => (
          <div key={g.department}>
            <button
              type="button"
              onClick={() => toggleDept(g.people)}
              className="w-full flex items-center gap-2 px-1 pt-1.5 pb-0.5 group"
            >
              <Tick state={deptState(g.people)} />
              <span className="flex-1 min-w-0 truncate text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted group-hover:text-text-secondary transition-colors">
                {g.department}
              </span>
              <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
                {g.people.filter((p) => effective.has(p.id)).length}/{g.people.length}
              </span>
            </button>
            {g.people.map((p) => {
              const checked = effective.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePerson(p.id)}
                  className="w-full flex items-center gap-2 pl-7 pr-1.5 py-1.5 rounded-[6px] text-left hover:bg-surface-sunken transition-colors"
                >
                  {checked ? <SquareCheck size={16} className="text-primary-text shrink-0" /> : <Square size={16} className="text-[#CBD5E1] shrink-0" />}
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className={`min-w-0 truncate text-[13px] ${checked ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>{p.name}</span>
                    {counts && <span className="shrink-0 tabular-nums text-[11px] text-text-muted">{counts.get(p.id) ?? 0}</span>}
                  </span>
                  {p.role && <span className="shrink-0 max-w-[38%] truncate text-[11px] text-text-muted">{p.role}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <p className="px-1.5 py-2 text-[12px] text-text-muted">No people match “{query}”.</p>
        )}
      </div>
    </div>
  )
}
