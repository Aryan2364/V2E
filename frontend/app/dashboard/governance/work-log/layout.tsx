'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'

interface WorkLogTab {
  label: string
  href: string
  adminOnly?: boolean
}

const TABS: WorkLogTab[] = [
  { label: 'Review', href: '/dashboard/governance/work-log/review' },
  { label: 'Demands', href: '/dashboard/governance/work-log/demands' },
  { label: 'Access', href: '/dashboard/governance/work-log/access', adminOnly: true },
]

// Work Log lives in the Governance menu. Its sections render as in-page tabs (the
// same pattern as Foundation → Holidays) so the Governance sidebar stays persistent.
export default function WorkLogLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const isAdminOrHR = !!user?.is_admin

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <div>
      <h1 className="text-[28px] font-medium text-text-primary mb-4">Work Log</h1>
      <div className="flex items-center gap-0 border-b border-border-light overflow-x-auto mb-6">
        {TABS.map((t) => {
          if (t.adminOnly && !isAdminOrHR) return null
          const active = isActive(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                'px-4 py-2.5 text-body font-medium whitespace-nowrap border-b-2 transition-colors',
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
