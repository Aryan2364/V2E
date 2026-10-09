'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, GitBranch, History, List, Pause, Pencil, Play, UserCog, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workflowsApi, workflowErrorMessage, workflowErrorStatus } from '@/lib/api/workflows'
import type { InvolvedPerson, RunDisplayStatus, WorkflowInstance, WorkflowTemplate } from '@/lib/types/workflows'
import ActionMenu, { type ActionMenuItem } from './ActionMenu'
import ChangeCreatorDialog from './ChangeCreatorDialog'
import InstanceList from './InstanceList'
import StepFlow, { assigneeNames, flowLanes } from './StepFlow'
import { layoutTracks, orderByTracks, tracksFromServer } from './tracks'
import { dueRuleOf, frequencyOf, runStartOf, startRuleOf, timingSummary } from './timing'
import { nextCycleFlagsFor, planContext } from './timingPlan'
import { useWorkflowActions } from './useWorkflowActions'
import { useWorkflowLookups } from './useWorkflowLookups'
import {
  Avatar,
  BTN,
  EmptyState,
  ErrorState,
  GatedButton,
  InfoTip,
  NoAccessState,
  REASONS,
  RUN_STATUS,
  Skeleton,
  TemplateStatusBadge,
  WORKFLOWS_BASE,
  WorkflowBreadcrumb,
  creatorOf,
  editHref,
  fmtDate,
  fmtDateTime,
  gate,
  namesSummary,
  plural,
  runDisplayStatus,
  startGate,
  startsSummary,
  useNarrowScreen,
  useWorkflowsWritable,
} from './shared'

type RunFilter = 'all' | RunDisplayStatus
const RUN_FILTERS: { value: RunFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: RUN_STATUS.running.label },
  { value: 'falling_behind', label: RUN_STATUS.falling_behind.label },
  { value: 'waiting_for_info', label: RUN_STATUS.waiting_for_info.label },
  { value: 'needs_attention', label: RUN_STATUS.needs_attention.label },
  { value: 'completed', label: RUN_STATUS.completed.label },
  { value: 'cancelled', label: RUN_STATUS.cancelled.label },
]

const ROLE_LABEL: Record<string, string> = {
  creator: 'Creator',
  editor: 'Editor',
  // Older servers: owners are editors now.
  owner: 'Editor',
  viewer: 'Viewer',
  starter: 'Can start',
  assignee: 'Assignee',
  cc: 'CC',
  escalation: 'Escalation contact',
  escalation_contact: 'Escalation contact',
}
const ROLE_ORDER = ['creator', 'editor', 'owner', 'viewer', 'starter', 'assignee', 'cc', 'escalation', 'escalation_contact']

/** Each role said once ("owner" and "editor" both read "Editor"), in order. */
function roleWords(roles: string[]): string {
  const words: string[] = []
  roles
    .slice()
    .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
    .forEach((r) => {
      const w = ROLE_LABEL[r] ?? r
      if (!words.includes(w)) words.push(w)
    })
  return words.join(' · ')
}

/** The creator, editors, viewers, starters and everyone the steps involve — the server's list, or built here. */
function involvedPeople(w: WorkflowTemplate, memberName: (id: string) => string | undefined): InvolvedPerson[] {
  if (w.people?.involved?.length) return w.people.involved
  const map = new Map<string, InvolvedPerson>()
  const add = (id: string, name: string | undefined, role: string) => {
    const cur = map.get(id) ?? { id, name: name ?? memberName(id) ?? 'Someone no longer active', roles: [] }
    if (!cur.roles.includes(role)) cur.roles.push(role)
    map.set(id, cur)
  }
  const creator = creatorOf(w)
  if (creator) add(creator.id, creator.name, 'creator')
  ;(w.people?.editors ?? w.people?.owners ?? w.owners ?? []).forEach((p) => add(p.id, p.name, 'editor'))
  ;(w.people?.viewers ?? []).forEach((p) => add(p.id, p.name, 'viewer'))
  if (w.manual_start_enabled !== false) (w.people?.starters ?? []).forEach((p) => add(p.id, p.name, 'starter'))
  ;(w.steps ?? []).forEach((s) => {
    ;(s.assignees ?? s.assignee_user_ids.map((id) => ({ id, name: memberName(id) ?? '' }))).forEach((p) => add(p.id, p.name || undefined, 'assignee'))
    ;(s.ccs ?? (s.cc_user_ids ?? []).map((id) => ({ id, name: memberName(id) ?? '' }))).forEach((p) => add(p.id, p.name || undefined, 'cc'))
    ;(s.escalation_contacts ?? []).forEach((p) => add(p.id, p.name, 'escalation'))
  })
  return Array.from(map.values())
}

