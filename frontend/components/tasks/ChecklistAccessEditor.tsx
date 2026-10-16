'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { Plus, X, Search, CornerDownRight, ChevronRight } from 'lucide-react'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import Tooltip from '@/components/ui/tooltip'
import { descendantsOf } from '@/lib/dept-tree'
import type { Department, Role, EmployeeProfile } from '@/lib/types'
import type { ChecklistAccessMode, ChecklistAccessRuleInput } from '@/lib/types/tasks'

export interface LocalRule extends ChecklistAccessRuleInput {
  _key: string
}

let ruleKeySeq = 0
export function newRuleKey() {
  ruleKeySeq += 1
  return `r${ruleKeySeq}`
}

interface Props {
  mode: ChecklistAccessMode
  rules: LocalRule[]
  onModeChange: (m: ChecklistAccessMode) => void
  onRulesChange: (r: LocalRule[]) => void
  departments: Department[]
  roles: Role[]
  employees: EmployeeProfile[]
}

const pill = (active: boolean) =>
  [
    'px-3.5 py-1.5 text-sm font-semibold rounded-[8px] border transition-colors',
    active
      ? 'bg-primary text-white border-primary'
      : 'bg-white text-text-secondary border-border-light hover:bg-surface-control',
  ].join(' ')

/** Line-item count shown beside a section heading: solid blue pill, white text.
 *  Render nothing when the count is zero. */
function CountBadge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-semibold leading-none">
      {n}
    </span>
  )
}

/** Collapsible list of the sub-departments swept in by a cascading rule.
 *  Collapsed by default to save space; the count stays visible as a badge. */
