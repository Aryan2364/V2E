'use client'

import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Table2, Network } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'table' | 'tree'

const segments: { value: ViewMode; label: string; icon: typeof Table2 }[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'tree', label: 'Tree', icon: Network },
]

/**
 * Segmented Table / Tree switcher, shared by the Employees, Org chart and
 * Roles pages. Not the list page's view switcher (`view-switcher.tsx`,
 * section 11.1 zone 2): that one is specifically list/card/board for a list
 * page's records, whereas this one toggles between a flat table and a
 * hierarchy visualisation. Built on the same base-ui `Toggle`/`ToggleGroup`
 * primitives and kit tokens as `view-switcher.tsx`, kept as its own small
 * component rather than forced into that one's semantics.
 */
export default function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <ToggleGroup
      aria-label="View"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as ViewMode | undefined
        if (picked) onChange(picked)
      }}
      className="inline-flex h-control items-center rounded-lg border border-border bg-surface-sunken p-0.5"
    >
      {segments.map(({ value: v, label, icon: Icon }) => (
        <Toggle
          key={v}
          value={v}
          aria-label={label}
          className={cn(
            'tap-area inline-flex items-center gap-1.5 rounded-md px-3 text-label font-medium transition-[background-color,color] duration-(--duration-fast)',
            'text-text-secondary not-data-pressed:hover:text-text-primary',
            'data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:cursor-default',
            'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring',
          )}
        >
          <Icon size={14} />
          {label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
