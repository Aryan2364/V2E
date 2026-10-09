'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckSquare, Clock, FileText, FolderOpen, MessageSquare, Play, RefreshCw, RotateCcw, Users, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage, workflowErrorStatus } from '@/lib/api/workflows'
import type { WorkflowInstance, WorkflowInstanceStep } from '@/lib/types/workflows'
import ActionMenu, { type ActionMenuItem } from './ActionMenu'
import FlowDiagram, { type EdgeTone, type FlowDiagramNode, type FlowLane, type FlowTone } from './FlowDiagram'
import { runLayout } from './tracks'
import { ProgressBar, instanceProgress } from './InstanceList'
import RunDocumentsDrawer from './RunDocumentsDrawer'
import RunHistory from './RunHistory'
import RunStepDrawer from './RunStepDrawer'
import InstanceNotes, { useInstanceNotes } from './InstanceNotes'
import { instanceTitle } from './instanceLabel'
import SendBackDialog, { type SendBackSubject } from './SendBackDialog'
import {
  BTN,
  ErrorBanner,
  ErrorState,
  GatedButton,
  InfoTip,
  NotFoundState,
  REASONS,
  RunStatusBadge,
  STEP_STATUS,
  Skeleton,
  WORKFLOWS_BASE,
  WorkflowBreadcrumb,
  fmtDateTime,
  fmtDayDateTime,
  fmtSpan,
  gate,
  namesSummary,
  instancesHref,
  useNarrowScreen,
  useWorkflowsWritable,
  workflowHref,
} from './shared'

type RunAction = { kind: 'cancel' } | { kind: 'retry' } | { kind: 'skip'; row: WorkflowInstanceStep }

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Started manually',
  manual_trigger: 'Started manually',
  schedule: 'Started by schedule',
  // Older runs (start types that no longer exist).
  date_trigger: 'Started by schedule',
  task_completed_trigger: 'Started when a task was completed',
  task_overdue_trigger: 'Started when a task became overdue',
}

const SATISFIED = new Set(['completed', 'skipped', 'moved_on'])
const LIVE_ROW = new Set(['active', 'overdue', 'sent_back', 'moved_on'])

const TONE: Record<string, FlowTone> = {
  completed: 'done',
  active: 'current',
  overdue: 'attention',
  moved_on: 'attention',
  sent_back: 'waiting',
  skipped: 'skipped',
  pending: 'upcoming',
  branched: 'default',
}

/** A pending row with a start time: it starts by itself then (or when someone starts it now). */
export const isWaitingRow = (r: Pick<WorkflowInstanceStep, 'status' | 'start_at' | 'waiting'>) =>
  typeof r.waiting === 'boolean' ? r.waiting : r.status === 'pending' && !!r.start_at

/** Rows of an older run carry no links: they ran one after another. */
function rowDeps(rows: WorkflowInstanceStep[]): Map<string, string[]> {
  const ordered = rows.slice().sort((a, b) => a.order_index - b.order_index)
  const v2 = rows.some((r) => Array.isArray(r.depends_on_row_ids))
  return new Map(ordered.map((r, i) => [r.id, v2 ? r.depends_on_row_ids ?? [] : i > 0 ? [ordered[i - 1].id] : []]))
}

/** Every row this row (directly or not) starts after. */
function upstreamOf(id: string, deps: Map<string, string[]>): Set<string> {
  const out = new Set<string>()
  const stack = [...(deps.get(id) ?? [])]
  while (stack.length) {
    const d = stack.pop()!
    if (out.has(d)) continue
    out.add(d)
    stack.push(...(deps.get(d) ?? []))
  }
  return out
}

/**
 * A run: its steps as a flow (done steps plain, current ones highlighted, the rest faded;
 * steps running side by side shown side by side), each opening into its details. The
 * run's documents and history sit alongside.
 */
