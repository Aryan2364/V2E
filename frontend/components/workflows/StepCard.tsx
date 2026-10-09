'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, GitBranch, GitMerge, Link2, ListPlus, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import ChecklistBuilderField, { type ChecklistGroup } from '@/components/tasks/ChecklistBuilderField'
import ProofRequirementField from '@/components/tasks/ProofRequirementField'
import TagPicker from '@/components/tasks/TagPicker'
import EmployeePicker, { type EmployeePickerOption } from '@/components/ui/EmployeePicker'
import MultiSelect from '@/components/ui/MultiSelect'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/Tooltip'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { workflowErrorMessage } from '@/lib/api/workflows'
import type { CompletionMode, SelectedAssignee } from '@/lib/types/tasks'
import type { ChecklistItem, DueRule, EscalationMode, IfLate, StartRule, StepInput, WorkflowStep } from '@/lib/types/workflows'
import ActionMenu from './ActionMenu'
import type { WorkflowLookups } from './useWorkflowLookups'
import { BTN, ErrorBanner, InfoTip, Reveal } from './shared'
import StepTiming from './StepTiming'
import {
  DEFAULT_DUE_RULE,
  DEFAULT_START_RULE,
  cleanRule,
  dueRuleOf,
  startRuleOf,
  timingProblems,
  timingSummary,
  type Frequency,
  type RunStart,
  type ScheduleShape,
} from './timing'
import { anchorFor, orderProblemOf, stepNextCycle, type NamedStep, type PlanContext, type PlannedDates } from './timingPlan'
import { predecessorName } from './timing'

/** The sample run's plan (timingPlan.ts): the timing calendar, its greyed days and Save's order check. */
export interface StepPlanInput {
  ctx: PlanContext
  /** Every step's planned dates in that run. */
  planned: Map<string, PlannedDates>
  /** Every step in display order: its number and title (the calendar's bands, the order messages). */
  names: NamedStep[]
}

export const INPUT_CLS =
  'w-full px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#334155] disabled:cursor-not-allowed'
export const LABEL_CLS = 'block text-sm font-medium text-[#374151] mb-2'
const SUB_LABEL = 'block text-[13px] font-medium text-[#374151] mb-1.5'
const HELP = 'text-[13px] text-[#475569]'

/** Same limit as a task title — a step becomes a task. */
export const STEP_TITLE_MAX = 50
const MAX_ESCALATION = 5

// ─── Draft model ─────────────────────────────────────────────────────────────

export interface StepDraft {
  title: string
  description: string
  /** Assignees and CCs together, as the task form's picker holds them. */
  assignees: SelectedAssignee[]
  completion_mode: CompletionMode
  /** When it starts and when it is due (relative due rules are mirrored to due_days / due_time). */
  start_rule: StartRule
  due_rule: DueRule
  /** "Also waits for": steps on other paths (tracks). */
  merge_step_ids: string[]
  if_late: IfLate
  escalation_mode: EscalationMode
  escalation_user_ids: string[]
  priority_id: string
  category_id: string
  tag_ids: string[]
  checklist_items: ChecklistItem[]
  proof_required: boolean
  proof_allowed_extensions: string[]
}

type DraftKey = keyof StepDraft

function normItems(items: ChecklistItem[] | null | undefined): ChecklistItem[] {
  return (Array.isArray(items) ? items : [])
    .filter((c) => c && typeof c.title === 'string' && c.title.trim())
    .map((c) => ({
      title: c.title,
      ...(c.group_title ? { group_title: c.group_title } : {}),
      ...(c.template_id ? { template_id: c.template_id } : {}),
    }))
}

let groupSeq = 0
const nextGroupKey = () => `sg${(groupSeq += 1)}`

/** Step items → the checklist builder's groups (linked template groups stay whole). */
function itemsToGroups(items: ChecklistItem[], templateName: (id: string) => string | undefined): ChecklistGroup[] {
  const groups: ChecklistGroup[] = []
  for (const it of items) {
    const heading = it.group_title?.trim() || ''
    const tid = it.template_id || undefined
    const last = groups[groups.length - 1]
    const joins = last && last.templateId === tid && (tid ? true : last.title === heading || (!heading && !last.keepLabel))
    if (joins) {
      last.items.push({ title: it.title })
    } else {
      groups.push({
        key: nextGroupKey(),
        title: tid ? heading || templateName(tid) || 'Checklist template' : heading || 'Checklist',
        source: tid ? 'template' : 'custom',
        templateId: tid,
        keepLabel: !tid && !!heading,
        items: [{ title: it.title }],
        draft: '',
      })
    }
  }
  return groups
}

function groupsToItems(groups: ChecklistGroup[]): ChecklistItem[] {
  const filled = groups.filter((g) => g.items.length > 0)
  const multiple = filled.length >= 2
  return filled.flatMap((g) => {
    const labelled = multiple || g.source === 'template' || g.keepLabel === true
    const heading = labelled ? g.title.trim() || 'Checklist' : ''
    return g.items.map((i) => ({
      title: i.title,
      ...(heading ? { group_title: heading } : {}),
      ...(g.source === 'template' && g.templateId ? { template_id: g.templateId } : {}),
    }))
  })
}

