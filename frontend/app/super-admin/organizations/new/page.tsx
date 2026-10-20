'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckIcon, OctagonXIcon } from 'lucide-react'
import { createOrganization, checkOrgAdminAccount, type OrgAdminAccountCheck } from '@/lib/api/organizations'
import { getGroups } from '@/lib/api/groups'
import { Button } from '@/components/ui/button'
import Card from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { ChoiceRow } from '@/components/ui/choice-row'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { PageHeader } from '@/components/shell/page-header'
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
    <div>
      <Label required={required}>{label}</Label>
      <div className="mt-2">{children}</div>
      <InlineFieldError>{error}</InlineFieldError>
      {!error && hint && <p className="mt-2 text-label text-text-muted">{hint}</p>}
    </div>
  )
}

const INDUSTRIES = [
  'Technology', 'Finance', 'Healthcare', 'Education', 'Retail', 'Manufacturing', 'Consulting', 'Media', 'Other',
].reduce<Record<string, string>>((acc, v) => { acc[v] = v; return acc }, {})

const COUNTRIES_OPT = [
  'India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Singapore', 'UAE', 'Other',
].reduce<Record<string, string>>((acc, v) => { acc[v] = v; return acc }, {})

const TIMEZONES = {
  'Asia/Kolkata': 'Asia/Kolkata (IST, UTC+5:30)',
  'America/New_York': 'America/New_York (EST/EDT)',
  'America/Los_Angeles': 'America/Los_Angeles (PST/PDT)',
  'Europe/London': 'Europe/London (GMT/BST)',
  'Europe/Berlin': 'Europe/Berlin (CET/CEST)',
  'Asia/Singapore': 'Asia/Singapore (SGT, UTC+8)',
  'Asia/Dubai': 'Asia/Dubai (GST, UTC+4)',
  'Australia/Sydney': 'Australia/Sydney (AEST/AEDT)',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewOrganizationPage() {
  const router = useRouter()
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

  const groupOptions: Record<string, string> = { '': 'No group (standalone)' }
  groups.forEach((g) => { groupOptions[g.id] = g.name })

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Create Organization"
        meta="Set up a new tenant organization and provision its first admin account."
        trail={[
          { label: 'Organizations', href: '/super-admin/organizations' },
          { label: 'Create', href: '/super-admin/organizations/new' },
        ]}
      />

      <div className="mt-6 flex flex-col gap-6">
        {serverError ? (
          <Banner variant="danger">
            <OctagonXIcon />
            <BannerDescription>{serverError}</BannerDescription>
          </Banner>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          {/* Section 1 — Org details */}
          <Card>
            <h2 className="mb-4 border-b border-border-light pb-4 text-card-heading font-medium text-text-primary">
              Organization Details
            </h2>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Organization Name" error={errors.name?.message} required>
                <Input {...register('name')} className="max-w-none" />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Industry" error={errors.industry?.message}>
                  <SearchableSelect
                    options={INDUSTRIES}
                    value={watch('industry') ?? ''}
                    onValueChange={(v) => setValue('industry', v)}
                    placeholder="Select industry"
                  />
                </Field>
                <Field label="Country" error={errors.country?.message}>
                  <SearchableSelect
                    options={COUNTRIES_OPT}
                    value={watch('country') ?? ''}
                    onValueChange={(v) => setValue('country', v)}
                    placeholder="Select country"
                  />
                </Field>
              </div>

              <Field label="Timezone" error={errors.timezone?.message}>
                <SearchableSelect
                  options={TIMEZONES}
                  value={watch('timezone') ?? 'Asia/Kolkata'}
                  onValueChange={(v) => setValue('timezone', v)}
                />
              </Field>

              {/* Group selector */}
              <Field label="Group" hint="Optional — assign this org to an existing group">
                <SearchableSelect
                  options={groupOptions}
                  value={watch('group_id') ?? ''}
                  onValueChange={(v) => setValue('group_id', v)}
                />
              </Field>

              {/* Test client toggle */}
              <ChoiceRow
                control={
                  <Checkbox
                    checked={!!watch('is_test')}
                    onCheckedChange={(checked) => setValue('is_test', checked === true)}
                  />
                }
                label="Test client"
                description="Enables a controllable simulated clock so this org can “time travel” for testing. Leave off for real clients."
              />
            </div>
          </Card>

          {/* Section 2 — First Admin Account */}
          <Card>
            <h2 className="mb-1 border-b border-border-light pb-4 text-card-heading font-medium text-text-primary">
              First Admin Account
            </h2>

            {/* One flow — just enter the admin's email. If it already has a V2E login we
                add them with their existing password (name locked, no password field);
                otherwise it's a brand-new person and you set a name + password. No more
                "new vs existing" choice — the email decides. */}
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Admin Email" error={errors.admin_email?.message} required
                  hint={checkingAdmin ? 'Checking…' : adminExists ? 'Existing account — no password needed' : 'Required — used to recover access'}>
                  <Input {...register('admin_email')} type="email" placeholder="name@company.com" className="max-w-none" />
                </Field>
                <Field label="Admin Phone" error={errors.admin_phone?.message} hint="Optional — an extra way to sign in">
                  <div className="flex gap-2">
                    <CountryCodeSelect
                      value={adminCountry}
                      onChange={(code) => {
                        setValue('admin_country_code', code)
                        setValue('admin_phone', cleanNationalNumber(adminPhone ?? '', code))
                      }}
                      wrapperClassName="w-29 shrink-0"
                    />
                    <Input
                      type="tel"
                      inputMode="numeric"
                      value={adminPhone ?? ''}
                      onChange={(e) => setValue('admin_phone', cleanNationalNumber(e.target.value, adminCountry))}
                      maxLength={adminExpectedDigits}
                      placeholder={`${adminExpectedDigits}-digit number`}
                      className="max-w-none flex-1"
                    />
                  </div>
                </Field>
              </div>
              <Field label="Admin Name" error={errors.admin_name?.message} required
                hint={adminExists ? 'From their existing account' : undefined}>
                <Input {...register('admin_name')} disabled={adminExists} className="max-w-none" />
              </Field>
              {/* Password shown ONLY for a brand-new login. An existing account keeps the
                  one password it uses across its other firms. */}
              {adminExists ? (
                <Banner variant="success">
                  <CheckIcon />
                  <BannerDescription>
                    This email already has a V2E login. They’ll be added as this firm’s admin
                    using their existing password — nothing to set here.
                  </BannerDescription>
                </Banner>
              ) : (
                <Field label="Password" error={errors.admin_password?.message} required>
                  <PasswordInput {...register('admin_password')} placeholder="Min. 8 characters" className="max-w-none" />
                </Field>
              )}
            </div>
          </Card>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={isSubmitting} loadingLabel="Creating">Create organization</Button>
            <Button type="button" variant="secondary" onClick={() => router.push('/super-admin/organizations')} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
