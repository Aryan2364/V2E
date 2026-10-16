'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2Icon, ArrowRightIcon, PlusIcon, OctagonXIcon } from 'lucide-react'
import { getOrganizations } from '@/lib/api/organizations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/shell/page-header'
import type { Organization, OrgStatus } from '@/lib/types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function orgStatusVariant(status: OrgStatus): 'success' | 'danger' | 'warning' {
  if (status === 'active') return 'success'
  if (status === 'inactive') return 'danger'
  return 'warning'
}

function orgStatusLabel(status: OrgStatus): string {
  if (status === 'active') return 'Active'
  if (status === 'inactive') return 'Inactive'
  return 'Pending Setup'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getOrganizations()
      .then((data) => { if (!cancelled) setOrgs(data) })
      .catch(() => { if (!cancelled) setError('Failed to load organizations.') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const columns: ResponsiveColumn<Organization>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      render: (org) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle">
            <Building2Icon size={16} className="text-primary-text" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-text-primary">{org.name}</span>
            {org.group && (
              <span className="inline-flex self-start items-center rounded-full border border-border-light bg-surface-control px-2 py-0.5 text-meta font-medium text-text-secondary">
                {org.group.name}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'industry',
      header: 'Industry',
      render: (org) => <span className="text-text-secondary">{org.industry ?? '—'}</span>,
    },
    {
      key: 'country',
      header: 'Country',
      render: (org) => <span className="text-text-secondary">{org.country ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (org) => (
        <Badge variant={orgStatusVariant(org.status)}>{orgStatusLabel(org.status)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (org) => (
        <button
          onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
          className="inline-flex min-h-10 items-center gap-1 rounded-md text-body font-medium text-primary-text outline-none hover:text-primary-text focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring sm:min-h-0"
        >
          View <ArrowRightIcon size={14} />
        </button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Organizations"
        meta="Manage all tenant organizations on the platform."
        actions={
          <Button onClick={() => router.push('/super-admin/organizations/new')}>
            <PlusIcon size={16} />
            New Organization
          </Button>
        }
      />

      <div className="mt-6">
        {/* Table card */}
        {!isLoading && error ? (
          <Banner variant="danger">
            <OctagonXIcon />
            <BannerDescription>{error}</BannerDescription>
          </Banner>
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={orgs}
            rowKey={(org) => org.id}
            loading={isLoading}
            emptyState={
              <EmptyState variant="nothing-yet" heading="No organizations yet">
                Click &quot;New Organization&quot; to add one.
              </EmptyState>
            }
          />
        )}
      </div>
    </div>
  )
}
