'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'
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
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shell/page-header'
import StyledSelect from '@/components/ui/StyledSelect'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import EmployeePermissionsPanel from '@/components/permissions/EmployeePermissionsPanel'
import type { EmployeeProfile, EmployeeStatus, Role, Department } from '@/lib/types'
import { ArrowLeft, Users, ChevronDown, Pencil, Eye, EyeOff, Trash2 } from 'lucide-react'
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
      <p className="text-meta font-medium text-text-secondary mb-1">{label}</p>
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
              <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
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
  const [initialForm] = useState(form)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'contact' | 'password' | 'systemRole' | 'role', string>>>({})
  const clearErr = (k: 'name' | 'contact' | 'password' | 'systemRole' | 'role') => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))
  const guarded = useGuardedClose({ open: true, values: form, saved: initialForm, noun: 'employee', mode: 'edit', onClose })
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

    // Field errors sit under the field that is wrong; focus goes to the first one (kit 11.3, 39.3).
    const errs: Partial<Record<'name' | 'contact' | 'password' | 'systemRole' | 'role', string>> = {}
    if (!form.name.trim()) errs.name = 'Enter the full name of the employee.'
    // Email OR phone — at least one identity is required (phone can be cleared as
    // long as an email remains, so a wrong number can be removed).
    if (!form.email.trim() && !phoneDigits) errs.contact = 'Enter an email address or a phone number. At least one is needed.'
    else if (phoneDigits && phoneDigits.length !== expectedDigits) errs.contact = `Enter a ${expectedDigits}-digit number for ${form.country_code}.`
    if (form.password && form.password.length < 8) errs.password = 'Use at least 8 characters in the password.'
    if (!form.system_role_id) errs.systemRole = 'Choose a system role.'
    if (!form.role_id) errs.role = 'Choose a job role.'
    setFieldErrors(errs)
    const order = ['name', 'contact', 'password', 'systemRole', 'role'] as const
    const firstBad = order.find((k) => errs[k])
    if (firstBad) {
      requestAnimationFrame(() => {
        const el = document.getElementById(`edit-employee-${firstBad}`)
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
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

  return (
    <>
      {guarded.warning}
      <Modal isOpen onClose={guarded.requestClose} title="Edit employee" size="lg">
        <div className="flex flex-col gap-4">

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
              <Label className="mb-2" htmlFor="edit-employee-name" required>Full name</Label>
              <input
                id="edit-employee-name"
                type="text"
                value={form.name}
                onChange={(e) => { set('name', e.target.value); clearErr('name') }}
                placeholder="For example, Jane Doe"
                aria-invalid={fieldErrors.name ? true : undefined}
                className={`${inputClass} aria-invalid:border-danger`}
              />
              <InlineFieldError>{fieldErrors.name}</InlineFieldError>
            </div>
            <div>
              <Label className="mb-2" htmlFor="edit-employee-contact">Email</Label>
              <input
                id="edit-employee-contact"
                type="email"
                value={form.email}
                onChange={(e) => { set('email', e.target.value); clearErr('contact') }}
                placeholder="For example, jane@company.com"
                aria-invalid={fieldErrors.contact ? true : undefined}
                className={`${inputClass} aria-invalid:border-danger`}
              />
            </div>
          </div>

          {/* Phone — a login identity. Editable here so a wrong number can be fixed
              or removed; clearing it removes phone sign-in (email still works). */}
          <div>
            <Label className="mb-2">Phone number</Label>
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
                onChange={(e) => { set('phone', cleanNationalNumber(e.target.value, form.country_code)); clearErr('contact') }}
                maxLength={expectedDigits}
                placeholder={`${expectedDigits}-digit number`}
                className={`${inputClass} flex-1`}
              />
            </div>
            <InlineFieldError>{fieldErrors.contact}</InlineFieldError>
            <p className="mt-1 text-meta text-text-muted">
              They can sign in with this number. Leave it empty to remove phone sign-in. Changing it updates their login everywhere they work.
            </p>
          </div>

          <div>
            <Label className="mb-2" htmlFor="edit-employee-password">Reset password</Label>
            <div className="relative">
              <input
                id="edit-employee-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => { set('password', e.target.value); clearErr('password') }}
                placeholder="Leave blank to keep the current password"
                aria-invalid={fieldErrors.password ? true : undefined}
                className={`${inputClass} pr-8 aria-invalid:border-danger`}
              />
              <Button
                type="button"
                variant="in-field"
                size="icon-sm"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
            <InlineFieldError>{fieldErrors.password}</InlineFieldError>
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
              <Label className="mb-2" required>Job role</Label>
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
              <Label className="mb-2" required>System role</Label>
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
              <Label className="mb-2">Employment type</Label>
              <StyledSelect
                value={form.employment_type}
                onChange={(v) => set('employment_type', v)}
                options={[
                  { value: 'full_time', label: 'Full time' },
                  { value: 'part_time', label: 'Part time' },
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
              <Label className="mb-2">Employee code</Label>
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
              <Label className="mb-2">Date of joining</Label>
              <DatePicker
                value={form.date_of_joining}
                onChange={(iso) => set('date_of_joining', iso)}
                placeholder="Select date"
              />
            </div>

            {/* Date of Birth */}
            <div>
              <Label className="mb-2">Date of birth</Label>
              <DatePicker
                value={form.date_of_birth}
                onChange={(iso) => set('date_of_birth', iso)}
                placeholder="Select date"
              />
            </div>

            {/* Marriage Date */}
            <div>
              <Label className="mb-2">Marriage date</Label>
              <DatePicker
                value={form.marriage_date}
                onChange={(iso) => set('marriage_date', iso)}
                placeholder="Select date"
              />
            </div>
          </div>

          {/* Reporting To */}
          <div>
            <Label className="mb-2">Reports to</Label>
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

        {error && <p role="alert" className="text-label text-danger">{error}</p>}

        {/* Footer */}
        <div className="flex flex-col gap-3 pt-4 border-t border-border-light shrink-0">
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
                        <p className="text-meta font-medium text-danger mb-1">
                          Left without a manager
                        </p>
                        <p className="text-body text-danger">
                          {deleteBlocked.blockers.reports.map((r) => r.name).join(', ')}
                        </p>
                      </div>
                    )}
                    {deleteBlocked.blockers.departments.length > 0 && (
                      <div className="rounded-md bg-surface border border-danger-border px-3 py-2">
                        <p className="text-meta font-medium text-danger mb-1">
                          Left without a head
                        </p>
                        <p className="text-body text-danger">
                          {deleteBlocked.blockers.departments.map((d) => d.name).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="danger" onClick={() => handleDelete(true)} loading={deleting} loadingLabel="Deleting">
                      Clear links and delete
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => { setConfirmDelete(false); setDeleteBlocked(null) }} disabled={deleting}>
                      Cancel
                    </Button>
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
                    <Button type="button" variant="danger" onClick={() => handleDelete()} loading={deleting} loadingLabel="Deleting">
                      Delete employee
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              {/* Danger action — hidden for yourself and the primary admin (both
                  are protected server-side too). */}
              {!isSelf && !isPrimaryAdmin ? (
                <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} /> Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
                <Button type="button" onClick={handleSave} disabled={saving} loading={saving} loadingLabel="Saving">
                  Save employee
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Password-change warning — a shared login is one password across all firms */}
      <AlertDialog open={showPwWarning} onOpenChange={(next) => { if (!next) setShowPwWarning(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change {employee.user?.name ?? 'this person'}’s password?</AlertDialogTitle>
            <AlertDialogDescription>
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
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doSave} disabled={saving}>
              {orgCount && orgCount > 1 ? 'Change password everywhere' : 'Change password'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
          <Button variant="secondary" size="sm"><ArrowLeft size={16} /> Back to employees</Button>
        </Link>
      </div>
    )
  }

  const name = employee.user?.name ?? 'Unknown'
  const email = employee.user?.email ?? ''
  const employmentTypeLabels: Record<string, string> = {
    full_time: 'Full time', part_time: 'Part time', contract: 'Contract',
  }
  const jdPreview = employee.role?.job_description
    ? employee.role.job_description.slice(0, 200) + (employee.role.job_description.length > 200 ? '…' : '')
    : null

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={name}
        trail={[{ label: 'Employees', href: employeesListHref }]}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {employee.role?.title && <span className="font-medium text-text-secondary">{employee.role.title}</span>}
            {employee.department?.name && <span>· {employee.department.name}</span>}
            {email && <span>· {email}</span>}
            <StatusBadge status={employee.status} />
          </span>
        }
        actions={
          isHR ? (
            <Button type="button" onClick={() => setShowEdit(true)}>
              <Pencil size={16} />
              Edit
            </Button>
          ) : undefined
        }
      />

      {/* Info grid */}
      <Section title="Employment details">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <InfoCell label="Employee code" value={employee.employee_code} />
          <InfoCell label="Date of joining" value={formatDate(employee.date_of_joining)} />
          <InfoCell label="Employment type" value={employmentTypeLabels[employee.employment_type] ?? employee.employment_type} />
          <InfoCell label="Status" value={<StatusBadge status={employee.status} />} />
          {employee.date_of_birth && <InfoCell label="Date of birth" value={formatDate(employee.date_of_birth)} />}
          {employee.marriage_date && <InfoCell label="Marriage date" value={formatDate(employee.marriage_date)} />}
        </div>
      </Section>

      {employee.reporting_to && (
        <Section title="Reports to">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${avatarColor(employee.reporting_to.name)} flex items-center justify-center text-primary-foreground text-body font-medium shrink-0`}>
              {getInitials(employee.reporting_to.name)}
            </div>
            <div>
              <p className="font-medium text-text-primary text-body">{employee.reporting_to.name}</p>
              <p className="text-meta text-text-secondary">{employee.reporting_to.email}</p>
            </div>
          </div>
        </Section>
      )}

      <Section title="Reporting chain">
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
        <Section title="Key result areas">
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
        <Section title="Key performance indicators">
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