/**
 * The workflow page: what it is, who is involved, how its steps flow, and its instances.
 * Editing happens in the builder (Edit); Run is the one primary action. Someone who only
 * works in some of its instances sees just those; anyone else sees that they have no access.
 */
export default function WorkflowOverview({ id }: { id: string }) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const entWritable = useWorkflowsWritable()
  const router = useRouter()
  const narrow = useNarrowScreen()

  const [workflow, setWorkflow] = useState<WorkflowTemplate | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'noaccess'>('loading')
  // 'instances': the viewer only works in some instances — the page shows just those.
  const [mode, setMode] = useState<'full' | 'instances'>('full')
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<'flow' | 'list'>('flow')

  const [runs, setRuns] = useState<WorkflowInstance[]>([])
  const [runsStatus, setRunsStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [runsError, setRunsError] = useState('')
  const [filter, setFilter] = useState<RunFilter>('all')

  const lookups = useWorkflowLookups(orgId, status === 'ready' && mode === 'full')
  const writable = entWritable === false || lookups.moduleAccess === 'preview' ? false : entWritable
  const memberName = useCallback((uid: string) => lookups.members.find((m) => m.user_id === uid)?.name, [lookups.members])

  /** The instances the viewer may see (all of them, or only the ones they work in). */
  const fetchRuns = useCallback(async () => {
    const list = await workflowsApi.listInstances(orgId, id)
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
  }, [orgId, id])

  const load = useCallback(
    async (quiet = false) => {
      if (!orgId) return
      if (!quiet) setStatus('loading')
      try {
        const w = await workflowsApi.getWorkflow(orgId, id)
        setWorkflow(w)
        const access =
          w.capabilities?.access ?? (w.view === 'limited' || w.capabilities?.can_view === false ? 'instances' : 'full')
        if (access === 'none') {
          setStatus('noaccess')
          return
        }
        setMode(access === 'instances' ? 'instances' : 'full')
        setStatus('ready')
      } catch (e) {
        if (quiet) return
        const code = workflowErrorStatus(e)
        if (code === 404 || code === 403) {
          // No design access: someone working in its instances still sees those.
          try {
            const mine = await fetchRuns()
            if (mine.length) {
              setRuns(mine)
              setRunsStatus('ready')
              setWorkflow(null)
              setMode('instances')
              setStatus('ready')
              return
            }
          } catch {
            // Falls through to "no access".
          }
          setStatus('noaccess')
        } else {
          setLoadError(workflowErrorMessage(e, 'Check your connection and try again.'))
          setStatus('failed')
        }
      }
    },
    [orgId, id, fetchRuns],
  )

  const loadRuns = useCallback(async () => {
    if (!orgId) return
    setRunsStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      setRuns(await fetchRuns())
      setRunsStatus('ready')
    } catch (e) {
      setRunsError(workflowErrorMessage(e, 'Check your connection and try again.'))
      setRunsStatus('failed')
    }
  }, [orgId, fetchRuns])

  useEffect(() => {
    load()
    loadRuns()
  }, [load, loadRuns])

  // Links to the list arrive with #instances (older ones with #runs): bring it into view.
  useEffect(() => {
    if (status === 'ready' && typeof window !== 'undefined' && /^#(instances|runs)$/.test(window.location.hash)) {
      requestAnimationFrame(() => document.getElementById('instances')?.scrollIntoView({ block: 'start' }))
    }
  }, [status])

  const actions = useWorkflowActions(orgId, (change) => {
    if (change.workflow) setWorkflow((cur) => (cur ? { ...cur, ...change.workflow, steps: change.workflow?.steps ?? cur.steps } : cur))
    else load(true)
  })

  const tracks = useMemo(() => tracksFromServer(workflow?.tracks), [workflow?.tracks])
  const steps = useMemo(() => orderByTracks(tracks, workflow?.steps ?? []), [tracks, workflow?.steps])
  const layout = useMemo(() => layoutTracks(tracks, steps), [tracks, steps])
  const lanes = useMemo(() => flowLanes(layout), [layout])
  const counts = useMemo(() => {
    const c = Object.fromEntries(RUN_FILTERS.map((f) => [f.value, 0])) as Record<RunFilter, number>
    runs.forEach((r) => {
      c.all += 1
      c[runDisplayStatus(r)] += 1
    })
    return c
  }, [runs])

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-2/3 max-w-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (status === 'noaccess') {
    return (
      <NoAccessState
        title="You don’t have access to this workflow"
        text="Only its editors, viewers and admins can see it. Ask one of its editors to add you."
        backHref={WORKFLOWS_BASE}
        backLabel="Go to workflows"
      />
    )
  }
  if (status === 'failed') return <ErrorState title="This workflow could not be loaded" message={loadError} onRetry={() => load()} />
  if (mode === 'instances' || !workflow) {
    return (
      <MyInstancesView
        name={workflow?.name ?? runs[0]?.template?.name ?? 'Workflow'}
        templateId={id}
        workflow={workflow}
        writable={writable}
        runs={runs}
        runsStatus={runsStatus}
        runsError={runsError}
        onRetry={loadRuns}
        onRun={(w) => actions.start(w)}
        dialogs={actions.dialogs}
      />
    )
  }

  const w = workflow
  const caps = w.capabilities
  const archived = w.status === 'archived'
  const edit = archived ? { allowed: false as const, reason: 'Restore this workflow to edit it.' } : gate(caps?.can_edit, writable, REASONS.edit)
  const rawEdit = gate(caps?.can_edit, writable, REASONS.edit)
  const start = startGate(w, writable)
  const involved = involvedPeople(w, memberName).sort(
    (a, b) => Math.min(...a.roles.map((r) => ROLE_ORDER.indexOf(r)).filter((x) => x >= 0), 99) - Math.min(...b.roles.map((r) => ROLE_ORDER.indexOf(r)).filter((x) => x >= 0), 99) || a.name.localeCompare(b.name),
  )
  const noStarters = w.manual_start_enabled !== false && (w.people?.starters ?? []).length === 0
  const schedules = w.schedules ?? []
  const frequency = frequencyOf(schedules)
  // Which calendar dates land in the next cycle ("Due 1st of next month").
  const nextFlags = nextCycleFlagsFor(
    layout.display.map((s) => ({ id: s.id, deps: layout.deps.get(s.id) ?? [], start: startRuleOf(s), due: dueRuleOf(s) })),
    planContext(frequency, runStartOf(schedules, frequency)),
  )
  const shownRuns = filter === 'all' ? runs : runs.filter((r) => runDisplayStatus(r) === filter)

  // Phone: the header row holds the title, one primary action (Start, or Restore) and the
  // menu; Edit moves into the menu unless there is no Start to take its place.
  const editInMenu = narrow && (archived || !start.hidden)
  const menuItems: ActionMenuItem[] = [
    { key: 'edit', label: 'Edit workflow', icon: Pencil, allowed: edit.allowed, reason: edit.reason, hidden: !editInMenu, onSelect: () => router.push(editHref(w.id)) },
    { key: 'pause', label: 'Pause workflow', icon: Pause, allowed: rawEdit.allowed, reason: rawEdit.reason, hidden: w.status !== 'active', onSelect: () => actions.pause(w) },
    { key: 'resume', label: 'Resume workflow', icon: Play, allowed: rawEdit.allowed, reason: rawEdit.reason, hidden: w.status !== 'paused', onSelect: () => actions.resume(w) },
    // Admins only (the server says who): hand the permanent-editor role to someone else.
    { key: 'creator', label: 'Change creator…', icon: UserCog, hidden: caps?.can_change_creator !== true, allowed: writable === false ? false : writable, reason: REASONS.preview, onSelect: () => setCreatorOpen(true) },
    { key: 'archive', label: 'Archive workflow', icon: Archive, danger: true, allowed: rawEdit.allowed, reason: rawEdit.reason, hidden: archived, onSelect: () => actions.archive(w) },
    // Restore is the header's primary button when archived — not repeated here.
  ]
  const creator = creatorOf(w)
  const editors = (() => {
    const list = [...(creator ? [creator] : []), ...(w.people?.editors ?? w.people?.owners ?? w.owners ?? [])]
    return list.filter((p, i) => list.findIndex((x) => x.id === p.id) === i)
  })()

  // Said once: status, the facts, and how it starts (the schedule lives only here).
  const meta = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {!narrow && <TemplateStatusBadge status={w.status} />}
        <span className="text-[13px] text-[#475569]">
          {narrow ? '' : `${plural(steps.length, 'step')} · `}Editors: {namesSummary(editors, 3)} · Updated {fmtDate(w.updated_at)}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-[#334155] break-words">
        <span className="font-medium text-[#0F172A]">Starts:</span> {startsSummary(w, noStarters ? 'no one can start it yet' : undefined)}
        {w.next_run_at ? (
          <>
            {' '}
            · <span className="font-medium text-[#0F172A]">Next start:</span> {fmtDateTime(w.next_run_at)}
          </>
        ) : w.status === 'paused' && schedules.length > 0 ? (
          ' · Schedule paused'
        ) : null}
      </p>
    </>
  )

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-2.5 sm:pb-4 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <WorkflowBreadcrumb trail={[{ label: 'Workflows', href: WORKFLOWS_BASE }, { label: w.name }]} />
        <div className="flex items-center sm:items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] sm:text-[28px] font-bold text-[#0F172A] leading-tight truncate sm:whitespace-normal sm:break-words">{w.name}</h1>
            {!narrow && <div className="mt-1.5">{meta}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editInMenu ? null : edit.allowed === true ? (
              <Link href={editHref(w.id)} className={BTN.secondary}>
                <Pencil size={16} /> Edit
              </Link>
            ) : (
              <GatedButton allowed={edit.allowed} reason={edit.reason} icon={Pencil} variant="secondary">
                Edit
              </GatedButton>
            )}
            {archived ? (
              <GatedButton allowed={rawEdit.allowed} reason={rawEdit.reason} icon={ArchiveRestore} variant="primary" onClick={() => actions.restore(w)}>
                Restore
              </GatedButton>
            ) : start.hidden ? null : (
              <GatedButton allowed={start.allowed} reason={start.reason} icon={Play} variant="primary" onClick={() => actions.start(w)}>
                Run
              </GatedButton>
            )}
            <ActionMenu items={menuItems} label="More workflow actions" />
          </div>
        </div>
        {/* Phone: the status on one slim line; the rest of the meta sits under the header. */}
        {narrow && (
          <div className="flex items-center gap-2 mt-1.5 min-w-0 text-[12px] text-[#475569]">
            <TemplateStatusBadge status={w.status} />
            <span className="whitespace-nowrap">{plural(steps.length, 'step')}</span>
          </div>
        )}
      </div>

      {narrow && <div className="-mt-2">{meta}</div>}

      {w.description && <p className="text-[15px] text-[#1E293B] whitespace-pre-wrap break-words max-w-4xl">{w.description}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* Steps */}
        <section aria-labelledby="steps-heading" className="xl:col-span-2 bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 id="steps-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
                Steps <InfoTip label="Steps" text="Each step becomes a task. Parallel paths run at the same time." />
              </h2>
            </div>
            {steps.length > 0 && (
              <div role="tablist" aria-label="Show steps as" className="inline-flex rounded-[8px] border border-[#CBD5E1] bg-white p-0.5">
                {(
                  [
                    ['flow', 'Flow', GitBranch],
                    ['list', 'List', List],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] sm:min-h-[32px] rounded-[6px] text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                      view === v ? 'bg-[#EFF6FF] text-[#1D4ED8]' : 'text-[#334155] hover:bg-[#F1F5F9]'
                    }`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {steps.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No steps yet"
              text={edit.allowed === true ? 'Add steps to get started.' : 'This workflow has no steps.'}
              action={
                edit.allowed === true ? (
                  <Link href={editHref(w.id)} className={BTN.secondary}>
                    <Pencil size={16} /> Add steps
                  </Link>
                ) : undefined
              }
            />
          ) : view === 'flow' ? (
            <StepFlow steps={steps} tracks={tracks} memberName={memberName} frequency={frequency} schedules={schedules} />
          ) : (
            <div className="flex flex-col gap-4">
              {lanes.map((lane) => {
                const list = layout.groups.get(lane.key) ?? []
                if (!list.length) return null
                return (
                  <div key={lane.key} className="flex flex-col">
                    {lanes.length > 1 && (
                      <p className="flex items-baseline gap-2 pb-1.5 border-b border-[#E2E8F0]">
                        <span className="text-[14px] font-semibold text-[#0F172A]">{lane.label}</span>
                        {lane.hint && <span className="text-[13px] text-[#475569]">{lane.hint}</span>}
                      </p>
                    )}
                    <ol className="flex flex-col divide-y divide-[#F1F5F9]">
                      {list.map((s) => {
                        const deps = layout.deps.get(s.id) ?? []
                        const merges = layout.merges.get(s.id) ?? []
                        const also = merges.map((m) => layout.labels.get(m)).filter(Boolean)
                        // What it comes after is the lane's own order (or the lane header): only extra waits are said.
                        const meta = [also.length ? `Also waits for ${also.join(', ')}` : null, s.if_late === 'move_on' ? 'If late: continue' : 'If late: wait'].filter(Boolean).join(' · ')
                        return (
                          <li key={s.id} className="py-3 flex items-start gap-3">
                            <span className="mt-0.5 min-w-[26px] h-[26px] px-1 rounded-full bg-[#2563EB] text-white text-[12px] font-semibold flex items-center justify-center shrink-0">
                              {layout.labels.get(s.id)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-semibold text-[#0F172A] break-words">{s.title || 'Untitled step'}</p>
                              <p className="text-[13px] text-[#334155]">
                                {namesSummary(assigneeNames(s, memberName).map((name) => ({ name })), 3)} · {timingSummary(startRuleOf(s), dueRuleOf(s), frequency, deps.length > 0, nextFlags.get(s.id))}
                              </p>
                              <p className="text-[13px] text-[#475569]">{meta}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5 min-w-0">
          {/* People involved */}
          <section aria-labelledby="people-heading" className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-[#475569]" />
              <h2 id="people-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
                People involved <InfoTip label="People involved" text="Editors and viewers see the workflow and all its instances. People in an instance see that instance." />
              </h2>
            </div>
            {involved.length === 0 ? (
              <p className="text-sm text-[#475569]">No one yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                {involved.map((p) => (
                  <li key={p.id} className="flex items-start gap-2.5 min-w-0">
                    <Avatar name={p.name} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] truncate">{p.name}</p>
                      <p className="text-[12px] text-[#475569]">{roleWords(p.id === creator?.id && !p.roles.includes('creator') ? ['creator', ...p.roles] : p.roles)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Instances */}
      <section id="instances" aria-labelledby="instances-heading" className="flex flex-col gap-3 scroll-mt-40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History size={18} className="text-[#475569]" />
            <h2 id="instances-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
              Instances <InfoTip label="Instances" text="Each time the workflow is run — by hand or on a schedule — it creates an instance." />
            </h2>
          </div>
        </div>
        <div role="tablist" aria-label="Filter instances" className="flex items-center gap-1.5 flex-wrap">
          {RUN_FILTERS.map((f) => {
            const active = filter === f.value
            const n = counts[f.value]
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`inline-flex items-center gap-2 px-3 min-h-[44px] sm:min-h-[36px] rounded-[8px] text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                  active ? 'bg-[#2563EB] text-white' : 'bg-white text-[#334155] border border-[#CBD5E1] hover:border-[#2563EB] hover:text-[#2563EB]'
                }`}
              >
                {f.label}
                {runsStatus === 'ready' && (
                  <span
                    className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                      active ? 'bg-white text-[#2563EB]' : 'bg-[#2563EB] text-white'
                    }`}
                  >
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {runsStatus === 'failed' ? (
          <ErrorState title="Instances could not be loaded" message={runsError} onRetry={loadRuns} />
        ) : (
          <InstanceList
            templateId={w.id}
            instances={shownRuns}
            loading={runsStatus === 'loading'}
            emptyState={
              <div className="bg-white border border-[#E2E8F0] rounded-[12px]">
                {filter !== 'all' && runs.length > 0 ? (
                  <EmptyState
                    icon={History}
                    title={`No instances are “${RUN_STATUS[filter as RunDisplayStatus].label.toLowerCase()}”`}
                    text="Try another filter."
                    action={
                      <button type="button" onClick={() => setFilter('all')} className={BTN.secondary}>
                        Show all instances
                      </button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={History}
                    title="No instances yet"
                    text={
                      w.status === 'active'
                        ? 'Each run of the workflow appears here as an instance.'
                        : w.status === 'paused'
                          ? 'Resume the workflow to run it again.'
                          : w.status === 'archived'
                            ? 'This workflow has no instances.'
                            : 'Save the workflow to make it live.'
                    }
                  />
                )}
              </div>
            }
          />
        )}
      </section>

      {actions.dialogs}
      <ChangeCreatorDialog
        orgId={orgId}
        open={creatorOpen}
        workflow={w}
        current={creator}
        members={lookups.members}
        membersLoading={lookups.status === 'loading'}
        onClose={() => setCreatorOpen(false)}
        onChanged={(updated) => {
          setCreatorOpen(false)
          if (updated) setWorkflow((cur) => (cur ? { ...cur, ...updated, steps: updated.steps ?? cur.steps } : cur))
          load(true)
        }}
      />
    </div>
  )
}

