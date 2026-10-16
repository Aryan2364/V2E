'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import DashboardLayout from '@/components/layout/DashboardLayout'

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && (!user || !user.isSuperAdmin)) {
      router.replace('/login')
    }
  }, [user, isLoading, router])

  if (isLoading) {
    // Checking the session — render nothing rather than a spinner (section 14 rule 1).
    return <div className="min-h-screen bg-surface-sunken" />
  }

  if (!user || !user.isSuperAdmin) {
    return null
  }

  return (
    <DashboardLayout title="" sidebarRole="super_admin">
      {children}
    </DashboardLayout>
  )
}
