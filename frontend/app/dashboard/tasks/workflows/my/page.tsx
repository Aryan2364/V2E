'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WORKFLOWS_BASE } from '@/components/workflows/shared'

// "My workflows" was folded into the Workflows page ("I manage" / "I'm working on").
// Old links and bookmarks land on the matching view there.
function Redirect() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const view = params.get('view')
    const show = view === 'assigned' ? 'working' : 'manage'
    router.replace(`${WORKFLOWS_BASE}?show=${show}`)
  }, [router, params])
  return null
}

export default function MyWorkflowsRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  )
}
