'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'

export interface StyledSelectOption {
  value: string
  label: string
  /** Optional color dot shown to the left of the label (e.g. priority/status color). */
  color?: string
  /** Render a thin divider ABOVE this option — separates "close the task" actions from statuses. */
  divider?: boolean
  /** Danger styling (red) — for destructive/close actions like "Incomplete". */
  variant?: 'danger'
  /** An action option triggers onChange but is never shown as the selected value. */
  action?: boolean
}

/** Max height (px) of the open panel — capped further by the room actually available. */
const PANEL_MAX = 300
/** At this many options a list stops being scannable, so the search box turns itself on. */
const SEARCH_AUTO_AT = 8

/**
 * The clip rectangle (in viewport coords) that will crop the open panel: the nearest
 * ancestor that scrolls or hides its overflow, intersected with the viewport. The panel
 * is in-flow (absolute), so it renders inside — and is clipped by — this box, not the
 * whole screen. We open toward whichever side has real room INSIDE it so a card sitting
 * at the top of a scroll column drops DOWN instead of opening up into the clipped edge.
 */
function nearestClipRect(el: HTMLElement | null): { top: number; bottom: number } {
  let node = el?.parentElement ?? null
  while (node) {
    const oy = window.getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') {
      const r = node.getBoundingClientRect()
      return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) }
    }
    node = node.parentElement
  }
  return { top: 0, bottom: window.innerHeight }
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: StyledSelectOption[]
  placeholder?: string
  /** Classes for the outer wrapper — use to control width (defaults to full width). */
  wrapperClassName?: string
  /** Extra classes merged onto the trigger button — for size/theme overrides (e.g. compact filters, dark bars). */
  triggerClassName?: string
  /** 'sm' shrinks the trigger to a compact, chip-scale control (inline rows); 'md' is the default form size. */
  size?: 'sm' | 'md'
  disabled?: boolean
  /**
   * Show the type-to-filter box. Left undefined it decides itself: on for lists of
   * SEARCH_AUTO_AT (8) or more options, off for short ones. Pass true/false to force it.
   */
  searchable?: boolean
  /** Placeholder inside the search box (e.g. "Search people…"). */
  searchPlaceholder?: string
}

/**
 * Shared dropdown whose OPEN LIST is a styled panel (not the raw OS-native menu):
 * curved #E2E8F0 box, white background + shadow, hover states, and a blue active
 * checkmark — per DESIGN_RULES.md. The panel renders IN-FLOW (absolute within a
 * relative wrapper) so it scrolls with the trigger and never drifts; safe inside
 * modals and on scrollable pages alike. See memory: no-overflow-parent.
 *
 * Long lists (8+ options, or `searchable`) get a type-to-filter box pinned at the top
 * of the panel plus ↑/↓/Enter keyboard picking, so a 40-person owner list is one word
 * of typing instead of a scroll hunt.
 *
 * Use this anywhere a styled select is needed. For the large, searchable, tree
 * department picker use DepartmentSelect instead.
 */
