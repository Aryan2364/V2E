'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { register as apiRegister } from '@/lib/api/auth'
import { useAuth } from '@/lib/auth/context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { Skeleton } from '@/components/ui/skeleton'

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

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuth()
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
    <div className="w-full max-w-auth-form">
      <div className="rounded-card border border-border-light bg-surface p-8 shadow-card">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandGlyph size={34} radius={9} />
          <h1 className="mt-3 text-page-title font-medium text-text-primary">
            Create your account
          </h1>
          <p className="mt-1 text-body text-text-secondary">Set up your V2E account.</p>
        </div>

        <Banner variant="warning" className="mb-6">
          <TriangleAlertIcon />
          <BannerDescription>
            Creating an account doesn&apos;t join an organization on its own. Once your account
            exists, your organization admin adds you to it.
          </BannerDescription>
        </Banner>

        {serverError ? (
          <Banner variant="danger" className="mb-6">
            <OctagonXIcon />
            <BannerDescription>{serverError}</BannerDescription>
          </Banner>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          <div>
            <Label htmlFor="name" required>
              Full name
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="Jane Doe"
              autoComplete="name"
              className="mt-2 max-w-none"
              aria-invalid={errors.name ? true : undefined}
            />
            <InlineFieldError>{errors.name?.message}</InlineFieldError>
          </div>

          <div>
            <Label htmlFor="email" required>
              Email address
            </Label>
            <Input
              id="email"
              {...register('email')}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              readOnly={!!inviteEmail}
              className="mt-2 max-w-none"
              aria-invalid={errors.email ? true : undefined}
            />
            <InlineFieldError>{errors.email?.message}</InlineFieldError>
          </div>

          <div>
            <Label htmlFor="password" required>
              Password
            </Label>
            <PasswordInput
              id="password"
              {...register('password')}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              className="mt-2 max-w-none"
              aria-invalid={errors.password ? true : undefined}
            />
            <InlineFieldError>{errors.password?.message}</InlineFieldError>
          </div>

          {/*
           * Kept for owner decision: FRONTEND_RULES_ACCESS.md section 32.3
           * says a password field needs no confirm field because the show/hide
           * toggle makes a typo visible. Removing it here would drop a
           * required field from the submitted form (a validation/behaviour
           * change outside this pass's presentation-only scope per D1), so
           * it stays. Logged in REVIEW-kit-alignment.md.
           */}
          <div>
            <Label htmlFor="confirmPassword" required>
              Confirm password
            </Label>
            <PasswordInput
              id="confirmPassword"
              {...register('confirmPassword')}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className="mt-2 max-w-none"
              aria-invalid={errors.confirmPassword ? true : undefined}
            />
            <InlineFieldError>{errors.confirmPassword?.message}</InlineFieldError>
          </div>

          <Button type="submit" size="lg" loading={isSubmitting} loadingLabel="Creating account" className="mt-1 w-full">
            Create account
          </Button>
        </form>

        <p className="mt-6 text-center text-body text-text-secondary">
          Already have an account?{' '}
          <a href="/login" className="text-primary-text hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4">
      <Suspense fallback={<Skeleton className="h-150 w-full max-w-auth-form rounded-card" />}>
        <RegisterForm />
      </Suspense>
    </div>
  )
}
