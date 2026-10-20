'use client'

import React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

/**
 * The Work log section's route tabs, passed to each page's PageHeader as
 * `tabs` so they sit directly under the title (kit 12, 33.2). The Governance
 * sidebar stays persistent; these switch between sibling routes.
 */
export default function WorkLogTabs() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const isAdminOrHR = !!user?.is_admin

  const visible = TABS.filter((t) => !t.adminOnly || isAdminOrHR)
  const active =
    visible.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? visible[0].href

  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        if (typeof next === 'string' && next !== active) router.push(next)
      }}
      className="mb-6"
    >
      <TabsList>
        {visible.map((t) => (
          <TabsTrigger key={t.href} value={t.href}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
