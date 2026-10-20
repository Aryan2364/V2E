'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { OctagonXIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { DEFAULT_COUNTRY, cleanNationalNumber } from '@/lib/phone'
import { useLayout } from '@/lib/layout'
import { signedInHome } from '@/lib/phone-routes'

export default function LoginPage() {
  const { login, user } = useAuth()
  const router = useRouter()
  const { layout } = useLayout()

  useEffect(() => {
    if (!user) return
    // Desktop: unchanged. Phone: My work, the phone's home (lib/phone-routes.ts).
    router.replace(signedInHome(user, layout))
  }, [user, router, layout])

  const [identifier, setIdentifier] = useState('')
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY)
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})

  // One box for both. As soon as what's typed looks like a phone (has a digit and
  // no '@'), a country-code picker appears beside it; an email keeps the box alone.
  const isEmailish = identifier.includes('@')
  const isPhoneish = !isEmailish && /\d/.test(identifier)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!identifier.trim() || !password) {
      setFieldErrors({
        identifier: identifier.trim() ? undefined : 'Enter your email address or mobile number.',
        password: password ? undefined : 'Enter your password.',
      })
      document.getElementById(identifier.trim() ? 'password' : 'identifier')?.focus()
      return
    }
    setFieldErrors({})

    setIsLoading(true)
    try {
      if (isEmailish) {
        await login(identifier.trim(), password)
      } else {
        // Phone: send the cleaned national digits plus the chosen country code.
        await login(cleanNationalNumber(identifier, countryCode), password, countryCode)
      }
    } catch (err: unknown) {
      // Never says which field was wrong (kit 11.7).
      const status = (err as { response?: { status?: number } })?.response?.status
      setError(
        status && status >= 500
          ? 'We could not sign you in just now. Try again in a moment.'
          : 'The email or password is not right. Check both and try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Already authenticated (e.g. navigated here mid-redirect) — show a spinner,
  // never the login form, so it doesn't flash before the redirect lands.
  if (user) {
    // Redirecting — render nothing rather than a spinner (section 14 rule 1).
    return null
  }

  return (
    <div className="flex min-h-screen w-full flex-col lg:grid lg:grid-cols-2">
      {/* Brand panel — section 11.7: strip on phone/tablet, full half at 1024px+ */}
      <section
        aria-label="V2E: Vision to Execution"
        className="relative isolate flex flex-col overflow-hidden bg-linear-to-br from-primary to-primary-pressed px-6 py-4 lg:justify-between lg:p-12"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(var(--on-brand)_1px,transparent_1px),linear-gradient(90deg,var(--on-brand)_1px,transparent_1px)] bg-size-[32px_32px] opacity-(--brand-pattern-opacity)"
        />

        <div className="flex items-center gap-2 text-on-brand">
          <BrandGlyph size={22} radius={8} tone="dark" />
          <span className="text-section font-medium">V2E: Vision to Execution</span>
        </div>

        <div className="hidden max-w-md flex-col gap-4 lg:flex">
          <p className="text-display font-medium text-on-brand">
            The <span className="text-on-brand-accent">operating system</span> for your
            organisation.
          </p>
          <p className="text-card-heading font-normal text-on-brand-muted">
            One platform to keep your whole team aligned, accountable, and moving forward.
          </p>
        </div>

        <p className="hidden text-meta text-on-brand-muted lg:block">
          © 2026 V2E · Secure workspace access
        </p>
      </section>

      {/* Form column */}
      <main className="flex flex-1 items-center justify-center bg-surface px-4 py-12">
        <form onSubmit={handleSubmit} noValidate className="w-full max-w-auth-form">
          <h1 className="text-page-title font-medium text-text-primary">
            Sign in to your workspace
          </h1>
          <p className="mt-2 text-body text-text-secondary">
            Use your email or phone number to continue.
          </p>

          {error ? (
            <Banner variant="danger" className="mt-6">
              <OctagonXIcon />
              <BannerDescription>{error}</BannerDescription>
            </Banner>
          ) : null}

          <div className="mt-8">
            <Label htmlFor="identifier" required>
              Email address or mobile number
            </Label>
            <div className="mt-2 flex gap-2">
              {isPhoneish && (
                <CountryCodeSelect
                  value={countryCode}
                  onChange={setCountryCode}
                  disabled={isLoading}
                  wrapperClassName="w-30 shrink-0"
                />
              )}
              <Input
                id="identifier"
                name="identifier"
                type="text"
                placeholder="For example, you@company.com"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setFieldErrors((p) => ({ ...p, identifier: undefined })) }}
                aria-invalid={fieldErrors.identifier ? true : undefined}
                disabled={isLoading}
                autoComplete="username"
                className="max-w-none flex-1"
              />
            </div>
            <InlineFieldError>{fieldErrors.identifier}</InlineFieldError>
          </div>

          <div className="mt-6">
            <Label htmlFor="password" required>
              Password
            </Label>
            <PasswordInput
              id="password"
              name="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })) }}
              aria-invalid={fieldErrors.password ? true : undefined}
              disabled={isLoading}
              autoComplete="current-password"
              className="mt-2 max-w-none"
            />
            <InlineFieldError>{fieldErrors.password}</InlineFieldError>
            <div className="mt-2 flex justify-end">
              <a
                href="/forgot-password"
                className="tap-area rounded-sm text-body text-primary-text outline-none hover:underline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
              >
                Forgot your password?
              </a>
            </div>
          </div>

          <Button type="submit" size="lg" className="mt-6 w-full" loading={isLoading} loadingLabel="Signing in">
            Sign in
          </Button>
        </form>
      </main>
    </div>
  )
}
