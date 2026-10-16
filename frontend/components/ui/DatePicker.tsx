'use client'

/**
 * Thin adapter onto the kit's date-picker.tsx (components/ui/date-picker.tsx).
 * Keeps v2e's original ISO-string contract (value/onChange are 'yyyy-mm-dd'
 * strings, '' = empty) and prop names exactly, so none of this file's ~28
 * call sites need to change. See components/ui/ADAPTERS.md and
 * FRONTEND_RULES.md section 4.1 "v2e additions" for markedDates/markedHint
 * and min/max, which were added to date-picker.tsx/calendar.tsx for this.
 *
 * Known deviation (logged in REVIEW-kit-alignment.md): the kit's date
 * field has no `compact`, `hideClear` or `bare` (borderless toolbar
 * trigger) variant. Those three visual-only props are accepted for call-
 * site compatibility but have no effect; the field always renders the
 * kit's one date-picker appearance now.
 */
import { DatePicker as KitDatePicker } from '@/components/ui/date-picker'

interface DatePickerProps {
  value: string // ISO yyyy-mm-dd, '' = empty
  onChange: (iso: string) => void
  placeholder?: string
  min?: string // ISO yyyy-mm-dd
  max?: string // ISO yyyy-mm-dd
  disabled?: boolean
  id?: string
  /** ISO yyyy-mm-dd days to flag with a dot (e.g. a selected assignee is on leave). */
  markedDates?: string[]
  /** Tooltip shown on marked days. */
  markedHint?: string
  /** No longer has a visual effect; kept for call-site compatibility. */
  compact?: boolean
  /** No longer has a visual effect; kept for call-site compatibility. */
  hideClear?: boolean
  /** No longer has a visual effect; kept for call-site compatibility. */
  bare?: boolean
}

/** Parse 'yyyy-mm-dd' into a LOCAL Date (midnight), or undefined. Avoids the UTC off-by-one from new Date(iso). */
function parseIso(iso: string | undefined): Date | undefined {
  if (!iso) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** The reverse: a local-midnight Date back to 'yyyy-mm-dd', with no time-zone shift. */
function toIso(d: Date | undefined): string {
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function DatePicker({
  value,
  onChange,
  placeholder,
  min,
  max,
  disabled,
  id,
  markedDates,
  markedHint,
}: DatePickerProps) {
  return (
    <KitDatePicker
      id={id}
      value={parseIso(value)}
      onValueChange={(date) => onChange(toIso(date))}
      disabled={disabled}
      placeholder={placeholder}
      min={parseIso(min)}
      max={parseIso(max)}
      markedDates={markedDates}
      markedHint={markedHint}
    />
  )
}
