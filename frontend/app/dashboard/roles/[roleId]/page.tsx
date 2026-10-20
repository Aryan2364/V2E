'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { getRole } from '@/lib/api/roles'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shell/page-header'
import type { Role, RoleLevel } from '@/lib/types'
import { ArrowLeft, Pencil, Briefcase } from 'lucide-react'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'

type Kpi = NonNullable<Role['kpi']>[number]

const kpiColumns: ResponsiveColumn<Kpi>[] = [
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cellClassName: 'px-0! py-3! pr-4! font-medium text-text-primary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.title,
  },
  {
    key: 'metric',
    header: 'Metric',
    cellClassName: 'px-0! py-3! pr-4! text-text-secondary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.metric,
  },
  {
    key: 'target',
    header: 'Target',
    cellClassName: 'px-0! py-3! pr-4! text-text-secondary',
    headerClassName: 'px-0! py-2.5! pr-4!',
    render: (kpi) => kpi.target,
  },
  {
    key: 'unit',
    header: 'Unit',
    cellClassName: 'px-0! py-3! text-text-secondary',
    headerClassName: 'px-0! py-2.5!',
    render: (kpi) => kpi.unit,
  },
]

// ─── Level badge ──────────────────────────────────────────────────────────────

const levelConfig: Record<
  RoleLevel,
  { label: string; bg: string; text: string }
> = {
  junior: { label: 'Junior', bg: 'bg-surface-control', text: 'text-text-secondary' },
  mid: { label: 'Mid', bg: 'bg-primary-subtle', text: 'text-primary-text' },
  senior: { label: 'Senior', bg: 'bg-surface-control', text: 'text-text-secondary' },
  head: { label: 'Head', bg: 'bg-text-primary', text: 'text-surface' },
}

function LevelBadge({ level }: { level: RoleLevel }) {
  const cfg = levelConfig[level] ?? levelConfig.mid
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-meta font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <h2 className="text-card-heading font-medium text-text-primary mb-4 pb-3 border-b border-border-light">
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
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !role) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Briefcase size={36} className="text-text-muted mb-3" />
        <p className="text-section font-medium text-text-primary">Job role not found</p>
        <Link href="/dashboard/roles" className="mt-4">
          <Button variant="secondary" size="sm">
            <ArrowLeft size={16} /> Back to job roles
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={role.title}
        trail={[{ label: 'Job roles', href: '/settings/organization/roles' }]}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            {role.department?.name && <span>{role.department.name}</span>}
            <LevelBadge level={role.level} />
          </span>
        }
        actions={
          canEdit ? (
            <Link href="/settings/organization/roles">
              <Button variant="secondary">
                <Pencil size={16} />
                Edit
              </Button>
            </Link>
          ) : undefined
        }
      />

      {/* Job Description */}
      {role.job_description && (
        <Section title="Job description">
          <p className="text-text-primary leading-relaxed whitespace-pre-wrap text-body">
            {role.job_description}
          </p>
        </Section>
      )}

      {/* KRAs */}
      {role.kra && role.kra.length > 0 && (
        <Section title="Key result areas (KRA)">
          <ol className="space-y-4">
            {role.kra.map((kra, i) => (
              <li key={i} className="flex gap-4">
                <span className="shrink-0 w-7 h-7 rounded-full bg-primary-subtle flex items-center justify-center text-meta font-medium text-primary-text">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-text-primary text-body">{kra.title}</p>
                  {kra.description && (
                    <p className="text-text-secondary text-meta mt-1 leading-relaxed">
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
        <Section title="Key performance indicators (KPI)">
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
