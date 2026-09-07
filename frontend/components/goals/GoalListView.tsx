'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Target, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import FilterButton, { type FilterSection } from '@/components/ui/FilterButton'
import { buildDeptForest, type DeptNode } from '@/lib/tasks/dept-tree'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import { goalsApi } from '@/lib/api/goals'
import {
  FOCUS_AREA_META,
  FOCUS_AREA_OPTIONS,
  STATUS_META,
  formatValue,
  type Goal,
  type GoalFocusArea,
  type GoalStatus,
} from '@/lib/types/goals'
import CreateGoalModal from './CreateGoalModal'
import {
  CountBadge,
  DAYS_TONE,
  EmptyState,
  FocusAreaBadge,
  GoalStatusBadge,
  daysLeftLabel,
  formatDate,
  PermissionsUnavailable,
  useGoalPermissions,
  useGoalRefData,
} from './shared'

const STATUSES: GoalStatus[] = [
  'not_started',
  'on_track',
  'at_risk',
  'off_track',
  'achieved',
  'closed',
]

/**
 * Goals — one flat list. No nesting and no indentation: a goal's place in the
 * web lives on its own page, because in a web there is no single "level" a row
 * could be indented to.
 */
export default function GoalListView() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgId = user?.organizationId ?? ''
  const {
    perms,
    loading: permsLoading,
    failed: permsFailed,
    retry: retryPerms,
  } = useGoalPermissions(orgId)
  const { employees, departments } = useGoalRefData(orgId)

  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [owners, setOwners] = useState<string[]>([])
  const [departments_, setDepartments] = useState<string[]>([])
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  // Seeded from ?status= so the Dashboard's status tiles land pre-filtered.
  const [statuses, setStatuses] = useState<string[]>(
    searchParams.get('status') ? [searchParams.get('status') as string] : [],
  )

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setGoals(await goalsApi.list(orgId).catch(() => []))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const deptOfOwner = useMemo(
    () => new Map(employees.map((e) => [e.user_id, e.department_id ?? ''])),
    [employees],
  )

  /**
   * One predicate per facet, so `filtered` and the per-option counts can be
   * built from the same rules — the counts apply every facet EXCEPT the one
   * being counted (see `filterSections`).
   */
  const match = useMemo(() => {
    const q = search.trim().toLowerCase()
    return {
      search: (g: Goal) => !q || g.title.toLowerCase().includes(q),
      owner: (g: Goal) => !owners.length || owners.includes(g.owner_user_id),
      // A goal has no department of its own — it belongs to whichever
      // department its owner sits in, so the filter reads through them.
      department: (g: Goal) =>
        !departments_.length || departments_.includes(deptOfOwner.get(g.owner_user_id) ?? ''),
      status: (g: Goal) => !statuses.length || statuses.includes(g.status),
      focus: (g: Goal) => !focusAreas.length || focusAreas.includes(g.focus_area ?? ''),
    }
  }, [search, owners, departments_, statuses, focusAreas, deptOfOwner])

  const filtered = useMemo(
    () =>
      goals.filter(
        (g) =>
          match.search(g) &&
          match.owner(g) &&
          match.department(g) &&
          match.status(g) &&
          match.focus(g),
      ),
    [goals, match],
  )

  const activeFilters = owners.length + departments_.length + statuses.length + focusAreas.length
  const isFiltered = !!search || activeFilters > 0

  function clearAllFacets() {
    setOwners([])
    setDepartments([])
    setStatuses([])
    setFocusAreas([])
  }

  function clearFilters() {
    setSearch('')
    clearAllFacets()
  }

  /**
   * Filter options are built FROM THE LOADED GOALS, never from the full org
   * lists — so a person who owns no goals, or a status nothing is in, simply
   * doesn't appear.
   *
   * Counts are CROSS-FILTERED: each option is counted with every other facet's
   * selection applied, so the number always equals what picking it will show.
   * (Same approach as TaskFilterPopover.)
   */
  const filterSections: FilterSection[] = useMemo(() => {
    const tally = (
      exclude: 'owner' | 'department' | 'status' | 'focus',
      pick: (g: Goal) => string | null | undefined,
    ) => {
      const counts = new Map<string, number>()
      for (const g of goals) {
        if (!match.search(g)) continue
        if (exclude !== 'owner' && !match.owner(g)) continue
        if (exclude !== 'department' && !match.department(g)) continue
        if (exclude !== 'status' && !match.status(g)) continue
        if (exclude !== 'focus' && !match.focus(g)) continue
        const v = pick(g)
        if (!v) continue
        counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      return counts
    }

    const statusCounts = tally('status', (g) => g.status)
    const ownerCounts = tally('owner', (g) => g.owner_user_id)
    const deptCounts = tally('department', (g) => deptOfOwner.get(g.owner_user_id) || null)
    const focusCounts = tally('focus', (g) => g.focus_area)

    /**
     * A value that is currently SELECTED must stay in the list even when the
     * cross-filter drops its count to zero — otherwise the option vanishes and
     * there is no way to un-tick it.
     */
    const keep = (counts: Map<string, number>, selected: string[], v: string) =>
      counts.has(v) || selected.includes(v)

    // Built from ALL goals (not the filtered set) so a selected owner keeps its
    // name even when the cross-filter leaves them zero rows.
    const ownerName = new Map(goals.map((g) => [g.owner_user_id, g.owner?.name ?? 'Unknown']))
    const deptName = new Map(departments.map((d) => [d.id, d.name]))

    // Sub-departments render indented directly beneath their parent (tree
    // order), not alphabetised into the flat list — same as the task filters.
    const deptForest = buildDeptForest(departments as any)
    const deptRows: { id: string; depth: number }[] = []
    const walk = (nodes: DeptNode[], depth: number) => {
      for (const n of nodes) {
        if (keep(deptCounts, departments_, n.id)) deptRows.push({ id: n.id, depth })
        walk(n.children, depth + 1)
      }
    }
    walk(deptForest.roots, 0)
    // A selected department whose parent chain got pruned out of the forest
    // (shouldn't happen, but keep() can retain a stale id) still needs a row.
    for (const id of departments_) {
      if (!deptRows.some((r) => r.id === id) && keep(deptCounts, departments_, id)) {
        deptRows.push({ id, depth: 0 })
      }
    }

    return [
      {
        key: 'status',
        label: 'Status',
        selected: statuses,
        onChange: setStatuses,
        // Keep the canonical status order rather than whatever the data yields.
        options: STATUSES.filter((s) => keep(statusCounts, statuses, s)).map((s) => ({
          value: s,
          label: STATUS_META[s].label,
          count: statusCounts.get(s) ?? 0,
          color: STATUS_META[s].dot,
        })),
      },
      {
        key: 'focus',
        label: 'Focus area',
        selected: focusAreas,
        onChange: setFocusAreas,
        options: FOCUS_AREA_OPTIONS.filter((f) => keep(focusCounts, focusAreas, f)).map((f) => ({
          value: f,
          label: FOCUS_AREA_META[f].label,
          count: focusCounts.get(f) ?? 0,
          color: FOCUS_AREA_META[f].dot,
        })),
      },
      {
        key: 'owner',
        label: 'Owner',
        selected: owners,
        onChange: setOwners,
        options: Array.from(new Set([...Array.from(ownerCounts.keys()), ...owners]))
          .map((id) => ({
            value: id,
            label: ownerName.get(id) ?? 'Unknown',
            count: ownerCounts.get(id) ?? 0,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
      {
        key: 'department',
        label: 'Department',
        selected: departments_,
        onChange: setDepartments,
        options: deptRows.map(({ id, depth }) => ({
          value: id,
          label: deptName.get(id) ?? 'Unknown',
          count: deptCounts.get(id) ?? 0,
          depth,
        })),
      },
    ]
  }, [goals, match, deptOfOwner, departments, statuses, focusAreas, owners, departments_])

  const columns: ResponsiveColumn<Goal>[] = [
    {
      key: 'title',
      header: 'Goal',
      primary: true,
      render: (g) => (
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[#0F172A] truncate">{g.title}</p>
          {(g.supported_by_count || g.supports_count) ? (
            <p className="text-[11px] text-[#475569] mt-0.5">
              {g.supported_by_count ? `${g.supported_by_count} supporting` : ''}
              {g.supported_by_count && g.supports_count ? ' · ' : ''}
              {g.supports_count ? `supports ${g.supports_count}` : ''}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'focus',
      header: 'Focus',
      mobileLabel: 'Focus area',
      // Drops out before Owner/Deadline do — useful, but not load-bearing.
      desktopHiddenBelow: 'lg',
      render: (g) =>
        g.focus_area ? (
          <FocusAreaBadge focus={g.focus_area} compact />
        ) : (
          <span className="text-[13px] text-[#475569]">—</span>
        ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (g) => <span className="text-[14px] text-[#1E293B]">{g.owner?.name ?? '—'}</span>,
    },
    {
      key: 'due',
      header: 'Deadline',
      desktopHiddenBelow: 'md',
      render: (g) => <span className="text-[14px] text-[#1E293B]">{formatDate(g.due_date)}</span>,
    },
    {
      key: 'days',
      header: 'Days left',
      render: (g) => {
        const d = daysLeftLabel(g.days_left)
        const closed = g.status === 'achieved' || g.status === 'closed'
        return (
          <span className={`text-[13px] font-medium ${closed ? 'text-[#475569]' : DAYS_TONE[d.tone]}`}>
            {closed ? '—' : d.text}
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (g) => <GoalStatusBadge status={g.status} />,
    },
    {
      key: 'number',
      header: 'Number',
      desktopHiddenBelow: 'lg',
      render: (g) =>
        g.target_value === null || g.target_value === undefined ? (
          <span className="text-[13px] text-[#475569]">—</span>
        ) : (
          <span className="text-[13px] text-[#1E293B] tabular-nums whitespace-nowrap">
            {g.current_value === null || g.current_value === undefined ? '—' : g.current_value}
            <span className="text-[#475569]"> of {formatValue(g.target_value, g.unit)}</span>
          </span>
        ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      align: 'center',
      desktopHiddenBelow: 'lg',
      render: (g) => {
        const t = g.task_counts ?? { open: 0, closed: 0 }
        if (!t.open && !t.closed) return <span className="text-[13px] text-[#475569]">—</span>
        return (
          <span className="text-[13px] whitespace-nowrap">
            <span className="font-semibold text-[#0F172A]">{t.open}</span>
            <span className="text-[#475569]"> open</span>
            <span className="text-[#CBD5E1]"> · </span>
            <span className="text-[#475569]">{t.closed} done</span>
          </span>
        )
      },
    },
    {
      key: 'last',
      header: 'Last check-in',
      desktopHiddenBelow: 'xl',
      render: (g) => (
        <span className="text-[13px] text-[#475569] whitespace-nowrap">
          {g.last_check_in_at ? formatDate(g.last_check_in_at) : 'Never'}
        </span>
      ),
    },
  ]

  // A failed lookup is not a denial — offer a retry instead of claiming the
  // role lacks access.
  if (permsFailed) return <PermissionsUnavailable onRetry={retryPerms} />

  if (!permsLoading && !perms.read) {
    return <AccessHiddenState orgId={orgId} leaf="goals" moduleLabel="Goals" />
  }

  return (
    <div>
      {/* Sticky header so the primary action never scrolls away — DESIGN_RULES Part 3 */}
      <div className="sticky top-0 z-20 bg-[#F8FAFC] pb-4 -mt-2 pt-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">Goals</h1>
              <CountBadge count={filtered.length} />
            </div>
            <p className="text-sm text-[#475569] mt-1">
              Every goal in the company. Open one to see what it needs, what it powers, and its
              check-in record.
            </p>
          </div>
          {perms.write && (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors shrink-0"
            >
              <Plus size={16} /> New goal
            </button>
          )}
        </div>

        {/* Search stays inline (it's typed, not chosen); every facet lives
            behind one Filters button, with its options built from the data. */}
        <div className="flex items-center gap-2.5 flex-wrap mt-4">
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search goals…"
              className="w-full border border-[#CBD5E1] rounded-[8px] pl-9 pr-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>
          <FilterButton
            sections={filterSections}
            onClearAll={clearAllFacets}
            resultCount={filtered.length}
          />
          {isFiltered && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#475569] hover:text-[#0F172A] transition-colors"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={filtered}
        rowKey={(g) => g.id}
        onRowClick={(g) => router.push(`/goals/${g.id}`)}
        loading={loading}
        // Nine columns don't fit comfortably below ~1180px — give the table a
        // floor so it scrolls horizontally instead of squashing every cell.
        minTableWidth={1180}
        maxBodyHeight="min(66vh, 660px)"
        emptyState={
          <EmptyState
            icon={<Target size={26} />}
            title={isFiltered ? 'No goals match your filters' : 'No goals yet'}
            subtitle={
              isFiltered
                ? 'Try clearing a filter.'
                : 'Start with the outcome you actually want — the number, the owner, the date. You can link supporting goals to it afterwards.'
            }
            action={
              isFiltered ? (
                <button
                  onClick={clearFilters}
                  className="mt-1 text-sm font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
                >
                  Clear filters
                </button>
              ) : perms.write ? (
                <button
                  onClick={() => setCreateOpen(true)}
                  className="mt-1 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors"
                >
                  <Plus size={16} /> New goal
                </button>
              ) : undefined
            }
          />
        }
      />

      <CreateGoalModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        orgId={orgId}
        employees={employees}
        defaultOwnerId={user?.id}
        onCreated={(g) => router.push(`/goals/${g.id}`)}
      />
    </div>
  )
}
