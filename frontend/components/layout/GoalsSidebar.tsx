'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  CheckCircle2,
  LayoutDashboard,
  LayoutGrid,
  Network,
  Target,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { goalsApi } from '@/lib/api/goals'
import ModuleSidebar from './ModuleSidebar'

const NAV_ITEMS = [
  { key: 'list', label: 'Goals', href: '/goals/list', Icon: Target },
  { key: 'checkins', label: 'My check-ins', href: '/goals/my-check-ins', Icon: CheckCircle2 },
  { key: 'scorecard', label: 'Balance scorecard', href: '/goals/scorecard', Icon: LayoutGrid },
  { key: 'strategy-map', label: 'Strategic map', href: '/goals/strategy-map', Icon: Network },
  { key: 'dashboard', label: 'Dashboard', href: '/goals/dashboard', Icon: LayoutDashboard },
]

const COLLAPSE_KEY = 'goals-sidebar-collapsed'

/**
 * Dark "Goals" module sidebar — same shell as TaskModuleSidebar (the Work menu)
 * so the two modules feel identical. Collapse state persists in localStorage so
 * it survives navigating into a goal detail page and back.
 *
 * The count on "My check-ins" is what pulls the eye when something is owed —
 * the cheap, always-visible half of the reminder (the other half is the
 * nightly notification).
 */
export default function GoalsSidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [dueCount, setDueCount] = useState(0)

  const refreshCount = useCallback(() => {
    if (!orgId) return
    goalsApi
      .myCheckInCount(orgId)
      .then(setDueCount)
      .catch(() => setDueCount(0))
  }, [orgId])

  // Re-read on every navigation inside the module, so recording a check-in
  // updates the badge without a page reload.
  useEffect(() => {
    refreshCount()
  }, [refreshCount, pathname])

  return (
    <ModuleSidebar
      title="Goals"
      collapseKey={COLLAPSE_KEY}
      groups={[
        {
          items: NAV_ITEMS.map(({ key, label, href, Icon }) => ({
            key,
            label,
            href,
            Icon,
            active: pathname === href || pathname.startsWith(href + '/'),
            badge: key === 'checkins' ? dueCount : 0,
          })),
        },
      ]}
    />
  )
}
