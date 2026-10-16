'use client'

import React, { useState, useEffect } from 'react'
import { Eye, EyeOff, ShieldCheck, Loader2 } from 'lucide-react'
import { adminLogin as apiAdminLogin, getMe } from '@/lib/api/auth'
import CountryCodeSelect from '@/components/ui/CountryCodeSelect'
import { DEFAULT_COUNTRY, cleanNationalNumber } from '@/lib/phone'

export default function AdminLoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      setError('Please enter your email or phone number, and your password.')
      return
    }
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
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not sign you in. Please check your details and try again.'
      setError(msg)
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[#475569]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-[14px] bg-[#1E293B] border border-[#334155] mb-4">
            <ShieldCheck size={28} className="text-[#2563EB]" />
          </div>
          <h1 className="text-[26px] font-bold text-white tracking-tight">Admin Portal</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">Super administrator access only</p>
        </div>

        {/* Card */}
        <div className="bg-[#1E293B] border border-[#334155] rounded-[14px] p-7 shadow-xl">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Email or phone */}
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-[#CBD5E1] mb-1.5">
                Email address / Phone number
              </label>
              <div className="flex gap-2">
                {isPhoneish && (
                  <CountryCodeSelect
                    value={countryCode}
                    onChange={setCountryCode}
                    disabled={loading}
                    dark
                    wrapperClassName="w-[116px] shrink-0"
                  />
                )}
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={loading}
                  placeholder="admin@example.com or mobile number"
                  className="flex-1 h-11 px-3 rounded-[8px] border border-[#334155] bg-[#0F172A] text-white placeholder:text-[#475569] text-sm focus:border-[#2563EB] focus:outline-hidden focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-50 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#CBD5E1] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="Enter your password"
                  className="w-full h-11 px-3 pr-10 rounded-[8px] border border-[#334155] bg-[#0F172A] text-white placeholder:text-[#475569] text-sm focus:border-[#2563EB] focus:outline-hidden focus:ring-2 focus:ring-[#2563EB]/20 disabled:opacity-50 transition-colors"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#475569] hover:text-[#94A3B8] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#1E293B] disabled:text-[#475569] disabled:border disabled:border-[#334155] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#334155] mt-6">
          Not an admin?{' '}
          <a href="/login" className="text-[#475569] hover:text-[#94A3B8] underline transition-colors">
            Go to workspace login
          </a>
        </p>
      </div>
    </div>
  )
}
