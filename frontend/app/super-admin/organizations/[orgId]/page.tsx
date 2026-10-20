'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Building2Icon,
  GlobeIcon,
  ClockIcon,
  UsersIcon,
  LayersIcon,
  ShieldIcon,
  TriangleAlertIcon,
  FlaskConicalIcon,
  PencilIcon,
  PowerIcon,
  OctagonXIcon,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Card from '@/components/ui/card'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'
import { PasswordInput } from '@/components/ui/password-input'
import { ChoiceRow } from '@/components/ui/choice-row'
import { Checkbox } from '@/components/ui/checkbox'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import type { OrgDetail, OrgStatus } from '@/lib/types'

type OrgMember = NonNullable<OrgDetail['members']>[number]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function orgStatusVariant(status: OrgStatus): 'success' | 'danger' | 'warning' {
  if (status === 'active') return 'success'
  if (status === 'inactive') return 'danger'
  return 'warning'
}

function orgStatusLabel(status: OrgStatus) {
  if (status === 'active') return 'Active'
  if (status === 'inactive') return 'Inactive'
  return 'Pending setup'
}

// ─── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-text-muted">{icon}</div>
      <div>
        <p className="text-label font-medium text-text-muted">{label}</p>
        <p className="text-body font-medium text-text-primary">{value || '—'}</p>
      </div>
    </div>
  )
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-light bg-surface-sunken px-4 py-4">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
        {icon}
      </div>
      <div>
        <p className="text-section font-medium text-text-primary">{value}</p>
        <p className="text-meta text-text-secondary">{label}</p>
      </div>
    </div>
  )
}

// ─── Entitlements card ───────────────────────────────────────────────────────

