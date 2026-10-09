'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Eye, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import TopNav from './TopNav'

// Route prefix → entitlement module (longest match wins). Mirrors the top nav.
const ROUTE_MODULES: { prefix: string; module: string; label: string }[] = [
  { prefix: '/dashboard/tasks/tickets', module: 'tickets', label: 'Tickets' },
  { prefix: '/dashboard/tasks/workflows', module: 'workflows', label: 'Workflows' },
  { prefix: '/dashboard/projects', module: 'projects', label: 'Projects' },
  { prefix: '/dashboard/tasks', module: 'tasks', label: 'Tasks' },
  // Leave & Policies (module key `ecs`) has no section of its own any more: its pages
  // live inside Work and Communication, so they are mapped here explicitly (the
  // longer prefix beats /dashboard/tasks and /communication). My Leave is a tab on
  // the always-available profile page and gates itself.
  { prefix: '/dashboard/tasks/leave-approvals', module: 'ecs', label: 'Leave & Policies' },
  { prefix: '/communication/company-policy', module: 'ecs', label: 'Leave & Policies' },
  // Governance is gated per line item inside its own layout (governance/layout.tsx),
  // not at the module level — so it's intentionally absent here.
  { prefix: '/dashboard/performance', module: 'performance', label: 'Performance' },
  { prefix: '/goals', module: 'goals', label: 'Goals' },
  { prefix: '/learning', module: 'learning', label: 'Learning' },
  { prefix: '/communication', module: 'communication', label: 'Communication' },
]

function moduleForPath(pathname: string) {
  return ROUTE_MODULES.filter(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0]
}

function ModuleDisabled({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-24 px-6">
      <div className="w-14 h-14 rounded-[16px] bg-[#FEE2E2] flex items-center justify-center text-[#DC2626]">
        <Lock size={24} />
      </div>
      <h2 className="text-[18px] font-semibold text-[#0F172A]">{label} isn’t enabled</h2>
      <p className="text-sm text-[#475569] max-w-sm">
        The {label} module is not part of your organization’s plan. Contact your administrator if you
        think this is a mistake.
      </p>
    </div>
  )
}

function PreviewNotice({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 text-sm text-[#92400E] sm:px-6 lg:px-8">
      <Eye size={15} className="shrink-0" />
      <span><strong>{label}</strong> is in preview mode. You can view content, but changes are disabled.</span>
    </div>
  )
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { loading: entLoading, state } = useEntitlements()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) return null

  const current = moduleForPath(pathname)
  // Block a module route only once we know its entitlement is `off`.
  const blocked = current && !entLoading && state(current.module) === 'off'
  const preview = current && !entLoading && state(current.module) === 'preview'

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <TopNav />
      <div className="pt-14">
        {blocked ? (
          <ModuleDisabled label={current!.label} />
        ) : (
          <>
            {preview && <PreviewNotice label={current!.label} />}
            {children}
          </>
        )}
      </div>
    </div>
  )
}