function SubDepartmentList({ subs }: { subs: ReturnType<typeof descendantsOf> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[6px] bg-surface-control px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-text-muted"
      >
        <ChevronRight size={12} className={`text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span>Sub-departments</span>
        <CountBadge n={subs.length} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {subs.map(({ dept, depth }) => (
            <div key={dept.id} className="flex items-center gap-1.5 text-xs text-text-secondary" style={{ paddingLeft: depth * 14 }}>
              <CornerDownRight size={12} className="text-[#CBD5E1] shrink-0" />
              <span className="truncate">{dept.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Small searchable dropdown used to add a role or a person. */
function AddPicker({
  label,
  options,
  onPick,
}: {
  label: string
  options: { id: string; label: string; sublabel?: string }[]
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
  }, [options, query])

  return (
    <div ref={wrapRef} className="relative">
      <Tooltip label={label}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          className="w-7 h-7 rounded-[8px] bg-primary hover:bg-primary-hover text-white flex items-center justify-center transition-colors shrink-0"
        >
          <Plus size={16} />
        </button>
      </Tooltip>
      {open && (
        // Absolute panel anchored under the top-right trigger; right-aligned so it
        // stays within the card and overlays the body (card isn't overflow-hidden,
        // so it isn't clipped). See memory: no-overflow-parent.
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 bg-white border border-border-light rounded-[8px] shadow-[0_8px_28px_rgba(0,0,0,0.14)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden bg-transparent"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-3 text-sm text-text-muted text-center">Nothing to add.</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onPick(o.id)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-sunken transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary truncate">{o.label}</span>
                  {o.sublabel && <span className="block text-xs text-text-muted truncate">{o.sublabel}</span>}
                </span>
                <Plus size={14} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChecklistAccessEditor({
  mode,
  rules,
  onModeChange,
  onRulesChange,
  departments,
  roles,
  employees,
}: Props) {
  const deptRules = rules.filter((r) => r.kind === 'department')
  const roleRules = rules.filter((r) => r.kind === 'role')
  const userRules = rules.filter((r) => r.kind === 'user')
  // A blank department row (no department picked yet) blocks adding another, so clicking
  // "Add department" repeatedly can't pile up empty rows.
  const hasEmptyDept = deptRules.some((r) => !r.department_id)

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const empByUserId = useMemo(() => new Map(employees.map((e) => [e.user_id, e])), [employees])

  // Drop any department rule whose department is already swept in by ANOTHER
  // rule's cascade — so enabling "include sub-departments" on a parent quietly
  // removes a now-redundant child rule instead of leaving an overlapping mess.
  const normalize = (rs: LocalRule[]): LocalRule[] => {
    const covered = new Set<string>()
    for (const r of rs) {
      if (r.kind === 'department' && r.department_id && (r.include_sub_departments ?? true)) {
        for (const { dept } of descendantsOf(departments, r.department_id)) covered.add(dept.id)
      }
    }
    return rs.filter((r) => !(r.kind === 'department' && r.department_id && covered.has(r.department_id)))
  }
  const emit = (rs: LocalRule[]) => onRulesChange(normalize(rs))

  const update = (key: string, patch: Partial<LocalRule>) =>
    emit(rules.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => emit(rules.filter((r) => r._key !== key))
  const add = (rule: Omit<LocalRule, '_key'>) => emit([...rules, { ...rule, _key: newRuleKey() }])

  // Why a department is locked for a given rule's picker: it's already added
  // directly elsewhere, or swept in by another rule's cascade. Shown (not hidden)
  // so the user understands the coverage instead of wondering where it went.
  const lockReasonFor = (selfKey: string, deptId: string): string | null => {
    for (const r of deptRules) {
      if (r._key === selfKey || !r.department_id) continue
      if (r.department_id === deptId) return 'Already added'
    }
    for (const r of deptRules) {
      if (r._key === selfKey || !r.department_id || !(r.include_sub_departments ?? true)) continue
      if (descendantsOf(departments, r.department_id).some((s) => s.dept.id === deptId)) {
        const parent = deptById.get(r.department_id)
        return parent ? `Covered by ${parent.name}` : 'Already covered'
      }
    }
    return null
  }

  // ── Roles: auto-filled from the selected departments (every role has a dept),
  // plus any explicitly-added role; each removable as a dynamic exception. ──
  const excludeRoleRules = rules.filter((r) => r.kind === 'exclude_role')
  const excludedRoleIds = new Set(excludeRoleRules.map((r) => r.role_id))
  const explicitRoleIds = new Set(roleRules.map((r) => r.role_id))

  // Department ids in scope (selected depts + cascaded sub-departments).
  const deptScopeIds = new Set<string>()
  for (const r of deptRules) {
    if (!r.department_id) continue
    deptScopeIds.add(r.department_id)
    if (r.include_sub_departments ?? true) for (const { dept } of descendantsOf(departments, r.department_id)) deptScopeIds.add(dept.id)
  }

  // Roles granted right now: inside a selected department OR added directly, minus excluded.
  const inScopeRoles = roles
    .filter((role) => (deptScopeIds.has(role.department_id) || explicitRoleIds.has(role.id)) && !excludedRoleIds.has(role.id))
    .map((role) => ({ role, via: explicitRoleIds.has(role.id) ? 'added directly' : role.department?.name ?? deptById.get(role.department_id)?.name ?? 'department' }))
    .sort((a, b) => a.role.title.localeCompare(b.role.title))
  const inScopeRoleIds = new Set(inScopeRoles.map((x) => x.role.id))

  const excludedRolesList = excludeRoleRules
    .map((r) => ({ ruleKey: r._key, role: r.role_id ? roleById.get(r.role_id) : undefined }))
    .filter((x): x is { ruleKey: string; role: Role } => !!x.role)
    .sort((a, b) => a.role.title.localeCompare(b.role.title))

  const roleOptions = roles
    .filter((r) => !inScopeRoleIds.has(r.id))
    .map((r) => ({ id: r.id, label: r.title, sublabel: r.department?.name ?? deptById.get(r.department_id)?.name ?? '' }))

  // ── People: resolved live from the grants above, minus per-person and per-role exclusions ──
  const excludedRules = rules.filter((r) => r.kind === 'exclude_user')
  const excludedIds = new Set(excludedRules.map((r) => r.user_id))

  // user_id → the source labels that grant them ("Sales dept", "Account Exec role", "Added directly").
  const grantSources = new Map<string, Set<string>>()
  const addSource = (uid: string, label: string) => {
    const set = grantSources.get(uid) ?? new Set<string>()
    set.add(label)
    grantSources.set(uid, set)
  }
  for (const r of deptRules) {
    if (!r.department_id) continue
    const ids = new Set<string>([r.department_id])
    if (r.include_sub_departments ?? true) for (const { dept } of descendantsOf(departments, r.department_id)) ids.add(dept.id)
    const label = `${deptById.get(r.department_id)?.name ?? 'department'} dept`
    for (const e of employees) if (e.status === 'active' && ids.has(e.department_id)) addSource(e.user_id, label)
  }
  for (const r of roleRules) {
    if (!r.role_id) continue
    const label = `${roleById.get(r.role_id)?.title ?? 'role'} role`
    for (const e of employees) if (e.status === 'active' && e.role_id === r.role_id) addSource(e.user_id, label)
  }
  for (const r of userRules) if (r.user_id) addSource(r.user_id, 'Added directly')

  // A removed role (exclude_role) takes its current AND future members out — mirrors the backend.
  const roleExcluded = (uid: string) => {
    const e = empByUserId.get(uid)
    return !!e && excludedRoleIds.has(e.role_id)
  }
  const peopleFrom = (uids: string[]) =>
    uids
      .map((uid) => ({ uid, name: empByUserId.get(uid)?.user?.name ?? 'Unknown', sources: Array.from(grantSources.get(uid) ?? []) }))
      .sort((a, b) => a.name.localeCompare(b.name))

  const effectivePeople = peopleFrom(Array.from(grantSources.keys()).filter((uid) => !excludedIds.has(uid) && !roleExcluded(uid)))
  const effectiveSet = new Set(effectivePeople.map((p) => p.uid))
  const removedPeople = peopleFrom(excludedRules.map((r) => r.user_id).filter((u): u is string => !!u)).map((p) => ({
    ...p,
    ruleKey: excludedRules.find((r) => r.user_id === p.uid)!._key,
  }))

  // Picker offers active people who'd actually gain access if picked (not already in,
  // and their role isn't excluded). A previously-removed person is offered to restore.
  const personOptions = employees
    .filter((e) => e.status === 'active' && !effectiveSet.has(e.user_id) && !excludedRoleIds.has(e.role_id))
    .map((e) => ({ id: e.user_id, label: e.user?.name ?? 'Unknown', sublabel: [e.role?.title, e.department?.name].filter(Boolean).join(' · ') }))

  // ── Add / remove, with the requested "are you sure" on removals ──
  const addPerson = (uid: string) => {
    const ex = excludedRules.find((r) => r.user_id === uid)
    if (ex) { remove(ex._key); return } // un-exclude (restore) — still covered by a dept/role
    add({ kind: 'user', user_id: uid })
  }
  const removePerson = (uid: string) => {
    const name = empByUserId.get(uid)?.user?.name ?? 'this person'
    const byGroup = Array.from(grantSources.get(uid) ?? []).some((s) => s !== 'Added directly')
    if (!confirm(`Remove ${name} from this checklist? They'll lose access${byGroup ? ' and be listed under “Removed” so you can restore them later' : ''}.`)) return
    const next = rules.filter((r) => !(r.kind === 'user' && r.user_id === uid))
    emit(byGroup ? [...next, { _key: newRuleKey(), kind: 'exclude_user' as const, user_id: uid }] : next)
  }
  const addRole = (roleId: string) => {
    const ex = excludeRoleRules.find((r) => r.role_id === roleId)
    if (ex) { remove(ex._key); return } // restore a previously-removed role
    add({ kind: 'role', role_id: roleId })
  }
  const removeRoleChip = (roleId: string) => {
    const role = roleById.get(roleId)
    if (!confirm(`Remove the ${role?.title ?? 'role'} role? Everyone in it loses access to this checklist (current and future).`)) return
    // Drop any explicit grant; if the role rides in via a department, record a role exclusion.
    let next = rules.filter((r) => !(r.kind === 'role' && r.role_id === roleId))
    if (deptScopeIds.has(role?.department_id ?? '')) next = [...next, { _key: newRuleKey(), kind: 'exclude_role' as const, role_id: roleId }]
    emit(next)
  }
  const removeDept = (r: LocalRule) => {
    const name = r.department_id ? deptById.get(r.department_id)?.name : ''
    if (!confirm(`Remove ${name || 'this department'} from access? People covered only by it will lose access.`)) return
    remove(r._key)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1.5">Who can use this checklist</label>
      <div className="flex gap-2 mb-1">
        <button type="button" className={pill(mode === 'everyone')} onClick={() => onModeChange('everyone')}>
          Everyone
        </button>
        <button type="button" className={pill(mode === 'restricted')} onClick={() => onModeChange('restricted')}>
          Restricted
        </button>
      </div>

      {mode === 'everyone' ? (
        <p className="text-xs text-text-muted mt-1.5">Anyone creating a task can apply this checklist.</p>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-text-muted">
            A person can use this checklist if they match <span className="font-semibold">any</span> rule below — by
            department, role, or being named directly.
          </p>

          {/* Three cards in a row — equal width, equal height. Departments has no
              internal scroll so its inline picker dropdown escapes the card unclipped;
              Roles and People scroll inside their fixed height. */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {/* Departments — no overflow clip so the inline picker dropdown isn't cut off */}
          <div className="bg-white border border-border-light rounded-[12px] p-3.5 flex flex-col min-h-[360px]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Departments</span>
                <CountBadge n={deptRules.length} />
              </div>
              <Tooltip label={hasEmptyDept ? 'Select a department in the blank row first' : 'Add department'}>
              <button
                type="button"
                disabled={hasEmptyDept}
                onClick={() => add({ kind: 'department', department_id: '', include_sub_departments: true })}
                aria-label="Add department"
                className="w-7 h-7 rounded-[8px] bg-primary hover:bg-primary-hover text-white flex items-center justify-center transition-colors shrink-0 disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed"
              >
                <Plus size={16} />
              </button>
              </Tooltip>
            </div>
            <div className="mt-2 space-y-2 flex-1">
            {deptRules.length === 0 && <p className="text-xs text-text-muted">No departments added.</p>}
            {deptRules.map((r) => {
              const cascade = r.include_sub_departments ?? true
              const subs = r.department_id ? descendantsOf(departments, r.department_id) : []
              return (
                <div key={r._key} className="bg-surface-sunken border border-border-light rounded-[8px] p-2.5 space-y-2">
                  {/* Remove sits at the top-right of the row, above the picker */}
                  <div className="flex justify-end -mt-1 -mb-1">
                    <button
                      type="button"
                      onClick={() => removeDept(r)}
                      aria-label="Remove department"
                      className="p-1 -mr-1 text-text-muted hover:text-danger transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <DepartmentSelect
                    value={r.department_id ?? ''}
                    onChange={(id) => update(r._key, { department_id: id })}
                    departments={departments}
                    placeholder="Select department…"
                    inline
                    lockedReason={(id) => lockReasonFor(r._key, id)}
                  />
                  <button
                    type="button"
                    onClick={() => update(r._key, { include_sub_departments: !cascade })}
                    className="flex items-center gap-2 text-xs text-text-secondary"
                  >
                    <span
                      className={[
                        'relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0',
                        cascade ? 'bg-primary' : 'bg-surface-control-pressed',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200',
                          cascade ? 'translate-x-4' : 'translate-x-0',
                        ].join(' ')}
                      />
                    </span>
                    Include sub-departments
                  </button>
                  {/* When cascading, spell out exactly which sub-departments are swept in. */}
                  {r.department_id && cascade && (
                    subs.length === 0 ? (
                      <p className="text-[11px] text-text-muted pl-0.5">No sub-departments — this covers the department only.</p>
                    ) : (
                      <SubDepartmentList subs={subs} />
                    )
                  )}
                </div>
              )
            })}
            </div>
          </div>

          {/* Roles — auto-filled from the selected departments, plus any added directly */}
          <div className="bg-white border border-border-light rounded-[12px] p-3.5 flex flex-col h-[360px]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Roles</span>
                <CountBadge n={inScopeRoles.length} />
              </div>
              <AddPicker label="Add role" options={roleOptions} onPick={addRole} />
            </div>
            <div className="mt-2 space-y-2 flex-1 overflow-y-auto min-h-0 -mr-1 pr-1">
            <div className="flex flex-wrap gap-1.5">
              {inScopeRoles.length === 0 && <p className="text-xs text-text-muted">Pick a department to fill in its roles, or add one.</p>}
              {inScopeRoles.map(({ role, via }) => (
                <Tooltip key={role.id} label={`via ${via}`}>
                <span
                  className="inline-flex items-center gap-1.5 bg-white border border-border-light rounded-[999px] pl-2.5 pr-1.5 py-1 text-xs text-text-primary"
                >
                  {role.title}
                  <button type="button" onClick={() => removeRoleChip(role.id)} className="text-text-muted hover:text-danger">
                    <X size={12} />
                  </button>
                </span>
                </Tooltip>
              ))}
            </div>
            {excludedRolesList.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-warning">Removed roles:</span>
                {excludedRolesList.map(({ ruleKey, role }) => (
                  <span
                    key={ruleKey}
                    className="inline-flex items-center gap-1.5 bg-warning-bg border border-warning-border rounded-[999px] pl-2.5 pr-1.5 py-1 text-xs text-text-secondary"
                  >
                    <span className="line-through">{role.title}</span>
                    <button type="button" onClick={() => remove(ruleKey)} className="text-primary-text hover:text-primary-text font-semibold">
                      Restore
                    </button>
                  </span>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* People — resolved live from the departments/roles above, plus manual adds */}
          <div className="bg-white border border-border-light rounded-[12px] p-3.5 flex flex-col h-[360px]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">People with access</span>
                <CountBadge n={effectivePeople.length} />
              </div>
              <AddPicker label="Add person" options={personOptions} onPick={addPerson} />
            </div>
            <div className="mt-2 flex-1 overflow-y-auto min-h-0 -mr-1 pr-1">
            {effectivePeople.length === 0 ? (
              <p className="text-xs text-text-muted">No one yet — add a department, role, or person.</p>
            ) : (
              <div className="space-y-1">
                {effectivePeople.map((p) => (
                  <div key={p.uid} className="flex items-center gap-2 bg-surface-sunken border border-border-light rounded-[8px] px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{p.name}</p>
                      {p.sources.length > 0 && <p className="text-[11px] text-text-muted truncate">via {p.sources.join(', ')}</p>}
                    </div>
                    <button type="button" onClick={() => removePerson(p.uid)} aria-label={`Remove ${p.name}`} className="text-text-muted hover:text-danger shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
          </div>{/* /three-card grid */}

          {/* Removed (exceptions) — durable, findable log of who was taken out.
              Full-width strip below the columns so restores are easy to find. */}
          {removedPeople.length > 0 && (
            <div className="mt-5 space-y-2 rounded-[8px] border border-warning-border bg-warning-bg p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-warning">Removed</span>
                <span className="text-[11px] text-warning">{removedPeople.length}</span>
              </div>
              <p className="text-[11px] text-warning">These people match a department or role above but are excluded. Restore to give access back.</p>
              <div className="space-y-1 max-h-[180px] overflow-y-auto -mr-1 pr-1">
                {removedPeople.map((p) => (
                  <div key={p.ruleKey} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary line-through truncate">{p.name}</p>
                      {p.sources.length > 0 && <p className="text-[11px] text-warning truncate">would be via {p.sources.join(', ')}</p>}
                    </div>
                    <button type="button" onClick={() => remove(p.ruleKey)} className="text-xs font-semibold text-primary-text hover:text-primary-text shrink-0">
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
