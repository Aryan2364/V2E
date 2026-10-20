'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { getMyPermissions } from '@/lib/api/permissions'
import { getEmployees } from '@/lib/api/employees'
import { getDepartments } from '@/lib/api/departments'
import {
  FOCUS_AREA_META,
  MANUAL_STATUSES,
  STATUS_META,
  formatValue,
  type GoalFocusArea,
  type GoalStatus,
} from '@/lib/types/goals'
import type { DeptOption, EmployeeOption } from './GoalFormFields'
import { formatDate as formatDateToken, formatDateTime as formatDateTimeToken, formatNumber } from '@/lib/format'
import { Count } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Formatting ────────────────────────────────────────────────────────────────
// Delegates to the one lib/format.ts implementation (section 4 rule 2, section
// 18) instead of a second toLocaleDateString formatter — this also removes a
// hydration-mismatch risk, since toLocaleDateString read the machine's own locale.

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const out = formatDateToken(iso)
  return out || '—'
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const out = formatDateTimeToken(iso)
  return out || '—'
}

export function toDateInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // Local parts, not toISOString — that shifts the date across timezones.
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Plain-language days-left, e.g. "12 days left", "Due today", "5 days late". */
export function daysLeftLabel(days: number | null | undefined): {
  text: string
  tone: 'ok' | 'soon' | 'late'
} {
  if (days === null || days === undefined) return { text: '—', tone: 'ok' }
  if (days < 0) {
    const n = Math.abs(days)
    return { text: `${n} day${n === 1 ? '' : 's'} late`, tone: 'late' }
  }
  if (days === 0) return { text: 'Due today', tone: 'soon' }
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: days <= 7 ? 'soon' : 'ok' }
}

export const DAYS_TONE: Record<'ok' | 'soon' | 'late', string> = {
  ok: 'text-text-secondary',
  soon: 'text-warning',
  late: 'text-danger',
}

// ─── Badges ──────────────────────────────────────────────────────────────────

export function GoalStatusBadge({ status, withDot = true }: { status: GoalStatus; withDot?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 font-medium text-meta rounded-full px-2.5 py-0.5 border whitespace-nowrap"
      style={{ backgroundColor: m.bg, color: m.text, borderColor: m.border }}
    >
      {withDot && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />}
      {m.label}
    </span>
  )
}

/**
 * The same badge, but clickable — change a goal's status where you read it,
 * without opening the edit form (which still offers the identical list).
 *
 * Only the hand-set statuses are offered: On track / At risk / Off track are
 * the check-in traffic light and would be a lie if typed in here. If the goal
 * is currently sitting on one of those, it is shown at the top as the current
 * value so the badge never misreports itself — it just can't be re-picked.
 *
 * Without edit rights this renders the plain read-only badge, so nobody is
 * offered a control that would only fail.
 */
