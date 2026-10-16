'use client'

/**
 * Range-selection mode built on top of the kit's calendar.tsx (which
 * already ships range_start/range_middle/range_end styling and
 * react-day-picker's mode="range") and popover.tsx. Keeps v2e's original
 * {from, to} ISO-string contract and prop names exactly, so this file's
 * 9 call sites don't change. See components/ui/ADAPTERS.md.
 *
 * Presets (Today, Last 7/30 days, etc.) are v2e's own list, kept as-is;
 * they predate and roughly match FRONTEND_RULES.md section 27.4's list.
 */
import { useMemo, useState } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

interface DateRangePickerProps {
  from: string // ISO yyyy-mm-dd, '' = unset
  to: string // ISO yyyy-mm-dd, '' = unset
  onChange: (from: string, to: string) => void
  max?: string // ISO yyyy-mm-dd — caps selectable days (e.g. today)
  placeholder?: string
  wrapperClassName?: string
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIso(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

const fmt = (d: Date, withYear = true) =>
  `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`

const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export default function DateRangePicker({
  from,
  to,
  onChange,
  max,
  placeholder = 'Date range',
  wrapperClassName = 'w-full',
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  const fromD = useMemo(() => parseIso(from), [from])
  const toD = useMemo(() => parseIso(to), [to])
  const maxD = useMemo(() => (max ? parseIso(max) : undefined), [max])

  const today = new Date()

  const range: DateRange | undefined = fromD ? { from: fromD, to: toD } : undefined

  const presets: { label: string; range: () => [string, string] }[] = [
    { label: 'Today', range: () => [toIso(today), toIso(today)] },
    { label: 'Last 7 days', range: () => [toIso(addDays(today, -6)), toIso(today)] },
    { label: 'Last 30 days', range: () => [toIso(addDays(today, -29)), toIso(today)] },
    { label: 'This month', range: () => [toIso(new Date(today.getFullYear(), today.getMonth(), 1)), toIso(today)] },
    { label: 'This year', range: () => [toIso(new Date(today.getFullYear(), 0, 1)), toIso(today)] },
  ]

  const label = useMemo(() => {
    if (fromD && toD) {
      const sameYear = fromD.getFullYear() === toD.getFullYear()
      return `${fmt(fromD, !sameYear)} – ${fmt(toD)}`
    }
    if (fromD) return `From ${fmt(fromD)}`
    if (toD) return `Until ${fmt(toD)}`
    return placeholder
  }, [fromD, toD, placeholder])

  const hasValue = !!(fromD || toD)

  return (
    <div className={wrapperClassName}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              className={cn('w-full justify-start', !hasValue && 'text-text-muted')}
            />
          }
        >
          <CalendarIcon className="size-4 text-text-muted" />
          <span className="flex-1 truncate text-left">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <div className="flex flex-wrap gap-1.5 p-1 pb-2">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="secondary"
                size="sm"
                onClick={() => {
                  const [f, t] = p.range()
                  onChange(f, t)
                  setOpen(false)
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            selected={range}
            defaultMonth={fromD}
            disabled={maxD ? { after: maxD } : undefined}
            onSelect={(next) => {
              onChange(next?.from ? toIso(next.from) : '', next?.to ? toIso(next.to) : '')
              if (next?.from && next?.to) setOpen(false)
            }}
          />
          <div className="flex items-center justify-between border-t border-border-light pt-2 mt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange('', '')
                setOpen(false)
              }}
            >
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
