'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck,
  Lock,
  Loader2,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  ArrowUp,
  Check,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import Button from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/Tooltip'
import { clearPermissionsCache } from '@/lib/auth/use-permissions'
import {
  getPermissionRegistry,
  getRolePermissions,
  updateRolePermissions,
  createSystemRole,
  updateSystemRole,
  deleteSystemRole,
  setModuleScope,
  getSubjectPolicies,
  updateSubjectPolicies,
  DATA_SCOPES,
  DATA_SCOPE_LABEL,
  DATA_SCOPE_HELP,
  SCOPE_RANK,
  type RegistryModule,
  type RegistrySubModule,
  type RoleMatrix,
  type SystemRole,
  type SubjectPolicy,
  type ResourcePerms,
  type PermAction,
  type DataScope,
} from '@/lib/api/permissions'

// The PDF columns map onto the registry actions: read→View, write→Create.
const ACTION_LABEL: Record<PermAction, string> = {
  read: 'View',
  write: 'Create',
  edit: 'Edit',
  delete: 'Delete',
}
const ALL_ACTIONS: PermAction[] = ['read', 'write', 'edit', 'delete']
// Data scope is only meaningful for the record-touching actions.
const SCOPE_ACTIONS: PermAction[] = ['read', 'edit', 'delete']

type Tab = 'roles' | 'subjects'

type Working = Record<string, Record<string, ResourcePerms>> // roleId → leaf → perms
type LineScopes = Record<string, Record<string, Partial<Record<PermAction, DataScope>>>> // overrides only
type ModuleScopes = Record<string, Record<string, DataScope>> // roleId → moduleKey → scope (override)
type DefaultScopes = Record<string, DataScope> // roleId → global scope

type SectionKey =
  | 'goals'
  | 'learning'
  | 'communication'
  | 'work'
  | 'ecs'
  | 'governance'
  | 'performance'
  | 'settings'

interface ActorSubModuleView {
  key: string
  label: string
  moduleKey: string
  features: RegistrySubModule['features']
  displayOnly?: boolean
}

interface ActorSectionView {
  key: SectionKey
  label: string
  subModules: ActorSubModuleView[]
}

interface SubjectPolicyView extends SubjectPolicy {
  moduleKey: string
}

interface SubjectSubModuleView {
  key: string
  label: string
  moduleKey: string
  policies: SubjectPolicyView[]
}

interface SubjectSectionView {
  key: SectionKey
  label: string
  subModules: SubjectSubModuleView[]
}

interface Derived {
  working: Working
  lineScopes: LineScopes
  moduleScopes: ModuleScopes
  defaultScopes: DefaultScopes
  split: Record<string, boolean> // `${roleId}:${leafKey}` → shown per-action
}

const SECTION_ORDER: { key: SectionKey; label: string }[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'learning', label: 'Learning' },
  { key: 'communication', label: 'Communication' },
  { key: 'work', label: 'Work' },
  { key: 'ecs', label: 'Leave & Policies' },
  { key: 'governance', label: 'Governance' },
  { key: 'performance', label: 'Performance' },
  { key: 'settings', label: 'Settings' },
]

const MODULE_TO_SECTION: Record<string, SectionKey> = {
  goals: 'goals',
  learning: 'learning',
  communication: 'communication',
  tasks: 'work',
  tickets: 'work',
  projects: 'work',
  workflows: 'work',
  ecs: 'ecs',
  governance: 'governance',
  performance: 'performance',
  holidays: 'settings',
  employees: 'settings',
  organization: 'settings',
  admin: 'settings',
}

function ScopeSelect({
  value,
  onChange,
  inheritLabel,
  disabled,
}: {
  value: DataScope | 'inherit'
  onChange: (v: DataScope | 'inherit') => void
  inheritLabel?: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as DataScope | 'inherit')}
      className={[
        'text-xs border rounded-[6px] px-2 py-1 bg-white focus:outline-none focus:border-[#2563EB]',
        'border-[#CBD5E1] text-[#0F172A] disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]',
        value === 'inherit' ? 'text-[#64748B]' : 'font-medium',
      ].join(' ')}
    >
      {inheritLabel !== undefined && <option value="inherit">{inheritLabel}</option>}
      {DATA_SCOPES.map((s) => (
        <option key={s} value={s}>
          {DATA_SCOPE_LABEL[s]}
        </option>
      ))}
    </select>
  )
}

const BroadenedBadge = () => (
  <Tooltip label="Broader than the default above it">
  <span
    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#D97706] bg-[#FEF3C7] border border-[#FDE68A] rounded-[999px] px-1.5 py-0.5"
  >
    <ArrowUp size={10} /> broadened
  </span>
  </Tooltip>
)

