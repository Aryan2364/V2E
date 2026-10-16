'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import BrandMark, { BrandGlyph } from '@/components/ui/BrandMark'
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

  // One box for both. As soon as what's typed looks like a phone (has a digit and
  // no '@'), a country-code picker appears beside it; an email keeps the box alone.
  const isEmailish = identifier.includes('@')
  const isPhoneish = !isEmailish && /\d/.test(identifier)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!identifier.trim() || !password) {
      setError('Please enter your email or phone number, and your password.')
      return
    }

    setIsLoading(true)
    try {
      if (isEmailish) {
        await login(identifier.trim(), password)
      } else {
        // Phone: send the cleaned national digits plus the chosen country code.
        await login(cleanNationalNumber(identifier, countryCode), password, countryCode)
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Could not sign you in. Please check your details and try again.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  // Already authenticated (e.g. navigated here mid-redirect) — show a spinner,
  // never the login form, so it doesn't flash before the redirect lands.
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden on small screens, condensed to a bar on mobile */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#0B1220] px-16 py-14 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 120% at 0% 0%, #1E293B 0%, transparent 55%), radial-gradient(130% 130% at 100% 100%, #172554 0%, transparent 50%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)',
            backgroundSize: '46px 46px',
            maskImage:
              'radial-gradient(120% 90% at 30% 20%, #000 40%, transparent 90%)',
            WebkitMaskImage:
              'radial-gradient(120% 90% at 30% 20%, #000 40%, transparent 90%)',
          }}
        />

        <div className="relative z-1 flex items-center gap-2.5">
          <BrandGlyph size={30} radius={8} tone="dark" />
          <span className="text-[20px] font-bold tracking-tight text-white">
            V2E: Vision to Execution
          </span>
        </div>

        <div className="relative z-1 max-w-120">
          <h2 className="text-[34px] font-semibold leading-[1.18] tracking-tight text-white whitespace-nowrap">
            The&nbsp;<span className="text-[#93C5FD]">operating system</span>
            <br />
            for your organisation.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#CBD5E1]">
            One platform to keep your whole team
            <br />
            aligned, accountable, and moving forward.
          </p>
        </div>

        <div className="relative z-1 text-[13px] text-[#94A3B8]">
          © 2026 V2E · Secure workspace access
        </div>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center bg-white px-6 py-12 sm:px-10">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="w-full max-w-[380px] motion-safe:animate-fade-rise"
        >
          {/* Mobile wordmark — the brand panel is hidden below lg */}
          <div className="mb-8 lg:hidden">
            <BrandMark size="sm" tone="light" />
          </div>

          <h1 className="text-[24px] font-semibold tracking-tight text-[#0F172A]">
            Sign in to your workspace
          </h1>
          <p className="mt-1.5 text-sm text-[#475569]">
            Use your email or phone number to continue.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-[8px] border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]"
            >
              {error}
            </div>
          )}

          <div className="mt-7 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label htmlFor="identifier" className="text-sm font-medium text-[#374151]">
                Email address / Phone number
              </label>
              <div className="flex gap-2">
                {isPhoneish && (
                  <CountryCodeSelect
                    value={countryCode}
                    onChange={setCountryCode}
                    disabled={isLoading}
                    wrapperClassName="w-[120px] shrink-0"
                  />
                )}
                <div className="flex-1">
                  <Input
                    id="identifier"
                    name="identifier"
                    type="text"
                    placeholder="you@company.com or mobile number"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    disabled={isLoading}
                    autoComplete="username"
                  />
                </div>
              </div>
            </div>

            <Input
              id="password"
              name="password"
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          <div className="mt-2 flex justify-end">
            <a
              href="/forgot-password"
              className="text-[13.5px] font-medium text-[#2563EB] hover:underline"
            >
              Forgot your password?
            </a>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isLoading}
            disabled={isLoading}
            className="mt-6 w-full"
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </main>
    </div>
  )
}
