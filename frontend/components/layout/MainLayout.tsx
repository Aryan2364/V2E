'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Eye, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { useLayout } from '@/lib/layout'
import PhoneShell from '@/components/phone/PhoneShell'
import { ProgressBar, ProgressProvider } from '@/components/shell/progress-bar'
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
      <div className="w-14 h-14 rounded-[16px] bg-danger-bg flex items-center justify-center text-danger">
        <Lock size={24} />
      </div>
      <h2 className="text-card-heading font-medium text-text-primary">{label} isn’t enabled</h2>
      <p className="text-sm text-text-secondary max-w-sm">
        The {label} module is not part of your organization’s plan. Contact your administrator if you
        think this is a mistake.
      </p>
    </div>
  )
}

function PreviewNotice({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-sm text-warning sm:px-6 lg:px-8">
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
  const { layout } = useLayout()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-sunken flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) return null

  // FRONTEND_RULES_PHONE.md 41.3: on a phone the product has its own layout.
  // The phone shell chooses the screen for this address itself (phone screens
  // from lib/phone-routes.ts, the computer-only page for everything else), so
  // the desktop shell and the desktop page below are never mounted on a phone.
  if (layout === 'phone') return <PhoneShell />

  const current = moduleForPath(pathname)
  // Block a module route only once we know its entitlement is `off`.
  const blocked = current && !entLoading && state(current.module) === 'off'
  const preview = current && !entLoading && state(current.module) === 'preview'

  return (
    <ProgressProvider>
      <div className="min-h-screen bg-surface-sunken">
        <TopNav />
        <ProgressBar className="fixed top-14 left-0 right-0" />
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
    </ProgressProvider>
  )
}
