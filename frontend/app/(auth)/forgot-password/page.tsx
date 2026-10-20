'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, CheckCircle2Icon, OctagonXIcon } from 'lucide-react'
import { forgotPassword, verifyResetOtp, resetPassword } from '@/lib/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { OtpField } from '@/components/ui/otp-field'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { BrandGlyph } from '@/components/ui/BrandMark'

const RESEND_COOLDOWN_S = 60

type Step = 'email' | 'otp' | 'password' | 'done'

function errMsg(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  )
}

export default function ForgotPasswordPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The message for the one field being asked for, shown under it (kit 11.3 rule 6).
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Tick down the resend cooldown once a code has been sent.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const sendCode = async () => {
    setError(null)
    if (!email.trim()) {
      setFieldError('Enter your email address.')
      document.getElementById('fp-email')?.focus()
      return
    }
    setFieldError(null)
    setIsLoading(true)
    try {
      await forgotPassword(email.trim())
      setStep('otp')
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(errMsg(err, 'Could not send a reset code. Try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const resend = async () => {
    if (cooldown > 0) return
    setError(null)
    setIsLoading(true)
    try {
      await forgotPassword(email.trim())
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(errMsg(err, 'Could not resend the code. Try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const verifyCode = async () => {
    setError(null)
    if (otp.trim().length < 6) {
      setFieldError('Enter the 6-digit code from your email.')
      document.getElementById('fp-otp')?.focus()
      return
    }
    setFieldError(null)
    setIsLoading(true)
    try {
      const { reset_token } = await verifyResetOtp(email.trim(), otp.trim())
      setResetToken(reset_token)
      setStep('password')
    } catch (err) {
      setError(errMsg(err, 'That code is not right. Check your email and try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const submitNewPassword = async () => {
    setError(null)
    if (password.length < 8) {
      setFieldError('Use at least 8 characters in the password.')
      document.getElementById('fp-password')?.focus()
      return
    }
    if (password !== confirm) {
      setFieldError('The two passwords do not match. Enter the same password in both fields.')
      document.getElementById('fp-confirm')?.focus()
      return
    }
    setFieldError(null)
    setIsLoading(true)
    try {
      await resetPassword(email.trim(), resetToken, password)
      setStep('done')
    } catch (err) {
      setError(errMsg(err, 'Could not reset your password. Start again from the first step.'))
    } finally {
      setIsLoading(false)
    }
  }

  const heading: Record<Step, { title: string; sub: string }> = {
    email: { title: 'Reset your password', sub: 'Enter your email and we’ll send you a 6-digit code.' },
    otp: { title: 'Enter your code', sub: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` },
    password: { title: 'Choose a new password', sub: 'Pick a strong password you don’t use elsewhere.' },
    done: { title: 'Password updated', sub: 'You can now sign in with your new password.' },
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4">
      <div className="w-full max-w-auth-form">
        <div className="rounded-card border border-border-light bg-surface p-8 shadow-card">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandGlyph size={34} radius={9} />
            <h1 className="mt-3 text-page-title font-medium text-text-primary">
              {heading[step].title}
            </h1>
            <p className="mt-1 text-body text-text-secondary">{heading[step].sub}</p>
          </div>

          {error ? (
            <Banner variant="danger" className="mb-6">
              <OctagonXIcon />
              <BannerDescription>{error}</BannerDescription>
            </Banner>
          ) : null}

          {/* Step 1 — email */}
          {step === 'email' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendCode()
              }}
              className="flex flex-col gap-6"
            >
              <div>
                <Label htmlFor="fp-email" required>
                  Email address
                </Label>
                <Input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setFieldError(null) }}
                  placeholder="For example, you@company.com"
                  aria-invalid={fieldError ? true : undefined}
                  autoComplete="email"
                  autoFocus
                  className="mt-2 max-w-none"
                />
                <InlineFieldError>{fieldError}</InlineFieldError>
              </div>
              <Button type="submit" size="lg" loading={isLoading} loadingLabel="Sending" className="mt-1 w-full">
                Send reset code
              </Button>
            </form>
          )}

          {/* Step 2 — otp */}
          {step === 'otp' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                verifyCode()
              }}
              className="flex flex-col gap-6"
            >
              <div>
                <Label htmlFor="fp-otp" required>
                  6-digit code
                </Label>
                <OtpField
                  id="fp-otp"
                  length={6}
                  value={otp}
                  onChange={(v) => { setOtp(v); setFieldError(null) }}
                  className="mt-2"
                />
                <InlineFieldError>{fieldError}</InlineFieldError>
              </div>
              <Button type="submit" size="lg" loading={isLoading} loadingLabel="Verifying" className="mt-1 w-full">
                Verify code
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={cooldown > 0 || isLoading}
                onClick={resend}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Button>
            </form>
          )}

          {/* Step 3 — new password */}
          {step === 'password' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitNewPassword()
              }}
              className="flex flex-col gap-6"
            >
              <div>
                <Label htmlFor="fp-password" required>
                  New password
                </Label>
                <PasswordInput
                  id="fp-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldError(null) }}
                  aria-invalid={fieldError && password.length < 8 ? true : undefined}
                  autoComplete="new-password"
                  autoFocus
                  className="mt-2 max-w-none"
                />
                {password.length < 8 ? <InlineFieldError>{fieldError}</InlineFieldError> : null}
                <p className="mt-2 text-meta text-text-muted">Use at least 8 characters.</p>
              </div>
              <div>
                <Label htmlFor="fp-confirm" required>
                  Confirm new password
                </Label>
                <PasswordInput
                  id="fp-confirm"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setFieldError(null) }}
                  aria-invalid={fieldError && password.length >= 8 ? true : undefined}
                  autoComplete="new-password"
                  className="mt-2 max-w-none"
                />
                {password.length >= 8 ? <InlineFieldError>{fieldError}</InlineFieldError> : null}
              </div>
              <Button type="submit" size="lg" loading={isLoading} loadingLabel="Updating" className="mt-1 w-full">
                Update password
              </Button>
            </form>
          )}

          {/* Step 4 — done */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-6">
              <CheckCircle2Icon className="size-11 text-success" />
              <Button type="button" size="lg" className="w-full" onClick={() => router.replace('/login')}>
                Back to sign in
              </Button>
            </div>
          )}

          {step !== 'done' && (
            <div className="mt-6 text-center">
              <a
                href="/login"
                className="inline-flex items-center gap-1 text-body text-text-secondary hover:text-text-primary"
              >
                <ArrowLeftIcon className="size-4" /> Back to sign in
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
