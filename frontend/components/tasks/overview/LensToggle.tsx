'use client'

import React from 'react'
import { Building2, Users } from 'lucide-react'

export type Lens = 'dept' | 'people'

/** Departments ⇄ People lens switch — how the dashboard slices the same task universe. */
export default function LensToggle({ value, onChange }: { value: Lens; onChange: (l: Lens) => void }) {
  const opts: { key: Lens; label: string; icon: React.ReactNode }[] = [
    { key: 'dept', label: 'Departments', icon: <Building2 size={15} /> },
    { key: 'people', label: 'People', icon: <Users size={15} /> },
  ]
  return (
    <div className="inline-flex items-center border border-border-light rounded-[8px] bg-white p-0.5 gap-0.5">
      {opts.map(({ key, label, icon }) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] text-sm font-semibold transition-colors ${
              active ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-control'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
