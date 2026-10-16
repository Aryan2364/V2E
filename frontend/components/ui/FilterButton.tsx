'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Search, SlidersHorizontal, X } from 'lucide-react'

export interface FilterOption {
  value: string
  label: string
  /** How many rows carry this value. Options with a zero count are never passed in. */
  count: number
  /** Optional colour dot, matching the badge the value renders as elsewhere. */
  color?: string
  /** Nesting level for hierarchical options (e.g. sub-departments) — indents the row. */
  depth?: number
}

export interface FilterSection {
  key: string
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (values: string[]) => void
}

/**
 * One "Filters" button holding every facet, instead of a row of dropdowns.
 *
 * Two deliberate behaviours:
 *  · Sections are built FROM THE DATA by the caller — an owner with no goals
 *    never appears, so the panel can't offer a choice that returns nothing.
 *  · Each option shows its row count, so you can see the size of a slice
 *    before committing to it.
 *
 * The panel is IN-FLOW (absolute inside a relative wrapper), right-aligned
 * under the button — per the no-overflow-parent rule, never a fixed portal
 * that drifts when the page scrolls.
 */
export default function FilterButton({
  sections,
  onClearAll,
  label = 'Filters',
  /** Rows currently matching — shown in the footer so the effect is visible. */
  resultCount,
}: {
  sections: FilterSection[]
  onClearAll: () => void
  label?: string
  resultCount?: number
}) {
  const [open, setOpen] = useState(false)
  // Opens upward when there isn't room below (the button lives in a sticky
  // header, so on a short viewport a downward panel would be cut off).
  const [dropUp, setDropUp] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Per-section search text, so filtering one long section never touches another.
  const [search, setSearch] = useState<Record<string, string>>({})
  // Below this many options a search box is just clutter — only show it once
  // scanning the list by eye stops being the faster path.
  const SEARCH_THRESHOLD = 8

  const activeCount = sections.reduce((n, s) => n + s.selected.length, 0)
  const usable = sections.filter((s) => s.options.length > 0)

  useLayoutEffect(() => {
    if (!open) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const PANEL = 460
    const below = window.innerHeight - rect.bottom
    setDropUp(below < PANEL && rect.top > below)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setSearch({})
  }, [open])

  function toggle(section: FilterSection, value: string) {
    section.onChange(
      section.selected.includes(value)
        ? section.selected.filter((v) => v !== value)
        : [...section.selected, value],
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={[
          'inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors',
          activeCount > 0
            ? 'border-primary bg-primary-subtle text-primary-text'
            : 'border-border bg-surface-sunken text-text-secondary hover:bg-white hover:border-border-strong',
        ].join(' ')}
      >
        <SlidersHorizontal size={15} />
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-semibold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute left-0 sm:left-auto sm:right-0 ${
            dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } z-50 w-[min(92vw,340px)] flex flex-col rounded-[10px] border border-border-light bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden`}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-light shrink-0">
            <p className="text-[14px] font-semibold text-text-primary">{label}</p>
            <div className="flex items-center gap-1">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-[12px] font-medium text-text-secondary hover:text-text-primary px-1.5"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="w-6 h-6 rounded-[6px] flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-control transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="table-scroll flex-1 overflow-y-auto overscroll-contain max-h-[min(60vh,420px)]">
            {usable.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">
                Nothing to filter by yet.
              </p>
            ) : (
              usable.map((section, i) => {
                const q = (search[section.key] ?? '').trim().toLowerCase()
                const visible = q
                  ? section.options.filter((o) => o.label.toLowerCase().includes(q))
                  : section.options
                return (
                  <div key={section.key} className={i > 0 ? 'border-t border-border-light' : ''}>
                    {/* Sticky so you always know which section you're scrolling
                        through once the panel itself is scrolled. */}
                    <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                          {section.label}
                          <span className="ml-1.5 font-normal normal-case tracking-normal text-text-muted">
                            {section.options.length}
                          </span>
                        </p>
                        {section.selected.length > 0 && (
                          <button
                            type="button"
                            onClick={() => section.onChange([])}
                            className="text-[11px] font-medium text-primary-text hover:text-primary-text"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      {section.options.length > SEARCH_THRESHOLD && (
                        <div className="relative mt-1.5">
                          <Search
                            size={12}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                          />
                          <input
                            type="text"
                            value={search[section.key] ?? ''}
                            onChange={(e) =>
                              setSearch((s) => ({ ...s, [section.key]: e.target.value }))
                            }
                            placeholder={`Search ${section.label.toLowerCase()}…`}
                            className="w-full rounded-[6px] border border-border-light bg-surface-sunken pl-6 pr-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:bg-white"
                          />
                        </div>
                      )}
                    </div>
                    {/* Sections FLOW — they are deliberately not individually
                        scrollable. A nested scroll box swallows the wheel at its
                        own boundary, so the panel felt stuck once a section hit
                        its end. One scroll container, like TaskFilterPopover. */}
                    <div className="pb-2">
                      {visible.length === 0 ? (
                        <p className="px-4 py-3 text-[12px] text-text-muted">No matches.</p>
                      ) : (
                        visible.map((o) => {
                          const checked = section.selected.includes(o.value)
                          return (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => toggle(section, o.value)}
                              style={o.depth ? { paddingLeft: `${16 + o.depth * 16}px` } : undefined}
                              className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                                checked ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                              }`}
                            >
                              <span
                                className={`shrink-0 w-4 h-4 rounded-[4px] border flex items-center justify-center ${
                                  checked
                                    ? 'bg-primary border-primary text-white'
                                    : 'border-border bg-white'
                                }`}
                              >
                                {checked && <Check size={11} />}
                              </span>
                              {o.color && (
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: o.color }}
                                />
                              )}
                              <span className="flex-1 min-w-0 truncate text-[14px] text-text-primary">
                                {o.label}
                              </span>
                              <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">
                                {o.count}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {resultCount !== undefined && (
            <div className="px-4 py-2.5 border-t border-border-light bg-surface-sunken shrink-0">
              <p className="text-[12px] text-text-secondary">
                Showing <span className="font-semibold text-text-primary">{resultCount}</span>{' '}
                {resultCount === 1 ? 'goal' : 'goals'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
