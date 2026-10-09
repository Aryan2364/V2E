'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, ArchiveRestore, ChevronDown, Eye, GitBranch, Info, ListChecks, Pause, Play, Plus, RefreshCw, Save } from 'lucide-react'
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
import StepCard, { INPUT_CLS, LABEL_CLS, blankStepDraft } from './StepCard'
import StepFlow, { orderSteps, stepNumbers } from './StepFlow'
import { findCycle, spliceOutStep } from './flow'
import { cleanRule, dueRuleOf, frequencyOf, startRuleOf, stepTimingMessage, timingProblems, type Frequency } from './timing'
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

interface AddingAt {
  after: string | null
  seq: number
}

/** Everything the builder edits — the whole workflow, saved in one request. */
interface Working {
  name: string
  description: string
  starts: StartsValue
  people: PeopleValue
  /** Display order. Steps not saved yet have a client key ("new-…") as their id. */
  steps: WorkflowStep[]
}

const isNewKey = (id: string) => id.startsWith(NEW_KEY)
let keySeq = 0
const newKey = () => `${NEW_KEY}${Date.now().toString(36)}-${(keySeq += 1)}`

function workingFrom(w: WorkflowTemplate): Working {
  const schedules = (w.schedules ?? []).map(scheduleToDraft)
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
    steps: orderSteps(w.steps ?? []),
  }
}

