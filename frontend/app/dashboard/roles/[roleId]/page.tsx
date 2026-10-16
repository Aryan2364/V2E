'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { getRole } from '@/lib/api/roles'
import Button from '@/components/ui/Button'
import type { Role, RoleLevel } from '@/lib/types'
import { ArrowLeft, Pencil, Briefcase } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'

type Kpi = NonNullable<Role['kpi']>[number]

const kpiColumns: ResponsiveColumn<Kpi>[] = [
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'px-0! py-3! pr-4! font-medium text-[#0F172A]',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.title,
  },
  {
    key: 'metric',
    header: 'Metric',
    cellClassName: 'px-0! py-3! pr-4! text-[#475569]',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.metric,
  },
  {
    key: 'target',
    header: 'Target',
    cellClassName: 'px-0! py-3! pr-4! text-[#475569]',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.target,
  },
  {
    key: 'unit',
    header: 'Unit',
    cellClassName: 'px-0! py-3! text-[#475569]',
    headerClassName: 'px-0! py-2.5!',
    render: (kpi) => kpi.unit,
  },
]

// ─── Level badge ──────────────────────────────────────────────────────────────

const levelConfig: Record<
  RoleLevel,
  { label: string; bg: string; text: string }
> = {
  junior: { label: 'Junior', bg: 'bg-[#F1F5F9]', text: 'text-[#475569]' },
  mid: { label: 'Mid', bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
  senior: { label: 'Senior', bg: 'bg-[#F3E8FF]', text: 'text-[#7C3AED]' },
  head: { label: 'Head', bg: 'bg-[#1E293B]', text: 'text-[#F1F5F9]' },
}

function LevelBadge({ level }: { level: RoleLevel }) {
  const cfg = levelConfig[level] ?? levelConfig.mid
  return (
    <span
      className={`inline-flex items-center rounded-[999px] px-3 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6">
      <h2 className="text-base font-semibold text-[#0F172A] mb-4 pb-3 border-b border-[#F1F5F9]">
        {title}
      </h2>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoleDetailPage() {
  const params = useParams()
  const roleId = params?.roleId as string
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const canEdit = !!user?.is_admin

  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!orgId || !roleId) {
      setLoading(false)
      return
    }
    getRole(orgId, roleId)
      .then(setRole)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [orgId, roleId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !role) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Briefcase size={36} className="text-[#94A3B8] mb-3" />
        <p className="text-lg font-semibold text-[#0F172A]">Job role not found</p>
        <Link href="/dashboard/roles" className="mt-4">
          <Button variant="secondary" size="sm">
            <ArrowLeft size={14} /> Back to job roles
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back link */}
      <Link
        href="/settings/organization/roles"
        className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors"
      >
        <ArrowLeft size={15} />
        All Job Roles
      </Link>

      {/* Role header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight">{role.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {role.department?.name && (
              <span className="inline-flex items-center rounded-[999px] px-3 py-1 text-xs font-medium bg-[#EFF6FF] text-[#1D4ED8]">
                {role.department.name}
              </span>
            )}
            <LevelBadge level={role.level} />
          </div>
        </div>
        {canEdit && (
          <Link href="/settings/organization/roles">
            <Button variant="secondary" size="sm">
              <Pencil size={14} />
              Edit
            </Button>
          </Link>
        )}
      </div>

      {/* Job Description */}
      {role.job_description && (
        <Section title="Job Description">
          <p className="text-[#1E293B] leading-relaxed whitespace-pre-wrap text-sm">
            {role.job_description}
          </p>
        </Section>
      )}

      {/* KRAs */}
      {role.kra && role.kra.length > 0 && (
        <Section title="Key Result Areas (KRA)">
          <ol className="space-y-4">
            {role.kra.map((kra, i) => (
              <li key={i} className="flex gap-4">
                <span className="shrink-0 w-7 h-7 rounded-full bg-[#EFF6FF] flex items-center justify-center text-xs font-bold text-[#2563EB]">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-[#0F172A] text-sm">{kra.title}</p>
                  {kra.description && (
                    <p className="text-[#475569] text-xs mt-1 leading-relaxed">
                      {kra.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* KPIs */}
      {role.kpi && role.kpi.length > 0 && (
        <Section title="Key Performance Indicators (KPI)">
          <ResponsiveTable
            className="border-0! rounded-none! shadow-none! bg-transparent! overflow-visible!"
            columns={kpiColumns}
            rows={role.kpi}
            rowKey={(_kpi, i) => String(i)}
          />
        </Section>
      )}
    </div>
  )
}
