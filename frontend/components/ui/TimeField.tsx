"use client";

/**
 * Thin adapter onto the kit's time-picker.tsx. Keeps v2e's original
 * "HH:MM" 24-hour string contract (value/onChange), '' = empty, and prop
 * names, so this file's call sites don't change. See
 * components/ui/ADAPTERS.md.
 *
 * Recorded owner deviation from kit section 20.2 (20 Oct 2026): on desktop
 * the in-field clock button opens an analog clock-face dialog
 * (clock-time-picker.tsx) instead of the kit's option lists. Typing in the
 * field is kept, and the phone still opens its native picker. `label` is
 * the clock dialog's title again ("Choose a time" when not given).
 * `compact` has no effect and is kept for call-site compatibility.
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
  /** The clock dialog's title. */
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

export default function TimeField({ value, onChange, disabled, placeholder, label }: Props) {
  return (
    <TimePicker
      step={1}
      pickerVariant="clock"
      pickerLabel={label}
      value={fromHHMM(value)}
      onValueChange={(next) => onChange(toHHMM(next))}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}
