'use client'

import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { useAnchoredPanel } from '@/lib/hooks/useAnchoredPanel'
import type { RoleLevel } from '@/lib/types'

interface Props {
  value: RoleLevel
  onChange: (level: RoleLevel) => void
  showHead?: boolean
}

const LEVELS: { value: RoleLevel; label: string }[] = [
  { value: 'head', label: 'Head' },
  { value: 'senior', label: 'Senior' },
  { value: 'mid', label: 'Mid' },
  { value: 'junior', label: 'Junior' },
]

export default function LevelSelect({ value, onChange, showHead = true }: Props) {
  const [open, setOpen] = useState(false)
  const { triggerRef, panelRef, pos, style } = useAnchoredPanel(open, () => setOpen(false), {
    rowHeight: 37,
  })

  const options = useMemo(() => {
    if (showHead || value === 'head') return LEVELS
    return LEVELS.filter((l) => l.value !== 'head')
  }, [showHead, value])

  const selected = useMemo(() => options.find((l) => l.value === value) ?? options[0] ?? LEVELS[1], [options, value])

  const pick = (val: RoleLevel) => {
    onChange(val)
    setOpen(false)
  }

  const triggerCls = `w-full flex items-center gap-2.5 border rounded-[8px] px-3 py-2.5 text-[15px] text-left transition-colors bg-[#F8FAFC] border-[#CBD5E1] hover:bg-white hover:border-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]`

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        <span className="flex-1 min-w-0 truncate text-[#0F172A]">{selected.label}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-80 flex flex-col border border-[#E2E8F0] rounded-[10px] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden py-1"
          >
            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
              {options.map((l) => {
                const isSel = l.value === value
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => pick(l.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      isSel ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <span
                      className={`flex-1 min-w-0 truncate text-sm font-medium ${
                        isSel ? 'text-[#2563EB]' : 'text-[#0F172A]'
                      }`}
                    >
                      {l.label}
                    </span>
                    {isSel && <Check size={15} className="text-[#2563EB] shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
