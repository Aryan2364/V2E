'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import TaskModuleSidebar from '@/components/layout/TaskModuleSidebar'

interface ProjectTab {
  label: string
  href: string
  adminOnly?: boolean
}

const PROJECT_TABS: ProjectTab[] = [
  { label: 'Overview', href: '/dashboard/projects' },
  { label: 'My Projects', href: '/dashboard/projects/my' },
  { label: 'Managing', href: '/dashboard/projects/managing' },
  { label: 'Templates', href: '/dashboard/projects/templates', adminOnly: true },
]

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const isAdminOrHR = !!user?.is_admin
  // The TEST CLOCK is now a floating circular button (no reserved height), so the
  // shell can fill the full viewport below the top nav.

  function isActive(href: string): boolean {
    if (href === '/dashboard/projects') return pathname === '/dashboard/projects'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex gap-0 min-h-[calc(100vh-56px)] -mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
      {/* Same Task Management sidebar as the Tasks module — no menu swap. */}
      <TaskModuleSidebar />

      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 overflow-auto">
        {/* Projects section tabs (former projects sidebar items) */}
        <div className="flex items-center gap-0 border-b border-border-light overflow-x-auto mb-6">
          {PROJECT_TABS.map((t) => {
            if (t.adminOnly && !isAdminOrHR) return null
            const active = isActive(t.href)
            return (
              <Link
                key={t.href}
                href={t.href}
                className={[
                  'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  active
                    ? 'border-primary text-primary-text'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border',
                ].join(' ')}
              >
                {t.label}
              </Link>
            )
          })}
        </div>

        {children}
      </main>
    </div>
  )
}
