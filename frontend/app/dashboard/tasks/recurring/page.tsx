'use client'

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { type DeptGroup } from '@/components/tasks/PeopleDeptFilter'
import type {
  RecurringTemplate,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  WorkScope,
  RecurringRelation,
  EligibleAssigneesResponse,
} from '@/lib/types/tasks'
import type { EmployeePickerOption } from '@/components/ui/EmployeePicker'
import AssigneeAvatars, { type AvatarPerson } from '@/components/tasks/AssigneeAvatars'
import CreateTaskModal from '@/components/tasks/CreateTaskModal'
import EditRecurringModal from '@/components/tasks/EditRecurringModal'
import ManageAccessModal from '@/components/tasks/ManageAccessModal'
import RecurringTable from '@/components/tasks/RecurringTable'
import RecurringFilterToolbar, {
  type RecurringFilters,
  EMPTY_RECURRING_FILTERS,
  isRecurringFiltered,
  normalizeRecurringFilters,
  tagsOnTemplates,
} from '@/components/tasks/RecurringFilterToolbar'
import { useSessionState } from '@/lib/tasks/useSessionState'
import ScopeSwitcher from '@/components/tasks/overview/ScopeSwitcher'
import Tooltip from '@/components/ui/Tooltip'
import { entryLabel, formatDate } from '@/lib/tasks/recurrence-label'
import {
  RotateCcw, Play, Pause, Calendar, Users, Plus, Trash2, Edit2, Zap, Shield,
  LayoutGrid, Table as TableIcon, ArrowUpRight, ArrowDownLeft, Inbox,
} from 'lucide-react'

// ─── Delete flow ──────────────────────────────────────────────────────────────

type DeleteMode = 'stop' | 'delete-future' | 'delete-all'

const DELETE_COPY: Record<DeleteMode, { title: string; body: string; confirm: string; danger: boolean }> = {
  stop: {
    title: 'Stop this recurring task?',
    body: 'No new tasks will be created from it. Every task it already created stays untouched. You can Resume it any time.',
    confirm: 'Stop',
    danger: false,
  },
  'delete-future': {
    title: 'Stop and remove open tasks?',
    body: 'No new tasks will be created, and its still-open tasks are removed. Tasks that were already completed or closed are kept.',
    confirm: 'Stop & remove open tasks',
    danger: true,
  },
  'delete-all': {
    title: 'Delete everything?',
    body: 'The recurring task AND every task it ever created — including completed ones — will be deleted. This cannot be undone.',
    confirm: 'Delete everything',
    danger: true,
  },
}

