'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, ChevronLeft, Check } from 'lucide-react'
import { createOrganization, checkOrgAdminAccount, type OrgAdminAccountCheck } from '@/lib/api/organizations'
import { getGroups } from '@/lib/api/groups'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber, nationalDigitsFor } from '@/lib/phone'
import type { OrganizationGroup } from '@/lib/types'

// ─── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  industry: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  group_id: z.string().optional(),
  is_test: z.boolean().optional(),
  admin_name: z.string().optional(),
  admin_email: z.string().optional(),
  admin_phone: z.string().optional(),
  admin_country_code: z.string().optional(),
  admin_password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

// ─── Field wrapper ─────────────────────────────────────────────────────────────

function Field({
  label, error, required, hint, children,
}: {
  label: string; error?: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[#374151]">
        {label}{required && <span className="text-[#DC2626] ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-[#DC2626]">{error}</p>}
      {!error && hint && <p className="text-xs text-[#64748B]">{hint}</p>}
    </div>
  )
}

const inputCls = (hasError?: boolean) =>
  [
    'w-full rounded-[8px] bg-white px-3 py-[10px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden transition-colors',
    hasError ? 'border-2 border-[#DC2626]' : 'border border-[#CBD5E1] focus:border-2 focus:border-[#2563EB]',
  ].join(' ')

const selectCls = (hasError?: boolean) =>
  [
    'w-full rounded-[8px] bg-white px-3 py-[10px] text-sm text-[#0F172A] focus:outline-hidden transition-colors',
    hasError ? 'border-2 border-[#DC2626]' : 'border border-[#CBD5E1] focus:border-2 focus:border-[#2563EB]',
  ].join(' ')

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewOrganizationPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Groups (for assigning the org to a group — not for picking the admin)
  const [groups, setGroups] = useState<OrganizationGroup[]>([])

  useEffect(() => {
    getGroups().then(setGroups).catch(() => setGroups([]))
  }, [])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: 'Asia/Kolkata', admin_country_code: DEFAULT_COUNTRY },
  })

  // Live "does this admin email already have a V2E login?" check. If it exists, we hide
  // the password field (they keep their login) and lock the name to their existing name
  // — the firm creator can't know this on their own, so we detect it and tell them.
  const adminEmail = watch('admin_email')
  const adminPhone = watch('admin_phone')
  const adminCountry = watch('admin_country_code') ?? DEFAULT_COUNTRY
  const [adminAccount, setAdminAccount] = useState<OrgAdminAccountCheck | null>(null)
  const [checkingAdmin, setCheckingAdmin] = useState(false)
  const adminExists = !!adminAccount?.exists
  const email = (adminEmail ?? '').trim()
  const adminExpectedDigits = nationalDigitsFor(adminCountry)
  const phoneDigits = (adminPhone ?? '').replace(/\D/g, '')
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const adminIdentifier = looksLikeEmail ? email : phoneDigits.length === adminExpectedDigits ? phoneDigits : ''
  const adminCountryForCheck = looksLikeEmail ? undefined : adminCountry
  useEffect(() => {
    if (!adminIdentifier) {
      setAdminAccount(null)
      setCheckingAdmin(false)
      return
    }
    let cancelled = false
    setCheckingAdmin(true)
    const t = setTimeout(() => {
      checkOrgAdminAccount(adminIdentifier, adminCountryForCheck)
        .then((res) => {
          if (cancelled) return
          setAdminAccount(res)
          if (res.exists && res.name) setValue('admin_name', res.name)
        })
        .catch(() => { if (!cancelled) setAdminAccount(null) })
        .finally(() => { if (!cancelled) setCheckingAdmin(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [adminIdentifier, adminCountryForCheck, setValue])

  const onSubmit = async (values: FormValues) => {
    setServerError(null)

    // The firm's admin must have an email (so their team can recover access). A
    // phone is optional and additional here.
    if (!values.admin_email) {
      setServerError('An organization admin must have an email address, so their team can recover access.')
      return
    }
    if (!values.admin_name) {
      setServerError('Admin name is required.')
      return
    }
    // A password is required only for a brand-new login. An existing account keeps the
    // password it already uses across its other firms.
    if (!adminExists && (!values.admin_password || values.admin_password.length < 8)) {
      setServerError('Set a password (min 8 characters) for this new admin.')
      return
    }

    try {
      const payload: Parameters<typeof createOrganization>[0] = {
        name: values.name,
        industry: values.industry || undefined,
        country: values.country || undefined,
        timezone: values.timezone || undefined,
        group_id: values.group_id || undefined,
        is_test: values.is_test || undefined,
        admin_name: values.admin_name,
        admin_email: values.admin_email || undefined,
        admin_phone: values.admin_phone || undefined,
        admin_country_code: values.admin_phone ? (values.admin_country_code || DEFAULT_COUNTRY) : undefined,
        // Omit the password for an existing login — they keep the one they already use.
        admin_password: adminExists ? undefined : values.admin_password || undefined,
      }

      await createOrganization(payload)
      router.push('/super-admin/organizations')
    } catch (err: any) {
      setServerError(err?.response?.data?.message ?? 'Something went wrong. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-[#475569] hover:text-[#0F172A] mb-3 transition-colors"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="text-[28px] font-bold text-[#0F172A]">Create Organization</h1>
        <p className="text-sm text-[#475569] mt-1">Set up a new tenant organization and provision its first admin account.</p>
      </div>

      {serverError && (
        <div className="rounded-[8px] bg-[#FEE2E2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {/* Section 1 — Org details */}
        <Card>
          <h2 className="text-[16px] font-semibold text-[#0F172A] mb-5 pb-4 border-b border-[#E2E8F0]">Organization Details</h2>
          <div className="grid grid-cols-1 gap-5">
            <Field label="Organization Name" error={errors.name?.message} required>
              <input
                {...register('name')}
                placeholder=""
                className={inputCls(!!errors.name)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Industry" error={errors.industry?.message}>
                <select {...register('industry')} className={selectCls(!!errors.industry)}>
                  <option value="">Select industry</option>
                  <option value="Technology">Technology</option>
                  <option value="Finance">Finance</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Education">Education</option>
                  <option value="Retail">Retail</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Consulting">Consulting</option>
                  <option value="Media">Media</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Country" error={errors.country?.message}>
                <select {...register('country')} className={selectCls(!!errors.country)}>
                  <option value="">Select country</option>
                  <option value="India">India</option>
                  <option value="United States">United States</option>
                  <option value="United Kingdom">United Kingdom</option>
                  <option value="Canada">Canada</option>
                  <option value="Australia">Australia</option>
                  <option value="Singapore">Singapore</option>
                  <option value="UAE">UAE</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
            </div>

            <Field label="Timezone" error={errors.timezone?.message}>
              <select {...register('timezone')} className={selectCls(!!errors.timezone)}>
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
              </select>
            </Field>

            {/* Group selector */}
            <Field label="Group" hint="Optional — assign this org to an existing group">
              <select {...register('group_id')} className={selectCls()}>
                <option value="">No group (standalone)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>

            {/* Test client toggle */}
            <label className="flex items-start gap-3 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                {...register('is_test')}
                className="mt-0.5 w-4 h-4 rounded-xs border-[#CBD5E1] text-[#D97706] focus:ring-[#D97706]"
              />
              <span>
                <span className="block text-sm font-medium text-[#92400E]">Test client</span>
                <span className="block text-xs text-[#B45309] mt-0.5">
                  Enables a controllable simulated clock so this org can “time travel” for testing. Leave off for real clients.
                </span>
              </span>
            </label>
          </div>
        </Card>

        {/* Section 2 — First Admin Account */}
        <Card>
          <h2 className="text-[16px] font-semibold text-[#0F172A] mb-1 pb-4 border-b border-[#E2E8F0]">First Admin Account</h2>

          {/* One flow — just enter the admin's email. If it already has a V2E login we
              add them with their existing password (name locked, no password field);
              otherwise it's a brand-new person and you set a name + password. No more
              "new vs existing" choice — the email decides. */}
          <div className="flex flex-col gap-5 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Admin Email" error={errors.admin_email?.message} required
                hint={checkingAdmin ? 'Checking…' : adminExists ? 'Existing account — no password needed' : 'Required — used to recover access'}>
                <input {...register('admin_email')} type="email" placeholder="name@company.com" className={inputCls(!!errors.admin_email)} />
              </Field>
              <Field label="Admin Phone" error={errors.admin_phone?.message} hint="Optional — an extra way to sign in">
                <div className="flex gap-2">
                  <CountryCodeSelect
                    value={adminCountry}
                    onChange={(code) => {
                      setValue('admin_country_code', code)
                      setValue('admin_phone', cleanNationalNumber(adminPhone ?? '', code))
                    }}
                    wrapperClassName="w-[116px] shrink-0"
                  />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={adminPhone ?? ''}
                    onChange={(e) => setValue('admin_phone', cleanNationalNumber(e.target.value, adminCountry))}
                    maxLength={adminExpectedDigits}
                    placeholder={`${adminExpectedDigits}-digit number`}
                    className={`${inputCls(!!errors.admin_phone)} flex-1`}
                  />
                </div>
              </Field>
            </div>
            <Field label="Admin Name" error={errors.admin_name?.message} required
              hint={adminExists ? 'From their existing account' : undefined}>
              <input {...register('admin_name')} placeholder="" disabled={adminExists}
                className={[inputCls(!!errors.admin_name), adminExists ? 'bg-[#F8FAFC] text-[#64748B]' : ''].join(' ')} />
            </Field>
            {/* Password shown ONLY for a brand-new login. An existing account keeps the
                one password it uses across its other firms. */}
            {adminExists ? (
              <div className="flex items-start gap-2 p-3 rounded-[8px] bg-[#F0FDF4] border border-[#BBF7D0]">
                <Check size={16} className="text-[#16A34A] shrink-0 mt-0.5" />
                <p className="text-sm text-[#166534]">
                  This email already has a V2E login. They’ll be added as this firm’s admin
                  using their <strong>existing password</strong> — nothing to set here.
                </p>
              </div>
            ) : (
              <Field label="Password" error={errors.admin_password?.message} required>
                <div className="relative">
                  <input
                    {...register('admin_password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 8 characters"
                    className={[inputCls(!!errors.admin_password), 'pr-10'].join(' ')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569] transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
            )}
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" isLoading={isSubmitting}>Create Organization</Button>
          <Button type="button" variant="secondary" onClick={() => router.push('/super-admin/organizations')} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
