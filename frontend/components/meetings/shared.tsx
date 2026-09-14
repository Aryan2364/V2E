'use client'

import { useEffect, useRef, useState } from 'react'
import { getMyPermissions } from '@/lib/api/permissions'
import {
  MEETING_STATUS_META,
  RESPONSE_META,
  type MeetingAttendeeResponse,
  type MeetingStatus,
} from '@/lib/types/meetings'

export interface MeetingPerms {
  read: boolean
  write: boolean
  edit: boolean
  delete: boolean
}
const FALLBACK: MeetingPerms = { read: false, write: false, edit: false, delete: false }

export function useMeetingPermissions(orgId: string): { perms: MeetingPerms; loading: boolean } {
  const [perms, setPerms] = useState<MeetingPerms>(FALLBACK)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!orgId) {
      setLoading(false)
      return
    }
    getMyPermissions(orgId)
      .then((res) => active && setPerms(res.leaves?.meetings ?? FALLBACK))
      .catch(() => active && setPerms(FALLBACK))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [orgId])
  return { perms, loading }
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const m = MEETING_STATUS_META[status]
  return (
    <span
      className="inline-flex items-center font-medium text-[12px] rounded-full px-2.5 py-0.5 border whitespace-nowrap"
      style={{ backgroundColor: m.bg, color: m.text, borderColor: m.border }}
    >
      {m.label}
    </span>
  )
}

export function ResponseBadge({ response }: { response: MeetingAttendeeResponse }) {
  const m = RESPONSE_META[response]
  return (
    <span className="inline-flex items-center font-medium text-[12px] rounded-full px-2.5 py-0.5" style={{ backgroundColor: m.bg, color: m.text }}>
      {m.label}
    </span>
  )
}

/* ── Duration ───────────────────────────────────────────────────────────────
 * One control for "how long is this?" used by every meeting/rhythm form:
 * quick presets plus a Custom box so any length can be typed (5–1440 min).
 * Custom opens automatically when the value isn't one of the presets, so an
 * edited end time (or an imported meeting) always shows its real length. */
export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120]

export function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type DurationUnit = 'min' | 'hr'

const clampDuration = (mins: number) => Math.min(1440, Math.max(5, Math.round(mins)))

/** Is this number a length a person would actually type in that unit? */
const inDurationRange = (n: number, unit: DurationUnit) =>
  unit === 'hr' ? n >= 0.25 && n <= 24 : n >= 5 && n <= 1440

/** Render minutes in the box's current unit (hours keep up to 2 decimals: 1.5, 0.75). */
function toDraft(mins: number, unit: DurationUnit): string {
  if (unit === 'min') return String(mins)
  return String(Number((mins / 60).toFixed(2)))
}

export function DurationField({
  value,
  onChange,
  label = 'Length',
  inline = false,
  disabled = false,
}: {
  value: number
  onChange: (min: number) => void
  label?: string
  /** Render the label on the same row as the chips (compact toolbars). */
  inline?: boolean
  disabled?: boolean
}) {
  const isPreset = DURATION_PRESETS.includes(value)
  const [custom, setCustom] = useState(!isPreset)
  // Whole hours are easier to read as hours; anything else stays in minutes.
  const [unit, setUnit] = useState<DurationUnit>(() => (value >= 60 && value % 60 === 0 ? 'hr' : 'min'))
  const [draft, setDraft] = useState(() => toDraft(value, value >= 60 && value % 60 === 0 ? 'hr' : 'min'))
  const boxRef = useRef<HTMLInputElement>(null)
  const emitted = useRef(value)

  // Follow the value when it's changed elsewhere (end-time edits, loading a meeting).
  useEffect(() => {
    const mine = emitted.current === value
    const u = mine ? unit : value >= 60 && value % 60 === 0 ? 'hr' : 'min'
    if (!mine) setUnit(u)
    setDraft(toDraft(value, u))
    if (!DURATION_PRESETS.includes(value)) setCustom(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(mins: number) {
    emitted.current = mins
    onChange(mins)
  }

  function commit(raw: string, u: DurationUnit = unit) {
    const n = Number(raw)
    if (!raw.trim() || Number.isNaN(n)) return setDraft(toDraft(value, u))
    const next = clampDuration(u === 'hr' ? n * 60 : n)
    setDraft(toDraft(next, u))
    if (next !== value) emit(next)
  }

  /**
   * Switching units follows what the number means, not a blind conversion:
   *  - "1.5" then hrs  -> 1.5 hours (1.5 minutes is not a real length, so they meant hours)
   *  - "90"  then hrs  -> 1.5 hours (90 hours is not a real length, so show 90 min in hours)
   *  - "2"   then min  -> 120 minutes (2 minutes is below the floor, so convert)
   */
  function switchUnit(u: DurationUnit) {
    if (u === unit) return
    const n = Number(draft)
    const typed = draft.trim() !== '' && !Number.isNaN(n)
    const mins = !typed
      ? value
      : inDurationRange(n, u)
        ? clampDuration(u === 'hr' ? n * 60 : n) // the number stands on its own in the new unit
        : clampDuration(unit === 'hr' ? n * 60 : n) // it doesn't — keep the length, restate it
    setUnit(u)
    setDraft(toDraft(mins, u))
    if (mins !== value) emit(mins)
    requestAnimationFrame(() => boxRef.current?.select())
  }

  const chip = (active: boolean) =>
    [
      'px-3 py-1.5 min-h-[36px] text-sm rounded-[8px] border transition-colors',
      disabled
        ? 'bg-[#E2E8F0] text-[#94A3B8] border-[#E2E8F0] cursor-not-allowed'
        : active
          ? 'bg-[#2563EB] text-white border-[#2563EB]'
          : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]',
    ].join(' ')

  const unitBtn = (active: boolean) =>
    [
      'px-2.5 min-h-[36px] text-sm transition-colors',
      disabled
        ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
        : active
          ? 'bg-[#2563EB] text-white font-medium'
          : 'bg-white text-[#475569] hover:bg-[#F1F5F9]',
    ].join(' ')

  return (
    <div className={inline ? 'flex flex-wrap items-center gap-2' : ''}>
      {inline ? (
        <span className="text-sm text-[#475569]">{label}</span>
      ) : (
        <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {DURATION_PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => { setCustom(false); emit(d) }}
            className={chip(!custom && value === d)}
          >
            {fmtDuration(d)}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setCustom(true); setDraft(toDraft(value, unit)); requestAnimationFrame(() => boxRef.current?.select()) }}
          className={chip(custom)}
        >
          Custom
        </button>
        {custom && (
          <span className="inline-flex items-center gap-1.5">
            <input
              type="number"
              min={unit === 'hr' ? 0.25 : 5}
              max={unit === 'hr' ? 24 : 1440}
              step={unit === 'hr' ? 0.25 : 5}
              ref={boxRef}
              disabled={disabled}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value) } }}
              className="w-[76px] border border-[#CBD5E1] rounded-[8px] px-2.5 py-1.5 min-h-[36px] text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F1F5F9]"
              aria-label={unit === 'hr' ? `${label} in hours` : `${label} in minutes`}
            />
            {/* Type it in minutes or in hours — 90 min and 1.5 hrs are the same thing. */}
            <span className="inline-flex rounded-[8px] border border-[#CBD5E1] overflow-hidden">
              <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => switchUnit('min')} className={unitBtn(unit === 'min')}>min</button>
              <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => switchUnit('hr')} className={`${unitBtn(unit === 'hr')} border-l border-[#CBD5E1]`}>hrs</button>
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
