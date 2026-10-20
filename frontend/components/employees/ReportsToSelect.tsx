'use client'

import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X, Check, UserX } from 'lucide-react'
import { ancestorsOf, flattenTree } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import { useAnchoredPanel } from '@/lib/hooks/useAnchoredPanel'
import type { Department, EmployeeProfile, RoleLevel } from '@/lib/types'

interface Props {
  value: string // selected user_id, '' = no manager
  onChange: (userId: string) => void
  employees: EmployeeProfile[]
  departments: Department[]
  /** The department chosen on the form; drives proximity ordering. */
  selectedDeptId: string
}

const LEVEL_RANK: Record<RoleLevel, number> = {
  head: 0,
  senior: 1,
  mid: 2,
  junior: 3,
}
const rankOf = (lvl?: RoleLevel) => (lvl ? LEVEL_RANK[lvl] : 5)

function initials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

interface DeptGroup {
  dept: Department
  people: EmployeeProfile[]
}

function Avatar({ name, color }: { name?: string; color: string }) {
  return (
    <span
      className="w-7 h-7 shrink-0 rounded-full inline-flex items-center justify-center text-meta font-medium text-white"
      style={{ backgroundColor: color }}
    >
      <span className="translate-y-[0.5px]">{initials(name)}</span>
    </span>
  )
}

