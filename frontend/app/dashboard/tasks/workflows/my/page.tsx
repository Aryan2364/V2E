'use client'

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { History, Plus, UserCheck, Workflow as WorkflowIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowInstance, WorkflowTemplate } from '@/lib/types/workflows'
import WorkflowCard, { WorkflowCardSkeleton } from '@/components/workflows/WorkflowCard'
import InstanceList from '@/components/workflows/InstanceList'
import { useWorkflowActions } from '@/components/workflows/useWorkflowActions'
import { BTN, EmptyState, ErrorState, GatedButton, REASONS, WORKFLOWS_BASE, useWorkflowsWritable } from '@/components/workflows/shared'

type View = 'owned' | 'runs' | 'assigned'
const VIEWS: { value: View; label: string }[] = [
  { value: 'owned', label: 'Workflows I edit' },
  { value: 'runs', label: 'Instances of my workflows' },
  { value: 'assigned', label: 'Instances I work in' },
]

type Load<T> = { status: 'loading' | 'ready' | 'failed'; data: T[]; error: string }
const initial = <T,>(): Load<T> => ({ status: 'loading', data: [], error: '' })
const byStart = (a: WorkflowInstance, b: WorkflowInstance) => (b.started_at ?? '').localeCompare(a.started_at ?? '')

function MyWorkflows() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const writable = useWorkflowsWritable()

  const viewParam = params.get('view') as View | null
  const setView = (v: View) => {
    const q = new URLSearchParams(params.toString())
    // Always explicit: with no `view` the page may pick "Instances I work in" for
    // someone who edits nothing, so choosing "Workflows I edit" must stick.
    q.set('view', v)
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false })
  }

  const [owned, setOwned] = useState<Load<WorkflowTemplate>>(initial)
  const [runs, setRuns] = useState<Load<WorkflowInstance>>(initial)
  const [assigned, setAssigned] = useState<Load<WorkflowInstance>>(initial)

  // No tab chosen: "Workflows I edit" — unless the caller edits none but works in
  // instances, then "Instances I work in" (never open on an empty tab when one has rows).
  const view: View = VIEWS.some((v) => v.value === viewParam)
    ? (viewParam as View)
    : owned.status === 'ready' && owned.data.length === 0 && assigned.status === 'ready' && assigned.data.length > 0
      ? 'assigned'
      : 'owned'

  const loadOwned = useCallback(async () => {
    if (!orgId) return
    setOwned((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }))
    try {
      const d = await workflowsApi.getOwnedWorkflows(orgId)
      setOwned({ status: 'ready', data: (d ?? []).filter((w) => w.status !== 'archived'), error: '' })
    } catch (e) {
      setOwned({ status: 'failed', data: [], error: workflowErrorMessage(e, 'Check your connection and try again.') })
    }
  }, [orgId])

  const loadRuns = useCallback(async () => {
    if (!orgId) return
    setRuns((s) => ({ ...s, status: 'loading' }))
    try {
      const d = await workflowsApi.getOwnedInstances(orgId)
      setRuns({ status: 'ready', data: [...(d ?? [])].sort(byStart), error: '' })
    } catch (e) {
      setRuns({ status: 'failed', data: [], error: workflowErrorMessage(e, 'Check your connection and try again.') })
    }
  }, [orgId])

  const loadAssigned = useCallback(async () => {
    if (!orgId) return
    setAssigned((s) => ({ ...s, status: 'loading' }))
    try {
      const d = await workflowsApi.getAssignedInstances(orgId)
      setAssigned({ status: 'ready', data: [...(d ?? [])].sort(byStart), error: '' })
    } catch (e) {
      setAssigned({ status: 'failed', data: [], error: workflowErrorMessage(e, 'Check your connection and try again.') })
    }
  }, [orgId])

  useEffect(() => {
    loadOwned()
    loadRuns()
    loadAssigned()
  }, [loadOwned, loadRuns, loadAssigned])

  const actions = useWorkflowActions(orgId, ({ id, kind }) => {
    if (kind === 'archived') setOwned((s) => ({ ...s, data: s.data.filter((w) => w.id !== id) }))
    else loadOwned()
  })

  const counts: Record<View, number> = {
    owned: owned.data.length,
    runs: runs.data.filter((r) => r.status === 'running' || r.status === 'stuck').length,
    assigned: assigned.data.length,
  }
  const ready: Record<View, boolean> = { owned: owned.status === 'ready', runs: runs.status === 'ready', assigned: assigned.status === 'ready' }

  const newButton =
    writable === true ? (
      <Link href={`${WORKFLOWS_BASE}/new`} className={BTN.primary}>
        <Plus size={16} /> New workflow
      </Link>
    ) : (
      <GatedButton allowed={writable} reason={REASONS.preview} variant="primary" icon={Plus}>
        New workflow
      </GatedButton>
    )

  return (
    <div className="flex flex-col gap-5">
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] leading-tight">My workflows</h1>
          </div>
          {newButton}
        </div>
        <div role="tablist" aria-label="My workflows" className="mt-3 flex items-center gap-1 overflow-x-auto -mb-px">
          {VIEWS.map((v) => {
            const active = view === v.value
            const n = counts[v.value]
            return (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(v.value)}
                className={`inline-flex items-center gap-2 px-3 min-h-[44px] text-sm font-medium border-b-2 whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-t-[6px] ${
                  active ? 'border-[#2563EB] text-[#1D4ED8]' : 'border-transparent text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {v.label}
                {ready[v.value] && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center bg-[#2563EB] text-white">
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {view === 'owned' &&
        (owned.status === 'loading' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {[0, 1, 2].map((i) => (
              <WorkflowCardSkeleton key={i} />
            ))}
          </div>
        ) : owned.status === 'failed' ? (
          <ErrorState title="Your workflows could not be loaded" message={owned.error} onRetry={loadOwned} />
        ) : owned.data.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title="No workflows yet"
            text="Workflows you created or can edit appear here."
            action={
              <Link href={WORKFLOWS_BASE} className={BTN.secondary}>
                Go to all workflows
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-stretch">
            {owned.data.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                writable={writable}
                onStart={actions.start}
                onArchive={actions.archive}
                onRestore={actions.restore}
                onPause={actions.pause}
                onResume={actions.resume}
              />
            ))}
          </div>
        ))}

      {view === 'runs' &&
        (runs.status === 'failed' ? (
          <ErrorState title="Instances could not be loaded" message={runs.error} onRetry={loadRuns} />
        ) : (
          <InstanceList
            showWorkflow
            instances={runs.data}
            loading={runs.status === 'loading'}
            emptyState={
              <div className="bg-white border border-[#E2E8F0] rounded-[12px]">
                <EmptyState icon={History} title="No instances yet" text="Instances of workflows you edit appear here." />
              </div>
            }
          />
        ))}

      {view === 'assigned' &&
        (assigned.status === 'failed' ? (
          <ErrorState title="Instances could not be loaded" message={assigned.error} onRetry={loadAssigned} />
        ) : (
          <InstanceList
            showWorkflow
            instances={assigned.data}
            loading={assigned.status === 'loading'}
            emptyState={
              <div className="bg-white border border-[#E2E8F0] rounded-[12px]">
                <EmptyState icon={UserCheck} title="No instances yet" text="Instances where you have a step, or are copied on one, appear here." />
              </div>
            }
          />
        ))}

      {actions.dialogs}
    </div>
  )
}

export default function MyWorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <MyWorkflows />
    </Suspense>
  )
}
