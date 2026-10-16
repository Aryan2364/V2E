'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Save, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import MyLeavePanel from '@/components/leave/MyLeavePanel'
import { useToast } from '@/components/ui/Toast'
import DatePicker from '@/components/ui/DatePicker'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { getMyProfile, updateMyProfile, getEmployees } from '@/lib/api/employees'
import { changePassword } from '@/lib/api/auth'
import type { EmployeeProfile, KraItem, Role } from '@/lib/types'
import { formatDate as formatDateToken } from '@/lib/format'

const roleLevelLabel: Record<string, string> = { junior: 'Junior', mid: 'Mid', senior: 'Senior', head: 'Head' }

type Kpi = NonNullable<Role['kpi']>[number]
const kpiColumns: ResponsiveColumn<Kpi>[] = [
  { key: 'title', header: 'Title', primary: true, cellClassName: 'px-0! py-3! pr-4! font-medium text-text-primary', headerClassName: 'px-0! py-2.5! pr-4!', render: (k) => k.title },
  { key: 'metric', header: 'Metric', cellClassName: 'px-0! py-3! pr-4! text-text-secondary', headerClassName: 'px-0! py-2.5! pr-4!', render: (k) => k.metric },
  { key: 'target', header: 'Target', cellClassName: 'px-0! py-3! pr-4! text-text-secondary', headerClassName: 'px-0! py-2.5! pr-4!', render: (k) => k.target },
  { key: 'unit', header: 'Unit', cellClassName: 'px-0! py-3! text-text-secondary', headerClassName: 'px-0! py-2.5!', render: (k) => k.unit },
]

const employmentLabel: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
}

const MIN_PASSWORD = 8

function toDateInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : ''
}
function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return formatDateToken(dateStr) || dateStr
}

