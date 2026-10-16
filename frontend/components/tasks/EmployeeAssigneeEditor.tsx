'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Zap, Briefcase, RotateCcw, Loader2, Check, UserPlus, Users, Trash2, HelpCircle } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { getEmployees } from '@/lib/api/employees'
import { toast } from 'sonner'
import Modal from '@/components/ui/Modal'
import Tooltip from '@/components/ui/tooltip'
import { computeNodeColors } from '@/lib/org-chart-colors'
import { flattenTree } from '@/lib/dept-tree'
import type { Department } from '@/lib/types'
import type {
  AssigneeVisibilityAdminView,
  AssigneeReason,
  EmployeeAssigneePreview,
  EmployeeAssigneeUser,
} from '@/lib/types/tasks'

// ─── Shared visual helpers (mirror AssigneeSelector) ─────────────────────────────

const avatarColors = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}
function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// Reason chip copy + style. Manual reasons are blue (an explicit human choice); rule
// reasons are neutral slate. Text never lighter than --text-secondary (design rule).
const REASON: Record<AssigneeReason, { label: string; manual?: boolean }> = {
  self: { label: 'Themselves' },
  subordinate: { label: 'Reports to them' },
  direct_manager: { label: 'Their manager' },
  department: { label: 'Same department' },
  unified_subtree: { label: 'Merged dept group' },
  bridge: { label: 'Cross-dept link' },
  full_visibility: { label: 'Full visibility' },
  master_override: { label: 'Master override' },
  manual_add: { label: 'Added manually', manual: true },
}

function ReasonChip({ reason }: { reason: AssigneeReason }) {
  const r = REASON[reason] ?? { label: reason }
  return (
    <span
      className={`text-meta font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${
        r.manual ? 'bg-primary-subtle text-primary-text border border-primary-border' : 'bg-surface-control text-text-secondary'
      }`}
    >
      {r.label}
    </span>
  )
}

interface ActiveEmp {
  user_id: string
  name: string
  role_title: string
  department_id: string
  department_name: string
}

type Draft = { added: string[]; removed: string[] }

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length

