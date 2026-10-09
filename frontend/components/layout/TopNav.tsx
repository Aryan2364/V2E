'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ChevronDown, Building2, Check, Menu, X, Settings, UserCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { GOVERNANCE_NAV } from '@/lib/governance-nav'
import { getMyOrgs } from '@/lib/api/auth'
import type { OrgMembership } from '@/lib/types'
import NotificationBell from './NotificationBell'
import { useSetupProgress } from '@/lib/hooks/useSetupProgress'
import Tooltip from '@/components/ui/Tooltip'

// `module` maps a nav item to its entitlement key. Items with no module are always
// shown (Dashboard). An `off` module is hidden; `preview` is shown with a badge.
const NAV_ITEMS: { label: string; href: string; module?: string }[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Goals', href: '/goals', module: 'goals' },
  { label: 'Learning', href: '/learning', module: 'learning' },
  { label: 'Process Hierarchy', href: '/dashboard/process-hierarchy', module: 'process_hierarchy' },
  { label: 'Communication', href: '/communication', module: 'communication' },
  { label: 'Work', href: '/dashboard/tasks', module: 'work' },
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

  // While entitlements are unknown the nav fails CLOSED (see the filter below):
  // gated tabs stay hidden until the org's ceiling loads, so a restricted org
  // never flashes modules it didn't buy. Cached/returning users have the map
  // warm on first render, so they see no flash.
  const workModules = ['tasks', 'projects', 'workflows', 'tickets', 'delegation'] as const
  const firstEnabledWorkModule = workModules.find((module) => entitlements?.[module] !== 'off')
  const workHref: Record<(typeof workModules)[number], string> = {
    tasks: '/dashboard/tasks',
    projects: '/dashboard/projects',
    workflows: '/dashboard/tasks/workflows',
    tickets: '/dashboard/tasks/tickets',
    delegation: '/dashboard/tasks/delegation',
  }
  // Governance is sold per line item; the tab shows when ANY item is enabled and
  // deep-links to the first enabled one.
  const firstEnabledGovernance = GOVERNANCE_NAV.find(
    (i) => entitlements?.[i.entitlement] !== 'off',
  )
  const visibleNav = NAV_ITEMS
    .filter((item) => {
      if (!item.module) return true
      // Fail closed: hide gated tabs until we actually know the org's ceiling.
      if (!entitlements) return false
      if (item.module === 'work') return !!firstEnabledWorkModule
      if (item.module === 'governance') return !!firstEnabledGovernance
      return entitlements[item.module] !== 'off'
    })
    .map((item) => {
      if (item.module === 'work' && firstEnabledWorkModule) {
        return { ...item, href: workHref[firstEnabledWorkModule] }
      }
      if (item.module === 'governance' && firstEnabledGovernance) {
        return { ...item, href: firstEnabledGovernance.href }
      }
      return item
    })
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

  // "Super Admin" is a property of the /super-admin portal, not of the firm app.
  // In the firm app the same account shows as its firm role (Administrator/Member),
  // so a super-admin who is also a firm admin gets the normal firm chrome + settings.
  const inSuperAdminPortal = pathname.startsWith('/super-admin')
  const roleLabel = inSuperAdminPortal
    ? 'Super Admin'
    : user?.is_admin
      ? 'Administrator'
      : 'Member'

  const currentOrg = orgs?.find((m) => m.organization_id === user?.organizationId)
  // Name · organization · role — shown on the avatar's tooltip and as its accessible
  // name, now that the bar itself no longer prints it.
  const identityLine = [user?.name, currentOrg?.organization.name, roleLabel]
    .filter(Boolean)
    .join(' · ')
  const otherOrgs = orgs?.filter((m) => m.organization_id !== user?.organizationId) ?? []

  // Settings (gear) is shown to anyone who owns at least the Organization Setup module.
  // System Configuration inside it is separately gated server-side + in the Settings sidebar.
  const canAccessSettings =
    !!user && !inSuperAdminPortal && (user.is_admin)

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
    <header className="fixed top-0 left-0 right-0 h-14 bg-[#2563EB] border-b border-[#1D4ED8] flex items-center z-50">
      {/* Hamburger — only below lg, where the horizontal nav is collapsed */}
      <button
        onClick={() => setDrawerOpen((v) => !v)}
        aria-label="Toggle navigation menu"
        aria-expanded={drawerOpen}
        className="lg:hidden shrink-0 ml-2 w-11 h-11 flex items-center justify-center rounded-[8px] text-white hover:bg-white/15 transition-colors"
      >
        {drawerOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Brand */}
      <Link href="/dashboard" className="shrink-0 px-3 sm:px-4 lg:pl-5 lg:pr-3">
        <span className="text-white font-bold text-lg tracking-tight select-none">V2E</span>
      </Link>

      {/* Nav tabs — the horizontal bar; collapses into the drawer below lg. */}
      <nav className="hidden lg:flex items-stretch flex-1 min-w-0 h-full">
        {visibleNav.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                // All tabs are solid white. The selected module is marked three ways so it
                // reads at a glance on the blue bar: a tinted full-height segment, a bolder
                // label, and the underline below. Inactive tabs get a lighter hover tint so
                // they still give feedback now that the text colour no longer changes.
                'relative px-2.5 xl:px-3 2xl:px-4 flex items-center gap-1.5 text-[13px] 2xl:text-sm whitespace-nowrap text-white transition-colors duration-150',
                active ? 'font-semibold bg-white/15' : 'font-medium hover:bg-white/10',
              ].join(' ')}
            >
              {item.label}
              {isPreview(item.module) && (
                <span className="rounded-[999px] bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-[10px] font-semibold px-1.5 py-px leading-none">
                  Preview
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-white rounded-t-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Spacer to push the right cluster over when the nav is collapsed */}
      <div className="flex-1 lg:hidden" />

      {/* Right cluster — notifications, settings, account. One row, uniform 40px
          hit targets and a single gap, so the controls read as one group instead
          of three separately-padded islands. */}
      <div className="flex items-center gap-1 shrink-0 pr-2 sm:pr-4">
        {/* Notification bell */}
        {user && !user.isSuperAdmin && <NotificationBell />}

        {/* Settings gear — persistent on every page, separate from the top nav */}
        {canAccessSettings && (
          <div className="relative shrink-0" ref={settingsContainerRef}>
            <Tooltip label="Settings">
              <Link
                href="/settings"
                aria-label="Settings"
                className={[
                  'w-10 h-10 flex items-center justify-center rounded-[8px] transition-colors relative z-50',
                  isActive('/settings')
                    ? 'text-white bg-white/20'
                    : 'text-white hover:bg-white/15',
                ].join(' ')}
              >
                <Settings size={19} />
                {showSpotlight && (
                  <span className="absolute inset-0 rounded-[8px] border-2 border-white animate-ping opacity-75 pointer-events-none" />
                )}
              </Link>
            </Tooltip>

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
                      href="/settings/organization/company"
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
          <div className="relative shrink-0" ref={menuRef}>
            {/* Trigger is the avatar alone — name / organization / role moved into the
                menu below, and onto this tooltip so hovering still identifies the account
                without the bar carrying a variable-width block of text. The tooltip is
                suppressed while the menu is open so it can't sit on top of it. */}
            <Tooltip label={open ? '' : identityLine}>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-label={`Account menu — ${identityLine}`}
                aria-expanded={open}
                className="flex items-center gap-1 rounded-[8px] pl-1 pr-0.5 py-1 hover:bg-white/15 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[#2563EB] text-xs font-bold shrink-0">
                  {initials}
                </div>
                <ChevronDown
                  size={14}
                  className={`text-white shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                />
              </button>
            </Tooltip>

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
              <div className="absolute right-0 top-[calc(100%+6px)] w-80 bg-white rounded-[10px] border border-[#E2E8F0] shadow-lg overflow-hidden z-50">
                {/* User identity. Organization + role for a firm user live in the
                    "Current Organization" block below (kept parallel with the Switch To
                    rows), so they aren't repeated here — except for a super admin, whose
                    org block is hidden and would otherwise never show a role. */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F1F5F9]">
                  <div className="w-10 h-10 rounded-full bg-[#2563EB] flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0F172A] truncate">{user.name}</p>
                    <p className="text-xs text-[#475569] truncate">{user.email}</p>
                    {user.isSuperAdmin && (
                      <span className="inline-block mt-1 rounded-[999px] bg-[#EFF6FF] text-[#2563EB] text-[10px] font-semibold px-2 py-px leading-[16px]">
                        {roleLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* My Profile — universal, available to every user */}
                {!user.isSuperAdmin && (
                  <div className="p-2 border-b border-[#F1F5F9]">
                    <Link
                      href="/dashboard/profile"
                      onClick={() => setOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm font-medium text-[#1E293B] hover:bg-[#F8FAFC] transition-colors"
                    >
                      <UserCircle size={15} className="text-[#64748B]" />
                      My Profile
                    </Link>
                  </div>
                )}

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
                          <Tooltip label="Open organization settings">
                          <Link
                            href="/settings/organization/company"
                            onClick={() => setOpen(false)}
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
                          </Tooltip>
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
      </div>

      {/* Mobile / tablet nav drawer */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 top-14 bg-black/30 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Panel */}
          <nav className="lg:hidden absolute top-14 left-0 right-0 bg-white border-b border-[#E2E8F0] shadow-lg z-50 py-2 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
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
