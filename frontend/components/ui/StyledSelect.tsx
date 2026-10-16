'use client'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select'
import { SearchableSelect, type SearchableSelectEntry } from '@/components/ui/searchable-select'

export interface StyledSelectOption {
  value: string
  label: string
  /** Optional color dot shown to the left of the label (e.g. priority/status color). */
  color?: string
  /** Render a thin divider ABOVE this option — separates "close the task" actions from statuses. */
  divider?: boolean
  /** Danger styling (red) — for destructive/close actions like "Incomplete". */
  variant?: 'danger'
  /** An action option triggers onChange but is never shown as the selected value. */
  action?: boolean
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: StyledSelectOption[]
  placeholder?: string
  /** Classes for the outer wrapper — use to control width (defaults to full width). */
  wrapperClassName?: string
  /** Extra classes merged onto the trigger button — for size/theme overrides (e.g. compact filters, dark bars). */
  triggerClassName?: string
  /** 'sm' shrinks the trigger to a compact, chip-scale control (inline rows); 'md' is the default form size. */
  size?: 'sm' | 'md'
  disabled?: boolean
  /**
   * Show the type-to-filter box. Left undefined it decides itself, same
   * threshold as section 16.3: 7 or more options route to the kit's
   * SearchableSelect, which always carries the search box; 6 or fewer
   * route to the kit's plain Select, which never does. Passing this
   * explicitly no longer overrides that — section 16.3's threshold is
   * not a per-call-site choice.
   */
  searchable?: boolean
  /** Placeholder inside the search box (e.g. "Search people…"). */
  searchPlaceholder?: string
}

/**
 * Thin adapter (FRONTEND_RULES.md section 4 rule 4 / ADAPTERS.md): same
 * exported name and props every one of this component's 42 call sites
 * already uses, so none of them change. Internally it renders the kit's
 * select.tsx for 6 options or fewer and searchable-select.tsx for 7 or
 * more (section 16.3) — the caller never decides, exactly as every other
 * kit control decides its own phone/desktop form.
 *
 * StyledSelectOption's colour dot, divider, danger variant and
 * non-selectable "action" row are real variants on the kit components
 * themselves (select.tsx's SelectItem `variant` prop and command.tsx's
 * CommandItem `variant` prop, searchable-select.tsx's richer entry
 * shape) — see FRONTEND_RULES.md 4.1 "v2e additions" — not reimplemented
 * here.
 *
 * `size` and `wrapperClassName`/`triggerClassName` are the one place
 * this adapter still carries its own styling rather than the kit's: the
 * kit's trigger is a single fixed 36px height (section 6.2), so `sm`
 * keeps call sites that need a compact, chip-scale control working
 * unchanged, and the two class props keep call sites that override the
 * trigger's look (e.g. a dark bulk-action bar) working unchanged.
 */
export default function StyledSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  wrapperClassName = 'w-full',
  triggerClassName = '',
  size = 'md',
  disabled = false,
  searchPlaceholder = 'Search…',
}: Props) {
  const selected = useMemo(() => options.find((o) => o.value === value && !o.action), [options, value])

  const triggerCls = cn(
    size === 'sm' && 'h-auto rounded-full px-2.5 py-1 text-[13px]',
    triggerClassName
  )

  if (options.length >= 7) {
    const entries: SearchableSelectEntry[] = options
    return (
      <div className={wrapperClassName}>
        <SearchableSelect
          options={entries}
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          disabled={disabled}
          className={triggerCls}
        />
      </div>
    )
  }

  return (
    <div className={wrapperClassName}>
      <Select value={value} onValueChange={(next) => onChange(next as string)} disabled={disabled}>
        <SelectTrigger className={triggerCls}>
          {selected?.color && (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className={cn('flex-1 truncate text-left', !selected && 'text-text-muted')}>
            {selected ? selected.label : placeholder}
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <OptionRow key={option.value} option={option} />
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function OptionRow({ option }: { option: StyledSelectOption }) {
  return (
    <>
      {option.divider && <SelectSeparator />}
      <SelectItem value={option.value} variant={option.variant}>
        {option.color && (
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: option.color }}
          />
        )}
        <span className="truncate">{option.label}</span>
      </SelectItem>
    </>
  )
}
