'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Check, Briefcase } from 'lucide-react'
import { levelColors, rankOfLevel } from '@/lib/role-levels'
import type { Role } from '@/lib/types'

// Single-select job-role picker. Mirrors EmployeePicker's UX exactly — bordered
// trigger, centered fixed-portal dialog (never drifts on scroll), search box, rows
// grouped under department headers — so "pick a role" matches "pick a person".

interface Props {
  value: string // selected role id, '' = none
  onChange: (roleId: string) => void
  roles: Role[]
  /** Dialog heading. */
  title?: string
  /** Trigger placeholder when nothing is selected. */
  placeholder?: string
  disabled?: boolean
  /** Allow clearing the selection back to empty. */
  allowClear?: boolean
  id?: string
}

function LevelBadge({ level }: { level: Role['level'] }) {
  return (
    <span className={`inline-flex items-center rounded-[999px] px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0 ${levelColors[level]}`}>
      {level}
    </span>
  )
}

function sortRoles(rs: Role[]): Role[] {
  return [...rs].sort((a, b) => rankOfLevel(a.level) - rankOfLevel(b.level) || a.title.localeCompare(b.title))
}

export default function RolePicker({
  value, onChange, roles, title = 'Select role', placeholder = 'Select…', disabled, allowClear, id,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => roles.find((r) => r.id === value) ?? null, [roles, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchInputRef.current?.focus(), 50)
    else setSearch('')
  }, [open])

  function pick(roleId: string) { onChange(roleId); setOpen(false) }

  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () => roles.filter((r) => r.id && r.title && (!q || r.title.toLowerCase().includes(q))),
    [roles, q],
  )

  // Group by department when any role carries one; otherwise a single flat list.
  const groups = useMemo(() => {
    const hasDept = filtered.some((r) => r.department?.name)
    if (!hasDept) return [{ name: '', roles: sortRoles(filtered) }]
    const map = new Map<string, Role[]>()
    for (const r of filtered) {
      const key = r.department?.name ?? 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, rs]) => ({ name, roles: sortRoles(rs) }))
  }, [filtered])

  return (
    <div className="relative">
      {/* Trigger — mirrors the EmployeePicker chip box. */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 min-h-[42px] px-2 py-1.5 border border-border rounded-[8px] bg-white text-left hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selected ? (
          <>
            <Briefcase size={14} className="text-primary-text shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-text-primary">{selected.title}</span>
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
                  placeholder="Search roles..."
                  className="w-full pl-8 pr-3 py-[7px] text-sm text-text-primary placeholder:text-text-muted border border-border-light rounded-[8px] focus:border-primary focus:outline-hidden bg-white"
                />
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-surface-control flex items-center justify-center mb-3">
                    <Briefcase size={16} className="text-text-muted" />
                  </div>
                  <p className="text-sm font-medium text-text-primary">{search ? 'No roles found' : 'No roles available'}</p>
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
                            <span className="ml-1.5 font-normal normal-case text-text-muted">({group.roles.length})</span>
                          </span>
                        </div>
                      )}
                      {group.roles.map((r) => {
                        const isSel = r.id === value
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => pick(r.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${isSel ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'}`}
                          >
                            <div className="w-8 h-8 rounded-[8px] bg-primary-subtle flex items-center justify-center text-primary-text shrink-0">
                              <Briefcase size={14} />
                            </div>
                            <span className={`flex-1 min-w-0 truncate text-sm font-medium ${isSel ? 'text-primary-text' : 'text-text-primary'}`}>{r.title}</span>
                            <LevelBadge level={r.level} />
                            {isSel && (
                              <span className="w-4 h-4 flex items-center justify-center bg-primary rounded-full shrink-0">
                                <Check size={10} className="text-white" strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-border-light bg-surface-sunken shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-text-secondary min-w-0 truncate">
                {selected ? (
                  <>Selected <span className="font-semibold text-text-primary">{selected.title}</span></>
                ) : (
                  <span className="text-text-muted">Pick one role from the list</span>
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
