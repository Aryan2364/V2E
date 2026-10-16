'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X, Check, Briefcase } from 'lucide-react'
import { levelColors, rankOfLevel } from '@/lib/role-levels'
import { useAnchoredPanel } from '@/lib/hooks/useAnchoredPanel'
import type { Role } from '@/lib/types'

interface Props {
  value: string // selected role id, '' = none
  onChange: (roleId: string) => void
  roles: Role[] // already scoped to the chosen department by the caller
  disabled?: boolean
  disabledHint?: string
  placeholder?: string
}

function LevelBadge({ level }: { level: Role['level'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[11px] font-semibold capitalize shrink-0 ${levelColors[level]}`}
    >
      {level}
    </span>
  )
}

export default function RoleSelect({
  value,
  onChange,
  roles,
  disabled,
  disabledHint = 'Pick a department first',
  placeholder = 'Select role',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { triggerRef, panelRef, pos, style } = useAnchoredPanel(open, () => setOpen(false), {
    rowHeight: 37,
    headerHeight: 42,
  })

  const selected = useMemo(() => roles.find((r) => r.id === value) ?? null, [roles, value])

  // Close if the field becomes disabled (e.g. department cleared).
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const sorted = useMemo(
    () =>
      [...roles].sort(
        (a, b) => rankOfLevel(a.level) - rankOfLevel(b.level) || a.title.localeCompare(b.title),
      ),
    [roles],
  )
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? sorted.filter((r) => r.title.toLowerCase().includes(q)) : sorted),
    [sorted, q],
  )

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const triggerCls = `w-full flex items-center gap-2.5 border rounded-[8px] px-3 py-2.5 text-[15px] text-left transition-colors ${
    disabled
      ? 'bg-[#F1F5F9] border-[#E2E8F0] cursor-not-allowed'
      : 'bg-[#F8FAFC] border-[#CBD5E1] hover:bg-white hover:border-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
  }`

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        {disabled ? (
          <span className="flex-1 text-[#94A3B8]">{disabledHint}</span>
        ) : selected ? (
          <>
            <span className="flex-1 min-w-0 truncate text-[#0F172A]">{selected.title}</span>
            <LevelBadge level={selected.level} />
          </>
        ) : (
          <span className="flex-1 text-[#94A3B8]">{placeholder}</span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        !disabled &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-80 flex flex-col border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden"
          >
            <div className="relative border-b border-[#E2E8F0] shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search roles…"
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
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-8 text-center">
                  <Briefcase size={22} className="text-[#CBD5E1]" />
                  <p className="text-xs text-[#94A3B8]">
                    {roles.length === 0 ? 'No roles in this department yet.' : 'No roles found.'}
                  </p>
                </div>
              ) : (
                filtered.map((r) => {
                  const isSel = r.id === value
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pick(r.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isSel ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <span
                        className={`flex-1 min-w-0 truncate text-sm font-medium ${
                          isSel ? 'text-[#2563EB]' : 'text-[#0F172A]'
                        }`}
                      >
                        {r.title}
                      </span>
                      <LevelBadge level={r.level} />
                      {isSel && <Check size={15} className="text-[#2563EB] shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