export default function EmployeeAssigneeEditor({
  orgId,
  view,
}: {
  orgId: string
  view: AssigneeVisibilityAdminView
}) {
  const [emps, setEmps] = useState<ActiveEmp[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<EmployeeAssigneePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [draft, setDraft] = useState<Draft>({ added: [], removed: [] })
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  const empById = useMemo(() => new Map(emps.map((e) => [e.user_id, e])), [emps])
  const allActiveIds = useMemo(() => emps.map((e) => e.user_id), [emps])

  // ── Load the active-employee directory once ──
  useEffect(() => {
    getEmployees(orgId)
      .then((list) =>
        setEmps(
          list
            .filter((e) => e.status === 'active' && e.user)
            .map((e) => ({
              user_id: e.user_id,
              name: e.user?.name ?? 'Unknown',
              role_title: e.role?.title ?? '',
              department_id: e.department_id,
              department_name: e.department?.name ?? 'Unassigned',
            })),
        ),
      )
      .catch(() => toast.error('Could not load employees'))
  }, [orgId])

  // ── Left list: employees grouped by department, departments in parent→child order ──
  const colors = useMemo(() => computeNodeColors(view.departments as unknown as Department[]), [view.departments])
  const colorOf = (id: string) => colors[id]?.base || 'var(--text-muted)'
  const deptOrder = useMemo(() => {
    const order = new Map<string, number>()
    flattenTree(view.departments as unknown as Department[]).forEach((r, i) => order.set(r.dept.id, i))
    return order
  }, [view.departments])

  const leftGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byDept = new Map<string, { id: string; name: string; users: ActiveEmp[] }>()
    for (const e of emps) {
      if (q && !`${e.name} ${e.role_title} ${e.department_name}`.toLowerCase().includes(q)) continue
      if (!byDept.has(e.department_id)) byDept.set(e.department_id, { id: e.department_id, name: e.department_name, users: [] })
      byDept.get(e.department_id)!.users.push(e)
    }
    const groups = Array.from(byDept.values())
    groups.forEach((g) => g.users.sort((a, b) => a.name.localeCompare(b.name)))
    groups.sort((a, b) => (deptOrder.get(a.id) ?? 9999) - (deptOrder.get(b.id) ?? 9999) || a.name.localeCompare(b.name))
    return groups
  }, [emps, search, deptOrder])

  // ── Load a selected employee's resolved list + override ──
  const loadPreview = useCallback(
    async (userId: string) => {
      setLoadingPreview(true)
      try {
        const data = await tasksApi.getEmployeeAssigneePreview(orgId, userId)
        setPreview(data)
        setDraft({ added: data.override.added_user_ids, removed: data.override.removed_user_ids })
      } catch {
        toast.error('Could not load this employee')
      } finally {
        setLoadingPreview(false)
      }
    },
    [orgId],
  )

  const dirty = useMemo(() => {
    if (!preview) return false
    return !sameSet(preview.override.added_user_ids, draft.added) || !sameSet(preview.override.removed_user_ids, draft.removed)
  }, [preview, draft])

  function proceedSelect(userId: string) {
    setSelectedId(userId)
    setShowAdd(false)
    setAddQuery('')
    setShowWhy(false)
    loadPreview(userId)
  }
  function selectEmployee(userId: string) {
    if (userId === selectedId) return
    if (dirty) setPendingSelect(userId)
    else proceedSelect(userId)
  }

  // Close the add-picker on outside-click / Esc.
  useEffect(() => {
    if (!showAdd) return
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setShowAdd(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAdd(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showAdd])

  // ── Membership math: final = (ruleBase ∪ added) − removed, self pinned ──
  const previewUserById = useMemo(() => {
    const m = new Map<string, EmployeeAssigneeUser>()
    preview?.departments.forEach((g) => g.users.forEach((u) => m.set(u.user_id, u)))
    return m
  }, [preview])

  // The pure rule-derived set, independent of any saved manual edits.
  const ruleBaseSet = useMemo(() => {
    const s = new Set<string>()
    if (!preview) return s
    for (const g of preview.departments) for (const u of g.users) if (u.reason !== 'manual_add') s.add(u.user_id)
    for (const r of preview.removed) if (r.would_be_reason !== null) s.add(r.user_id)
    return s
  }, [preview])

  const memberIds = useMemo(() => {
    const s = new Set(ruleBaseSet)
    draft.added.forEach((id) => s.add(id))
    draft.removed.forEach((id) => s.delete(id))
    if (selectedId) s.add(selectedId) // self always pinned
    return s
  }, [ruleBaseSet, draft, selectedId])

  function addMember(id: string) {
    setDraft((d) => ({
      removed: d.removed.filter((x) => x !== id),
      added: ruleBaseSet.has(id) || id === selectedId || d.added.includes(id) ? d.added : [...d.added, id],
    }))
  }
  function removeMember(id: string) {
    if (id === selectedId) return // self can't be removed
    setDraft((d) => ({
      added: d.added.filter((x) => x !== id),
      removed: ruleBaseSet.has(id) && !d.removed.includes(id) ? [...d.removed, id] : d.removed,
    }))
  }
  const toggleMember = (id: string) => (memberIds.has(id) ? removeMember(id) : addMember(id))

  const allSelected = allActiveIds.length > 0 && allActiveIds.every((id) => memberIds.has(id))
  function selectAll() {
    setDraft({ added: allActiveIds.filter((id) => id !== selectedId && !ruleBaseSet.has(id)), removed: [] })
  }
  function removeAll() {
    setDraft({ added: [], removed: allActiveIds.filter((id) => id !== selectedId) })
  }
  function resetToRules() {
    setDraft({ added: [], removed: [] })
  }

  async function save() {
    if (!selectedId) return
    setSaving(true)
    try {
      await tasksApi.setEmployeeManualOverride(orgId, {
        employee_user_id: selectedId,
        added_user_ids: draft.added,
        removed_user_ids: draft.removed,
      })
      toast.success('Saved')
      await loadPreview(selectedId)
    } catch {
      toast.error('Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  // ── Rendered member list (grouped by dept, parent→child), recomputed from the draft ──
  const memberGroups = useMemo(() => {
    const byDept = new Map<string, { department_id: string; department_name: string; users: { user_id: string; name: string; role_title: string; reason: AssigneeReason; badges?: EmployeeAssigneeUser }[] }>()
    for (const id of Array.from(memberIds)) {
      const pu = previewUserById.get(id)
      const e = empById.get(id)
      const deptId = pu?.department_id ?? e?.department_id ?? 'unknown'
      const deptName = pu?.department_name ?? e?.department_name ?? 'Unassigned'
      if (!byDept.has(deptId)) byDept.set(deptId, { department_id: deptId, department_name: deptName, users: [] })
      byDept.get(deptId)!.users.push({
        user_id: id,
        name: pu?.name ?? e?.name ?? 'Unknown',
        role_title: pu?.role_title ?? e?.role_title ?? '',
        reason: (pu?.reason ?? 'manual_add') as AssigneeReason,
        badges: pu,
      })
    }
    const groups = Array.from(byDept.values())
    groups.forEach((g) =>
      g.users.sort((a, b) => Number(b.user_id === selectedId) - Number(a.user_id === selectedId) || a.name.localeCompare(b.name)),
    )
    groups.sort((a, b) => (deptOrder.get(a.department_id) ?? 9999) - (deptOrder.get(b.department_id) ?? 9999) || a.department_name.localeCompare(b.department_name))
    return groups
  }, [memberIds, previewUserById, empById, deptOrder, selectedId])

  // ── Removed band ──
  const removedRows = useMemo(() => {
    const fromPreviewRemoved = new Map(preview?.removed.map((r) => [r.user_id, r]) ?? [])
    return draft.removed
      .filter((id) => id !== selectedId)
      .map((id) => {
        const r = fromPreviewRemoved.get(id)
        const pu = previewUserById.get(id)
        const e = empById.get(id)
        return {
          user_id: id,
          name: r?.name ?? pu?.name ?? e?.name ?? 'Unknown',
          would_be_reason: (r?.would_be_reason ?? pu?.reason ?? (ruleBaseSet.has(id) ? 'department' : null)) as AssigneeReason | null,
        }
      })
  }, [draft.removed, preview, previewUserById, empById, ruleBaseSet, selectedId])

  const addCandidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return emps.filter((e) => e.user_id !== selectedId && (!q || e.name.toLowerCase().includes(q)))
  }, [emps, addQuery, selectedId])

  // ── "Why this list?" rule-wise breakdown ──
  const whyGroups = useMemo(() => {
    const order: AssigneeReason[] = ['self', 'subordinate', 'direct_manager', 'department', 'unified_subtree', 'bridge', 'full_visibility', 'master_override', 'manual_add']
    const by = new Map<AssigneeReason, string[]>()
    for (const id of Array.from(memberIds)) {
      const reason = (previewUserById.get(id)?.reason ?? 'manual_add') as AssigneeReason
      if (!by.has(reason)) by.set(reason, [])
      by.get(reason)!.push(previewUserById.get(id)?.name ?? empById.get(id)?.name ?? 'Unknown')
    }
    return order.filter((r) => by.has(r)).map((r) => ({ reason: r, names: by.get(r)!.sort((a, b) => a.localeCompare(b)) }))
  }, [memberIds, previewUserById, empById])

  const ownDept = useMemo(
    () => (preview ? view.departments.find((d) => d.id === preview.employee.department_id) ?? null : null),
    [preview, view.departments],
  )
  const ownBridges = useMemo(
    () => (preview ? view.bridges.filter((b) => b.from_department_id === preview.employee.department_id) : []),
    [preview, view.bridges],
  )

  const memberCount = memberIds.size
  const totalActive = emps.length

  return (
    <div className="space-y-4">
      {/* Search bar (filters the employee list) */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, role or department…"
          className="w-full pl-8 pr-3 py-2.5 text-body text-text-primary placeholder:text-text-muted bg-surface border border-border rounded-lg focus:outline-hidden focus:border-primary focus:border-2"
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ── Left: employees by department ── */}
        <div className="lg:w-[320px] shrink-0 bg-surface border border-border-light rounded-xl shadow-card overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto divide-y divide-surface-control">
            {leftGroups.length === 0 && <p className="px-4 py-6 text-label text-text-secondary text-center">No employees found.</p>}
            {leftGroups.map((g) => (
              <div key={g.id}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-sunken border-b border-border-light sticky top-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(g.id) }} />
                  <span className="text-meta font-medium text-text-muted uppercase tracking-wide truncate">{g.name}</span>
                </div>
                {g.users.map((e) => (
                  <button
                    key={e.user_id}
                    type="button"
                    onClick={() => selectEmployee(e.user_id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      selectedId === e.user_id ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(e.name)}`}>
                      {getInitials(e.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-body font-medium text-text-primary truncate">{e.name}</p>
                      <p className="text-meta text-text-muted truncate">{e.role_title}</p>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: resolved Assignees & CC list + editor ── */}
        <div className="flex-1 min-w-0 bg-surface border border-border-light rounded-xl shadow-card overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center text-center py-12 px-6">
              <Users size={28} className="text-text-muted" />
              <p className="mt-3 text-body font-medium text-text-primary">Pick an employee</p>
              <p className="mt-1 text-label text-text-secondary">Select someone on the left to see exactly who they can assign to, and why.</p>
            </div>
          ) : loadingPreview && !preview ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-primary-text" />
            </div>
          ) : preview ? (
            <div className="flex flex-col max-h-[640px]">
              {/* Header */}
              <div className="px-4 py-3 border-b border-border-light flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(preview.employee.name)}`}>
                  {getInitials(preview.employee.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-text-primary truncate">{preview.employee.name}</p>
                  <div className="flex items-center gap-1.5 text-meta text-text-secondary">
                    <span className="truncate">
                      {preview.employee.role_title}
                      {preview.employee.department_name ? ` · ${preview.employee.department_name}` : ''}
                    </span>
                    <Tooltip label={`Can assign to ${memberCount} of ${totalActive}`}>
                      <span className="shrink-0 font-medium text-text-primary tabular-nums">
                        · {memberCount}/{totalActive}
                      </span>
                    </Tooltip>
                  </div>
                </div>
                {/* Why + Save */}
                <button
                  type="button"
                  onClick={() => setShowWhy(true)}
                  className="inline-flex items-center gap-1 text-meta font-medium text-text-secondary hover:text-text-secondary transition-colors shrink-0"
                >
                  <HelpCircle size={15} /> Why?
                </button>
                <Tooltip label={dirty ? 'Save changes' : 'All changes saved'}>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || saving}
                  aria-label="Save"
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                    !dirty || saving ? 'bg-surface-control-pressed text-text-muted cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary-hover'
                  }`}
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={18} strokeWidth={3} />}
                </button>
                </Tooltip>
              </div>

              {/* Controls */}
              <div className="px-4 py-2.5 border-b border-border-light flex items-center gap-3 flex-wrap">
                <div className="relative" ref={addRef}>
                  <button
                    type="button"
                    onClick={() => setShowAdd((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-body font-medium text-primary-text hover:text-primary-text transition-colors"
                  >
                    <UserPlus size={15} /> Add / remove people
                  </button>
                  {showAdd && (
                    <div className="absolute z-30 mt-2 w-[300px] max-w-[80vw] bg-surface border border-border rounded-lg shadow-menu overflow-hidden">
                      <div className="relative border-b border-border-light">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                          value={addQuery}
                          onChange={(e) => setAddQuery(e.target.value)}
                          placeholder="Search people…"
                          className="w-full pl-8 pr-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden"
                        />
                      </div>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-light bg-surface-sunken">
                        <label className="flex items-center gap-2 text-meta font-medium text-text-primary cursor-pointer">
                          <span className={`w-4 h-4 rounded-tick border flex items-center justify-center ${allSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                            {allSelected && <Check size={11} className="text-primary-foreground" strokeWidth={3} />}
                          </span>
                          <input type="checkbox" className="sr-only" checked={allSelected} onChange={() => (allSelected ? removeAll() : selectAll())} />
                          Select all
                        </label>
                        <button type="button" onClick={resetToRules} className="text-meta font-medium text-text-secondary hover:text-text-primary transition-colors">
                          Reset to rules
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-surface-control">
                        {addCandidates.length === 0 && <p className="px-3 py-3 text-meta text-text-secondary">No people found.</p>}
                        {addCandidates.map((e) => {
                          const on = memberIds.has(e.user_id)
                          return (
                            <button
                              key={e.user_id}
                              type="button"
                              onClick={() => toggleMember(e.user_id)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-body transition-colors ${on ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'}`}
                            >
                              <span className={`w-4 h-4 rounded-tick border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-border'}`}>
                                {on && <Check size={11} className="text-primary-foreground" strokeWidth={3} />}
                              </span>
                              <span className="text-text-primary truncate">{e.name}</span>
                              <span className="text-meta text-text-muted truncate ml-auto">{e.department_name}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <button type="button" onClick={resetToRules} className="inline-flex items-center gap-1.5 text-label font-medium text-text-secondary hover:text-text-primary transition-colors">
                  <RotateCcw size={14} /> Reset to rules
                </button>
                <button type="button" onClick={removeAll} className="inline-flex items-center gap-1.5 text-body font-medium text-danger hover:text-danger transition-colors ml-auto">
                  <Trash2 size={14} /> Remove all
                </button>
              </div>

              {/* Removed band — prominent, at the top */}
              {removedRows.length > 0 && (
                <div className="border-b border-danger-border bg-danger-bg">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-meta font-medium text-danger uppercase tracking-wide">Removed ({removedRows.length})</span>
                    <button type="button" onClick={resetToRules} className="inline-flex items-center gap-1 text-meta font-medium text-primary-text hover:text-primary-text transition-colors">
                      <RotateCcw size={13} /> Restore all
                    </button>
                  </div>
                  {removedRows.length > 12 ? (
                    <p className="px-3 pb-2 text-meta text-danger">{removedRows.length} people removed — “Restore all” or “Reset to rules” to bring them back.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      {removedRows.map((r) => (
                        <div key={r.user_id} className="flex items-center gap-3 px-3 py-1.5">
                          <span className="text-body font-medium text-text-muted line-through truncate flex-1">{r.name}</span>
                          <span className="text-meta text-text-muted truncate">
                            {r.would_be_reason ? `was: ${REASON[r.would_be_reason]?.label ?? r.would_be_reason}` : 'not in rules either'}
                          </span>
                          <button
                            type="button"
                            onClick={() => addMember(r.user_id)}
                            className="inline-flex items-center gap-1 text-meta font-medium text-primary-text hover:text-primary-text transition-colors shrink-0"
                          >
                            <RotateCcw size={12} /> Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Resolved list */}
              <div className="flex-1 overflow-y-auto divide-y divide-surface-control">
                {memberGroups.length === 0 && (
                  <p className="px-4 py-6 text-label text-text-secondary text-center">Assigns to no one but themselves.</p>
                )}
                {memberGroups.map((g) => (
                  <div key={g.department_id}>
                    <div className="px-3 py-1.5 bg-surface-sunken border-b border-border-light">
                      <span className="text-meta font-medium text-text-muted uppercase tracking-wide">{g.department_name}</span>
                    </div>
                    {g.users.map((u) => (
                      <Row
                        key={u.user_id}
                        name={u.name}
                        role={u.role_title}
                        reason={u.reason}
                        badges={u.badges}
                        isSelf={u.user_id === selectedId}
                        onRemove={u.user_id === selectedId ? undefined : () => removeMember(u.user_id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Discard-changes confirm (in-app, not browser) */}
      <Modal isOpen={pendingSelect !== null} onClose={() => setPendingSelect(null)} title="Discard unsaved changes?" size="sm">
        <p className="text-label text-text-secondary">You have unsaved changes for this employee. Switch anyway and lose them?</p>
        <div className="flex gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={() => setPendingSelect(null)}
            className="px-4 py-2 text-body font-medium text-text-primary bg-surface-control hover:bg-surface-control-pressed rounded-lg transition-colors"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              const id = pendingSelect!
              setPendingSelect(null)
              proceedSelect(id)
            }}
            className="px-4 py-2 text-body font-medium text-primary-foreground bg-danger hover:bg-danger-hover rounded-lg transition-colors"
          >
            Discard
          </button>
        </div>
      </Modal>

      {/* "Why this list?" breakdown */}
      <Modal isOpen={showWhy} onClose={() => setShowWhy(false)} title={`Why ${preview?.employee.name ?? 'this person'} sees this list`} size="md">
        <div className="space-y-4">
          <p className="text-label text-text-secondary">
            {memberCount} of {totalActive} people, built from the rules below (most-granular per-employee edits applied on top).
          </p>
          <div className="space-y-3">
            {whyGroups.map((grp) => (
              <div key={grp.reason} className="border border-border-light rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-sunken border-b border-border-light">
                  <span className="text-body font-medium text-text-primary">{REASON[grp.reason]?.label ?? grp.reason}</span>
                  <span className="text-meta font-medium text-text-secondary">{grp.names.length}</span>
                </div>
                <p className="px-3 py-2 text-body text-text-primary">{grp.names.join(', ')}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-surface-control border border-border-light p-3 space-y-1.5 text-body text-text-secondary">
            <p className="font-medium text-text-secondary">Rules in effect</p>
            {ownDept ? (
              <p>
                Department <span className="font-medium">{ownDept.name}</span> — assigning up the chain is{' '}
                {ownDept.assignee_allow_upward ? 'ON' : 'OFF'}
                {ownDept.assignee_unify_subtree ? '; sub-departments merged into one pool' : ''}.
              </p>
            ) : (
              <p>No department on this employee’s profile.</p>
            )}
            {ownBridges.length > 0 ? (
              ownBridges.map((b) => (
                <p key={b.id}>
                  Cross-dept link → <span className="font-medium">{b.to_department_name ?? 'another dept'}</span> ({b.match_count} people).
                </p>
              ))
            ) : (
              <p>No cross-department links from their department.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Resolved-list row ───────────────────────────────────────────────────────────

function Row({
  name,
  role,
  reason,
  badges,
  isSelf,
  onRemove,
}: {
  name: string
  role: string
  reason: AssigneeReason
  badges?: EmployeeAssigneeUser
  isSelf?: boolean
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(name)}`}>
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-text-primary truncate">
          {name}
          {isSelf && <span className="ml-1.5 text-meta font-normal text-text-secondary">(themselves)</span>}
        </p>
        <p className="text-meta text-text-muted truncate">{role}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {badges?.on_leave_today && (
          <span className="text-meta font-medium px-1.5 py-0.5 rounded-full bg-warning-bg text-warning">On leave</span>
        )}
        {badges?.is_frequent && (
          <span className="flex items-center gap-0.5 text-meta font-medium px-1.5 py-0.5 rounded-full bg-primary-subtle text-primary-text">
            <Zap size={9} /> Frequent
          </span>
        )}
        {badges && (
          <span className="flex items-center gap-0.5 text-meta font-medium text-text-muted bg-surface-control px-1.5 py-0.5 rounded-full">
            <Briefcase size={9} /> {badges.active_task_count}
          </span>
        )}
        <ReasonChip reason={reason} />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            className="w-6 h-6 flex items-center justify-center rounded-[6px] text-text-muted hover:text-danger hover:bg-surface-control transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
