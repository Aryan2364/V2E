'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import { PermissionTooltip } from './PermissionTooltip'

export interface MultiSelectOption {
  value: string
  label: string
  /** Secondary line under the label (e.g. owner · due date). */
  hint?: string
  /** Optional colour dot to the left of the label (a CSS colour — legacy callers). */
  color?: string
  /**
   * Optional colour dot drawn by a class instead (e.g. a tag palette class from
   * lib/tasks/tagColors). Preferred over `color`: no inline colour (kit §1).
   */
  colorClassName?: string
}

/** Max height (px) of the open panel — capped further by the room actually available. */
const PANEL_MAX = 280

/**
 * The clip rectangle (in viewport coords) that will crop the open panel: the nearest
 * ancestor that scrolls or hides its overflow, intersected with the viewport. The panel
 * is in-flow (absolute), so it renders inside — and is clipped by — this box, not the
 * whole screen. Mirrors StyledSelect so both behave identically inside modals.
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

const norm = (s: string) => s.trim().toLowerCase()

interface Props {
  value: string[]
  onChange: (values: string[]) => void
  options: MultiSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Shown inside the panel when there is nothing to pick. */
  emptyText?: string
  disabled?: boolean
  /** Classes for the outer wrapper — use to control width (defaults to full width). */
  wrapperClassName?: string

  // ── Optional extensions (all off by default; existing callers are unaffected) ──

  /**
   * Render a selected value's chip in the field instead of the default blue chip
   * (e.g. a coloured TagChip). Call `onRemove` from the chip's ✕; it is a no-op while
   * the field is disabled.
   */
  renderChip?: (option: MultiSelectOption, onRemove: () => void) => ReactNode
  /**
   * Turns on a "Create …" row at the bottom of the list. It appears only when the
   * typed query (trimmed) has no exact, case-insensitive match among the options.
   * Enter on the highlighted create row creates. The caller adds the new value to
   * `value` itself; a rejected promise is the caller's to report — the row just
   * becomes usable again.
   */
  onCreate?: (query: string) => Promise<void> | void
  /** Label of the create row. Default: `Create "<query>"`. */
  createLabel?: (query: string) => string
  /**
   * Whether the user may create. true: allowed. false: the row is disabled and
   * `createDisabledReason` shows in a permission tooltip. undefined: not known yet
   * (permissions loading) — disabled, no reason. When the prop is OMITTED entirely,
   * creating is allowed.
   */
  canCreate?: boolean | undefined
  /** Who may create, e.g. "Only people allowed to create task tags can do this.". */
  createDisabledReason?: string
  /** Validate the query before offering to create it; return a reason to disable the row. */
  createInvalidReason?: (query: string) => string | null
  /** At most this many values. Unselected options (and the create row) are disabled at the limit. */
  maxSelected?: number
  /** Hint shown at the limit. Default: `Up to <max> selected`. */
  maxSelectedHint?: string
}

/**
 * Multi-select with removable chips — the styled counterpart to StyledSelect for
 * fields that take several values (per DESIGN_RULES: never a raw OS-native
 * `<select multiple>`).
 *
 * The open panel is IN-FLOW (absolute inside a relative wrapper) and flips
 * up/down against the nearest SCROLL CONTAINER, not the viewport — the same
 * rule StyledSelect follows, so it never opens into a clipped edge inside a
 * modal or a scrolling card.
 *
 * Keyboard (kit §16.4): Enter, Space or ArrowDown on the field opens it; in the
 * search box ArrowUp/ArrowDown move, Enter picks (or creates), Escape closes and
 * returns focus to the field.
 */
