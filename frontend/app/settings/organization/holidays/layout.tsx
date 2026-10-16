'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'

interface HolidayTab {
  label: string
  href: string
  adminOnly?: boolean
}

const HOLIDAY_TABS: HolidayTab[] = [
  { label: 'Org Calendar', href: '/settings/organization/holidays/org' },
  { label: 'Departments', href: '/settings/organization/holidays/departments' },
  { label: 'Individuals', href: '/settings/organization/holidays/individuals', adminOnly: true },
  { label: 'Configurations', href: '/settings/organization/holidays/configurations' },
  { label: 'Leave Rules', href: '/settings/organization/holidays/leave-rules', adminOnly: true },
]

/**
 * Holidays lives inside the Settings → Organization Setup module so the Settings
 * sidebar stays persistent (no menu swap). Sub-sections render as in-page tabs —
 * the same pattern used by the Tasks → Projects module.
 */
export default function HolidaysLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const isAdminOrHR = !!user?.is_admin

  function isActive(href: string): boolean {
    return pathname.startsWith(href)
  }

  return (
    <div>
      <div className="flex items-center gap-0 border-b border-border-light overflow-x-auto mb-6">
        {HOLIDAY_TABS.map((t) => {
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
    </div>
  )
}
