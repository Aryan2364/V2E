'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { CalendarClock, Clock, Ellipsis, ExternalLink, FolderOpen, Play, RefreshCw, RotateCcw, SkipForward, Undo2, Users, Workflow as WorkflowIcon, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getNow } from '@/lib/clock'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { tasksApi } from '@/lib/api/tasks'
import { workflowsApi, workflowErrorMessage, workflowErrorStatus } from '@/lib/api/workflows'
import { formatBytes } from '@/lib/attachments'
import { fmtDateTime } from '@/lib/phone-format'
import { PHONE_HOME, taskHref, type PhoneRoute } from '@/lib/phone-routes'
import type { Task, TaskAttachment, TaskChecklistItem } from '@/lib/types/tasks'
import type { WorkflowInstance, WorkflowInstanceStep } from '@/lib/types/workflows'
import RunHistory from '@/components/workflows/RunHistory'
import SendBackNote, { ReasonQuote } from '@/components/workflows/SendBackNote'
import StepNotes from '@/components/workflows/StepNotes'
import { ProgressBar, instanceProgress } from '@/components/workflows/InstanceList'
import { instanceTitle } from '@/components/workflows/instanceLabel'
import { sendBackLead, sendBackReason } from '@/components/workflows/sendBack'
import { runLayout } from '@/components/workflows/tracks'
import type { SendBackSubject } from '@/components/workflows/SendBackDialog'
import { REASONS, RunStatusBadge, STEP_STATUS, StepStatusBadge, fmtDayDateTime, gate, namesSummary, useWorkflowsWritable } from '@/components/workflows/shared'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState, PhoneFailedState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, ROW, ROW_BLOCK, cx } from '../primitives'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneSheet } from '../PhoneSheet'
import { WorkflowDiscussion } from '../WorkflowDiscussion'
import { WorkflowDocumentsSheet } from '../WorkflowDocumentsSheet'
import { WorkflowSendBackSheet } from '../WorkflowSendBackSheet'

/*
 * One workflow run on the phone - the twin of the computer's run page
 * (app/dashboard/tasks/workflows/[id]/instances/[instanceId]/page.tsx ->
 * components/workflows/RunView.tsx). It is where the workflow notifications
 * land (workflow-engine.service.ts ~238: stuck, late, sent back, withdrawn...),
 * so a participant can answer them without the computer:
 *   - status, progress, why a step is waiting, the run's last error;
 *   - every step in order with who, when and its state; tap one for its
 *     details, notes, checklist and proof, a link to its task and the step
 *     actions: Start now (~212), Send back (~235), Skip step (~694);
 *   - run actions: Retry when stuck (~460), Cancel instance (~474), Documents,
 *     Refresh - each behind the same server capability and the same
 *     preview-mode switch as the computer (gate()), a refused one is shown
 *     disabled with who may do it (REASONS), never hidden;
 *   - the run's discussion (WorkflowDiscussion) and its History.
 * Designing or editing a workflow stays on the computer: this screen never
 * shows the builder. The step diagram is a plain list in order here (the lane
 * layout of the computer's flow chart does not fit a phone); each step shows
 * its number ("1", "B2") as the computer does.
 */

type RunAction = { kind: 'cancel' } | { kind: 'retry' } | { kind: 'skip'; row: WorkflowInstanceStep }

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Started manually',
  manual_trigger: 'Started manually',
  schedule: 'Started by schedule',
  date_trigger: 'Started by schedule',
  task_completed_trigger: 'Started when a task was completed',
  task_overdue_trigger: 'Started when a task became overdue',
}

const LIVE_ROW = new Set(['active', 'overdue', 'sent_back', 'moved_on'])

/** A pending row with a start time: it starts by itself then (or when someone starts it now) - RunView.isWaitingRow. */
const isWaitingRow = (r: Pick<WorkflowInstanceStep, 'status' | 'start_at' | 'waiting'>) =>
  typeof r.waiting === 'boolean' ? r.waiting : r.status === 'pending' && !!r.start_at

