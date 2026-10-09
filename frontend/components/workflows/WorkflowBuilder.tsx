'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, ArchiveRestore, ChevronDown, Eye, GitBranch, Info, ListChecks, Pause, Pencil, Play, Plus, RefreshCw, Save, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage, workflowErrorStatus, workflowErrorTarget } from '@/lib/api/workflows'
import type {
  ChecklistItem,
  DefinitionScheduleInput,
  DefinitionStepInput,
  StepInput,
  WorkflowDefinitionInput,
  WorkflowStep,
  WorkflowTemplate,
} from '@/lib/types/workflows'
import ActionMenu, { type ActionMenuItem } from './ActionMenu'
import ExampleRun, { warningText } from './ExampleRun'
import PeopleSection, { type PeopleValue } from './PeopleSection'
import StartsSection, { type ScheduleDraft, type StartsValue, scheduleToDraft } from './StartsSection'
import StepCard, { INPUT_CLS, IconAction, LABEL_CLS, blankStepDraft, type CommitNewStep, type MergeOption } from './StepCard'
import StepFlow from './StepFlow'
import {
  MAIN_TRACK,
  TRACK_NAME_MAX,
  dependentsOf,
  findLoop,
  layoutTracks,
  nextTrackKey,
  numberLabel,
  orderByTracks,
  savedMerges,
  stepName,
  trackBaseLabel,
  trackLabel,
  trackOfStep,
  tracksFromServer,
  upstreamOf,
  type TrackDraft,
  type TrackLayout,
} from './tracks'
import { cleanRule, dueRuleOf, frequencyOf, runStartOf, startRuleOf, stepTimingMessage, timingProblems, type Frequency, type RunStart } from './timing'
import { orderProblemsFor, planContext, planSteps } from './timingPlan'
import { getNow } from '@/lib/clock'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import { useWorkflowActions } from './useWorkflowActions'
import { useWorkflowLookups } from './useWorkflowLookups'
import {
  AddStepBar,
  BTN,
  EmptyState,
  ErrorBanner,
  ErrorState,
  GatedButton,
  InfoTip,
  NotFoundState,
  REASONS,
  Reveal,
  Skeleton,
  TemplateStatusBadge,
  WORKFLOWS_BASE,
  WorkflowBreadcrumb,
  editHref,
  gate,
  plural,
  useNarrowScreen,
  useWorkflowsWritable,
  workflowHref,
} from './shared'

/** From this many steps a second "Add step" sits in the section header too. */
const LONG_LIST = 4
const NAME_MAX = 200
const NEW_KEY = 'new-'

/** Where the new-step form is open: at the end of a track, or right below a step. */
interface AddingAt {
  track: string
  after: string | null
  /** A track being started by "Add parallel path" — added once its first step is. */
  newTrack?: TrackDraft
  seq: number
}

/** Ids of the new-step form's wrapper and of each track's "Add step" bar. */
const FORM_ID = 'new-step-form'
const addBarId = (track: string) => `add-step-${track}`
/** Room the sticky page header takes above the steps (matches `scroll-mt-40`). */
const HEADER_ROOM = 160

/** The element that scrolls `el` vertically: the dashboard's <main>, or else the page. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/** The visible band of a scroller, in viewport coordinates. */
function viewBand(sc: HTMLElement): { top: number; bottom: number } {
  if (sc === document.scrollingElement || sc === document.documentElement) return { top: 0, bottom: window.innerHeight }
  const r = sc.getBoundingClientRect()
  return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) }
}

/** Where an element sits now, to keep something at that spot while the layout changes. */
interface Anchor {
  /** Id of the element to hold in place. */
  id: string
  /** Its viewport top to hold. */
  top: number
}

/**
 * Keep the page still around an add: hold one element at a fixed spot on screen (the
 * clicked control's spot) while the layout settles — cards folding above it, track
 * columns widening — by moving the scroller under it, never by letting the page jump.
 * Then bring `revealId` into view only as far as needed (a form taller than the screen:
 * its top, where the title is), smoothly, and keep holding that while slower changes land
 * above it (the example run refreshes a moment later). Anything the person does —
 * scrolling, a key, a click — ends the hold at once. Returns a cancel function.
 */
function holdThenReveal(anchor: Anchor | null, revealId: string | null, after?: () => void, settleMs = 420, holdMs = 4000): () => void {
  let anchorId = anchor?.id ?? null
  /** Viewport top to keep the anchored element at. */
  let desired = anchor?.top ?? 0
  let sc: HTMLElement | null = null
  let ro: ResizeObserver | null = null
  let raf = 0
  let done = false
  /** A smooth reveal under way, heading for this scrollTop. */
  let smoothTo: number | null = null
  const timers: number[] = []

  const maxTop = (s: HTMLElement) => Math.max(0, s.scrollHeight - s.clientHeight)
  const adjust = () => {
    if (done || !anchorId || !sc) return
    const el = document.getElementById(anchorId)
    if (!el) return
    // Where the scroller must be for the element to sit at `desired` (scroll-invariant).
    const target = Math.min(Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - desired), maxTop(sc))
    // The smooth reveal has arrived (or was clamped): hold in place from here on.
    if (smoothTo !== null && Math.abs(sc.scrollTop - smoothTo) < 1) smoothTo = null
    if (smoothTo !== null) {
      // Still on its way: re-aim it if the layout moved the destination.
      if (Math.abs(target - smoothTo) > 1) {
        smoothTo = target
        sc.scrollTo({ top: target, behavior: 'smooth' })
      }
      return
    }
    if (Math.abs(target - sc.scrollTop) > 0.5) sc.scrollTop = target
  }
  const stop = () => {
    done = true
    cancelAnimationFrame(raf)
    timers.forEach((t) => clearTimeout(t))
    ro?.disconnect()
    window.removeEventListener('wheel', takeOver, true)
    window.removeEventListener('touchstart', takeOver, true)
    window.removeEventListener('pointerdown', takeOver, true)
    window.removeEventListener('keydown', takeOver, true)
  }
  // The person takes over at once: nothing is held or scrolled for them after that.
  function takeOver() {
    stop()
  }
  const attach = (el: HTMLElement) => {
    if (sc) return
    sc = scrollParent(el)
    window.addEventListener('wheel', takeOver, { capture: true, passive: true })
    window.addEventListener('touchstart', takeOver, { capture: true, passive: true })
    window.addEventListener('pointerdown', takeOver, true)
    window.addEventListener('keydown', takeOver, true)
    if (typeof ResizeObserver !== 'undefined') {
      // Layout changes are corrected before they are painted, not a frame later.
      ro = new ResizeObserver(adjust)
      const content = sc === document.scrollingElement || sc === document.documentElement ? document.body : sc.firstElementChild
      if (content) ro.observe(content)
      const tracks = document.getElementById('tracks')
      if (tracks) ro.observe(tracks)
    }
  }

  const first = anchorId ? document.getElementById(anchorId) : null
  if (first) attach(first)
  const loop = () => {
    if (!sc && anchorId) {
      const el = document.getElementById(anchorId)
      if (el) attach(el)
    }
    adjust()
    if (!done) raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  timers.push(
    window.setTimeout(() => {
      cancelAnimationFrame(raf)
      if (done) return
      const el = revealId ? document.getElementById(revealId) : null
      if (el) {
        attach(el)
        const s = sc as HTMLElement
        const band = viewBand(s)
        const r = el.getBoundingClientRect()
        const top = band.top + HEADER_ROOM
        const bottom = band.bottom - 24
        // Only as far as needed: too tall to fit → its top; above → its top; below → its bottom.
        const nextTop = r.height > bottom - top || r.top < top ? top : r.bottom > bottom ? bottom - r.height : r.top
        anchorId = el.id
        desired = nextTop
        const target = Math.min(Math.max(0, s.scrollTop + r.top - nextTop), maxTop(s))
        if (Math.abs(target - s.scrollTop) > 1) {
          smoothTo = target
          s.scrollTo({ top: target, behavior: 'smooth' })
        }
        revealSideways(el)
      }
      after?.()
    }, settleMs),
    window.setTimeout(stop, Math.max(holdMs, settleMs + 1)),
  )
  return stop
}

/** Track columns side by side scroll sideways when they do not fit: show this one. */
function revealSideways(el: HTMLElement) {
  const box = document.getElementById('tracks')
  if (!box || box.scrollWidth <= box.clientWidth + 1 || !box.contains(el)) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.left < b.left) box.scrollTo({ left: box.scrollLeft - (b.left - r.left) - 16, behavior: 'smooth' })
  else if (r.right > b.right) box.scrollTo({ left: box.scrollLeft + Math.min(r.right - b.right + 16, r.left - b.left), behavior: 'smooth' })
}

