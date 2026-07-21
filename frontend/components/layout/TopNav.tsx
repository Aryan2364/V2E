'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ChevronDown, Building2, Check, Menu, X, Settings } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { getMyOrgs } from '@/lib/api/auth'
import type { OrgMembership } from '@/lib/types'
import NotificationBell from './NotificationBell'
import { useSetupProgress } from '@/lib/hooks/useSetupProgress'

// `module` maps a nav item to its entitlement key. Items with no module are always
// shown (Dashboard). An `off` module is hidden; `preview` is shown with a badge.
const NAV_ITEMS: { label: string; href: string; module?: string }[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Goals', href: '/goals', module: 'goals' },
  { label: 'Learning', href: '/learning', module: 'learning' },
  { label: 'Process Hierarchy', href: '/dashboard/process-hierarchy', module: 'process_hierarchy' },
  { label: 'Communication', href: '/communication', module: 'communication' },
  { label: 'Work', href: '/dashboard/tasks', module: 'work' },
  { label: 'ESS', href: '/dashboard/ecs', module: 'ecs' },
  { label: 'Governance', href: '/dashboard/governance', module: 'governance' },
  { label: 'Performance', href: '/dashboard/performance', module: 'performance' },
]

export default function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout, switchOrg } = useAuth()

  const [open, setOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const { entitlements } = useEntitlements()
  const menuRef = useRef<HTMLDivElement>(null)
  const settingsContainerRef = useRef<HTMLDivElement>(null)

  const { steps, isLoading: progressLoading } = useSetupProgress(user?.organizationId ?? '')
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined' && user?.id) {
      const dismissedAtStr = localStorage.getItem(`v2e_setup_dismissed_at_${user.id}`)
      if (dismissedAtStr) {
        const dismissedAt = new Date(dismissedAtStr)
        const oneDayMs = 24 * 60 * 60 * 1000
        const isExpired = Date.now() - dismissedAt.getTime() > oneDayMs
        setDismissed(!isExpired)
      } else {
        setDismissed(false)
      }
    }
  }, [user?.id])

  const handleDismiss = () => {
    if (user?.id) {
      localStorage.setItem(`v2e_setup_dismissed_at_${user.id}`, new Date().toISOString())
    }
    setDismissed(true)
  }

  // Close the mobile nav drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Load orgs for multi-org switcher
  useEffect(() => {
    if (user && !user.isSuperAdmin && user.organizationId) {
      getMyOrgs().then(setOrgs).catch(() => setOrgs([]))
    }
  }, [user?.organizationId])

  // Until entitlements load, show everything (avoids a flash of missing tabs).
  const workModules = ['tasks', 'projects', 'workflows', 'tickets', 'delegation'] as const
  const firstEnabledWorkModule = workModules.find((module) => entitlements?.[module] !== 'off')
  const workHref: Record<(typeof workModules)[number], string> = {
    tasks: '/dashboard/tasks',
    projects: '/dashboard/projects',
    workflows: '/dashboard/tasks/workflows',
    tickets: '/dashboard/tasks/tickets',
    delegation: '/dashboard/tasks/delegation',
  }
  const visibleNav = NAV_ITEMS
    .filter((item) => {
      if (!item.module || !entitlements) return true
      if (item.module === 'work') return !!firstEnabledWorkModule
      return entitlements[item.module] !== 'off'
    })
    .map((item) =>
      item.module === 'work' && firstEnabledWorkModule
        ? { ...item, href: workHref[firstEnabledWorkModule] }
        : item,
    )
  const isPreview = (module?: string) => !!module && entitlements?.[module] === 'preview'

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const roleLabel = user?.isSuperAdmin
    ? 'Super Admin'
    : user?.is_admin
      ? 'Administrator'
      : 'Member'

  const currentOrg = orgs?.find((m) => m.organization_id === user?.organizationId)
  const otherOrgs = orgs?.filter((m) => m.organization_id !== user?.organizationId) ?? []

  // Settings (gear) is shown to anyone who owns at least the Organization Setup module.
  // System Configuration inside it is separately gated server-side + in the Settings sidebar.
  const canAccessSettings =
    !!user && !user.isSuperAdmin && (user.is_admin)

  const employeesStep = steps.find((s) => s.id === 'employees')
  const employeesCreated = employeesStep ? employeesStep.completed : false

  const showSpotlight = canAccessSettings && !employeesCreated && !progressLoading && !dismissed && pathname === '/dashboard'

  async function handleSwitch(orgId: string) {
    setSwitching(orgId)
    try {
      await switchOrg(orgId)
      setOpen(false)
      router.push('/dashboard')
    } catch {
      // ignore
    } finally {
      setSwitching(null)
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-[#E2E8F0] flex items-center z-50">
      {/* Hamburger — only below xl, where the horizontal nav is collapsed */}
      <button
        onClick={() => setDrawerOpen((v) => !v)}
        aria-label="Toggle navigation menu"
        aria-expanded={drawerOpen}
        className="xl:hidden shrink-0 ml-2 w-11 h-11 flex items-center justify-center rounded-[8px] text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
      >
        {drawerOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Brand */}
      <Link href="/dashboard" className="shrink-0 px-3 sm:px-4 xl:pl-6 xl:pr-4">
        <span className="text-[#0F172A] font-bold text-lg tracking-tight select-none">V2E</span>
      </Link>

      {/* Nav tabs — full horizontal bar only on wide desktops */}
      <nav className="hidden xl:flex items-stretch flex-1 h-full">
        {visibleNav.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'relative px-3 2xl:px-4 flex items-center gap-1.5 text-[13px] 2xl:text-sm font-medium whitespace-nowrap transition-colors duration-150',
                active ? 'text-[#2563EB]' : 'text-[#64748B] hover:text-[#0F172A]',
              ].join(' ')}
            >
              {item.label}
              {isPreview(item.module) && (
                <span className="rounded-[999px] bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-[10px] font-semibold px-1.5 py-px leading-none">
                  Preview
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#2563EB] rounded-t-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Spacer to push the right cluster over when the nav is collapsed */}
      <div className="flex-1 xl:hidden" />

      {/* Notification bell */}
      {user && !user.isSuperAdmin && <NotificationBell />}

      {/* Settings gear — persistent on every page, separate from the top nav */}
      {canAccessSettings && (
        <div className="relative shrink-0" ref={settingsContainerRef}>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className={[
              'w-10 h-10 flex items-center justify-center rounded-[8px] transition-colors relative z-50',
              isActive('/settings')
                ? 'text-[#2563EB] bg-[#EFF6FF]'
                : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]',
            ].join(' ')}
          >
            <Settings size={19} />
            {showSpotlight && (
              <span className="absolute inset-0 rounded-[8px] border-2 border-[#2563EB] animate-ping opacity-75 pointer-events-none" />
            )}
          </Link>

          {/* Onboarding Spotlight Popover */}
          {showSpotlight && (
            <div className="absolute right-0 mt-3 w-80 bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_10px_25px_rgba(0,0,0,0.1)] p-5 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Arrow pointer */}
              <div className="absolute right-3.5 -top-1.5 w-3 h-3 bg-white border-t border-l border-[#E2E8F0] rotate-45" />

              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-[#0F172A]">Configure Workspace</p>
                <p className="text-xs text-[#475569] leading-relaxed">
                  Welcome, <span className="font-medium text-[#0F172A]">{user?.name ? user.name.split(' ')[0] : 'Admin'}</span>! Let&apos;s get your workspace configured. Click the Settings icon to define your vision, departments, and add employees.
                </p>
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="text-xs font-medium text-[#64748B] hover:text-[#0F172A] px-3 py-1.5 rounded-[6px] hover:bg-[#F1F5F9] transition-colors"
                  >
                    Dismiss
                  </button>
                  <Link
                    href="/setup/step-1-identity"
                    onClick={handleDismiss}
                    className="text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3.5 py-1.5 rounded-[6px] transition-colors"
                  >
                    Start Setup
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User menu */}
      {user && (
        <div className="relative px-3 sm:px-4 shrink-0" ref={menuRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-[#F1F5F9] transition-colors max-w-[52vw]"
          >
            {/* Cap + truncate so a long org name can't push the avatar off-screen */}
            <div className="text-right hidden sm:block min-w-0 max-w-[150px] lg:max-w-[200px] xl:max-w-[240px]">
              <p className="text-sm font-semibold text-[#0F172A] leading-tight truncate">{user.name}</p>
              <p className="text-xs text-[#64748B] leading-tight truncate">
                {currentOrg?.organization.name
                  ? `${currentOrg.organization.name} · ${roleLabel}`
                  : roleLabel}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#2563EB] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <ChevronDown
              size={14}
              className={`text-[#94A3B8] shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Backdrop — captures any outside click so the menu closes reliably,
              even over elements (e.g. the ReactFlow canvas) that swallow mousedown. */}
          {open && (
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />
          )}

          {/* Dropdown */}
          {open && (
            <div className="absolute right-4 top-[calc(100%+6px)] w-64 bg-white rounded-[10px] border border-[#E2E8F0] shadow-lg overflow-hidden z-50">
              {/* User identity */}
              <div className="px-4 py-3 border-b border-[#F1F5F9]">
                <p className="text-sm font-semibold text-[#0F172A] truncate">{user.name}</p>
                <p className="text-xs text-[#64748B] truncate">{user.email}</p>
              </div>

              {/* Org section — hidden for super admin */}
              {!user.isSuperAdmin && user.organizationId && (
                <>
                  {/* Current org */}
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                      Current Organization
                    </p>
                    {orgs === null ? (
                      <div className="flex items-center gap-2 py-1.5">
                        <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-[#64748B]">Loading…</span>
                      </div>
                    ) : currentOrg ? (
                      canAccessSettings ? (
                        <Link
                          href="/settings/organization/company"
                          onClick={() => setOpen(false)}
                          title="Open organization settings"
                          className="flex items-center gap-2.5 py-1.5 -mx-1 px-1 rounded-[6px] hover:bg-[#F8FAFC] transition-colors"
                        >
                          <div className="w-6 h-6 rounded-[5px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
                            <Building2 size={13} className="text-[#2563EB]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#0F172A] truncate">{currentOrg.organization.name}</p>
                            <p className="text-xs text-[#64748B]">{currentOrg.is_admin ? 'Administrator' : 'Member'}</p>
                          </div>
                          <Settings size={14} className="text-[#94A3B8] shrink-0" />
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2.5 py-1">
                          <div className="w-6 h-6 rounded-[5px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
                            <Building2 size={13} className="text-[#2563EB]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#0F172A] truncate">{currentOrg.organization.name}</p>
                            <p className="text-xs text-[#64748B]">{currentOrg.is_admin ? 'Administrator' : 'Member'}</p>
                          </div>
                          <Check size={14} className="text-[#2563EB] shrink-0" />
                        </div>
                      )
                    ) : null}
                  </div>

                  {/* Other orgs */}
                  {otherOrgs.length > 0 && (
                    <div className="px-4 pt-2 pb-1 border-t border-[#F1F5F9] mt-1">
                      <p className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                        Switch To
                      </p>
                      {otherOrgs.map((m) => {
                        const isLoading = switching === m.organization_id
                        return (
                          <button
                            key={m.organization_id}
                            onClick={() => handleSwitch(m.organization_id)}
                            disabled={!!switching}
                            className="w-full flex items-center gap-2.5 py-2 rounded-[6px] hover:bg-[#F8FAFC] disabled:opacity-50 transition-colors text-left px-1"
                          >
                            <div className="w-6 h-6 rounded-[5px] bg-[#F1F5F9] flex items-center justify-center shrink-0">
                              <Building2 size={13} className="text-[#64748B]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0F172A] truncate">{m.organization.name}</p>
                              <p className="text-xs text-[#64748B]">{m.is_admin ? 'Administrator' : 'Member'}</p>
                            </div>
                            {isLoading && (
                              <div className="w-3.5 h-3.5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Settings lives in the persistent gear icon (top bar) — not duplicated
                  here. The avatar menu stays focused on identity, org switching, and
                  the contextual "manage current org" shortcut above. */}

              {/* Sign out */}
              <div className="border-t border-[#F1F5F9] p-2">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile / tablet nav drawer */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="xl:hidden fixed inset-0 top-14 bg-black/30 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Panel */}
          <nav className="xl:hidden absolute top-14 left-0 right-0 bg-white border-b border-[#E2E8F0] shadow-lg z-50 py-2 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
            {visibleNav.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={[
                    'flex items-center gap-2 min-h-[44px] px-5 text-[15px] font-medium border-l-[3px] transition-colors',
                    active
                      ? 'text-[#2563EB] border-[#2563EB] bg-[#EFF6FF]'
                      : 'text-[#1E293B] border-transparent hover:bg-[#F1F5F9]',
                  ].join(' ')}
                >
                  {item.label}
                  {isPreview(item.module) && (
                    <span className="rounded-[999px] bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-[10px] font-semibold px-1.5 py-px leading-none">
                      Preview
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </>
      )}
    </header>
  )
}
