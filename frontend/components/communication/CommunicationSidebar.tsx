'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Layout, BookOpen, MessageSquare, FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { useEntitlements } from '@/lib/auth/use-entitlements'

interface CommunicationSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

interface NavItem {
  label: string
  href: string
  Icon: any
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
 * Dark Communication sidebar. Below md it is always the 64px icon rail (labels via
 * tooltip), matching the Work sidebar; from md up it honours the collapse toggle.
 * The layout mirrors these widths in its left margin.
 */
export default function CommunicationSidebar({ collapsed, onToggle }: CommunicationSidebarProps) {
  const pathname = usePathname()
  const { entitlements } = useEntitlements()

  // Fail closed: an entitlement-gated item stays hidden until the org's ceiling has
  // loaded, so a module the org hasn't bought never flashes in.
  const items = NAV.filter((i) => !i.module || (!!entitlements && entitlements[i.module] !== 'off'))

  return (
    <aside
      className={[
        'fixed left-0 top-14 h-[calc(100vh-56px)] bg-[#0F172A] flex flex-col z-40',
        'transition-[width] duration-200 ease-in-out overflow-hidden',
        collapsed ? 'w-16' : 'w-16 md:w-[240px]',
      ].join(' ')}
    >
      <div className="hidden md:flex h-12 items-center border-b border-white/10 shrink-0 px-2">
        {!collapsed && (
          <span className="flex-1 px-2 text-xs font-semibold text-[#94A3B8] uppercase tracking-widest whitespace-nowrap">
            Communication
          </span>
        )}
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition-colors shrink-0"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        </Tooltip>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {items.map(({ label, href, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Tooltip key={href} label={collapsed ? label : undefined}>
            <Link
              href={href}
              aria-label={label}
              className={[
                'flex items-center rounded-[8px] py-2.5 min-h-[44px] md:min-h-0 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                active
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="hidden md:inline">{label}</span>}
            </Link>
            </Tooltip>
          )
        })}
      </nav>
    </aside>
  )
}