export default function ReportsToSelect({
  value,
  onChange,
  employees,
  departments,
  selectedDeptId,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Whether the user has explicitly made a choice (incl. "No manager"). Until
  // then nothing is shown as selected, so the field reads as "not chosen yet".
  const [touched, setTouched] = useState(false)

  const { triggerRef, panelRef, pos, style } = useAnchoredPanel(open, () => setOpen(false))

  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const colorFor = (deptId?: string) => (deptId && colors[deptId]?.base) || 'var(--text-muted)'

  const selected = useMemo(
    () => employees.find((e) => e.user_id === value) ?? null,
    [employees, value],
  )

  // Build ordered, sectioned groups by proximity to the selected department.
  const { suggested, others } = useMemo(() => {
    const flat = flattenTree(departments)
    const depthOf = new Map(flat.map((f) => [f.dept.id, f.depth]))

    const byDept = new Map<string, EmployeeProfile[]>()
    for (const e of employees) {
      const arr = byDept.get(e.department_id)
      if (arr) arr.push(e)
      else byDept.set(e.department_id, [e])
    }
    const sortPeople = (arr: EmployeeProfile[]) =>
      [...arr].sort(
        (a, b) =>
          rankOf(a.role?.level) - rankOf(b.role?.level) ||
          (a.user?.name ?? '').localeCompare(b.user?.name ?? ''),
      )

    // Reporting line: self, then parent → … → root (nearest first).
    const lineIds = selectedDeptId
      ? [
          selectedDeptId,
          ...ancestorsOf(departments, selectedDeptId)
            .slice(0, -1) // drop self (it's the last entry)
            .reverse() // parent, grandparent, … root
            .map((d) => d.id),
        ]
      : []
    const lineSet = new Set(lineIds)

    const toGroup = (deptId: string): DeptGroup | null => {
      const dept = departments.find((d) => d.id === deptId)
      const people = sortPeople(byDept.get(deptId) ?? [])
      return dept && people.length ? { dept, people } : null
    }

    const suggested = lineIds.map(toGroup).filter((g): g is DeptGroup => !!g)

    const others = departments
      .filter((d) => !lineSet.has(d.id))
      .sort(
        (a, b) => (depthOf.get(a.id) ?? 99) - (depthOf.get(b.id) ?? 99) || a.name.localeCompare(b.name),
      )
      .map((d) => toGroup(d.id))
      .filter((g): g is DeptGroup => !!g)

    return { suggested, others }
  }, [departments, employees, selectedDeptId])

  // Apply the search filter to a group list.
  const filterGroups = (groups: DeptGroup[]): DeptGroup[] => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        dept: g.dept,
        people: g.people.filter((p) =>
          [p.user?.name, p.role?.title, g.dept.name].some((s) => (s ?? '').toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.people.length)
  }

  const fSuggested = filterGroups(suggested)
  const fOthers = filterGroups(others)
  const noResults = fSuggested.length === 0 && fOthers.length === 0

  const pick = (userId: string) => {
    setTouched(true)
    onChange(userId)
    setOpen(false)
    setQuery('')
  }

  const triggerCls =
    'w-full flex items-center gap-2.5 border border-border rounded-lg px-3 py-2 text-body text-left bg-surface hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors'

  const PersonRow = ({ p }: { p: EmployeeProfile }) => {
    const isSel = p.user_id === value
    return (
      <button
        type="button"
        onClick={() => pick(p.user_id)}
        className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
          isSel ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
        }`}
      >
        <Avatar name={p.user?.name} color={colorFor(p.department_id)} />
        <span className="flex-1 min-w-0">
          <span className="block text-body font-medium text-text-primary truncate">
            {p.user?.name ?? 'Unknown'}
          </span>
          <span className="block text-meta text-text-muted truncate">
            {p.role?.title ?? 'No role'}
            {p.department?.name ? ` · ${p.department.name}` : ''}
          </span>
        </span>
        {isSel && <Check size={15} className="text-primary-text shrink-0" />}
      </button>
    )
  }

  const Group = ({ g }: { g: DeptGroup }) => (
    <div>
      <div className="sticky top-0 z-1 flex items-center gap-2 px-3 py-1.5 bg-surface-control border-y border-border-light">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorFor(g.dept.id) }} />
        <span className="text-meta font-medium text-text-secondary truncate">
          {g.dept.name}
        </span>
        <span className="ml-auto text-meta text-text-muted">{g.people.length}</span>
      </div>
      {g.people.map((p) => (
        <PersonRow key={p.id} p={p} />
      ))}
    </div>
  )

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        {selected ? (
          <>
            <Avatar name={selected.user?.name} color={colorFor(selected.department_id)} />
            <span className="flex-1 min-w-0">
              <span className="block text-body font-medium text-text-primary truncate">
                {selected.user?.name ?? 'Unknown'}
              </span>
              <span className="block text-meta text-text-muted truncate">
                {selected.role?.title ?? 'No role'}
                {selected.department?.name ? ` · ${selected.department.name}` : ''}
              </span>
            </span>
          </>
        ) : touched ? (
          <>
            <span className="w-7 h-7 shrink-0 rounded-full inline-flex items-center justify-center bg-surface-control text-text-muted">
              <UserX size={14} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-body font-medium text-text-primary truncate">No manager</span>
              <span className="block text-meta text-text-muted truncate">Reports to no one</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-text-muted">Select manager</span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-80 flex flex-col border border-border-light rounded-xl bg-surface shadow-menu overflow-hidden"
          >
            {/* Search */}
            <div className="relative border-b border-border-light shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="w-full pl-8 pr-8 py-2.5 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden"
              autoFocus
            />
            {query && (
              <Tooltip label="Clear search">
                <Button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  variant="in-field"
                  size="icon-sm"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X size={14} />
                </Button>
              </Tooltip>
            )}
          </div>

            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
              {/* No-manager — scrolls with the list (not pinned) */}
              <button
                type="button"
                onClick={() => pick('')}
                className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  touched && !value ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                }`}
              >
                <span className="w-7 h-7 shrink-0 rounded-full inline-flex items-center justify-center bg-surface-control text-text-muted">
                  <UserX size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-body font-medium text-text-secondary">No manager</span>
                  <span className="block text-meta text-text-muted">Reports to no one</span>
                </span>
                {touched && !value && <Check size={15} className="text-primary-text shrink-0" />}
              </button>

              {fSuggested.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-meta font-medium text-primary-text">
                Reporting line
              </div>
            )}
            {fSuggested.map((g) => (
              <Group key={g.dept.id} g={g} />
            ))}

            {fOthers.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-meta font-medium text-text-muted">
                Other departments
              </div>
            )}
            {fOthers.map((g) => (
              <Group key={g.dept.id} g={g} />
            ))}

            {noResults && (
              <p className="px-3 py-6 text-center text-body text-text-muted">No people found.</p>
            )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
