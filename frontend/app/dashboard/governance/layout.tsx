'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import { Lock } from 'lucide-react'
import GovernanceSidebar from '@/components/layout/GovernanceSidebar'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { governanceItemForPath } from '@/lib/governance-nav'

function LineItemDisabled({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-24 px-6">
      <div className="w-14 h-14 rounded-[16px] bg-danger-bg flex items-center justify-center text-danger">
        <Lock size={24} />
      </div>
      <h2 className="text-[18px] font-medium text-text-primary">{label} isn’t enabled</h2>
      <p className="text-body text-text-secondary max-w-sm">
        {label} is not part of your organization’s plan. Contact your administrator if you think this
        is a mistake.
      </p>
    </div>
  )
}

export default function GovernanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { loading, entitlements } = useEntitlements()

  // Guard the route, not just the nav: a disabled line item can't be reached by
  // typing its URL. Only block once entitlements have loaded (avoids a flash).
  const item = governanceItemForPath(pathname)
  const blocked = !!item && !loading && entitlements?.[item.entitlement] === 'off'

  return (
    <div className="flex gap-0 min-h-[calc(100vh-56px)] -mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
      <GovernanceSidebar />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 overflow-auto">
        {blocked ? <LineItemDisabled label={item!.label} /> : children}
      </main>
    </div>
  )
}