export default function MultiSelect(props: Props) {
  const {
    value,
    onChange,
    options,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyText = 'Nothing to choose from.',
    disabled = false,
    wrapperClassName = 'w-full',
    renderChip,
    onCreate,
    createLabel = (q: string) => `Create "${q}"`,
    createDisabledReason = 'You can’t add a new one here',
    createInvalidReason,
    maxSelected,
    maxSelectedHint,
  } = props
  // Omitted → allowed; passed as undefined → not known yet (see the prop's doc).
  const createAllowed: boolean | undefined = 'canCreate' in props ? props.canCreate : true

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropUp, setDropUp] = useState(false)
  const [panelMaxH, setPanelMaxH] = useState(PANEL_MAX)
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const selectedSet = useMemo(() => new Set(value), [value])
  const selectedOptions = useMemo(
    () => value.map((v) => options.find((o) => o.value === v)).filter(Boolean) as MultiSelectOption[],
    [value, options],
  )
  const atMax = maxSelected !== undefined && value.length >= maxSelected

  const q = query.trim()
  const filtered = useMemo(() => {
    const nq = norm(query)
    if (!nq) return options
    const hits = options.filter(
      (o) => o.label.toLowerCase().includes(nq) || (o.hint ?? '').toLowerCase().includes(nq),
    )
    // An exact match leads, so Enter picks it rather than a longer near-match.
    const exact = hits.findIndex((o) => norm(o.label) === nq)
    return exact > 0 ? [hits[exact], ...hits.slice(0, exact), ...hits.slice(exact + 1)] : hits
  }, [options, query])

  const showCreate = !!onCreate && q !== '' && !options.some((o) => norm(o.label) === norm(q))
  const invalidReason = showCreate && createInvalidReason ? createInvalidReason(q) : null
  const createReady = showCreate && createAllowed === true && !atMax && !invalidReason && !creating
  const navCount = filtered.length + (showCreate ? 1 : 0)
  const createIndex = showCreate ? filtered.length : -1

  // Keep the highlight in range as the list changes.
  useEffect(() => {
    setActive(0)
  }, [query, open])

  // Scroll the highlighted row into view inside the list box only — never the page.
  useEffect(() => {
    if (!open) return
    const box = listRef.current
    const row = box?.querySelector<HTMLElement>(`[data-nav-index="${active}"]`)
    if (!box || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }, [active, open])

  function closePanel(refocus = false) {
    setOpen(false)
    setQuery('')
    if (refocus) btnRef.current?.focus()
  }

  function toggleOpen() {
    if (disabled) return
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        const clip = nearestClipRect(btnRef.current)
        const spaceBelow = clip.bottom - rect.bottom
        const spaceAbove = rect.top - clip.top
        const up = spaceBelow < PANEL_MAX && spaceAbove > spaceBelow
        setDropUp(up)
        const room = Math.max(0, (up ? spaceAbove : spaceBelow) - 8)
        setPanelMaxH(Math.min(PANEL_MAX, Math.max(140, room)))
      }
    }
    setOpen((o) => !o)
  }

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
        const inside = wrapRef.current?.contains(document.activeElement)
        setOpen(false)
        setQuery('')
        if (inside) btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function isOptionDisabled(v: string) {
    return atMax && !selectedSet.has(v)
  }

  function toggleValue(v: string) {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v))
    else if (!isOptionDisabled(v)) onChange([...value, v])
  }

  function removeValue(v: string) {
    if (!disabled) onChange(value.filter((x) => x !== v))
  }

  async function doCreate() {
    if (!createReady || !onCreate) return
    setCreating(true)
    try {
      await onCreate(q)
      if (mounted.current) setQuery('')
    } catch {
      // The caller reports the failure (inline, next to the field); keep the query so
      // the user can adjust it.
    } finally {
      if (mounted.current) setCreating(false)
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (navCount > 0) setActive((i) => (i + 1) % navCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (navCount > 0) setActive((i) => (i - 1 + navCount) % navCount)
    } else if (e.key === 'Enter') {
      // Never let Enter in the search box submit the surrounding form.
      e.preventDefault()
      if (active === createIndex) void doCreate()
      else if (filtered[active]) toggleValue(filtered[active].value)
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowDown' && !open)) {
      e.preventDefault()
      toggleOpen()
    }
  }

  const createRowLabel = creating ? 'Creating…' : createLabel(q)
  const createHint = atMax ? (maxSelectedHint ?? `Up to ${maxSelected} selected`) : invalidReason

  return (
    <div ref={wrapRef} className={`relative ${wrapperClassName}`}>
      {/* The field is a focusable div rather than a <button>, so each chip's ✕ can be a
          real button (a button may not contain another). */}
      <div
        ref={btnRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={toggleOpen}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        className={`w-full flex items-center gap-2 min-h-[42px] rounded-[8px] border px-3 py-1.5 text-left focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors ${
          disabled
            ? 'border-[#CBD5E1] bg-[#F1F5F9] text-[#94A3B8] cursor-not-allowed'
            : 'border-[#CBD5E1] bg-[#F8FAFC] hover:bg-white hover:border-[#94A3B8] cursor-pointer'
        }`}
      >
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 py-0.5">
          {selectedOptions.length === 0 ? (
            <span className="text-[15px] text-[#94A3B8]">{placeholder}</span>
          ) : (
            selectedOptions.map((o) =>
              renderChip ? (
                <span key={o.value} className="inline-flex max-w-full min-w-0">
                  {renderChip(o, () => removeValue(o.value))}
                </span>
              ) : (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 max-w-full rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] pl-2 pr-1 py-0.5 text-[13px] font-medium text-[#1D4ED8]"
                >
                  <span className="truncate">{o.label}</span>
                  {/* A chip's × is a control inside the field, so it must not
                      re-open the panel — hence stopPropagation. */}
                  <button
                    type="button"
                    aria-label={`Remove ${o.label}`}
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeValue(o.value)
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="shrink-0 w-4 h-4 rounded-[4px] flex items-center justify-center text-[#2563EB] hover:bg-[#DBEAFE] hover:text-[#1D4ED8] cursor-pointer disabled:cursor-not-allowed"
                  >
                    <X size={11} />
                  </button>
                </span>
              ),
            )
          )}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div
          className={`absolute left-0 right-0 ${
            dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          } z-50 flex flex-col border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden`}
          style={{ maxHeight: panelMaxH }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F1F5F9] shrink-0">
            <Search size={14} className="text-[#94A3B8] shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="flex-1 min-w-0 text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none bg-transparent"
            />
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A] shrink-0"
              >
                Clear
              </button>
            )}
          </div>

          {atMax && (
            <p className="shrink-0 px-3 py-1.5 border-b border-[#F1F5F9] bg-[#F8FAFC] text-[12px] text-[#475569]">
              {maxSelectedHint ?? `Up to ${maxSelected} selected`}
            </p>
          )}

          <div ref={listRef} role="listbox" aria-multiselectable className="relative flex-1 overflow-y-auto overscroll-contain min-h-0 py-1">
            {filtered.length === 0 && !showCreate ? (
              <p className="px-3 py-6 text-center text-sm text-[#475569]">
                {options.length === 0 ? emptyText : 'No matches.'}
              </p>
            ) : (
              filtered.map((o, i) => {
                const checked = selectedSet.has(o.value)
                const off = isOptionDisabled(o.value)
                const isActive = i === active
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    aria-disabled={off || undefined}
                    data-nav-index={i}
                    onClick={() => toggleValue(o.value)}
                    onMouseMove={() => {
                      if (!isActive) setActive(i)
                    }}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                      off ? 'cursor-not-allowed' : ''
                    } ${
                      checked
                        ? isActive
                          ? 'bg-[#DBEAFE]'
                          : 'bg-[#EFF6FF]'
                        : isActive && !off
                          ? 'bg-[#F1F5F9]'
                          : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 w-4 h-4 rounded-[4px] border flex items-center justify-center ${
                        checked
                          ? 'bg-[#2563EB] border-[#2563EB] text-white'
                          : off
                            ? 'border-[#E2E8F0] bg-[#F8FAFC]'
                            : 'border-[#CBD5E1] bg-white'
                      }`}
                    >
                      {checked && <Check size={11} />}
                    </span>
                    {o.colorClassName ? (
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${o.colorClassName}`} />
                    ) : (
                      o.color && (
                        <span
                          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: o.color }}
                        />
                      )
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[14px] truncate ${off ? 'text-[#94A3B8]' : 'text-[#0F172A]'}`}>
                        {o.label}
                      </span>
                      {o.hint && (
                        <span className="block text-[12px] text-[#475569] truncate">{o.hint}</span>
                      )}
                    </span>
                  </button>
                )
              })
            )}

            {showCreate && (
              <div className={filtered.length > 0 ? 'mt-1 border-t border-[#F1F5F9] pt-1' : ''}>
                <PermissionTooltip allowed={createAllowed} reason={createDisabledReason} className="flex w-full">
                  <button
                    type="button"
                    data-nav-index={createIndex}
                    disabled={!createReady}
                    aria-disabled={!createReady || undefined}
                    onClick={() => void doCreate()}
                    onMouseMove={() => {
                      if (active !== createIndex) setActive(createIndex)
                    }}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                      active === createIndex && createReady ? 'bg-[#F1F5F9]' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 w-4 h-4 rounded-[4px] flex items-center justify-center ${
                        createReady ? 'text-[#2563EB]' : 'text-[#94A3B8]'
                      }`}
                    >
                      <Plus size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[14px] truncate ${
                          createReady || creating ? 'text-[#1D4ED8] font-medium' : 'text-[#94A3B8]'
                        }`}
                      >
                        {createRowLabel}
                      </span>
                      {createHint && (
                        <span className="block text-[12px] text-[#475569] truncate">{createHint}</span>
                      )}
                    </span>
                  </button>
                </PermissionTooltip>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