function deriveFromMatrix(m: RoleMatrix): Derived {
  const working: Working = {}
  const lineScopes: LineScopes = {}
  const moduleScopes: ModuleScopes = {}
  const defaultScopes: DefaultScopes = {}
  const split: Record<string, boolean> = {}

  for (const [roleId, leaves] of Object.entries(m.permissions)) {
    working[roleId] = {}
    for (const [leafKey, perms] of Object.entries(leaves)) working[roleId][leafKey] = { ...perms }
  }
  for (const role of m.systemRoles) {
    defaultScopes[role.id] = role.default_scope
    moduleScopes[role.id] = { ...role.module_scopes }
    lineScopes[role.id] = {}
    const roleScopes = m.scopes[role.id] ?? {}
    for (const [leafKey, perAction] of Object.entries(roleScopes)) {
      const copy: Partial<Record<PermAction, DataScope>> = {}
      for (const a of SCOPE_ACTIONS) if (perAction[a]) copy[a] = perAction[a]
      lineScopes[role.id][leafKey] = copy
      const defined = SCOPE_ACTIONS.map((a) => copy[a]).filter(Boolean) as DataScope[]
      if (new Set(defined).size > 1) split[`${role.id}:${leafKey}`] = true
    }
  }
  return { working, lineScopes, moduleScopes, defaultScopes, split }
}

