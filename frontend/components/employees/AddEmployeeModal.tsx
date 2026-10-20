'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Eye, EyeOff, Loader2, Plus } from 'lucide-react'
import { createEmployee, checkAccount, type AccountCheck } from '@/lib/api/employees'
import { getUsers } from '@/lib/api/users'
import { listSystemRoles, type SystemRoleLite } from '@/lib/api/permissions'
import { toast } from '@/components/ui/sonner'

import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import DeptFormDrawer from '@/components/org-chart/DeptFormDrawer'
import RoleFormDrawer from '@/components/roles/RoleFormDrawer'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import ReportsToSelect from './ReportsToSelect'
import DepartmentSelect from './DepartmentSelect'
import RoleSelect from './RoleSelect'
import type { Department, Role, User, EmployeeProfile, EmploymentType } from '@/lib/types'
import { Label } from '@/components/ui/label'

const STRUCTURE_LEAF = 'settings.organization.structure'

/**
 * Suggest the next employee code by incrementing the highest existing one,
 * preserving its prefix and zero-padding (e.g. EMP-056 → EMP-057, 56 → 57).
 * Returns '' when no numeric code exists yet.
 */
function suggestNextEmployeeCode(employees: EmployeeProfile[]): string {
  let best: { prefix: string; num: number; width: number } | null = null
  for (const e of employees) {
    const m = /^(.*?)(\d+)\s*$/.exec((e.employee_code ?? '').trim())
    if (!m) continue
    const num = parseInt(m[2], 10)
    if (!Number.isFinite(num)) continue
    if (!best || num > best.num) best = { prefix: m[1], num, width: m[2].length }
  }
  if (!best) return ''
  return best.prefix + String(best.num + 1).padStart(best.width, '0')
}

interface Props {
  orgId: string
  departments: Department[]
  roles: Role[]
  employees: EmployeeProfile[]
  prefillSelf?: boolean
  onClose: () => void
  onCreated: () => void
  /** A job role was created inline — bubble it up so the parent list stays fresh. */
  onRoleCreated?: (role: Role) => void
  /** A department was created inline — bubble it up so the parent list stays fresh. */
  onDeptCreated?: (dept: Department) => void
}

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
]

const inputClass =
  'w-full border border-border rounded-lg px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
const labelClass = 'block text-body font-medium text-text-secondary mb-1'

