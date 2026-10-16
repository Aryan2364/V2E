'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ShieldCheck, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { clearPermissionsCache } from '@/lib/auth/use-permissions'
import {
  getPermissionRegistry,
  getUserPermissions,
  setUserOverride,
  setUserSubjectOverride,
  DATA_SCOPES,
  DATA_SCOPE_LABEL,
  type RegistryModule,
  type UserPermissions,
  type UserPermissionLeaf,
  type PermAction,
  type OverrideEffect,
  type DataScope,
} from '@/lib/api/permissions'

const ACTION_LABEL: Record<PermAction, string> = { read: 'Read', write: 'Write', edit: 'Edit', delete: 'Delete' }

type OverrideState = OverrideEffect | null

// Compact 3-state segmented control: Inherit / Grant / Revoke (or Eligible/Ineligible for subjects).
function TriToggle({
  value,
  onChange,
  busy,
  grantLabel = 'Grant',
  revokeLabel = 'Revoke',
}: {
  value: OverrideState
  onChange: (v: OverrideState) => void
  busy?: boolean
  grantLabel?: string
  revokeLabel?: string
}) {
  const opts: { v: OverrideState; label: string; on: string }[] = [
    { v: null, label: 'Inherit', on: 'bg-[#475569] text-white' },
    { v: 'grant', label: grantLabel, on: 'bg-[#16A34A] text-white' },
    { v: 'revoke', label: revokeLabel, on: 'bg-[#DC2626] text-white' },
  ]
  return (
    <div className="inline-flex rounded-[7px] border border-[#E2E8F0] overflow-hidden">
      {opts.map((o) => {
        const active = value === o.v
        return (
          <button
            key={String(o.v)}
            disabled={busy}
            onClick={() => onChange(o.v)}
            className={[
              'px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              active ? o.on : 'bg-white text-[#475569] hover:bg-[#F8FAFC]',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function EffectiveDot({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-semibold border',
        allowed ? 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]' : 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
      ].join(' ')}
    >
      {allowed ? 'Allowed' : 'Denied'}
    </span>
  )
}

export default function EmployeePermissionsPanel({ orgId, userId }: { orgId: string; userId: string }) {
  const { addToast } = useToast()
  const [registry, setRegistry] = useState<RegistryModule[]>([])
  const [data, setData] = useState<UserPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!orgId || !userId) return
    let cancelled = false
    setLoading(true)
    Promise.all([getPermissionRegistry(orgId), getUserPermissions(orgId, userId)])
      .then(([reg, perms]) => {
        if (cancelled) return
        setRegistry(reg.modules)
        setData(perms)
      })
      .catch(() => { if (!cancelled) addToast('Failed to load permissions', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, userId, addToast])

  const leafByKey = useMemo(() => {
    const m = new Map<string, UserPermissionLeaf>()
    data?.leaves.forEach((l) => m.set(l.key, l))
    return m
  }, [data])

  const actorModules = useMemo(
    () =>
      registry
        .map((mod) => ({
          ...mod,
          subModules: mod.subModules
            .map((s) => ({ ...s, features: s.features.filter((f) => f.axis === 'actor' && f.kind === 'feature') }))
            .filter((s) => s.features.length > 0),
        }))
        .filter((mod) => mod.subModules.length > 0),
    [registry],
  )

  const systemRoleName = data?.system_role?.name ?? 'system role'

  async function changeOverride(
    featureKey: string,
    action: PermAction,
    effect: OverrideState,
    scope?: DataScope | null,
  ) {
    const key = `${featureKey}:${action}`
    setBusyKey(key)
    try {
      const updated = await setUserOverride(orgId, userId, {
        feature_key: featureKey,
        action,
        effect,
        ...(scope !== undefined ? { scope } : {}),
      })
      setData(updated)
      clearPermissionsCache(orgId)
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to update', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  // The visibility (read) scope a personal grant should use as its default.
  const defaultReadScope = (ul: UserPermissionLeaf): DataScope =>
    ul.override_scopes?.read ?? ul.effective_scopes?.read ?? 'own'

  async function changeSubject(subjectKey: string, effect: OverrideState) {
    setBusyKey(`subj:${subjectKey}`)
    try {
      const updated = await setUserSubjectOverride(orgId, userId, { subject_key: subjectKey, effect })
      setData(updated)
      clearPermissionsCache(orgId)
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Failed to update', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-6 py-4 text-left"
      >
        <ShieldCheck size={18} className="text-[#2563EB]" />
        <span className="flex-1 text-base font-semibold text-[#0F172A]">Access &amp; Permissions</span>
        {data?.is_admin && (
          <span className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[11px] font-semibold bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]">
            Administrator
          </span>
        )}
        <ChevronRight size={18} className={['text-[#94A3B8] transition-transform', open ? 'rotate-90' : ''].join(' ')} />
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-[#F1F5F9]">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-[#475569]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : !data ? (
            <p className="py-8 text-sm text-[#94A3B8] text-center">No permission data.</p>
          ) : (
            <>
              <p className="text-sm text-[#475569] mt-4 mb-5">
                Baseline flows from the <span className="font-medium text-[#0F172A]">{systemRoleName}</span> system role.
                Add a personal <span className="text-[#16A34A] font-medium">grant</span> or{' '}
                <span className="text-[#DC2626] font-medium">revoke</span> only where this person should differ.
              </p>

              {/* Feature overrides */}
              {actorModules.map((mod) => {
                const isCollapsed = collapsed[mod.key]
                return (
                  <div key={mod.key} className="mb-3 border border-[#E2E8F0] rounded-[10px] overflow-hidden">
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [mod.key]: !c[mod.key] }))}
                      className="w-full flex items-center gap-1.5 px-4 py-2.5 bg-[#F8FAFC] text-left"
                    >
                      <ChevronRight size={15} className={['text-[#94A3B8] transition-transform', isCollapsed ? '' : 'rotate-90'].join(' ')} />
                      <span className="text-sm font-semibold text-[#0F172A]">{mod.label}</span>
                    </button>
                    {!isCollapsed &&
                      mod.subModules.map((sub) =>
                        sub.features.map((f) => {
                          const ul = leafByKey.get(f.key)
                          if (!ul) return null
                          return (
                            <div key={f.key} className="px-4 py-3 border-t border-[#F1F5F9]">
                              <p className="text-sm font-medium text-[#0F172A]">{f.label}</p>
                              {f.description && <p className="text-xs text-[#64748B] mt-0.5 mb-2">{f.description}</p>}
                              <div className="flex flex-col gap-2 mt-2">
                                {f.actions.map((a) => {
                                  const ov = ul.overrides[a]
                                  const key = `${f.key}:${a}`
                                  const showScope = !!ul.scopable && a === 'read'
                                  return (
                                    <div key={a} className="flex flex-wrap items-center gap-3">
                                      <span className="w-14 text-xs font-medium text-[#475569]">{ACTION_LABEL[a]}</span>
                                      <TriToggle
                                        value={ov}
                                        busy={busyKey === key}
                                        onChange={(v) =>
                                          changeOverride(
                                            f.key,
                                            a,
                                            v,
                                            showScope && v === 'grant' ? defaultReadScope(ul) : undefined,
                                          )
                                        }
                                      />
                                      {showScope && ov === 'grant' && (
                                        <select
                                          aria-label={`${f.label} visibility scope`}
                                          disabled={busyKey === key}
                                          value={ul.override_scopes?.read ?? defaultReadScope(ul)}
                                          onChange={(e) => changeOverride(f.key, 'read', 'grant', e.target.value as DataScope)}
                                          className="text-xs border border-[#CBD5E1] rounded-[6px] px-2 py-1 bg-white text-[#0F172A] focus:outline-hidden focus:border-[#2563EB] disabled:opacity-50"
                                        >
                                          {DATA_SCOPES.map((s) => (
                                            <option key={s} value={s}>
                                              {DATA_SCOPE_LABEL[s]}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                      <span className="text-[11px] text-[#94A3B8]">
                                        inherited: {ul.inherited[a] ? 'Allowed' : 'Denied'}
                                      </span>
                                      <EffectiveDot allowed={ul.effective[a]} />
                                      {showScope && ul.effective[a] && (
                                        <span className="text-[11px] text-[#64748B]">
                                          sees: {DATA_SCOPE_LABEL[ul.effective_scopes?.read ?? 'own']}
                                        </span>
                                      )}
                                      {ov && (
                                        <span className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                                          Override
                                        </span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        }),
                      )}
                  </div>
                )
              })}

              {/* Subject eligibility */}
              {data.subject_overrides.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-[#0F172A] mb-1">Subject eligibility</h3>
                  <p className="text-xs text-[#64748B] mb-3 max-w-xl">
                    Whether this person can be assigned or targeted by others — independent of whether they can
                    open the module themselves.
                  </p>
                  <div className="border border-[#E2E8F0] rounded-[10px] overflow-hidden">
                    {data.subject_overrides.map((s) => (
                      <div key={s.subject_key} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F1F5F9] last:border-0">
                        <span className="flex-1 min-w-[160px] text-sm font-medium text-[#0F172A]">{s.label}</span>
                        <TriToggle
                          value={s.override}
                          busy={busyKey === `subj:${s.subject_key}`}
                          grantLabel="Eligible"
                          revokeLabel="Ineligible"
                          onChange={(v) => changeSubject(s.subject_key, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
