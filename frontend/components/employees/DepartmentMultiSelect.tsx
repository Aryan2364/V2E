'use client'

import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X, Check, Minus, Building2 } from 'lucide-react'
import { flattenTree, descendantsOf, ancestorsOf } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import type { Department } from '@/lib/types'

interface Props {
  /** Selected department ids. Empty = "all" (no filter). */
  selected: string[]
  onChange: (ids: string[]) => void
  departments: Department[]
  /** Label shown on the trigger + as the reset row when nothing is selected. */
  allLabel?: string
}

/**
 * Multi-select department picker with parent → sub-department cascade.
 *
 * Ticking a department selects it AND its whole sub-tree; any individual
 * descendant can then be un-ticked. A parent renders checked when its entire
 * sub-tree is selected, indeterminate when only part of it is. An empty
 * selection means "all departments" (no filter).
 *
 * Always renders its panel IN-FLOW (opens downward, scrolls with the page) per
 * the no-overflow-parent rule — this lives on a scrollable page, never in a
 * clipping modal.
 */
export default function DepartmentMultiSelect({
  selected,
  onChange,
  departments,
  allLabel = 'All departments',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Escape / outside-click close.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const colorFor = (deptId?: string) => (deptId && colors[deptId]?.base) || 'var(--text-muted)'

  const flat = useMemo(() => flattenTree(departments), [departments])

  const q = query.trim().toLowerCase()
  const searchRows = useMemo(
    () => (q ? departments.filter((d) => d.name.toLowerCase().includes(q)) : []),
    [departments, q],
  )

  // The full sub-tree (self + descendants) of a department, for cascade toggles.
  const subtreeIds = (deptId: string): string[] => [
    deptId,
    ...descendantsOf(departments, deptId).map((f) => f.dept.id),
  ]

  // Tri-state of a department's sub-tree: 'all' | 'some' | 'none'.
  const subtreeState = (deptId: string): 'all' | 'some' | 'none' => {
    const ids = subtreeIds(deptId)
    let sel = 0
    for (const id of ids) if (selectedSet.has(id)) sel++
    if (sel === 0) return 'none'
    if (sel === ids.length) return 'all'
    return 'some'
  }

  // Toggle a department + its whole sub-tree. Selecting a leaf is just itself.
  const toggle = (deptId: string) => {
    const ids = subtreeIds(deptId)
    const next = new Set(selectedSet)
    if (subtreeState(deptId) === 'all') {
      for (const id of ids) next.delete(id)
    } else {
      for (const id of ids) next.add(id)
    }
    onChange(Array.from(next))
  }

  const selectAll = () => onChange([])

  // ── Trigger label ──────────────────────────────────────────────────────────
  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return allLabel
    if (selected.length === 1) {
      const d = departments.find((x) => x.id === selected[0])
      return d?.name ?? '1 department'
    }
    return `${selected.length} departments`
  }, [selected, departments, allLabel])

  // ── Checkbox ─────────────────────────────────────────────────────────────────
  const Checkbox = ({ state }: { state: 'all' | 'some' | 'none' }) => (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        state === 'none'
          ? 'border-border bg-surface'
          : 'border-primary bg-primary text-primary-foreground'
      }`}
    >
      {state === 'all' && <Check size={12} strokeWidth={3} />}
      {state === 'some' && <Minus size={12} strokeWidth={3} />}
    </span>
  )

  const triggerCls =
    'w-full flex items-center gap-2.5 border border-border rounded-lg px-3 py-2.5 text-body text-left bg-surface-sunken hover:bg-surface hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors'

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        <span className="flex-1 min-w-0 truncate text-text-primary">{triggerLabel}</span>
        {selected.length > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary px-1.5 min-w-[20px] h-5 text-meta font-medium text-primary-foreground">
            {selected.length}
          </span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex flex-col max-h-[320px] border border-border-light rounded-xl bg-surface shadow-menu overflow-hidden">
          {/* Search */}
          <div className="relative border-b border-border-light shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search departments…"
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
            {/* All departments (reset) */}
            {!q && (
              <button
                type="button"
                onClick={selectAll}
                className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  selected.length === 0 ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border" />
                <span
                  className={`flex-1 min-w-0 truncate text-body font-medium ${
                    selected.length === 0 ? 'text-primary-text' : 'text-text-primary'
                  }`}
                >
                  {allLabel}
                </span>
                {selected.length === 0 && <Check size={15} className="text-primary-text shrink-0" />}
              </button>
            )}

            {departments.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-8 text-center">
                <Building2 size={22} className="text-text-muted" />
                <p className="text-meta text-text-muted">No departments yet.</p>
              </div>
            ) : q ? (
              searchRows.length === 0 ? (
                <p className="px-3 py-6 text-center text-body text-text-muted">No departments found.</p>
              ) : (
                searchRows.map((d) => {
                  const path = ancestorsOf(departments, d.id)
                    .slice(0, -1)
                    .map((a) => a.name)
                    .join(' › ')
                  const state = subtreeState(d.id)
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggle(d.id)}
                      className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                    >
                      <Checkbox state={state} />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: colorFor(d.id) }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-body font-medium text-text-primary truncate">{d.name}</span>
                        {path && <span className="block text-meta text-text-muted truncate">{path}</span>}
                      </span>
                    </button>
                  )
                })
              )
            ) : (
              flat.map(({ dept, depth }) => {
                const state = subtreeState(dept.id)
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => toggle(dept.id)}
                    style={{ paddingLeft: 12 + depth * 16 }}
                    className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2.5 pr-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <Checkbox state={state} />
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: colorFor(dept.id) }}
                    />
                    <span
                      className={`flex-1 min-w-0 truncate text-body font-medium ${
                        state !== 'none' ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                    >
                      {dept.name}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer: quick clear when something is selected */}
          {selected.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-border-light px-3 py-2 shrink-0">
              <span className="text-meta text-text-muted">
                {selected.length} selected
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring text-meta font-medium text-primary-text hover:text-primary-text"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
