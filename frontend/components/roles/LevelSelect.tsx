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

  const triggerCls = `w-full flex items-center gap-2.5 border rounded-lg px-3 py-2.5 text-body text-left transition-colors bg-surface-sunken border-border hover:bg-surface hover:border-border-strong focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary`

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        <span className="flex-1 min-w-0 truncate text-text-primary">{selected.label}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-80 flex flex-col border border-border-light rounded-xl bg-surface shadow-menu overflow-hidden py-1"
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
                      isSel ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                    }`}
                  >
                    <span
                      className={`flex-1 min-w-0 truncate text-body font-medium ${
                        isSel ? 'text-primary-text' : 'text-text-primary'
                      }`}
                    >
                      {l.label}
                    </span>
                    {isSel && <Check size={15} className="text-primary-text shrink-0" />}
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