export function GoalStatusPicker({
  status,
  canEdit,
  onSelect,
}: {
  status: GoalStatus
  canEdit: boolean
  onSelect: (next: GoalStatus) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on click-away and on Escape — the panel is in-flow under the badge,
  // so it moves with the sticky header instead of drifting on scroll.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!canEdit) return <GoalStatusBadge status={status} />

  const m = STATUS_META[status]
  const options: GoalStatus[] = MANUAL_STATUSES.includes(status)
    ? MANUAL_STATUSES
    : [status, ...MANUAL_STATUSES]

  async function pick(next: GoalStatus) {
    setOpen(false)
    if (next === status || saving) return
    setSaving(true)
    try {
      await onSelect(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        title="Change status"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 font-medium text-meta rounded-full pl-2.5 pr-2 py-0.5 border whitespace-nowrap transition-shadow hover:ring-2 hover:ring-primary-ring/30 focus:outline-hidden focus:ring-2 focus:ring-primary-ring disabled:opacity-70"
        style={{ backgroundColor: m.bg, color: m.text, borderColor: m.border }}
      >
        {saving ? (
          <Loader2 size={11} className="animate-spin shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />
        )}
        {m.label}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 z-popover w-[228px] bg-surface border border-border-light rounded-card shadow-menu py-1"
        >
          {options.map((s) => {
            const om = STATUS_META[s]
            const isCurrent = s === status
            const isCheckIn = !MANUAL_STATUSES.includes(s)
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={isCurrent}
                disabled={isCheckIn}
                onClick={() => pick(s)}
                className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full flex items-center gap-2 px-3 py-2 text-label text-left transition-colors ${
                  isCheckIn ? 'cursor-default text-text-secondary' : 'text-text-primary hover:bg-surface-control'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: om.dot }} />
                <span className="flex-1 truncate font-medium">{om.label}</span>
                {isCurrent && <Check size={14} className="text-primary-text shrink-0" />}
              </button>
            )
          })}
          <p className="text-meta text-text-secondary leading-snug px-3 pt-2 pb-1 mt-1 border-t border-border-light">
            On track / At risk / Off track come from check-ins. On hold pauses check-in
            reminders without closing the goal.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Which part of the business the goal moves. Nothing shown when unset.
 * `compact` uses the short label so it fits a table column; the full label
 * carries the `title` either way, so nothing is lost by abbreviating.
 */
export function FocusAreaBadge({
  focus,
  compact = false,
}: {
  focus: GoalFocusArea | null | undefined
  compact?: boolean
}) {
  if (!focus) return null
  const m = FOCUS_AREA_META[focus]
  return (
    <span
      title={m.label}
      className="inline-flex items-center gap-1.5 font-medium text-meta rounded-full px-2.5 py-0.5 border whitespace-nowrap"
      style={{ backgroundColor: m.bg, color: m.text, borderColor: m.border }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.dot }} />
      {compact ? m.short : m.label}
    </span>
  )
}

/**
 * A goal's number against its target — the only quantitative reading in the
 * module. There is deliberately NO percentage and no progress bar: nothing here
 * is computed, so a bar would imply arithmetic that doesn't exist.
 */
export function ValueAgainstTarget({
  current,
  target,
  unit,
  size = 'md',
}: {
  current: number | null
  target: number | null
  unit?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  if (target === null || target === undefined) {
    return <span className="text-label text-text-secondary">No target number</span>
  }
  const cls =
    size === 'lg' ? 'text-page-title' : size === 'sm' ? 'text-label' : 'text-body'
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`${cls} font-medium text-text-primary tabular-nums`}>
        {current === null ? '—' : formatNumber(current)}
      </span>
      <span className="text-label text-text-secondary">of {formatValue(target, unit)}</span>
    </span>
  )
}

// ─── Count badge (§6.8's one count style, hidden at 0) ────────────────────────
// Delegates to the kit's badge.tsx Count (section 4 rule 2) instead of a second
// pill implementation; keeps the "hidden at 0" behaviour this module relies on.

export function CountBadge({ count }: { count: number }) {
  if (!count) return null
  return <Count value={count} />
}

// ─── Empty state ───────────────────────────────────────────────────────────────

// ─── Permissions hook ─────────────────────────────────────────────────────────
//
// Holding the `goals` leaf IS the whole permission for this module — there is no
// row-level scope and no per-goal owner check. Anyone with edit rights may
// create, edit, link, unlink and check in on any goal; delete is its own action
// so default roles never get it.

export interface GoalPerms {
  read: boolean
  write: boolean
  edit: boolean
  delete: boolean
}

const FALLBACK: GoalPerms = { read: false, write: false, edit: false, delete: false }

export function useGoalPermissions(orgId: string): {
  perms: GoalPerms
  loading: boolean
  /**
   * The permissions request itself failed (backend down, network blip, token
   * refresh). This is NOT the same as being denied — callers must show a retry,
   * never "you don't have access", which would be a flat lie and has scared
   * people into thinking their role was changed.
   */
  failed: boolean
  retry: () => void
} {
  const [perms, setPerms] = useState<GoalPerms>(FALLBACK)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setFailed(false)
    getMyPermissions(orgId)
      .then((res) => {
        if (!active) return
        setPerms(res.leaves?.goals ?? FALLBACK)
        setFailed(false)
      })
      .catch(() => {
        if (!active) return
        setPerms(FALLBACK)
        setFailed(true)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [orgId, attempt])

  return { perms, loading, failed, retry: () => setAttempt((a) => a + 1) }
}

/**
 * Shown when we could not find out what this person is allowed to do — as
 * opposed to knowing they aren't allowed. Almost always a backend that is down
 * or restarting.
 */
export function PermissionsUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      variant="failed"
      heading="Couldn't check your access"
      onAction={onRetry}
    >
      We couldn't reach the server to confirm what you can see. This is a connection problem,
      not a change to your permissions.
    </EmptyState>
  )
}

// ─── Reference data (owners + departments) ────────────────────────────────────
//
// Every goals screen needs the same two lists to render its pickers and
// filters, so they share one loader rather than four slightly different ones.

export function useGoalRefData(orgId: string): {
  employees: EmployeeOption[]
  departments: DeptOption[]
} {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [departments, setDepartments] = useState<DeptOption[]>([])

  useEffect(() => {
    let active = true
    if (!orgId) return
    Promise.all([getEmployees(orgId).catch(() => []), getDepartments(orgId).catch(() => [])]).then(
      ([emps, depts]: any[]) => {
        if (!active) return
        setEmployees(
          (emps as any[]).map((e) => ({
            user_id: e.user_id,
            name: e.user?.name ?? e.name ?? e.email ?? 'Unknown',
            role_title: e.role?.title ?? e.role?.name ?? null,
            department_id: e.department?.id ?? null,
            department_name: e.department?.name ?? null,
          })),
        )
        setDepartments(
          (depts as any[]).map((d) => ({
            id: d.id,
            name: d.name,
            parent_department_id: d.parent_department_id ?? null,
          })),
        )
      },
    )
    return () => {
      active = false
    }
  }, [orgId])

  return { employees, departments }
}