/** Rows of an older run carry no links: they ran one after another. */
function rowDeps(rows: WorkflowInstanceStep[]): Map<string, string[]> {
  const ordered = rows.slice().sort((a, b) => a.order_index - b.order_index)
  const v2 = rows.some((r) => Array.isArray(r.depends_on_row_ids))
  return new Map(ordered.map((r, i) => [r.id, v2 ? (r.depends_on_row_ids ?? []) : i > 0 ? [ordered[i - 1].id] : []]))
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

export default function WorkflowRunScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ id?: string; templateId?: string; instanceId: string }>()
  const templateId = params?.templateId ?? params?.id ?? ''
  const instanceId = params?.instanceId ?? ''
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const writable = useWorkflowsWritable()
  const parent = route.parent ?? PHONE_HOME

  const [run, setRun] = React.useState<WorkflowInstance | null>(null)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed' | 'notfound'>('loading')
  const [refreshing, setRefreshing] = React.useState(false)
  const [panel, setPanel] = React.useState<null | 'menu' | 'docs' | 'action'>(null)
  const [openRowId, setOpenRowId] = React.useState<string | null>(null)
  const [docCount, setDocCount] = React.useState<number | null>(null)
  const [historyKey, setHistoryKey] = React.useState(0)
  const [action, setAction] = React.useState<RunAction | null>(null)
  const [acting, setActing] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [sendBack, setSendBack] = React.useState<SendBackSubject | null>(null)
  const [startingRowId, setStartingRowId] = React.useState<string | null>(null)

  const load = React.useCallback(
    async (quiet = false) => {
      if (!orgId || !templateId || !instanceId) return
      if (quiet) setRefreshing(true)
      else setStatus('loading')
      try {
        const data = await workflowsApi.getInstance(orgId, templateId, instanceId)
        setRun(data)
        setStatus('ready')
        if (quiet) setHistoryKey((k) => k + 1)
      } catch (e) {
        if (quiet) addToast(workflowErrorMessage(e, 'The instance could not be refreshed.'), 'error')
        else if (workflowErrorStatus(e) === 404 || workflowErrorStatus(e) === 403) setStatus('notfound')
        else setStatus('failed')
      } finally {
        setRefreshing(false)
      }
    },
    [orgId, templateId, instanceId, addToast],
  )

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  // The Documents row shows how many files the instance has, before it is opened.
  const canSeeDocs = run?.capabilities?.can_view_documents !== false
  React.useEffect(() => {
    if (!orgId || !canSeeDocs) return
    workflowsApi
      .getDocuments(orgId, templateId, instanceId)
      .then((d) => setDocCount((d?.run_files?.length ?? 0) + (d?.step_files ?? []).reduce((n, g) => n + (g.files?.length ?? 0), 0)))
      .catch(() => setDocCount(null))
  }, [orgId, templateId, instanceId, historyKey, canSeeDocs])

  // A live run moves while it is open: refresh quietly every 30 s while visible (desktop ~165).
  const live = run?.status === 'running' || run?.status === 'stuck'
  React.useEffect(() => {
    if (!live) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !openRowId && !panel && !action && !sendBack) void load(true)
    }, 30000)
    return () => clearInterval(t)
  }, [live, load, openRowId, panel, action, sendBack])

  const rows = React.useMemo(() => (run?.steps ?? []).filter((r) => !r.is_branch).sort((a, b) => a.order_index - b.order_index), [run?.steps])
  const followUps = React.useMemo(() => (run?.steps ?? []).filter((r) => r.is_branch), [run?.steps])
  const deps = React.useMemo(() => rowDeps(rows), [rows])
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const { labels } = React.useMemo(() => runLayout(rows, run?.tracks), [rows, run?.tracks])
  const openRow = openRowId ? (byId.get(openRowId) ?? null) : null

  if (status === 'loading') {
    return (
      <PhoneScreen title="Workflow" parent={parent}>
        <div className="flex flex-col gap-[12px]" aria-busy aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
          <span className="h-[96px] rounded-[8px] bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }
  if (status === 'notfound') {
    return (
      <PhoneScreen title="Workflow" parent={parent}>
        <PhoneEmptyState icon={<WorkflowIcon />} heading="This instance isn’t available" line="It may have been removed, or you may not be able to see it.">
          <PhoneLinkButton href={parent} fullWidth>
            Go to home
          </PhoneLinkButton>
        </PhoneEmptyState>
      </PhoneScreen>
    )
  }
  if (status === 'failed' || !run) {
    return (
      <PhoneScreen title="Workflow" parent={parent}>
        <PhoneFailedState what="This instance" onRetry={() => void load()} />
      </PhoneScreen>
    )
  }

  const caps = run.capabilities ?? { can_cancel: false, can_retry: false, can_skip: false }
  const cancelGate = gate(caps.can_cancel, writable, REASONS.runActions)
  const retryGate = gate(caps.can_retry, writable, REASONS.runActions)
  const skipGate = gate(caps.can_skip, writable, REASONS.runActions)
  const messageGate = gate(caps.can_post_message ?? caps.can_add_note ?? true, writable, REASONS.message)

  const nameOf = (id: string | null | undefined) => {
    const r = id ? byId.get(id) : undefined
    return r ? `${labels.get(r.id) ?? ''} “${r.title || 'Untitled step'}”`.trim() : null
  }

  /** Start now: only for a waiting row the server lists. Hidden otherwise (desktop ~212). */
  const startNowAllowed = (row: WorkflowInstanceStep): boolean | undefined => {
    if (!isWaitingRow(row) || !caps.can_start_now_row_ids?.includes(row.id)) return undefined
    if (writable === false) return false
    return writable === undefined ? undefined : true
  }
  /** Send back: only from a live row that has a finished step before it (desktop ~235). */
  const sendBackAllowed = (row: WorkflowInstanceStep): boolean | undefined => {
    const hasEarlierDone = Array.from(upstreamOf(row.id, deps)).some((d) => byId.get(d)?.status === 'completed')
    if (!hasEarlierDone || !LIVE_ROW.has(row.status) || row.status === 'sent_back') return undefined
    if (writable === false) return false
    if (!caps.can_send_back_from) return undefined
    return caps.can_send_back_from.includes(row.id)
  }
  /** Skip: the run-level gate, narrowed to the rows the server lists (desktop ~694). */
  const skipAllowed = (row: WorkflowInstanceStep): { allowed: boolean | undefined; reason: string } =>
    skipGate.allowed === true && Array.isArray(caps.can_skip_row_ids) && !caps.can_skip_row_ids.includes(row.id)
      ? { allowed: false, reason: 'This step can’t be skipped right now.' }
      : skipGate

  async function startNow(row: WorkflowInstanceStep) {
    if (startingRowId || !run) return
    setStartingRowId(row.id)
    try {
      const updated = await workflowsApi.startStepNow(orgId, templateId, run.id, row.id)
      if (updated?.steps) setRun(updated)
      addToast(`“${row.title || 'Step'}” started`, 'success')
      setOpenRowId(null)
      await load(true)
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The step could not be started. Try again.'), 'error')
      void load(true)
    } finally {
      setStartingRowId(null)
    }
  }

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
      setPanel(null)
      await load(true)
    } catch (e) {
      setActionError(workflowErrorMessage(e, 'Something went wrong. Try again.'))
    } finally {
      setActing(false)
    }
  }

  /** Closes the current sheet, then opens the next once it has finished closing (each sheet owns a history entry). */
  function handOver(next: () => void) {
    setPanel(null)
    setOpenRowId(null)
    window.setTimeout(next, 250)
  }
  const openAction = (a: RunAction) => handOver(() => {
    setActionError(null)
    setAction(a)
    setPanel('action')
  })

  const p = instanceProgress(run)
  const currentRows = rows.filter((r) => LIVE_ROW.has(r.status))
  // Steps waiting on an earlier step they sent the instance back to (the "why" at the top).
  const senderRows = rows.filter((r) => r.status === 'sent_back' && r.send_back?.role === 'sender')
  const actionCopy =
    action?.kind === 'cancel'
      ? { title: 'Cancel this instance?', message: `Open tasks in “${run.name}” are withdrawn and remaining steps won’t start. This cannot be undone.`, confirm: 'Cancel instance', danger: true }
      : action?.kind === 'retry'
        ? { title: 'Retry this instance?', message: 'It continues from where it stopped.', confirm: 'Retry instance', danger: false }
        : action?.kind === 'skip'
          ? { title: `Skip ${nameOf(action.row.id) ?? `“${action.row.title}”`}?`, message: 'Its open task is withdrawn and the next steps can start.', confirm: 'Skip step', danger: true }
          : null

  return (
    <PhoneScreen
      title="Workflow"
      parent={parent}
      actions={
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setPanel('menu')}>
          <Ellipsis aria-hidden />
        </button>
      }
    >
      <div className="flex flex-col gap-[20px]">
        <header className="flex flex-col gap-[8px]">
          <h1 className="whitespace-pre-wrap wrap-break-word text-page-title font-medium text-text-primary">{run.name}</h1>
          <div className="flex flex-wrap items-center gap-[8px]">
            {run.instance_number ? <span className="text-label font-medium text-text-secondary">{instanceTitle(run.instance_number)}</span> : null}
            <RunStatusBadge run={run} />
          </div>
          <p className="text-label text-text-secondary">
            {run.template?.name ? `${run.template.name} · ` : ''}
            {TRIGGER_LABEL[run.trigger_type] ?? 'Started'}
            {run.triggered_by ? ` by ${run.triggered_by.name}` : ''} · {fmtDateTime(run.started_at)}
            {run.completed_at ? ` · Finished ${fmtDateTime(run.completed_at)}` : ''}
          </p>
          {/* Waiting for info: why, said once at the top (desktop ~503). */}
          {live
            ? senderRows.map((r) => (
                <div key={r.id} className="flex flex-col gap-[4px] text-label text-text-secondary">
                  <p className="font-medium wrap-break-word">
                    {nameOf(r.id)} is waiting · {sendBackLead(r.send_back!, getNow())}
                    {sendBackReason(r.send_back) ? ':' : ''}
                  </p>
                  {sendBackReason(r.send_back) ? <ReasonQuote reason={sendBackReason(r.send_back)!} collapsible /> : null}
                </div>
              ))
            : null}
        </header>

        {run.last_error ? (
          <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-[12px] py-[8px] text-body text-danger wrap-break-word">
            {run.last_error}
          </p>
        ) : null}

        {run.status === 'stuck' ? (
          <div className="flex flex-col gap-[8px]">
            <p className="text-label text-text-secondary">This instance is stuck. Open the step with a problem, then retry the instance or skip the step.</p>
            <PermissionTooltip allowed={retryGate.allowed} reason={retryGate.reason}>
              <PhoneButton variant="primary" fullWidth disabled={retryGate.allowed !== true} onClick={() => openAction({ kind: 'retry' })}>
                <RotateCcw aria-hidden /> Retry instance
              </PhoneButton>
            </PermissionTooltip>
          </div>
        ) : null}

        <section aria-label="Progress" className="flex flex-col gap-[8px]">
          <h2 className="text-label font-medium text-text-secondary">Progress</h2>
          <ProgressBar completed={p.completed} total={p.total} run={run} />
          {live && currentRows.length > 0 ? (
            <p className="text-label text-text-secondary">
              {currentRows.length === 1 ? 'In progress: ' : `${currentRows.length} in progress: `}
              {currentRows.map((r) => `${labels.get(r.id) ?? ''} ${r.title}`.trim()).join(', ')}
            </p>
          ) : null}
        </section>

        <section aria-label="Steps" className="flex flex-col gap-[8px]">
          <h2 className="text-label font-medium text-text-secondary">Steps</h2>
          {rows.length === 0 ? (
            <p className="text-body text-text-secondary">This instance has no steps.</p>
          ) : (
            <ul className={ROW_BLOCK}>
              {rows.map((r) => (
                <li key={r.id}>
                  <StepRow row={r} label={labels.get(r.id) ?? '?'} waitingOn={nameOf(r.waiting_on_row_id)} onOpen={() => setOpenRowId(r.id)} />
                </li>
              ))}
            </ul>
          )}
          {followUps.length > 0 ? (
            <div className="flex flex-col gap-[4px] pt-[8px]">
              <h3 className="text-label font-medium text-text-secondary">Follow-ups</h3>
              <p className="text-meta text-text-secondary">Started because a step was late.</p>
              <ul className="flex flex-col gap-[4px]">
                {followUps.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-[8px] text-body text-text-primary">
                    <span className="truncate">{f.title}</span>
                    <span className="shrink-0 text-meta text-text-secondary">{STEP_STATUS[f.status]?.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <RunHistory orgId={orgId} templateId={templateId} instanceId={instanceId} refreshKey={historyKey} stepLabels={labels} />

        <WorkflowDiscussion
          orgId={orgId}
          templateId={templateId}
          instanceId={run.id}
          title="Discussion"
          canWrite={messageGate.allowed}
          writeReason={messageGate.reason}
          onChanged={() => void load(true)}
        />
      </div>

      {/* ... menu: Documents, Refresh, Cancel instance (desktop runMenu ~465). */}
      <PhoneSheet open={panel === 'menu'} onOpenChange={(o) => !o && setPanel(null)} title="More">
        <ul className={ROW_BLOCK}>
          {canSeeDocs ? (
            <MenuItem icon={<FolderOpen aria-hidden />} label={docCount ? `Documents (${docCount > 99 ? '99+' : docCount})` : 'Documents'} onClick={() => handOver(() => setPanel('docs'))} />
          ) : null}
          <MenuItem
            icon={<RefreshCw aria-hidden />}
            label="Refresh"
            allowed={refreshing ? false : true}
            reason="Refreshing…"
            onClick={() => {
              setPanel(null)
              void load(true)
            }}
          />
          {run.status === 'stuck' ? (
            <MenuItem icon={<RotateCcw aria-hidden />} label="Retry instance" allowed={retryGate.allowed} reason={retryGate.reason} onClick={() => openAction({ kind: 'retry' })} />
          ) : null}
          {live ? <MenuItem icon={<XCircle aria-hidden />} label="Cancel instance" danger allowed={cancelGate.allowed} reason={cancelGate.reason} onClick={() => openAction({ kind: 'cancel' })} /> : null}
        </ul>
      </PhoneSheet>

      <WorkflowDocumentsSheet
        orgId={orgId}
        templateId={templateId}
        instanceId={run.id}
        open={panel === 'docs'}
        onClose={() => setPanel(null)}
        canUpload={writable === false ? false : (run.capabilities?.can_upload ?? true)}
        canManage={caps.can_cancel || caps.can_retry || caps.can_skip}
        onCountChange={setDocCount}
      />

      <PhoneSheet
        open={panel === 'action' && !!actionCopy}
        onOpenChange={(o) => !o && !acting && (setPanel(null), setAction(null))}
        title={actionCopy?.title ?? ''}
        footer={
          <PhoneButton
            variant="primary"
            fullWidth
            loading={acting}
            className={cx(actionCopy?.danger && 'border-danger bg-danger active:border-danger active:bg-danger')}
            onClick={() => void runAction()}
          >
            {actionCopy?.confirm}
          </PhoneButton>
        }
      >
        <div className="flex flex-col gap-[8px]">
          <p className="text-body text-text-secondary">{actionCopy?.message}</p>
          {actionError ? (
            <p role="alert" className="text-label text-danger">
              {actionError}
            </p>
          ) : null}
        </div>
      </PhoneSheet>

      <StepSheet
        orgId={orgId}
        row={openRow}
        label={openRow ? `Step ${labels.get(openRow.id) ?? '?'} of ${rows.length}` : ''}
        nameOf={nameOf}
        onClose={() => setOpenRowId(null)}
        canStartNow={openRow ? startNowAllowed(openRow) : undefined}
        startingNow={!!openRow && startingRowId === openRow.id}
        onStartNow={(r) => void startNow(r)}
        canSendBack={openRow ? sendBackAllowed(openRow) : undefined}
        sendBackReason={writable === false ? REASONS.preview : REASONS.sendBack}
        onSendBack={(r) => handOver(() => setSendBack({ templateId, instanceId: run.id, rowId: r.id, stepTitle: r.title, stepLabel: labels.get(r.id) ?? null }))}
        canSkip={openRow ? skipAllowed(openRow) : { allowed: undefined, reason: '' }}
        onSkip={(r) => openAction({ kind: 'skip', row: r })}
      />

      <WorkflowSendBackSheet
        orgId={orgId}
        subject={sendBack}
        onClose={() => setSendBack(null)}
        onDone={(updated) => {
          if (updated?.steps) setRun(updated)
          void load(true)
        }}
      />
    </PhoneScreen>
  )
}

/** One step in the list: number, title, state, who, when (desktop flow box content ~266). */
function StepRow({ row: r, label, waitingOn, onOpen }: { row: WorkflowInstanceStep; label: string; waitingOn: string | null; onOpen: () => void }) {
  const people = r.assignees?.length ? r.assignees : r.assigned_to ? [r.assigned_to] : []
  const deadline = r.task?.deadline ?? r.scheduled_at
  const stateLabel = STEP_STATUS[r.status]?.label ?? 'Not started'
  const stateText =
    r.status === 'sent_back'
      ? r.send_back
        ? stateLabel
        : `Waiting for info from ${waitingOn ?? 'an earlier step'}`
      : isWaitingRow(r)
        ? 'Waiting to start'
        : stateLabel
  return (
    <button type="button" onClick={onOpen} aria-label={`Step ${label}: ${r.title || 'Untitled step'}, ${stateText}. Open details`} className={cx(ROW, 'items-start')}>
      <span
        className={cx(
          'mt-[2px] flex h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-full px-[4px] text-meta font-medium',
          r.status === 'completed' ? 'bg-success text-primary-foreground' : r.status === 'pending' ? 'bg-surface-control-pressed text-text-secondary' : 'bg-primary text-primary-foreground',
        )}
      >
        {label}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="wrap-break-word font-medium">{r.title || 'Untitled step'}</span>
        <span className={cx('text-label font-medium', r.status === 'overdue' || r.status === 'moved_on' ? 'text-danger' : r.status === 'completed' ? 'text-success' : r.status === 'active' ? 'text-primary-text' : 'text-text-secondary')}>
          {stateText}
          {r.returned_to_row_id && !r.send_back ? ' · sent back here' : ''}
        </span>
        {r.send_back ? <SendBackNote sendBack={r.send_back} variant="compact" /> : null}
        {people.length > 0 ? (
          <span className="flex items-center gap-[6px] text-label text-text-secondary">
            <Users aria-hidden className="size-[12px] shrink-0" />
            <span className="truncate">{namesSummary(people, 2)}</span>
          </span>
        ) : null}
        {isWaitingRow(r) ? (
          <span className="flex items-center gap-[6px] text-label font-medium text-primary-text">
            <CalendarClock aria-hidden className="size-[12px] shrink-0" /> Starts {fmtDayDateTime(r.start_at)}
          </span>
        ) : null}
        {r.completed_at || (deadline && r.status !== 'pending') ? (
          <span className="flex items-center gap-[6px] text-label text-text-secondary">
            <Clock aria-hidden className="size-[12px] shrink-0" />
            {r.completed_at ? `Done ${fmtDateTime(r.completed_at)}` : `Due ${fmtDateTime(deadline)}`}
          </span>
        ) : null}
      </span>
    </button>
  )
}

type Load<T> = { status: 'idle' | 'loading' | 'ready' | 'failed' | 'hidden'; data: T }

const itemDone = (i: TaskChecklistItem) =>
  i.is_completed || i.cant_do === true || (typeof i.done_count === 'number' && typeof i.assignee_count === 'number' && i.assignee_count > 0 && i.done_count + (i.skipped_count ?? 0) >= i.assignee_count)

/**
 * One step's details, notes, checklist and proof (everyone in the run sees these) with
 * its actions - the twin of the computer's RunStepDrawer. Comments are the run's one
 * discussion, lower on this screen.
 */
function StepSheet({
  orgId,
  row: rowProp,
  label,
  nameOf,
  onClose,
  canStartNow,
  startingNow,
  onStartNow,
  canSendBack,
  sendBackReason: sendBackWhy,
  onSendBack,
  canSkip,
  onSkip,
}: {
  orgId: string
  row: WorkflowInstanceStep | null
  label: string
  nameOf: (id: string | null | undefined) => string | null
  onClose: () => void
  canStartNow: boolean | undefined
  startingNow: boolean
  onStartNow: (row: WorkflowInstanceStep) => void
  canSendBack: boolean | undefined
  sendBackReason: string
  onSendBack: (row: WorkflowInstanceStep) => void
  canSkip: { allowed: boolean | undefined; reason: string }
  onSkip: (row: WorkflowInstanceStep) => void
}) {
  const { addToast } = useToast()
  // Keep showing the last step while the sheet slides away.
  const [lastRow, setLastRow] = React.useState(rowProp)
  if (rowProp && rowProp !== lastRow) setLastRow(rowProp)
  const row = rowProp ?? lastRow
  const taskId = row && !row.task_deleted ? (row.task_id ?? row.task?.id ?? null) : null
  const [task, setTask] = React.useState<Load<Task | null>>({ status: 'idle', data: null })
  const [proofs, setProofs] = React.useState<Load<TaskAttachment[]>>({ status: 'idle', data: [] })

  // Load the step's task and proof once per opened step (not on every refresh of the run).
  const openId = rowProp?.id
  React.useEffect(() => {
    if (!taskId || !openId) return
    let live = true
    const t = setTimeout(() => {
      setTask({ status: 'loading', data: null })
      setProofs({ status: 'loading', data: [] })
      tasksApi
        .getTask(orgId, taskId)
        .then((x) => live && setTask({ status: 'ready', data: x }))
        .catch((e) => live && setTask({ status: workflowErrorStatus(e) === 403 ? 'hidden' : 'failed', data: null }))
      tasksApi
        .listProofs(orgId, taskId)
        .then((list) => live && setProofs({ status: 'ready', data: Array.isArray(list) ? list : [] }))
        .catch((e) => live && setProofs({ status: workflowErrorStatus(e) === 403 ? 'hidden' : 'failed', data: [] }))
    }, 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [orgId, taskId, openId])

  if (!row) return null

  const people = row.assignees?.length ? row.assignees : row.assigned_to ? [row.assigned_to] : []
  const deadline = row.task?.deadline ?? row.scheduled_at
  const overdue = row.task?.is_overdue || row.status === 'overdue' || row.status === 'moved_on'
  const liveRow = LIVE_ROW.has(row.status)
  const waiting = isWaitingRow(row)
  const checklist: { title: string; group_title?: string | null; done: boolean | null }[] =
    task.status === 'ready' && task.data?.checklist
      ? task.data.checklist.slice().sort((a, b) => a.order_index - b.order_index).map((i) => ({ title: i.title, group_title: i.group_title, done: itemDone(i) }))
      : (row.checklist_items ?? []).map((i) => ({ title: i.title, group_title: i.group_title, done: null }))
  const doneCount = checklist.filter((c) => c.done).length

  const footer = (
    <div className="flex w-full flex-col gap-[8px]">
      {waiting && canStartNow !== undefined ? (
        <PermissionTooltip allowed={canStartNow} reason={REASONS.preview}>
          <PhoneButton variant="primary" fullWidth disabled={canStartNow !== true} loading={startingNow} onClick={() => onStartNow(row)}>
            <Play aria-hidden /> Start now
          </PhoneButton>
        </PermissionTooltip>
      ) : null}
      {taskId ? (
        <PhoneLinkButton href={taskHref(taskId)} variant={waiting ? 'secondary' : 'primary'} fullWidth>
          <ExternalLink aria-hidden /> Open task
        </PhoneLinkButton>
      ) : null}
      {canSendBack !== undefined && liveRow && row.status !== 'sent_back' ? (
        <PermissionTooltip allowed={canSendBack} reason={sendBackWhy}>
          <PhoneButton variant="secondary" fullWidth disabled={canSendBack !== true} onClick={() => onSendBack(row)}>
            <Undo2 aria-hidden /> Send back
          </PhoneButton>
        </PermissionTooltip>
      ) : null}
      {liveRow ? (
        <PermissionTooltip allowed={canSkip.allowed} reason={canSkip.reason}>
          <PhoneButton variant="secondary" fullWidth disabled={canSkip.allowed !== true} onClick={() => onSkip(row)}>
            <SkipForward aria-hidden /> Skip step
          </PhoneButton>
        </PermissionTooltip>
      ) : null}
    </div>
  )

  return (
    <PhoneSheet open={!!rowProp} onOpenChange={(o) => !o && onClose()} title={row.title || 'Untitled step'} footer={footer} fullHeight>
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="text-label text-text-secondary">{label}</span>
          <StepStatusBadge status={row.status} waiting={waiting} />
          {row.task?.status?.label ? <span className="text-meta text-text-secondary">Task: {row.task.status.label}</span> : null}
        </div>

        {row.send_back ? <SendBackNote sendBack={row.send_back} variant="panel" /> : null}
        {row.status === 'sent_back' && row.send_back?.role !== 'sender' ? (
          <Notice>
            Waiting for info from <span className="font-medium">{nameOf(row.waiting_on_row_id) ?? 'an earlier step'}</span>. Resumes when that step is done.
          </Notice>
        ) : null}
        {row.returned_to_row_id && row.send_back?.role !== 'target' ? (
          <Notice>
            Sent back from <span className="font-medium">{nameOf(row.returned_to_row_id) ?? 'an earlier step'}</span>. The reason is in the discussion. When done, the instance returns there.
          </Notice>
        ) : null}
        {row.status === 'moved_on' ? <Notice danger>This step is late. Next steps started anyway; this task stays open.</Notice> : null}
        {waiting ? (
          <Notice>
            Starts on <span className="font-medium">{fmtDayDateTime(row.start_at)}</span>.{canStartNow !== undefined ? ' You can also start it now.' : ''}
          </Notice>
        ) : null}
        {row.last_error ? <Notice danger>{row.last_error}</Notice> : null}
        {row.task_deleted ? <Notice danger>This step’s task was deleted. An editor or admin must retry or skip it.</Notice> : null}

        <StepNotes notes={row.notes ?? []} headingId="step-notes" />

        <dl className="grid grid-cols-2 gap-x-[12px] gap-y-[12px]">
          <Fact label="Assigned to">
            {people.length ? people.map((p) => p.name).join(', ') : waiting ? 'Assigned when it starts' : row.status === 'pending' ? 'Assigned when previous steps are done' : '—'}
          </Fact>
          <Fact label="Deadline">
            {deadline ? (
              <span className={overdue && !row.completed_at ? 'font-medium text-danger' : ''}>
                {fmtDateTime(deadline)}
                {overdue && !row.completed_at ? ' · overdue' : ''}
              </span>
            ) : (
              '—'
            )}
          </Fact>
          {row.planned_start_at || row.planned_due_at ? (
            <Fact label="Planned">
              Start {fmtDayDateTime(row.planned_start_at)}
              <br />
              Due {fmtDayDateTime(row.planned_due_at)}
            </Fact>
          ) : null}
          <Fact label="Started">{row.task_created_at ? fmtDateTime(row.task_created_at) : '—'}</Fact>
          <Fact label="Completed">{row.completed_at ? fmtDateTime(row.completed_at) : '—'}</Fact>
          {(row.sent_back_count ?? 0) > 0 ? <Fact label="Sent back">{row.sent_back_count === 1 ? 'Once' : `${row.sent_back_count} times`}</Fact> : null}
        </dl>

        {row.description ? (
          <section className="flex flex-col gap-[4px]">
            <h3 className="text-label font-medium text-text-secondary">Description</h3>
            <p className="whitespace-pre-wrap wrap-break-word text-body text-text-primary">{row.description}</p>
          </section>
        ) : null}

        {checklist.length > 0 || (row.task?.checklist_total ?? 0) > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h3 className="flex items-center text-label font-medium text-text-secondary">
              Checklist
              {checklist.some((c) => c.done !== null) ? (
                <span className="ml-auto font-normal tabular-nums">
                  {doneCount} of {checklist.length} done
                </span>
              ) : null}
            </h3>
            {task.status === 'loading' ? (
              <span className="h-[56px] rounded-[8px] bg-surface-control" aria-hidden />
            ) : (
              <ul className="flex flex-col gap-[6px]">
                {checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-[8px] rounded-[8px] border border-border-light bg-surface-sunken px-[12px] py-[8px] text-body text-text-primary">
                    <span className="min-w-0 flex-1 wrap-break-word">
                      {c.group_title ? <span className="block text-meta text-text-secondary">{c.group_title}</span> : null}
                      <span className={c.done ? 'text-text-secondary line-through' : ''}>{c.title}</span>
                    </span>
                    {c.done !== null ? <span className={cx('shrink-0 text-meta font-medium', c.done ? 'text-success' : 'text-text-secondary')}>{c.done ? 'Done' : 'Not done'}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {taskId && (row.proof_required || proofs.data.length > 0) ? (
          <section className="flex flex-col gap-[8px]">
            <h3 className="text-label font-medium text-text-secondary">Proof</h3>
            {proofs.status === 'loading' ? (
              <span className="h-[48px] rounded-[8px] bg-surface-control" aria-hidden />
            ) : proofs.status === 'failed' ? (
              <p className="text-body text-danger">Proof could not be loaded.</p>
            ) : proofs.data.length === 0 ? (
              <p className="text-body text-text-secondary">{row.proof_required ? 'Proof required. None added yet.' : 'No proof added.'}</p>
            ) : (
              <ul className="flex flex-col gap-[6px]">
                {proofs.data.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => tasksApi.downloadProof(orgId, taskId, f.id).catch((e) => addToast(workflowErrorMessage(e, 'The file could not be opened. Try again.'), 'error'))}
                      className="flex min-h-[48px] w-full flex-col items-start justify-center rounded-[8px] border border-border-light px-[12px] py-[6px] text-left"
                    >
                      <span className="w-full truncate text-body text-text-primary">{f.file_name}</span>
                      <span className="w-full truncate text-meta text-text-secondary">
                        {formatBytes(f.size_bytes)}
                        {f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''} · {fmtDateTime(f.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {!taskId && !row.task_deleted && !waiting ? <p className="text-body text-text-secondary">{row.status === 'pending' ? 'Not started yet.' : 'This step has no task.'}</p> : null}
        {task.status === 'hidden' ? <p className="text-label text-text-secondary">Some details are visible only to people on this task.</p> : null}
      </div>
    </PhoneSheet>
  )
}

function Notice({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <p className={cx('rounded-[10px] border px-[12px] py-[8px] text-body wrap-break-word', danger ? 'border-danger-border bg-danger-bg text-danger' : 'border-border-light bg-surface-control text-text-secondary')}>{children}</p>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px]">
      <dt className="text-meta text-text-secondary">{label}</dt>
      <dd className="wrap-break-word text-body text-text-primary">{children}</dd>
    </div>
  )
}

/** One row of the ... menu: `allowed` false is disabled and says why on tap; undefined is disabled with no reason yet. */
function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  allowed = true,
  reason = '',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  allowed?: boolean | undefined
  reason?: string
}) {
  return (
    <li className="[&>span]:flex [&>span]:w-full">
      <PermissionTooltip allowed={allowed} reason={reason}>
        <button
          type="button"
          disabled={allowed !== true}
          onClick={onClick}
          className={cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0', danger && 'text-danger', 'disabled:pointer-events-none disabled:text-text-muted')}
        >
          {icon}
          {label}
        </button>
      </PermissionTooltip>
    </li>
  )
}