export default function AccessControlPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()

  const [tab, setTab] = useState<Tab>('roles')
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  const [registry, setRegistry] = useState<RegistryModule[]>([])
  const [matrix, setMatrix] = useState<RoleMatrix | null>(null)
  const [d, setD] = useState<Derived>({
    working: {},
    lineScopes: {},
    moduleScopes: {},
    defaultScopes: {},
    split: {},
  })
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  // role create / rename state
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteRole, setConfirmDeleteRole] = useState(false)
  const [deletingRole, setDeletingRole] = useState(false)
  const [deleteRoleError, setDeleteRoleError] = useState<string | null>(null)

  const [policies, setPolicies] = useState<SubjectPolicy[]>([])
  const [policyEdits, setPolicyEdits] = useState<Record<string, boolean>>({})
  const [savingPolicies, setSavingPolicies] = useState(false)

  const applyMatrix = useCallback((mat: RoleMatrix) => {
    setMatrix(mat)
    setD(deriveFromMatrix(mat))
  }, [])

  const load = useCallback(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all([getPermissionRegistry(orgId), getRolePermissions(orgId), getSubjectPolicies(orgId)])
      .then(([reg, mat, pol]) => {
        setRegistry(reg.modules)
        applyMatrix(mat)
        setSelectedRoleId((prev) => prev || mat.systemRoles[0]?.id || '')
        setPolicies(pol.policies)
        setPolicyEdits(Object.fromEntries(pol.policies.map((p) => [p.subject_key, p.default_eligible])))
      })
      .catch((err) => {
        if (err?.response?.status === 403) setDenied(true)
        else addToast(err?.response?.data?.message ?? 'Failed to load access control', 'error')
      })
      .finally(() => setLoading(false))
  }, [orgId, addToast, applyMatrix])

  useEffect(() => {
    load()
  }, [load])

  // Modules with at least one configurable (actor + feature) leaf, + leaf→module map.
  const actorSections = useMemo<ActorSectionView[]>(() => {
    const sections = new Map<SectionKey, ActorSectionView>()
    for (const { key, label } of SECTION_ORDER) sections.set(key, { key, label, subModules: [] })

    for (const mod of registry) {
      const sectionKey = MODULE_TO_SECTION[mod.key]
      if (!sectionKey) continue
      const section = sections.get(sectionKey)
      if (!section) continue

      const actorSubModules = mod.subModules
        .map((sub) => ({
          key: sub.key,
          label: sub.label,
          moduleKey: mod.key,
          features: sub.features.filter((f) => f.axis === 'actor' && f.kind === 'feature'),
        }))
        .filter((sub) => sub.features.length > 0)

      section.subModules.push(...actorSubModules)

      if (mod.key === 'workflows') {
        section.subModules.push({
          key: 'workflows.display',
          label: mod.label,
          moduleKey: mod.key,
          features: [],
          displayOnly: true,
        })
      }
    }

    return SECTION_ORDER
      .map(({ key }) => sections.get(key)!)
      .filter((section) => section.subModules.length > 0)
  }, [registry])
  const leafModule = useMemo(() => {
    const map: Record<string, string> = {}
    for (const section of actorSections) {
      for (const sub of section.subModules) {
        for (const f of sub.features) map[f.key] = sub.moduleKey
      }
    }
    return map
  }, [actorSections])

  const subModulePairs = useCallback((sub: ActorSubModuleView) => {
    const pairs: { leafKey: string; action: PermAction }[] = []
    sub.features.forEach((f) => f.actions.forEach((a) => pairs.push({ leafKey: f.key, action: a })))
    return pairs
  }, [])
  const actorModules = actorSections
  const modulePairs = useCallback(
    (mod: ActorSectionView) => mod.subModules.flatMap((sub) => subModulePairs(sub)),
    [subModulePairs],
  )

  const subjectSections = useMemo<SubjectSectionView[]>(() => {
    const subjectMeta = new Map<string, { sectionKey: SectionKey; subModuleKey: string; subModuleLabel: string; moduleKey: string }>()
    for (const mod of registry) {
      const sectionKey = MODULE_TO_SECTION[mod.key]
      if (!sectionKey) continue
      for (const sub of mod.subModules) {
        for (const feature of sub.features) {
          if (feature.axis !== 'subject') continue
          subjectMeta.set(feature.key, {
            sectionKey,
            subModuleKey: sub.key,
            subModuleLabel: sub.label,
            moduleKey: mod.key,
          })
        }
      }
    }

    const sections = new Map<SectionKey, SubjectSectionView>()
    for (const { key, label } of SECTION_ORDER) sections.set(key, { key, label, subModules: [] })

    for (const policy of policies) {
      const meta = subjectMeta.get(policy.subject_key)
      if (!meta) continue
      const section = sections.get(meta.sectionKey)
      if (!section) continue
      let sub = section.subModules.find((item) => item.key === meta.subModuleKey)
      if (!sub) {
        sub = {
          key: meta.subModuleKey,
          label: meta.subModuleLabel,
          moduleKey: meta.moduleKey,
          policies: [],
        }
        section.subModules.push(sub)
      }
      sub.policies.push({ ...policy, moduleKey: meta.moduleKey })
    }

    return SECTION_ORDER
      .map(({ key }) => sections.get(key)!)
      .filter((section) => section.subModules.length > 0)
  }, [registry, policies])

  const scopableSet = useMemo(() => new Set(matrix?.scopableLeaves ?? []), [matrix])
  const isScopable = useCallback((leafKey: string) => scopableSet.has(leafKey), [scopableSet])

  const selectedRole: SystemRole | undefined = useMemo(
    () => matrix?.systemRoles.find((r) => r.id === selectedRoleId),
    [matrix, selectedRoleId],
  )
  const locked = !!selectedRole?.is_system

  // ─── Scope cascade resolution (working state) ────────────────────────────────
  const parentScope = useCallback(
    (roleId: string, leafKey: string): DataScope =>
      d.moduleScopes[roleId]?.[leafModule[leafKey]] ?? d.defaultScopes[roleId] ?? 'own',
    [d, leafModule],
  )
  const lineOverride = useCallback(
    (roleId: string, leafKey: string, action: PermAction): DataScope | undefined =>
      d.lineScopes[roleId]?.[leafKey]?.[action],
    [d],
  )
  // The representative single-mode value: View (read) override, else inherit.
  const lineSingleValue = useCallback(
    (roleId: string, leafKey: string): DataScope | 'inherit' =>
      lineOverride(roleId, leafKey, 'read') ?? 'inherit',
    [lineOverride],
  )

  // ─── Mutations ───────────────────────────────────────────────────────────────
  function toggle(leafKey: string, action: PermAction) {
    if (locked) return
    setD((prev) => {
      const role = { ...(prev.working[selectedRoleId] ?? {}) }
      const leaf = { ...(role[leafKey] ?? { read: false, write: false, edit: false, delete: false }) }
      leaf[action] = !leaf[action]
      role[leafKey] = leaf
      return { ...prev, working: { ...prev.working, [selectedRoleId]: role } }
    })
  }
  function setMany(pairs: { leafKey: string; action: PermAction }[], value: boolean) {
    if (locked) return
    setD((prev) => {
      const role = { ...(prev.working[selectedRoleId] ?? {}) }
      for (const { leafKey, action } of pairs) {
        const leaf = { ...(role[leafKey] ?? { read: false, write: false, edit: false, delete: false }) }
        leaf[action] = value
        role[leafKey] = leaf
      }
      return { ...prev, working: { ...prev.working, [selectedRoleId]: role } }
    })
  }
  function setDefaultScope(scope: DataScope) {
    setD((prev) => ({ ...prev, defaultScopes: { ...prev.defaultScopes, [selectedRoleId]: scope } }))
  }
  function setModScope(moduleKey: string, scope: DataScope | null) {
    setD((prev) => {
      const role = { ...(prev.moduleScopes[selectedRoleId] ?? {}) }
      if (scope === null) delete role[moduleKey]
      else role[moduleKey] = scope
      return { ...prev, moduleScopes: { ...prev.moduleScopes, [selectedRoleId]: role } }
    })
  }
  // Single-mode line scope: apply to all SCOPE_ACTIONS the leaf supports, or clear.
  function setLineSingle(leafKey: string, supported: PermAction[], scope: DataScope | 'inherit') {
    setD((prev) => {
      const role = { ...(prev.lineScopes[selectedRoleId] ?? {}) }
      const cur = { ...(role[leafKey] ?? {}) }
      for (const a of SCOPE_ACTIONS) {
        if (!supported.includes(a)) continue
        if (scope === 'inherit') delete cur[a]
        else cur[a] = scope
      }
      role[leafKey] = cur
      return { ...prev, lineScopes: { ...prev.lineScopes, [selectedRoleId]: role } }
    })
  }
  function setLineAction(leafKey: string, action: PermAction, scope: DataScope | 'inherit') {
    setD((prev) => {
      const role = { ...(prev.lineScopes[selectedRoleId] ?? {}) }
      const cur = { ...(role[leafKey] ?? {}) }
      if (scope === 'inherit') delete cur[action]
      else cur[action] = scope
      role[leafKey] = cur
      return { ...prev, lineScopes: { ...prev.lineScopes, [selectedRoleId]: role } }
    })
  }
  function toggleSplit(leafKey: string, supported: PermAction[]) {
    const key = `${selectedRoleId}:${leafKey}`
    setD((prev) => {
      const split = { ...prev.split }
      if (split[key]) {
        // Collapsing: align edit/delete to the View value so single mode is consistent.
        delete split[key]
        const role = { ...(prev.lineScopes[selectedRoleId] ?? {}) }
        const cur = { ...(role[leafKey] ?? {}) }
        const view = cur.read
        for (const a of SCOPE_ACTIONS) {
          if (!supported.includes(a)) continue
          if (view === undefined) delete cur[a]
          else cur[a] = view
        }
        role[leafKey] = cur
        return { ...prev, split, lineScopes: { ...prev.lineScopes, [selectedRoleId]: role } }
      }
      split[key] = true
      return { ...prev, split }
    })
  }

  // ─── Dirty / change detection (selected role only) ───────────────────────────
  type Entry = { system_role_id: string; feature_key: string; action: PermAction; allowed: boolean; scope?: DataScope | null }
  const changedEntries = useMemo(() => {
    if (!matrix || !selectedRole || locked) return [] as Entry[]
    const rid = selectedRole.id
    const w = d.working[rid] ?? {}
    const o = matrix.permissions[rid] ?? {}
    const origScopes = matrix.scopes[rid] ?? {}
    const out: Entry[] = []
    for (const leafKey of Object.keys(w)) {
      const scopable = scopableSet.has(leafKey)
      for (const a of ALL_ACTIONS) {
        const allowedChanged = (w[leafKey]?.[a] ?? false) !== (o[leafKey]?.[a] ?? false)
        const carryScope = scopable && SCOPE_ACTIONS.includes(a)
        const newScope = carryScope ? d.lineScopes[rid]?.[leafKey]?.[a] ?? null : null
        const oldScope = carryScope ? origScopes[leafKey]?.[a] ?? null : null
        const scopeChanged = carryScope && newScope !== oldScope
        if (allowedChanged || scopeChanged) {
          out.push({
            system_role_id: rid,
            feature_key: leafKey,
            action: a,
            allowed: w[leafKey]?.[a] ?? false,
            ...(carryScope ? { scope: newScope } : {}),
          })
        }
      }
    }
    return out
  }, [matrix, selectedRole, locked, d, scopableSet])

  const moduleScopeChanges = useMemo(() => {
    if (!matrix || !selectedRole || locked) return [] as { module_key: string; scope: DataScope | null }[]
    const rid = selectedRole.id
    const orig = matrix.systemRoles.find((r) => r.id === rid)?.module_scopes ?? {}
    const cur = d.moduleScopes[rid] ?? {}
    const keys = Array.from(new Set([...Object.keys(orig), ...Object.keys(cur)]))
    const out: { module_key: string; scope: DataScope | null }[] = []
    keys.forEach((k) => {
      const a = cur[k] ?? null
      const b = orig[k] ?? null
      if (a !== b) out.push({ module_key: k, scope: a })
    })
    return out
  }, [matrix, selectedRole, locked, d])

  const defaultScopeChanged = useMemo(() => {
    if (!matrix || !selectedRole || locked) return false
    return d.defaultScopes[selectedRole.id] !== selectedRole.default_scope
  }, [matrix, selectedRole, locked, d])

  const dirty = changedEntries.length > 0 || moduleScopeChanges.length > 0 || defaultScopeChanged

  async function handleSave() {
    if (!selectedRole) return
    const rid = selectedRole.id
    setSaving(true)
    try {
      let latest: RoleMatrix | null = null
      if (defaultScopeChanged) latest = await updateSystemRole(orgId, rid, { default_scope: d.defaultScopes[rid] })
      for (const ch of moduleScopeChanges) latest = await setModuleScope(orgId, rid, ch.module_key, ch.scope)
      if (changedEntries.length) latest = await updateRolePermissions(orgId, changedEntries)
      if (!latest) latest = await getRolePermissions(orgId)
      applyMatrix(latest)
      clearPermissionsCache(orgId)
      addToast('Access saved', 'success')
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Role create / rename / delete ───────────────────────────────────────────
  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    try {
      const updated = await createSystemRole(orgId, { name, default_scope: 'own' })
      applyMatrix(updated)
      const created = updated.systemRoles.find((r) => r.name.toLowerCase() === name.toLowerCase())
      if (created) setSelectedRoleId(created.id)
      setCreating(false)
      setNewName('')
      addToast('Role created', 'success')
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to create role', 'error')
    }
  }
  async function handleRename() {
    if (!selectedRole) return
    const name = renameValue.trim()
    if (!name || name === selectedRole.name) {
      setRenaming(false)
      return
    }
    try {
      applyMatrix(await updateSystemRole(orgId, selectedRole.id, { name }))
      setRenaming(false)
      addToast('Role renamed', 'success')
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to rename', 'error')
    }
  }
  async function performDeleteRole() {
    if (!selectedRole || selectedRole.is_system) return
    setDeletingRole(true)
    setDeleteRoleError(null)
    try {
      const updated = await deleteSystemRole(orgId, selectedRole.id)
      applyMatrix(updated)
      setSelectedRoleId(updated.systemRoles[0]?.id ?? '')
      clearPermissionsCache(orgId)
      setConfirmDeleteRole(false)
      addToast('Role deleted', 'success')
    } catch (err: any) {
      // The server blocks deletion while employees still hold the role — show
      // the plain-language reason here rather than as a toast that vanishes.
      setDeleteRoleError(err?.response?.data?.message ?? 'Failed to delete role.')
    } finally {
      setDeletingRole(false)
    }
  }

  // enabled-count per role (left list)
  const enabledCount = useCallback(
    (roleId: string) => {
      let n = 0
      for (const section of actorSections) {
        for (const sub of section.subModules) {
          for (const { leafKey, action } of subModulePairs(sub)) {
            if (d.working[roleId]?.[leafKey]?.[action]) n++
          }
        }
      }
      return n
    },
    [actorSections, subModulePairs, d],
  )

  // ─── Subject policies ────────────────────────────────────────────────────────
  const policiesDirty = useMemo(
    () => policies.some((p) => policyEdits[p.subject_key] !== p.default_eligible),
    [policies, policyEdits],
  )
  async function handleSavePolicies() {
    setSavingPolicies(true)
    try {
      const entries = policies.map((p) => ({ subject_key: p.subject_key, default_eligible: policyEdits[p.subject_key] }))
      const updated = await updateSubjectPolicies(orgId, entries)
      setPolicies(updated.policies)
      setPolicyEdits(Object.fromEntries(updated.policies.map((p) => [p.subject_key, p.default_eligible])))
      addToast('Subject eligibility saved', 'success')
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to save', 'error')
    } finally {
      setSavingPolicies(false)
    }
  }

  // ─── Reusable scope <select> ─────────────────────────────────────────────────
  function ScopeSelect({
    value,
    onChange,
    inheritLabel,
    disabled,
  }: {
    value: DataScope | 'inherit'
    onChange: (v: DataScope | 'inherit') => void
    inheritLabel?: string
    disabled?: boolean
  }) {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as DataScope | 'inherit')}
        className={[
          'text-xs border rounded-[6px] px-2 py-1 bg-white focus:outline-none focus:border-[#2563EB]',
          'border-[#CBD5E1] text-[#0F172A] disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]',
          value === 'inherit' ? 'text-[#64748B]' : 'font-medium',
        ].join(' ')}
      >
        {inheritLabel !== undefined && <option value="inherit">{inheritLabel}</option>}
        {DATA_SCOPES.map((s) => (
          <option key={s} value={s}>
            {DATA_SCOPE_LABEL[s]}
          </option>
        ))}
      </select>
    )
  }

  const BroadenedBadge = () => (
    <Tooltip label="Broader than the default above it">
    <span
      className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#D97706] bg-[#FEF3C7] border border-[#FDE68A] rounded-[999px] px-1.5 py-0.5"
    >
      <ArrowUp size={10} /> broadened
    </span>
    </Tooltip>
  )

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="p-10 text-center text-sm text-[#475569]">Loading…</div>
  if (denied)
    return (
      <div className="flex flex-col items-center text-center gap-3 py-16">
        <div className="w-14 h-14 rounded-[16px] bg-[#FEE2E2] flex items-center justify-center text-[#DC2626]">
          <Lock size={24} />
        </div>
        <h2 className="text-[18px] font-semibold text-[#0F172A]">No access</h2>
        <p className="text-sm text-[#475569] max-w-sm">
          You don&apos;t have permission to manage access control. Ask an administrator for access.
        </p>
      </div>
    )

  const roles = matrix?.systemRoles ?? []

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-bold text-[#0F172A] leading-tight">
            <ShieldCheck size={24} className="text-[#2563EB]" /> Access Control
          </h1>
          <p className="text-sm text-[#475569] mt-1 max-w-2xl">
            Define System Roles and what each can do. Assign a System Role to an employee when adding
            them. Per-person exceptions are set on the employee&apos;s record.
          </p>
        </div>
        {tab === 'roles' && !locked && selectedRole && (
          <Button variant="primary" onClick={handleSave} isLoading={saving} disabled={!dirty || saving}>
            {saving && <Loader2 size={15} className="animate-spin" />}
            Save changes
          </Button>
        )}
        {tab === 'subjects' && (
          <Button variant="primary" onClick={handleSavePolicies} isLoading={savingPolicies} disabled={!policiesDirty || savingPolicies}>
            {savingPolicies && <Loader2 size={15} className="animate-spin" />}
            Save changes
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-[8px] border border-[#E2E8F0] overflow-hidden mb-5">
        {(['roles', 'subjects'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors',
              tab === t ? 'bg-[#2563EB] text-white' : 'bg-white text-[#475569] hover:bg-[#F8FAFC]',
            ].join(' ')}
          >
            {t === 'roles' ? 'Roles & Permissions' : 'Subject eligibility'}
          </button>
        ))}
      </div>

      {tab === 'roles' && (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Left: roles list */}
          <div className="lg:w-[240px] shrink-0">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">Roles</span>
              <button
                onClick={() => {
                  setCreating(true)
                  setNewName('')
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                <Plus size={13} /> New
              </button>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] overflow-hidden">
              {creating && (
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-[#F1F5F9] bg-[#F8FAFC]">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate()
                      if (e.key === 'Escape') setCreating(false)
                    }}
                    placeholder="Role name"
                    className="flex-1 min-w-0 px-2 py-1 border border-[#CBD5E1] rounded-[6px] text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB]"
                  />
                  <button onClick={handleCreate} className="p-1 text-[#16A34A] hover:bg-[#DCFCE7] rounded" aria-label="Create role">
                    <Check size={15} />
                  </button>
                  <button onClick={() => setCreating(false)} className="p-1 text-[#94A3B8] hover:bg-[#F1F5F9] rounded" aria-label="Cancel">
                    <X size={15} />
                  </button>
                </div>
              )}
              {roles.map((r) => {
                const active = r.id === selectedRoleId
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoleId(r.id)}
                    className={[
                      'w-full text-left px-4 py-2.5 border-l-[3px] transition-colors',
                      active ? 'bg-[#EFF6FF] border-[#2563EB]' : 'bg-white border-transparent hover:bg-[#F8FAFC]',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={['text-sm font-medium truncate', active ? 'text-[#1D4ED8]' : 'text-[#0F172A]'].join(' ')}>
                        {r.name}
                      </span>
                      {r.is_system ? (
                        <span className="shrink-0 text-[10px] font-semibold text-[#0369A1] bg-[#E0F2FE] border border-[#BAE6FD] rounded-[999px] px-2 py-0.5">
                          System
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] font-semibold text-[#64748B] bg-[#F1F5F9] rounded-[999px] px-2 py-0.5">
                          {enabledCount(r.id)}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
              {roles.length === 0 && !creating && (
                <p className="px-4 py-6 text-sm text-[#94A3B8] text-center">No roles yet. Create one with “New”.</p>
              )}
            </div>
          </div>

          {/* Right: matrix */}
          <div className="flex-1 min-w-0">
            {!selectedRole ? (
              <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-8 text-center text-sm text-[#94A3B8]">
                Select a role to configure its access.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Role header */}
                <div className="flex items-center justify-between gap-3 bg-white border border-[#E2E8F0] rounded-[12px] px-4 py-3">
                  <div className="min-w-0">
                    {renaming ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename()
                            if (e.key === 'Escape') setRenaming(false)
                          }}
                          className="px-2 py-1 border border-[#CBD5E1] rounded-[6px] text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB]"
                        />
                        <button onClick={handleRename} className="p-1 text-[#16A34A] hover:bg-[#DCFCE7] rounded" aria-label="Save name">
                          <Check size={15} />
                        </button>
                        <button onClick={() => setRenaming(false)} className="p-1 text-[#94A3B8] hover:bg-[#F1F5F9] rounded" aria-label="Cancel">
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h2 className="text-[18px] font-semibold text-[#0F172A] truncate">{selectedRole.name}</h2>
                        {locked && (
                          <span className="text-[10px] font-semibold text-[#0369A1] bg-[#E0F2FE] border border-[#BAE6FD] rounded-[999px] px-2 py-0.5">
                            System
                          </span>
                        )}
                      </div>
                    )}
                    {selectedRole.description && !renaming && (
                      <p className="text-xs text-[#64748B] mt-0.5">{selectedRole.description}</p>
                    )}
                  </div>
                  {!locked && !renaming && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setRenameValue(selectedRole.name)
                          setRenaming(true)
                        }}
                        className="p-1.5 text-[#475569] hover:bg-[#F1F5F9] rounded-[6px]"
                        aria-label="Rename role"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => { setDeleteRoleError(null); setConfirmDeleteRole(true) }}
                        className="p-1.5 text-[#DC2626] hover:bg-[#FEE2E2] rounded-[6px]"
                        aria-label="Delete role"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {locked && (
                  <div className="flex items-center gap-2 bg-[#EFF6FF] border border-[#BAE6FD] rounded-[10px] px-4 py-2.5 text-sm text-[#0369A1]">
                    <Lock size={15} /> Administrator has full access to enabled modules. Permissions cannot be restricted.
                  </div>
                )}

                {/* Global scope */}
                {!locked && (
                  <div className="flex flex-wrap items-center gap-3 bg-white border border-[#E2E8F0] rounded-[12px] px-4 py-3">
                    <span className="text-sm font-medium text-[#374151]">Default data scope</span>
                    <ScopeSelect value={d.defaultScopes[selectedRole.id] ?? 'own'} onChange={(v) => v !== 'inherit' && setDefaultScope(v)} />
                    <span className="text-xs text-[#64748B]">
                      {DATA_SCOPE_HELP[d.defaultScopes[selectedRole.id] ?? 'own']} — applies to every module unless overridden below.
                    </span>
                  </div>
                )}

                {/* Matrix */}
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                      {/* column header */}
                      <div className="flex items-center border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
                        <span className="flex-1 text-xs font-semibold text-[#475569] uppercase tracking-wider">Section</span>
                        <span className="w-12 text-center text-xs font-semibold text-[#475569] uppercase tracking-wider">All</span>
                        {ALL_ACTIONS.map((a) => (
                          <span key={a} className="w-14 text-center text-xs font-semibold text-[#475569] uppercase tracking-wider">
                            {ACTION_LABEL[a]}
                          </span>
                        ))}
                        <span className="w-48 text-xs font-semibold text-[#475569] uppercase tracking-wider pl-2">Data Scope</span>
                      </div>

                      {actorModules.map((mod) => {
                        const pairs = modulePairs(mod)
                        const onCount = pairs.filter((p) => d.working[selectedRole.id]?.[p.leafKey]?.[p.action]).length
                        const allOn = onCount === pairs.length && pairs.length > 0
                        const isCollapsed = collapsed[mod.key]
                        const modScope = d.moduleScopes[selectedRole.id]?.[mod.key]
                        const modHasScopable = mod.subModules.some((s) => s.features.some((f) => isScopable(f.key)))
                        const modBroadened = modScope !== undefined && SCOPE_RANK[modScope] > SCOPE_RANK[d.defaultScopes[selectedRole.id] ?? 'own']
                        return (
                          <div key={mod.key} className="border-b border-[#F1F5F9] last:border-0">
                            {/* module header */}
                            <div className="flex items-center px-4 py-2.5 bg-[#F1F5F9]/60">
                              <button
                                onClick={() => setCollapsed((c) => ({ ...c, [mod.key]: !c[mod.key] }))}
                                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                              >
                                <ChevronRight size={15} className={['text-[#64748B] transition-transform', isCollapsed ? '' : 'rotate-90'].join(' ')} />
                                <span className="text-sm font-bold text-[#0F172A] uppercase tracking-wide truncate">{mod.label}</span>
                                <span className="text-[11px] text-[#94A3B8]">{onCount}/{pairs.length}</span>
                              </button>
                              <div className="w-12 flex justify-center">
                                {!locked && (
                                  <input
                                    type="checkbox"
                                    aria-label={`All ${mod.label}`}
                                    checked={allOn}
                                    onChange={() => setMany(pairs, !allOn)}
                                    className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                                  />
                                )}
                              </div>
                              <span className="w-[224px]" />
                              <div className="w-48 flex items-center gap-1.5 pl-2">
                                {modHasScopable && !locked && (
                                  <>
                                    <ScopeSelect
                                      value={modScope ?? 'inherit'}
                                      inheritLabel="Inherit"
                                      onChange={(v) => setModScope(mod.key, v === 'inherit' ? null : v)}
                                    />
                                    {modScope === undefined ? (
                                      <span className="text-[11px] text-[#94A3B8]">→ {DATA_SCOPE_LABEL[d.defaultScopes[selectedRole.id] ?? 'own']}</span>
                                    ) : (
                                      modBroadened && <BroadenedBadge />
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {!isCollapsed &&
                              mod.subModules.map((sub) => (
                                <div key={sub.key}>
                                  <div className="px-4 pt-2 pb-1 pl-9 flex items-center gap-2">
                                    <p className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">{sub.label}</p>
                                    {sub.displayOnly && (
                                      <span className="text-[10px] font-semibold text-[#64748B] bg-[#F1F5F9] rounded-[999px] px-2 py-0.5">
                                        Entitlement only
                                      </span>
                                    )}
                                  </div>
                                  {sub.displayOnly && (
                                    <p className="px-4 pb-2 pl-9 text-xs text-[#64748B]">
                                      Workflow access is controlled by module entitlement and workflow ownership rules.
                                    </p>
                                  )}
                                  {sub.features.map((f) => {
                                    const scopable = isScopable(f.key)
                                    const supportedScopeActions = SCOPE_ACTIONS.filter((a) => f.actions.includes(a))
                                    const leafAllOn = f.actions.every((a) => d.working[selectedRole.id]?.[f.key]?.[a])
                                    const split = !!d.split[`${selectedRole.id}:${f.key}`]
                                    const parent = parentScope(selectedRole.id, f.key)
                                    const single = lineSingleValue(selectedRole.id, f.key)
                                    const singleBroadened = single !== 'inherit' && SCOPE_RANK[single] > SCOPE_RANK[parent]
                                    return (
                                      <div key={f.key} className="flex items-center px-4 py-2.5 pl-9 border-t border-[#F8FAFC] hover:bg-[#FCFDFE]">
                                        <div className="flex-1 min-w-0 pr-3">
                                          <p className="text-sm font-medium text-[#0F172A]">{f.label}</p>
                                          {f.description && <p className="text-xs text-[#64748B] mt-0.5">{f.description}</p>}
                                        </div>
                                        {/* All */}
                                        <div className="w-12 flex justify-center">
                                          {!locked ? (
                                            <input
                                              type="checkbox"
                                              aria-label={`All ${f.label}`}
                                              checked={leafAllOn}
                                              onChange={() => setMany(f.actions.map((a) => ({ leafKey: f.key, action: a })), !leafAllOn)}
                                              className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                                            />
                                          ) : (
                                            <Check size={15} className="text-[#2563EB]" />
                                          )}
                                        </div>
                                        {/* action checkboxes */}
                                        {ALL_ACTIONS.map((a) => {
                                          const supported = f.actions.includes(a)
                                          if (!supported) return <span key={a} className="w-14 text-center text-[#CBD5E1]">—</span>
                                          if (locked)
                                            return (
                                              <span key={a} className="w-14 flex justify-center">
                                                <Check size={15} className="text-[#2563EB]" />
                                              </span>
                                            )
                                          return (
                                            <div key={a} className="w-14 flex items-center justify-center">
                                              <input
                                                type="checkbox"
                                                aria-label={`${f.label} ${ACTION_LABEL[a]}`}
                                                checked={d.working[selectedRole.id]?.[f.key]?.[a] ?? false}
                                                onChange={() => toggle(f.key, a)}
                                                className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                                              />
                                            </div>
                                          )
                                        })}
                                        {/* data scope */}
                                        <div className="w-48 pl-2">
                                          {!scopable ? (
                                            <span className="text-[#CBD5E1] text-sm">—</span>
                                          ) : locked ? (
                                            <span className="text-[#94A3B8] text-xs">Company</span>
                                          ) : !split ? (
                                            <div className="flex flex-col gap-1">
                                              <div className="flex items-center gap-1.5">
                                                <ScopeSelect
                                                  value={single}
                                                  inheritLabel="Inherit"
                                                  onChange={(v) => setLineSingle(f.key, supportedScopeActions, v)}
                                                />
                                                {single === 'inherit' ? (
                                                  <span className="text-[11px] text-[#94A3B8]">→ {DATA_SCOPE_LABEL[parent]}</span>
                                                ) : (
                                                  singleBroadened && <BroadenedBadge />
                                                )}
                                              </div>
                                              <button
                                                onClick={() => toggleSplit(f.key, supportedScopeActions)}
                                                className="text-[11px] text-[#2563EB] hover:text-[#1D4ED8] text-left"
                                              >
                                                Split by action
                                              </button>
                                            </div>
                                          ) : (
                                            <div className="flex flex-col gap-1">
                                              {supportedScopeActions.map((a) => {
                                                const ov = lineOverride(selectedRole.id, f.key, a)
                                                const val: DataScope | 'inherit' = ov ?? 'inherit'
                                                const broad = ov !== undefined && SCOPE_RANK[ov] > SCOPE_RANK[parent]
                                                return (
                                                  <div key={a} className="flex items-center gap-1.5">
                                                    <span className="w-10 text-[11px] text-[#64748B]">{ACTION_LABEL[a]}</span>
                                                    <ScopeSelect value={val} inheritLabel="Inherit" onChange={(v) => setLineAction(f.key, a, v)} />
                                                    {val === 'inherit' ? (
                                                      <span className="text-[10px] text-[#94A3B8]">→ {DATA_SCOPE_LABEL[parent]}</span>
                                                    ) : (
                                                      broad && <BroadenedBadge />
                                                    )}
                                                  </div>
                                                )
                                              })}
                                              <button
                                                onClick={() => toggleSplit(f.key, supportedScopeActions)}
                                                className="inline-flex items-center gap-1 text-[11px] text-[#475569] hover:text-[#0F172A] text-left"
                                              >
                                                <RotateCcw size={11} /> Combine
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ))}
                          </div>
                        )
                      })}
                      {actorModules.length === 0 && <p className="px-4 py-8 text-sm text-[#94A3B8] text-center">No configurable features.</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'subjects' && (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] overflow-hidden max-w-2xl">
          <div className="px-5 py-4 border-b border-[#F1F5F9]">
            <p className="text-sm text-[#475569]">
              Who can be acted upon by others (e.g. assigned a task), independent of whether they can open the
              module themselves. Per-person exceptions are set on the employee&apos;s record.
            </p>
          </div>
          {subjectSections.map((section) => (
            <div key={section.key} className="border-b border-[#F1F5F9] last:border-0">
              <div className="px-5 py-3 bg-[#F8FAFC]">
                <p className="text-sm font-bold text-[#0F172A] uppercase tracking-wide">{section.label}</p>
              </div>
              {section.subModules.map((sub) => (
                <div key={sub.key} className="border-t border-[#F8FAFC]">
                  <div className="px-5 pt-3 pb-1">
                    <p className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">{sub.label}</p>
                  </div>
                  {sub.policies.map((p) => {
                    const on = policyEdits[p.subject_key]
                    return (
                      <div key={p.subject_key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0F172A]">{p.label}</p>
                          <p className="text-xs text-[#64748B] mt-0.5">{on ? 'Everyone eligible unless revoked' : 'No one eligible unless granted'}</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={on}
                          onClick={() => setPolicyEdits((e) => ({ ...e, [p.subject_key]: !e[p.subject_key] }))}
                          className={['relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'].join(' ')}
                        >
                          <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform', on ? 'translate-x-5' : ''].join(' ')} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
          {subjectSections.length === 0 && <p className="px-5 py-8 text-sm text-[#94A3B8] text-center">No subject permissions defined.</p>}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteRole}
        danger
        title={selectedRole ? `Delete “${selectedRole.name}”?` : 'Delete role?'}
        message="This access role will be removed. Employees who still hold it must be reassigned first — if any do, the delete is blocked and you'll see why here."
        confirmLabel="Delete role"
        loading={deletingRole}
        error={deleteRoleError}
        onConfirm={performDeleteRole}
        onCancel={() => { if (!deletingRole) { setConfirmDeleteRole(false); setDeleteRoleError(null) } }}
      />
    </div>
  )
}
