'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Skeleton, runsHref } from '@/components/workflows/shared'

/** The runs list lives on the workflow page now; old links land there. */
export default function WorkflowRunsRedirect() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  useEffect(() => {
    router.replace(runsHref(id))
  }, [id, router])
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-40" />
    </div>
  )
}
