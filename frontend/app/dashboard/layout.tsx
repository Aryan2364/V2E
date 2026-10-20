'use client'

import { usePathname } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import TimeTravelBar from '@/components/dev/TimeTravelBar'

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The TEST CLOCK now collapses to a floating circular button, so it no longer
  // occupies layout height — no bottom space to reserve.
  const pathname = usePathname()
  // Work, Projects and Governance own their frame (a module sidebar beside the
  // content, with negative margins that cancel this padding), so they render bare. Every other
  // page gets the section 12.3 content area, 1600px maximum and centred (the
  // padding stays 32px at lg: pages with sticky bleed headers cancel exactly that).
  const ownsFrame = ['/dashboard/tasks', '/dashboard/projects', '/dashboard/governance'].some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  return (
    <MainLayout>
      {ownsFrame ? (
        children
      ) : (
        <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      )}
      <TimeTravelBar />
    </MainLayout>
  )
}
