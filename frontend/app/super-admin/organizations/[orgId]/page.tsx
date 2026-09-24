'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Building2,
  ChevronLeft,
  Globe,
  Clock,
  Users,
  Layers,
  Shield,
  AlertTriangle,
  FlaskConical,
  Pencil,
  Eye,
  EyeOff,
  Power,
} from 'lucide-react'
import {
  getOrganization,
  deactivateOrganization,
  reactivateOrganization,
  getEntitlements,
  setEntitlements,
  type ModuleEntitlement,
  type EntitlementState,
} from '@/lib/api/organizations'
import { updateUser } from '@/lib/api/users'
import { getRoles } from '@/lib/api/roles'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import type { OrgDetail, OrgStatus } from '@/lib/types'

type OrgMember = NonNullable<OrgDetail['members']>[number]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function orgStatusToBadge(status: OrgStatus): 'active' | 'inactive' | 'pending' {
  if (status === 'active') return 'active'
  if (status === 'inactive') return 'inactive'
  return 'pending'
}

function orgStatusLabel(status: OrgStatus) {
  if (status === 'active') return 'Active'
  if (status === 'inactive') return 'Inactive'
  return 'Pending Setup'
}


// ─── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-[#94A3B8]">{icon}</div>
      <div>
        <p className="text-xs text-[#94A3B8] uppercase tracking-wider font-medium">{label}</p>
        <p className="text-sm text-[#0F172A] font-medium">{value || '—'}</p>
      </div>
    </div>
  )
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-[#F8FAFC] rounded-[10px] border border-[#E2E8F0] px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-[8px] bg-[#EFF6FF] flex items-center justify-center text-[#2563EB]">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-[#0F172A]">{value}</p>
        <p className="text-xs text-[#475569]">{label}</p>
      </div>
    </div>
  )
}

// ─── Entitlements card ───────────────────────────────────────────────────────

const ENT_OPTIONS: { value: EntitlementState; label: string; on: string; off: string }[] = [
  { value: 'full', label: 'Full', on: 'bg-[#16A34A] text-white border-[#16A34A]', off: 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]' },
  { value: 'preview', label: 'Preview', on: 'bg-[#D97706] text-white border-[#D97706]', off: 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]' },
  { value: 'off', label: 'Off', on: 'bg-[#DC2626] text-white border-[#DC2626]', off: 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]' },
]