function keepKeys(next: ChecklistGroup[], prev: ChecklistGroup[]): ChecklistGroup[] {
  return next.map((g, i) => {
    const p = prev[i]
    return p && p.source === g.source && p.templateId === g.templateId ? { ...g, key: p.key, draft: p.draft } : g
  })
}

function fromStep(s: WorkflowStep, nameOf: (id: string) => string | undefined): StepDraft {
  const named = new Map([...(s.assignees ?? []), ...(s.ccs ?? [])].map((p) => [p.id, p.name]))
  const person = (id: string, cc: boolean): SelectedAssignee => ({ user_id: id, name: named.get(id) ?? nameOf(id) ?? 'Someone no longer active', is_cc: cc })
  return {
    title: s.title ?? '',
    description: s.description ?? '',
    assignees: [...(s.assignee_user_ids ?? []).map((id) => person(id, false)), ...(s.cc_user_ids ?? []).map((id) => person(id, true))],
    completion_mode: s.completion_mode ?? 'any_can_complete',
    start_rule: startRuleOf(s),
    due_rule: dueRuleOf(s),
    merge_step_ids: s.merge_step_ids ?? [],
    if_late: s.if_late === 'move_on' ? 'move_on' : 'wait',
    escalation_mode: s.escalation_mode === 'people' ? 'people' : 'manager',
    escalation_user_ids: s.escalation_user_ids ?? [],
    priority_id: s.priority_id ?? '',
    category_id: s.category_id ?? '',
    tag_ids: s.tag_ids ?? [],
    checklist_items: normItems(s.checklist_items),
    proof_required: !!s.proof_required,
    proof_allowed_extensions: s.proof_allowed_extensions ?? [],
  }
}

export function blankStepDraft(me?: { user_id: string; name: string }): StepDraft {
  return {
    title: '',
    description: '',
    assignees: me ? [{ user_id: me.user_id, name: me.name, is_cc: false }] : [],
    completion_mode: 'any_can_complete',
    start_rule: DEFAULT_START_RULE,
    due_rule: DEFAULT_DUE_RULE,
    merge_step_ids: [],
    if_late: 'wait',
    escalation_mode: 'manager',
    escalation_user_ids: [],
    priority_id: '',
    category_id: '',
    tag_ids: [],
    checklist_items: [],
    proof_required: false,
    proof_allowed_extensions: [],
  }
}

