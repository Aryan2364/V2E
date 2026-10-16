'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'

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
    <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