export default function RunView({ templateId, instanceId }: { templateId: string; instanceId: string }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()
  const writable = useWorkflowsWritable()
  const narrow = useNarrowScreen()

  const [run, setRun] = useState<WorkflowInstance | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'notfound'>('loading')
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [openRowId, setOpenRowId] = useState<string | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)
  const [docCount, setDocCount] = useState<number | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [action, setAction] = useState<RunAction | null>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sendBack, setSendBack] = useState<SendBackSubject | null>(null)
  const [startingRowId, setStartingRowId] = useState<string | null>(null)

  const load = useCallback(
    async (quiet = false) => {
      if (!orgId) return
      if (quiet) setRefreshing(true)
      else setStatus('loading')
      try {
        const data = await workflowsApi.getInstance(orgId, templateId, instanceId)
        setRun(data)
        setStatus('ready')
        if (quiet) setHistoryKey((k) => k + 1)
      } catch (e) {
        if (quiet) {
          addToast(workflowErrorMessage(e, 'The instance could not be refreshed.'), 'error')
        } else if (workflowErrorStatus(e) === 404 || workflowErrorStatus(e) === 403) {
          setStatus('notfound')
        } else {
          setLoadError(workflowErrorMessage(e, 'Check your connection and try again.'))
          setStatus('failed')
        }
      } finally {
        setRefreshing(false)
      }
    },
    [orgId, templateId, instanceId, addToast],
  )

  useEffect(() => {
    load()
  }, [load])

  // Notes: listed on the page; a step's own notes also show in its panel.
  const notes = useInstanceNotes(orgId, templateId, instanceId, status === 'ready')
  const myId = user?.id

  // The Documents button shows how many files the instance has, before it is opened.
  const canSeeDocs = run?.capabilities?.can_view_documents !== false
  useEffect(() => {
    if (!orgId || !canSeeDocs) return
    workflowsApi
      .getDocuments(orgId, templateId, instanceId)
      .then((d) => setDocCount((d?.run_files?.length ?? 0) + (d?.step_files ?? []).reduce((n, g) => n + (g.files?.length ?? 0), 0)))
      .catch(() => setDocCount(null))
  }, [orgId, templateId, instanceId, historyKey, canSeeDocs])

  // A live run moves while it is open: refresh quietly every 30 s while the tab is visible.
  const live = run?.status === 'running' || run?.status === 'stuck'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !openRowId && !docsOpen && !action && !sendBack) load(true)
    }, 30000)
    return () => clearInterval(t)
  }, [live, load, openRowId, docsOpen, action, sendBack])

  const rows = useMemo(() => (run?.steps ?? []).filter((r) => !r.is_branch).sort((a, b) => a.order_index - b.order_index), [run?.steps])
  const followUps = useMemo(() => (run?.steps ?? []).filter((r) => r.is_branch), [run?.steps])
  const deps = useMemo(() => rowDeps(rows), [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  // Lanes (tracks) and each step's number ("1", "B2") as frozen when the run started.
  const { lanes, laneOf, labels } = useMemo(() => runLayout(rows, run?.tracks), [rows, run?.tracks])
  const flowLanes: FlowLane[] = useMemo(
    () =>
      lanes.map((l) => {
        const first = rows.find((r) => laneOf.get(r.id) === l.key)
        const from = first ? (deps.get(first.id) ?? [])[0] : undefined
        return {
          key: l.key,
          label: l.label,
          hint: l.key === 'main' ? undefined : from && laneOf.get(from) !== l.key ? `After ${labels.get(from) ?? '?'}` : 'From the start',
        }
      }),
    [lanes, rows, laneOf, labels, deps],
  )
  const nameOf = useCallback(
    (id: string | null | undefined) => {
      const r = id ? byId.get(id) : undefined
      return r ? `${labels.get(r.id) ?? ''} “${r.title || 'Untitled step'}”`.trim() : null
    },
    [byId, labels],
  )
  const openRow = openRowId ? byId.get(openRowId) ?? null : null

  const caps = run?.capabilities ?? { can_cancel: false, can_retry: false, can_skip: false }
  const cancelGate = gate(caps.can_cancel, writable, REASONS.runActions)
  const retryGate = gate(caps.can_retry, writable, REASONS.runActions)
  const skipGate = gate(caps.can_skip, writable, REASONS.runActions)

  /**
   * Start now: only for a waiting row the server lists (its steps before it are done and
   * the caller may manage the run). Hidden otherwise; turned off in preview mode.
   */
  const startNowAllowed = (row: WorkflowInstanceStep): boolean | undefined => {
    if (!isWaitingRow(row) || !caps.can_start_now_row_ids?.includes(row.id)) return undefined
    if (writable === false) return false
    return writable === undefined ? undefined : true
  }

  async function startNow(row: WorkflowInstanceStep) {
    if (startingRowId || !run) return
    setStartingRowId(row.id)
    try {
      const updated = await workflowsApi.startStepNow(orgId, templateId, run.id, row.id)
      if (updated?.steps) setRun(updated)
      addToast(`“${row.title || 'Step'}” started`, 'success')
      await load(true)
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The step could not be started. Try again.'), 'error')
      load(true)
    } finally {
      setStartingRowId(null)
    }
  }

  /** Send back: only from a live row that has a finished step before it. */
  const sendBackAllowed = (row: WorkflowInstanceStep): boolean | undefined => {
    const hasEarlierDone = Array.from(upstreamOf(row.id, deps)).some((d) => byId.get(d)?.status === 'completed')
    if (!hasEarlierDone || !LIVE_ROW.has(row.status) || row.status === 'sent_back') return undefined
    if (writable === false) return false
    if (!caps.can_send_back_from) return undefined
    return caps.can_send_back_from.includes(row.id)
  }

  const nodes: FlowDiagramNode[] = useMemo(
    () =>
      rows.map((r) => {
        const n = labels.get(r.id) ?? '?'
        const ds = deps.get(r.id) ?? []
        const lane = laneOf.get(r.id)
        const firstInLane = rows.find((x) => laneOf.get(x.id) === lane)?.id === r.id
        // Steps in other lanes it also waits for (the first step of a lane waits for its split step — not a merge).
        const also = ds.filter((d, i) => laneOf.get(d) !== lane && !(firstInLane && i === 0)).map((d) => labels.get(d) ?? '?')
        const people = r.assignees?.length ? r.assignees : r.assigned_to ? [r.assigned_to] : []
        const deadline = r.task?.deadline ?? r.scheduled_at
        const t = r.task
        const label = STEP_STATUS[r.status]?.label ?? 'Not started'
        return {
          id: r.id,
          deps: ds,
          order: r.order_index,
          lane,
          alsoWaitsFor: also,
          label: `Step ${n}: ${r.title || 'Untitled step'}, ${label}. Open details`,
          tone: TONE[r.status] ?? 'default',
          selected: openRowId === r.id,
          onClick: () => setOpenRowId(r.id),
          content: (
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <span
                  className={`mt-0.5 min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 ${
                    r.status === 'completed' ? 'bg-[#16A34A] text-white' : r.status === 'pending' ? 'bg-[#E2E8F0] text-[#334155]' : 'bg-[#2563EB] text-white'
                  }`}
                >
                  {n}
                </span>
                <span className="text-[14px] font-semibold text-[#0F172A] leading-snug line-clamp-2 break-words">{r.title || 'Untitled step'}</span>
              </div>
              <span
                className={`text-[12px] font-medium ${
                  r.status === 'overdue' || r.status === 'moved_on'
                    ? 'text-[#B91C1C]'
                    : r.status === 'sent_back'
                      ? 'text-[#5B21B6]'
                      : r.status === 'completed'
                        ? 'text-[#15803D]'
                        : r.status === 'active'
                          ? 'text-[#1D4ED8]'
                          : 'text-[#475569]'
                }`}
              >
                {r.status === 'sent_back'
                  ? `Waiting for info from ${nameOf(r.waiting_on_row_id) ?? 'an earlier step'}`
                  : isWaitingRow(r)
                    ? 'Waiting to start'
                    : label}
                {r.returned_to_row_id ? ' · sent back here' : ''}
              </span>
              {people.length > 0 && (
                <span className="flex items-center gap-1.5 text-[12px] text-[#334155] min-w-0">
                  <Users size={12} className="shrink-0 text-[#475569]" />
                  <span className="truncate">{namesSummary(people, 2)}</span>
                </span>
              )}
              {isWaitingRow(r) && (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#1E3A8A]">
                  <CalendarClock size={12} className="shrink-0" />
                  Starts {fmtDayDateTime(r.start_at)}
                </span>
              )}
              {(r.completed_at || (deadline && r.status !== 'pending')) && (
                <span className="flex items-center gap-1.5 text-[12px] text-[#334155]">
                  <Clock size={12} className="shrink-0 text-[#475569]" />
                  {r.completed_at ? `Done ${fmtDateTime(r.completed_at)}` : `Due ${fmtDateTime(deadline)}`}
                </span>
              )}
              {(r.planned_start_at || r.planned_due_at) &&
                (isWaitingRow(r) && r.planned_start_at && r.start_at && new Date(r.planned_start_at).getTime() === new Date(r.start_at).getTime() ? (
                  // Its start is already said above: only the planned due date is new.
                  r.planned_due_at && <span className="text-[12px] text-[#475569] leading-snug">Planned due: {fmtDayDateTime(r.planned_due_at)}</span>
                ) : (
                  <span className="text-[12px] text-[#475569] leading-snug">Planned: {fmtSpan(r.planned_start_at, r.planned_due_at)}</span>
                ))}
              {t && (t.checklist_total > 0 || t.proof_count > 0 || t.comment_count > 0) && (
                <span className="flex items-center gap-3 text-[12px] text-[#334155]">
                  {t.checklist_total > 0 && (
                    <span className="inline-flex items-center gap-1" title="Checklist">
                      <CheckSquare size={12} className="text-[#475569]" /> {t.checklist_done}/{t.checklist_total}
                    </span>
                  )}
                  {t.proof_count > 0 && (
                    <span className="inline-flex items-center gap-1" title="Proof files">
                      <FileText size={12} className="text-[#475569]" /> {t.proof_count}
                    </span>
                  )}
                  {t.comment_count > 0 && (
                    <span className="inline-flex items-center gap-1" title="Comments">
                      <MessageSquare size={12} className="text-[#475569]" /> {t.comment_count}
                    </span>
                  )}
                </span>
              )}
            </div>
          ),
        }
      }),
    [rows, deps, labels, laneOf, nameOf, openRowId],
  )

  const edgeTone = useCallback(
    (from: string, to: string): EdgeTone => {
      const f = byId.get(from)
      const t = byId.get(to)
      if (f && SATISFIED.has(f.status)) return 'done'
      if (t?.status === 'pending') return 'muted'
      return 'default'
    },
    [byId],
  )

  async function runAction() {
    if (!action || !run) return
    setActing(true)
    setActionError(null)
    try {
      if (action.kind === 'cancel') await workflowsApi.cancelInstance(orgId, templateId, run.id)
      if (action.kind === 'retry') await workflowsApi.retryInstance(orgId, templateId, run.id)
      if (action.kind === 'skip') await workflowsApi.skipStep(orgId, templateId, run.id, action.row.id)
      addToast(action.kind === 'cancel' ? 'Instance cancelled' : action.kind === 'retry' ? 'Instance retried' : 'Step skipped', 'success')
      setAction(null)
      await load(true)
    } catch (e) {
      setActionError(workflowErrorMessage(e, 'Something went wrong. Try again.'))
    } finally {
      setActing(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-2/3 max-w-xl" />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Skeleton className="h-96 xl:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }
  if (status === 'notfound') return <NotFoundState what="Instance" backHref={workflowHref(templateId)} backLabel="Go to workflow" />
  if (status === 'failed' || !run) return <ErrorState title="This instance could not be loaded" message={loadError} onRetry={() => load()} />

  const p = instanceProgress(run)
  const currentRows = rows.filter((r) => LIVE_ROW.has(r.status))
  const waitingRows = rows.filter(isWaitingRow).sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''))
  const actionCopy =
    action?.kind === 'cancel'
      ? {
          title: 'Cancel this instance?',
          message: `Open tasks in “${run.name}” are withdrawn and remaining steps won’t start. This cannot be undone.`,
          confirm: 'Cancel instance',
          danger: true,
        }
      : action?.kind === 'retry'
        ? {
            title: 'Retry this instance?',
            message: 'It continues from where it stopped.',
            confirm: 'Retry instance',
            danger: false,
          }
        : action?.kind === 'skip'
          ? {
              title: `Skip ${nameOf(action.row.id) ?? `“${action.row.title}”`}?`,
              message: 'Its open task is withdrawn and the next steps can start.',
              confirm: 'Skip step',
              danger: true,
            }
          : null

  // Everyone who sees the instance may add a note; the server says so per instance.
  const noteGate = gate(caps.can_add_note ?? true, writable, REASONS.note)
  // Delete: the server's answer per note, else its author or someone who manages the instance.
  const notesState = {
    ...notes.state,
    data: notes.state.data.map((n) => ({ ...n, can_delete: n.can_delete ?? (n.author?.id === myId || caps.can_manage === true) })),
  }

  const canDocs = run.capabilities?.can_view_documents !== false
  const docsButton = canDocs ? (
    <button type="button" onClick={() => setDocsOpen(true)} className={BTN.secondary}>
      <FolderOpen size={16} /> Documents
      {docCount !== null && docCount > 0 && (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold flex items-center justify-center">
          {docCount > 99 ? '99+' : docCount}
        </span>
      )}
    </button>
  ) : null
  const openRetry = () => {
    setActionError(null)
    setAction({ kind: 'retry' })
  }
  const openCancel = () => {
    setActionError(null)
    setAction({ kind: 'cancel' })
  }
  const retryButton = (
    <GatedButton allowed={retryGate.allowed} reason={retryGate.reason} icon={RotateCcw} variant="primary" onClick={openRetry}>
      Retry
    </GatedButton>
  )
  // Phone: one visible action (Retry when stuck, else Documents); the rest here.
  const runMenu: ActionMenuItem[] = [
    {
      key: 'docs',
      label: docCount ? `Documents (${docCount > 99 ? '99+' : docCount})` : 'Documents',
      icon: FolderOpen,
      hidden: !canDocs || run.status !== 'stuck',
      onSelect: () => setDocsOpen(true),
    },
    { key: 'refresh', label: 'Refresh', icon: RefreshCw, allowed: refreshing ? false : true, reason: 'Refreshing…', onSelect: () => load(true) },
    { key: 'cancel', label: 'Cancel instance', icon: XCircle, danger: true, allowed: cancelGate.allowed, reason: cancelGate.reason, hidden: !live, onSelect: openCancel },
  ]
  const startedLine = (
    <span className="text-[13px] text-[#475569]">
      {TRIGGER_LABEL[run.trigger_type] ?? 'Started'}
      {run.triggered_by ? ` by ${run.triggered_by.name}` : ''} · {fmtDateTime(run.started_at)}
      {run.completed_at ? ` · Finished ${fmtDateTime(run.completed_at)}` : ''}
    </span>
  )

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-2.5 sm:pb-4 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <WorkflowBreadcrumb
          trail={[
            { label: 'Workflows', href: WORKFLOWS_BASE },
            { label: run.template?.name ?? 'Workflow', href: instancesHref(templateId) },
            { label: run.name },
          ]}
        />
        <div className="flex items-center lg:items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] sm:text-[28px] font-bold text-[#0F172A] leading-tight truncate sm:whitespace-normal sm:break-words">{run.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {run.instance_number ? <span className="text-[13px] font-semibold text-[#334155] whitespace-nowrap">{instanceTitle(run.instance_number)}</span> : null}
              <RunStatusBadge run={run} />
              {!narrow && startedLine}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
            {narrow ? (
              <>
                {run.status === 'stuck' ? retryButton : docsButton}
                <ActionMenu items={runMenu} label="More instance actions" />
              </>
            ) : (
              <>
                {docsButton}
                <button type="button" onClick={() => load(true)} disabled={refreshing} className={BTN.quiet}>
                  <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                </button>
                {run.status === 'stuck' && retryButton}
                {live && (
                  <GatedButton
                    allowed={cancelGate.allowed}
                    reason={cancelGate.reason}
                    icon={XCircle}
                    variant="quiet"
                    className="!text-[#B91C1C]"
                    onClick={openCancel}
                  >
                    Cancel instance
                  </GatedButton>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {narrow && <div className="-mt-2">{startedLine}</div>}

      {run.last_error && <ErrorBanner message={run.last_error} />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <section aria-labelledby="run-steps" className="xl:col-span-2 bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div className="min-w-0">
              <h2 id="run-steps" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
                Steps <InfoTip label="Steps" text="Select a step to see its checklist, proof and comments." />
              </h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap text-[12px] text-[#334155]" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-[4px] border border-[#86EFAC] bg-white" /> Done
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-[4px] border-2 border-[#2563EB] bg-[#EFF6FF]" /> In progress
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-[4px] border border-dashed border-[#94A3B8] bg-[#F8FAFC]" /> Not started
              </span>
            </div>
          </div>
          {rows.length === 0 ? <p className="text-sm text-[#475569]">This instance has no steps.</p> : <FlowDiagram nodes={nodes} lanes={flowLanes} edgeTone={edgeTone} />}
          {followUps.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[#F1F5F9]">
              <h3 className="flex items-center gap-1 text-sm font-semibold text-[#0F172A] mb-2">
                Follow-ups <InfoTip label="Follow-ups" text="Started because a step was late." />
              </h3>
              <ul className="flex flex-col gap-1.5">
                {followUps.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 text-sm text-[#1E293B]">
                    <span className="truncate">{f.title}</span>
                    <span className="text-[12px] text-[#475569] shrink-0">{STEP_STATUS[f.status]?.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5 min-w-0">
          <section aria-labelledby="run-progress" className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-3">
            <h2 id="run-progress" className="text-[18px] font-semibold text-[#0F172A]">
              Progress
            </h2>
            <ProgressBar completed={p.completed} total={p.total} run={run} />
            {live && currentRows.length > 0 && (
              <div>
                <p className="text-[13px] text-[#475569] mb-1.5">{currentRows.length === 1 ? 'In progress' : `${currentRows.length} in progress`}</p>
                <ul className="flex flex-col gap-1.5">
                  {currentRows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setOpenRowId(r.id)}
                        className="w-full text-left rounded-[8px] border border-[#E2E8F0] px-3 py-2 hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                      >
                        <span className="block text-sm font-medium text-[#0F172A] truncate">
                          <span className="text-[#1D4ED8] font-semibold">{labels.get(r.id)}</span> {r.title}
                        </span>
                        <span className="block text-[12px] text-[#475569] truncate">
                          {STEP_STATUS[r.status]?.label}
                          {(r.assignees?.length || r.assigned_to) && ` · ${namesSummary(r.assignees?.length ? r.assignees : [r.assigned_to!], 2)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {live && waitingRows.length > 0 && (
              <div>
                <p className="text-[13px] text-[#475569] mb-1.5">{waitingRows.length === 1 ? 'Waiting to start' : `${waitingRows.length} waiting to start`}</p>
                <ul className="flex flex-col gap-1.5">
                  {waitingRows.map((r) => {
                    const allowed = startNowAllowed(r)
                    return (
                      <li key={r.id} className="flex items-center gap-2 rounded-[8px] border border-[#E2E8F0] px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setOpenRowId(r.id)}
                          className="min-w-0 flex-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                        >
                          <span className="block text-sm font-medium text-[#0F172A] truncate">
                            <span className="text-[#1D4ED8] font-semibold">{labels.get(r.id)}</span> {r.title}
                          </span>
                          <span className="block text-[12px] text-[#334155]">Starts {fmtDayDateTime(r.start_at)}</span>
                        </button>
                        {allowed !== undefined || caps.can_start_now_row_ids?.includes(r.id) ? (
                          <GatedButton
                            allowed={allowed}
                            reason={REASONS.preview}
                            icon={Play}
                            variant="secondary"
                            loading={startingRowId === r.id}
                            disabled={!!startingRowId}
                            className="!min-h-[44px] sm:!min-h-[34px] !px-3"
                            onClick={() => startNow(r)}
                          >
                            Start now
                          </GatedButton>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {run.status === 'stuck' && (
              <p className="text-[13px] text-[#475569]">
                This instance is stuck. Open the step with a problem, then retry the instance or skip the step.
              </p>
            )}
          </section>

          <InstanceNotes
            notes={notesState}
            rows={rows}
            labels={labels}
            canAdd={noteGate.allowed}
            addReason={noteGate.reason}
            onAdd={async (body, forRowId) => {
              await notes.add(body, forRowId)
              setHistoryKey((k) => k + 1)
            }}
            onDelete={async (id) => {
              await notes.remove(id)
              setHistoryKey((k) => k + 1)
            }}
            onRetry={notes.load}
          />

          <RunHistory orgId={orgId} templateId={templateId} instanceId={instanceId} refreshKey={historyKey} stepLabels={labels} />
        </div>
      </div>

      <RunStepDrawer
        orgId={orgId}
        row={openRow}
        rows={rows}
        label={openRow ? `Step ${labels.get(openRow.id) ?? '?'} of ${rows.length}` : ''}
        onClose={() => setOpenRowId(null)}
        canSendBack={openRow ? sendBackAllowed(openRow) : undefined}
        sendBackReason={writable === false ? REASONS.preview : REASONS.sendBack}
        onSendBack={(r) => {
          setOpenRowId(null)
          setSendBack({ templateId, instanceId: run.id, rowId: r.id, stepTitle: r.title, stepLabel: labels.get(r.id) ?? null })
        }}
        canSkip={
          openRow && skipGate.allowed === true && Array.isArray(caps.can_skip_row_ids) ? caps.can_skip_row_ids.includes(openRow.id) : skipGate.allowed
        }
        skipReason={
          openRow && skipGate.allowed === true && Array.isArray(caps.can_skip_row_ids) && !caps.can_skip_row_ids.includes(openRow.id)
            ? 'This step can’t be skipped right now.'
            : skipGate.reason
        }
        onSkip={(r) => {
          setOpenRowId(null)
          setActionError(null)
          setAction({ kind: 'skip', row: r })
        }}
        onChanged={() => load(true)}
        canStartNow={openRow ? startNowAllowed(openRow) : undefined}
        startNowReason={REASONS.preview}
        startingNow={!!openRow && startingRowId === openRow.id}
        onStartNow={(r) => startNow(r)}
        notes={openRow ? notesState.data.filter((n) => n.for_row_id === openRow.id) : []}
      />

      <RunDocumentsDrawer
        orgId={orgId}
        templateId={templateId}
        instanceId={run.id}
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        canUpload={writable === false ? false : run.capabilities?.can_upload ?? true}
        canManage={caps.can_cancel || caps.can_retry || caps.can_skip}
        onCountChange={setDocCount}
      />

      <SendBackDialog
        orgId={orgId}
        subject={sendBack}
        onClose={() => setSendBack(null)}
        onDone={(updated) => {
          if (updated?.steps) setRun(updated)
          load(true)
        }}
      />

      <ConfirmDialog
        open={!!action}
        title={actionCopy?.title ?? ''}
        message={actionCopy?.message ?? ''}
        confirmLabel={actionCopy?.confirm ?? ''}
        cancelLabel="Go back"
        danger={actionCopy?.danger ?? false}
        loading={acting}
        error={actionError}
        onConfirm={runAction}
        onCancel={() => !acting && setAction(null)}
      />
    </div>
  )
}
