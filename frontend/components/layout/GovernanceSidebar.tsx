'use client'

import { usePathname } from 'next/navigation'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { GOVERNANCE_NAV } from '@/lib/governance-nav'
import ModuleSidebar from './ModuleSidebar'

const COLLAPSE_KEY = 'governance-sidebar-collapsed'

export default function GovernanceSidebar() {
  const pathname = usePathname()
  const { entitlements } = useEntitlements()
  // Fail closed: render no line items until the org's entitlement ceiling loads,
  // then show only the ones it's entitled to. Prevents a first-login / first-
  // switch flash of items the org didn't buy. Mirrors the Work sidebar.
  const navItems = entitlements
    ? GOVERNANCE_NAV.filter((item) => entitlements[item.entitlement] !== 'off')
    : []

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <ModuleSidebar
      title="Governance"
      collapseKey={COLLAPSE_KEY}
      groups={[
        {
          items: navItems.map(({ label, href, Icon }) => ({
            label,
            href,
            Icon,
            active: isActive(href),
          })),
        },
      ]}
    />
  )
}