function DeleteConfirmDialog({
  template, mode, onCancel, onConfirm,
}: {
  template: RecurringTemplate
  mode: DeleteMode
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = DELETE_COPY[mode]
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-5">
        <h3 className="text-[16px] font-semibold text-[#0F172A]">{copy.title}</h3>
        <p className="text-sm text-[#475569] mt-1.5">
          <span className="font-medium text-[#0F172A]">“{template.title}”</span> — {copy.body}
        </p>
        {error && (
          <div className="mt-3 bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-3 py-2 text-sm text-[#DC2626]">{error}</div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] disabled:opacity-60 transition-colors">
            Cancel
          </button>
          <button type="button"
            onClick={async () => {
              setBusy(true); setError(null)
              try { await onConfirm() }
              catch (e: any) { setError(e?.response?.data?.message ?? 'Could not do this — please try again.') }
              finally { setBusy(false) }
            }}
            disabled={busy}
            className={['px-4 py-2 text-sm font-semibold text-white rounded-[8px] disabled:opacity-60 transition-colors',
              copy.danger ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#2563EB] hover:bg-[#1D4ED8]'].join(' ')}>
            {busy ? 'Working…' : copy.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Template card ─────────────────────────────────────────────────────────────

function RecurringCard({
  template, onEdit, onPause, onResume, onDelete, onSpawnToday, onClick, onManageAccess, userMap,
}: {
  template: RecurringTemplate
  onEdit: () => void
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onDelete: (mode: DeleteMode) => void
  onSpawnToday: () => Promise<{ spawned: number }>
  onClick: () => void
  onManageAccess: () => void
  userMap: Map<string, { name: string; department?: string; role?: string }>
}) {
  const [toggling, setToggling] = useState(false)
  const [spawning, setSpawning] = useState(false)
  const [spawnMsg, setSpawnMsg] = useState<string | null>(null)
  const [toggleErr, setToggleErr] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)

  async function handleToggle() {
    setToggling(true); setToggleErr(null)
    try {
      if (template.is_active) await onPause()
      else await onResume()
    } catch (e: any) {
      setToggleErr(e?.response?.data?.message ?? 'Could not change status.')
      setTimeout(() => setToggleErr(null), 3000)
    } finally { setToggling(false) }
  }

  async function handleSpawnToday() {
    setSpawning(true); setSpawnMsg(null)
    try {
      const result = await onSpawnToday()
      setSpawnMsg(result.spawned > 0 ? `${result.spawned} task${result.spawned !== 1 ? 's' : ''} created` : 'Already spawned today')
    } catch (e: any) {
      setSpawnMsg(e?.response?.data?.message ? 'Failed' : 'Failed')
    } finally {
      setSpawning(false)
      setTimeout(() => setSpawnMsg(null), 3000)
    }
  }

  const entries = template.schedule_entries ?? []
  const earliestStart = entries.length > 0
    ? entries.reduce((min, e) => e.start_date < min ? e.start_date : min, entries[0].start_date)
    : null
  const totalOccurrences = template.occurrences ?? entries.reduce((sum, e) => sum + (e.occurrence_count ?? 0), 0)

  const toPerson = (uid: string, isCC: boolean): AvatarPerson => {
    const u = userMap.get(uid)
    return { id: uid, name: u?.name ?? '?', department: u?.department, role: u?.role, isCC }
  }
  const people: AvatarPerson[] = [
    ...(template.assignee_user_ids ?? []).map((uid) => toPerson(uid, false)),
    ...(template.cc_user_ids ?? []).map((uid) => toPerson(uid, true)),
  ]

  return (
    <div onClick={onClick}
      className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 cursor-pointer hover:border-[#2563EB] hover:shadow-md transition-all duration-150 group flex flex-col h-[280px]">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={['inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium',
              template.is_active ? 'bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]' : 'bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]'].join(' ')}>
              {template.is_active ? 'Active' : 'Paused'}
            </span>
            {entries.length > 1 && (
              <span className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
                {entries.length} schedules
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {template.can_manage && (
              <Tooltip label="Manage access">
                <button onClick={(e) => { e.stopPropagation(); onManageAccess() }} aria-label="Manage access"
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors">
                  <Shield size={13} />
                </button>
              </Tooltip>
            )}
            {template.can_edit && (
              <Tooltip label="Edit template">
                <button onClick={(e) => { e.stopPropagation(); onEdit() }} aria-label="Edit template"
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors">
                  <Edit2 size={13} />
                </button>
              </Tooltip>
            )}
            {template.can_edit && template.is_active && (
              <Tooltip label="Spawn today's task now">
                <button onClick={(e) => { e.stopPropagation(); handleSpawnToday() }} disabled={spawning}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-[8px] text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] hover:bg-[#DBEAFE] disabled:opacity-60 transition-colors">
                  <Zap size={11} />{spawning ? '...' : spawnMsg ?? 'Run Today'}
                </button>
              </Tooltip>
            )}
            {template.can_edit && (
              <button onClick={(e) => { e.stopPropagation(); handleToggle() }} disabled={toggling}
                className={['flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-[8px] transition-colors disabled:opacity-60',
                  template.is_active ? 'text-[#D97706] bg-[#FEF9C3] border border-[#FDE68A] hover:bg-[#FDE68A]' : 'text-[#16A34A] bg-[#DCFCE7] border border-[#BBF7D0] hover:bg-[#BBF7D0]'].join(' ')}>
                {template.is_active ? <Pause size={11} /> : <Play size={11} />}
                {toggling ? '...' : template.is_active ? 'Pause' : 'Resume'}
              </button>
            )}
            {template.can_manage && (
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowDeleteMenu((v) => !v) }}
                className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors">
                <Trash2 size={13} />
              </button>
              {showDeleteMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-[#E2E8F0] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] p-1.5 min-w-[220px]">
                  <button onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); onDelete('stop') }} className="w-full text-left px-3 py-2 rounded-[6px] hover:bg-[#F1F5F9]">
                    <span className="block text-sm font-medium text-[#0F172A]">Stop (keep all tasks)</span>
                    <span className="block text-[11px] text-[#475569]">No new tasks; existing ones stay</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); onDelete('delete-future') }} className="w-full text-left px-3 py-2 rounded-[6px] hover:bg-[#FEE2E2]">
                    <span className="block text-sm font-medium text-[#DC2626]">Stop & remove open tasks</span>
                    <span className="block text-[11px] text-[#475569]">Completed ones are kept</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); onDelete('delete-all') }} className="w-full text-left px-3 py-2 rounded-[6px] hover:bg-[#FEE2E2]">
                    <span className="block text-sm font-medium text-[#DC2626]">Delete everything</span>
                    <span className="block text-[11px] text-[#475569]">Removes it and every task it created</span>
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
        <h3 className="text-[15px] font-semibold text-[#0F172A] break-words group-hover:text-[#2563EB] transition-colors line-clamp-1">{template.title}</h3>
        {template.description && <p className="text-sm text-[#475569] mt-0.5 line-clamp-2">{template.description}</p>}
        {toggleErr && <p className="text-[12px] text-[#DC2626] mt-1">{toggleErr}</p>}
      </div>

      <div className="space-y-1 mb-3 overflow-y-auto flex-1 min-h-0">
        {entries.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">No schedule configured</p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-sm text-[#475569]">
              <RotateCcw size={12} className="text-[#94A3B8] shrink-0" />
              <span>{entryLabel(entry)}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#475569] shrink-0">
        <span>By {template.created_by_name ?? 'Unknown'}</span>
        <span className="text-[#CBD5E1]">·</span>
        {earliestStart && (
          <>
            <div className="flex items-center gap-1.5"><Calendar size={12} className="text-[#94A3B8]" /><span>From {formatDate(earliestStart)}</span></div>
            <span className="text-[#CBD5E1]">·</span>
          </>
        )}
        <span>{totalOccurrences} occurrence{totalOccurrences !== 1 ? 's' : ''}</span>
      </div>

      {people.length > 0 && (
        <div className="mt-3 flex items-center gap-2 shrink-0">
          <Users size={12} className="text-[#94A3B8]" />
          <AssigneeAvatars people={people} max={5} size="sm" />
          <span className="text-xs text-[#475569]">
            {template.assignee_user_ids.length} assignee{template.assignee_user_ids.length !== 1 ? 's' : ''}
            {(template.cc_user_ids?.length ?? 0) > 0 && ` · ${template.cc_user_ids.length} CC`}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SCOPE_BLURB: Record<WorkScope, string> = {
  own: 'Recurring work you send and receive.',
  team: 'Recurring work your reporting team sends and receives.',
  department: 'Your department’s recurring work.',
  org: 'Every recurring template across the company.',
}

export default function RecurringPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  // Scope / relation / view
  const [requestedScope, setRequestedScope] = useState<WorkScope | undefined>(undefined)
  const [appliedScope, setAppliedScope] = useState<WorkScope>('own')
  const [maxScope, setMaxScope] = useState<WorkScope | null>(null)
  const [relation, setRelation] = useState<Exclude<RecurringRelation, 'all'>>('outgoing')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [viewTouched, setViewTouched] = useState(false)

  // Filters
  const [searchInput, setSearchInput] = useSessionState('tasks:recurring:search', '')
  const [search, setSearch] = useState('')
  // Stored filters may predate a section (e.g. tags) — normalise so old objects still load.
  const [storedFilters, setFilters] = useSessionState<RecurringFilters>('tasks:recurring:filters', { ...EMPTY_RECURRING_FILTERS })
  const filters = useMemo(() => normalizeRecurringFilters(storedFilters), [storedFilters])

  // Data
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [userMap, setUserMap] = useState<Map<string, { name: string; department?: string; role?: string }>>(new Map())
  const [employees, setEmployees] = useState<EmployeePickerOption[]>([])
  const [loading, setLoading] = useState(true)

  // Modals
  const [showCreate, setShowCreate] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ template: RecurringTemplate; mode: DeleteMode } | null>(null)
  const [manageTarget, setManageTarget] = useState<RecurringTemplate | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Static reference data (once).
  useEffect(() => {
    if (!orgId) return
    Promise.all([
      tasksApi.getCategories(orgId).catch(() => [] as TaskCategory[]),
      tasksApi.getPriorities(orgId).catch(() => [] as TaskPriority[]),
      tasksApi.getStatuses(orgId).catch(() => [] as TaskStatus[]),
      tasksApi.getEligibleAssignees(orgId).catch(() => ({ departments: [], total: 0 } as EligibleAssigneesResponse)),
    ]).then(([c, p, s, eligible]) => {
      setCategories(c); setPriorities(p); setStatuses(s)
      const map = new Map<string, { name: string; department?: string; role?: string }>()
      const opts: EmployeePickerOption[] = []
      eligible.departments.forEach((dept) => dept.users.forEach((u) => {
        map.set(u.user_id, { name: u.name, department: u.department_name, role: u.role_title })
        opts.push({ user_id: u.user_id, name: u.name, role_title: u.role_title, department_name: u.department_name })
      }))
      setUserMap(map); setEmployees(opts)
    })
  }, [orgId])

  // The filter sections (status / priority / category / tags / assignee) AND the text
  // search are all applied client-side over the loaded (unpaginated) set, so the server
  // query only carries scope and relation. Search runs here because the server's search
  // covers title + description only, and kit §27.1 needs it to cover tags and people too.
  const query = useMemo(() => ({
    scope: requestedScope,
    relation: appliedScope === 'org' ? undefined : relation,
  }), [requestedScope, relation, appliedScope])

  const queryKey = JSON.stringify(query)
  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    tasksApi.listRecurringTemplates(orgId, JSON.parse(queryKey))
      .then((res) => {
        setTemplates(res.items)
        setMaxScope(res.max_scope)
        if (res.applied_scope) setAppliedScope(res.applied_scope)
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [orgId, queryKey])

  useEffect(() => { loadData() }, [loadData])

  // People actually assigned across the loaded templates, grouped by their department
  // (with job role) — the source for the Assignee filter. Only present people appear.
  const peopleGroups = useMemo<DeptGroup[]>(() => {
    // Name falls back to the row's positional assignee_names when someone isn't in the
    // eligible-assignees map (e.g. an org-scope template with people you can't assign to).
    const nameById = new Map<string, string>()
    templates.forEach((t) =>
      (t.assignee_user_ids ?? []).forEach((id, i) => {
        if (!nameById.has(id)) nameById.set(id, t.assignee_names?.[i] ?? '')
      }),
    )
    const groups = new Map<string, { id: string; name: string; role?: string | null }[]>()
    nameById.forEach((fallbackName, id) => {
      const info = userMap.get(id)
      const dept = info?.department || 'No department'
      if (!groups.has(dept)) groups.set(dept, [])
      groups.get(dept)!.push({ id, name: info?.name || fallbackName || '—', role: info?.role })
    })
    return Array.from(groups, ([department, people]) => ({ department, people }))
  }, [templates, userMap])

  // Tags on the loaded templates — the Tags filter offers only these (sorted by name).
  const tagOptions = useMemo(() => tagsOnTemplates(templates), [templates])

  // Apply the search and every filter section client-side over the scope/relation set.
  const visibleTemplates = useMemo(() => {
    const q = search.toLowerCase()
    const catName = new Map(categories.map((c) => [c.id, c.name]))
    const matchesSearch = (t: RecurringTemplate) => {
      if (!q) return true
      return [
        t.title,
        t.description ?? '',
        t.category_id ? catName.get(t.category_id) ?? '' : '',
        ...(t.tags ?? []).map((tag) => tag.name),
        t.created_by_name ?? '',
        t.department_name ?? '',
        ...(t.assignee_names ?? []),
      ].join(' ').toLowerCase().includes(q)
    }
    return templates.filter((t) => {
      if (!matchesSearch(t)) return false
      if (filters.statuses.length && !filters.statuses.some((s) => (s === 'active' ? t.is_active : !t.is_active))) return false
      if (filters.priorityIds.length && !(t.priority_id && filters.priorityIds.includes(t.priority_id))) return false
      if (filters.categoryIds.length && !(t.category_id && filters.categoryIds.includes(t.category_id))) return false
      if (filters.assigneeIds.length && !(t.assignee_user_ids ?? []).some((id) => filters.assigneeIds.includes(id))) return false
      if (filters.tagIds.length && !(t.tags ?? []).some((tag) => filters.tagIds.includes(tag.id))) return false
      return true
    })
  }, [templates, filters, search, categories])

  function handleScopeChange(s: WorkScope) {
    setRequestedScope(s)
    if (!viewTouched) setView(s === 'org' ? 'table' : 'cards')
  }
  function switchView(v: 'cards' | 'table') { setView(v); setViewTouched(true) }

  async function handlePause(id: string) {
    await tasksApi.pauseRecurring(orgId, id)
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, is_active: false } : t))
  }
  async function handleResume(id: string) {
    await tasksApi.resumeRecurring(orgId, id)
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, is_active: true } : t))
  }
  async function handleDeleteConfirmed() {
    if (!deleteTarget) return
    const { template, mode } = deleteTarget
    await tasksApi.deleteRecurring(orgId, template.id, mode)
    if (mode === 'delete-all') setTemplates((prev) => prev.filter((t) => t.id !== template.id))
    else setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, is_active: false } : t)))
    setDeleteTarget(null)
  }

  if (!orgId) {
    return <div className="flex flex-col items-center justify-center h-64"><p className="font-semibold text-[#0F172A]">No organization found</p></div>
  }

  const showRelation = appliedScope !== 'org'
  const filtersActive = isRecurringFiltered(filters) || !!search
  const relationEmpty = relation === 'outgoing'
    ? { icon: <ArrowUpRight size={24} className="text-[#94A3B8]" />, title: 'Nothing sent yet', sub: 'Recurring tasks you set up for others show here.' }
    : { icon: <Inbox size={24} className="text-[#94A3B8]" />, title: 'Nothing received', sub: 'Recurring tasks assigned to you show here.' }
  const emptyState = filtersActive
    ? { icon: <RotateCcw size={24} className="text-[#94A3B8]" />, title: search ? `No templates match ‘${search}’` : 'No templates match your filters', sub: 'Try adjusting or clearing the search and filters.' }
    : appliedScope === 'org'
      ? { icon: <RotateCcw size={24} className="text-[#94A3B8]" />, title: 'No recurring templates', sub: 'No templates match this view.' }
      : relationEmpty

  return (
    <div className="space-y-5 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight">Recurring Tasks</h1>
          <p className="mt-1 text-[15px] text-[#475569]">{SCOPE_BLURB[appliedScope]}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ScopeSwitcher maxScope={maxScope} value={appliedScope} onChange={handleScopeChange} />
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-[10px] bg-[#2563EB] text-white rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] transition-colors shrink-0">
            <Plus size={16} /> New Recurring Task
          </button>
        </div>
      </div>

      {/* Relation (incoming/outgoing) — Mine & Team only */}
      {showRelation && (
        <div className="inline-flex items-center border border-[#E2E8F0] rounded-[8px] bg-white p-0.5 gap-0.5">
          {([
            { key: 'outgoing', label: appliedScope === 'team' ? 'Sent by team' : 'Sent', icon: <ArrowUpRight size={15} /> },
            { key: 'incoming', label: appliedScope === 'team' ? 'Received by team' : 'Received', icon: <ArrowDownLeft size={15} /> },
          ] as const).map(({ key, label, icon }) => {
            const active = relation === key
            return (
              <button key={key} onClick={() => setRelation(key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] text-sm font-medium transition-colors ${active ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9]'}`}>
                {icon}<span>{label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Toolbar: search + collapsed Filters popover + chips (matches My Tasks / Assigned) */}
      <RecurringFilterToolbar
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        onFilters={setFilters}
        priorities={priorities}
        categories={categories}
        tags={tagOptions}
        peopleGroups={peopleGroups}
      />

      {/* Count + view toggle */}
      {!loading && visibleTemplates.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[#475569]"><span className="font-semibold text-[#0F172A] tabular-nums">{visibleTemplates.length}</span> template{visibleTemplates.length !== 1 ? 's' : ''}</p>
          <div className="inline-flex items-center border border-[#E2E8F0] rounded-[8px] bg-white p-0.5 gap-0.5 shrink-0">
            <Tooltip label="Cards">
              <button onClick={() => switchView('cards')} aria-label="Cards"
                className={`flex items-center justify-center w-8 h-8 rounded-[6px] transition-colors ${view === 'cards' ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:bg-[#F1F5F9]'}`}><LayoutGrid size={15} /></button>
            </Tooltip>
            <Tooltip label="Table">
              <button onClick={() => switchView('table')} aria-label="Table"
                className={`flex items-center justify-center w-8 h-8 rounded-[6px] transition-colors ${view === 'table' ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:bg-[#F1F5F9]'}`}><TableIcon size={15} /></button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
      ) : visibleTemplates.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">{emptyState.icon}</div>
          <p className="font-semibold text-[#0F172A]">{emptyState.title}</p>
          <p className="text-sm text-[#475569] mt-1 mb-5">{emptyState.sub}</p>
          {filtersActive ? (
            <button onClick={() => { setSearchInput(''); setFilters({ ...EMPTY_RECURRING_FILTERS }) }}
              className="px-5 py-[10px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors">
              Clear filters
            </button>
          ) : (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-[10px] bg-[#2563EB] text-white rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] transition-colors">
              <Plus size={16} /> New Recurring Task
            </button>
          )}
        </div>
      ) : view === 'table' ? (
        <RecurringTable
          rows={visibleTemplates}
          categories={categories}
          priorities={priorities}
          onOpen={(id) => router.push(`/dashboard/tasks/recurring/${id}`)}
          onManageAccess={(t) => setManageTarget(t)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTemplates.map((t) => (
            <RecurringCard
              key={t.id}
              template={t}
              onClick={() => router.push(`/dashboard/tasks/recurring/${t.id}`)}
              onEdit={() => setEditingTemplate(t)}
              onPause={() => handlePause(t.id)}
              onResume={() => handleResume(t.id)}
              onDelete={(mode) => setDeleteTarget({ template: t, mode })}
              onSpawnToday={() => tasksApi.spawnTodayRecurring(orgId, t.id).then((r) => { loadData(); return r })}
              onManageAccess={() => setManageTarget(t)}
              userMap={userMap}
            />
          ))}
        </div>
      )}

      <CreateTaskModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadData() }}
        categories={categories}
        priorities={priorities}
        statuses={statuses}
        initialMode="recurring"
        lockMode
      />

      {editingTemplate && (
        <EditRecurringModal
          template={editingTemplate}
          orgId={orgId}
          categories={categories}
          priorities={priorities}
          onClose={() => setEditingTemplate(null)}
          onUpdated={(updated) => { setTemplates((prev) => prev.map((t) => t.id === updated.id ? { ...t, ...updated } : t)); setEditingTemplate(null) }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog template={deleteTarget.template} mode={deleteTarget.mode} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirmed} />
      )}

      {manageTarget && (
        <ManageAccessModal orgId={orgId} templateId={manageTarget.id} employees={employees} onClose={() => setManageTarget(null)} />
      )}
    </div>
  )
}
