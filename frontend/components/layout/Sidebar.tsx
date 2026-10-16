'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Building2,
  Users,
  LayoutDashboard,
  LogOut,
  ChevronUp,
  Check,
  Layers,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getMyOrgs } from '@/lib/api/auth'
import type { OrgMembership } from '@/lib/types'

export type SidebarRole = 'super_admin' | 'admin' | 'member'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

interface SidebarProps {
  role: SidebarRole
  orgId?: string
  /** Controlled mobile drawer state — open/visible below md. Always visible from md up. */
  mobileOpen?: boolean
  /** Called when a nav item is tapped (close the mobile drawer). */
  onMobileClose?: () => void
}

const superAdminNav: NavItem[] = [
  { label: 'Dashboard', href: '/super-admin', icon: <LayoutDashboard size={18} /> },
  { label: 'Organizations', href: '/super-admin/organizations', icon: <Building2 size={18} /> },
  { label: 'Groups', href: '/super-admin/groups', icon: <Layers size={18} /> },
  { label: 'Admins', href: '/super-admin/admins', icon: <Users size={18} /> },
]

const navByRole: Record<SidebarRole, NavItem[]> = {
  super_admin: superAdminNav,
  admin: superAdminNav,
  member: superAdminNav,
}

export default function Sidebar({ role, mobileOpen = false, onMobileClose }: SidebarProps) {
  const { user, logout, switchOrg } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false)
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const navItems = navByRole[role] ?? superAdminNav

  // Eagerly load orgs so the current org name is visible without opening the switcher.
  // Gate on the FIRM shell (role !== super_admin) + a current org — not on isSuperAdmin,
  // so a super-admin who is also a firm member still sees their firm name and switcher.
  useEffect(() => {
    if (user && role !== 'super_admin' && user.organizationId) {
      getMyOrgs().then(setOrgs).catch(() => setOrgs([]))
    }
  }, [user?.organizationId, role])

  const isActive = (href: string): boolean => {
    if (href === '/dashboard' || href === '/super-admin') return pathname === href
    return pathname.startsWith(href)
  }

  function handleOrgSwitcherOpen() {
    setShowOrgSwitcher((v) => !v)
  }

  async function handleOrgSwitch(orgId: string) {
    if (orgId === user?.organizationId) {
      setShowOrgSwitcher(false)
      return
    }
    setSwitching(orgId)
    try {
      await switchOrg(orgId)
      setShowOrgSwitcher(false)
      router.push('/dashboard')
    } catch {
      // ignore
    } finally {
      setSwitching(null)
    }
  }

  const currentOrgName = orgs?.find((m) => m.organization_id === user?.organizationId)?.organization?.name

  return (
    <aside
      className={[
        'fixed left-0 top-0 h-full w-[240px] bg-[#0F172A] flex flex-col z-50',
        'transition-transform duration-200 ease-out md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-white/10 shrink-0">
        <span className="text-white font-bold text-xl tracking-tight select-none">V2E</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              className={[
                'flex items-center gap-3 rounded-[8px] px-3 min-h-[44px] py-2 text-sm font-medium transition-colors duration-150',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                active
                  ? 'bg-primary text-white'
                  : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              <span className="shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Org Switcher — shown in the firm shell (not the super-admin portal) */}
      {user && role !== 'super_admin' && user.organizationId && (
        <div className="shrink-0 border-t border-white/10">
          <button
            onClick={handleOrgSwitcherOpen}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#1E293B] transition-colors"
          >
            <div className="w-7 h-7 rounded-[6px] bg-primary flex items-center justify-center shrink-0">
              <Building2 size={14} className="text-white" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[12px] text-text-muted leading-none mb-0.5">Organization</p>
              <p className="text-[13px] text-[#CBD5E1] font-medium truncate leading-tight">
                {currentOrgName ?? '—'}
              </p>
            </div>
            <ChevronUp
              size={14}
              className={`text-text-muted shrink-0 transition-transform ${showOrgSwitcher ? '' : 'rotate-180'}`}
            />
          </button>

          {/* Dropdown */}
          {showOrgSwitcher && (
            <div className="mx-3 mb-2 bg-[#1E293B] rounded-[8px] overflow-hidden">
              {!orgs ? (
                <div className="px-3 py-4 text-center">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : orgs.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-text-muted">No other organizations</p>
              ) : (
                orgs.map((m) => {
                  const isCurrent = m.organization_id === user.organizationId
                  const isLoading = switching === m.organization_id
                  return (
                    <button
                      key={m.organization_id}
                      onClick={() => handleOrgSwitch(m.organization_id)}
                      disabled={!!switching}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#0F172A]/60 transition-colors disabled:opacity-60"
                    >
                      <div className="w-6 h-6 rounded-[4px] bg-[#0F172A] flex items-center justify-center shrink-0">
                        <Building2 size={12} className="text-text-muted" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[12px] text-[#CBD5E1] font-medium truncate">{m.organization.name}</p>
                        <p className="text-[11px] text-text-muted capitalize">{m.is_admin ? 'Administrator' : 'Member'}</p>
                      </div>
                      {isCurrent && !isLoading && <Check size={12} className="text-primary-text shrink-0" />}
                      {isLoading && <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* User footer */}
      <div className="shrink-0 border-t border-white/10 p-4 flex flex-col gap-3">
        {user && (
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-white text-sm font-medium truncate leading-tight">
              {user.name}
            </p>
            <span className="inline-flex self-start items-center rounded-[999px] bg-[#1E293B] text-text-muted text-[11px] font-medium px-2 py-0.5">
              {role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Administrator' : 'Member'}
            </span>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full rounded-[8px] px-3 py-2 text-sm text-[#CBD5E1] hover:text-white hover:bg-[#1E293B] transition-colors duration-150"
        >
          <LogOut size={16} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