/** Draft fields → API fields. */
function toInput(patch: Partial<StepDraft>): StepInput {
  const out: StepInput = {}
  for (const [k, v] of Object.entries(patch) as [DraftKey, StepDraft[DraftKey]][]) {
    switch (k) {
      case 'title':
        out.title = (v as string).trim()
        break
      case 'description':
        out.description = (v as string).trim() || null
        break
      case 'assignees': {
        const list = v as SelectedAssignee[]
        out.assignee_user_ids = list.filter((a) => !a.is_cc).map((a) => a.user_id)
        out.cc_user_ids = list.filter((a) => a.is_cc).map((a) => a.user_id)
        break
      }
      case 'start_rule':
        out.start_rule = cleanRule(v as StartRule)
        break
      case 'due_rule': {
        const r = cleanRule(v as DueRule)
        out.due_rule = r
        // Older readers still use due_days / due_time for a relative due.
        if (r.kind === 'days_after_start') {
          out.due_days = typeof r.days === 'number' ? r.days : 1
          out.due_time = r.time || '18:00'
        }
        break
      }
      case 'priority_id':
      case 'category_id':
        out[k] = (v as string) || null
        break
      case 'checklist_items':
        out.checklist_items = normItems(v as ChecklistItem[])
        break
      case 'escalation_user_ids':
        out.escalation_user_ids = (v as string[]).filter(Boolean)
        break
      default:
        ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ─── Small pieces ────────────────────────────────────────────────────────────

const IF_LATE: ChoiceOption<IfLate>[] = [
  { value: 'wait', label: 'Wait', tip: 'Next steps start only after this one is done.' },
  { value: 'move_on', label: 'Continue', tip: 'Next steps start anyway. This task stays open.' },
]

const ESCALATION: ChoiceOption<EscalationMode>[] = [
  { value: 'manager', label: 'Reporting manager', tip: 'If someone has no manager, the editors are alerted.' },
  { value: 'people', label: 'Specific people', tip: 'Level 1 is alerted first, the next level 1 hour later.' },
]

interface ChoiceOption<V extends string> {
  value: V
  label: string
  /** The option's explanation, behind its ⓘ. */
  tip?: string
}

/**
 * Two or three plain choices as one radio group of cards. Each card is its radio button;
 * its ⓘ sits beside it in the card (never inside the button), so it can be read without
 * choosing the option.
 */
function ChoiceCards<V extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string
  value: V
  options: ChoiceOption<V>[]
  onChange: (v: V) => void
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((o) => {
        const on = value === o.value
        return (
          <div
            key={o.value}
            className={`relative flex items-center rounded-[10px] border transition-colors ${
              on ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#CBD5E1] bg-white hover:bg-[#F8FAFC]'
            }`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange(o.value)}
              className={`flex-1 min-w-0 flex items-center gap-2 text-left rounded-[10px] pl-3 py-2.5 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-not-allowed ${
                o.tip ? 'pr-1' : 'pr-3'
              }`}
            >
              <span
                aria-hidden
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'border-[#2563EB]' : 'border-[#94A3B8]'}`}
              >
                {on && <span className="w-2 h-2 rounded-full bg-[#2563EB]" />}
              </span>
              <span className={`text-sm font-semibold ${on ? 'text-[#1D4ED8]' : 'text-[#0F172A]'}`}>{o.label}</span>
            </button>
            {o.tip && <InfoTip label={o.label} text={o.tip} className="mr-2.5" />}
          </div>
        )
      })}
    </div>
  )
}

export function IconAction({
  label,
  icon: Icon,
  onClick,
  allowed,
  reason,
  disabled,
  danger,
}: {
  label: string
  icon: typeof Trash2
  onClick: () => void
  allowed: boolean | undefined
  reason: string
  disabled?: boolean
  danger?: boolean
}) {
  const btn = (
    <button
      type="button"
      aria-label={label}
      disabled={allowed !== true || disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-[8px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:cursor-not-allowed ${
        danger ? 'text-[#475569] hover:text-[#B91C1C] hover:bg-[#FEF2F2]' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9]'
      }`}
    >
      <Icon size={16} />
    </button>
  )
  if (allowed === false) return <PermissionTooltip allowed={false} reason={reason}>{btn}</PermissionTooltip>
  return <Tooltip label={disabled ? '' : label}>{btn}</Tooltip>
}

/**
 * A chosen "Also waits for" step. One it already waits for through its path (a merge saved
 * before that was spotted) is muted and says so; it is left out when the workflow is saved.
 */
function MergeChip({ label, redundant, onRemove, disabled }: { label: string; redundant: boolean; onRemove: () => void; disabled?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 max-w-full rounded-[6px] border pl-2 pr-1 py-0.5 text-[13px] ${
        redundant ? 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]' : 'border-[#BFDBFE] bg-[#EFF6FF] font-medium text-[#1D4ED8]'
      }`}
    >
      <span className="truncate">
        {redundant ? (
          <>
            <span className="font-medium text-[#334155]">{label}</span> · Already waits for this through After
          </>
        ) : (
          label
        )}
      </span>
      {/* Inside the field: must not re-open its list. */}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={`shrink-0 w-4 h-4 rounded-[4px] flex items-center justify-center cursor-pointer disabled:cursor-not-allowed ${
          redundant ? 'text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A]' : 'text-[#2563EB] hover:bg-[#DBEAFE] hover:text-[#1D4ED8]'
        }`}
      >
        <X size={11} />
      </button>
    </span>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

/** A step another one may also wait for. */
export interface MergeOption {
  value: string
  /** "B2 “Finance sign-off”". */
  label: string
}

interface CommonProps {
  orgId: string
  /** The step's number shown in the badge ("1", "B2"). */
  label: string
  editable: boolean | undefined
  reason: string
  lookups: WorkflowLookups
  /**
   * What the step comes after, only where that is not obvious: the first step of a
   * parallel path ("Step 1 “Raise request”", or "Start of run"). Null hides the row (the
   * main path's first step, and any step after the previous one in its own path).
   */
  placement: string | null
  /** Whether it waits for a step (the one before it in its track, or the step its track splits from). */
  hasPredecessors: boolean
  /** Steps in other tracks it may also wait for (none that would make a loop). */
  mergeOptions: MergeOption[]
  /** Every step's number ("1", "B2") — for the summary line. */
  labels: Map<string, string>
  currentUser?: { user_id: string; name: string }
  /** How the workflow repeats, from the schedules being edited (decides the timing choices). */
  frequency: Frequency
  /** The schedules being edited (timing defaults follow them). */
  schedules: ScheduleShape[]
  /** Where runs start in their cycle (a first step can't be timed before it). */
  runStart?: RunStart | null
  /** The steps it waits for through its path (before its own "Also waits for"). */
  baseDeps?: string[]
  /** The representative run's plan, for the "(next month)" marks. */
  plan?: StepPlanInput | null
  /**
   * What it already waits for through its path order or split point. A saved "Also waits
   * for" on one of these adds nothing: its chip says so, and it isn't saved.
   */
  upstream?: Set<string>
}

interface EditProps extends CommonProps {
  mode: 'edit'
  step: WorkflowStep
  expanded: boolean
  onToggle: () => void
  /** Apply these fields to the workflow being edited (nothing is sent until it is saved). */
  onUpdate: (stepId: string, input: StepInput) => void
  onDelete: (step: WorkflowStep) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  moving?: boolean
  onAddBelow?: () => void
  /** "Add parallel path": start a new track after this step. */
  onSplit?: () => void
  /** A problem to show on this card (e.g. why the workflow could not be saved). */
  issue?: string | null
}

interface CreateProps extends CommonProps {
  mode: 'create'
  initial: StepDraft
  onCreate: (input: StepInput) => Promise<void>
  onCancel: () => void
  /** Badge text instead of the number (a step being inserted between others). */
  badgeLabel?: string
  /** Each new value focuses the title (the builder brings the form into view). */
  focusKey?: string | number
  /**
   * Filled in by the form: "add what is filled in, now" — so asking for another form
   * elsewhere adds this one first instead of throwing it away.
   */
  commitRef?: React.MutableRefObject<CommitNewStep | null>
}

/**
 * Add an open new-step form's step without its button: the step to add, 'blank' when no
 * title has been typed (nothing worth keeping), or 'invalid' when it cannot be added as it
 * is (the form then shows why).
 */
export type CommitNewStep = () => StepInput | 'blank' | 'invalid'

/**
 * One step — a task the system creates. The same form adds a step and edits it. In edit
 * mode every change goes straight into the workflow being edited; nothing is sent until
 * the workflow is saved. The essentials show first; the rest sit under "More options".
 */
export default function StepCard(props: EditProps | CreateProps) {
  const { orgId, label, editable, reason, lookups, placement, hasPredecessors, mergeOptions, labels, currentUser, frequency, schedules } = props
  const isEdit = props.mode === 'edit'
  const step = isEdit ? (props as EditProps).step : null
  const idPrefix = `step-${step?.id ?? 'new'}`
  const disabled = editable !== true

  const memberName = useCallback((id: string) => lookups.members.find((m) => m.user_id === id)?.name, [lookups.members])

  const [draft, setDraft] = useState<StepDraft>(() => (step ? fromStep(step, memberName) : (props as CreateProps).initial))
  const [titleError, setTitleError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [escRows, setEscRows] = useState<string[]>(() => (draft.escalation_user_ids.length ? draft.escalation_user_ids : ['']))
  const [escError, setEscError] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)

  // "More options" opens by itself when something in it is already set.
  const extrasSet =
    (draft.description.trim() ? 1 : 0) +
    (draft.priority_id ? 1 : 0) +
    (draft.category_id ? 1 : 0) +
    (draft.tag_ids.length ? 1 : 0) +
    (draft.checklist_items.length ? 1 : 0) +
    (draft.proof_required ? 1 : 0) +
    (draft.assignees.filter((a) => !a.is_cc).length > 1 && draft.completion_mode === 'all_must_complete' ? 1 : 0)
  const [moreOpen, setMoreOpen] = useState(false)

  // Checklist builder works on groups; the step stores a flat list.
  const templateName = (tid: string) =>
    step?.checklist_template_status?.find((t) => t.template_id === tid)?.name ?? lookups.checklistTemplates.find((t) => t.id === tid)?.name
  const [groups, setGroups] = useState<ChecklistGroup[]>(() => itemsToGroups(draft.checklist_items, templateName))
  useEffect(() => {
    setGroups((cur) => (same(groupsToItems(cur), draft.checklist_items) ? cur : keepKeys(itemsToGroups(draft.checklist_items, templateName), cur)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.checklist_items])

  // A form that has just opened: focus its title without moving the page — the builder
  // holds the clicked spot while the other cards fold, then scrolls only as far as needed.
  const focusKey = props.mode === 'create' ? (props as CreateProps).focusKey : undefined
  useEffect(() => {
    if (focusKey === undefined) return
    document.getElementById(`${idPrefix}-title`)?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  // A fresh server copy (after the workflow is saved) replaces the form.
  useEffect(() => {
    if (!step) return
    const server = fromStep(step, memberName)
    setDraft(server)
    setEscRows(server.escalation_user_ids.length ? server.escalation_user_ids : [''])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id, step?.updated_at])

  const update = (patch: Partial<StepDraft>) => setDraft((d) => ({ ...d, ...patch }))

  /** Apply fields to the workflow being edited (edit mode). */
  const emit = (patch: Partial<StepDraft>) => {
    if (props.mode === 'edit' && step) (props as EditProps).onUpdate(step.id, toInput(patch))
  }

  const change = (patch: Partial<StepDraft>) => {
    update(patch)
    emit(patch)
  }

  // ── Typed text: applied as it is typed ──
  const typeText = (patch: Partial<Pick<StepDraft, 'title' | 'description'>>) => {
    update(patch)
    if ('title' in patch && patch.title?.trim()) {
      setTitleError(null)
      setCreateError(null)
    }
    emit(patch)
  }

  // ── Assignees ──
  const setAssignees = (list: SelectedAssignee[]) => {
    const main = list.filter((a) => !a.is_cc).length
    const patch: Partial<StepDraft> = { assignees: list }
    if (main <= 1 && draft.completion_mode !== 'any_can_complete') patch.completion_mode = 'any_can_complete'
    change(patch)
  }

  // ── Escalation ──
  const setEscalationMode = (m: EscalationMode) => {
    setEscError(null)
    if (m === 'manager') return change({ escalation_mode: 'manager' })
    change({ escalation_mode: 'people', escalation_user_ids: escRows.filter(Boolean) })
  }
  const emitEscRows = (rows: string[]) => {
    setEscRows(rows)
    change({ escalation_mode: 'people', escalation_user_ids: rows.filter(Boolean) })
  }
  const setEscLevel = (i: number, uid: string) => {
    setEscError(null)
    const dupe = escRows.findIndex((r, j) => r === uid && j !== i)
    if (uid && dupe >= 0) return setEscError(`That person is already level ${dupe + 1}.`)
    const next = [...escRows]
    next[i] = uid
    emitEscRows(next)
  }

  // ── Checklist ──
  const changeGroups = (next: ChecklistGroup[]) => {
    setGroups(next)
    const items = groupsToItems(next)
    if (same(items, draft.checklist_items)) return
    change({ checklist_items: items })
  }

  const templateNote = (g: ChecklistGroup) => {
    if (g.source !== 'template' || !g.templateId) return null
    const st = step?.checklist_template_status?.find((t) => t.template_id === g.templateId)
    const offered = lookups.checklistTemplates.some((t) => t.id === g.templateId)
    const unavailable = st ? !st.active : !offered && lookups.status !== 'loading'
    if (unavailable) {
      return (
        <p className="flex items-start gap-1.5 text-[13px] text-[#92400E]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Template no longer available. Instances use the saved copy.</span>
        </p>
      )
    }
    return (
      <p className="flex items-start gap-1.5 text-[13px] text-[#475569]">
        <Link2 size={14} className="shrink-0 mt-0.5 text-[#1D4ED8]" />
        <span>
          Linked. New instances use its latest items.
          {st?.accessible === false ? ' You can’t add this template, so it can’t be re-added once removed.' : ''}
        </span>
      </p>
    )
  }

  // ── Create ──
  /** The step to add from this draft, or null after showing why it cannot be added. */
  function checkedInput(d: StepDraft, focusTitle: boolean): StepInput | null {
    if (!d.title.trim()) {
      setTitleError('Enter a step title.')
      if (focusTitle) document.getElementById(`${idPrefix}-title`)?.focus()
      return null
    }
    if (d.escalation_mode === 'people' && !d.escalation_user_ids.filter(Boolean).length) {
      setCreateError('Add someone to escalate to, or choose “Reporting manager”.')
      return null
    }
    return toInput({ ...d, escalation_user_ids: d.escalation_mode === 'people' ? d.escalation_user_ids : [] })
  }

  // "Add what is filled in, now" for the builder — always from the latest draft.
  const commitRef = props.mode === 'create' ? (props as CreateProps).commitRef : undefined
  useEffect(() => {
    if (!commitRef) return
    const commit: CommitNewStep = () => {
      if (creating) return 'invalid'
      if (!draft.title.trim()) return 'blank'
      return checkedInput(draft, false) ?? 'invalid'
    }
    commitRef.current = commit
    return () => {
      if (commitRef.current === commit) commitRef.current = null
    }
  })

  async function submitCreate() {
    if (props.mode !== 'create') return
    const input = checkedInput(draft, true)
    if (!input) return
    setCreating(true)
    setCreateError(null)
    try {
      await props.onCreate(input)
    } catch (e) {
      setCreateError(workflowErrorMessage(e, 'The step could not be added. Try again.'))
      setCreating(false)
    }
  }

  // ── Options ──
  // "Also waits for": a step already picked stays listed even when it is no longer
  // offered (saving says why); new picks come from the offered steps.
  const mergeValues = draft.merge_step_ids.filter((id) => labels.has(id) || mergeOptions.some((o) => o.value === id))
  const mergeSelectOptions: MergeOption[] = [
    ...mergeOptions,
    ...mergeValues.filter((id) => !mergeOptions.some((o) => o.value === id)).map((id) => ({ value: id, label: labels.get(id) ?? '?' })),
  ]
  const [mergeOpen, setMergeOpen] = useState(false)
  const showMerge = mergeOpen || mergeValues.length > 0
  const waits = hasPredecessors || mergeValues.length > 0
  const mainAssignees = draft.assignees.filter((a) => !a.is_cc)
  // Escalation contacts: department + role shown (and grouped) so two people with the
  // same name can be told apart; the step's own assignees are left out — escalating to
  // someone doing the work makes no sense (same rule as the task form).
  const assigneeIdSet = new Set(mainAssignees.map((a) => a.user_id))
  const memberOptions: EmployeePickerOption[] = lookups.members
    .map((m) => {
      const d = lookups.memberDetails.get(m.user_id)
      return { user_id: m.user_id, name: m.name, role_title: d?.role_title ?? null, department_name: d?.department_name ?? null }
    })
  // A first step (waits for nothing) is timed on or after the run start, in its cycle.
  const firstRunStart = waits ? null : props.runStart ?? null
  // Where it sits in the sample run: when it may start (the run start, or the latest due of
  // the steps it waits for), every step's dates, and what it waits for — the calendar.
  const plan = props.plan ?? null
  const depsKey = Array.from(new Set([...(props.baseDeps ?? []), ...mergeValues])).join(',')
  const selfId = step?.id ?? null
  const position = useMemo(() => {
    if (!plan) return null
    const deps = depsKey ? depsKey.split(',') : []
    return { ctx: plan.ctx, anchor: anchorFor(deps, plan.planned, plan.ctx), planned: plan.planned, names: plan.names, deps, selfId }
  }, [plan, depsKey, selfId])
  // Save's checks, in its order: the timing itself, then (when that is fine) an explicit
  // day before the step it waits for is due, or a due day before its own start.
  const problems = useMemo(() => {
    const own = timingProblems(draft.start_rule, draft.due_rule, frequency, { first: !waits, runStart: props.runStart ?? null })
    if (own.length || !position) return own
    const byId = new Map(position.names.map((n) => [n.id, n]))
    const order = orderProblemOf(
      { id: selfId ?? '__new__', deps: position.deps, start: draft.start_rule, due: draft.due_rule },
      position.planned,
      position.ctx,
      (id) => predecessorName(byId.get(id)?.label ?? '?', byId.get(id)?.title),
    )
    return order ? [order] : own
  }, [draft.start_rule, draft.due_rule, frequency, waits, props.runStart, position, selfId])
  const nextFlags = useMemo(
    () => (position ? stepNextCycle(draft.start_rule, draft.due_rule, position.anchor, position.ctx) : null),
    [position, draft.start_rule, draft.due_rule],
  )

  const alsoText = mergeValues.length ? `also waits for ${mergeValues.map((id) => labels.get(id) ?? '?').join(', ')}` : ''
  const assigneeText = mainAssignees.length
    ? mainAssignees.length > 2
      ? `${mainAssignees.slice(0, 2).map((a) => a.name).join(', ')} +${mainAssignees.length - 2}`
      : mainAssignees.map((a) => a.name).join(', ')
    : 'No one assigned'

  const expanded = isEdit ? (props as EditProps).expanded : true
  const issue = isEdit ? (props as EditProps).issue : null
  const createBadge = props.mode === 'create' ? (props as CreateProps).badgeLabel : undefined

  // ── Render ──
  const fields = (
    <div className="flex flex-col gap-6 p-4 sm:p-5">
      {issue && <ErrorBanner message={issue} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-6">
        {/* Title */}
        <div className="lg:col-span-7">
          <label htmlFor={`${idPrefix}-title`} className={LABEL_CLS}>
            Step title <span className="text-[#DC2626]">*</span>
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-title`}
              value={draft.title}
              maxLength={STEP_TITLE_MAX}
              disabled={disabled || creating}
              aria-invalid={!!titleError}
              onChange={(e) => typeText({ title: e.target.value })}
              onBlur={() => isEdit && !draft.title.trim() && setTitleError('Enter a step title.')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isEdit) {
                  e.preventDefault()
                  submitCreate()
                }
              }}
              placeholder="e.g. Collect signed offer letter"
              className={`${INPUT_CLS} pr-14 ${titleError ? '!border-[#DC2626]' : ''}`}
            />
            <span
              className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] tabular-nums ${
                draft.title.length >= STEP_TITLE_MAX ? 'text-[#B91C1C]' : 'text-[#475569]'
              }`}
            >
              {draft.title.length}/{STEP_TITLE_MAX}
            </span>
          </div>
          {titleError && <p className="mt-1.5 text-[13px] text-[#B91C1C]">{titleError}</p>}
        </div>

        {/* Assigned to */}
        <div className="lg:col-span-12">
          <span className={LABEL_CLS}>
            Assigned to <span className="text-[#DC2626]">*</span>{' '}
            <InfoTip label="Assigned to" text="Click a badge to switch assignee and CC. CCs only follow along." />
          </span>
          <fieldset disabled={disabled || creating} className="min-w-0 border-0 p-0 m-0">
            <AssigneeSelector orgId={orgId} value={draft.assignees} onChange={setAssignees} disabled={disabled || creating} currentUser={currentUser} />
          </fieldset>
        </div>

        {/* Timing: where it sits, "Also waits for", when it starts, and when it is due */}
        <div className="lg:col-span-12">
          <StepTiming
            idPrefix={idPrefix}
            start={draft.start_rule}
            due={draft.due_rule}
            frequency={frequency}
            schedules={schedules}
            hasPredecessors={waits}
            disabled={disabled || creating}
            onChange={(patch) => change(patch)}
            problems={problems}
            runStart={firstRunStart}
            position={position}
            startsAfter={
              placement || showMerge || (mergeOptions.length > 0 && !disabled) ? (
              <div className="flex flex-col gap-3">
                {placement && (
                  <div>
                    <span className={LABEL_CLS}>After</span>
                    <p className="text-sm text-[#1E293B]">{placement}</p>
                  </div>
                )}
                {showMerge ? (
                  <Reveal open appear={mergeValues.length === 0}>
                    <div>
                      <span className={LABEL_CLS}>
                        <span id={`${idPrefix}-merge-label`}>Also waits for</span>{' '}
                        <InfoTip label="Also waits for" text="This step also waits for steps on other paths. Use to wait for a step on another path." />
                      </span>
                      <div aria-labelledby={`${idPrefix}-merge-label`}>
                        <MultiSelect
                          value={mergeValues}
                          onChange={(ids) => change({ merge_step_ids: ids })}
                          options={mergeSelectOptions}
                          disabled={disabled || creating || mergeSelectOptions.length === 0}
                          placeholder={mergeSelectOptions.length ? 'Choose steps' : 'No steps on other paths'}
                          searchPlaceholder="Search steps"
                          emptyText="No steps match"
                          renderChip={(o, remove) => (
                            <MergeChip label={o.label} redundant={!!props.upstream?.has(o.value)} onRemove={remove} disabled={disabled || creating} />
                          )}
                        />
                      </div>
                    </div>
                  </Reveal>
                ) : mergeOptions.length > 0 && !disabled ? (
                  <button type="button" onClick={() => setMergeOpen(true)} disabled={creating} className={`${BTN.quiet} self-start -ml-2`}>
                    <GitMerge size={16} /> Also waits for
                  </button>
                ) : null}
              </div>
              ) : null
            }
          />
        </div>

        {/* If late */}
        <div className="lg:col-span-6">
          <span className={LABEL_CLS}>
            If late <InfoTip label="If late" text="Editors and escalation contacts are alerted either way." />
          </span>
          <ChoiceCards name="If late" value={draft.if_late} options={IF_LATE} onChange={(v) => change({ if_late: v })} disabled={disabled || creating} />
        </div>

        {/* Escalate to */}
        <div className="lg:col-span-6 flex flex-col gap-2">
          <span className={LABEL_CLS + ' !mb-0'}>
            Escalate to <InfoTip label="Escalate to" text="Alerted when this step is late." />
          </span>
          <ChoiceCards name="Escalate to" value={draft.escalation_mode} options={ESCALATION} onChange={setEscalationMode} disabled={disabled || creating} />
          {draft.escalation_mode === 'manager' && step?.escalation_contacts && step.escalation_contacts.length > 0 && (
            <p className={HELP}>
              Currently: <span className="text-[#0F172A] font-medium">{step.escalation_contacts.map((p) => p.name).join(', ')}</span>
              {step.escalation_resolved_from === 'owners_fallback' ? ' (editors, no manager set)' : ''}
            </p>
          )}
          {draft.escalation_mode === 'people' && (
            <Reveal open appear>
              <div className="flex flex-col gap-2">
                {escRows.map((uid, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0 w-16 text-[13px] font-medium text-[#334155]">Level {i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <EmployeePicker
                        value={uid}
                        onChange={(v) => setEscLevel(i, v)}
                        employees={memberOptions.filter((m) => m.user_id === uid || (!escRows.includes(m.user_id) && !assigneeIdSet.has(m.user_id)))}
                        title={`Escalate to (level ${i + 1})`}
                        placeholder={lookups.status === 'loading' ? 'Loading people…' : 'Choose a person'}
                        disabled={disabled || creating}
                      />
                    </div>
                    <IconAction
                      label={`Remove level ${i + 1}`}
                      icon={X}
                      allowed={editable}
                      reason={reason}
                      disabled={creating || (escRows.length === 1 && !uid)}
                      onClick={() => emitEscRows(escRows.length === 1 ? [''] : escRows.filter((_, j) => j !== i))}
                    />
                  </div>
                ))}
                {escRows.length < MAX_ESCALATION && !disabled && (
                  <button type="button" onClick={() => setEscRows((r) => [...r, ''])} className={`${BTN.quiet} self-start`}>
                    <Plus size={16} /> Add level
                  </button>
                )}
                {escError && <p className="text-[13px] text-[#B91C1C]">{escError}</p>}
              </div>
            </Reveal>
          )}
        </div>
      </div>

      {/* More options */}
      <div className="border-t border-[#F1F5F9] pt-4">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={`${idPrefix}-more`}
          onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[36px] px-2 -mx-2 rounded-[8px] text-sm font-semibold text-[#1D4ED8] hover:bg-[#EFF6FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <SlidersHorizontal size={16} />
          More options
          {extrasSet > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold flex items-center justify-center">
              {extrasSet}
            </span>
          )}
          <ChevronDown size={16} className={`transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
        </button>

        <Reveal open={moreOpen} id={`${idPrefix}-more`}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-6 pt-4">
            <div className="lg:col-span-12">
              <label htmlFor={`${idPrefix}-desc`} className={LABEL_CLS}>
                Description
              </label>
              <textarea
                id={`${idPrefix}-desc`}
                rows={3}
                maxLength={2000}
                value={draft.description}
                disabled={disabled || creating}
                onChange={(e) => typeText({ description: e.target.value })}
                placeholder="What needs to be done"
                className={`${INPUT_CLS} resize-y`}
              />
            </div>

            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className={SUB_LABEL}>Priority</span>
                <StyledSelect
                  value={draft.priority_id}
                  onChange={(v) => change({ priority_id: v })}
                  options={[
                    { value: '', label: 'Default' },
                    ...lookups.priorities.filter((p) => p.is_active !== false || p.id === draft.priority_id).map((p) => ({ value: p.id, label: p.label, color: p.color })),
                  ]}
                  disabled={disabled || creating}
                />
              </div>
              <div>
                <span className={SUB_LABEL}>Category</span>
                <StyledSelect
                  value={draft.category_id}
                  onChange={(v) => change({ category_id: v })}
                  options={[
                    { value: '', label: 'No category' },
                    ...lookups.categories.filter((c) => c.is_active !== false || c.id === draft.category_id).map((c) => ({ value: c.id, label: c.name, color: c.color })),
                  ]}
                  disabled={disabled || creating}
                />
              </div>
            </div>

            <div className="lg:col-span-6">
              <span className={SUB_LABEL}>Tags</span>
              <TagPicker orgId={orgId} value={draft.tag_ids} onChange={(ids) => change({ tag_ids: ids })} disabled={disabled || creating} knownTags={step?.tags} />
            </div>

            {mainAssignees.length > 1 && (
              <div className="lg:col-span-12">
                <span className={SUB_LABEL}>Who completes it</span>
                <ChoiceCards
                  name="Who completes it"
                  value={draft.completion_mode}
                  options={[
                    { value: 'any_can_complete', label: 'Anyone', tip: 'Done when one person completes it.' },
                    { value: 'all_must_complete', label: 'Everyone', tip: 'Done when everyone completes their part.' },
                  ]}
                  onChange={(v) => change({ completion_mode: v })}
                  disabled={disabled || creating}
                />
              </div>
            )}

            <div className="lg:col-span-12">
              <fieldset disabled={disabled || creating} className="min-w-0 border-0 p-0 m-0">
                <ProofRequirementField
                  proofRequired={draft.proof_required}
                  onProofRequiredChange={(v) => change({ proof_required: v })}
                  allowedExtensions={draft.proof_allowed_extensions}
                  onAllowedExtensionsChange={(exts) => change({ proof_allowed_extensions: exts })}
                />
              </fieldset>
            </div>

            <div className="lg:col-span-12">
              <ChecklistBuilderField
                variant="inline"
                linkedTemplates
                readOnly={disabled || creating}
                groups={groups}
                onChange={changeGroups}
                templates={lookups.checklistTemplates}
                groupNote={templateNote}
                intro="Use a template, your own items, or both."
              />
            </div>
          </div>
        </Reveal>
      </div>

      {props.mode === 'create' && (
        <>
          {createError && <ErrorBanner message={createError} />}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-[#F1F5F9]">
            <button type="button" onClick={props.onCancel} disabled={creating} className={BTN.quiet}>
              Cancel
            </button>
            <button type="button" onClick={submitCreate} disabled={creating || disabled} className={BTN.primary}>
              <Plus size={16} />
              {creating ? 'Adding…' : 'Add step'}
            </button>
          </div>
        </>
      )}
    </div>
  )

  const edit = isEdit ? (props as EditProps) : null
  const hasProblem = !!issue || problems.length > 0 || (isEdit && (!draft.title.trim() || mainAssignees.length === 0))

  return (
    <Reveal open appear={props.mode === 'create'}>
      <div
        ref={rootRef}
        className={`bg-white border rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] scroll-mt-40 scroll-mb-24 ${
          props.mode === 'create' ? 'border-[#93C5FD] ring-1 ring-[#BFDBFE]' : issue ? 'border-[#FCA5A5] ring-1 ring-[#FECACA]' : 'border-[#E2E8F0]'
        }`}
      >
        {/* Header — the whole row toggles the card */}
        <div
          className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 ${expanded ? 'border-b border-[#E2E8F0]' : ''} ${edit ? 'cursor-pointer' : ''}`}
          onClick={edit ? edit.onToggle : undefined}
        >
          <span className="min-w-[28px] h-7 px-1.5 rounded-full text-[12px] font-semibold flex items-center justify-center shrink-0 bg-[#2563EB] text-white">
            {props.mode === 'create' ? createBadge ?? label : label}
          </span>
          <div className="flex-1 min-w-0">
            {edit ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${idPrefix}-body`}
                onClick={(e) => {
                  e.stopPropagation()
                  edit.onToggle()
                }}
                className="block max-w-full text-left text-[15px] font-semibold text-[#0F172A] truncate rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                {draft.title || 'Untitled step'}
              </button>
            ) : (
              <span className="block text-[15px] font-semibold text-[#0F172A] truncate">New step</span>
            )}
            {edit && (
              <p className={`text-[13px] truncate ${hasProblem ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>
                {hasProblem && <AlertTriangle size={12} className="inline -mt-0.5 mr-1" aria-hidden />}
                {assigneeText} · {timingSummary(draft.start_rule, draft.due_rule, frequency, waits, nextFlags)}
                {alsoText ? ` · ${alsoText}` : ''}
              </p>
            )}
          </div>
          {edit && (
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <IconAction label="Move up" icon={ChevronUp} onClick={edit.onMoveUp ?? (() => undefined)} allowed={editable} reason={reason} disabled={!edit.canMoveUp || edit.moving} />
              <IconAction label="Move down" icon={ChevronDown} onClick={edit.onMoveDown ?? (() => undefined)} allowed={editable} reason={reason} disabled={!edit.canMoveDown || edit.moving} />
              <ActionMenu
                label={`More actions for step ${label}`}
                items={[
                  ...(edit.onAddBelow
                    ? [{ key: 'below', label: 'Add step below', icon: ListPlus, allowed: editable, reason, onSelect: edit.onAddBelow }]
                    : []),
                  ...(edit.onSplit
                    ? [{ key: 'split', label: 'Add parallel path', icon: GitBranch, tip: 'Starts a separate path that runs at the same time.', allowed: editable, reason, onSelect: edit.onSplit }]
                    : []),
                  { key: 'delete', label: 'Delete step', icon: Trash2, danger: true, allowed: editable, reason, onSelect: () => step && edit.onDelete(step) },
                ]}
              />
            </div>
          )}
        </div>
        <Reveal open={expanded} id={`${idPrefix}-body`}>
          {fields}
        </Reveal>
      </div>
    </Reveal>
  )
}

