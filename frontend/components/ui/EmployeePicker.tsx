'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Check, UserPlus, ChevronDown } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EmployeePickerOption {
  user_id: string
  name: string
  /** Optional job-role title shown under the name (e.g. "Sales Manager"). */
  role_title?: string | null
  /** Optional job-role id — used to derive/filter a person's role and lane. */
  role_id?: string | null
  /** Optional department id — used to derive/filter a person's lane. */
  department_id?: string | null
  /** Optional department — when present, rows are grouped under department headers. */
  department_name?: string | null
}

interface Props {
  value: string
  onChange: (userId: string) => void
  employees: EmployeePickerOption[]
  /** Dialog heading (e.g. "Select Owner"). */
  title?: string
  /** Trigger placeholder when nothing is selected. */
  placeholder?: string
  disabled?: boolean
  /** Offers a "Select me" shortcut at the top of the list. */
  currentUser?: { user_id: string; name: string }
  /** Allow clearing the selection back to empty. */
  allowClear?: boolean
  /** Forwarded id for the associated <label htmlFor>. */
  id?: string
  /** 'sm' renders a slim, chip-scale trigger to sit inline with compact filter rows
   *  (matches StyledSelect's compact filters); 'md' is the default form-field size. */
  size?: 'sm' | 'md'
}

// ─── Avatar helpers (shared visual language with AssigneeSelector) ───────────────

const avatarColors = [
  'bg-primary', 'bg-text-secondary', 'bg-success',
  'bg-warning', 'bg-danger', 'bg-text-secondary',
]
function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}
function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// ─── User row ─────────────────────────────────────────────────────────────────

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: EmployeePickerOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
        selected ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${avatarColor(user.name)}`}
      >
        {getInitials(user.name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
        {user.role_title && <p className="text-xs text-text-muted truncate">{user.role_title}</p>}
      </div>
      {selected && (
        <span className="w-4 h-4 flex items-center justify-center bg-primary rounded-full shrink-0">
          <Check size={10} className="text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EmployeePicker({
  value,
  onChange,
  employees,
  title = 'Select Employee',
  placeholder = 'Select…',
  disabled,
  currentUser,
  allowClear,
  id,
  size = 'md',
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => employees.find((e) => e.user_id === value) ?? null, [employees, value])

  // Close on Escape; outside-click handled by the backdrop.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Focus search on open; reset query on close.
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearch('')
    }
  }, [open])

  function pick(userId: string) {
    onChange(userId)
    setOpen(false)
  }

  // ── Filter + group ──────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () => employees.filter((e) => e.user_id && e.name && (!q || e.name.toLowerCase().includes(q))),
    [employees, q],
  )

  // Group by department when any option carries one; otherwise a single flat list.
  const groups = useMemo(() => {
    const hasDepartments = filtered.some((e) => e.department_name)
    if (!hasDepartments) return [{ name: '', users: filtered }]
    const map = new Map<string, EmployeePickerOption[]>()
    for (const e of filtered) {
      const key = e.department_name ?? 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, users]) => ({ name, users }))
  }, [filtered])

  return (
    <div className="relative">
      {size === 'sm' ? (
        /* Compact trigger — matches StyledSelect's slim filter cells (no avatar). */
        <button
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3 py-1 text-[12px] text-left hover:bg-white hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className={`flex-1 min-w-0 truncate ${selected ? 'font-medium text-text-primary' : 'text-text-muted'}`}>
            {selected ? selected.name : placeholder}
          </span>
          {selected && allowClear && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={(e) => { e.stopPropagation(); onChange('') }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange('') } }}
              className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-text-muted hover:text-danger hover:bg-surface-control transition-colors"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className="shrink-0 text-text-muted" />
        </button>
      ) : (
      /* Trigger — mirrors the AssigneeSelector chip box (single-select). */
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 min-h-[42px] px-2 py-1.5 border border-border rounded-[8px] bg-white text-left hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selected ? (
          <>
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 ${avatarColor(selected.name)}`}
            >
              {getInitials(selected.name)}
            </span>
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-text-primary">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-[15px] text-text-muted">{placeholder}</span>
        )}
        {selected && allowClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear selection"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange('') } }}
            className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-text-muted hover:text-danger hover:bg-surface-control transition-colors"
          >
            <X size={12} />
          </span>
        )}
      </button>
      )}

      {/* Picker — centered dialog over the page (own backdrop). Being fixed &
          centered it never drifts on scroll nor escapes a parent modal. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-120 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="w-[440px] max-w-full max-h-[80vh] rounded-[12px] bg-white border border-border-light shadow-[0_12px_40px_rgba(0,0,0,0.20)] flex flex-col overflow-hidden">
            {/* Title row */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-border-light shrink-0">
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded-[6px] text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-8 pr-3 py-[7px] text-sm text-text-primary placeholder:text-text-muted border border-border-light rounded-[8px] focus:border-primary focus:outline-hidden bg-white"
                />
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {/* Select me shortcut */}
              {currentUser && value !== currentUser.user_id && (
                <button
                  type="button"
                  onClick={() => pick(currentUser.user_id)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-primary-text hover:bg-primary-subtle border-b border-border-light transition-colors"
                >
                  <UserPlus size={13} />
                  Select me
                </button>
              )}

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-surface-control flex items-center justify-center mb-3">
                    <Search size={16} className="text-text-muted" />
                  </div>
                  <p className="text-sm font-medium text-text-primary">
                    {search ? 'No employees found' : 'No employees available'}
                  </p>
                  {search && <p className="text-xs text-text-secondary mt-1">Try a different search term.</p>}
                </div>
              ) : (
                <div>
                  {groups.map((group) => (
                    <div key={group.name || 'all'}>
                      {group.name && (
                        <div className="px-3 py-1.5 bg-surface-sunken border-b border-border-light">
                          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                            {group.name}
                            <span className="ml-1.5 font-normal normal-case text-text-muted">({group.users.length})</span>
                          </span>
                        </div>
                      )}
                      {group.users.map((user) => (
                        <UserRow
                          key={user.user_id}
                          user={user}
                          selected={value === user.user_id}
                          onSelect={() => pick(user.user_id)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-border-light bg-surface-sunken shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-text-secondary min-w-0 truncate">
                {selected ? (
                  <>
                    Selected <span className="font-semibold text-text-primary">{selected.name}</span>
                  </>
                ) : (
                  <span className="text-text-muted">Pick one person from the list</span>
                )}
              </p>
              {allowClear && selected && (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false) }}
                  className="text-xs font-medium text-text-muted hover:text-danger transition-colors shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