// ─── Shared look with the employee-detail page ─────────────────────────────────
function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}
const avatarColors = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary', 'bg-text-secondary']
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return avatarColors[hash % avatarColors.length]
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-[999px] px-3 py-1 text-meta font-medium ${active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-meta font-medium text-text-secondary uppercase tracking-wider mb-1">{label}</p>
      <p className="text-body text-text-primary font-medium wrap-break-word">{value ?? '—'}</p>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-6">
      <div className="mb-4 pb-3 border-b border-border-light flex items-baseline gap-2 flex-wrap">
        <h2 className="text-body font-medium text-text-primary">{title}</h2>
        {subtitle && <span className="text-meta text-text-secondary">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

// Walk up the manager chain (up to 5 levels) from the full employee list — same
// logic as the employee-detail page.
function ReportingChain({ me, allEmployees }: { me: EmployeeProfile; allEmployees: EmployeeProfile[] }) {
  const chain: EmployeeProfile[] = []
  let current = me
  let depth = 0
  while (current.reporting_to_user_id && depth < 5) {
    const manager = allEmployees.find((e) => e.user_id === current.reporting_to_user_id)
    if (!manager) break
    chain.push(manager)
    current = manager
    depth++
  }
  if (chain.length === 0) return <p className="text-body text-text-muted italic">No reporting chain found.</p>
  return (
    <div className="space-y-2">
      {chain.map((mgr, i) => {
        const mgrName = mgr.user?.name ?? 'Unknown'
        return (
          <div key={mgr.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full ${avatarColor(mgrName)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                {getInitials(mgrName)}
              </div>
              {i < chain.length - 1 && <div className="w-px h-4 bg-surface-control-pressed mt-1" />}
            </div>
            <div className="pt-1">
              <p className="text-body font-medium text-text-primary">{mgrName}</p>
              <p className="text-meta text-text-secondary">{mgr.role?.title ?? '—'}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

type ProfileTab = 'profile' | 'leave'

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'leave', label: 'Leave' },
]

// Section tabs (kit §33): the active tab lives in the URL (?tab=leave) so it can be
// linked to — leave notifications deep-link here — and switching replaces history.
function ProfileTabs({ active, onChange }: { active: ProfileTab; onChange: (t: ProfileTab) => void }) {
  return (
    <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-surface-sunken">
      <div role="tablist" aria-label="My profile sections" className="flex gap-6 border-b border-border-light">
        {TABS.map((t) => {
          const on = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={[
                '-mb-px h-11 sm:h-10 border-b-2 text-body transition-colors duration-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded-t-[4px]',
                on
                  ? 'border-primary text-primary-text font-medium'
                  : 'border-transparent text-text-secondary font-medium hover:text-text-primary',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function MyProfilePage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<PageSpinner />}>
      <MyProfileContent />
    </Suspense>
  )
}

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function MyProfileContent() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { addToast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Leave belongs to the `ecs` module — offered only when the org has it. It needs
  // no employee profile: leave is keyed on the org member, not the HR record.
  const { loading: entLoading, state: entState } = useEntitlements()
  const leaveState = entState('ecs')
  const leaveAvailable = !entLoading && leaveState !== 'off'
  const wantsLeave = searchParams.get('tab') === 'leave'
  const tab: ProfileTab = wantsLeave && leaveAvailable ? 'leave' : 'profile'

  function selectTab(t: ProfileTab) {
    router.replace(t === 'leave' ? `${pathname}?tab=leave` : pathname, { scroll: false })
  }

  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  const [allEmployees, setAllEmployees] = useState<EmployeeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPersonal, setSavingPersonal] = useState(false)
  const [dob, setDob] = useState('')
  const [marriage, setMarriage] = useState('')

  // Password change (direct — no current password / OTP)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    // Admins / accounts without an employee record still get identity + password;
    // a missing profile is an expected state here, not an error.
    try {
      const p = await getMyProfile(orgId)
      setProfile(p)
      setDob(toDateInput(p.date_of_birth))
      setMarriage(toDateInput(p.marriage_date))
      // Needed to walk the reporting chain; readable by any authenticated user.
      getEmployees(orgId).then(setAllEmployees).catch(() => setAllEmployees([]))
    } catch {
      setProfile(null)
    }
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  async function savePersonal() {
    setSavingPersonal(true)
    try {
      const updated = await updateMyProfile(orgId, {
        date_of_birth: dob || null,
        marriage_date: marriage || null,
      })
      setProfile(updated)
      addToast('Personal details updated', 'success')
    } catch (e: any) {
      const m = e?.response?.data?.message ?? 'Could not update personal details'
      addToast(Array.isArray(m) ? m.join(', ') : m, 'error')
    } finally {
      setSavingPersonal(false)
    }
  }

  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canChangePassword =
    newPassword.length >= MIN_PASSWORD && newPassword === confirmPassword && !savingPassword

  async function savePassword() {
    if (!canChangePassword) return
    setSavingPassword(true)
    try {
      await changePassword(newPassword)
      setNewPassword('')
      setConfirmPassword('')
      setShowNew(false)
      setShowConfirm(false)
      addToast('Password changed', 'success')
    } catch (e: any) {
      const m = e?.response?.data?.message ?? 'Could not change your password'
      addToast(Array.isArray(m) ? m.join(', ') : m, 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  // Hold the spinner while a ?tab=leave link waits on the entitlement answer, so the
  // page doesn't paint the Profile tab and then jump to Leave.
  if (loading || (wantsLeave && entLoading)) return <PageSpinner />

  const name = profile?.user?.name ?? user?.name ?? ''
  const email = profile?.user?.email ?? user?.email ?? ''
  const role = profile?.role
  const kraItems = normalizeKra(role?.kra)
  const isActive = profile ? profile.status === 'active' : true

  return (
    <div className="space-y-6">
      {/* Profile header — mirrors the employee-detail page */}
      <div className="bg-surface border border-border-light rounded-xl shadow-card p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className={`w-20 h-20 rounded-full ${avatarColor(name)} flex items-center justify-center text-primary-foreground text-page-title font-medium shrink-0`}>
            {getInitials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[28px] font-medium text-text-primary leading-tight">{name || 'My Profile'}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {role?.title && <span className="text-body text-text-secondary font-medium">{role.title}</span>}
              {profile?.department?.name && (
                <>
                  <span className="text-muted">·</span>
                  <span className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-meta font-medium bg-primary-subtle text-primary-text">
                    {profile.department.name}
                  </span>
                </>
              )}
              {profile && <StatusBadge active={isActive} />}
            </div>
            {email && <p className="text-body text-text-secondary mt-1">{email}</p>}
          </div>
        </div>
      </div>

      {leaveAvailable && <ProfileTabs active={tab} onChange={selectTab} />}

      {tab === 'leave' ? (
        <MyLeavePanel readOnly={leaveState === 'preview'} />
      ) : (
      <>
      {/* Work details — read only (managed by the administrator) */}
      {profile && (
        <Section title="Work details" subtitle="Managed by your administrator">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <InfoCell label="Employee Code" value={profile.employee_code} />
            <InfoCell label="Role" value={role?.title} />
            <InfoCell label="Department" value={profile.department?.name} />
            <InfoCell label="Employment Type" value={employmentLabel[profile.employment_type] ?? profile.employment_type} />
            <InfoCell label="Date of Joining" value={formatDate(profile.date_of_joining)} />
            <InfoCell label="Date of Birth" value={formatDate(profile.date_of_birth)} />
            <InfoCell label="Marriage Date" value={formatDate(profile.marriage_date)} />
            <InfoCell label="Status" value={<StatusBadge active={isActive} />} />
          </div>
        </Section>
      )}

      {/* Reports To — direct manager */}
      {profile?.reporting_to && (
        <Section title="Reports to">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${avatarColor(profile.reporting_to.name)} flex items-center justify-center text-primary-foreground text-body font-medium shrink-0`}>
              {getInitials(profile.reporting_to.name)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-text-primary text-body truncate">{profile.reporting_to.name}</p>
              {profile.reporting_to.email && <p className="text-meta text-text-secondary truncate">{profile.reporting_to.email}</p>}
            </div>
          </div>
        </Section>
      )}

      {/* Reporting chain — up the hierarchy */}
      {profile?.reporting_to_user_id && (
        <Section title="Reporting chain">
          <ReportingChain me={profile} allEmployees={allEmployees} />
        </Section>
      )}

      {/* Role — title, level, full job description */}
      {role && (
        <Section title="Role" subtitle="Defined by your role">
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <h3 className="font-medium text-text-primary">{role.title}</h3>
            {role.level && (
              <span className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-meta font-medium bg-primary-subtle text-primary-text">
                {roleLevelLabel[role.level] ?? role.level}
              </span>
            )}
          </div>
          {role.job_description
            ? <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">{role.job_description}</p>
            : <p className="text-body text-text-muted italic">No job description set for this role.</p>}
        </Section>
      )}

      {/* Key result areas */}
      {kraItems.length > 0 && (
        <Section title="Key result areas">
          <ol className="space-y-3">
            {kraItems.map((k, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary-subtle flex items-center justify-center text-meta font-medium text-primary-text">{i + 1}</span>
                <div>
                  <p className="text-body font-medium text-text-primary">{k.title}</p>
                  {k.description && <p className="text-[13px] text-text-secondary mt-0.5 whitespace-pre-wrap">{k.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Key performance indicators */}
      {role?.kpi && role.kpi.length > 0 && (
        <Section title="Key performance indicators">
          <ResponsiveTable
            className="border-0! rounded-none! shadow-none! bg-transparent! overflow-visible!"
            columns={kpiColumns}
            rows={role.kpi}
            rowKey={(_k, i) => String(i)}
          />
        </Section>
      )}

      {/* Personal details — editable (only when the user has an employee profile) */}
      {profile && (
        <Section title="Personal details" subtitle="Only you can edit these">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-body font-medium text-text-secondary mb-1.5">Date of birth</label>
              <DatePicker value={dob} onChange={setDob} max={new Date().toISOString().slice(0, 10)} placeholder="Select date" />
            </div>
            <div>
              <label className="block text-body font-medium text-text-secondary mb-1.5">Marriage date</label>
              <DatePicker value={marriage} onChange={setMarriage} max={new Date().toISOString().slice(0, 10)} placeholder="Select date" />
            </div>
          </div>
          <button
            type="button"
            onClick={savePersonal}
            disabled={savingPersonal}
            className="mt-4 flex items-center gap-2 px-4 py-[10px] text-body font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
          >
            {savingPersonal ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {savingPersonal ? 'Saving…' : 'Save personal details'}
          </button>
        </Section>
      )}

      {/* Change password — direct, no current password / OTP */}
      <Section title="Change password">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-body font-medium text-text-secondary mb-1.5">New password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className={`w-full px-3 py-2 pr-8 text-body rounded-lg border ${passwordTooShort ? 'border-danger' : 'border-border'} focus:border-primary focus:outline-hidden bg-surface text-text-primary placeholder:text-text-muted`}
              />
              <button type="button" onClick={() => setShowNew((v) => !v)} aria-label={showNew ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordTooShort && <p className="text-meta text-danger mt-1">Use at least {MIN_PASSWORD} characters.</p>}
          </div>
          <div>
            <label className="block text-body font-medium text-text-secondary mb-1.5">Confirm new password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter the new password"
                autoComplete="new-password"
                className={`w-full px-3 py-2 pr-8 text-body rounded-lg border ${passwordMismatch ? 'border-danger' : 'border-border'} focus:border-primary focus:outline-hidden bg-surface text-text-primary placeholder:text-text-muted`}
              />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordMismatch && <p className="text-meta text-danger mt-1">Passwords don&apos;t match.</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={savePassword}
          disabled={!canChangePassword}
          className="mt-4 flex items-center gap-2 px-4 py-[10px] text-body font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
        >
          {savingPassword ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
          {savingPassword ? 'Updating…' : 'Update password'}
        </button>
      </Section>
      </>
      )}
    </div>
  )
}

/**
 * KRA on the role is stored as free-form JSON. Normalize to a {title, description}[]
 * so legacy shapes (plain strings, or a single free-text blob) still render.
 */
function normalizeKra(kra: unknown): KraItem[] {
  if (!kra) return []
  if (Array.isArray(kra)) {
    return kra
      .map((item): KraItem | null => {
        if (typeof item === 'string') return item.trim() ? { title: item.trim(), description: '' } : null
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          const title = typeof o.title === 'string' ? o.title : ''
          const description = typeof o.description === 'string' ? o.description : ''
          return title || description ? { title: title || description, description: title ? description : '' } : null
        }
        return null
      })
      .filter((x): x is KraItem => x !== null)
  }
  if (typeof kra === 'string' && kra.trim()) return [{ title: kra.trim(), description: '' }]
  return []
}
