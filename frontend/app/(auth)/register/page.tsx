'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { register as apiRegister } from '@/lib/api/auth'
import { useAuth } from '@/lib/auth/context'
import Button from '@/components/ui/button'

const schema = z
  .object({
    name: z.string().min(1, 'Full name is required'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Minimum 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof schema>

const inputCls =
  'w-full rounded-[8px] border border-border bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const labelCls = 'block text-sm font-medium text-text-secondary mb-1.5'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Support pre-filling email from an invite link ?email=... Joining an org is
  // done by an admin (they add you by email), never by self-attach here — so we
  // deliberately do not read or send any orgId from the URL.
  const inviteEmail = searchParams.get('email') ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: inviteEmail },
  })

  const onSubmit = async (data: FormValues) => {
    setServerError(null)
    try {
      await apiRegister({
        name: data.name,
        email: data.email,
        password: data.password,
      })
      // Auto-login after registration
      await login(data.email, data.password)
      router.replace('/dashboard')
    } catch (err: any) {
      setServerError(
        err?.response?.data?.message ?? 'Registration failed. Please try again.'
      )
    }
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-8">
        {/* Brand */}
        <div className="mb-7 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-primary rounded-[10px] mb-3">
            <span className="text-white font-bold text-sm">OS</span>
          </div>
          <h1 className="text-[22px] font-bold text-text-primary">Create your account</h1>
          <p className="text-sm text-text-secondary mt-1">
            Set up your V2E account.
          </p>
        </div>

        {/* Access notice */}
        <div className="mb-5 bg-warning-bg border border-warning-border rounded-[8px] px-4 py-3">
          <p className="text-xs font-medium text-warning">
            Creating an account doesn&apos;t join an organization on its own. Once your account exists, your organization admin adds you to it.
          </p>
        </div>

        {serverError && (
          <div className="mb-5 bg-danger-bg border border-danger-border rounded-[8px] px-4 py-3">
            <p className="text-sm text-danger">{serverError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className={labelCls}>Full Name</label>
            <input
              {...register('name')}
              placeholder="Jane Doe"
              autoComplete="name"
              className={inputCls}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-danger">{errors.name.message}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className={labelCls}>Email address</label>
            <input
              {...register('email')}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              readOnly={!!inviteEmail}
              className={[inputCls, inviteEmail ? 'bg-surface-sunken text-text-secondary' : ''].join(' ')}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className={labelCls}>Password</label>
            <div className="relative">
              <input
                {...register('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                className={inputCls + ' pr-10'}
                style={{ fontSize: '16px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className={labelCls}>Confirm Password</label>
            <div className="relative">
              <input
                {...register('confirmPassword')}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Repeat your password"
                autoComplete="new-password"
                className={inputCls + ' pr-10'}
                style={{ fontSize: '16px' }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-danger">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button type="submit" variant="primary" isLoading={isSubmitting} className="w-full mt-1">
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <a href="/login" className="font-semibold text-primary-text hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Suspense fallback={<div className="w-full max-w-[420px] h-[600px] bg-white border border-border-light rounded-[12px] animate-pulse" />}>
        <RegisterForm />
      </Suspense>
    </div>
  )
}
