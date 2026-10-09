'use client'

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Workflow as WorkflowIcon, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowTemplate, WorkflowTemplateStatus } from '@/lib/types/workflows'
import WorkflowCard, { WorkflowCardSkeleton } from '@/components/workflows/WorkflowCard'
import { useWorkflowActions } from '@/components/workflows/useWorkflowActions'
import { BTN, EmptyState, ErrorState, GatedButton, REASONS, WORKFLOWS_BASE, useWorkflowsWritable } from '@/components/workflows/shared'

type Filter = 'all' | WorkflowTemplateStatus
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Live' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
]

function NewWorkflowButton({ writable, variant }: { writable: boolean | undefined; variant: 'primary' | 'secondary' }) {
  if (writable === true) {
    return (
      <Link href={`${WORKFLOWS_BASE}/new`} className={BTN[variant]}>
        <Plus size={16} /> New workflow
      </Link>
    )
  }
  return (
    <GatedButton allowed={writable} reason={REASONS.preview} variant={variant} icon={Plus}>
      New workflow
    </GatedButton>
  )
}

function WorkflowsList() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const writable = useWorkflowsWritable()

  const filterParam = params.get('status') as Filter | null
  const filter: Filter = FILTERS.some((f) => f.value === filterParam) ? (filterParam as Filter) : 'all'

  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      const data = await workflowsApi.listWorkflows(orgId, { includeArchived: true })
      setWorkflows(Array.isArray(data) ? data : [])
      setStatus('ready')
    } catch (e) {
      setLoadError(workflowErrorMessage(e, 'Check your connection and try again.'))
      setStatus('failed')
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const actions = useWorkflowActions(orgId, () => load())

  function setFilter(f: Filter) {
    const q = new URLSearchParams(params.toString())
    if (f === 'all') q.delete('status')
    else q.set('status', f)
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false })
  }

  // Counts answer "how many would I see if I chose this filter?" — so they follow the
  // search box, and every filter shows its count, 0 included.
  const q = search.trim().toLowerCase()
  const matching = useMemo(
    () =>
      workflows.filter(
        (w) => !q || w.name.toLowerCase().includes(q) || (w.description ?? '').toLowerCase().includes(q) || (w.owners ?? []).some((o) => o.name.toLowerCase().includes(q)),
      ),
    [workflows, q],
  )
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, paused: 0, draft: 0, archived: 0 }
    for (const w of matching) {
      c[w.status] = (c[w.status] ?? 0) + 1
      if (w.status !== 'archived') c.all += 1
    }
    return c
  }, [matching])

  const shown = matching
    .filter((w) => (filter === 'all' ? w.status !== 'archived' : w.status === filter))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))

  return (
    <div className="flex flex-col gap-5">
      {/* Header + filters stay pinned while the grid scrolls. */}
      <div className="sticky -top-6 lg:-top-8 z-20 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 lg:-mt-8 px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-4 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] leading-tight">Workflows</h1>
            <p className="text-[13px] text-[#475569] mt-0.5">Steps that become tasks for the right people, in the right order — started by hand or on a schedule.</p>
          </div>
          <NewWorkflowButton writable={writable} variant="primary" />
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="relative w-full sm:w-[280px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#475569] pointer-events-none" />
            <input
              type="text"
              aria-label="Search workflows"
              placeholder="Search workflows"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-9 py-2 min-h-[44px] sm:min-h-[38px] text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-[6px] text-[#475569] hover:bg-[#F1F5F9]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div role="tablist" aria-label="Filter by status" className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => {
              const active = filter === f.value
              const n = counts[f.value]
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={[
                    'inline-flex items-center gap-2 px-3 min-h-[44px] sm:min-h-[36px] rounded-[8px] text-[13px] font-medium transition-colors',
                    active ? 'bg-[#2563EB] text-white' : 'bg-white text-[#334155] border border-[#CBD5E1] hover:border-[#2563EB] hover:text-[#2563EB]',
                  ].join(' ')}
                >
                  {f.label}
                  {status === 'ready' && (
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
        </div>
      </div>

      {status === 'loading' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      ) : status === 'failed' ? (
        <ErrorState title="Workflows could not be loaded" message={loadError} onRetry={load} />
      ) : shown.length === 0 ? (
        q ? (
          <EmptyState
            icon={Search}
            title={`No workflows match “${search.trim()}”`}
            text="Try a different word, or clear the search."
            action={
              <button type="button" onClick={() => setSearch('')} className={BTN.secondary}>
                Clear search
              </button>
            }
          />
        ) : filter !== 'all' ? (
          <EmptyState
            icon={WorkflowIcon}
            title={
              filter === 'archived'
                ? 'No archived workflows'
                : filter === 'draft'
                  ? 'No drafts'
                  : filter === 'paused'
                    ? 'No paused workflows'
                    : 'No live workflows'
            }
            text={
              filter === 'archived'
                ? 'Workflows you archive appear here, and can be restored.'
                : filter === 'draft'
                  ? 'A workflow saved with “Save draft” stays here until you save it to make it live.'
                  : filter === 'paused'
                    ? 'A live workflow you pause appears here until you resume it.'
                    : 'Save a workflow to make it live: then it can be started and its schedule runs.'
            }
            action={
              <button type="button" onClick={() => setFilter('all')} className={BTN.secondary}>
                Show all workflows
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={WorkflowIcon}
            title="No workflows yet"
            text="A workflow is a set of steps. Each step becomes a task for the right people when the steps before it are done."
            action={writable === true ? <NewWorkflowButton writable={writable} variant="secondary" /> : undefined}
          />
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-stretch">
          {shown.map((w) => (
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
      )}

      {actions.dialogs}
    </div>
  )
}

export default function WorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowsList />
    </Suspense>
  )
}