export default function AddEmployeeModal({
  orgId,
  departments,
  roles,
  employees,
  prefillSelf = false,
  onClose,
  onCreated,
  onRoleCreated,
  onDeptCreated,
}: Props) {
  const { user } = useAuth()
  const { can } = usePermissions()
  // Role create is @RequireAdmin; department create is the structure-write permission.
  const canCreateRole = !!user?.is_admin
  const canCreateDept = can(STRUCTURE_LEAF, 'write')

  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  // Live "does this email already have a V2E login?" check. An existing account is
  // added to this firm WITHOUT a new password (they keep the one login they use
  // everywhere), so the password box is hidden and the name is locked to their
  // existing name. `already_in_org` blocks adding the same person to this firm twice.
  const [account, setAccount] = useState<AccountCheck | null>(null)
  const [checkingAccount, setCheckingAccount] = useState(false)
  const existingAccount = !!account?.exists
  const duplicateInOrg = !!account?.already_in_org

  // Roles can be created inline via the role drawer, so keep a local copy we can
  // append to.
  const [localRoles, setLocalRoles] = useState<Role[]>(roles)
  const [creatingRole, setCreatingRole] = useState(false)

  // Departments can be created inline via the org-chart drawer (kept in flow,
  // so the user never has to leave the form). Keep a local, appendable copy.
  const [localDepartments, setLocalDepartments] = useState<Department[]>(departments)
  const [creatingDept, setCreatingDept] = useState(false)
  const [users, setUsers] = useState<User[]>([])

  // System roles carry access rights and are required on create.
  const [systemRoles, setSystemRoles] = useState<SystemRoleLite[]>([])
  useEffect(() => {
    if (!orgId) return
    listSystemRoles(orgId)
      .then(({ systemRoles }) => setSystemRoles(systemRoles))
      .catch(() => setSystemRoles([]))
  }, [orgId])

  useEffect(() => {
    if (prefillSelf && user && systemRoles.length > 0) {
      const adminRole = systemRoles.find((r) => r.is_admin)
      setForm((f) => ({
        ...f,
        name: user.name,
        email: user.email ?? '',
        password: '•' + Math.random().toString(36).slice(-8) + 'A1!',
        system_role_id: adminRole?.id ?? '',
      }))
    }
  }, [prefillSelf, user, systemRoles])

  // The dept drawer needs the user list for its "head" picker; load it lazily
  // only when the current user can actually create departments.
  useEffect(() => {
    if (!orgId || !canCreateDept) return
    getUsers(orgId)
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [orgId, canCreateDept])

  // Portal to <body> so the overlay isn't constrained by the dashboard layout's
  // stacking context, and lock background scroll while open.
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const [form, setForm] = useState(() => ({
    name: '',
    email: '',
    phone: '',
    country_code: DEFAULT_COUNTRY,
    password: '',
    department_id: '',
    role_id: '',
    system_role_id: '',
    employment_type: 'full_time' as EmploymentType,
    employee_code: suggestNextEmployeeCode(employees), // pre-fill the next code
    reporting_to_user_id: '',
    date_of_joining: '',
    date_of_birth: '',
    marriage_date: '',
    make_dep_head: false,
  }))

  const set = (k: keyof typeof form, v: any) =>
    setForm((f) => ({ ...f, [k]: v }))

  // Debounced check on the entered email OR phone. When a login already exists we lock
  // the name to that account's real name (name is one global value, like the password).
  const email = form.email.trim()
  const expectedDigits = nationalDigitsFor(form.country_code)
  const phoneDigits = form.phone.replace(/\D/g, '')
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  // Prefer email when it's a valid email; otherwise use a phone with the exact
  // number of digits the chosen country expects.
  const identifierToCheck = looksLikeEmail ? email : phoneDigits.length === expectedDigits ? phoneDigits : ''
  // Only send the country code when we're actually checking a phone number.
  const countryForCheck = looksLikeEmail ? undefined : form.country_code
  useEffect(() => {
    if (prefillSelf || !identifierToCheck) {
      setAccount(null)
      setCheckingAccount(false)
      return
    }
    let cancelled = false
    setCheckingAccount(true)
    const t = setTimeout(() => {
      checkAccount(orgId, identifierToCheck, countryForCheck)
        .then((res) => {
          if (cancelled) return
          setAccount(res)
          if (res.exists && res.name) setForm((f) => ({ ...f, name: res.name!, password: '' }))
        })
        .catch(() => {
          if (!cancelled) setAccount(null)
        })
        .finally(() => {
          if (!cancelled) setCheckingAccount(false)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [identifierToCheck, countryForCheck, orgId, prefillSelf])

  // Roles are scoped to the chosen department.
  const deptRoles = useMemo(
    () => localRoles.filter((r) => r.department_id === form.department_id),
    [localRoles, form.department_id],
  )

  const selectedRole = useMemo(
    () => localRoles.find((r) => r.id === form.role_id) ?? null,
    [localRoles, form.role_id],
  )
  const isHeadRoleSelected = selectedRole?.level === 'head'

  const selectedDept = useMemo(
    () => localDepartments.find((d) => d.id === form.department_id) ?? null,
    [localDepartments, form.department_id],
  )
  const deptHasHead = !!selectedDept?.head_user_id

  // Employee codes must be unique within the org — flag a clash as the user types.
  const usedCodes = useMemo(
    () =>
      new Set(
        employees.map((e) => (e.employee_code ?? '').trim().toLowerCase()).filter(Boolean),
      ),
    [employees],
  )
  const codeTaken =
    form.employee_code.trim() !== '' && usedCodes.has(form.employee_code.trim().toLowerCase())

  // Today as yyyy-mm-dd (local) — caps date-of-birth / marriage to the past.
  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }, [])


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (duplicateInOrg) {
      setError('This person is already an employee in this firm.')
      return
    }
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    // Email OR phone — at least one is required (both is fine).
    if (!form.email.trim() && !form.phone.trim()) {
      setError('Enter an email address or a phone number (at least one).')
      return
    }
    if (form.phone.trim() && form.phone.replace(/\D/g, '').length !== expectedDigits) {
      setError(`Enter a ${expectedDigits}-digit number for ${form.country_code}.`)
      return
    }
    // A password is required ONLY for a brand-new login. An existing account keeps
    // the password it already uses across its other firms.
    if (!existingAccount) {
      if (!form.password) {
        setError('Password is required for a new user.')
        return
      }
      if (form.password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
    }
    if (!form.department_id || !form.role_id) {
      setError('Please select a department and job role.')
      return
    }
    if (!form.system_role_id) {
      setError('Please select a system role.')
      return
    }
    if (codeTaken) {
      setError('That employee code is already in use. Please choose a unique code.')
      return
    }

    setSaving(true)
    try {
      await createEmployee(orgId, {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        country_code: form.phone.trim() ? form.country_code : undefined,
        // Omit the password entirely for an existing account — they keep their login.
        password: existingAccount ? undefined : form.password,
        role_id: form.role_id,
        department_id: form.department_id,
        system_role_id: form.system_role_id,
        employment_type: form.employment_type,
        reporting_to_user_id: form.reporting_to_user_id || undefined,
        employee_code: form.employee_code.trim() || undefined,
        date_of_joining: form.date_of_joining || undefined,
        date_of_birth: form.date_of_birth || undefined,
        marriage_date: form.marriage_date || undefined,
        make_dep_head: form.make_dep_head || undefined,
      })
      toast.success(`${form.name.trim()} added`)
      onCreated()
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? 'Failed to add employee. Please try again.'
      setError(Array.isArray(msg) ? msg.join(', ') : msg)
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-backdrop p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-2xl sm:rounded-card rounded-t-xl shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-section font-medium text-text-primary">Add Employee</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-6 py-4 overflow-y-auto space-y-4">
            {error && (
              <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2" required>Full name</Label>
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Jane Doe"
                  className={inputClass}
                  disabled={prefillSelf || existingAccount}
                />
                {existingAccount && (
                  <p className="mt-1 text-meta text-text-muted">Name comes from their existing account.</p>
                )}
              </div>
              <div>
                <Label className="mb-2">Email <span className="font-normal text-text-muted">or phone</span></Label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="jane@company.com"
                  className={inputClass}
                  disabled={prefillSelf}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2">Phone number</Label>
                <div className="flex gap-2">
                  <CountryCodeSelect
                    value={form.country_code}
                    onChange={(code) => {
                      // Re-clean the existing digits for the newly chosen country.
                      set('country_code', code)
                      set('phone', cleanNationalNumber(form.phone, code))
                    }}
                    disabled={prefillSelf}
                    wrapperClassName="w-[116px] shrink-0"
                  />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={form.phone}
                    onChange={(e) => set('phone', cleanNationalNumber(e.target.value, form.country_code))}
                    maxLength={expectedDigits}
                    placeholder={`${expectedDigits}-digit number`}
                    className={`${inputClass} flex-1`}
                    disabled={prefillSelf}
                  />
                </div>
                <p className="mt-1 text-meta text-text-muted">Email or phone — at least one. They can sign in with either.</p>
              </div>
              <div className="flex items-start">
                <div className="w-full">
                  {!prefillSelf && checkingAccount && (
                    <p className="mt-6 text-meta text-text-muted">Checking…</p>
                  )}
                  {!prefillSelf && duplicateInOrg && (
                    <p className="mt-6 text-meta text-danger">
                      This person is already an employee in this firm.
                    </p>
                  )}
                  {!prefillSelf && existingAccount && !duplicateInOrg && (
                    <p className="mt-6 text-meta text-success">
                      Existing V2E account — they’ll use their current login. No password needed here.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {!prefillSelf && !existingAccount && (
                <div>
                  <Label className="mb-2" required>Password</Label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      placeholder="Min. 8 characters"
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
              )}
              <div className={prefillSelf || existingAccount ? 'sm:col-span-2' : ''}>
                <Label className="mb-2" required>Department</Label>
                <DepartmentSelect
                  value={form.department_id}
                  departments={localDepartments}
                  onChange={(id) => {
                    setForm((f) => ({
                      ...f,
                      department_id: id,
                      role_id: '',
                      make_dep_head: false,
                    }))
                    setCreatingRole(false) // roles are dept-scoped
                  }}
                />
                {(() => {
                  const selectedDept = localDepartments.find((d) => d.id === form.department_id)
                  const showHeadOption = selectedDept ? !selectedDept.head_user_id : false
                  if (!showHeadOption) return null
                  return (
                    <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.make_dep_head}
                        onChange={(e) => set('make_dep_head', e.target.checked)}
                        className="w-4 h-4 rounded-xs border-border text-primary-text focus:ring-primary"
                      />
                      <span className="text-meta font-medium text-text-secondary">
                        Make this employee the Head of this department
                      </span>
                    </label>
                  )
                })()}
                {canCreateDept && (
                  <button
                    type="button"
                    onClick={() => setCreatingDept(true)}
                    className="mt-1.5 inline-flex items-center gap-1 text-meta font-medium text-primary-text hover:text-primary-text"
                  >
                    <Plus size={12} /> New department
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2" required>Job Role</Label>
                <RoleSelect
                  value={form.role_id}
                  roles={deptRoles}
                  disabled={!form.department_id}
                  disabledHint="Pick a department first"
                  onChange={(id) => {
                    const role = localRoles.find((r) => r.id === id)
                    const hasHead = !!localDepartments.find((d) => d.id === form.department_id)?.head_user_id
                    setForm((f) => ({
                      ...f,
                      role_id: id,
                      make_dep_head: role?.level === 'head' && !hasHead ? true : (role?.level === 'head' ? f.make_dep_head : false),
                    }))
                  }}
                />
                {isHeadRoleSelected && deptHasHead && (
                  <p className="mt-1.5 text-meta text-warning bg-warning-bg border border-warning-border rounded-md px-2.5 py-1.5 font-medium">
                    Already there is a head here.
                  </p>
                )}

                {/* Inline role creation — opens the full role drawer over this
                    modal, scoped to the chosen department (admin only) */}
                {canCreateRole && form.department_id && (
                  <button
                    type="button"
                    onClick={() => setCreatingRole(true)}
                    className="mt-1.5 inline-flex items-center gap-1 text-meta font-medium text-primary-text hover:text-primary-text"
                  >
                    <Plus size={12} /> New job role
                  </button>
                )}
              </div>
              <div>
                <Label className="mb-2">Reports to</Label>
                <ReportsToSelect
                  value={form.reporting_to_user_id}
                  onChange={(userId) => set('reporting_to_user_id', userId)}
                  employees={employees}
                  departments={localDepartments}
                  selectedDeptId={form.department_id}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="mb-2" required>System Role</Label>
                <StyledSelect
                  value={form.system_role_id}
                  onChange={(v) => set('system_role_id', v)}
                  disabled={prefillSelf}
                  placeholder="— Select —"
                  options={[
                    { value: '', label: '— Select —' },
                    ...systemRoles.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                />
              </div>
              <div>
                <Label className="mb-2">Employment type</Label>
                <StyledSelect
                  value={form.employment_type}
                  onChange={(v) => set('employment_type', v)}
                  options={EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                />
              </div>
              <div>
                <Label className="mb-2">Employee code</Label>
                <input
                  value={form.employee_code}
                  onChange={(e) => set('employee_code', e.target.value)}
                  placeholder="EMP-001"
                  className={`${inputClass} ${
                    codeTaken ? 'border-danger! focus:border-danger! focus:ring-danger!' : ''
                  }`}
                />
                {codeTaken && (
                  <p className="mt-1 text-meta text-danger">This code is already in use.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="mb-2">Date of joining</Label>
                <DatePicker
                  value={form.date_of_joining}
                  onChange={(iso) => set('date_of_joining', iso)}
                  placeholder="Select date"
                />
              </div>
              <div>
                <Label className="mb-2">Date of birth</Label>
                <DatePicker
                  value={form.date_of_birth}
                  onChange={(iso) => set('date_of_birth', iso)}
                  placeholder="Select date"
                  max={todayIso}
                />
              </div>
              <div>
                <Label className="mb-2">Marriage date</Label>
                <DatePicker
                  value={form.marriage_date}
                  onChange={(iso) => set('marriage_date', iso)}
                  placeholder="Select date"
                  max={todayIso}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-4 border-t border-border-light">
            <button
              type="submit"
              disabled={saving || duplicateInOrg || checkingAccount}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? 'Adding…' : existingAccount ? 'Add to firm' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>

      {/* Inline department creation — opens over this modal, keeping the user in flow */}
      {canCreateDept && (
        <DeptFormDrawer
          target={creatingDept ? { mode: 'create' } : null}
          departments={localDepartments}
          users={users}
          orgId={orgId}
          onClose={() => setCreatingDept(false)}
          onSaved={(saved) => {
            setLocalDepartments((ds) => [...ds, saved])
            onDeptCreated?.(saved) // keep the parent page's list fresh for the next entry
            set('department_id', saved.id) // auto-select the new department
            set('role_id', '') // its role list is empty until one is added
            setCreatingRole(false)
            setCreatingDept(false)
            toast.success(`Department "${saved.name}" created`)
          }}
          onDeleted={() => {}} // create-only here; delete lives on the org chart
        />
      )}

      {/* Inline role creation — full role form (level, JD, KRAs, KPIs) over this
          modal, scoped to the selected department */}
      {canCreateRole && (
        <RoleFormDrawer
          target={
            creatingRole && form.department_id
              ? { mode: 'create', deptId: form.department_id }
              : null
          }
          orgId={orgId}
          roles={localRoles}
          onClose={() => setCreatingRole(false)}
          onSaved={(saved) => {
            setLocalRoles((rs) => [...rs, saved])
            onRoleCreated?.(saved) // keep the parent page's list fresh for the next entry
            set('role_id', saved.id) // auto-select the new role
            setCreatingRole(false)
            toast.success(`Job role "${saved.title}" created`)
          }}
        />
      )}
    </div>,
    document.body,
  )
}
