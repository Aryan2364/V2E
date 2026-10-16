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
        className="w-full flex items-center gap-2 min-h-[42px] px-2 py-1.5 border border-[#CBD5E1] rounded-[8px] bg-white text-left hover:border-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selected ? (
          <>
            <Briefcase size={14} className="text-[#2563EB] shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-[#0F172A]">{selected.title}</span>
          </>
        ) : (
          <span className="flex-1 text-[15px] text-[#94A3B8]">{placeholder}</span>
        )}
        {selected && allowClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear selection"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange('') } }}
            className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#F1F5F9] transition-colors"
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
          <div className="w-[440px] max-w-full max-h-[80vh] rounded-[12px] bg-white border border-[#E2E8F0] shadow-[0_12px_40px_rgba(0,0,0,0.20)] flex flex-col overflow-hidden">
            {/* Title row */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[#F1F5F9] shrink-0">
              <h3 className="text-sm font-semibold text-[#0F172A]">{title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search roles..."
                  className="w-full pl-8 pr-3 py-[7px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] border border-[#E2E8F0] rounded-[8px] focus:border-[#2563EB] focus:outline-hidden bg-white"
                />
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-3">
                    <Briefcase size={16} className="text-[#94A3B8]" />
                  </div>
                  <p className="text-sm font-medium text-[#0F172A]">{search ? 'No roles found' : 'No roles available'}</p>
                  {search && <p className="text-xs text-[#475569] mt-1">Try a different search term.</p>}
                </div>
              ) : (
                <div>
                  {groups.map((group) => (
                    <div key={group.name || 'all'}>
                      {group.name && (
                        <div className="px-3 py-1.5 bg-[#F8FAFC] border-b border-[#F1F5F9]">
                          <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">
                            {group.name}
                            <span className="ml-1.5 font-normal normal-case text-[#94A3B8]">({group.roles.length})</span>
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
                            className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${isSel ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'}`}
                          >
                            <div className="w-8 h-8 rounded-[8px] bg-[#EFF6FF] flex items-center justify-center text-[#2563EB] shrink-0">
                              <Briefcase size={14} />
                            </div>
                            <span className={`flex-1 min-w-0 truncate text-sm font-medium ${isSel ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{r.title}</span>
                            <LevelBadge level={r.level} />
                            {isSel && (
                              <span className="w-4 h-4 flex items-center justify-center bg-[#2563EB] rounded-full shrink-0">
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
            <div className="px-4 py-2.5 border-t border-[#F1F5F9] bg-[#F8FAFC] shrink-0 flex items-center justify-between gap-3">
              <p className="text-xs text-[#475569] min-w-0 truncate">
                {selected ? (
                  <>Selected <span className="font-semibold text-[#0F172A]">{selected.title}</span></>
                ) : (
                  <span className="text-[#64748B]">Pick one role from the list</span>
                )}
              </p>
              {allowClear && selected && (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false) }}
                  className="text-xs font-medium text-[#64748B] hover:text-[#DC2626] transition-colors shrink-0"
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
