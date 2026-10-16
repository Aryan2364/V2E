'use client'

import { usePathname } from 'next/navigation'
import { Bell, Layout, BookOpen, MessageSquare, FileText } from 'lucide-react'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import ModuleSidebar, { ModuleSidebarItem } from '@/components/layout/ModuleSidebar'

interface CommunicationSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

interface NavItem {
  label: string
  href: string
  Icon: React.ElementType
  exact?: boolean
  /** Entitlement module that must not be `off` for the item to show (hidden until known). */
  module?: string
}

const NAV: NavItem[] = [
  { label: 'Announcements', href: '/communication/announcements', Icon: Bell },
  { label: 'Bulletin Boards', href: '/communication/bulletin', Icon: Layout },
  { label: 'Knowledge Hub', href: '/communication/knowledge', Icon: BookOpen },
  { label: 'Messages', href: '/communication/messages', Icon: MessageSquare },
  // Company Policy belongs to the Leave & Policies module (key `ecs`), sold separately.
  { label: 'Company Policy', href: '/communication/company-policy', Icon: FileText, module: 'ecs' },
]

/**
 * Communication module sidebar, migrated onto the shared ModuleSidebar
 * (FRONTEND_RULES.md §4 rule 2, §12.1 treatment) in place of a hand-rolled dark
 * sidebar. Still computes its own entitlement-filtered item list and active state.
 */
export default function CommunicationSidebar({ collapsed, onToggle }: CommunicationSidebarProps) {
  const pathname = usePathname()
  const { entitlements } = useEntitlements()

  // Fail closed: an entitlement-gated item stays hidden until the org's ceiling has
  // loaded, so a module the org hasn't bought never flashes in.
  const navItems = NAV.filter((i) => !i.module || (!!entitlements && entitlements[i.module] !== 'off'))

  const items: ModuleSidebarItem[] = navItems.map(({ label, href, Icon, exact }) => ({
    label,
    href,
    Icon,
    active: exact ? pathname === href : pathname.startsWith(href),
  }))

  return (
    <ModuleSidebar
      title="Communication"
      groups={[{ items }]}
      collapsed={collapsed}
      onToggle={onToggle}
      position="fixed"
    />
  )
}
