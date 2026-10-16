'use client'

import { useMemo } from 'react'
import { Check, CornerDownRight, Lock } from 'lucide-react'
import { flattenTree } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import type { Department } from '@/lib/types'

interface Props {
  departments: Department[]
  /** The department the holiday is created on — its descendants are the cascade options. */
  originDeptId: string
  originDeptName: string
  /** Currently checked descendant ids (the cascade target list). */
  value: string[]
  onChange: (ids: string[]) => void
}

interface SubRow {
  dept: Department
  /** Depth relative to the origin (origin's direct children = 1). */
  depth: number
  /** Ids of this node's descendants within the subtree (for subtree tick/untick). */
  descendants: string[]
}

/**
 * Always-visible descendant tree with checkboxes for choosing a holiday's cascade
 * reach. Quick buttons (All / None / Some) tick or untick boxes; ticking a node
 * also ticks its whole subtree. The origin department is shown locked-checked.
 * The component stores the explicit checked id list — All/Some/None is derived.
 */
export default function CascadeTargetTree({ departments, originDeptId, originDeptName, value, onChange }: Props) {
  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const colorFor = (id: string) => colors[id]?.base || 'var(--text-muted)'

  // Subtree under the origin, in pre-order, with relative depth + descendant ids.
  const rows = useMemo<SubRow[]>(() => {
    const flat = flattenTree(departments)
    const start = flat.findIndex((f) => f.dept.id === originDeptId)
    if (start === -1) return []
    const originDepth = flat[start].depth
    const slice: { dept: Department; depth: number }[] = []
    for (let i = start + 1; i < flat.length; i++) {
      if (flat[i].depth <= originDepth) break
      slice.push({ dept: flat[i].dept, depth: flat[i].depth - originDepth })
    }
    return slice.map((row, i) => {
      const descendants: string[] = []
      for (let j = i + 1; j < slice.length; j++) {
        if (slice[j].depth <= row.depth) break
        descendants.push(slice[j].dept.id)
      }
      return { dept: row.dept, depth: row.depth, descendants }
    })
  }, [departments, originDeptId])

  const allIds = useMemo(() => rows.map((r) => r.dept.id), [rows])
  const checked = useMemo(() => new Set(value), [value])
  const checkedCount = allIds.filter((id) => checked.has(id)).length

  const mode: 'all' | 'none' | 'some' =
    checkedCount === 0 ? 'none' : checkedCount === allIds.length ? 'all' : 'some'

  function setAll() {
    onChange([...allIds])
  }
  function setNone() {
    onChange([])
  }
  function toggle(row: SubRow) {
    const next = new Set(checked)
    const subtree = [row.dept.id, ...row.descendants]
    if (checked.has(row.dept.id)) {
      // Untick this node and its whole subtree (narrows to "Some").
      subtree.forEach((id) => next.delete(id))
    } else {
      // Tick this node and its whole subtree.
      subtree.forEach((id) => next.add(id))
    }
    onChange(Array.from(next))
  }

  if (rows.length === 0) return null

  const affectedNames = [originDeptName, ...rows.filter((r) => checked.has(r.dept.id)).map((r) => r.dept.name)]
  const summary = formatList(affectedNames)

  const QUICK: { key: 'all' | 'none' | 'some'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'some', label: 'Some' },
    { key: 'none', label: 'None' },
  ]

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">Apply to sub-departments</label>

      {/* Quick selectors — All / Some / None */}
      <div className="inline-flex p-0.5 rounded-[8px] bg-surface-control border border-border-light mb-2">
        {QUICK.map((q) => {
          const active = mode === q.key
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => (q.key === 'all' ? setAll() : q.key === 'none' ? setNone() : undefined)}
              aria-pressed={active}
              className={[
                'px-3 py-1.5 rounded-[6px] text-sm font-medium transition-colors',
                active ? 'bg-white text-primary-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-text-muted hover:text-text-primary',
                q.key === 'some' ? 'cursor-default' : '',
              ].join(' ')}
            >
              {q.label}
            </button>
          )
        })}
      </div>

      {/* Descendant tree */}
      <div className="max-h-[220px] overflow-y-auto rounded-[8px] border border-border-light bg-white divide-y divide-surface-control">
        {/* Origin — locked-checked */}
        <div className="flex items-center gap-2.5 px-3 py-2 bg-surface-sunken">
          <span className="flex items-center justify-center w-4 h-4 rounded-[4px] bg-primary shrink-0">
            <Check size={12} className="text-white" strokeWidth={3} />
          </span>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorFor(originDeptId) }} />
          <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary">{originDeptName}</span>
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-text-muted">
            <Lock size={11} /> this department
          </span>
        </div>

        {rows.map((row) => {
          const isChecked = checked.has(row.dept.id)
          return (
            <button
              key={row.dept.id}
              type="button"
              onClick={() => toggle(row)}
              style={{ paddingLeft: 12 + row.depth * 18 }}
              className="w-full flex items-center gap-2.5 pr-3 py-2 text-left hover:bg-surface-sunken transition-colors"
            >
              {row.depth > 1 && <CornerDownRight size={13} className="shrink-0 text-[#CBD5E1] -ml-1" />}
              <span
                className={[
                  'flex items-center justify-center w-4 h-4 rounded-[4px] border shrink-0 transition-colors',
                  isChecked ? 'bg-primary border-primary' : 'bg-white border-border',
                ].join(' ')}
              >
                {isChecked && <Check size={12} className="text-white" strokeWidth={3} />}
              </span>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorFor(row.dept.id) }} />
              <span className={`flex-1 min-w-0 truncate text-sm ${isChecked ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                {row.dept.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* Plain-English summary */}
      <p className="mt-2 text-xs text-text-secondary leading-relaxed">
        <span className="font-medium text-text-secondary">Applies to</span> {summary}.
      </p>
    </div>
  )
}

/** "A", "A and B", "A, B and C" */
function formatList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
