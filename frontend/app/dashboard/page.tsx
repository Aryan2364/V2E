'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { getMyOrganization } from '@/lib/api/organizations'
import { getOrgIdentity } from '@/lib/api/org-identity'
import { getDepartments } from '@/lib/api/departments'
import { getRoles } from '@/lib/api/roles'
import { getEmployees, getPeopleEvents } from '@/lib/api/employees'
import PeopleEventsCard from '@/components/dashboard/PeopleEventsCard'
import type { Organization, OrgIdentity, Department, Role, EmployeeProfile, PeopleEventsResponse } from '@/lib/types'
import {
  Building2,
  Briefcase,
  Users,
  UserCheck,
  ChevronRight,
  Heart,
  Network,
  ArrowRight,
  BookOpen,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcSetupProgress(
  identity: OrgIdentity | null,
  departments: Department[],
  roles: Role[],
  employees: EmployeeProfile[]
): number {
  let score = 0
  if (identity?.vision || identity?.mission || identity?.purpose) score += 25
  if (departments.length > 0) score += 25
  if (roles.length > 0) score += 25
  if (employees.length > 0) score += 25
  return score
}

function getDynamicGreeting(name: string): string {
  const hr = new Date().getHours()
  const displayName = name ? name.split(' ')[0] : 'there'

  if (hr >= 5 && hr < 12) {
    const greetings = [
      `Coffee first, ${displayName}! Let's build something great today.`,
      `Good morning, ${displayName}. What's our main objective for today?`,
      `Rise and shine, ${displayName}! Let's align and execute.`,
      `Start your day focused, ${displayName}. Your team is ready.`,
    ]
    return greetings[Math.floor(Math.random() * greetings.length)]
  } else if (hr >= 12 && hr < 17) {
    const greetings = [
      `Good afternoon, ${displayName}. Keeping the momentum going!`,
      `Hope your day is flowing smoothly, ${displayName}.`,
      `Tackling the peak of the day, ${displayName}! Let's check in.`,
    ]
    return greetings[Math.floor(Math.random() * greetings.length)]
  } else if (hr >= 17 && hr < 22) {
    const greetings = [
      `Good evening, ${displayName}. Time to review today's wins.`,
      `Winding down the day, ${displayName}? Here is your workspace summary.`,
      `Good evening, ${displayName}. Wrapping up or planning ahead?`,
    ]
    return greetings[Math.floor(Math.random() * greetings.length)]
  } else {
    const greetings = [
      `Hello, night owl! Burning the midnight oil, ${displayName}?`,
      `Late night focus, ${displayName}? Let's make it count.`,
      `Quiet hours productivity, ${displayName}. Stay focused!`,
      `Late night workspace check-in, ${displayName}. Don't forget to rest!`,
    ]
    return greetings[Math.floor(Math.random() * greetings.length)]
  }
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
      <div className="w-10 h-10 rounded-lg bg-primary-subtle flex items-center justify-center text-primary-text shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-3xl font-medium text-text-primary leading-tight tabular-nums">{value}</p>
        <p className="text-sm text-text-secondary mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ─── Quick nav card ─────────────────────────────────────────────────────────────

interface QuickNavCardProps {
  label: string
  description: string
  href: string
  icon: React.ReactNode
  iconBg: string
}

function QuickNavCard({ label, description, href, icon, iconBg }: QuickNavCardProps) {
  return (
    <Link
      href={href}
      className="bg-surface border border-border-light rounded-xl shadow-card p-4 flex items-start gap-4 hover:border-primary hover:shadow-md active:scale-[0.99] active:border-primary transition-all duration-150 group focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-text-primary text-sm">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ChevronRight
        size={16}
        className="text-muted group-hover:text-primary-text group-active:text-primary-text transition-colors mt-0.5 shrink-0"
      />
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [org, setOrg] = useState<Organization | null>(null)
  const [identity, setIdentity] = useState<OrgIdentity | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [peopleEvents, setPeopleEvents] = useState<PeopleEventsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    Promise.all([
      getMyOrganization(orgId).catch(() => null),
      getOrgIdentity(orgId).catch(() => null),
      getDepartments(orgId).catch(() => []),
      getRoles(orgId).catch(() => []),
      getEmployees(orgId).catch(() => []),
      getPeopleEvents(orgId).catch(() => null),
    ]).then(([orgData, identityData, depts, rolesData, emps, events]) => {
      setOrg(orgData)
      setIdentity(identityData)
      setDepartments(depts)
      setRoles(rolesData)
      setEmployees(emps)
      setPeopleEvents(events)
    }).finally(() => setLoading(false))
  }, [orgId])

  const greeting = useMemo(() => getDynamicGreeting(user?.name ?? ''), [user?.name])

  const activeEmployees = employees.filter((e) => e.status === 'active').length
  const setupProgress = calcSetupProgress(identity, departments, roles, employees)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">
          {greeting}
        </h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          Here&apos;s an overview of what&apos;s happening at {org?.name ?? 'your organization'} today.
        </p>
      </div>

      {/* Setup banner — only for admins, who are the only ones who can reach
          Settings/Setup. Members (no settings gear) must never see this. */}
      {user?.is_admin && setupProgress < 100 && (
        <div className="bg-primary-subtle border border-primary-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="font-medium text-primary-text text-sm">
                Complete your organization setup
              </p>
              <p className="text-xs text-primary-text mt-0.5">
                {setupProgress}% complete — finish setting up to unlock all features.
              </p>
            </div>
            <Link
              href="/settings/organization/company"
              className="flex items-center gap-1.5 text-sm font-medium text-primary-text hover:text-primary-text transition-colors shrink-0 whitespace-nowrap"
            >
              Continue setup
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="h-2 bg-primary-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${setupProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Departments" value={departments.length} icon={<Network size={20} />} />
        <StatCard label="Roles" value={roles.length} icon={<Briefcase size={20} />} />
        <StatCard label="Employees" value={employees.length} icon={<Users size={20} />} />
        <StatCard label="Active" value={activeEmployees} icon={<UserCheck size={20} />} />
      </div>

      {/* People Events */}
      {peopleEvents && <PeopleEventsCard data={peopleEvents} />}

      {/* Quick nav */}
      <div>
        <h2 className="text-base font-medium text-text-primary mb-4">Quick access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <QuickNavCard
            label="Identity"
            description="Company vision, mission, purpose and values."
            href="/settings/organization/company"
            icon={<BookOpen size={18} className="text-primary-text" />}
            iconBg="bg-primary-subtle"
          />
          <QuickNavCard
            label="Culture"
            description="Expected and unacceptable behaviors that define your culture."
            href="/settings/organization/culture"
            icon={<Heart size={18} className="text-danger" />}
            iconBg="bg-danger-bg"
          />
          <QuickNavCard
            label="Org Chart"
            description="Visual hierarchy of departments and their relationships."
            href="/settings/organization/structure"
            icon={<Network size={18} className="text-success" />}
            iconBg="bg-success-bg"
          />
          <QuickNavCard
            label="Roles"
            description="Job descriptions, KRAs and KPIs for each role."
            href="/settings/organization/roles"
            icon={<Briefcase size={18} className="text-warning" />}
            iconBg="bg-warning-bg"
          />
          <QuickNavCard
            label="Employees"
            description="Directory of all employees with profiles and reporting chains."
            href="/settings/organization/employees"
            icon={<Users size={18} className="text-text-secondary" />}
            iconBg="bg-surface-control"
          />
        </div>
      </div>
    </div>
  )
}
