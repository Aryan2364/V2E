'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeftRight,
  CornerDownRight,
  Lock,
  ShieldAlert,
  Info,
  X,
  Search,
} from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { useToast } from '@/components/ui/Toast'
import Tooltip from '@/components/ui/Tooltip'
import { computeNodeColors } from '@/lib/org-chart-colors'
import { flattenTree } from '@/lib/dept-tree'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import EmployeeAssigneeEditor from '@/components/tasks/EmployeeAssigneeEditor'
import type { Department } from '@/lib/types'
import type {
  AssigneeVisibilityAdminView,
  AssigneeVisibilitySettings,
  BridgeDepth,
} from '@/lib/types/tasks'

// Permissions collapsed to Administrators (is_admin) vs Members. 'org_admin'/'employee'
// are the value strings the backend still matches; legacy 'hr_manager' is inert.
const MEMBER_ROLES = ['org_admin', 'employee'] as const
const roleLabel = (r: string) =>
  ({ org_admin: 'Administrators', employee: 'Members', hr_manager: 'HR Manager (legacy)' }[r] ?? r)

// ─── Small shared controls ──────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-primary' : 'bg-surface-control-pressed'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

function Chip({ label, active, color = 'blue', onClick }: { label: string; active: boolean; color?: 'blue' | 'red'; onClick: () => void }) {
  const activeCls = color === 'red' ? 'bg-danger text-white border-danger' : 'bg-primary text-white border-primary'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border capitalize transition-colors ${active ? activeCls : 'bg-white text-text-secondary border-border hover:border-primary'}`}
    >
      {label}
    </button>
  )
}

function SegTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-[10px] bg-primary">
      {tabs.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            aria-pressed={active}
            className={[
              'px-4 py-1.5 text-sm font-semibold rounded-[7px] transition-colors',
              active
                ? 'bg-white text-primary-text shadow-xs'
                : 'bg-transparent text-white hover:bg-primary-hover',
            ].join(' ')}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5 space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Main tab ───────────────────────────────────────────────────────────────────

export function AssigneeVisibilityTab({ orgId }: { orgId: string }) {
  const { addToast } = useToast()
  const [view, setView] = useState<AssigneeVisibilityAdminView | null>(null)
  const [settings, setSettings] = useState<AssigneeVisibilitySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const [showRules, setShowRules] = useState(false)
  const [activeTab, setActiveTab] = useState<'department' | 'role' | 'employee'>('department')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSettings = useRef<AssigneeVisibilitySettings | null>(null)

  const reload = useCallback(async () => {
    const v = await tasksApi.getAssigneeVisibility(orgId)
    setView(v)
    setSettings(v.settings)
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    reload()
      .catch(() => addToast('Could not load visibility settings', 'error'))
      .finally(() => setLoading(false))
  }, [reload, addToast])

  const apiError = (e: any, fallback: string) => {
    const m = e?.response?.data?.message ?? fallback
    addToast(Array.isArray(m) ? m.join(', ') : m, 'error')
  }

  // ── Auto-save (no Save button). Settings persist as you edit. ──
  function persist(next: AssigneeVisibilitySettings) {
    latestSettings.current = next
    setSaveState('saving')
    tasksApi
      .updateAssigneeSettings(orgId, next)
      .then(() => setSaveState('saved'))
      .catch((e) => {
        setSaveState('saved')
        apiError(e, 'Could not save settings')
      })
  }
  // Discrete clicks (override toggle, role chips) → save immediately.
  function commitNow(next: AssigneeVisibilitySettings) {
    setSettings(next)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    persist(next)
  }
  // Rapid edits (people multiselect) → debounce so we don't spam the server.
  function commitDebounced(next: AssigneeVisibilitySettings) {
    setSettings(next)
    latestSettings.current = next
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      persist(latestSettings.current!)
    }, 500)
  }
  // Flush a pending debounced save when leaving the tab.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        if (latestSettings.current) tasksApi.updateAssigneeSettings(orgId, latestSettings.current).catch(() => {})
      }
    },
    [orgId],
  )

  if (loading || !view || !settings) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const depts = view.departments
  const deptName = (id: string) => depts.find((d) => d.id === id)?.name ?? id
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const overrideOn = settings.master_override

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Default-rules info */}
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-[18px] font-semibold text-text-primary">Assignee visibility</h2>
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            aria-label="How the default assignee list works"
            aria-expanded={showRules}
            className="w-7 h-7 flex items-center justify-center rounded-full text-primary-text hover:bg-primary-subtle transition-colors"
          >
            <Info size={16} />
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
            {saveState === 'saving' ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> All changes saved
              </>
            )}
          </span>
        </div>

        {showRules && (
          <div className="mt-2 rounded-[12px] border border-primary-border bg-primary-subtle p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-text-primary">How the default list is built</p>
              <button
                type="button"
                onClick={() => setShowRules(false)}
                aria-label="Close"
                className="w-6 h-6 flex items-center justify-center rounded-[6px] text-text-secondary hover:text-text-primary hover:bg-white/60 transition-colors shrink-0"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-text-secondary mt-1">
              When no override, bridge, or exception applies, each person&apos;s Assignees &amp; CC list is built from just
              these four things — this is the default for everyone:
            </p>
            <ol className="mt-2.5 space-y-2 text-text-primary">
              <li>
                <span className="font-semibold text-text-primary">1. Themselves.</span> A person can always assign to themselves.
              </li>
              <li>
                <span className="font-semibold text-text-primary">2. Everyone below them.</span> Anyone who reports to them —
                directly or further down the chain — in any department.
              </li>
              <li>
                <span className="font-semibold text-text-primary">3. Their own department.</span> Everyone in the department
                their profile belongs to. The <span className="font-medium">Upward</span> switch decides whether they also
                see people <em>above</em> them inside that same department.
              </li>
              <li>
                <span className="font-semibold text-text-primary">4. Their direct manager.</span> The person they report to is
                always included — even when that manager sits in a different (e.g. parent) department.
              </li>
            </ol>
            <p className="text-text-secondary mt-3">
              Everything else on this page — master override, full-visibility, bridges, and exceptions —
              only widens or narrows this default.
            </p>
          </div>
        )}
      </div>

      {/* Master override — org-level, always interactive, auto-saves on toggle */}
      <Card
        title="Master override — open everything"
        description="When on, every user can assign to every active employee. Department & role rules are ignored — except per-employee manual edits (Employee tab), which still apply on top."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlert size={16} className={overrideOn ? 'text-warning' : 'text-text-muted'} />
            <span className="text-text-primary">{overrideOn ? 'Override is ON — everyone sees everyone.' : 'Override is off.'}</span>
          </div>
          <Toggle on={overrideOn} onChange={() => commitNow({ ...settings, master_override: !overrideOn })} />
        </div>
        {overrideOn && (
          <div className="flex items-start gap-2 p-3 rounded-[8px] bg-warning-bg border border-warning-border text-[13px] text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>While the override is on, exceptions, bridges and the upward switch have no effect — but per-employee manual additions/removals (Employee tab) still apply.</span>
          </div>
        )}
      </Card>

      {/* Who can change these settings — org-level governance, auto-saves */}
      <Card title="Who can change these settings" description="Member roles allowed to edit assignee visibility (override, exceptions, bridges, upward switch, sub-department unify).">
        <div className="flex flex-wrap gap-2">
          {MEMBER_ROLES.map((r) => (
            <Chip
              key={r}
              label={roleLabel(r)}
              active={settings.config_roles.includes(r)}
              onClick={() => {
                const next = toggleIn(settings.config_roles, r)
                if (next.length === 0) return // at least one role must keep edit rights
                commitDebounced({ ...settings, config_roles: next })
              }}
            />
          ))}
        </div>
        <p className="text-xs text-text-muted">At least one role is required. Saved automatically.</p>
      </Card>

      {/* Three configuration tabs + body — disabled + dimmed (values preserved) while the master override is on */}
      <div className={overrideOn ? 'opacity-60 pointer-events-none space-y-5' : 'space-y-5'}>
        <SegTabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: 'department', label: 'Department configuration' },
            { value: 'role', label: 'Role configuration' },
            { value: 'employee', label: 'Employee configuration' },
          ]}
        />
        {activeTab === 'department' && (
          <>
            <UnifySection orgId={orgId} view={view} onChange={reload} apiError={apiError} />
            <UpwardSection orgId={orgId} view={view} onChange={reload} apiError={apiError} />
            <BridgeSection orgId={orgId} view={view} deptName={deptName} onChange={reload} apiError={apiError} />
          </>
        )}
        {activeTab === 'role' && (
          <>
            {/* Roles with full visibility */}
            <Card
              title="Roles with full visibility (see everyone)"
              description="Roles whose members can assign to every active employee, beyond their default department + reports. Separate from admin powers."
            >
              <div className="flex flex-wrap gap-2">
                {MEMBER_ROLES.map((r) => (
                  <Chip key={r} label={roleLabel(r)} active={settings.full_visibility_roles.includes(r)} onClick={() => commitNow({ ...settings, full_visibility_roles: toggleIn(settings.full_visibility_roles, r) })} />
                ))}
              </div>
            </Card>
          </>
        )}
        {activeTab === 'employee' && (
          /* Per-employee editor — the most-granular layer (resolved list + manual add/remove + full visibility) */
          <EmployeeAssigneeEditor orgId={orgId} view={view} />
        )}
      </div>
    </div>
  )
}

// ─── Section: upward switch ──────────────────────────────────────────────────────

function UpwardSection({ orgId, view, onChange, apiError }: { orgId: string; view: AssigneeVisibilityAdminView; onChange: () => Promise<void>; apiError: (e: any, f: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const depts = view.departments
  const byId = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts])
  // Match the org-chart hue scheme and tree ordering used by the Unify card, so the two
  // Department-rules cards read as parallel views of the same hierarchy.
  const colors = useMemo(() => computeNodeColors(depts as unknown as Department[]), [depts])
  const colorOf = (id: string) => colors[id]?.base || '#94A3B8'
  const rows = useMemo(() => flattenTree(depts as unknown as Department[]), [depts])

  // Nearest ancestor (excluding self) merged via "Merge a department with its sub-departments". When present,
  // this department is inside a unified pool where everyone already assigns to everyone — so
  // its upward switch has no effect and is shown locked (mirrors the Unify card's covered state).
  const coveringAncestor = (id: string) => {
    let cur = byId.get(id)?.parent_department_id ?? null
    const seen = new Set<string>()
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      const d = byId.get(cur)!
      if (d.assignee_unify_subtree) return d
      cur = d.parent_department_id ?? null
    }
    return null
  }

  async function toggle(deptId: string, allow: boolean) {
    setBusy(deptId)
    try {
      await tasksApi.setDepartmentUpward(orgId, { department_id: deptId, allow })
      await onChange()
    } catch (e) {
      apiError(e, 'Could not update department')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card title="Allow assigning up the reporting line" description="When off, members of that department can assign to their direct manager and below — but not higher up the chain. Departments inside a merged pool ignore this switch.">
      <div className="max-h-[280px] overflow-y-auto -mr-1 pr-1 divide-y divide-surface-control">
        {rows.map(({ dept, depth }) => {
          const d = byId.get(dept.id)!
          const covered = coveringAncestor(dept.id)
          return (
            <div key={dept.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: depth * 18 }}>
                {depth > 0 && <CornerDownRight size={13} className="shrink-0 text-[#CBD5E1] -mr-0.5" />}
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(dept.id) }} />
                <div className="min-w-0">
                  <p className={`text-sm truncate ${covered ? 'text-text-secondary' : 'font-medium text-text-primary'}`}>{dept.name}</p>
                  <p className="text-xs text-text-muted truncate">
                    {covered
                      ? `Merged into ${covered.name} — upward not applied`
                      : d.assignee_allow_upward
                        ? 'Can assign up the chain'
                        : 'Direct manager only (no higher)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {busy === dept.id && <Loader2 size={13} className="animate-spin text-text-muted" />}
                {covered ? (
                  <Tooltip label={`Locked — merged into ${covered.name}`}>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      <Lock size={12} />
                      <Toggle on disabled onChange={() => {}} />
                    </span>
                  </Tooltip>
                ) : (
                  <Toggle on={d.assignee_allow_upward} disabled={busy === dept.id} onChange={() => toggle(dept.id, !d.assignee_allow_upward)} />
                )}
              </div>
            </div>
          )
        })}
        {depts.length === 0 && <p className="text-xs text-text-muted py-2">No departments configured.</p>}
      </div>
    </Card>
  )
}

// ─── Section: unify sub-departments ──────────────────────────────────────────────

function UnifySection({ orgId, view, onChange, apiError }: { orgId: string; view: AssigneeVisibilityAdminView; onChange: () => Promise<void>; apiError: (e: any, f: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const depts = view.departments
  const byId = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts])
  // Reuse the org-chart hue scheme so swatches here match the chart (branch hue,
  // faded by depth, honouring explicit per-department color overrides).
  const colors = useMemo(() => computeNodeColors(depts as unknown as Department[]), [depts])
  const colorOf = (id: string) => colors[id]?.base || '#94A3B8'
  // Whole department forest in pre-order (root → branch → leaves), indented by depth —
  // so the list follows the hierarchy instead of being a flat alphabetical list.
  const rows = useMemo(() => flattenTree(depts as unknown as Department[]), [depts])

  const childIds = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of depts) {
      if (d.parent_department_id && byId.has(d.parent_department_id)) {
        const arr = m.get(d.parent_department_id) ?? []
        arr.push(d.id)
        m.set(d.parent_department_id, arr)
      }
    }
    return m
  }, [depts, byId])
  const hasChildren = (id: string) => (childIds.get(id)?.length ?? 0) > 0
  const descendantCount = (id: string) => {
    let n = 0
    const stack = [...(childIds.get(id) ?? [])]
    while (stack.length) {
      const c = stack.pop()!
      n++
      for (const cc of childIds.get(c) ?? []) stack.push(cc)
    }
    return n
  }

  const matchingRootIds = useMemo(() => {
    const matched = new Set<string>()
    if (!searchQuery.trim()) return matched
    const query = searchQuery.toLowerCase()

    const getRootId = (id: string): string => {
      let cur = id
      while (true) {
        const parentId = byId.get(cur)?.parent_department_id
        if (parentId && byId.has(parentId)) {
          cur = parentId
        } else {
          break
        }
      }
      return cur
    }

    for (const d of depts) {
      if (d.name.toLowerCase().includes(query)) {
        matched.add(getRootId(d.id))
      }
    }
    return matched
  }, [depts, byId, searchQuery])

  const isDeptVisible = useCallback((deptId: string, query: string): boolean => {
    if (!query) return true
    let cur = deptId
    while (true) {
      const parentId = byId.get(cur)?.parent_department_id
      if (parentId && byId.has(parentId)) {
        cur = parentId
      } else {
        break
      }
    }
    return matchingRootIds.has(cur)
  }, [byId, matchingRootIds])

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows
    const query = searchQuery.toLowerCase()
    return rows.filter((r) => isDeptVisible(r.dept.id, query))
  }, [rows, searchQuery, isDeptVisible])

  // Nearest ancestor (excluding self) that already has unify on — self is then covered by it
  // (and the highest such flag governs the pool, so toggling the child would be redundant).
  const coveringAncestor = (id: string) => {
    let cur = byId.get(id)?.parent_department_id ?? null
    const seen = new Set<string>()
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      const d = byId.get(cur)!
      if (d.assignee_unify_subtree) return d
      cur = d.parent_department_id ?? null
    }
    return null
  }

  const anyParent = childIds.size > 0

  async function toggle(deptId: string, unify: boolean) {
    setBusy(deptId)
    try {
      await tasksApi.setDepartmentUnify(orgId, { department_id: deptId, unify })
      await onChange()
    } catch (e) {
      apiError(e, 'Could not update department')
    } finally {
      setBusy(null)
    }
  }

  const plural = (n: number) => `${n} sub-department${n === 1 ? '' : 's'}`

  return (
    <Card title="Merge a department with its sub-departments" description="Turn a department on to merge it with everything beneath it into one pool — everyone in the sub-tree can assign to everyone else. Sub-departments are then covered automatically (shown locked under the one you switched on).">
      {depts.length === 0 ? (
        <p className="text-xs text-text-muted py-1">No departments configured.</p>
      ) : !anyParent ? (
        <p className="text-xs text-text-muted py-1">No departments have sub-departments to unify.</p>
      ) : (
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search departments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 border border-border rounded-[8px] text-sm text-text-primary placeholder:text-text-muted focus:border-2 focus:border-primary focus:outline-hidden bg-white"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              <Search size={14} />
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filteredRows.length === 0 ? (
            <p className="text-xs text-text-muted py-3 text-center">No matching departments found.</p>
          ) : (
            <div className="max-h-[320px] overflow-y-auto -mr-1 pr-1 divide-y divide-surface-control">
              {filteredRows.map(({ dept, depth }) => {
                const d = byId.get(dept.id)!
                const covered = coveringAncestor(dept.id)
                const parent = hasChildren(dept.id)
                const unified = d.assignee_unify_subtree && !covered
                return (
                  <div key={dept.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: depth * 18 }}>
                      {depth > 0 && <CornerDownRight size={13} className="shrink-0 text-[#CBD5E1] -mr-0.5" />}
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(dept.id) }} />
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${unified ? 'font-semibold text-text-primary' : covered ? 'text-text-secondary' : parent ? 'font-medium text-text-primary' : 'text-text-muted'}`}>
                          {dept.name}
                        </p>
                        <p className="text-xs text-text-muted">
                          {covered
                            ? `In ${covered.name}'s pool`
                            : unified
                              ? `Unified — ${plural(descendantCount(dept.id))} assign as one`
                              : parent
                                ? plural(descendantCount(dept.id))
                                : 'No sub-departments'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {busy === dept.id && <Loader2 size={13} className="animate-spin text-text-muted" />}
                      {covered ? (
                        <Tooltip label={`Locked — controlled by ${covered.name}`}>
                          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <Lock size={12} />
                            <Toggle on disabled onChange={() => {}} />
                          </span>
                        </Tooltip>
                      ) : parent ? (
                        <Toggle on={d.assignee_unify_subtree} disabled={busy === dept.id} onChange={() => toggle(dept.id, !d.assignee_unify_subtree)} />
                      ) : (
                        <span className="text-[11px] text-[#CBD5E1] pr-1">—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Section: bridges ────────────────────────────────────────────────────────────

function BridgeSection({ orgId, view, deptName, onChange, apiError }: { orgId: string; view: AssigneeVisibilityAdminView; deptName: (id: string) => string; onChange: () => Promise<void>; apiError: (e: any, f: string) => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [depth, setDepth] = useState<BridgeDepth>('whole_dept')
  const [includeSub, setIncludeSub] = useState(false)
  const [adding, setAdding] = useState(false)
  const [bothBusy, setBothBusy] = useState<string | null>(null)

  // Map the view's departments into the Department shape DepartmentSelect expects,
  // so the From/Into pickers match the Add Employee dropdown (branch colors,
  // indented cascade, search). Only id/name/parent/color are read downstream.
  const deptOptions = useMemo<Department[]>(
    () =>
      view.departments.map((d) => ({
        id: d.id,
        name: d.name,
        parent_department_id: d.parent_department_id ?? undefined,
        color: d.color,
        organization_id: orgId,
        position_x: 0,
        position_y: 0,
        created_at: '',
        updated_at: '',
      })),
    [view.departments, orgId],
  )
  const toOptions = useMemo(() => deptOptions.filter((d) => d.id !== from), [deptOptions, from])

  // Reverse direction of a bridge, if it already exists as its own entry.
  const reverseOf = (b: AssigneeVisibilityAdminView['bridges'][number]) =>
    view.bridges.find(
      (x) => x.from_department_id === b.to_department_id && x.to_department_id === b.from_department_id,
    )

  // "Both ways" toggle: create the reverse entry (B → A) with the same depth, or remove it.
  // Re-entry is skipped — if the reverse already exists we don't create a duplicate.
  async function setBidirectional(b: AssigneeVisibilityAdminView['bridges'][number], on: boolean) {
    setBothBusy(b.id)
    try {
      const reverse = reverseOf(b)
      if (on && !reverse) {
        await tasksApi.createAssigneeBridge(orgId, {
          from_department_id: b.to_department_id,
          to_department_id: b.from_department_id,
          depth: b.depth,
          include_sub_departments: b.include_sub_departments,
        })
      } else if (!on && reverse) {
        await tasksApi.deleteAssigneeBridge(orgId, reverse.id)
      }
      await onChange()
    } catch (e) {
      apiError(e, 'Could not update bridge direction')
    } finally {
      setBothBusy(null)
    }
  }

  async function add() {
    if (!from || !to) return
    setAdding(true)
    try {
      await tasksApi.createAssigneeBridge(orgId, { from_department_id: from, to_department_id: to, depth, include_sub_departments: includeSub })
      setFrom(''); setTo(''); setDepth('whole_dept'); setIncludeSub(false)
      await onChange()
    } catch (e) {
      apiError(e, 'Could not create bridge')
    } finally {
      setAdding(false)
    }
  }
  // Deletes the bridge and, if it's bidirectional, its reverse twin too — so removing the
  // single ⇄ row clears the whole pair rather than leaving the hidden reverse behind.
  async function remove(b: AssigneeVisibilityAdminView['bridges'][number]) {
    try {
      await tasksApi.deleteAssigneeBridge(orgId, b.id)
      const reverse = reverseOf(b)
      if (reverse) await tasksApi.deleteAssigneeBridge(orgId, reverse.id)
      await onChange()
    } catch (e) {
      apiError(e, 'Could not delete bridge')
    }
  }

  return (
    <Card title="Cross-department assignment" description="Let one department assign into another. One-directional by default — turn on “Both ways” on an entry to also open the reverse (B → A).">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end pt-1">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">From</label>
          <DepartmentSelect
            value={from}
            onChange={(id) => { setFrom(id); if (id === to) setTo('') }}
            departments={deptOptions}
            placeholder="Select…"
            inline
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Into</label>
          <DepartmentSelect value={to} onChange={setTo} departments={toOptions} placeholder="Select…" inline />
        </div>
        <button type="button" onClick={add} disabled={!from || !to || adding} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors h-[38px]">
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">Reach into target</label>
        <div className="flex gap-2">
          <Chip label="Whole department" active={depth === 'whole_dept'} onClick={() => setDepth('whole_dept')} />
          <Chip label="Head & senior roles" active={depth === 'head_senior'} onClick={() => setDepth('head_senior')} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 rounded-[8px] border border-border-light bg-surface-sunken">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Include sub-departments</p>
          <p className="text-xs text-text-secondary">Also reach every department beneath the target — adapts automatically as sub-departments change.</p>
        </div>
        <Toggle on={includeSub} onChange={() => setIncludeSub((v) => !v)} />
      </div>
      {view.bridges.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto -mr-1 pr-1 space-y-2 border-t border-border-light pt-4">
          {view.bridges.map((b) => {
            const bothWays = !!reverseOf(b)
            // Collapse a bidirectional pair into a single ⇄ row — render only the canonical side.
            if (bothWays && b.from_department_id > b.to_department_id) return null
            return (
            <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-[8px] border border-border-light bg-surface-sunken">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary flex-wrap">
                  <span>{b.from_department_name ?? deptName(b.from_department_id)}</span>
                  {bothWays ? <ArrowLeftRight size={14} className="text-primary-text" /> : <ArrowRight size={14} className="text-text-muted" />}
                  <span>{b.to_department_name ?? deptName(b.to_department_id)}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-text bg-primary-subtle border border-primary-border rounded-full px-2 py-0.5">
                    {b.depth === 'whole_dept' ? 'Whole dept' : 'Head & seniors'}
                  </span>
                  {b.include_sub_departments && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary bg-surface-control border border-border-light rounded-full px-2 py-0.5">
                      + sub-depts
                    </span>
                  )}
                </div>
                {b.match_count === 0 ? (
                  <p className="flex items-center gap-1 text-xs text-warning mt-1">
                    <AlertTriangle size={12} /> Matches 0 people — set a department head or a senior role.
                  </p>
                ) : (
                  <p className="text-xs text-text-secondary mt-1">Currently reaches {b.match_count} {b.match_count === 1 ? 'person' : 'people'}.</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Tooltip label={bothWays ? 'Both directions open — turn off to remove the reverse entry' : 'One-directional — turn on to also create the reverse entry (B → A)'}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-text-secondary hidden sm:inline">Both ways</span>
                  {bothBusy === b.id ? (
                    <Loader2 size={14} className="animate-spin text-text-muted" />
                  ) : (
                    <Toggle on={bothWays} disabled={bothBusy === b.id} onChange={() => setBidirectional(b, !bothWays)} />
                  )}
                </div>
                </Tooltip>
                <button type="button" onClick={() => remove(b)} className="p-1.5 rounded-[6px] text-text-muted hover:text-danger hover:bg-danger-bg transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