/**
 * For someone who works in some of this workflow's instances but is not one of its
 * editors or viewers: only "My instances of this workflow" — no design, steps, people or
 * other instances. Run stays available to the people chosen to start it.
 */
function MyInstancesView({
  name,
  templateId,
  workflow,
  writable,
  runs,
  runsStatus,
  runsError,
  onRetry,
  onRun,
  dialogs,
}: {
  name: string
  templateId: string
  workflow: WorkflowTemplate | null
  writable: boolean | undefined
  runs: WorkflowInstance[]
  runsStatus: 'loading' | 'ready' | 'failed'
  runsError: string
  onRetry: () => void
  onRun: (w: WorkflowTemplate) => void
  dialogs: React.ReactNode
}) {
  const start = workflow ? startGate(workflow, writable) : null
  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-2.5 sm:pb-4 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <WorkflowBreadcrumb trail={[{ label: 'Workflows', href: `${WORKFLOWS_BASE}/my?view=assigned` }, { label: name }]} />
        <div className="flex items-center sm:items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] sm:text-[28px] font-bold text-[#0F172A] leading-tight truncate sm:whitespace-normal sm:break-words">{name}</h1>
            {workflow && (
              <div className="mt-1.5">
                <TemplateStatusBadge status={workflow.status} />
              </div>
            )}
          </div>
          {workflow && start && !start.hidden && (
            <GatedButton allowed={start.allowed} reason={start.reason} icon={Play} variant="primary" onClick={() => onRun(workflow)}>
              Run
            </GatedButton>
          )}
        </div>
      </div>

      <section id="instances" aria-labelledby="my-instances-heading" className="flex flex-col gap-3 scroll-mt-40">
        <div className="flex items-center gap-2">
          <History size={18} className="text-[#475569]" />
          <h2 id="my-instances-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
            My instances of this workflow{' '}
            <InfoTip label="My instances of this workflow" text="The instances you work in. Only its editors and viewers see the whole workflow." />
          </h2>
        </div>
        {runsStatus === 'failed' ? (
          <ErrorState title="Instances could not be loaded" message={runsError} onRetry={onRetry} />
        ) : (
          <InstanceList
            templateId={templateId}
            instances={runs}
            loading={runsStatus === 'loading'}
            emptyState={
              <div className="bg-white border border-[#E2E8F0] rounded-[12px]">
                <EmptyState icon={History} title="No instances yet" text="Instances you work in appear here." />
              </div>
            }
          />
        )}
      </section>

      {dialogs}
    </div>
  )
}