/** Everything the builder edits — the whole workflow, saved in one request. */
interface Working {
  name: string
  description: string
  starts: StartsValue
  people: PeopleValue
  /** Main first, then the others in display order. */
  tracks: TrackDraft[]
  /**
   * A step's position in its track = its order among that track's steps here. Steps
   * not saved yet have a client key ("new-…") as their id.
   */
  steps: WorkflowStep[]
}

const isNewKey = (id: string) => id.startsWith(NEW_KEY)
let keySeq = 0
const newKey = () => `${NEW_KEY}${Date.now().toString(36)}-${(keySeq += 1)}`

function workingFrom(w: WorkflowTemplate): Working {
  const schedules = (w.schedules ?? []).map(scheduleToDraft)
  const tracks = tracksFromServer(w.tracks)
  return {
    name: w.name ?? '',
    description: w.description ?? '',
    starts: {
      manual: w.manual_start_enabled !== false,
      starterIds: (w.people?.starters ?? []).map((p) => p.id),
      scheduleOn: schedules.length > 0,
      schedules,
    },
    people: {
      ownerIds: w.people?.owners ? w.people.owners.map((p) => p.id) : w.owner_user_ids ?? [],
      editorIds: (w.people?.editors ?? []).map((p) => p.id),
    },
    tracks,
    steps: orderByTracks(tracks, w.steps ?? []),
  }
}

function blankWorking(me: string | undefined): Working {
  // A new workflow's owner is its creator, who is also pre-picked to start it by hand.
  return {
    name: '',
    description: '',
    starts: { manual: true, starterIds: me ? [me] : [], scheduleOn: false, schedules: [] },
    people: { ownerIds: me ? [me] : [], editorIds: [] },
    tracks: [{ key: MAIN_TRACK, name: '', split_from: null }],
    steps: [],
  }
}

function checklistInput(items: ChecklistItem[] | null | undefined): ChecklistItem[] {
  return (Array.isArray(items) ? items : [])
    .filter((c) => c && typeof c.title === 'string' && c.title.trim())
    .map((c) => ({
      title: c.title,
      ...(c.group_title ? { group_title: c.group_title } : {}),
      ...(c.template_id ? { template_id: c.template_id } : {}),
    }))
}

/**
 * A parallel path's name in its header: "· Finance" when it has one, else its first
 * step's title as a quiet hint ("· Budget check"), so paths are recognisable without
 * naming them. The pencil turns it into a field: Enter or leaving it keeps the name,
 * Escape puts it back.
 */
function PathName({
  track,
  hint,
  allowed,
  reason,
  onRename,
}: {
  track: TrackDraft
  hint: string | null
  allowed: boolean | undefined
  reason: string
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(track.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) return
    setText(track.name)
    cancelled.current = false
    requestAnimationFrame(() => inputRef.current?.select())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  const base = trackBaseLabel(track.key)
  const name = track.name.trim()

  if (editing) {
    return (
      <input
        ref={inputRef}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the pencil on purpose
        autoFocus
        aria-label={`Name of ${base}`}
        value={text}
        maxLength={TRACK_NAME_MAX}
        placeholder="Path name (optional)"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!cancelled.current) onRename(text.trim())
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancelled.current = true
            inputRef.current?.blur()
          }
        }}
        className={`${INPUT_CLS} !py-1.5 min-w-0 flex-1`}
      />
    )
  }
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        {name ? (
          <span className="text-[14px] font-medium text-[#0F172A]">· {name}</span>
        ) : hint ? (
          <span className="text-[13px] text-[#475569]">· {hint}</span>
        ) : null}
      </span>
      <IconAction label="Rename path" icon={Pencil} onClick={() => setEditing(true)} allowed={allowed} reason={reason} />
    </>
  )
}

function stepInput(s: WorkflowStep, layout: TrackLayout): DefinitionStepInput {
  return {
    key: s.id,
    ...(isNewKey(s.id) ? {} : { id: s.id }),
    track_key: layout.trackOf.get(s.id) ?? MAIN_TRACK,
    // A merge it already waits for through its path adds nothing and isn't saved.
    merge_step_keys: savedMerges(layout, s.id),
    title: (s.title ?? '').trim(),
    description: s.description?.trim() || null,
    assignee_user_ids: s.assignee_user_ids ?? [],
    cc_user_ids: s.cc_user_ids ?? [],
    completion_mode: s.completion_mode ?? 'any_can_complete',
    priority_id: s.priority_id ?? null,
    category_id: s.category_id ?? null,
    tag_ids: s.tag_ids ?? [],
    checklist_items: checklistInput(s.checklist_items),
    proof_required: !!s.proof_required,
    proof_allowed_extensions: s.proof_required ? s.proof_allowed_extensions ?? [] : [],
    due_days: typeof s.due_days === 'number' ? s.due_days : 1,
    due_time: s.due_time || '18:00',
    escalation_mode: s.escalation_mode === 'people' ? 'people' : 'manager',
    escalation_user_ids: s.escalation_user_ids ?? [],
    if_late: s.if_late === 'move_on' ? 'move_on' : 'wait',
    // Legacy steps (no rules yet) stay as they are until their timing is changed.
    ...(s.start_rule ? { start_rule: cleanRule(s.start_rule) } : {}),
    ...(s.due_rule ? { due_rule: cleanRule(s.due_rule) } : {}),
  }
}

function scheduleInput(d: ScheduleDraft): DefinitionScheduleInput {
  return {
    ...(d.id ? { id: d.id } : {}),
    schedule_type: d.schedule_type,
    every: Math.max(1, Number(d.every) || 1),
    days: d.schedule_type === 'weekly' ? [...d.days].sort((a, b) => a - b) : [],
    month_days: d.schedule_type === 'monthly' ? d.month_days : [],
    yearly_dates: d.schedule_type === 'yearly' ? d.yearly_dates : [],
    time: d.time,
    start_date: d.start_date,
    end_condition: d.end_condition,
    end_date: d.end_condition === 'on_date' ? d.end_date || null : null,
    end_after: d.end_condition === 'after_n' ? Math.max(1, Number(d.end_after) || 1) : null,
  }
}

/** The definition this working copy would save (people only when the caller may change them). */
function definitionOf(work: Working, mode: 'draft' | 'save', withPeople: boolean): WorkflowDefinitionInput {
  const layout = layoutTracks(work.tracks, work.steps)
  // A track with no steps is not saved (the server drops it too).
  const used = new Set(work.steps.map((s) => layout.trackOf.get(s.id) ?? MAIN_TRACK))
  return {
    name: work.name.trim(),
    description: work.description.trim() || null,
    mode,
    starts: {
      manual: { enabled: work.starts.manual, starter_user_ids: work.starts.starterIds },
      schedules: work.starts.scheduleOn ? work.starts.schedules.map(scheduleInput) : [],
    },
    steps: work.steps.map((s) => stepInput(s, layout)),
    tracks: work.tracks
      .filter((t) => t.key === MAIN_TRACK || used.has(t.key))
      .map((t) => ({ key: t.key, name: t.name.trim() || null, split_from_step_key: t.key === MAIN_TRACK ? null : t.split_from })),
    ...(withPeople ? { people: { owner_user_ids: work.people.ownerIds, editor_user_ids: work.people.editorIds } } : {}),
  }
}

/** What "unsaved changes" compares: the saved shape, order-insensitive for people lists. */
function signature(work: Working): string {
  const d = definitionOf(work, 'draft', true)
  const sorted = (xs: string[] | undefined) => [...(xs ?? [])].sort()
  return JSON.stringify({
    ...d,
    starts: { ...d.starts, manual: { ...d.starts.manual, starter_user_ids: sorted(d.starts.manual.starter_user_ids) } },
    people: { owner_user_ids: sorted(d.people?.owner_user_ids), editor_user_ids: sorted(d.people?.editor_user_ids) },
  })
}

const SAVE_STEP_MSG = {
  title: 'enter a title.',
  assignee: 'add at least one assignee.',
  escalation: 'add someone to escalate to, or choose “Reporting manager”.',
}

const RESTORE_FIRST = 'Restore this workflow to edit it.'

