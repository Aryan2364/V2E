'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { forgotPassword, verifyResetOtp, resetPassword } from '@/lib/api/auth'
import Button from '@/components/ui/Button'

const inputCls =
  'w-full rounded-[8px] border border-[#CBD5E1] bg-white px-3 py-[10px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-2 focus:border-[#2563EB] transition-colors'
const labelCls = 'block text-sm font-medium text-[#374151] mb-1.5'

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
  const [showPassword, setShowPassword] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError('Please enter your email address.')
      return
    }
    setIsLoading(true)
    try {
      await forgotPassword(email.trim())
      setStep('otp')
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(errMsg(err, 'Could not send a reset code. Please try again.'))
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
      setError(errMsg(err, 'Could not resend the code. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const verifyCode = async () => {
    setError(null)
    if (otp.trim().length < 6) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setIsLoading(true)
    try {
      const { reset_token } = await verifyResetOtp(email.trim(), otp.trim())
      setResetToken(reset_token)
      setStep('password')
    } catch (err) {
      setError(errMsg(err, 'That code is not valid. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const submitNewPassword = async () => {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setIsLoading(true)
    try {
      await resetPassword(email.trim(), resetToken, password)
      setStep('done')
    } catch (err) {
      setError(errMsg(err, 'Could not reset your password. Please start again.'))
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
    <div className="min-h-screen flex items-center justify-center p-4">
    <div className="w-full max-w-[420px]">
      <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-8">
        {/* Brand */}
        <div className="mb-7 text-center">
          <span className="text-[28px] font-bold text-[#0F172A] tracking-tight">V2E</span>
          <h1 className="mt-3 text-[20px] font-bold text-[#0F172A]">{heading[step].title}</h1>
          <p className="text-sm text-[#475569] mt-1">{heading[step].sub}</p>
        </div>

        {error && (
          <div role="alert" className="mb-5 rounded-[8px] border border-[#FECACA] bg-[#FEE2E2] px-4 py-3">
            <p className="text-sm text-[#DC2626]">{error}</p>
          </div>
        )}

        {/* Step 1 — email */}
        {step === 'email' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendCode()
            }}
            className="flex flex-col gap-4"
          >
            <div>
              <label className={labelCls}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                className={inputCls}
              />
            </div>
            <Button type="submit" variant="primary" isLoading={isLoading} className="w-full mt-1">
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
            className="flex flex-col gap-4"
          >
            <div>
              <label className={labelCls}>6-digit code</label>
              <input
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                className={inputCls + ' text-center tracking-[0.5em] text-lg font-semibold'}
              />
            </div>
            <Button type="submit" variant="primary" isLoading={isLoading} className="w-full mt-1">
              Verify code
            </Button>
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0 || isLoading}
              className="text-sm text-[#2563EB] hover:underline disabled:text-[#94A3B8] disabled:no-underline disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </form>
        )}

        {/* Step 3 — new password */}
        {step === 'password' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitNewPassword()
            }}
            className="flex flex-col gap-4"
          >
            <div>
              <label className={labelCls}>New password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  autoFocus
                  className={inputCls + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569] transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
            <Button type="submit" variant="primary" isLoading={isLoading} className="w-full mt-1">
              Update password
            </Button>
          </form>
        )}

        {/* Step 4 — done */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle2 size={44} className="text-[#16A34A]" />
            <Button
              type="button"
              variant="primary"
              className="w-full"
              onClick={() => router.replace('/login')}
            >
              Back to sign in
            </Button>
          </div>
        )}

        {step !== 'done' && (
          <div className="mt-6 text-center">
            <a
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#475569] hover:text-[#0F172A]"
            >
              <ArrowLeft size={15} /> Back to sign in
            </a>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