const ENT_OPTIONS: { value: EntitlementState; label: string; on: string }[] = [
  { value: 'full', label: 'Full', on: 'bg-success text-primary-foreground border-success' },
  { value: 'preview', label: 'Preview', on: 'bg-warning text-primary-foreground border-warning' },
  { value: 'off', label: 'Off', on: 'bg-danger text-primary-foreground border-danger' },
]
const ENT_OFF = 'bg-surface text-text-secondary border-border-light hover:border-border'

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
    <Card title="Module entitlements">
      <p className="mb-4 text-body text-text-secondary">
        Which modules this organization has purchased. This is a hard ceiling — no role, admin, or
        override inside the org can exceed it. <strong>Preview</strong> grants read-only access.
      </p>
      {loading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : (
        <div className="flex flex-col gap-2">
          {modules.map((m, i) => (
            <div key={m.module_key}>
              {m.group && m.group !== modules[i - 1]?.group && (
                <p className="pt-3 pb-1 text-label font-medium text-text-muted">
                  {m.group}
                </p>
              )}
              <div
                className={[
                  'flex items-center justify-between gap-4 border-b border-border-light py-2 last:border-0',
                  m.group ? 'pl-3' : '',
                ].join(' ')}
              >
                <span className="text-body font-medium text-text-primary">{m.label}</span>
                <div className="inline-flex overflow-hidden rounded-lg border border-border-light">
                  {ENT_OPTIONS.map((opt) => {
                    const active = edits[m.module_key] === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setEdits((p) => ({ ...p, [m.module_key]: opt.value }))}
                        className={[
                          'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring border-r border-border-light px-4 py-2 text-body font-medium transition-colors last:border-r-0',
                          active ? opt.on : ENT_OFF,
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
          {error && <p className="mt-2 text-body text-danger">{error}</p>}
          <div className="flex justify-end pt-3">
            <Button onClick={save} loading={saving} loadingLabel="Saving" disabled={!dirty || saving}>
              Save entitlements
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Edit member dialog ───────────────────────────────────────────────────────

function EditMemberDialog({
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expectedDigits = nationalDigitsFor(countryCode)
  const phoneDigits = phone.replace(/\D/g, '')

  // Field errors sit under the field that is wrong; focus goes to the first one (kit 11.3, 39.3).
  type MemberField = 'name' | 'contact' | 'password'
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MemberField, string>>>({})
  const clearErr = (k: MemberField) => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))
  const [savedValues] = useState({
    name: member.user.name, email: member.user.email, phone: member.user.phone ?? '',
    countryCode: member.user.country_code || DEFAULT_COUNTRY, password: '', isAdmin: member.is_admin,
  })
  const guarded = useGuardedClose({
    open: true,
    values: { name, email, phone, countryCode, password, isAdmin },
    saved: savedValues,
    noun: 'member',
    mode: 'edit',
    onClose,
  })

  const save = async () => {
    setError(null)
    const errs: Partial<Record<MemberField, string>> = {}
    if (!name.trim()) errs.name = 'Enter the full name of the member.'
    if (!email.trim() && !phoneDigits) errs.contact = 'Enter an email address or a phone number. At least one is needed.'
    else if (phoneDigits && phoneDigits.length !== expectedDigits) errs.contact = `Enter a ${expectedDigits}-digit number for ${countryCode}.`
    if (password && password.length < 8) errs.password = 'Use at least 8 characters in the password.'
    setFieldErrors(errs)
    const firstBad = (['name', 'contact', 'password'] as MemberField[]).find((k) => errs[k])
    if (firstBad) {
      requestAnimationFrame(() => document.getElementById(`member-${firstBad === 'contact' ? 'email' : firstBad}`)?.focus())
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
      setError(err?.response?.data?.message ?? 'Could not save the member. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Dialog open onOpenChange={(next) => { if (!next) guarded.requestClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Banner variant="danger">
              <OctagonXIcon />
              <BannerDescription>{error}</BannerDescription>
            </Banner>
          ) : null}
          {member.also_in && member.also_in.length > 0 && (
            <Banner variant="warning">
              <UsersIcon />
              <BannerDescription>
                This person also works in {member.also_in.length} other {member.also_in.length === 1 ? 'firm' : 'firms'}.
                Changing their email or phone changes how they sign in <strong>everywhere</strong>.
              </BannerDescription>
            </Banner>
          )}
          <div>
            <Label htmlFor="member-name" required>Full name</Label>
            <Input id="member-name" value={name} onChange={(e) => { setName(e.target.value); clearErr('name') }} aria-invalid={fieldErrors.name ? true : undefined} className="mt-2 max-w-none" />
            <InlineFieldError>{fieldErrors.name}</InlineFieldError>
          </div>
          <div>
            <Label htmlFor="member-email">Email</Label>
            <Input id="member-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearErr('contact') }} aria-invalid={fieldErrors.contact ? true : undefined} className="mt-2 max-w-none" />
          </div>
          <div>
            <Label htmlFor="member-phone">
              Phone number
            </Label>
            <div className="mt-2 flex gap-2">
              <CountryCodeSelect
                value={countryCode}
                onChange={(code) => {
                  setCountryCode(code)
                  setPhone(cleanNationalNumber(phone, code))
                }}
                wrapperClassName="w-29 shrink-0"
              />
              <Input
                id="member-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => { setPhone(cleanNationalNumber(e.target.value, countryCode)); clearErr('contact') }}
                maxLength={expectedDigits}
                placeholder={`${expectedDigits}-digit number`}
                className="max-w-none flex-1"
              />
            </div>
            <InlineFieldError>{fieldErrors.contact}</InlineFieldError>
            <p className="mt-2 text-label text-text-muted">They can sign in with this number. Leave empty to remove phone sign-in.</p>
          </div>
          <div>
            <Label htmlFor="member-password">Reset password</Label>
            <PasswordInput
              id="member-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearErr('password') }}
              aria-invalid={fieldErrors.password ? true : undefined}
              placeholder="Leave blank to keep the current password"
              className="mt-2 max-w-none"
            />
            <InlineFieldError>{fieldErrors.password}</InlineFieldError>
          </div>
          <ChoiceRow
            control={<Checkbox checked={isAdmin} onCheckedChange={(c) => setIsAdmin(c === true)} />}
            label="Organization administrator"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} loadingLabel="Saving">Save member</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-text-secondary">Organization not found.</p>
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
    <div className="max-w-4xl">
      <PageHeader
        title={org.name}
        trail={[
          { label: 'Organizations', href: '/super-admin/organizations' },
          { label: org.name, href: `/super-admin/organizations/${orgId}` },
        ]}
        actions={
          org.status === 'inactive' ? (
            <Button onClick={() => setShowReactivate(true)}>
              <PowerIcon size={15} />
              Reactivate
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setShowConfirm(true)}>
              <TriangleAlertIcon size={15} />
              Deactivate
            </Button>
          )
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Org info card */}
        <Card>
          <div className="mb-6 flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-card bg-primary-subtle">
              <Building2Icon size={26} className="text-primary-text" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-section font-medium text-text-primary">{org.name}</h2>
                <Badge variant={orgStatusVariant(org.status)}>{orgStatusLabel(org.status)}</Badge>
                {org.is_test && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-3 py-0.5 text-meta font-medium text-warning">
                    <FlaskConicalIcon size={11} /> TEST
                  </span>
                )}
                {org.group && (
                  <button
                    onClick={() => router.push(`/super-admin/groups/${org.group!.id}`)}
                    className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring inline-flex items-center gap-1 rounded-full border border-border-light bg-surface-control px-3 py-0.5 text-meta font-medium text-text-secondary hover:bg-surface-control"
                  >
                    <LayersIcon size={11} />
                    {org.group.name}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-border-light pt-4 md:grid-cols-3">
            <InfoRow icon={<LayersIcon size={16} />} label="Industry" value={org.industry ?? '—'} />
            <InfoRow icon={<GlobeIcon size={16} />} label="Country" value={org.country ?? '—'} />
            <InfoRow icon={<ClockIcon size={16} />} label="Timezone" value={org.timezone ?? '—'} />
          </div>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={<UsersIcon size={18} />} label="Members" value={memberCount} />
          <StatCard icon={<LayersIcon size={18} />} label="Departments" value={deptCount} />
          <StatCard icon={<ShieldIcon size={18} />} label="Roles" value={roleCount} />
        </div>

        {/* Module entitlements */}
        <EntitlementsCard orgId={orgId} />

        {/* Members table */}
        <Card title="Members">
          {members.length === 0 ? (
            <EmptyState variant="nothing-yet" heading="No members yet">
              Members appear here once the organization admin adds them.
            </EmptyState>
          ) : (
            <ResponsiveTable<OrgMember>
              className="-mx-6 -mb-6 rounded-none border-0 shadow-none md:mx-0 md:mb-0"
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  primary: true,
                  render: (m) => <span className="font-medium text-text-primary">{m.user.name}</span>,
                },
                {
                  key: 'email',
                  header: 'Email',
                  render: (m) => <span className="text-text-secondary">{m.user.email}</span>,
                },
                {
                  key: 'role',
                  header: 'Role',
                  render: (m) => (
                    <Badge variant={m.is_admin ? 'neutral' : 'success'}>{m.is_admin ? 'Admin' : 'Member'}</Badge>
                  ),
                },
                {
                  key: 'also_in',
                  header: 'Also in',
                  render: (m) =>
                    m.also_in.length === 0 ? (
                      <span className="text-meta text-text-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                        {m.also_in.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => router.push(`/super-admin/organizations/${o.id}`)}
                            className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring inline-flex items-center rounded-full border border-border-light bg-surface-control px-2 py-0.5 text-meta font-medium text-text-secondary hover:bg-surface-control"
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
                    <Badge variant={m.user.is_active ? 'success' : 'danger'}>
                      {m.user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (m) => (
                    <Button type="button" onClick={() => setEditingMember(m)} variant="secondary" size="sm">
                      <PencilIcon size={13} /> Edit
                    </Button>
                  ),
                },
              ]}
              rows={members}
              rowKey={(m) => m.id}
            />
          )}
        </Card>
      </div>

      {/* Edit member dialog */}
      {editingMember && (
        <EditMemberDialog
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

      {/* Deactivate confirm */}
      <AlertDialog open={showConfirm} onOpenChange={(next) => { if (!next) { setShowConfirm(false); setDeactivateError(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate organization</AlertDialogTitle>
            <AlertDialogDescription>
              Deactivating <strong>{org.name}</strong> signs out everyone in the firm
              immediately and blocks them from signing in again — their accounts and data
              are kept untouched. You can reverse this at any time with Reactivate.
            </AlertDialogDescription>
            {deactivateError ? (
              <Banner variant="danger">
                <OctagonXIcon />
                <BannerDescription>{deactivateError}</BannerDescription>
              </Banner>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" loading={isDeactivating} onClick={handleDeactivate}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate confirm */}
      <AlertDialog open={showReactivate} onOpenChange={(next) => { if (!next) { setShowReactivate(false); setReactivateError(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate organization</AlertDialogTitle>
            <AlertDialogDescription>
              Reactivating <strong>{org.name}</strong> lets all its users sign in again
              straight away, with the same accounts and passwords they had before.
            </AlertDialogDescription>
            {reactivateError ? (
              <Banner variant="danger">
                <OctagonXIcon />
                <BannerDescription>{reactivateError}</BannerDescription>
              </Banner>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="primary" loading={isReactivating} onClick={handleReactivate}>
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
