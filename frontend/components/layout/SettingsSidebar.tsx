'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  Heart,
  GitBranch,
  Briefcase,
  Users,
  CalendarDays,
  ShieldCheck,
  ScrollText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

interface SettingsSidebarProps {
  collapsed: boolean
  onToggle: () => void
  /** Organization Setup group — HR-handoverable, people & structure config. */
  showOrganization: boolean
  /** System Configuration group — admin/IT only, who-can-do-what. */
  showSystem: boolean
}

interface NavItem {
  label: string
  href: string
  Icon: typeof Building2
}

interface NavGroup {
  title: string
  items: NavItem[]
}

// Organization Setup — handed over to HR. Low blast radius.
const ORGANIZATION_ITEMS: NavItem[] = [
  { label: 'Identity', href: '/settings/organization/company', Icon: Building2 },
  { label: 'Culture', href: '/settings/organization/culture', Icon: Heart },
  { label: 'Department Structure', href: '/settings/organization/structure', Icon: GitBranch },
  { label: 'Job Roles', href: '/settings/organization/roles', Icon: Briefcase },
  { label: 'Employees', href: '/settings/organization/employees', Icon: Users },
  { label: 'Holidays', href: '/settings/organization/holidays', Icon: CalendarDays },
]

// System Configuration — stays with admin/IT. High blast radius.
const SYSTEM_ITEMS: NavItem[] = [
  { label: 'Access Rights', href: '/settings/system/access-rights', Icon: ShieldCheck },
  { label: 'Audit Logs', href: '/settings/system/audit-logs', Icon: ScrollText },
]

export default function SettingsSidebar({
  collapsed,
  onToggle,
  showOrganization,
  showSystem,
}: SettingsSidebarProps) {
  const pathname = usePathname()

  const groups: NavGroup[] = []
  if (showOrganization) groups.push({ title: 'Organization Setup', items: ORGANIZATION_ITEMS })
  if (showSystem) groups.push({ title: 'System Configuration', items: SYSTEM_ITEMS })

  return (
    <aside
      className={[
        'fixed left-0 top-14 h-[calc(100vh-56px)] bg-[#0F172A] flex flex-col z-40',
        'transition-[width] duration-200 ease-in-out overflow-hidden',
        collapsed ? 'w-16' : 'w-[240px]',
      ].join(' ')}
    >
      {/* Toggle button row */}
      <div className="h-12 flex items-center border-b border-white/10 shrink-0 px-2">
        {!collapsed && (
          <span className="flex-1 px-2 text-xs font-semibold text-text-muted uppercase tracking-widest whitespace-nowrap">
            Settings
          </span>
        )}
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-text-muted hover:text-white hover:bg-[#1E293B] transition-colors shrink-0"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </Tooltip>
      </div>

      {/* Nav groups */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-1">
        {groups.map((group, gi) => (
          <div key={group.title} className={gi > 0 ? 'mt-3 pt-3 border-t border-white/10' : ''}>
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-widest whitespace-nowrap">
                {group.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ label, href, Icon }) => {
                const active = pathname.startsWith(href)
                return (
                  <Tooltip key={href} label={collapsed ? label : undefined}>
                  <Link
                    href={href}
                    className={[
                      'flex items-center rounded-[8px] py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                      collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                      active
                        ? 'bg-primary text-white'
                        : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
                    ].join(' ')}
                  >
                    <Icon size={18} className="shrink-0" />
                    {!collapsed && <span>{label}</span>}
                  </Link>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