export default function StyledSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  wrapperClassName = 'w-full',
  triggerClassName = '',
  size = 'md',
  disabled = false,
  searchable,
  searchPlaceholder = 'Type to search…',
}: Props) {
  const [open, setOpen] = useState(false)
  // Open upward when the trigger sits low (e.g. bottom of a modal), so the list
  // never opens where it can't be reached.
  const [dropUp, setDropUp] = useState(false)
  // The open panel is in-flow (absolute), so a scrolling/overflow ancestor CLIPS it.
  // Cap its height to the real room available on the chosen side so it is never
  // sliced off behind the card edge — it always renders fully OVER the card.
  const [panelMaxH, setPanelMaxH] = useState(PANEL_MAX)
  const [query, setQuery] = useState('')
  // Which filtered row the keyboard is on (-1 = none highlighted yet).
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const showSearch = searchable ?? options.length >= SEARCH_AUTO_AT

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!showSearch || !q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query, showSearch])

  const toggle = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        // Measure room against the nearest CLIPPING ancestor (a scroll container
        // like a card's independent-scroll column), not just the viewport. A card
        // at the TOP of such a column has little room above — so we must drop DOWN
        // even if the viewport has space above, otherwise the upward panel is clipped
        // by the container's top edge and its options hide behind the card.
        const clip = nearestClipRect(btnRef.current)
        const spaceBelow = clip.bottom - rect.bottom
        const spaceAbove = rect.top - clip.top
        const up = spaceBelow < PANEL_MAX && spaceAbove > spaceBelow
        setDropUp(up)
        // Fit within the chosen side's un-clipped room (never exceed PANEL_MAX).
        const room = Math.max(0, (up ? spaceAbove : spaceBelow) - 8)
        setPanelMaxH(Math.min(PANEL_MAX, Math.max(140, room)))
      }
      setQuery('')
      setActive(-1)
    }
    setOpen((o) => !o)
  }

  // The search box is the whole point of opening a long list — put the caret in it.
  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus()
  }, [open, showSearch])

  // Keep the keyboard-highlighted row visible inside the scrolling list.
  useEffect(() => {
    if (!open || active < 0) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const selected = options.find((o) => o.value === value) ?? null

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
    setActive(-1)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (shown.length === 0) return
        e.preventDefault()
        setActive((i) => {
          const next = e.key === 'ArrowDown' ? i + 1 : i - 1
          if (next < 0) return shown.length - 1
          if (next >= shown.length) return 0
          return next
        })
        return
      }
      if (e.key === 'Enter') {
        // Enter takes the highlighted row — or the only remaining match, so a
        // narrowing search is "type three letters, Enter" with no arrow keys.
        const target = active >= 0 ? shown[active] : shown.length === 1 ? shown[0] : null
        if (target) {
          e.preventDefault()
          pick(target.value)
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, shown, active])

  const sizeCls =
    size === 'sm'
      ? 'gap-2 rounded-full px-2.5 py-1 text-[13px]'
      : 'gap-2.5 rounded-[8px] px-3 py-2.5 text-[15px]'
  const triggerCls =
    `w-full flex items-center border border-[#CBD5E1] text-left bg-[#F8FAFC] hover:bg-white hover:border-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:cursor-not-allowed ${sizeCls}`

  return (
    <div ref={wrapRef} className={`relative ${wrapperClassName}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`${triggerCls} ${triggerClassName}`}
      >
        {selected ? (
          <>
            {selected.color && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selected.color }}
              />
            )}
            <span className="flex-1 min-w-0 truncate text-[#0F172A]">{selected.label}</span>
          </>
        ) : (
          <span className="flex-1 text-[#94A3B8]">{placeholder}</span>
        )}
        <ChevronDown
          size={size === 'sm' ? 14 : 16}
          className={`shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          style={{ maxHeight: panelMaxH }}
          className={`absolute left-0 right-0 ${dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'} z-50 flex flex-col border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden`}
        >
          {showSearch && (
            <div className="shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-[#E2E8F0] bg-white">
              <Search size={15} className="shrink-0 text-[#94A3B8]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(-1)
                }}
                placeholder={searchPlaceholder}
                className="flex-1 min-w-0 bg-transparent text-[16px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none"
              />
            </div>
          )}
          <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0 py-1">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[#94A3B8]">
                {options.length === 0 ? 'No options.' : 'No match.'}
              </p>
            ) : (
              shown.map((o, i) => {
                const isSel = !o.action && o.value === value
                const danger = o.variant === 'danger'
                const isActive = i === active
                return (
                  <div key={o.value}>
                    {/* A divider only means anything in the unfiltered list. */}
                    {o.divider && !query.trim() && <div className="my-1 border-t border-[#E2E8F0]" />}
                    <button
                      type="button"
                      data-idx={i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o.value)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        danger
                          ? 'bg-transparent hover:bg-[#FEF2F2]'
                          : isSel
                            ? 'bg-[#EFF6FF]'
                            : isActive
                              ? 'bg-[#F1F5F9]'
                              : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      {o.color && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: o.color }}
                        />
                      )}
                      <span
                        className={`flex-1 min-w-0 truncate text-sm font-medium ${
                          danger ? 'text-[#DC2626]' : isSel ? 'text-[#2563EB]' : 'text-[#0F172A]'
                        }`}
                      >
                        {o.label}
                      </span>
                      {isSel && <Check size={15} className="text-[#2563EB] shrink-0" />}
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