function EntitlementsCard({ orgId }: { orgId: string }) {
  const [modules, setModules] = useState<ModuleEntitlement[]>([])
  const [edits, setEdits] = useState<Record<string, EntitlementState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getEntitlements(orgId)
      .then((res) => {
        if (cancelled) return
        setModules(res.modules)
        setEdits(Object.fromEntries(res.modules.map((m) => [m.module_key, m.state])))
      })
      .catch(() => { if (!cancelled) setError('Failed to load entitlements.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId])

  const dirty = modules.some((m) => edits[m.module_key] !== m.state)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const entries = modules.map((m) => ({ module_key: m.module_key, state: edits[m.module_key] }))
      const res = await setEntitlements(orgId, entries)
      setModules(res.modules)
      setEdits(Object.fromEntries(res.modules.map((m) => [m.module_key, m.state])))
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save entitlements.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Module Entitlements">
      <p className="text-sm text-[#475569] -mt-1 mb-4">
        Which modules this organization has purchased. This is a hard ceiling — no role, admin, or
        override inside the org can exceed it. <strong>Preview</strong> grants read-only access.
      </p>
      {loading ? (
        <div className="h-32 rounded-[8px] bg-[#F1F5F9] animate-pulse" />
      ) : (
        <div className="flex flex-col gap-2">
          {modules.map((m, i) => (
            <div key={m.module_key}>
              {m.group && m.group !== modules[i - 1]?.group && (
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94A3B8] pt-3 pb-1">
                  {m.group}
                </p>
              )}
              <div
                className={[
                  'flex items-center justify-between gap-4 py-2 border-b border-[#F1F5F9] last:border-0',
                  m.group ? 'pl-3' : '',
                ].join(' ')}
              >
                <span className="text-[15px] font-medium text-[#0F172A]">{m.label}</span>
              <div className="inline-flex rounded-[8px] overflow-hidden border border-[#E2E8F0]">
                {ENT_OPTIONS.map((opt) => {
                  const active = edits[m.module_key] === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setEdits((p) => ({ ...p, [m.module_key]: opt.value }))}
                      className={[
                        'px-3.5 py-1.5 text-sm font-medium border-r last:border-r-0 border-[#E2E8F0] transition-colors',
                        active ? opt.on : opt.off,
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                </div>
              </div>
            </div>
          ))}
          {error && <p className="text-sm text-[#DC2626] mt-2">{error}</p>}
          <div className="flex justify-end pt-3">
            <Button variant="primary" onClick={save} isLoading={saving} disabled={!dirty || saving}>
              Save entitlements
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Edit member modal ───────────────────────────────────────────────────────

function EditMemberModal({
  orgId,
  member,
  onClose,
  onSaved,
}: {
  orgId: string
  member: OrgMember
  onClose: () => void
  onSaved: (vals: { name: string; email: string; country_code: string | null; phone: string | null; is_admin: boolean }) => void
}) {
  const [name, setName] = useState(member.user.name)
  const [email, setEmail] = useState(member.user.email)
  const [phone, setPhone] = useState(member.user.phone ?? '')
  const [countryCode, setCountryCode] = useState(member.user.country_code || DEFAULT_COUNTRY)
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(member.is_admin)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expectedDigits = nationalDigitsFor(countryCode)
  const phoneDigits = phone.replace(/\D/g, '')

  const inputCls =
    'w-full px-3 py-2.5 border border-[#CBD5E1] rounded-[8px] text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
  const labelCls = 'block text-sm font-medium text-[#374151] mb-1.5'

  const save = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!email.trim() && !phoneDigits) {
      setError('Enter an email address or a phone number (at least one).')
      return
    }
    if (phoneDigits && phoneDigits.length !== expectedDigits) {
      setError(`Enter a ${expectedDigits}-digit number for ${countryCode}.`)
      return
    }
    if (password && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    try {
      const changes: Record<string, unknown> = {}
      if (name.trim() !== member.user.name) changes.name = name.trim()
      if (email.trim() !== member.user.email) changes.email = email.trim()
      // Phone identity: send the pair when the number OR country changed; empty clears it.
      const oldPhone = member.user.phone ?? ''
      const oldCountry = member.user.country_code ?? ''
      const phoneChanged = phoneDigits !== oldPhone || (!!phoneDigits && countryCode !== oldCountry)
      if (phoneChanged) {
        changes.phone = phoneDigits
        changes.country_code = phoneDigits ? countryCode : ''
      }
      if (password) changes.password = password
      if (isAdmin !== member.is_admin) changes.is_admin = isAdmin
      if (Object.keys(changes).length > 0) {
        await updateUser(orgId, member.user_id, changes)
      }
      onSaved({
        name: name.trim(),
        email: email.trim(),
        country_code: phoneChanged ? (phoneDigits ? countryCode : null) : (member.user.country_code ?? null),
        phone: phoneChanged ? (phoneDigits || null) : (member.user.phone ?? null),
        is_admin: isAdmin,
      })
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Edit Member" size="sm">
      <div className="flex flex-col gap-4">
        {error && (
          <div className="text-sm text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3">
            {error}
          </div>
        )}
        {member.also_in && member.also_in.length > 0 && (
          <div className="flex items-start gap-2 rounded-[8px] bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-sm text-[#92400E]">
            <Users size={16} className="shrink-0 mt-0.5" />
            <p>
              This person also works in {member.also_in.length} other {member.also_in.length === 1 ? 'firm' : 'firms'}.
              Changing their email or phone changes how they sign in <strong>everywhere</strong>.
            </p>
          </div>
        )}
        <div>
          <label className={labelCls}>Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone number <span className="font-normal text-[#64748B]">— used to sign in</span></label>
          <div className="flex gap-2">
            <CountryCodeSelect
              value={countryCode}
              onChange={(code) => {
                setCountryCode(code)
                setPhone(cleanNationalNumber(phone, code))
              }}
              wrapperClassName="w-[120px] shrink-0"
            />
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(cleanNationalNumber(e.target.value, countryCode))}
              maxLength={expectedDigits}
              placeholder={`${expectedDigits}-digit number`}
              className={`${inputCls} flex-1`}
            />
          </div>
          <p className="mt-1 text-xs text-[#94A3B8]">They can sign in with this number. Leave empty to remove phone sign-in.</p>
        </div>
        <div>
          <label className={labelCls}>Reset password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
          />
          <span className="text-sm font-medium text-[#374151]">Organization administrator</span>
        </label>
        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={save} isLoading={saving}>Save changes</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const router = useRouter()

  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [roleCount, setRoleCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)
  const [showReactivate, setShowReactivate] = useState(false)
  const [isReactivating, setIsReactivating] = useState(false)
  const [reactivateError, setReactivateError] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<OrgMember | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false

    Promise.allSettled([getOrganization(orgId), getRoles(orgId)])
      .then(([orgResult, rolesResult]) => {
        if (cancelled) return
        if (orgResult.status === 'fulfilled') setOrg(orgResult.value)
        if (rolesResult.status === 'fulfilled') setRoleCount(rolesResult.value.length)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [orgId])

  const handleDeactivate = async () => {
    if (!orgId) return
    setIsDeactivating(true)
    setDeactivateError(null)
    try {
      await deactivateOrganization(orgId)
      setOrg((prev) => prev ? { ...prev, status: 'inactive' } : prev)
      setShowConfirm(false)
    } catch (err: any) {
      setDeactivateError(err?.response?.data?.message ?? 'Failed to deactivate.')
    } finally {
      setIsDeactivating(false)
    }
  }

  const handleReactivate = async () => {
    if (!orgId) return
    setIsReactivating(true)
    setReactivateError(null)
    try {
      await reactivateOrganization(orgId)
      setOrg((prev) => prev ? { ...prev, status: 'active' } : prev)
      setShowReactivate(false)
    } catch (err: any) {
      setReactivateError(err?.response?.data?.message ?? 'Failed to reactivate.')
    } finally {
      setIsReactivating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-48 rounded-md bg-[#E2E8F0] animate-pulse" />
        <div className="h-40 rounded-[12px] bg-[#E2E8F0] animate-pulse" />
        <div className="h-64 rounded-[12px] bg-[#E2E8F0] animate-pulse" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-[#475569]">Organization not found.</p>
        <Button variant="secondary" onClick={() => router.push('/super-admin/organizations')}>
          Back to list
        </Button>
      </div>
    )
  }

  const members = org.members ?? []
  const memberCount = org._count?.members ?? members.length
  const deptCount = org._count?.departments ?? 0

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push('/super-admin/organizations')}
          className="inline-flex items-center gap-1 text-sm text-[#475569] hover:text-[#0F172A] mb-3 transition-colors"
        >
          <ChevronLeft size={16} /> Organizations
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold text-[#0F172A]">{org.name}</h1>
          {org.status === 'inactive' ? (
            <Button onClick={() => setShowReactivate(true)}>
              <Power size={15} />
              Reactivate
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setShowConfirm(true)}>
              <AlertTriangle size={15} />
              Deactivate
            </Button>
          )}
        </div>
      </div>

      {/* Org info card */}
      <Card>
        <div className="flex items-start gap-4 mb-6">
          <div className="w-14 h-14 rounded-[12px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
            <Building2 size={26} className="text-[#2563EB]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-[#0F172A]">{org.name}</h2>
              <Badge status={orgStatusToBadge(org.status)} label={orgStatusLabel(org.status)} />
              {org.is_test && (
                <span className="inline-flex items-center gap-1 rounded-[999px] bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-[11px] font-semibold px-2.5 py-0.5">
                  <FlaskConical size={11} /> TEST
                </span>
              )}
              {org.group && (
                <button
                  onClick={() => router.push(`/super-admin/groups/${org.group!.id}`)}
                  className="inline-flex items-center gap-1 rounded-[999px] bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD] text-[11px] font-medium px-2.5 py-0.5 hover:bg-[#BAE6FD] transition-colors"
                >
                  <Layers size={11} />
                  {org.group.name}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-5 pt-5 border-t border-[#E2E8F0]">
          <InfoRow icon={<Layers size={16} />} label="Industry" value={org.industry ?? '—'} />
          <InfoRow icon={<Globe size={16} />} label="Country" value={org.country ?? '—'} />
          <InfoRow icon={<Clock size={16} />} label="Timezone" value={org.timezone ?? '—'} />
        </div>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Users size={18} />} label="Members" value={memberCount} />
        <StatCard icon={<Layers size={18} />} label="Departments" value={deptCount} />
        <StatCard icon={<Shield size={18} />} label="Roles" value={roleCount} />
      </div>

      {/* Module entitlements */}
      <EntitlementsCard orgId={orgId} />

      {/* Members table */}
      <Card title="Members">
        {members.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Users size={28} className="text-[#CBD5E1]" />
            <p className="text-sm text-[#94A3B8]">No members in this organization yet.</p>
          </div>
        ) : (
          <ResponsiveTable<OrgMember>
            className="border-0 shadow-none rounded-none -mx-6 -mb-6 md:mx-0 md:mb-0"
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (m) => <span className="font-medium text-[#0F172A]">{m.user.name}</span>,
              },
              {
                key: 'email',
                header: 'Email',
                render: (m) => <span className="text-[#475569]">{m.user.email}</span>,
              },
              {
                key: 'role',
                header: 'Role',
                render: (m) => (
                  <Badge status={m.is_admin ? 'info' : 'active'} label={m.is_admin ? 'Admin' : 'Member'} />
                ),
              },
              {
                key: 'also_in',
                header: 'Also In',
                render: (m) =>
                  m.also_in.length === 0 ? (
                    <span className="text-[#94A3B8] text-xs">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 md:justify-start justify-end">
                      {m.also_in.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => router.push(`/super-admin/organizations/${o.id}`)}
                          className="inline-flex items-center rounded-[999px] bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD] text-[11px] font-medium px-2 py-0.5 hover:bg-[#BAE6FD] transition-colors"
                        >
                          {o.name}
                        </button>
                      ))}
                    </div>
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (m) => (
                  <Badge
                    status={m.user.is_active ? 'active' : 'inactive'}
                    label={m.user.is_active ? 'Active' : 'Inactive'}
                  />
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (m) => (
                  <button
                    onClick={() => setEditingMember(m)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                ),
              },
            ]}
            rows={members}
            rowKey={(m) => m.id}
          />
        )}
      </Card>

      {/* Edit member modal */}
      {editingMember && (
        <EditMemberModal
          orgId={orgId}
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={(vals) => {
            setOrg((prev) =>
              prev
                ? {
                    ...prev,
                    members: prev.members.map((m) =>
                      m.id === editingMember.id
                        ? { ...m, is_admin: vals.is_admin, user: { ...m.user, name: vals.name, email: vals.email, country_code: vals.country_code, phone: vals.phone } }
                        : m,
                    ),
                  }
                : prev,
            )
            setEditingMember(null)
          }}
        />
      )}

      {/* Deactivate confirm modal */}
      <Modal
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setDeactivateError(null) }}
        title="Deactivate Organization"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 rounded-[8px] bg-[#FEF2F2] border border-[#FECACA]">
            <AlertTriangle size={18} className="text-[#DC2626] shrink-0 mt-0.5" />
            <p className="text-sm text-[#7F1D1D]">
              Deactivating <strong>{org.name}</strong> signs out everyone in the firm
              immediately and blocks them from signing in again — their accounts and data
              are kept untouched. You can reverse this at any time with Reactivate.
            </p>
          </div>
          {deactivateError && <p className="text-sm text-[#DC2626]">{deactivateError}</p>}
          <div className="flex gap-3 pt-1">
            <Button variant="danger" isLoading={isDeactivating} onClick={handleDeactivate}>Deactivate</Button>
            <Button
              variant="secondary"
              onClick={() => { setShowConfirm(false); setDeactivateError(null) }}
              disabled={isDeactivating}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reactivate confirm modal */}
      <Modal
        isOpen={showReactivate}
        onClose={() => { setShowReactivate(false); setReactivateError(null) }}
        title="Reactivate Organization"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 rounded-[8px] bg-[#EFF6FF] border border-[#BFDBFE]">
            <Power size={18} className="text-[#2563EB] shrink-0 mt-0.5" />
            <p className="text-sm text-[#1E3A8A]">
              Reactivating <strong>{org.name}</strong> lets all its users sign in again
              straight away, with the same accounts and passwords they had before.
            </p>
          </div>
          {reactivateError && <p className="text-sm text-[#DC2626]">{reactivateError}</p>}
          <div className="flex gap-3 pt-1">
            <Button isLoading={isReactivating} onClick={handleReactivate}>Reactivate</Button>
            <Button
              variant="secondary"
              onClick={() => { setShowReactivate(false); setReactivateError(null) }}
              disabled={isReactivating}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
