'use client'

import { useEffect } from 'react'
import './globals.css'
import { Button } from '@/components/ui/button'

/**
 * Last-resort boundary: it replaces the root layout, so no providers (layout
 * context, toasts) exist here. Plain kit tokens and the kit Button only, with
 * section 11.8's wording. The raw error is logged, never shown.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body className="bg-surface-sunken text-text-primary antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-[20px] font-medium">Something went wrong</h1>
          <p className="max-w-sm text-body text-text-secondary">
            Try again. If it keeps happening, share the reference below with your support team.
          </p>
          <div className="mt-2 flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="secondary" render={<a href="/dashboard" />} nativeButton={false}>
              Go to dashboard
            </Button>
          </div>
          {error.digest && <p className="text-meta text-text-muted">Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}
