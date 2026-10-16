'use client'

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
} from 'lucide-react'
import ModuleSidebar, { type ModuleSidebarGroup } from './ModuleSidebar'

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

  const groups: ModuleSidebarGroup[] = []
  if (showOrganization) {
    groups.push({
      label: 'Organization Setup',
      items: ORGANIZATION_ITEMS.map(({ label, href, Icon }) => ({
        label,
        href,
        Icon,
        active: pathname.startsWith(href),
      })),
    })
  }
  if (showSystem) {
    groups.push({
      label: 'System Configuration',
      items: SYSTEM_ITEMS.map(({ label, href, Icon }) => ({
        label,
        href,
        Icon,
        active: pathname.startsWith(href),
      })),
    })
  }

  return (
    <ModuleSidebar
      title="Settings"
      position="fixed"
      collapsed={collapsed}
      onToggle={onToggle}
      groups={groups}
    />
  )
}
