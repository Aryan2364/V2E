'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, BookOpen, BarChart2, GraduationCap } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import ModuleSidebar, { ModuleSidebarItem } from '@/components/layout/ModuleSidebar'

interface LearningAdminSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

interface NavItem { label: string; href: string; Icon: React.ElementType; exact?: boolean }

const HR_NAV: NavItem[] = [
  { label: 'Overview', href: '/learning', Icon: LayoutDashboard, exact: true },
  { label: 'Learning Paths', href: '/learning/paths', Icon: BookOpen },
  { label: 'Progress', href: '/learning/progress', Icon: BarChart2 },
]

const EMP_NAV: NavItem[] = [
  { label: 'My Learning', href: '/learning/my', Icon: GraduationCap },
]

// Migrated to the shared ModuleSidebar (FRONTEND_RULES.md §4 rule 2, §12.1 treatment)
// in place of a hand-rolled dark sidebar. This component now only computes its own
// item list (role-based nav + active state) and feeds it in.
export default function LearningAdminSidebar({ collapsed, onToggle }: LearningAdminSidebarProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const isHR = !!user?.is_admin
  const navItems = isHR ? HR_NAV : EMP_NAV

  const items: ModuleSidebarItem[] = navItems.map(({ label, href, Icon, exact }) => ({
    label,
    href,
    Icon,
    active: exact ? pathname === href : pathname.startsWith(href),
  }))

  return (
    <ModuleSidebar
      title="Learning"
      groups={[{ items }]}
      collapsed={collapsed}
      onToggle={onToggle}
      position="fixed"
    />
  )
}
