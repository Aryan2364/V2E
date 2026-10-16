'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'

/**
 * Entry point for the Settings area. Admins land on Organization Setup; everyone
 * else is bounced back to the dashboard (Settings is platform administration).
 */
export default function SettingsIndexPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin

  useEffect(() => {
    if (!user) return
    router.replace(isAdmin ? '/settings/organization/company' : '/dashboard')
  }, [user, isAdmin, router])

  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
