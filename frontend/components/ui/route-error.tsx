'use client'

import { useEffect } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { PHONE_HOME } from '@/lib/phone-routes'

/**
 * Section 11.8 "Something went wrong" for a route-level error boundary
 * (error.tsx). The raw error is logged for developers and never shown; the
 * user sees the fixed wording, "Try again" (reset) and "Go to dashboard",
 * plus the Next.js digest as the reference code that is also recorded in the
 * server logs.
 */
export function RouteError({
  error,
  reset,
  dashboardHref = '/dashboard',
}: {
  error: Error & { digest?: string }
  reset: () => void
  dashboardHref?: string
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        variant="failed"
        dashboardHref={dashboardHref}
        homeHref={PHONE_HOME}
        reference={error.digest}
        onAction={reset}
      />
    </div>
  )
}
