'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { formatDate as kitFormatDate } from '@/lib/format'
import { usePermissions } from '@/lib/auth/use-permissions'
import { getEmployee, getEmployees, updateEmployee, updateEmployeeStatus, deleteEmployee, checkAccount, asDeleteBlocked, type DeleteBlockedError } from '@/lib/api/employees'
import { updateUser } from '@/lib/api/users'
import { listSystemRoles, type SystemRoleLite } from '@/lib/api/permissions'
import { getRoles } from '@/lib/api/roles'
import { getDepartments } from '@/lib/api/departments'
import Button from '@/components/ui/button'
import StyledSelect from '@/components/ui/StyledSelect'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import EmployeePermissionsPanel from '@/components/permissions/EmployeePermissionsPanel'
import type { EmployeeProfile, EmployeeStatus, Role, Department } from '@/lib/types'
import { ArrowLeft, Users, ChevronDown, Pencil, Loader2, X, Eye, EyeOff, Trash2 } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import DatePicker from '@/components/ui/DatePicker'
import { Label } from '@/components/ui/label'

type Kpi = NonNullable<Role['kpi']>[number]

const kpiColumns: ResponsiveColumn<Kpi>[] = [
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'px-0! py-3! pr-4! font-medium text-text-primary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.title,
  },
  {
    key: 'metric',
    header: 'Metric',
    cellClassName: 'px-0! py-3! pr-4! text-text-secondary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.metric,
  },
  {
    key: 'target',
    header: 'Target',
    cellClassName: 'px-0! py-3! pr-4! text-text-secondary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.target,
  },
  {
    key: 'unit',
    header: 'Unit',
    cellClassName: 'px-0! py-3! text-text-secondary',
    headerClassName: 'px-0! py-2.5!',
    render: (kpi) => kpi.unit,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const avatarColors = [
  'bg-primary', 'bg-text-secondary', 'bg-success',
  'bg-warning', 'bg-danger', 'bg-text-secondary', 'bg-text-secondary',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return avatarColors[hash % avatarColors.length]
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  try {
    return kitFormatDate(new Date(dateStr))
  } catch { return dateStr }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const statusConfig: Record<EmployeeStatus, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-success-bg', text: 'text-success', label: 'Active' },
  inactive: { bg: 'bg-danger-bg', text: 'text-danger', label: 'Inactive' },
}

function StatusBadge({ status }: { status: EmployeeStatus }) {
  const cfg = statusConfig[status] ?? statusConfig.inactive
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-meta font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-meta font-medium text-text-secondary uppercase tracking-wider mb-1">{label}</p>
      <p className="text-body text-text-primary font-medium">{value ?? '—'}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <h2 className="text-card-heading font-medium text-text-primary mb-4 pb-3 border-b border-border-light">{title}</h2>
      {children}
    </div>
  )
}

