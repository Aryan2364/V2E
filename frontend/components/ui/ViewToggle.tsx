'use client'

import { Table2, Network } from 'lucide-react'

export type ViewMode = 'table' | 'tree'

interface Props {
  value: ViewMode
  onChange: (v: ViewMode) => void
}

const segments: { value: ViewMode; label: string; icon: typeof Table2 }[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'tree', label: 'Tree', icon: Network },
]

/** Segmented Table / Tree switcher, shared by the Employees and Department pages. */
export default function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center rounded-[8px] border border-border bg-surface-sunken p-0.5">
      {segments.map(({ value: v, label, icon: Icon }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-primary text-white shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            aria-pressed={active}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