/**
 * The one-page workflow builder, for a new workflow and an existing one. It edits a
 * working copy of the whole workflow — details, how it starts, steps in their tracks
 * (side by side on a wide screen, stacked on a phone; "Split here" starts a track, "Also
 * wait for…" makes a step wait for steps in other tracks) and people — and saves it in
 * ONE request:
 *
 *  - a new workflow or a draft: Save draft (anything filled in) or Save (everything
 *    checked; it goes Live);
 *  - a Live or Paused workflow: Save changes (always checked in full) and Pause / Resume.
 *
 * A refused save names what is missing; the step or section is shown and scrolled to.
 * Leaving with unsaved changes asks first.
 */
export default function WorkflowBuilder({ id: initialId }: { id: string | null }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()
  const router = useRouter()
  const entWritable = useWorkflowsWritable()
  const narrow = useNarrowScreen()

  const [workflow, setWorkflow] = useState<WorkflowTemplate | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'notfound'>(initialId ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState('')

  const lookups = useWorkflowLookups(orgId, status === 'ready')
  const writable = entWritable === false || lookups.moduleAccess === 'preview' ? false : entWritable

  // ── The working copy and what was last saved ──
  const [work, setWork] = useState<Working>(() => blankWorking(user?.id))
  const [baseline, setBaseline] = useState<string>(() => signature(blankWorking(user?.id)))
  const dirty = signature(work) !== baseline
  // "Save and leave" runs the header's own save: a new workflow or a draft saves as a
  // draft (incomplete work is kept, not refused); a Live or Paused one saves its changes,
  // checked in full. The function is read when the dialog's button is pressed.
  const saveRef = useRef<(mode: 'draft' | 'save') => Promise<boolean>>(async () => false)
  const leaveMode: 'draft' | 'save' = !workflow || workflow.status === 'draft' ? 'draft' : 'save'
  const guard = useUnsavedChangesGuard(
    dirty && status === 'ready',
    workflow ? 'edit' : 'create',
    workflow?.status === 'archived' || workflow?.capabilities?.can_edit === false ? undefined : { run: () => saveRef.current(leaveMode), label: leaveMode === 'draft' ? 'Save draft and leave' : 'Save and leave' },
  )

  // A new workflow's defaults wait for the signed-in user.
  const seeded = useRef(!!initialId || !!user?.id)
  useEffect(() => {
    if (seeded.current || !user?.id) return
    seeded.current = true
    const blank = blankWorking(user.id)
    setWork(blank)
    setBaseline(signature(blank))
  }, [user?.id])

  // ── UI state ──
  const [nameError, setNameError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<AddingAt | null>(null)
  const addSeq = useRef(0)
  /** The open new-step form's "add what is filled in" (registered by the form itself). */
  const commitRef = useRef<CommitNewStep | null>(null)
  /** Cancels a hold-in-place that is still running (holdThenReveal). */
  const holdRef = useRef<(() => void) | null>(null)
  useEffect(() => () => holdRef.current?.(), [])
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStep | null>(null)
  const [flowOpen, setFlowOpen] = useState(true)
  const [saving, setSaving] = useState<'draft' | 'save' | null>(null)
  const [pausing, setPausing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [issues, setIssues] = useState<Map<string, string>>(new Map())
  /** A problem with a track (its split point), shown on the track's header. */
  const [trackIssue, setTrackIssue] = useState<{ key: string; message: string } | null>(null)
  const [startsError, setStartsError] = useState<{ message: string; index: number | null } | null>(null)

  const widRef = useRef<string | null>(initialId)
  const applyServer = useCallback((w: WorkflowTemplate, keys?: Record<string, string>) => {
    const next = workingFrom(w)
    widRef.current = w.id
    setWorkflow(w)
    setWork(next)
    setBaseline(signature(next))
    if (keys) setExpanded((set) => new Set(Array.from(set).map((k) => keys[k] ?? k)))
  }, [])

  const load = useCallback(
    async (quiet = false) => {
      const wid = widRef.current
      if (!orgId || !wid) return
      if (!quiet) setStatus('loading')
      try {
        applyServer(await workflowsApi.getWorkflow(orgId, wid))
        setConflict(false)
        setSaveError(null)
        setStatus('ready')
      } catch (e) {
        if (quiet) return
        const code = workflowErrorStatus(e)
        if (code === 404 || code === 403) setStatus('notfound')
        else {
          setLoadError(workflowErrorMessage(e, 'Check your connection and try again.'))
          setStatus('failed')
        }
      }
    },
    [orgId, applyServer],
  )

  useEffect(() => {
    if (initialId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, initialId])

  const actions = useWorkflowActions(orgId, (change) => {
    // Archive / restore change only the status: keep the edits on screen.
    if (change.workflow) setWorkflow((w) => (w ? { ...w, ...change.workflow, steps: w.steps } : w))
    else load(true)
  })

  // ── Gates ──
  const caps = workflow?.capabilities
  const archived = workflow?.status === 'archived'
  const live = workflow?.status === 'active' || workflow?.status === 'paused'
  const rawEdit = workflow ? gate(caps?.can_edit, writable, REASONS.edit) : gate(true, writable, REASONS.preview)
  const edit =
    archived && rawEdit.allowed === true ? { allowed: false as const, reason: RESTORE_FIRST } : rawEdit
  const peopleGate = workflow ? gate(caps?.can_manage_access, writable, REASONS.manageAccess) : edit
  const canSendPeople = !workflow || caps?.can_manage_access === true

  const steps = work.steps
  const layout = useMemo(() => layoutTracks(work.tracks, steps), [work.tracks, steps])
  const labels = layout.labels
  // How it repeats — from the schedules being edited — decides which timing steps may use.
  const timingSchedules = useMemo(() => (work.starts.scheduleOn ? work.starts.schedules : []), [work.starts.scheduleOn, work.starts.schedules])
  const freqKey = JSON.stringify(frequencyOf(timingSchedules))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frequency = useMemo<Frequency>(() => JSON.parse(freqKey), [freqKey])
  // Where runs start in their cycle (the latest trigger day): first steps can't be timed
  // before it. A schedule change re-checks every step at once; choices are never changed.
  const runStartKey = JSON.stringify(runStartOf(timingSchedules, frequency))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runStart = useMemo<RunStart | null>(() => JSON.parse(runStartKey), [runStartKey])
  /** A first step waits for nothing (the main path's first step, a path from the start of the run). */
  const isFirstStep = useCallback((id: string) => (layout.deps.get(id) ?? []).length === 0, [layout])
  /**
   * The SAMPLE RUN — the next run on the run start day, planned without holidays (the
   * server plans the same one for Save's order check): the timing calendar, its greyed
   * days, and the "(next month)" marks of older rules.
   */
  const timingPlan = useMemo(() => {
    const ctx = planContext(frequency, runStart, { schedules: timingSchedules, now: getNow() })
    const stepsForPlan = layout.display.map((s) => ({ id: s.id, deps: layout.deps.get(s.id) ?? [], start: startRuleOf(s), due: dueRuleOf(s) }))
    const planned = planSteps(stepsForPlan, ctx)
    const names = layout.display.map((s) => ({ id: s.id, label: labels.get(s.id) ?? '?', title: s.title ?? '' }))
    return { ctx, planned, names, steps: stepsForPlan }
  }, [layout, frequency, runStart, timingSchedules, labels])
  /**
   * Steps whose timing Save would refuse: a kind this frequency does not allow, dates
   * that are incomplete or before the run starts — then, when those are fine, an explicit
   * day before the step it waits for is due (or a due day before its own start).
   */
  const timingIssues = useMemo(() => {
    const own = new Map(
      layout.display.map((s) => [s.id, timingProblems(startRuleOf(s), dueRuleOf(s), frequency, { first: isFirstStep(s.id), runStart })]),
    )
    const order = orderProblemsFor(timingPlan.steps, timingPlan.names, timingPlan.planned, timingPlan.ctx, (id) => (own.get(id) ?? []).length > 0)
    return layout.display
      .map((s) => {
        const o = order.get(s.id)
        return { step: s, problems: own.get(s.id)?.length ? own.get(s.id)! : o ? [o] : [] }
      })
      .filter((x) => x.problems.length > 0)
  }, [layout, frequency, runStart, isFirstStep, timingPlan])
  /** The same problems in the server's words (its example-run warnings repeat them). */
  const timingIssueTexts = useMemo(
    () =>
      new Set(
        timingIssues.flatMap(({ step, problems }) => {
          const label = stepName(labels.get(step.id), step.title)
          return problems.map((p) => stepTimingMessage(label, p))
        }),
      ),
    [timingIssues, labels],
  )
  const memberName = useCallback((uid: string) => lookups.members.find((m) => m.user_id === uid)?.name, [lookups.members])
  const me = user ? { user_id: user.id, name: user.name } : undefined

  // ── Editing the working copy ──
  const setSteps = (fn: (list: WorkflowStep[]) => WorkflowStep[]) => setWork((w) => ({ ...w, steps: fn(w.steps) }))

  const clearIssue = (stepId: string) =>
    setIssues((m) => {
      if (!m.has(stepId)) return m
      const n = new Map(m)
      n.delete(stepId)
      return n
    })

  const onUpdate = useCallback((stepId: string, input: StepInput) => {
    setSteps((list) =>
      list.map((s) => {
        if (s.id !== stepId) return s
        const next: WorkflowStep = { ...s, ...(input as Partial<WorkflowStep>) }
        // Names shown elsewhere follow the ids from now on.
        if (input.assignee_user_ids || input.cc_user_ids) {
          next.assignees = undefined
          next.ccs = undefined
        }
        if (input.escalation_mode || input.escalation_user_ids || input.assignee_user_ids) next.escalation_contacts = undefined
        return next
      }),
    )
    clearIssue(stepId)
    setSaveError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * A new-step form already open (in another track, or further down) is not thrown away
   * when another one is asked for: what is filled in is added first, in the same click.
   * A form with no title yet is simply closed. Returns false when the open form cannot be
   * added as it is — it stays open and says why.
   */
  const settleOpenForm = (): { ok: boolean; addedTrack?: string } => {
    if (!adding) return { ok: true }
    const result = commitRef.current?.() ?? 'blank'
    if (result === 'invalid') {
      holdRef.current?.()
      holdRef.current = holdThenReveal(null, FORM_ID, undefined, 0)
      return { ok: false }
    }
    if (result === 'blank') return { ok: true }
    insertStep(result, adding)
    return { ok: true, addedTrack: adding.newTrack?.key }
  }

  /**
   * Open the new-step form where the step will go: other cards fold away, its title takes
   * focus, and the clicked control's spot is held on screen while they fold (`anchor`) —
   * the page never jumps — then only the form is scrolled into view, as far as needed.
   */
  const openAdd = (track: string = MAIN_TRACK, after: string | null = null, newTrack?: TrackDraft, anchor: Anchor | null = null, settled = false) => {
    if (!settled && !settleOpenForm().ok) return
    setExpanded(new Set())
    addSeq.current += 1
    setAdding({ track, after, newTrack, seq: addSeq.current })
    holdRef.current?.()
    holdRef.current = holdThenReveal(anchor, FORM_ID)
  }

  /** Hold a step card's top where it is now (the form opens right below it). */
  const cardAnchor = (stepId: string): Anchor | null => {
    const el = document.getElementById(`step-card-${stepId}`)
    return el ? { id: el.id, top: el.getBoundingClientRect().top } : null
  }

  /** "Add parallel path": a new track that starts after this step; its first step's form opens. */
  const splitAt = (step: WorkflowStep) => {
    const anchor = cardAnchor(step.id)
    const settled = settleOpenForm()
    if (!settled.ok) return
    const taken = work.tracks.map((t) => t.key)
    if (settled.addedTrack && !taken.includes(settled.addedTrack)) taken.push(settled.addedTrack)
    const key = nextTrackKey(taken)
    openAdd(key, null, { key, name: '', split_from: step.id }, anchor, true)
  }

  const setTrack = (key: string, patch: Partial<TrackDraft>) => {
    setWork((w) => ({ ...w, tracks: w.tracks.map((t) => (t.key === key ? { ...t, ...patch } : t)) }))
    setTrackIssue((x) => (x?.key === key ? null : x))
  }

  /** Name a path that is still being started (its first step's form is open). */
  const renamePendingTrack = (key: string, name: string) =>
    setAdding((a) => (a?.newTrack?.key === key ? { ...a, newTrack: { ...a.newTrack, name } } : a))

  /** Remove an empty track (never main). */
  const removeTrack = (key: string) => {
    if (key === MAIN_TRACK || steps.some((s) => trackOfStep(s) === key)) return
    setWork((w) => ({ ...w, tracks: w.tracks.filter((t) => t.key !== key) }))
    setTrackIssue((x) => (x?.key === key ? null : x))
  }

  /**
   * Add a step to the working copy, in the track the form is open in: right below the
   * step it was opened from ("Add step below" — the step after it in the track now
   * follows the new one), or at the end of the track.
   */
  function insertStep(input: StepInput, at: AddingAt): { key: string; atEnd: boolean } {
    const key = newKey()
    const now = new Date().toISOString()
    const after = at.after && steps.some((s) => s.id === at.after) ? at.after : null
    const created: WorkflowStep = {
      id: key,
      organization_id: orgId,
      workflow_template_id: workflow?.id ?? '',
      order_index: 0,
      track_key: at.track,
      merge_step_ids: input.merge_step_ids ?? [],
      title: input.title ?? '',
      description: input.description ?? null,
      assignee_user_ids: input.assignee_user_ids ?? [],
      cc_user_ids: input.cc_user_ids ?? [],
      completion_mode: input.completion_mode ?? 'any_can_complete',
      priority_id: input.priority_id ?? null,
      category_id: input.category_id ?? null,
      tag_ids: input.tag_ids ?? [],
      checklist_items: input.checklist_items ?? [],
      proof_required: !!input.proof_required,
      proof_allowed_extensions: input.proof_allowed_extensions ?? [],
      due_days: input.due_days ?? 1,
      due_time: input.due_time ?? '18:00',
      escalation_mode: input.escalation_mode ?? 'manager',
      escalation_user_ids: input.escalation_user_ids ?? [],
      if_late: input.if_late ?? 'wait',
      depends_on_step_ids: [],
      start_rule: input.start_rule ?? null,
      due_rule: input.due_rule ?? null,
      assigner_user_id: null,
      created_at: now,
      updated_at: now,
    }
    const newTrack = at.newTrack
    setWork((w) => {
      const tracks = newTrack && !w.tracks.some((t) => t.key === newTrack.key) ? [...w.tracks, newTrack] : w.tracks
      const i = after ? w.steps.findIndex((s) => s.id === after) : -1
      const list = i >= 0 ? [...w.steps.slice(0, i + 1), created, ...w.steps.slice(i + 1)] : [...w.steps, created]
      return { ...w, tracks, steps: list }
    })
    setSaveError(null)
    return { key, atEnd: !after }
  }

  /**
   * The form's own "Add step": the step is added and shows folded — a compact card, so it
   * is plain that it was added and is no longer a form — with the track's "+ Add step" bar
   * right where the button was clicked (held there while the form folds away), ready for
   * the next step. A step inserted between others holds its own card in the form's place.
   */
  async function onCreate(input: StepInput) {
    if (!adding) return
    const formEl = document.getElementById(FORM_ID)
    const fr = formEl?.getBoundingClientRect()
    const band = formEl ? viewBand(scrollParent(formEl)) : null
    const { key, atEnd } = insertStep(input, adding)
    const track = adding.track
    setAdding(null)
    let anchor: Anchor | null = null
    if (fr && band) {
      const clamp = (v: number, lo: number, hi: number) => Math.max(Math.min(v, hi), Math.min(lo, hi))
      anchor = atEnd
        ? // Room above the bar for the folded card; never below the bottom edge.
          { id: addBarId(track), top: clamp(fr.bottom - 48, band.top + HEADER_ROOM + 84, band.bottom - 48 - 24) }
        : { id: `step-card-${key}`, top: clamp(fr.top, band.top + HEADER_ROOM, band.bottom - 96) }
    }
    holdRef.current?.()
    holdRef.current = holdThenReveal(anchor, `step-card-${key}`, () => {
      // The next step is one keypress away too.
      if (atEnd) document.getElementById(addBarId(track))?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true })
    })
  }

  const toggle = (stepId: string) =>
    setExpanded((set) => {
      const n = new Set(set)
      if (n.has(stepId)) n.delete(stepId)
      else n.add(stepId)
      return n
    })

  const focusStep = (stepId: string) => {
    setAdding(null)
    setExpanded((s) => new Set(s).add(stepId))
    setTimeout(() => document.getElementById(`step-card-${stepId}`)?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' }), 60)
  }

  const focusTrack = (key: string) => {
    setAdding(null)
    setTimeout(() => document.getElementById(`track-col-${key}`)?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' }), 60)
  }

  /** Move a step up or down within its own track. */
  function move(stepId: string, dir: -1 | 1) {
    setSteps((list) => {
      const i = list.findIndex((s) => s.id === stepId)
      if (i < 0) return list
      const track = trackOfStep(list[i])
      let j = i + dir
      while (j >= 0 && j < list.length && trackOfStep(list[j]) !== track) j += dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  /** What deleting a step changes, in words (shown in the confirmation). */
  function deleteEffects(step: WorkflowStep): string[] {
    const track = layout.trackOf.get(step.id) ?? MAIN_TRACK
    const group = layout.groups.get(track) ?? []
    const i = group.findIndex((s) => s.id === step.id)
    const prevId = i > 0 ? group[i - 1].id : (work.tracks.find((t) => t.key === track)?.split_from ?? null)
    const prev = prevId ? steps.find((s) => s.id === prevId) : undefined
    const after = prev ? stepName(labels.get(prev.id), prev.title) : 'the beginning'
    const out: string[] = []
    const next = group[i + 1]
    if (next) out.push(`${stepName(labels.get(next.id), next.title)} will follow ${after} instead.`)
    const splits = work.tracks.filter((t) => t.key !== MAIN_TRACK && t.split_from === step.id && (layout.groups.get(t.key) ?? []).length > 0)
    for (const t of splits) out.push(`${trackLabel(t)} will start ${prev ? `after ${after}` : 'at the beginning'} instead.`)
    const waiting = steps.filter((s) => (layout.merges.get(s.id) ?? []).includes(step.id))
    if (waiting.length) {
      out.push(`${waiting.map((s) => stepName(labels.get(s.id), s.title)).join(', ')} will no longer wait for it.`)
    }
    return out
  }

  /**
   * Delete a step: the step after it in its track now follows the step before it; tracks
   * that split from it now split from the step before it (or start with the workflow);
   * "Also wait for" entries pointing at it go.
   */
  function confirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setWork((w) => {
      const lay = layoutTracks(w.tracks, w.steps)
      const track = lay.trackOf.get(id) ?? MAIN_TRACK
      const group = lay.groups.get(track) ?? []
      const i = group.findIndex((s) => s.id === id)
      const own = w.tracks.find((t) => t.key === track)
      const prev = i > 0 ? group[i - 1].id : track === MAIN_TRACK ? null : own?.split_from ?? null
      return {
        ...w,
        tracks: w.tracks.map((t) => (t.split_from === id ? { ...t, split_from: prev } : t)),
        steps: w.steps
          .filter((s) => s.id !== id)
          .map((s) => ((s.merge_step_ids ?? []).includes(id) ? { ...s, merge_step_ids: (s.merge_step_ids ?? []).filter((m) => m !== id) } : s)),
      }
    })
    clearIssue(id)
    setDeleteTarget(null)
  }

  /** "B2 “Finance sign-off”" choices for "Also waits for": steps in other tracks that don't make a loop. */
  /**
   * The steps a step may also wait for: on other paths, not itself, not one that waits
   * for it (a loop), and not one it already waits for through its path order or split
   * point (`upstream`: its "After" step and everything before that).
   */
  const mergeOptionsFor = (track: string, blocked: Set<string>, selfId: string | null, upstream: Set<string>): MergeOption[] =>
    layout.display
      .filter((s) => s.id !== selfId && (layout.trackOf.get(s.id) ?? MAIN_TRACK) !== track && !blocked.has(s.id) && !upstream.has(s.id))
      .map((s) => ({ value: s.id, label: `${labels.get(s.id) ?? '?'} “${s.title?.trim() || 'Untitled step'}”` }))

  /**
   * What a step comes after, said only where it is not obvious: the first step of a
   * parallel path (its split step, or "Start of run"). Null for the main path's first
   * step and for any step that follows the previous one in its own path.
   */
  const placementText = (prevId: string | null, track: string, first: boolean): string | null => {
    if (!first || track === MAIN_TRACK) return null
    const prev = prevId ? steps.find((s) => s.id === prevId) : undefined
    return prev ? stepName(labels.get(prev.id), prev.title) : 'Start of run'
  }

  // ── Saving ──
  /** A loop in the flow (a step moved above one it waits for through another track). */
  function loopProblem(): { message: string; stepId: string; perStep: Map<string, string> } | null {
    const loop = findLoop(layout.deps, layout.display.map((s) => s.id))
    if (!loop) return null
    const names = loop.map((sid) => labels.get(sid) ?? '?')
    const msg = `Steps ${names.join(', ')} wait for each other in a loop. Change “Also waits for” or the step order.`
    return { message: msg, stepId: loop[0], perStep: new Map(loop.map((sid) => [sid, msg])) }
  }

  /** Step problems the server would refuse on Save, found here first so they show at once. */
  function localStepProblems(): { message: string; stepId: string | null; perStep: Map<string, string> } | null {
    if (steps.length === 0) return { message: 'Add at least one step.', stepId: null, perStep: new Map() }
    if (!(layout.groups.get(MAIN_TRACK) ?? []).length) {
      return { message: 'Main path: add at least one step.', stepId: null, perStep: new Map() }
    }
    const perStep = new Map<string, string>()
    let first: { message: string; stepId: string } | null = null
    layout.display.forEach((s) => {
      const t = s.title?.trim()
      const label = stepName(labels.get(s.id), s.title)
      const why = !t
        ? SAVE_STEP_MSG.title
        : !(s.assignee_user_ids ?? []).length
          ? SAVE_STEP_MSG.assignee
          : s.escalation_mode === 'people' && !(s.escalation_user_ids ?? []).length
            ? SAVE_STEP_MSG.escalation
            : null
      const timing = timingIssues.find((x) => x.step.id === s.id)?.problems[0]
      const msg = why ? `${label}: ${why}` : timing ? stepTimingMessage(label, timing) : null
      if (msg) {
        perStep.set(s.id, msg)
        if (!first) first = { message: msg, stepId: s.id }
      }
    })
    if (!first) return loopProblem()
    return { ...(first as { message: string; stepId: string }), perStep }
  }

  function showStepProblem(message: string, stepId: string | null, perStep?: Map<string, string>) {
    setSaveError(message)
    setIssues(perStep ?? (stepId ? new Map([[stepId, message]]) : new Map()))
    if (stepId) focusStep(stepId)
    else requestAnimationFrame(() => document.getElementById('steps-heading')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  function showTrackProblem(message: string, key: string) {
    setSaveError(message)
    setTrackIssue({ key, message })
    focusTrack(key)
  }

  function showStartsProblem(message: string, index: number | null) {
    setSaveError(message)
    setStartsError({ message, index })
    requestAnimationFrame(() => document.getElementById('starts-section')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  /** Saves the working copy; true once it is saved (the header buttons and "Save and leave" share it). */
  async function save(mode: 'draft' | 'save'): Promise<boolean> {
    if (saving) return false
    setSaveError(null)
    setConflict(false)
    setStartsError(null)
    setIssues(new Map())
    setTrackIssue(null)
    // Let a field being typed in finish (e.g. a days box that reverts on leave).
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    await new Promise((r) => setTimeout(r, 0))

    if (!work.name.trim()) {
      setNameError('Enter a workflow name.')
      document.getElementById('wf-name')?.focus()
      return false
    }
    const full = mode === 'save' || live
    if (full) {
      if (work.starts.manual && work.starts.starterIds.length === 0) {
        showStartsProblem('Choose who can start it.', null)
        return false
      }
      if (!work.starts.manual && !(work.starts.scheduleOn && work.starts.schedules.length)) {
        showStartsProblem('Choose how it starts.', null)
        return false
      }
      const problem = localStepProblems()
      if (problem) {
        if (problem.stepId === null && problem.message.startsWith('Main path:')) showTrackProblem(problem.message, MAIN_TRACK)
        else showStepProblem(problem.message, problem.stepId, problem.perStep)
        return false
      }
    } else {
      // A draft is checked for its structure only: no loops.
      const loop = loopProblem()
      if (loop) {
        showStepProblem(loop.message, loop.stepId, loop.perStep)
        return false
      }
    }

    setSaving(mode)
    try {
      const dto = definitionOf(work, mode, canSendPeople)
      const saved = workflow
        ? await workflowsApi.saveDefinition(orgId, workflow.id, { ...dto, expected_updated_at: workflow.updated_at })
        : await workflowsApi.createDefinition(orgId, dto)
      await guard.disarm()
      const created = !workflow
      applyServer(saved, saved.step_keys)
      if (created) {
        // Carry on in place: the address becomes the edit page without a reload or a jump.
        window.history.replaceState(null, '', editHref(saved.id))
      }
      addToast(
        saved.status === 'draft'
          ? 'Draft saved'
          : workflow?.status === 'draft' || created
            ? 'Workflow saved and live'
            : 'Changes saved',
        'success',
      )
      const nameOf = (key: string) => {
        const id = saved.step_keys?.[key] ?? key
        const st = (saved.steps ?? []).find((x) => x.id === id)
        return stepName(st?.number_label, st?.title)
      }
      const warnings = (saved.warnings ?? []).map((x) => warningText(x, nameOf)).filter(Boolean)
      if (warnings.length) {
        addToast(warnings.length === 1 ? `Check timing: ${warnings[0]}` : `${warnings.length} timing warnings. See the example run.`, 'warning')
      }
      return true
    } catch (e) {
      const msg = workflowErrorMessage(e, 'The workflow could not be saved. Try again.')
      const target = workflowErrorTarget(e)
      if (workflowErrorStatus(e) === 409) {
        setConflict(true)
        setSaveError(msg)
      } else if (target.stepKey || target.code === 'step_invalid') {
        const hit = target.stepKey && steps.some((s) => s.id === target.stepKey) ? target.stepKey : null
        showStepProblem(msg, hit)
      } else if (target.code === 'track_invalid' && target.trackKey) {
        showTrackProblem(msg, target.trackKey)
      } else if (target.code === 'starts_invalid') {
        showStartsProblem(msg, target.scheduleIndex)
      } else {
        setSaveError(msg)
      }
      return false
    } finally {
      setSaving(null)
    }
  }

  saveRef.current = save

  async function setPaused(pause: boolean) {
    if (!workflow) return
    setPausing(true)
    try {
      const updated = pause ? await workflowsApi.pauseWorkflow(orgId, workflow.id) : await workflowsApi.resumeWorkflow(orgId, workflow.id)
      // Only the status (and version) change — edits on screen stay as they are.
      setWorkflow((w) => (w ? { ...w, ...updated, steps: w.steps } : updated))
      addToast(
        pause ? 'Workflow paused. Runs in progress continue.' : 'Workflow resumed',
        'success',
      )
    } catch (e) {
      addToast(workflowErrorMessage(e, pause ? 'The workflow could not be paused. Try again.' : 'The workflow could not be resumed. Try again.'), 'error')
    } finally {
      setPausing(false)
    }
  }

  // ── Render states ──
  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-2/3 max-w-xl" />
        <Skeleton className="h-40" />
        <Skeleton className="h-28" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }
  if (status === 'notfound') return <NotFoundState what="Workflow" backHref={WORKFLOWS_BASE} backLabel="Go to workflows" />
  if (status === 'failed') return <ErrorState title="This workflow could not be loaded" message={loadError} onRetry={() => load()} />

  const w = workflow
  const detailsDisabled = edit.allowed !== true
  const isDraft = !w || w.status === 'draft'

  // Nothing to save until something differs from what was saved. (An existing draft's
  // Save stays on: saving it unchanged is how it goes live.)
  const NO_CHANGES = 'No changes to save'
  const saveGate = (needsChanges: boolean) => (edit.allowed === true && needsChanges && !dirty ? { allowed: false, reason: NO_CHANGES } : edit)
  const draftGate = saveGate(true)
  const goLiveGate = saveGate(!w)
  const changesGate = saveGate(true)
  const pauseLabel = w?.status === 'paused' ? 'Resume' : 'Pause'

  // On a narrow screen the header keeps one row: title, the primary action and this menu.
  // The secondary actions (Save draft, Pause / Resume, View) move in here — each action
  // is in exactly one place at every width.
  const menuItems: ActionMenuItem[] = [
    ...(narrow && !archived && isDraft
      ? [{ key: 'draft', label: 'Save draft', icon: Save, allowed: draftGate.allowed, reason: draftGate.reason, onSelect: () => save('draft') }]
      : []),
    ...(narrow && w && !archived && !isDraft
      ? [
          {
            key: 'pause',
            label: `${pauseLabel} workflow`,
            icon: w.status === 'paused' ? Play : Pause,
            allowed: saving || pausing ? false : edit.allowed,
            reason: saving || pausing ? 'Wait for the current change to finish.' : edit.reason,
            onSelect: () => setPaused(w.status !== 'paused'),
          },
        ]
      : []),
    ...(narrow && w ? [{ key: 'view', label: 'View workflow', icon: Eye, onSelect: () => guard.confirmLeave(() => router.push(workflowHref(w.id))) }] : []),
    ...(w
      ? [
          {
            key: 'archive',
            label: 'Archive workflow',
            icon: Archive,
            danger: true,
            allowed: rawEdit.allowed,
            reason: rawEdit.reason,
            hidden: archived,
            onSelect: () => actions.archive(w),
          },
          // Restore is the header's primary button when archived — not repeated here.
        ]
      : []),
  ]

  const note =
    w && caps?.can_edit === false ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#334155]">
        <Eye size={16} className="shrink-0 mt-0.5 text-[#475569]" />
        <span>View only. {REASONS.edit}</span>
      </div>
    ) : archived ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#334155]">
        <Archive size={16} className="shrink-0 mt-0.5 text-[#475569]" />
        <span>This workflow is archived. Restore it to edit it again as a draft.</span>
      </div>
    ) : w?.status === 'paused' ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FDE68A] bg-[#FEFCE8] px-3.5 py-2.5 text-sm text-[#713F12]">
        <Pause size={16} className="shrink-0 mt-0.5" />
        <span>This workflow is paused. Runs in progress continue. Resume it to start new runs.</span>
      </div>
    ) : w?.status === 'active' && edit.allowed === true ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-2.5 text-sm text-[#1E3A8A]">
        <Info size={16} className="shrink-0 mt-0.5" />
        <span>This workflow is live. Changes apply to new runs only.</span>
      </div>
    ) : null

  // The example run works from what is on screen. Name and description don't change the
  // dates, so typing them doesn't ask for a new example.
  const exampleDefinition = steps.length ? { ...definitionOf(work, 'draft', false), name: 'Example run', description: null } : null

  // ── Tracks: side by side from 1024px (scrolling sideways inside the section when
  // they don't fit), stacked below. A track being started by "Add parallel path" shows as its
  // own column until its first step is added.
  const pendingTrack = adding?.newTrack && !work.tracks.some((t) => t.key === adding.newTrack!.key) ? adding.newTrack : null
  const columns: TrackDraft[] = pendingTrack ? [...work.tracks, pendingTrack] : work.tracks
  const multiTrack = columns.length > 1

  /** The new-step form, for the track and spot it was opened at. */
  const renderForm = (t: TrackDraft, group: WorkflowStep[]) => {
    if (!adding || adding.track !== t.key) return null
    const at = adding.after ? group.findIndex((s) => s.id === adding.after) : -1
    const prevId = at >= 0 ? group[at].id : group.length ? group[group.length - 1].id : t.key === MAIN_TRACK ? null : t.split_from
    const next = at >= 0 ? group[at + 1] : undefined
    // Inserted before `next`: `next` (and whatever waits for it) will wait for the new step.
    const blocked = next ? new Set([next.id, ...Array.from(dependentsOf(next.id, layout.deps))]) : new Set<string>()
    // What it will already wait for through its path: the step it goes after, and all before that.
    const upstream = prevId && steps.some((s) => s.id === prevId) ? upstreamOf([prevId], layout.deps, null) : new Set<string>()
    return (
      // A fresh form (and fresh draft) each time one is opened — never a reused one.
      <div key={`new-step-${t.key}-${adding.seq}`} id={FORM_ID} className="scroll-mt-40 scroll-mb-6 scroll-mx-4">
      <StepCard
        mode="create"
        orgId={orgId}
        label={numberLabel(t.key, at >= 0 ? at + 1 : group.length)}
        badgeLabel={next ? 'New' : undefined}
        placement={placementText(prevId, t.key, at < 0 && group.length === 0 && t.key !== MAIN_TRACK)}
        hasPredecessors={!!prevId && steps.some((s) => s.id === prevId)}
        mergeOptions={mergeOptionsFor(t.key, blocked, null, upstream)}
        upstream={upstream}
        labels={labels}
        initial={blankStepDraft(me && (lookups.members.some((m) => m.user_id === me.user_id) || lookups.status === 'loading') ? me : undefined)}
        editable={edit.allowed}
        reason={edit.reason}
        lookups={lookups}
        currentUser={me}
        frequency={frequency}
        schedules={timingSchedules}
        runStart={runStart}
        baseDeps={prevId && steps.some((s) => s.id === prevId) ? [prevId] : []}
        plan={timingPlan}
        onCreate={onCreate}
        onCancel={() => setAdding(null)}
        focusKey={adding.seq}
        commitRef={commitRef}
      />
      </div>
    )
  }

  const renderTrack = (t: TrackDraft) => {
    const group = layout.groups.get(t.key) ?? []
    const pending = pendingTrack?.key === t.key
    const formHere = !!adding && adding.track === t.key
    const formAtEnd = formHere && !(adding?.after && group.some((s) => s.id === adding.after))
    const wide = formHere || group.some((s) => expanded.has(s.id))
    const split = t.key !== MAIN_TRACK && t.split_from ? steps.find((s) => s.id === t.split_from) : undefined
    const issue = trackIssue?.key === t.key ? trackIssue.message : null
    const nodes: React.ReactNode[] = []
    group.forEach((s, i) => {
      const prevId = i > 0 ? group[i - 1].id : t.key === MAIN_TRACK ? null : t.split_from
      const upstream = upstreamOf(layout.pathDeps.get(s.id) ?? [], layout.deps, s.id)
      nodes.push(
        <div key={s.id} id={`step-card-${s.id}`} className="scroll-mt-40 scroll-mb-6 scroll-mx-4">
          <StepCard
            mode="edit"
            orgId={orgId}
            step={s}
            label={labels.get(s.id) ?? '?'}
            placement={placementText(prevId && steps.some((x) => x.id === prevId) ? prevId : null, t.key, i === 0 && t.key !== MAIN_TRACK)}
            hasPredecessors={i > 0 || (t.key !== MAIN_TRACK && !!split)}
            mergeOptions={mergeOptionsFor(t.key, dependentsOf(s.id, layout.deps), s.id, upstream)}
            upstream={upstream}
            labels={labels}
            editable={edit.allowed}
            reason={edit.reason}
            lookups={lookups}
            currentUser={me}
            frequency={frequency}
            schedules={timingSchedules}
            runStart={runStart}
            baseDeps={prevId && steps.some((x) => x.id === prevId) ? [prevId] : []}
            plan={timingPlan}
            expanded={expanded.has(s.id)}
            onToggle={() => toggle(s.id)}
            onUpdate={onUpdate}
            onDelete={(st) => setDeleteTarget(st)}
            canMoveUp={i > 0}
            canMoveDown={i < group.length - 1}
            onMoveUp={() => move(s.id, -1)}
            onMoveDown={() => move(s.id, 1)}
            onAddBelow={() => openAdd(t.key, s.id, undefined, cardAnchor(s.id))}
            onSplit={() => splitAt(s)}
            issue={issues.get(s.id) ?? null}
          />
        </div>,
      )
      if (formHere && adding?.after === s.id) nodes.push(renderForm(t, group))
    })
    if (formAtEnd) nodes.push(renderForm(t, group))

    // The main path needs no "where it starts"; a parallel path says what it comes after.
    const headerHint = [
      t.key === MAIN_TRACK ? null : split ? `After ${stepName(labels.get(split.id), split.title)}` : 'After start of run',
      group.length === 0 && !pending ? 'Add a step to keep it' : null,
    ]
      .filter(Boolean)
      .join('. ')
    const header = multiTrack ? (
      <div
        className={`flex flex-col gap-1.5 rounded-[12px] border px-3.5 py-2.5 ${
          issue ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E2E8F0] bg-white'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 shrink-0 text-[14px] font-semibold text-[#0F172A]">
            <GitBranch size={15} className="text-[#2563EB]" aria-hidden />
            {trackBaseLabel(t.key)}
          </span>
          {t.key !== MAIN_TRACK && (
            <PathName
              track={t}
              hint={group[0]?.title?.trim() || null}
              allowed={edit.allowed}
              reason={edit.reason}
              onRename={(name) => (pending ? renamePendingTrack(t.key, name) : setTrack(t.key, { name }))}
            />
          )}
          {t.key !== MAIN_TRACK && group.length === 0 && !pending && (
            <GatedButton allowed={edit.allowed} reason={edit.reason} icon={X} variant="quiet" className="!min-h-[40px] sm:!min-h-[34px] !px-2.5 shrink-0" onClick={() => removeTrack(t.key)}>
              Remove path
            </GatedButton>
          )}
        </div>
        {headerHint && <p className="text-[13px] text-[#475569]">{headerHint}</p>}
        {issue && <p className="text-[13px] font-medium text-[#B91C1C]">{issue}</p>}
      </div>
    ) : null

    return (
      <div
        key={t.key}
        id={`track-col-${t.key}`}
        className={`flex flex-col gap-3 min-w-0 scroll-mt-40 ${
          multiTrack
            ? `lg:transition-[flex-grow,min-width] lg:duration-300 lg:ease-in-out ${
                wide ? 'lg:flex-[2.4_1_0%] lg:min-w-[min(680px,calc(100%-2rem))]' : 'lg:flex-[1_1_0%] lg:min-w-[340px]'
              }`
            : ''
        }`}
      >
        {header}
        {nodes}
        {!formAtEnd && (group.length > 0 || t.key !== MAIN_TRACK) && (
          <div id={addBarId(t.key)} className="scroll-mt-40 scroll-mb-6">
            <AddStepBar
              allowed={edit.allowed}
              reason={edit.reason}
              // The form opens in the bar's place, held right where the bar was.
              onClick={(e) => openAdd(t.key, null, undefined, { id: FORM_ID, top: e.currentTarget.getBoundingClientRect().top })}
            >
              {multiTrack ? `Add step to ${trackLabel(t)}` : 'Add step'}
            </AddStepBar>
          </div>
        )}
      </div>
    )
  }


  /** The one primary action, at every width. */
  const primaryButton = archived ? (
    w && (
      <GatedButton allowed={rawEdit.allowed} reason={rawEdit.reason} icon={ArchiveRestore} variant="primary" onClick={() => actions.restore(w)}>
        Restore
      </GatedButton>
    )
  ) : isDraft ? (
    <GatedButton allowed={goLiveGate.allowed} reason={goLiveGate.reason} icon={Play} variant="primary" loading={saving === 'save'} disabled={!!saving} onClick={() => save('save')}>
      Save
    </GatedButton>
  ) : (
    <GatedButton
      allowed={changesGate.allowed}
      reason={changesGate.reason}
      icon={Save}
      variant="primary"
      loading={saving === 'save'}
      disabled={!!saving || pausing}
      onClick={() => save('save')}
    >
      {narrow ? 'Save' : 'Save changes'}
    </GatedButton>
  )

  /** Secondary actions — beside the primary from 640px up, in the three-dot menu below it. */
  const secondaryButtons = narrow || archived ? null : isDraft ? (
    <GatedButton allowed={draftGate.allowed} reason={draftGate.reason} icon={Save} variant="secondary" loading={saving === 'draft'} disabled={!!saving} onClick={() => save('draft')}>
      Save draft
    </GatedButton>
  ) : (
    <GatedButton
      allowed={edit.allowed}
      reason={edit.reason}
      icon={w?.status === 'paused' ? Play : Pause}
      variant="secondary"
      loading={pausing}
      disabled={!!saving}
      onClick={() => setPaused(w?.status !== 'paused')}
    >
      {pauseLabel}
    </GatedButton>
  )

  const saveState = dirty ? (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#92400E]" aria-live="polite">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[#D97706]" /> Unsaved changes
    </span>
  ) : w ? (
    <span className="text-[12px] text-[#475569]">All changes saved</span>
  ) : null

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Pinned header: title, state and the save actions. One row on a phone. */}
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-2.5 sm:pb-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <WorkflowBreadcrumb
          trail={
            w
              ? [{ label: 'Workflows', href: WORKFLOWS_BASE }, { label: w.name || 'Workflow', href: workflowHref(w.id) }, { label: 'Edit' }]
              : [{ label: 'Workflows', href: WORKFLOWS_BASE }, { label: 'New workflow' }]
          }
        />
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] sm:text-[28px] font-bold text-[#0F172A] leading-tight truncate sm:whitespace-normal sm:break-words">
              {work.name.trim() || w?.name || 'New workflow'}
            </h1>
            <div className="hidden sm:flex items-center gap-2 flex-wrap mt-1.5 min-h-[24px]">
              <TemplateStatusBadge status={w?.status ?? 'draft'} />
              <span className="text-[13px] text-[#475569]">{plural(steps.length, 'step')}</span>
              {saveState}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {secondaryButtons}
            {primaryButton}
            {w && !narrow && (
              <Link href={workflowHref(w.id)} className={BTN.quiet}>
                <Eye size={16} /> View
              </Link>
            )}
            <ActionMenu items={menuItems} label="More workflow actions" />
          </div>
        </div>
        {/* Phone: status and save state on one slim line under the title row. */}
        <div className="flex sm:hidden items-center gap-2 mt-1.5 min-w-0 text-[12px]">
          <TemplateStatusBadge status={w?.status ?? 'draft'} />
          <span className="text-[#475569] whitespace-nowrap">{plural(steps.length, 'step')}</span>
          <span className="truncate">{saveState}</span>
        </div>
      </div>

      {saveError && (
        <div className="flex flex-col gap-2">
          <ErrorBanner message={saveError} onClose={() => setSaveError(null)} />
          {conflict && (
            <button type="button" onClick={() => load()} className={`${BTN.secondary} self-start`}>
              <RefreshCw size={16} /> Reload the latest version
            </button>
          )}
        </div>
      )}
      {note}

      {/* Details */}
      <section aria-labelledby="details-heading" className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-5">
        <h2 id="details-heading" className="text-[18px] font-semibold text-[#0F172A]">
          Details
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-5">
          <div className="lg:col-span-6">
            <label htmlFor="wf-name" className={LABEL_CLS}>
              Workflow name <span className="text-[#DC2626]">*</span>
            </label>
            <input
              id="wf-name"
              value={work.name}
              maxLength={NAME_MAX}
              autoFocus={!initialId}
              disabled={detailsDisabled}
              aria-invalid={!!nameError}
              onChange={(e) => {
                const v = e.target.value
                setWork((cur) => ({ ...cur, name: v }))
                if (v.trim()) setNameError(null)
              }}
              onBlur={() => !work.name.trim() && w && setNameError('Enter a workflow name.')}
              placeholder="e.g. New joiner onboarding"
              className={`${INPUT_CLS} ${nameError ? '!border-[#DC2626] focus:!ring-[#DC2626]' : ''}`}
            />
            {nameError && <p className="mt-1.5 text-[13px] text-[#B91C1C]">{nameError}</p>}
          </div>
          <div className="lg:col-span-12">
            <label htmlFor="wf-desc" className={LABEL_CLS}>
              Description
            </label>
            <textarea
              id="wf-desc"
              value={work.description}
              maxLength={2000}
              disabled={detailsDisabled}
              rows={2}
              onChange={(e) => {
                const v = e.target.value
                setWork((cur) => ({ ...cur, description: v }))
              }}
              placeholder="What this workflow is for"
              className={`${INPUT_CLS} resize-y`}
            />
          </div>
        </div>
      </section>

      {lookups.failed.length > 0 && (
        <div className="flex items-center gap-2 text-[13px] text-[#92400E]">
          <span>Some lists didn’t load ({lookups.failed.join(', ')}). Choices may be missing.</span>
          <button type="button" onClick={lookups.reload} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {/* How it starts */}
      <StartsSection
        orgId={orgId}
        currentUser={me}
        value={work.starts}
        onChange={(starts) => {
          setWork((cur) => ({ ...cur, starts }))
          setStartsError(null)
        }}
        editable={edit.allowed}
        reason={edit.reason}
        lookups={lookups}
        knownStarters={w?.people?.starters ?? []}
        savedSchedules={w?.schedules ?? []}
        live={w?.status === 'active'}
        error={startsError?.message ?? null}
        errorScheduleIndex={startsError?.index ?? null}
      />

      {/* Steps */}
      <section aria-labelledby="steps-heading" className="flex flex-col gap-3 scroll-mt-40">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 id="steps-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A] scroll-mt-40">
              Steps <InfoTip label="Steps" text="Each step becomes a task. Parallel paths run at the same time." />
            </h2>
          </div>
          {steps.length >= LONG_LIST && (
            <GatedButton allowed={edit.allowed} reason={edit.reason} icon={Plus} variant="secondary" onClick={() => openAdd(MAIN_TRACK)}>
              Add step
            </GatedButton>
          )}
        </div>

        {steps.length >= 1 && (
          <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <button
              type="button"
              aria-expanded={flowOpen}
              aria-controls="flow-preview"
              onClick={() => setFlowOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-[12px] hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <GitBranch size={16} className="text-[#2563EB]" />
              <span className="text-[15px] font-semibold text-[#0F172A]">Flow</span>
              <ChevronDown size={16} className={`ml-auto shrink-0 text-[#475569] transition-transform duration-200 ${flowOpen ? 'rotate-180' : ''}`} />
            </button>
            <Reveal open={flowOpen} id="flow-preview">
              <div className="px-4 pb-4 pt-1 border-t border-[#F1F5F9]">
                <StepFlow steps={steps} tracks={work.tracks} memberName={memberName} onOpen={(s) => focusStep(s.id)} frequency={frequency} schedules={timingSchedules} compact />
              </div>
            </Reveal>
          </div>
        )}

        {timingIssues.length > 0 && (
          <div role="status" className="flex flex-col gap-1.5 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {timingIssues.length === 1 ? '1 step needs' : `${timingIssues.length} steps need`} a timing change before saving.
              </span>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 pl-6">
              {timingIssues.map(({ step: s }) => (
                <button key={s.id} type="button" onClick={() => focusStep(s.id)} className="font-semibold underline text-left">
                  {stepName(labels.get(s.id), s.title)}
                </button>
              ))}
            </span>
          </div>
        )}

        {steps.length >= 1 && (
          <ExampleRun
            orgId={orgId}
            definition={exampleDefinition}
            manualOnly={frequency.type === 'manual'}
            order={layout.order}
            labels={labels}
            shownElsewhere={timingIssueTexts}
            onOpenStep={(key) => {
              if (steps.some((s) => s.id === key)) focusStep(key)
            }}
          />
        )}

        {steps.length === 0 && !adding && (
          <div id="steps-empty" className="bg-white border border-dashed border-[#CBD5E1] rounded-[12px]">
            <EmptyState
              icon={ListChecks}
              title="No steps yet"
              text={edit.allowed === true ? 'Add a step to get started.' : 'This workflow has no steps.'}
              action={
                edit.allowed === true ? (
                  <button
                    type="button"
                    // The form takes the empty box's place, starting where the box did.
                    onClick={() => {
                      const box = document.getElementById('steps-empty')
                      openAdd(MAIN_TRACK, null, undefined, box ? { id: FORM_ID, top: box.getBoundingClientRect().top } : null)
                    }}
                    className={BTN.secondary}
                  >
                    <Plus size={16} /> Add first step
                  </button>
                ) : undefined
              }
            />
          </div>
        )}

        {(steps.length > 0 || adding) && (
          <div
            id="tracks"
            className={
              multiTrack
                ? 'flex flex-col lg:flex-row lg:items-start gap-5 lg:gap-4 lg:overflow-x-auto lg:-mx-1 lg:px-1 lg:pb-2'
                : 'flex flex-col gap-3'
            }
          >
            {columns.map((t) => renderTrack(t))}
          </div>
        )}
      </section>

      {/* People */}
      <PeopleSection
        orgId={orgId}
        currentUser={me}
        value={work.people}
        onChange={(people) => setWork((cur) => ({ ...cur, people }))}
        allowed={archived && peopleGate.allowed === true ? false : peopleGate.allowed}
        reason={archived ? RESTORE_FIRST : peopleGate.reason}
        lookups={lookups}
        known={[...(w?.people?.owners ?? w?.owners ?? []), ...(w?.people?.editors ?? [])]}
      />

      {actions.dialogs}
      {guard.dialog}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${stepName(deleteTarget ? labels.get(deleteTarget.id) : null, deleteTarget?.title || 'Untitled step')}?`}
        message={
          deleteTarget
            ? [...deleteEffects(deleteTarget), isNewKey(deleteTarget.id) ? '' : 'Removed when you save. Runs in progress are not affected.']
                .filter(Boolean)
                .join(' ')
            : ''
        }
        confirmLabel="Delete step"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
