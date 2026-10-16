'use client'

import React, { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import Sidebar, { type SidebarRole } from './Sidebar'

interface DashboardLayoutProps {
  children: React.ReactNode
  title: string
  subtitle?: string
  sidebarRole?: SidebarRole
}

export default function DashboardLayout({
  children,
  title,
  subtitle,
  sidebarRole,
}: DashboardLayoutProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the mobile nav drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Inside the firm app (/dashboard) the shell is ALWAYS the firm shell — driven by
  // the org role (admin/member), never the platform super-admin shell. The super-admin
  // portal (/super-admin) passes sidebarRole="super_admin" explicitly. This is what
  // lets one account be both a platform super admin AND a firm admin: super-admin is a
  // property of the /super-admin portal, not something that hijacks the firm shell when
  // `isSuperAdmin` is true (e.g. after a token refresh rehydrates it from the DB).
  const role: SidebarRole = sidebarRole ?? (user?.is_admin ? 'admin' : 'member')

  return (
    <div className="min-h-screen bg-surface-sunken">
      <Sidebar role={role} mobileOpen={drawerOpen} onMobileClose={() => setDrawerOpen(false)} />

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-shell"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className="ml-0 md:ml-[240px] min-h-screen flex flex-col">
        {/* Mobile top bar with hamburger — sidebar is off-canvas below md */}
        <div className="md:hidden sticky top-0 z-sticky flex items-center gap-2 h-14 px-4 bg-surface border-b border-border-light">
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpen}
            className="w-11 h-11 -ml-2 flex items-center justify-center rounded-[8px] text-text-secondary hover:text-text-primary hover:bg-surface-control transition-colors"
          >
            {drawerOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="text-text-primary font-medium text-[18px] tracking-tight select-none">V2E</span>
        </div>

        {title && (
          <header className="px-4 sm:px-6 md:px-8 pt-6 md:pt-8 pb-4">
            <h1 className="text-page-title font-medium text-text-primary leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-[15px] text-text-secondary">{subtitle}</p>
            )}
          </header>
        )}

        <div className="flex-1 px-4 sm:px-6 md:px-8 pb-8">{children}</div>
      </main>
    </div>
  )
}
