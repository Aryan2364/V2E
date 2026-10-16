'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X, Check, Building2, Lock } from 'lucide-react'
import { flattenTree, ancestorsOf } from '@/lib/dept-tree'
import { computeNodeColors } from '@/lib/org-chart-colors'
import { useAnchoredPanel } from '@/lib/hooks/useAnchoredPanel'
import Tooltip from '@/components/ui/Tooltip'
import type { Department } from '@/lib/types'

interface Props {
  value: string // selected department id, '' = none
  onChange: (deptId: string) => void
  departments: Department[]
  placeholder?: string
  /** When set, an "all" option (value '') is offered and shown as the empty state — for use as a filter. */
  allLabel?: string
  /**
   * Render the panel IN-FLOW (absolute within a relative wrapper) instead of a
   * fixed portal. Use on scrollable pages: an in-flow panel scrolls with the
   * trigger and never drifts. Keep the default (portal) inside modals, where the
   * panel must escape the modal's clipping. See memory: no-overflow-parent.
   */
  inline?: boolean
  /**
   * Return a reason string to render a department as LOCKED (visible but not
   * selectable) — e.g. "Already added" or "Covered by Sales". Return null/undefined
   * to leave it selectable. The current `value` is never locked.
   */
  lockedReason?: (deptId: string) => string | null | undefined
}

export default function DepartmentSelect({
  value,
  onChange,
  departments,
  placeholder = 'Select department',
  allLabel,
  inline = false,
  lockedReason,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Portal positioning is only used in (default) portal mode; dormant when inline.
  const { triggerRef, panelRef, pos, style } = useAnchoredPanel(open && !inline, () => setOpen(false), {
    rowHeight: 37,
    headerHeight: 42,
  })
  const wrapRef = useRef<HTMLDivElement>(null)

  // Inline mode keeps its own Escape / outside-click close (the anchored hook is
  // dormant when inline, so it won't supply these).
  useEffect(() => {
    if (!open || !inline) return
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
  }, [open, inline])

  const colors = useMemo(() => computeNodeColors(departments), [departments])
  const colorFor = (deptId?: string) => (deptId && colors[deptId]?.base) || '#94A3B8'

  const flat = useMemo(() => flattenTree(departments), [departments])
  const selected = useMemo(() => departments.find((d) => d.id === value) ?? null, [departments, value])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? departments.filter((d) => d.name.toLowerCase().includes(q)) : []),
    [departments, q],
  )

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const triggerCls =
    'w-full flex items-center gap-2.5 border border-[#CBD5E1] rounded-[8px] px-3 py-2.5 text-[15px] text-left bg-[#F8FAFC] hover:bg-white hover:border-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors'

  const lockOf = (id: string) => (id === value ? null : lockedReason?.(id) ?? null)
  const allLocked =
    !!lockedReason && !allLabel && departments.length > 0 && departments.every((d) => lockOf(d.id))

  // A department shown but not selectable, with the reason why (and an optional path).
  const lockedRow = (dept: Department, paddingLeft: number, reason: string, sub?: string) => (
    <Tooltip key={dept.id} label={reason}>
    <div
      aria-disabled="true"
      style={{ paddingLeft }}
      className="w-full flex items-center gap-2.5 pr-3 py-2 cursor-not-allowed select-none"
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: colorFor(dept.id) }} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[#94A3B8] truncate">{dept.name}</span>
        <span className="block text-[11px] text-[#94A3B8] truncate">{sub ? `${reason} · ${sub}` : reason}</span>
      </span>
      <Lock size={13} className="text-[#CBD5E1] shrink-0" />
    </div>
    </Tooltip>
  )

  // Shared panel content (search header + department list) — identical in both
  // portal and inline render paths.
  const panelBody = (
    <>
      <div className="relative border-b border-[#E2E8F0] shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search departments…"
          className="w-full pl-9 pr-8 py-2.5 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden"
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
        {allLocked && !q && (
          <p className="px-3 pt-2 pb-1 text-[11px] text-[#94A3B8]">Every department is already covered by another rule.</p>
        )}
        {allLabel && !q && (
          <button
            type="button"
            onClick={() => pick('')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              !value ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-[#CBD5E1]" />
            <span
              className={`flex-1 min-w-0 truncate text-sm font-medium ${
                !value ? 'text-[#2563EB]' : 'text-[#0F172A]'
              }`}
            >
              {allLabel}
            </span>
            {!value && <Check size={15} className="text-[#2563EB] shrink-0" />}
          </button>
        )}

        {departments.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <Building2 size={22} className="text-[#CBD5E1]" />
            <p className="text-xs text-[#94A3B8]">No departments yet.</p>
          </div>
        ) : q ? (
          filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[#94A3B8]">No departments found.</p>
          ) : (
            filtered.map((d) => {
              const path = ancestorsOf(departments, d.id)
                .slice(0, -1)
                .map((a) => a.name)
                .join(' › ')
              const isSel = d.id === value
              const lock = lockOf(d.id)
              if (lock) return lockedRow(d, 12, lock, path)
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => pick(d.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    isSel ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: colorFor(d.id) }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-[#0F172A] truncate">
                      {d.name}
                    </span>
                    {path && (
                      <span className="block text-xs text-[#94A3B8] truncate">{path}</span>
                    )}
                  </span>
                  {isSel && <Check size={15} className="text-[#2563EB] shrink-0" />}
                </button>
              )
            })
          )
        ) : (
          flat.map(({ dept, depth }) => {
            const isSel = dept.id === value
            const lock = lockOf(dept.id)
            if (lock) return lockedRow(dept, 12 + depth * 16, lock)
            return (
              <button
                key={dept.id}
                type="button"
                onClick={() => pick(dept.id)}
                style={{ paddingLeft: 12 + depth * 16 }}
                className={`w-full flex items-center gap-2.5 pr-3 py-2 text-left transition-colors ${
                  isSel ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: colorFor(dept.id) }}
                />
                <span
                  className={`flex-1 min-w-0 truncate text-sm font-medium ${
                    isSel ? 'text-[#2563EB]' : 'text-[#0F172A]'
                  }`}
                >
                  {dept.name}
                </span>
                {isSel && <Check size={15} className="text-[#2563EB] shrink-0" />}
              </button>
            )
          })
        )}
      </div>
    </>
  )

  return (
    <div ref={wrapRef} className={inline ? 'relative' : undefined}>
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        {selected ? (
          <>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: colorFor(selected.id) }}
            />
            <span className="flex-1 min-w-0 truncate text-[#0F172A]">{selected.name}</span>
          </>
        ) : allLabel ? (
          <span className="flex-1 min-w-0 truncate text-[#0F172A]">{allLabel}</span>
        ) : (
          <span className="flex-1 text-[#94A3B8]">{placeholder}</span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Inline mode: in-flow panel that scrolls with the page (no drift). */}
      {open && inline && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex flex-col max-h-[300px] border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden">
          {panelBody}
        </div>
      )}

      {/* Portal mode (default): fixed overlay anchored to the trigger. */}
      {open &&
        !inline &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-80 flex flex-col border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden"
          >
            {panelBody}
          </div>,
          document.body,
        )}
    </div>
  )
}