function ReportingChain({ emp, allEmployees }: { emp: EmployeeProfile; allEmployees: EmployeeProfile[] }) {
  const chain: EmployeeProfile[] = []
  let current = emp
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
        const name = mgr.user?.name ?? 'Unknown'
        return (
          <div key={mgr.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-meta font-medium shrink-0`}>
                {getInitials(name)}
              </div>
              {i < chain.length - 1 && <div className="w-px h-4 bg-surface-control-pressed mt-1" />}
            </div>
            <div className="pt-1">
              <Link href={`/settings/organization/employees/${mgr.id}`} className="text-body font-medium text-text-primary hover:text-primary-text transition-colors">
                {name}
              </Link>
              <p className="text-meta text-text-secondary">{mgr.role?.title ?? 'N/A'}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  employee: EmployeeProfile
  allEmployees: EmployeeProfile[]
  roles: Role[]
  departments: Department[]
  onClose: () => void
  onSaved: (updated: EmployeeProfile) => void
  onDeleted: () => void
}

function EditModal({ employee, allEmployees, roles, departments, onClose, onSaved, onDeleted }: EditModalProps) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [form, setForm] = useState({
    name: employee.user?.name ?? '',
    email: employee.user?.email ?? '',
    phone: employee.user?.phone ?? '',
    country_code: employee.user?.country_code || DEFAULT_COUNTRY,
    password: '',
    role_id: employee.role_id,
    system_role_id: employee.system_role_id ?? employee.system_role?.id ?? '',
    department_id: employee.department_id,
    reporting_to_user_id: employee.reporting_to_user_id ?? '',
    employment_type: employee.employment_type,
    status: employee.status,
    employee_code: employee.employee_code ?? '',
    date_of_joining: employee.date_of_joining ? employee.date_of_joining.slice(0, 10) : '',
    date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : '',
    marriage_date: employee.marriage_date ? employee.marriage_date.slice(0, 10) : '',
  })
  const isPrimaryAdmin = employee.system_role?.is_admin && !allEmployees.some(
    (e) => e.system_role?.is_admin && e.created_at && new Date(e.created_at) < new Date(employee.created_at)
  )
  const isSelf = employee.user_id === user?.id

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Set when the server refuses the delete over dangling reporting lines /
  // headships. It's the admin's call, so we show exactly what's in the way and
  // offer to clear it — rather than sending them off to fix it elsewhere.
  const [deleteBlocked, setDeleteBlocked] = useState<DeleteBlockedError | null>(null)
  // A password reset changes this person's ONE global login — used everywhere they
  // work. We warn before saving, sized to how many orgs they belong to.
  const [showPwWarning, setShowPwWarning] = useState(false)
  const [orgCount, setOrgCount] = useState<number | null>(null)
  useEffect(() => {
    const email = employee.user?.email
    if (!orgId || !email) return
    checkAccount(orgId, email).then((r) => setOrgCount(r.org_count ?? null)).catch(() => {})
  }, [orgId, employee.user?.email])

  // System roles carry access rights — required, and editable here just like on
  // the Add Employee form so the two stay consistent.
  const [systemRoles, setSystemRoles] = useState<SystemRoleLite[]>([])
  useEffect(() => {
    if (!orgId) return
    listSystemRoles(orgId)
      .then(({ systemRoles }) => setSystemRoles(systemRoles))
      .catch(() => setSystemRoles([]))
  }, [orgId])

  // Job roles are scoped to the chosen department — mirror the Add form.
  const deptRoles = roles.filter((r) => r.department_id === form.department_id)

  // Portal-safe mount + lock background scroll while open.
  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const expectedDigits = nationalDigitsFor(form.country_code)
  const phoneDigits = form.phone.replace(/\D/g, '')

  function handleSave() {
    setError('')

    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    // Email OR phone — at least one identity is required (phone can be cleared as
    // long as an email remains, so a wrong number can be removed).
    if (!form.email.trim() && !phoneDigits) {
      setError('Enter an email address or a phone number (at least one).')
      return
    }
    if (phoneDigits && phoneDigits.length !== expectedDigits) {
      setError(`Enter a ${expectedDigits}-digit number for ${form.country_code}.`)
      return
    }
    if (form.password && form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!form.system_role_id) {
      setError('Please select a system role.')
      return
    }
    if (!form.role_id) {
      setError('Please select a job role.')
      return
    }

    // Changing the password touches their ONE global login — confirm first (loudly
    // if they belong to more than one firm).
    if (form.password) {
      setShowPwWarning(true)
      return
    }
    doSave()
  }

  async function doSave() {
    setShowPwWarning(false)
    setError('')
    setSaving(true)
    try {
      // 1) User-level fields (name / email / phone / password) — only what changed.
      const userChanges: Record<string, string> = {}
      if (form.name.trim() !== (employee.user?.name ?? '')) userChanges.name = form.name.trim()
      if (form.email.trim() !== (employee.user?.email ?? '')) userChanges.email = form.email.trim()
      // Phone identity: send the pair when the number OR country changed. An empty
      // number clears it (both fields sent so the backend clears them together).
      const oldPhone = employee.user?.phone ?? ''
      const oldCountry = employee.user?.country_code ?? ''
      const phoneChanged = phoneDigits !== oldPhone || (!!phoneDigits && form.country_code !== oldCountry)
      if (phoneChanged) {
        userChanges.phone = phoneDigits
        userChanges.country_code = phoneDigits ? form.country_code : ''
      }
      if (form.password) userChanges.password = form.password
      if (Object.keys(userChanges).length > 0 && employee.user_id) {
        await updateUser(orgId, employee.user_id, userChanges)
      }

      // 2) Profile fields (system role, job role, department, etc.).
      const payload: any = {
        role_id: form.role_id,
        system_role_id: form.system_role_id,
        department_id: form.department_id,
        employment_type: form.employment_type,
      }
      if (form.reporting_to_user_id) payload.reporting_to_user_id = form.reporting_to_user_id
      if (form.employee_code) payload.employee_code = form.employee_code
      if (form.date_of_joining) payload.date_of_joining = form.date_of_joining
      if (form.date_of_birth) payload.date_of_birth = form.date_of_birth
      if (form.marriage_date) payload.marriage_date = form.marriage_date

      let updated = await updateEmployee(orgId, employee.id, payload)

      // 3) Status is a dedicated, guarded endpoint — only call it if it changed.
      if (form.status !== employee.status) {
        updated = await updateEmployeeStatus(orgId, employee.id, form.status)
      }

      onSaved(updated)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(detach = false) {
    setError('')
    setDeleting(true)
    try {
      await deleteEmployee(orgId, employee.id, { detach })
      onDeleted()
    } catch (err: any) {
      const blocked = asDeleteBlocked(err)
      if (blocked) {
        // Overrulable: keep the confirm open and show the override instead.
        setDeleteBlocked(blocked)
      } else {
        // Everything else (self, primary admin, real records) is final — surface
        // the server's plain-language reason and let the user pick another path.
        setError(err?.response?.data?.message ?? 'Failed to delete employee.')
        setConfirmDelete(false)
      }
    } finally {
      setDeleting(false)
    }
  }

  const inputClass = 'w-full px-3 py-2.5 border border-border rounded-lg text-body text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
  const selectClass = inputClass
  const labelClass = 'block text-body font-medium text-text-secondary mb-1.5'

  const otherEmployees = allEmployees.filter((e) => e.id !== employee.id)

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-center justify-center px-4 py-4 bg-backdrop">
      <div className="bg-surface rounded-[16px] w-full max-w-lg shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light shrink-0">
          <h2 className="text-section font-medium text-text-primary">Edit Employee</h2>
          <button onClick={onClose} className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-control rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 flex flex-col gap-4 flex-1 min-h-0">
          {error && (
            <div className="text-body text-danger bg-danger-bg border border-danger-border rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Cross-firm notice — this person's login is shared across firms. */}
          {orgCount !== null && orgCount > 1 && (
            <div className="flex items-start gap-2 rounded-lg bg-warning-bg border border-warning-border px-4 py-3 text-body text-warning">
              <Users size={16} className="shrink-0 mt-0.5" />
              <p>
                This person also works in {orgCount - 1} other {orgCount - 1 === 1 ? 'firm' : 'firms'}.
                Changing their email or phone changes how they sign in <strong>everywhere</strong>.
              </p>
            </div>
          )}

          {/* Identity — name / email / password reset */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2">Full name</Label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Jane Doe"
                className={inputClass}
              />
            </div>
            <div>
              <Label className="mb-2">Email</Label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="jane@company.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Phone — a login identity. Editable here so a wrong number can be fixed
              or removed; clearing it removes phone sign-in (email still works). */}
          <div>
            <Label className="mb-2">Phone number <span className="font-normal text-text-muted">— used to sign in</span></Label>
            <div className="flex gap-2">
              <CountryCodeSelect
                value={form.country_code}
                onChange={(code) => {
                  set('country_code', code)
                  set('phone', cleanNationalNumber(form.phone, code))
                }}
                wrapperClassName="w-[120px] shrink-0"
              />
              <input
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => set('phone', cleanNationalNumber(e.target.value, form.country_code))}
                maxLength={expectedDigits}
                placeholder={`${expectedDigits}-digit number`}
                className={`${inputClass} flex-1`}
              />
            </div>
            <p className="mt-1 text-meta text-text-muted">
              They can sign in with this number. Leave it empty to remove phone sign-in. Changing it updates their login everywhere they work.
            </p>
          </div>

          <div>
            <Label className="mb-2">Reset password</Label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Leave blank to keep current password"
                className={`${inputClass} pr-8`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Department */}
            <div>
              <Label className="mb-2">Department</Label>
              <StyledSelect
                value={form.department_id}
                onChange={(v) => setForm((f) => ({ ...f, department_id: v, role_id: '' }))}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
            </div>

            {/* Job Role — scoped to the selected department */}
            <div>
              <Label className="mb-2">Job Role</Label>
              <StyledSelect
                value={form.role_id}
                onChange={(v) => set('role_id', v)}
                options={[
                  { value: '', label: '— Select —' },
                  ...deptRoles.map((r) => ({ value: r.id, label: r.title })),
                ]}
              />
            </div>

            {/* System Role — access-rights bundle (required). StyledSelect (not a native
                <select>) so it can't be silently scroll-changed to another role. */}
            <div>
              <Label className="mb-2">System Role</Label>
              <StyledSelect
                value={form.system_role_id}
                onChange={(v) => set('system_role_id', v)}
                placeholder="— Select —"
                options={[
                  { value: '', label: '— Select —' },
                  ...systemRoles.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </div>

            {/* Employment Type */}
            <div>
              <Label className="mb-2">Employment Type</Label>
              <StyledSelect
                value={form.employment_type}
                onChange={(v) => set('employment_type', v)}
                options={[
                  { value: 'full_time', label: 'Full Time' },
                  { value: 'part_time', label: 'Part Time' },
                  { value: 'contract', label: 'Contract' },
                ]}
              />
            </div>

            {/* Status */}
            <div>
              <Label className="mb-2">Status</Label>
              <StyledSelect
                value={form.status}
                onChange={(v) => set('status', v)}
                disabled={isPrimaryAdmin || isSelf}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
              />
              {(isPrimaryAdmin || isSelf) && (
                <p className="text-meta text-text-muted mt-1">
                  {isPrimaryAdmin ? 'Primary administrator cannot be deactivated.' : 'You cannot deactivate your own account.'}
                </p>
              )}
            </div>

            {/* Employee Code */}
            <div>
              <Label className="mb-2">Employee Code</Label>
              <input
                type="text"
                value={form.employee_code}
                onChange={(e) => set('employee_code', e.target.value)}
                placeholder="e.g. EMP001"
                className={selectClass}
              />
            </div>

            {/* Date of Joining */}
            <div>
              <Label className="mb-2">Date of Joining</Label>
              <DatePicker
                value={form.date_of_joining}
                onChange={(iso) => set('date_of_joining', iso)}
                placeholder="Select date"
              />
            </div>

            {/* Date of Birth */}
            <div>
              <Label className="mb-2">Date of Birth</Label>
              <DatePicker
                value={form.date_of_birth}
                onChange={(iso) => set('date_of_birth', iso)}
                placeholder="Select date"
              />
            </div>

            {/* Marriage Date */}
            <div>
              <Label className="mb-2">Marriage Date</Label>
              <DatePicker
                value={form.marriage_date}
                onChange={(iso) => set('marriage_date', iso)}
                placeholder="Select date"
              />
            </div>
          </div>

          {/* Reporting To */}
          <div>
            <Label className="mb-2">Reports To</Label>
            <StyledSelect
              value={form.reporting_to_user_id}
              onChange={(v) => set('reporting_to_user_id', v)}
              options={[
                { value: '', label: '— None —' },
                ...otherEmployees.map((e) => ({ value: e.user_id, label: `${e.user?.name} (${e.role?.title ?? 'N/A'})` })),
              ]}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-3 px-6 py-4 border-t border-border-light shrink-0">
          {confirmDelete ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg p-3">
              {deleteBlocked ? (
                <>
                  <p className="text-body text-danger mb-2.5">
                    Deleting <span className="font-medium">{employee.user?.name}</span> would
                    leave these behind. You can clear them and delete anyway — both are allowed
                    states, and you can set them again later.
                  </p>
                  <div className="flex flex-col gap-2 mb-3">
                    {deleteBlocked.blockers.reports.length > 0 && (
                      <div className="rounded-md bg-surface border border-danger-border px-3 py-2">
                        <p className="text-meta font-medium text-danger uppercase tracking-wide mb-1">
                          Left without a manager
                        </p>
                        <p className="text-body text-danger">
                          {deleteBlocked.blockers.reports.map((r) => r.name).join(', ')}
                        </p>
                      </div>
                    )}
                    {deleteBlocked.blockers.departments.length > 0 && (
                      <div className="rounded-md bg-surface border border-danger-border px-3 py-2">
                        <p className="text-meta font-medium text-danger uppercase tracking-wide mb-1">
                          Left without a head
                        </p>
                        <p className="text-body text-danger">
                          {deleteBlocked.blockers.departments.map((d) => d.name).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(true)}
                      disabled={deleting}
                      className="flex items-center gap-1.5 px-4 py-2 text-body font-medium text-on-danger bg-danger hover:bg-danger-hover rounded-lg transition-colors disabled:opacity-60"
                    >
                      {deleting && <Loader2 size={14} className="animate-spin" />}
                      Clear links and delete
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(false); setDeleteBlocked(null) }}
                      disabled={deleting}
                      className="px-4 py-2 text-body font-medium text-text-secondary bg-surface border border-border-light rounded-lg hover:bg-surface-sunken transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-body text-danger mb-2.5">
                    Delete <span className="font-medium">{employee.user?.name}</span> permanently?
                    This removes them from the organization and can’t be undone. If they have any
                    history, use <span className="font-medium">Inactive</span> instead.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete()}
                      disabled={deleting}
                      className="flex items-center gap-1.5 px-4 py-2 text-body font-medium text-on-danger bg-danger hover:bg-danger-hover rounded-lg transition-colors disabled:opacity-60"
                    >
                      {deleting && <Loader2 size={14} className="animate-spin" />}
                      Delete employee
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="px-4 py-2 text-body font-medium text-text-secondary bg-surface border border-border-light rounded-lg hover:bg-surface-sunken transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              {/* Danger action — hidden for yourself and the primary admin (both
                  are protected server-side too). */}
              {!isSelf && !isPrimaryAdmin ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-body font-medium text-danger hover:text-danger transition-colors"
                >
                  <Trash2 size={15} /> Delete
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Password-change warning — a shared login is one password across all firms */}
      {showPwWarning && (
        <div className="fixed inset-0 z-70 flex items-center justify-center px-4 bg-backdrop">
          <div className="bg-surface w-full max-w-md rounded-card shadow-xl p-6">
            <h3 className="text-card-heading font-medium text-text-primary">
              Change {employee.user?.name ?? 'this person'}’s password?
            </h3>
            <p className="mt-2 text-body text-text-secondary leading-relaxed">
              {orgCount && orgCount > 1 ? (
                <>
                  This is their <strong>one login password</strong> for{' '}
                  <strong>all {orgCount} organizations</strong> they belong to — not just this
                  firm. The new password will replace their current one{' '}
                  <strong>everywhere they log in</strong>. Make sure to share it with them.
                </>
              ) : (
                <>
                  This changes {employee.user?.name ?? 'their'} login password. They’ll need the
                  new password the next time they sign in — make sure to share it with them.
                </>
              )}
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPwWarning(false)}
                className="px-4 py-2 text-body font-medium text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:bg-surface-control-pressed disabled:text-text-muted"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {orgCount && orgCount > 1 ? 'Change password everywhere' : 'Change password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const employeeId = params?.employeeId as string
  // This page is mounted under two prefixes (/dashboard/employees/:id and
  // /settings/organization/employees/:id — the latter re-exports it), so the
  // list to return to is simply this URL minus the id. Hard-coding one prefix
  // would throw the user into the other section.
  const employeesListHref = pathname?.replace(/\/[^/]+$/, '') || '/settings/organization/employees'
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { isAdmin } = usePermissions()

  const [employee, setEmployee] = useState<EmployeeProfile | null>(null)
  const [allEmployees, setAllEmployees] = useState<EmployeeProfile[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => {
    if (!orgId || !employeeId) { setLoading(false); return }
    Promise.all([
      getEmployee(orgId, employeeId).catch(() => null),
      getEmployees(orgId).catch(() => []),
      getRoles(orgId).catch(() => []),
      getDepartments(orgId).catch(() => []),
    ]).then(([empData, allEmps, rolesData, deptsData]) => {
      if (!empData) { setError(true) } else { setEmployee(empData) }
      setAllEmployees(allEmps)
      setRoles(rolesData)
      setDepartments(deptsData)
    }).finally(() => setLoading(false))
  }, [orgId, employeeId])

  const isHR = !!user?.is_admin

  // Return to wherever the user came from — the department structure panel, the
  // employees tree/table view, a reporting chain, etc. — rather than always the
  // flat employees list. Falls back to that list only on a direct load (no
  // in-app history to step back into).
  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(employeesListHref)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users size={36} className="text-text-muted mb-3" />
        <p className="text-section font-medium text-text-primary">Employee not found</p>
        <Link href="/settings/organization/employees" className="mt-4">
          <Button variant="secondary" size="sm"><ArrowLeft size={14} /> Back to employees</Button>
        </Link>
      </div>
    )
  }

  const name = employee.user?.name ?? 'Unknown'
  const email = employee.user?.email ?? ''
  const employmentTypeLabels: Record<string, string> = {
    full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract',
  }
  const jdPreview = employee.role?.job_description
    ? employee.role.job_description.slice(0, 200) + (employee.role.job_description.length > 200 ? '…' : '')
    : null

  return (
    <div className="space-y-6 max-w-6xl">
      <button onClick={handleBack} className="inline-flex items-center gap-1.5 text-body text-text-secondary hover:text-text-primary transition-colors">
        <ArrowLeft size={15} />
        Back
      </button>

      {/* Profile header */}
      <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className={`w-20 h-20 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-page-title font-medium shrink-0`}>
            {getInitials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-page-title font-medium text-text-primary leading-tight">{name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {employee.role?.title && <span className="text-body text-text-secondary font-medium">{employee.role.title}</span>}
              {employee.department?.name && (
                <>
                  <span className="text-text-muted">·</span>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium bg-primary-subtle text-primary-text">
                    {employee.department.name}
                  </span>
                </>
              )}
              <StatusBadge status={employee.status} />
            </div>
            {email && <p className="text-body text-text-secondary mt-1">{email}</p>}
          </div>
          {isHR && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-body font-medium text-text-secondary bg-surface border border-border-light rounded-lg hover:border-primary hover:text-primary-text transition-colors shrink-0"
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <Section title="Employment Details">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <InfoCell label="Employee Code" value={employee.employee_code} />
          <InfoCell label="Date of Joining" value={formatDate(employee.date_of_joining)} />
          <InfoCell label="Employment Type" value={employmentTypeLabels[employee.employment_type] ?? employee.employment_type} />
          <InfoCell label="Status" value={<StatusBadge status={employee.status} />} />
          {employee.date_of_birth && <InfoCell label="Date of Birth" value={formatDate(employee.date_of_birth)} />}
          {employee.marriage_date && <InfoCell label="Marriage Date" value={formatDate(employee.marriage_date)} />}
        </div>
      </Section>

      {employee.reporting_to && (
        <Section title="Reports To">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${avatarColor(employee.reporting_to.name)} flex items-center justify-center text-white text-body font-medium shrink-0`}>
              {getInitials(employee.reporting_to.name)}
            </div>
            <div>
              <p className="font-medium text-text-primary text-body">{employee.reporting_to.name}</p>
              <p className="text-meta text-text-secondary">{employee.reporting_to.email}</p>
            </div>
          </div>
        </Section>
      )}

      <Section title="Reporting Chain">
        <ReportingChain emp={employee} allEmployees={allEmployees} />
      </Section>

      {employee.role && (
        <Section title="Role">
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-medium text-text-primary">{employee.role.title}</h3>
              {employee.role.level && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium bg-primary-subtle text-primary-text">
                  {employee.role.level.charAt(0).toUpperCase() + employee.role.level.slice(1)}
                </span>
              )}
            </div>
            {jdPreview && <p className="text-body text-text-secondary leading-relaxed">{jdPreview}</p>}
            <Link href={`/settings/organization/roles/${employee.role_id}`} className="inline-flex items-center gap-1.5 text-meta font-medium text-primary-text hover:text-primary-text transition-colors">
              View full role
              <ChevronDown size={12} className="-rotate-90" />
            </Link>
          </div>
        </Section>
      )}

      {employee.role?.kra && employee.role.kra.length > 0 && (
        <Section title="Key Result Areas">
          <ol className="space-y-3">
            {employee.role.kra.map((kra, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary-subtle flex items-center justify-center text-meta font-medium text-primary-text">{i + 1}</span>
                <div>
                  <p className="font-medium text-text-primary text-body">{kra.title}</p>
                  {kra.description && <p className="text-meta text-text-secondary mt-0.5 leading-relaxed">{kra.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {employee.role?.kpi && employee.role.kpi.length > 0 && (
        <Section title="Key Performance Indicators">
          <ResponsiveTable
            className="border-0! rounded-none! shadow-none! bg-transparent! overflow-visible!"
            columns={kpiColumns}
            rows={employee.role.kpi}
            rowKey={(_kpi, i) => String(i)}
          />
        </Section>
      )}

      {/* Access & Permissions — admin only */}
      {isAdmin && employee.user_id && (
        <EmployeePermissionsPanel orgId={orgId} userId={employee.user_id} />
      )}

      {/* Edit Modal */}
      {showEdit && (
        <EditModal
          employee={employee}
          allEmployees={allEmployees}
          roles={roles}
          departments={departments}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setEmployee(updated)
            setShowEdit(false)
          }}
          onDeleted={() => {
            // Leave the modal mounted and let the navigation unmount it. Closing it
            // here would unmount the component that started the navigation, which
            // can cancel it and strand the user on the page of a record that no
            // longer exists. `replace`, not `push`: this URL is now dead, so it must
            // not stay in history for Back to land on. `refresh` drops the cached
            // list so the deleted person is gone from it.
            router.replace(employeesListHref)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
