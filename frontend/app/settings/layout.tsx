'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import SettingsSidebar from '@/components/layout/SettingsSidebar'
import { useAuth } from '@/lib/auth/context'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  // Organization Setup (people & structure) and System Configuration (access rights,
  // audit) are both platform-administration in the four-layer model → gated by is_admin.
  const showOrganization = !!user?.is_admin
  const showSystem = !!user?.is_admin

  // Bounce users who can see neither module out of Settings.
  useEffect(() => {
    if (!user) return
    if (!showOrganization && !showSystem) router.replace('/dashboard')
  }, [user, showOrganization, showSystem, router])

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-56px)]">
        <SettingsSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          showOrganization={showOrganization}
          showSystem={showSystem}
        />
        {/* Scroll ownership (section 10, 11.5): this <main> is the window-height frame and
            the only scroller for a section of form cards. A section that holds a list or
            table gives its page root h-full (a flex column) and lets the table's data area
            scroll instead, so nothing scrolls twice. Each page root is the section 12.3
            content area: 1600px at most, centred. min-w-0 lets wide tables shrink. */}
        <main
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-8 py-8 scrollbar-gutter-stable transition-[margin] duration-200 ease-in-out [&>*]:mx-auto [&>*]:max-w-[1600px]"
          style={{ marginLeft: collapsed ? 64 : 240 }}
        >
          {children}
        </main>
      </div>
    </MainLayout>
  )
}
