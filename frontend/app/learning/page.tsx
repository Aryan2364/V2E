'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { Skeleton } from '@/components/ui/skeleton'

export default function LearningPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!user) return
    const isHR = !!user.is_admin
    router.replace(isHR ? '/learning/paths' : '/learning/my')
  }, [user, isLoading, router])

  return (
    <div className="min-h-[calc(100vh-56px)] p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
