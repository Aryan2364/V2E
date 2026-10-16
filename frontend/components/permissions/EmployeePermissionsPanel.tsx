'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
    { v: null, label: 'Inherit', on: 'bg-text-secondary text-surface' },
    { v: 'grant', label: grantLabel, on: 'bg-success text-primary-foreground' },
    { v: 'revoke', label: revokeLabel, on: 'bg-danger text-on-danger' },
  ]
  return (
    <div className="inline-flex rounded-[7px] border border-border-light overflow-hidden">
      {opts.map((o) => {
        const active = value === o.v
        return (
          <button
            key={String(o.v)}
            disabled={busy}
            onClick={() => onChange(o.v)}
            className={[
              'px-2.5 py-1 text-meta font-medium transition-colors disabled:opacity-50',
              active ? o.on : 'bg-surface text-text-secondary hover:bg-surface-sunken',
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
        'inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium border',
        allowed ? 'bg-success-bg text-success border-success-border' : 'bg-danger-bg text-danger border-danger-border',
      ].join(' ')}
    >
      {allowed ? 'Allowed' : 'Denied'}
    </span>
  )
}

export default function EmployeePermissionsPanel({ orgId, userId }: { orgId: string; userId: string }) {
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
      .catch(() => { if (!cancelled) toast.error('Failed to load permissions') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, userId])

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
      toast.error(err?.response?.data?.message ?? 'Failed to update')
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
      toast.error(err?.response?.data?.message ?? 'Failed to update')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-6 py-4 text-left"
      >
        <ShieldCheck size={18} className="text-primary-text" />
        <span className="flex-1 text-card-heading font-medium text-text-primary">Access &amp; Permissions</span>
        {data?.is_admin && (
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium bg-surface-control text-text-secondary border border-border-light">
            Administrator
          </span>
        )}
        <ChevronRight size={18} className={['text-text-muted transition-transform', open ? 'rotate-90' : ''].join(' ')} />
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-border-light">
          {loading ? (
            <div className="py-8 flex items-center justify-center text-text-secondary">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : !data ? (
            <p className="py-8 text-body text-text-muted text-center">No permission data.</p>
          ) : (
            <>
              <p className="text-body text-text-secondary mt-4 mb-4">
                Baseline flows from the <span className="font-medium text-text-primary">{systemRoleName}</span> system role.
                Add a personal <span className="text-success font-medium">grant</span> or{' '}
                <span className="text-danger font-medium">revoke</span> only where this person should differ.
              </p>

              {/* Feature overrides */}
              {actorModules.map((mod) => {
                const isCollapsed = collapsed[mod.key]
                return (
                  <div key={mod.key} className="mb-3 border border-border-light rounded-xl overflow-hidden">
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [mod.key]: !c[mod.key] }))}
                      className="w-full flex items-center gap-1.5 px-4 py-2.5 bg-surface-sunken text-left"
                    >
                      <ChevronRight size={15} className={['text-text-muted transition-transform', isCollapsed ? '' : 'rotate-90'].join(' ')} />
                      <span className="text-body font-medium text-text-primary">{mod.label}</span>
                    </button>
                    {!isCollapsed &&
                      mod.subModules.map((sub) =>
                        sub.features.map((f) => {
                          const ul = leafByKey.get(f.key)
                          if (!ul) return null
                          return (
                            <div key={f.key} className="px-4 py-3 border-t border-border-light">
                              <p className="text-body font-medium text-text-primary">{f.label}</p>
                              {f.description && <p className="text-meta text-text-muted mt-0.5 mb-2">{f.description}</p>}
                              <div className="flex flex-col gap-2 mt-2">
                                {f.actions.map((a) => {
                                  const ov = ul.overrides[a]
                                  const key = `${f.key}:${a}`
                                  const showScope = !!ul.scopable && a === 'read'
                                  return (
                                    <div key={a} className="flex flex-wrap items-center gap-3">
                                      <span className="w-14 text-meta font-medium text-text-secondary">{ACTION_LABEL[a]}</span>
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
                                        <Select
                                          value={ul.override_scopes?.read ?? defaultReadScope(ul)}
                                          onValueChange={(v) => changeOverride(f.key, 'read', 'grant', v as DataScope)}
                                          disabled={busyKey === key}
                                          items={DATA_SCOPES.map((s) => ({ value: s, label: DATA_SCOPE_LABEL[s] }))}
                                        >
                                          <SelectTrigger className="h-8 text-meta">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {DATA_SCOPES.map((s) => (
                                              <SelectItem key={s} value={s}>{DATA_SCOPE_LABEL[s]}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      )}
                                      <span className="text-meta text-text-muted">
                                        inherited: {ul.inherited[a] ? 'Allowed' : 'Denied'}
                                      </span>
                                      <EffectiveDot allowed={ul.effective[a]} />
                                      {showScope && ul.effective[a] && (
                                        <span className="text-meta text-text-muted">
                                          sees: {DATA_SCOPE_LABEL[ul.effective_scopes?.read ?? 'own']}
                                        </span>
                                      )}
                                      {ov && (
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium bg-warning-bg text-warning border border-warning-border">
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
                  <h3 className="text-body font-medium text-text-primary mb-1">Subject eligibility</h3>
                  <p className="text-meta text-text-muted mb-3 max-w-xl">
                    Whether this person can be assigned or targeted by others — independent of whether they can
                    open the module themselves.
                  </p>
                  <div className="border border-border-light rounded-xl overflow-hidden">
                    {data.subject_overrides.map((s) => (
                      <div key={s.subject_key} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-light last:border-0">
                        <span className="flex-1 min-w-[160px] text-body font-medium text-text-primary">{s.label}</span>
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
