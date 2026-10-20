"use client";

/**
 * Thin adapter onto the kit's time-picker.tsx. Keeps v2e's original
 * "HH:MM" 24-hour string contract (value/onChange), '' = empty, and prop
 * names, so this file's 9 call sites don't change. See
 * components/ui/ADAPTERS.md.
 *
 * Known deviation (logged in REVIEW-kit-alignment.md): `label` (the old
 * ClockTimePicker dialog's heading) and `compact` (tighter padding) have
 * no kit equivalent and are accepted but unused — the field always
 * renders the kit's one time-picker appearance (an inline popover with
 * hour/minute/AM-PM lists) instead of the old centered analog-clock
 * dialog.
 *
 * step={1}: every call site is a free time (deadline, meeting, reminder,
 * schedule, workflow timing), so typed minutes are kept exactly. The old
 * clock never snapped to 15. No call site is a slot picker.
 */
import { TimePicker, type TimeValue } from "@/components/ui/time-picker";

interface Props {
  value: string; // "HH:MM" 24-h, "" = empty
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** No longer has a visual effect; kept for call-site compatibility. */
  label?: string;
  /** No longer has a visual effect; kept for call-site compatibility. */
  compact?: boolean;
}

/** "HH:MM" (24h) -> the kit's 12-hour TimeValue, or undefined for "". */
function fromHHMM(value: string): TimeValue | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return undefined
  const hour24 = Number(m[1])
  const minute = Number(m[2])
  if (hour24 > 23 || minute > 59) return undefined
  return {
    hour: hour24 % 12 || 12,
    minute,
    meridiem: hour24 >= 12 ? "PM" : "AM",
  }
}

/** The kit's TimeValue -> "HH:MM" (24h), or "" for undefined. */
function toHHMM(value: TimeValue | undefined): string {
  if (!value) return ""
  const hour24 = (value.hour % 12) + (value.meridiem === "PM" ? 12 : 0)
  return `${String(hour24).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`
}

export default function TimeField({ value, onChange, disabled, placeholder }: Props) {
  return (
    <TimePicker
      step={1}
      value={fromHHMM(value)}
      onValueChange={(next) => onChange(toHHMM(next))}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}
