'use client'

import Link from 'next/link'
import React, { Fragment } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Info, Loader2, PlayCircle, Plus, RefreshCw, SearchX, Undo2, XCircle, type LucideIcon } from 'lucide-react'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { getNow } from '@/lib/clock'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import Tooltip from '@/components/ui/Tooltip'
import type {
  RunDisplayStatus,
  WorkflowInstance,
  WorkflowSchedule,
  WorkflowStepStatus,
  WorkflowTemplate,
  WorkflowTemplateStatus,
} from '@/lib/types/workflows'

export const WORKFLOWS_BASE = '/dashboard/tasks/workflows'
export const workflowHref = (id: string) => `${WORKFLOWS_BASE}/${id}`
export const editHref = (id: string) => `${WORKFLOWS_BASE}/${id}/edit`
/** The runs list lives on the workflow page. */
export const runsHref = (id: string) => `${WORKFLOWS_BASE}/${id}#runs`
export const runHref = (templateId: string, instanceId: string) => `${WORKFLOWS_BASE}/${templateId}/instances/${instanceId}`
export const taskHref = (taskId: string) => `/dashboard/tasks/${taskId}`

// ─── Reasons (kit §26.2: who may do it, by what they may do) ──────────────────

export const REASONS = {
  preview: 'Workflows is in preview mode, so changes are turned off.',
  edit: 'Only owners, editors and admins can do this.',
  start: 'Only the people listed under “Who can start it” can start this workflow.',
  startPaused: 'This workflow is paused. Resume it first.',
  startDraft: 'This workflow is a draft. Save it to make it live first.',
  manageAccess: 'Only owners, the creator and admins can change who is involved.',
  runActions: 'Only owners, editors and admins can manage runs.',
  sendBack: 'Only this step’s assignees, owners and editors can send it back.',
  upload: 'Only people in this run can add files.',
} as const

/**
 * Whether workflow writes are possible at all for this org. `preview` turns every write
 * off. undefined = not known yet (entitlements still loading). Super admins never get an
 * entitlement map, so "loaded and absent" counts as writable.
 */
export function useWorkflowsWritable(): boolean | undefined {
  const { loading, state } = useEntitlements()
  if (loading) return undefined
  return state('workflows') !== 'preview'
}

/** Combine the org-level write switch with a record capability into one tri-state answer + reason. */
export function gate(
  capability: boolean | undefined,
  writable: boolean | undefined,
  reason: string,
): { allowed: boolean | undefined; reason: string } {
  if (writable === false) return { allowed: false, reason: REASONS.preview }
  if (capability === false) return { allowed: false, reason }
  if (writable === undefined || capability === undefined) return { allowed: undefined, reason }
  return { allowed: true, reason }
}

// ─── Formatting (one format everywhere: DD Mon YYYY, h:mm A) ──────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(value: string | Date | null | undefined): string {
  const d = validDate(value)
  if (!d) return '—'
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtClock(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  const d = validDate(value)
  if (!d) return '—'
  return `${fmtDate(d)}, ${fmtClock(d)}`
}

/** "Fri 18 Oct 2026, 9:00 AM" — for planned dates, where the weekday matters. */
export function fmtDayDateTime(value: string | Date | null | undefined): string {
  const d = validDate(value)
  if (!d) return '—'
  return `${WEEKDAYS_SHORT[d.getDay()]} ${fmtDate(d)}, ${fmtClock(d)}`
}

/**
 * A planned span: "Thu 10 Oct 2026, 9:00 AM → Fri 11 Oct 2026, 6:00 PM", or with the
 * date said once when both ends fall on the same day ("… 9:00 AM → 6:00 PM").
 */
export function fmtSpan(from: string | null | undefined, to: string | null | undefined): string {
  const a = validDate(from)
  const b = validDate(to)
  if (!a && !b) return '—'
  if (!a) return `Due ${fmtDayDateTime(b)}`
  if (!b) return `Starts ${fmtDayDateTime(a)}`
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return `${fmtDayDateTime(a)} → ${sameDay ? fmtClock(b) : fmtDayDateTime(b)}`
}

