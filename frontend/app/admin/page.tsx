'use client'

import React, { useState, useEffect } from 'react'
import { ShieldCheckIcon, OctagonXIcon } from 'lucide-react'
import { adminLogin as apiAdminLogin, getMe } from '@/lib/api/auth'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { InlineFieldError } from '@/components/ui/inline-field-error'

export default function AdminLoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})

  // Same one-box behaviour as the main login: a country picker appears when the
  // input looks like a phone (has a digit, no '@').
  const isEmailish = identifier.includes('@')
  const isPhoneish = !isEmailish && /\d/.test(identifier)

  // If already authenticated as super admin, redirect immediately
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) { setChecking(false); return }
    getMe().then((me) => {
      if (me.isSuperAdmin) window.location.href = '/super-admin/organizations'
      else setChecking(false)
    }).catch(() => setChecking(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!identifier.trim() || !password) {
      setFieldErrors({
        identifier: identifier.trim() ? undefined : 'Enter your email address or mobile number.',
        password: password ? undefined : 'Enter your password.',
      })
      document.getElementById(identifier.trim() ? 'password' : 'identifier')?.focus()
      return
    }
    setFieldErrors({})
    setError(null)
    setLoading(true)
    try {
      const tokens = isEmailish
        ? await apiAdminLogin(identifier.trim(), password)
        : await apiAdminLogin(cleanNationalNumber(identifier, countryCode), password, countryCode)
      localStorage.setItem('access_token', tokens.access_token)
      localStorage.setItem('refresh_token', tokens.refresh_token)
      window.location.href = '/super-admin/organizations'
    } catch (err: unknown) {
      // Never says which field was wrong (kit 11.7).
      const status = (err as { response?: { status?: number } })?.response?.status
      setError(
        status && status >= 500
          ? 'We could not sign you in just now. Try again in a moment.'
          : 'The email or password is not right. Check both and try again.',
      )
      setLoading(false)
    }
  }

  if (checking) {
    // Checking the session — render nothing rather than a spinner (section 14 rule 1).
    return <div className="min-h-screen bg-surface-sunken" />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4">
      <div className="w-full max-w-auth-form">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-card border border-border-light bg-surface shadow-card">
            <ShieldCheckIcon size={28} className="text-primary-text" />
          </div>
          <h1 className="mt-4 text-page-title font-medium text-text-primary">Admin portal</h1>
          <p className="mt-1 text-body text-text-muted">Super administrator access only</p>
        </div>

        {/* Card */}
        <div className="rounded-card border border-border-light bg-surface p-8 shadow-card">
          {error ? (
            <Banner variant="danger" className="mb-4">
              <OctagonXIcon />
              <BannerDescription>{error}</BannerDescription>
            </Banner>
          ) : null}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            {/* Email or phone */}
            <div>
              <Label htmlFor="identifier" required>
                Email address or mobile number
              </Label>
              <div className="mt-2 flex gap-2">
                {isPhoneish && (
                  <CountryCodeSelect
                    value={countryCode}
                    onChange={setCountryCode}
                    disabled={loading}
                    wrapperClassName="w-29 shrink-0"
                  />
                )}
                <Input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setFieldErrors((p) => ({ ...p, identifier: undefined })) }}
                  aria-invalid={fieldErrors.identifier ? true : undefined}
                  disabled={loading}
                  placeholder="For example, admin@example.com"
                  className="max-w-none flex-1"
                />
              </div>
              <InlineFieldError>{fieldErrors.identifier}</InlineFieldError>
            </div>

            {/* Password */}
            <div>
              <Label htmlFor="password" required>
                Password
              </Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })) }}
                aria-invalid={fieldErrors.password ? true : undefined}
                disabled={loading}
                className="mt-2 max-w-none"
              />
              <InlineFieldError>{fieldErrors.password}</InlineFieldError>
            </div>

            {/* Submit */}
            <Button type="submit" size="lg" loading={loading} loadingLabel="Signing in" className="w-full">
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-meta text-text-secondary">
          Not an admin?{' '}
          <a href="/login" className="text-text-secondary underline hover:text-text-primary">
            Go to workspace login
          </a>
        </p>
      </div>
    </div>
  )
}