function blankWorking(me: string | undefined): Working {
  // A new workflow's owner is its creator, who is also pre-picked to start it by hand.
  return {
    name: '',
    description: '',
    starts: { manual: true, starterIds: me ? [me] : [], scheduleOn: false, schedules: [] },
    people: { ownerIds: me ? [me] : [], editorIds: [] },
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

function stepInput(s: WorkflowStep): DefinitionStepInput {
  return {
    key: s.id,
    ...(isNewKey(s.id) ? {} : { id: s.id }),
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
    depends_on: s.depends_on_step_ids ?? [],
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
  return {
    name: work.name.trim(),
    description: work.description.trim() || null,
    mode,
    starts: {
      manual: { enabled: work.starts.manual, starter_user_ids: work.starts.starterIds },
      schedules: work.starts.scheduleOn ? work.starts.schedules.map(scheduleInput) : [],
    },
    steps: work.steps.map(stepInput),
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
  title: 'Give the step a title.',
  assignee: 'Assign it to at least one person.',
  escalation: "Pick at least one person to escalate to, or escalate to the assignee's manager.",
}

/**
 * The one-page workflow builder, for a new workflow and an existing one. It edits a
 * working copy of the whole workflow — details, how it starts, steps (incl. "Starts
 * after" between steps not saved yet) and people — and saves it in ONE request:
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
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStep | null>(null)
  const [flowOpen, setFlowOpen] = useState(true)
  const [saving, setSaving] = useState<'draft' | 'save' | null>(null)
  const [pausing, setPausing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [issues, setIssues] = useState<Map<string, string>>(new Map())
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
    archived && rawEdit.allowed === true ? { allowed: false as const, reason: 'Restore this workflow before changing it.' } : rawEdit
  const peopleGate = workflow ? gate(caps?.can_manage_access, writable, REASONS.manageAccess) : edit
  const canSendPeople = !workflow || caps?.can_manage_access === true

  const steps = work.steps
  const numbers = useMemo(() => stepNumbers(steps), [steps])
  // How it repeats — from the schedules being edited — decides which timing steps may use.
  const timingSchedules = useMemo(() => (work.starts.scheduleOn ? work.starts.schedules : []), [work.starts.scheduleOn, work.starts.schedules])
  const freqKey = JSON.stringify(frequencyOf(timingSchedules))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frequency = useMemo<Frequency>(() => JSON.parse(freqKey), [freqKey])
  /** Steps whose timing this frequency does not allow (or whose dates are incomplete). */
  const timingIssues = useMemo(
    () =>
      steps
        .map((s) => ({ step: s, problems: timingProblems(startRuleOf(s), dueRuleOf(s), frequency) }))
        .filter((x) => x.problems.length > 0),
    [steps, frequency],
  )
  /** The same problems in the server's words (its example-run warnings repeat them). */
  const timingIssueTexts = useMemo(
    () =>
      new Set(
        timingIssues.flatMap(({ step, problems }) => {
          const i = steps.indexOf(step)
          const t = step.title?.trim()
          const label = t ? `Step ${i + 1} “${t}”` : `Step ${i + 1}`
          return problems.map((p) => stepTimingMessage(label, p))
        }),
      ),
    [timingIssues, steps],
  )
  const memberName = useCallback((uid: string) => lookups.members.find((m) => m.user_id === uid)?.name, [lookups.members])
  const me = user ? { user_id: user.id, name: user.name } : undefined

  // ── Editing the working copy ──
  const setSteps = (fn: (list: WorkflowStep[]) => WorkflowStep[]) =>
    setWork((w) => ({ ...w, steps: fn(w.steps).map((s, i) => (s.order_index === i ? s : { ...s, order_index: i })) }))

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

  /** Open the new-step form: other cards fold away, the form opens where the step will go. */
  const openAdd = (after: string | null = null) => {
    setExpanded(new Set())
    addSeq.current += 1
    setAdding({ after, seq: addSeq.current })
  }

  /**
   * Add a step to the working copy. "Add step below" a step puts the new one right after
   * it: it starts after that step, and the steps that started after it now start after
   * the new one.
   */
  async function onCreate(input: StepInput) {
    const key = newKey()
    const now = new Date().toISOString()
    const after = adding?.after && steps.some((s) => s.id === adding.after) ? adding.after : null
    const created: WorkflowStep = {
      id: key,
      organization_id: orgId,
      workflow_template_id: workflow?.id ?? '',
      order_index: steps.length,
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
      depends_on_step_ids: input.depends_on_step_ids ?? [],
      start_rule: input.start_rule ?? null,
      due_rule: input.due_rule ?? null,
      assigner_user_id: null,
      created_at: now,
      updated_at: now,
    }
    setSteps((list) => {
      if (!after) return [...list, created]
      const at = list.findIndex((s) => s.id === after)
      const startsAfterTarget = created.depends_on_step_ids.length === 1 && created.depends_on_step_ids[0] === after
      const relinked = startsAfterTarget
        ? list.map((s) =>
            (s.depends_on_step_ids ?? []).includes(after)
              ? { ...s, depends_on_step_ids: s.depends_on_step_ids.map((d) => (d === after ? key : d)) }
              : s,
          )
        : list
      return [...relinked.slice(0, at + 1), created, ...relinked.slice(at + 1)]
    })
    setAdding(null)
    setExpanded(new Set([key]))
    setSaveError(null)
    requestAnimationFrame(() => document.getElementById(`step-card-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
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
    setTimeout(() => document.getElementById(`step-card-${stepId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
  }

  function move(stepId: string, dir: -1 | 1) {
    setSteps((list) => {
      const i = list.findIndex((s) => s.id === stepId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setSteps((list) => {
      const deps = spliceOutStep(
        list.map((s) => ({ id: s.id, deps: s.depends_on_step_ids ?? [] })),
        id,
      )
      return list.filter((s) => s.id !== id).map((s) => ({ ...s, depends_on_step_ids: deps.get(s.id) ?? s.depends_on_step_ids }))
    })
    clearIssue(id)
    setDeleteTarget(null)
  }

  // ── Saving ──
  /** Step problems the server would refuse on Save, found here first so they show at once. */
  function localStepProblems(): { message: string; stepId: string | null; perStep: Map<string, string> } | null {
    if (steps.length === 0) return { message: 'Add at least one step before saving.', stepId: null, perStep: new Map() }
    const perStep = new Map<string, string>()
    let first: { message: string; stepId: string } | null = null
    steps.forEach((s, i) => {
      const t = s.title?.trim()
      const label = t ? `Step ${i + 1} “${t}”` : `Step ${i + 1}`
      const why = !t
        ? SAVE_STEP_MSG.title
        : !(s.assignee_user_ids ?? []).length
          ? SAVE_STEP_MSG.assignee
          : s.escalation_mode === 'people' && !(s.escalation_user_ids ?? []).length
            ? SAVE_STEP_MSG.escalation
            : null
      const timing = timingProblems(startRuleOf(s), dueRuleOf(s), frequency)[0]
      const msg = why ? `${label}: ${why}` : timing ? stepTimingMessage(label, timing) : null
      if (msg) {
        perStep.set(s.id, msg)
        if (!first) first = { message: msg, stepId: s.id }
      }
    })
    const loop = findCycle(steps.map((s) => ({ id: s.id, deps: s.depends_on_step_ids ?? [] })))
    if (loop && !first) {
      const msg = `Steps ${loop.map((sid) => numbers.get(sid)).join(', ')} start after each other in a loop. Change one “Starts after”.`
      loop.forEach((sid) => perStep.set(sid, msg))
      first = { message: msg, stepId: loop[0] }
    }
    if (!first && !steps.some((s) => !(s.depends_on_step_ids ?? []).length)) {
      first = { message: 'At least one step must start when the workflow starts (nothing in “Starts after”).', stepId: steps[0].id }
      perStep.set(steps[0].id, first.message)
    }
    return first ? { ...(first as { message: string; stepId: string }), perStep } : null
  }

  function showStepProblem(message: string, stepId: string | null, perStep?: Map<string, string>) {
    setSaveError(message)
    setIssues(perStep ?? (stepId ? new Map([[stepId, message]]) : new Map()))
    if (stepId) focusStep(stepId)
    else requestAnimationFrame(() => document.getElementById('steps-heading')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
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
    // Let a field being typed in finish (e.g. a days box that reverts on leave).
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    await new Promise((r) => setTimeout(r, 0))

    if (!work.name.trim()) {
      setNameError('Enter a name for the workflow.')
      document.getElementById('wf-name')?.focus()
      return false
    }
    const full = mode === 'save' || live
    if (full) {
      if (work.starts.manual && work.starts.starterIds.length === 0) {
        showStartsProblem('Pick who can start this workflow by hand.', null)
        return false
      }
      if (!work.starts.manual && !(work.starts.scheduleOn && work.starts.schedules.length)) {
        showStartsProblem('Choose how this workflow starts.', null)
        return false
      }
      const problem = localStepProblems()
      if (problem) {
        showStepProblem(problem.message, problem.stepId, problem.perStep)
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
            ? 'Workflow saved. It is live now.'
            : 'Changes saved',
        'success',
      )
      const savedNumbers = stepNumbers(saved.steps ?? [])
      const nameOf = (key: string) => {
        const id = saved.step_keys?.[key] ?? key
        const st = (saved.steps ?? []).find((x) => x.id === id)
        return `Step ${savedNumbers.get(id) ?? '?'}${st?.title?.trim() ? ` “${st.title.trim()}”` : ''}`
      }
      const warnings = (saved.warnings ?? []).map((x) => warningText(x, nameOf)).filter(Boolean)
      if (warnings.length) {
        addToast(warnings.length === 1 ? `Worth a look: ${warnings[0]}` : `${warnings.length} things worth a look — see the example run under Steps.`, 'warning')
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
        pause
          ? 'Workflow paused. Nothing new starts and its schedules skip; runs under way carry on.'
          : 'Workflow resumed. It can be started again, and its schedules run from now on.',
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
        <span>You can view this workflow. {REASONS.edit}</span>
      </div>
    ) : archived ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#334155]">
        <Archive size={16} className="shrink-0 mt-0.5 text-[#475569]" />
        <span>This workflow is archived, so it cannot be started or changed. Restore it to work on it again — it comes back as a draft.</span>
      </div>
    ) : w?.status === 'paused' ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FDE68A] bg-[#FEFCE8] px-3.5 py-2.5 text-sm text-[#713F12]">
        <Pause size={16} className="shrink-0 mt-0.5" />
        <span>This workflow is paused: nothing new starts and its schedules skip. Runs under way carry on. Resume it to start runs again.</span>
      </div>
    ) : w?.status === 'active' && edit.allowed === true ? (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-2.5 text-sm text-[#1E3A8A]">
        <Info size={16} className="shrink-0 mt-0.5" />
        <span>This workflow is live. Saved changes apply to runs started from then on; runs under way keep the steps they started with.</span>
      </div>
    ) : null

  // The example run works from what is on screen. Name and description don't change the
  // dates, so typing them doesn't ask for a new example.
  const exampleDefinition = steps.length ? { ...definitionOf(work, 'draft', false), name: 'Example run', description: null } : null

  const insertAt = adding?.after && steps.some((s) => s.id === adding.after) ? adding.after : null
  const addingAtEnd = !!adding && !insertAt

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
              onBlur={() => !work.name.trim() && w && setNameError('Enter a name for the workflow.')}
              placeholder="e.g. New joiner onboarding"
              className={`${INPUT_CLS} ${nameError ? '!border-[#DC2626] focus:!ring-[#DC2626]' : ''}`}
            />
            {nameError ? (
              <p className="mt-1.5 text-[13px] text-[#B91C1C]">{nameError}</p>
            ) : !w ? (
              <p className="mt-1.5 text-[13px] text-[#475569]">Nothing is saved until you choose Save draft or Save.</p>
            ) : null}
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
              placeholder="What this workflow is for and when it should be used"
              className={`${INPUT_CLS} resize-y`}
            />
          </div>
        </div>
      </section>

      {lookups.failed.length > 0 && (
        <div className="flex items-center gap-2 text-[13px] text-[#92400E]">
          <span>Some lists could not be loaded ({lookups.failed.join(', ')}), so some choices may be missing.</span>
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
            <h2 id="steps-heading" className="text-[18px] font-semibold text-[#0F172A] scroll-mt-40">
              Steps <span className="text-[14px] font-normal text-[#475569]">· {plural(steps.length, 'step')}</span>
            </h2>
            <p className="text-[13px] text-[#475569]">
              Each step is a task the workflow creates when its turn comes. Use “Starts after” to run steps side by side or wait for several.
            </p>
          </div>
          {steps.length >= LONG_LIST && (
            <GatedButton allowed={edit.allowed} reason={edit.reason} icon={Plus} variant="secondary" onClick={() => openAdd()}>
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
              <span className="text-[13px] text-[#475569] truncate">How the steps follow each other. Select a step to edit it.</span>
              <ChevronDown size={16} className={`ml-auto shrink-0 text-[#475569] transition-transform duration-200 ${flowOpen ? 'rotate-180' : ''}`} />
            </button>
            <Reveal open={flowOpen} id="flow-preview">
              <div className="px-4 pb-4 pt-1 border-t border-[#F1F5F9]">
                <StepFlow steps={steps} memberName={memberName} onOpen={(s) => focusStep(s.id)} frequency={frequency} compact />
              </div>
            </Reveal>
          </div>
        )}

        {timingIssues.length > 0 && (
          <div role="status" className="flex flex-col gap-1.5 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {timingIssues.length === 1 ? 'One step’s timing needs' : `${timingIssues.length} steps’ timing needs`} a change before the workflow can be
                saved — usually because how it repeats has changed.
              </span>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 pl-6">
              {timingIssues.map(({ step: s }) => (
                <button key={s.id} type="button" onClick={() => focusStep(s.id)} className="font-semibold underline text-left">
                  Step {numbers.get(s.id)}
                  {s.title?.trim() ? ` “${s.title.trim()}”` : ''}
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
            order={numbers}
            shownElsewhere={timingIssueTexts}
            onOpenStep={(key) => {
              if (steps.some((s) => s.id === key)) focusStep(key)
            }}
          />
        )}

        {steps.length === 0 && !adding && (
          <div className="bg-white border border-dashed border-[#CBD5E1] rounded-[12px]">
            <EmptyState
              icon={ListChecks}
              title="No steps yet"
              text={edit.allowed === true ? 'Add the first step: what needs doing, who does it, and when it is due.' : 'This workflow has no steps yet.'}
              action={
                edit.allowed === true ? (
                  <button type="button" onClick={() => openAdd()} className={BTN.secondary}>
                    <Plus size={16} /> Add the first step
                  </button>
                ) : undefined
              }
            />
          </div>
        )}

        {(() => {
          const form = adding ? (
            <StepCard
              key="new-step"
              mode="create"
              orgId={orgId}
              number={insertAt ? (numbers.get(insertAt) ?? 0) + 1 : steps.length + 1}
              badgeLabel={insertAt && steps[steps.length - 1]?.id !== insertAt ? 'New' : undefined}
              initial={blankStepDraft(
                insertAt ? [insertAt] : steps.length ? [steps[steps.length - 1].id] : [],
                me && (lookups.members.some((m) => m.user_id === me.user_id) || lookups.status === 'loading') ? me : undefined,
              )}
              editable={edit.allowed}
              reason={edit.reason}
              lookups={lookups}
              allSteps={steps}
              numbers={numbers}
              currentUser={me}
              frequency={frequency}
              schedules={timingSchedules}
              onCreate={onCreate}
              onCancel={() => setAdding(null)}
              focusKey={adding.seq}
            />
          ) : null
          const nodes: React.ReactNode[] = []
          steps.forEach((s, i) => {
            nodes.push(
              <div key={s.id} id={`step-card-${s.id}`} className="scroll-mt-40 scroll-mb-6">
                <StepCard
                  mode="edit"
                  orgId={orgId}
                  step={s}
                  number={i + 1}
                  editable={edit.allowed}
                  reason={edit.reason}
                  lookups={lookups}
                  allSteps={steps}
                  numbers={numbers}
                  currentUser={me}
                  frequency={frequency}
                  schedules={timingSchedules}
                  expanded={expanded.has(s.id)}
                  onToggle={() => toggle(s.id)}
                  onUpdate={onUpdate}
                  onDelete={(st) => setDeleteTarget(st)}
                  canMoveUp={i > 0}
                  canMoveDown={i < steps.length - 1}
                  onMoveUp={() => move(s.id, -1)}
                  onMoveDown={() => move(s.id, 1)}
                  onAddBelow={() => openAdd(s.id)}
                  issue={issues.get(s.id) ?? null}
                />
              </div>,
            )
            if (insertAt === s.id && form) nodes.push(form)
          })
          if (addingAtEnd && form) nodes.push(form)
          return nodes
        })()}

        {steps.length > 0 && !addingAtEnd && (
          <AddStepBar allowed={edit.allowed} reason={edit.reason} onClick={() => openAdd()}>
            Add step
          </AddStepBar>
        )}
      </section>

      {/* People */}
      <PeopleSection
        orgId={orgId}
        currentUser={me}
        value={work.people}
        onChange={(people) => setWork((cur) => ({ ...cur, people }))}
        allowed={archived && peopleGate.allowed === true ? false : peopleGate.allowed}
        reason={archived ? 'Restore this workflow before changing it.' : peopleGate.reason}
        lookups={lookups}
        known={[...(w?.people?.owners ?? w?.owners ?? []), ...(w?.people?.editors ?? [])]}
      />

      {actions.dialogs}
      {guard.dialog}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete “${deleteTarget?.title || 'Untitled step'}”?`}
        message={
          deleteTarget
            ? `${
                steps.some((s) => (s.depends_on_step_ids ?? []).includes(deleteTarget.id))
                  ? 'The steps that started after it will start after the steps before it instead. '
                  : ''
              }${isNewKey(deleteTarget.id) ? '' : 'It is removed when you save. Runs already under way are not changed.'}`
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