/** "18:00" → "6:00 PM". */
export function fmtTime(hhmm: string | undefined | null): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '—'
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2026-08-12" → "12 Aug 2026" without a timezone shift. */
export function fmtIsoDate(iso: string | undefined | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

/** Today in the org's clock (simulated for test orgs). */
export function todayIso(): string {
  const d = getNow()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ─── Status badges ───────────────────────────────────────────────────────────

const BADGE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium'

export const TEMPLATE_STATUS: Record<WorkflowTemplateStatus, { cls: string; dot: string; label: string }> = {
  active: { cls: 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]', dot: 'bg-[#16A34A]', label: 'Live' },
  paused: { cls: 'bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]', dot: 'bg-[#CA8A04]', label: 'Paused' },
  draft: { cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]', dot: 'bg-[#94A3B8]', label: 'Draft' },
  archived: { cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]', dot: 'bg-[#94A3B8]', label: 'Archived' },
}

/** Draft / Live / Paused / Archived. */
export function TemplateStatusBadge({ status }: { status: WorkflowTemplateStatus }) {
  const c = TEMPLATE_STATUS[status] ?? TEMPLATE_STATUS.draft
  return (
    <span className={`${BADGE} ${c.cls}`}>
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

/**
 * Run states as people see them. "Running" is in progress, not "Active" (kit §2.4
 * exception, recorded here: label Running, colour neutral-brand blue, because a run under
 * way is neither good nor bad yet).
 */
export const RUN_STATUS: Record<RunDisplayStatus, { cls: string; label: string; Icon: LucideIcon }> = {
  running: { cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]', label: 'Running', Icon: PlayCircle },
  falling_behind: { cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]', label: 'Falling behind', Icon: Clock },
  waiting_for_info: { cls: 'bg-[#F5F3FF] text-[#5B21B6] border-[#DDD6FE]', label: 'Waiting for info', Icon: Undo2 },
  needs_attention: { cls: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]', label: 'Needs attention', Icon: AlertTriangle },
  completed: { cls: 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]', label: 'Completed', Icon: CheckCircle2 },
  cancelled: { cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]', label: 'Cancelled', Icon: XCircle },
}

/** The server's display status, or the same rules applied here for an older response. */
export function runDisplayStatus(run: Pick<WorkflowInstance, 'status' | 'display_status' | 'last_error' | 'steps'>): RunDisplayStatus {
  if (run.display_status && RUN_STATUS[run.display_status]) return run.display_status
  if (run.status === 'completed') return 'completed'
  if (run.status === 'cancelled') return 'cancelled'
  if (run.status === 'stuck' || run.last_error) return 'needs_attention'
  const rows = run.steps ?? []
  if (rows.some((r) => r.status === 'sent_back')) return 'waiting_for_info'
  if (rows.some((r) => r.status === 'overdue' || r.status === 'moved_on')) return 'falling_behind'
  return 'running'
}

export function RunStatusBadge({ run }: { run: Pick<WorkflowInstance, 'status' | 'display_status' | 'last_error' | 'steps'> }) {
  const c = RUN_STATUS[runDisplayStatus(run)]
  const Icon = c.Icon
  return (
    <span className={`${BADGE} ${c.cls}`}>
      <Icon size={12} aria-hidden /> {c.label}
    </span>
  )
}

export const STEP_STATUS: Record<WorkflowStepStatus, { cls: string; label: string }> = {
  pending: { cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]', label: 'Not started' },
  active: { cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]', label: 'In progress' },
  completed: { cls: 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]', label: 'Done' },
  overdue: { cls: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]', label: 'Overdue' },
  skipped: { cls: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]', label: 'Skipped' },
  branched: { cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]', label: 'Follow-up started' },
  sent_back: { cls: 'bg-[#F5F3FF] text-[#5B21B6] border-[#DDD6FE]', label: 'Waiting for info' },
  moved_on: { cls: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]', label: 'Overdue, continued' },
}

/** `waiting` = pending with a start time: the steps before it are done, its time has not come. */
export function StepStatusBadge({ status, waiting = false }: { status: WorkflowStepStatus; waiting?: boolean }) {
  if (waiting && status === 'pending') return <span className={`${BADGE} bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE]`}>Waiting to start</span>
  const c = STEP_STATUS[status] ?? STEP_STATUS.pending
  return <span className={`${BADGE} ${c.cls}`}>{c.label}</span>
}

/**
 * How a workflow repeats, in a few words — the server derives it from the schedules:
 * "Repeats monthly", or "Repeats on a schedule" when its schedules repeat in different
 * ways. Null when it doesn't repeat.
 */
export function recurrenceLabel(t: Pick<WorkflowTemplate, 'workflow_nature' | 'recurring_type'>): string | null {
  if (t.workflow_nature === 'recurring' && t.recurring_type) return `Repeats ${t.recurring_type}`
  if (t.workflow_nature === 'recurring') return 'Repeats on a schedule'
  return null
}


// ─── Narrow screens ──────────────────────────────────────────────────────────

const NARROW_QUERY = '(max-width: 639px)'

/**
 * Below Tailwind's `sm` (640px) a page header keeps one row — title, primary action and
 * the three-dot menu — and its secondary actions move into that menu. Decided in script
 * rather than CSS because an action must be in exactly one place: a CSS-hidden button
 * would still leave its permission wrapper focusable. False until mounted (no SSR guess).
 */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[8px] text-sm font-semibold transition-colors duration-150 min-h-[44px] sm:min-h-[38px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:cursor-not-allowed whitespace-nowrap'

export const BTN = {
  primary: `${BTN_BASE} bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#64748B]`,
  secondary: `${BTN_BASE} bg-white text-[#2563EB] border-2 border-[#2563EB] hover:bg-[#EFF6FF] disabled:bg-[#F1F5F9] disabled:text-[#64748B] disabled:border-[#E2E8F0]`,
  danger: `${BTN_BASE} bg-[#DC2626] text-white hover:bg-[#B91C1C] disabled:bg-[#E2E8F0] disabled:text-[#64748B]`,
  quiet: `${BTN_BASE} bg-white text-[#334155] border border-[#CBD5E1] hover:bg-[#F1F5F9] disabled:bg-[#F1F5F9] disabled:text-[#64748B]`,
  icon: 'inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:cursor-not-allowed shrink-0',
} as const

/**
 * A button whose action may be refused: disabled until a definite yes, and when the
 * answer is no its reason is reachable by hover, focus and tap (PermissionTooltip).
 */
export function GatedButton({
  allowed,
  reason,
  onClick,
  variant = 'secondary',
  icon: Icon,
  loading = false,
  disabled = false,
  children,
  className = '',
  type = 'button',
  ariaLabel,
}: {
  allowed: boolean | undefined
  reason: string
  onClick?: () => void
  variant?: keyof typeof BTN
  icon?: LucideIcon
  loading?: boolean
  disabled?: boolean
  children?: React.ReactNode
  className?: string
  type?: 'button' | 'submit'
  ariaLabel?: string
}) {
  return (
    <PermissionTooltip allowed={allowed} reason={reason}>
      <button
        type={type}
        onClick={onClick}
        aria-label={ariaLabel}
        disabled={allowed !== true || loading || disabled}
        className={`${BTN[variant]} ${className}`}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
        {children}
      </button>
    </PermissionTooltip>
  )
}

/**
 * The small ⓘ beside a label or option: the explanation lives behind it, not on the page.
 * A real button (focusable, 44px touch area) that opens a one-sentence tooltip on hover,
 * keyboard focus and tap; screen readers get the same sentence as its description.
 */
export function InfoTip({ label, text, className = '' }: { label: string; text: string; className?: string }) {
  const id = React.useId()
  return (
    <>
      <Tooltip label={text} openOnTap>
        <button
          type="button"
          aria-label={`More info about ${label}`}
          aria-describedby={id}
          // Never toggles the card or label it sits in.
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className={`relative inline-flex items-center justify-center w-6 h-6 -my-1 align-middle shrink-0 rounded-full text-[#475569] hover:text-[#1D4ED8] hover:bg-[#EFF6FF] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] after:absolute after:-inset-2.5 after:content-[''] ${className}`}
        >
          <Info size={14} aria-hidden />
        </button>
      </Tooltip>
      <span id={id} className="sr-only">
        {text}
      </span>
    </>
  )
}

/**
 * The full-width "+ Add step" bar at the end of a list of steps — where the next step
 * will appear, so nobody has to scroll back up past every card to add one.
 */
export function AddStepBar({
  allowed,
  reason,
  onClick,
  children,
}: {
  allowed: boolean | undefined
  reason: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <PermissionTooltip allowed={allowed} reason={reason} className="flex w-full">
      <button
        type="button"
        onClick={onClick}
        disabled={allowed !== true}
        className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-[12px] border-2 border-dashed border-[#93C5FD] bg-white text-sm font-semibold text-[#1D4ED8] hover:bg-[#EFF6FF] hover:border-[#2563EB] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:border-[#E2E8F0] disabled:text-[#64748B]"
      >
        <Plus size={16} /> {children}
      </button>
    </PermissionTooltip>
  )
}

// ─── Reveal (expand / collapse without a snap) ───────────────────────────────

/**
 * Shows or hides its children with a short fade and a 4px slide — opacity and transform
 * only, so text never slides under the reader. It appears in 200ms and leaves in 150ms,
 * then unmounts. `appear` animates the first mount too (a form that has just opened).
 */
export function Reveal({
  open,
  appear = false,
  id,
  className = '',
  children,
}: {
  open: boolean
  appear?: boolean
  id?: string
  className?: string
  children: React.ReactNode
}) {
  const [mounted, setMounted] = React.useState(open)
  const [shown, setShown] = React.useState(open && !appear)

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 150)
    return () => clearTimeout(t)
  }, [open])

  if (!mounted) return null
  return (
    <div
      id={id}
      className={`transition-[opacity,transform] motion-reduce:transition-none motion-reduce:transform-none ${
        shown ? 'opacity-100 translate-y-0 duration-200 ease-out' : 'opacity-0 -translate-y-1 duration-150 ease-in'
      } ${className}`}
    >
      {children}
    </div>
  )
}

// ─── Breadcrumb (the kit's way back — never a back arrow) ─────────────────────

export function WorkflowBreadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-[13px] text-[#475569] mb-2 sm:mb-3 min-w-0">
      {trail.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-[#64748B]" aria-hidden>›</span>}
          {c.href ? (
            <Link
              href={c.href}
              className="font-medium text-[#475569] hover:text-[#2563EB] hover:underline transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] truncate max-w-[40vw]"
            >
              {c.label}
            </Link>
          ) : (
            <span className="font-semibold text-[#0F172A] truncate max-w-[60vw]" aria-current="page">
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

// ─── People ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['bg-[#2563EB]', 'bg-[#7C3AED]', 'bg-[#047857]', 'bg-[#B45309]', 'bg-[#B91C1C]', 'bg-[#0E7490]']

export function initials(name: string): string {
  return name.trim().split(/\s+/).map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  const dim = size === 'md' ? 'w-8 h-8 text-[11px]' : 'w-6 h-6 text-[10px]'
  return (
    <span
      aria-hidden
      className={`${dim} ${AVATAR_COLORS[h % AVATAR_COLORS.length]} rounded-full border-2 border-white text-white font-semibold flex items-center justify-center shrink-0`}
    >
      {initials(name)}
    </span>
  )
}

/** "Asha Rao, Vikram S +2" — owners by name, never ids. */
export function namesSummary(people: { name: string }[], max = 2): string {
  if (!people.length) return '—'
  const shown = people.slice(0, max).map((p) => p.name).join(', ')
  return people.length > max ? `${shown} +${people.length - max}` : shown
}

// ─── States ──────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon
  title: string
  text: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="w-14 h-14 rounded-[14px] bg-[#EFF6FF] flex items-center justify-center mb-4">
        <Icon size={22} className="text-[#2563EB]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#0F172A] mb-1">{title}</h3>
      <p className="text-sm text-[#475569] max-w-md">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="w-14 h-14 rounded-[14px] bg-[#FEE2E2] flex items-center justify-center mb-4">
        <AlertTriangle size={22} className="text-[#B91C1C]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#0F172A] mb-1">{title}</h3>
      <p className="text-sm text-[#475569] max-w-md">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${BTN.secondary} mt-5`}>
          <RefreshCw size={15} /> Try again
        </button>
      )}
    </div>
  )
}

export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="w-14 h-14 rounded-[14px] bg-[#F1F5F9] flex items-center justify-center mb-4">
        <SearchX size={22} className="text-[#475569]" />
      </div>
      <h2 className="text-[18px] font-semibold text-[#0F172A] mb-1">{what} not found</h2>
      <p className="text-sm text-[#475569] max-w-md">It may have been removed, or you may not have access.</p>
      <Link href={backHref} className={`${BTN.primary} mt-5`}>
        {backLabel}
      </Link>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-[#E2E8F0]/70 rounded-[8px] animate-pulse motion-reduce:animate-none ${className}`} />
}

/** One-line danger banner with the server's reason (kit §7.5). */
export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 break-words">{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-[#991B1B] hover:underline text-[13px] font-medium shrink-0">
          Close
        </button>
      )}
    </div>
  )
}

// ─── Save indicator ──────────────────────────────────────────────────────────

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function SaveIndicator({ state, error, onRetry }: { state: SaveState; error?: string | null; onRetry?: () => void }) {
  if (state === 'idle') return null
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[#475569]" aria-live="polite">
        <Loader2 size={12} className="animate-spin" /> Saving…
      </span>
    )
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[#15803D]" aria-live="polite">
        <CheckCircle2 size={12} /> Saved
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#B91C1C] min-w-0" role="alert">
      <AlertTriangle size={12} className="shrink-0" />
      <span className="truncate max-w-[260px]">{error || 'Not saved'}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline shrink-0">
          Retry
        </button>
      )}
    </span>
  )
}

// ─── Due ─────────────────────────────────────────────────────────────────────

/** "Due 2 days after it starts, at 6:00 PM" / "Due the day it starts, at 6:00 PM". */
export function describeDue(days: number | null | undefined, time: string | null | undefined): string {
  const d = typeof days === 'number' && days >= 0 ? days : 1
  const at = fmtTime(time || '18:00')
  return d === 0 ? `Due the day it starts, at ${at}` : `Due ${plural(d, 'day')} after it starts, at ${at}`
}

/** Short form for a collapsed card: "due in 2 days". */
export function shortDue(days: number | null | undefined): string {
  const d = typeof days === 'number' && days >= 0 ? days : 1
  return d === 0 ? 'due same day' : `due in ${plural(d, 'day')}`
}

// ─── How it starts ───────────────────────────────────────────────────────────

type ScheduleLike = Pick<
  WorkflowSchedule,
  'schedule_type' | 'every' | 'days' | 'month_days' | 'yearly_dates' | 'time' | 'start_date' | 'end_condition' | 'end_date' | 'end_after'
>

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * One schedule entry in plain words — "Every month on the 1st at 9:00 AM",
 * "Every 2 weeks on Mon and Thu at 10:00 AM, from 12 Oct 2026, 10 times",
 * "Once on 12 Oct 2026 at 9:00 AM".
 */
export function describeSchedule(e: ScheduleLike): string {
  const at = fmtTime(e.time)
  const every = Math.max(1, Number(e.every) || 1)
  const from = e.start_date && e.start_date > todayIso() ? `, from ${fmtIsoDate(e.start_date)}` : ''
  if (e.end_condition === 'after_n' && e.end_after === 1 && e.schedule_type === 'daily') {
    return `Once on ${fmtIsoDate(e.start_date)} at ${at}`
  }
  let what: string
  switch (e.schedule_type) {
    case 'daily':
      what = every === 1 ? 'Every day' : `Every ${every} days`
      break
    case 'weekly': {
      const days = [...(e.days ?? [])].sort((a, b) => a - b).map((d) => WEEKDAYS_SHORT[d] ?? '?')
      what = `${every === 1 ? 'Every week' : `Every ${every} weeks`} on ${days.length ? joinList(days) : '—'}`
      break
    }
    case 'monthly': {
      const days = [...(e.month_days ?? [])]
        .sort((a, b) => Math.abs(a) - Math.abs(b))
        .map((d) => (d < 0 ? `${ordinal(Math.abs(d))} (or the last day)` : ordinal(d)))
      what = `${every === 1 ? 'Every month' : `Every ${every} months`} on the ${days.length ? joinList(days) : '—'}`
      break
    }
    case 'yearly': {
      const dates = (e.yearly_dates ?? []).map((d) => `${d.day} ${MONTHS_LONG[d.month - 1] ?? ''}`.trim())
      what = `${every === 1 ? 'Every year' : `Every ${every} years`} on ${dates.length ? joinList(dates) : '—'}`
      break
    }
    default:
      what = 'On a schedule'
  }
  const until =
    e.end_condition === 'on_date' && e.end_date
      ? `, until ${fmtIsoDate(e.end_date)}`
      : e.end_condition === 'after_n' && e.end_after
        ? `, ${plural(e.end_after, 'time')}`
        : ''
  return `${what} at ${at}${from}${until}`
}

/**
 * "Manually · Every month on the 1st at 9:00 AM" — how a workflow starts, in one line.
 * A schedule that has run its course says so ("…, 3 times (finished)"); `manualNote`
 * follows "Manually" (e.g. that no one is chosen to start it yet).
 */
export function startsSummary(w: Pick<WorkflowTemplate, 'manual_start_enabled' | 'schedules'>, manualNote?: string): string {
  const parts: string[] = []
  if (w.manual_start_enabled !== false) parts.push(manualNote ? `Manually (${manualNote})` : 'Manually')
  for (const s of w.schedules ?? []) parts.push(`${describeSchedule(s)}${s.is_active === false ? ' (finished)' : ''}`)
  return parts.length ? parts.join(' · ') : 'Not set yet'
}

/**
 * The Start button for a workflow: hidden when it can't be started by hand at all
 * ("Manually" off, or archived); otherwise disabled until a definite yes, with the reason
 * (paused, a draft, not chosen under "Manually", or the org's preview mode).
 */
export function startGate(
  w: Pick<WorkflowTemplate, 'status' | 'manual_start_enabled' | 'capabilities'>,
  writable: boolean | undefined,
): { hidden: boolean; allowed: boolean | undefined; reason: string } {
  if (w.manual_start_enabled === false || w.status === 'archived') return { hidden: true, allowed: false, reason: '' }
  if (w.status === 'paused') return { hidden: false, allowed: false, reason: REASONS.startPaused }
  if (w.status === 'draft') return { hidden: false, allowed: false, reason: REASONS.startDraft }
  const caps = w.capabilities
  const permitted = caps ? (caps.is_starter ?? caps.can_trigger) : undefined
  return { hidden: false, ...gate(permitted, writable, REASONS.start) }
}
