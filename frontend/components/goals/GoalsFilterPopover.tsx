'use client'

import { useState } from 'react'
import { SlidersHorizontal, Search } from 'lucide-react'
import { Count } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'

export interface FilterOption {
  value: string
  label: string
  /** How many rows carry this value. Options with a zero count are never passed in. */
  count: number
  /** Optional colour dot, matching the badge the value renders as elsewhere. */
  color?: string
  /** Nesting level for hierarchical options (e.g. sub-departments) — indents the row. */
  depth?: number
}

export interface FilterSection {
  key: string
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (values: string[]) => void
}

const SEARCH_THRESHOLD = 8

/**
 * The goals list's one "Filters" button (section 27.3), built on the kit's
 * popover.tsx instead of a hand-rolled panel (v2e kit-alignment follow-up
 * pass). Sections are built from the data by the caller, so an owner with no
 * goals never appears as a choice that would return nothing.
 */
export default function GoalsFilterPopover({
  sections,
  onClearAll,
  label = 'Filters',
  resultCount,
}: {
  sections: FilterSection[]
  onClearAll: () => void
  label?: string
  resultCount?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<Record<string, string>>({})
  const activeCount = sections.reduce((n, s) => n + s.selected.length, 0)
  const usable = sections.filter((s) => s.options.length > 0)

  function toggle(section: FilterSection, value: string) {
    section.onChange(
      section.selected.includes(value)
        ? section.selected.filter((v) => v !== value)
        : [...section.selected, value],
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch({})
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="secondary" className={activeCount > 0 ? 'border-primary bg-primary-subtle text-primary-text' : undefined}>
            <SlidersHorizontal className="size-4" />
            {label}
            {activeCount > 0 && <Count value={activeCount} />}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 max-h-[min(70vh,480px)]">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
        </PopoverHeader>
        <div className="flex-1 overflow-y-auto -mx-4 px-4">
          {usable.length === 0 ? (
            <p className="py-6 text-center text-body text-text-secondary">Nothing to filter by yet.</p>
          ) : (
            usable.map((section, i) => {
              const q = (search[section.key] ?? '').trim().toLowerCase()
              const visible = q ? section.options.filter((o) => o.label.toLowerCase().includes(q)) : section.options
              return (
                <div key={section.key} className={i > 0 ? 'border-t border-border-light pt-3 mt-3' : ''}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-label text-text-secondary">
                      {section.label} <span className="text-text-muted">{section.options.length}</span>
                    </p>
                    {section.selected.length > 0 && (
                      <button
                        type="button"
                        onClick={() => section.onChange([])}
                        className="text-label text-primary-text hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {section.options.length > SEARCH_THRESHOLD && (
                    <div className="relative mb-1.5">
                      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <Input
                        value={search[section.key] ?? ''}
                        onChange={(e) => setSearch((s) => ({ ...s, [section.key]: e.target.value }))}
                        placeholder={`Search ${section.label.toLowerCase()}…`}
                        className="pl-8 h-8"
                      />
                    </div>
                  )}
                  <div className="flex flex-col">
                    {visible.length === 0 ? (
                      <p className="py-2 text-label text-text-muted">No matches.</p>
                    ) : (
                      visible.map((o) => {
                        const checked = section.selected.includes(o.value)
                        return (
                          <label
                            key={o.value}
                            style={o.depth ? { paddingLeft: `${o.depth * 16}px` } : undefined}
                            className="flex items-center gap-2.5 py-1.5 cursor-pointer"
                          >
                            <Checkbox checked={checked} onCheckedChange={() => toggle(section, o.value)} />
                            {o.color && <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} />}
                            <span className="flex-1 min-w-0 truncate text-body text-text-primary">{o.label}</span>
                            <span className="shrink-0 text-label text-text-secondary tabular-nums">{o.count}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
        <PopoverFooter>
          <span className="text-label text-text-secondary">
            {resultCount !== undefined
              ? `${resultCount} ${resultCount === 1 ? 'goal' : 'goals'}`
              : null}
          </span>
          <Button variant="secondary" onClick={onClearAll} disabled={activeCount === 0}>
            Clear all
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  )
}
