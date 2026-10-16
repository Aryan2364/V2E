'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ArrowRight, Plus } from 'lucide-react'
import { getOrganizations } from '@/lib/api/organizations'
import Badge from '@/components/ui/badge'
import Button from '@/components/ui/button'
import ResponsiveTable, { type ResponsiveColumn } from '@/components/ui/ResponsiveTable'
import type { Organization, OrgStatus } from '@/lib/types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function orgStatusToBadge(status: OrgStatus): 'active' | 'inactive' | 'pending' {
  if (status === 'active') return 'active'
  if (status === 'inactive') return 'inactive'
  return 'pending'
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
          <div className="w-8 h-8 rounded-[8px] bg-primary-subtle flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-primary-text" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-text-primary">{org.name}</span>
            {org.group && (
              <span className="inline-flex self-start items-center rounded-[999px] bg-surface-control text-text-secondary border border-border-light text-[11px] font-medium px-2 py-0.5">
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
        <Badge status={orgStatusToBadge(org.status)} label={orgStatusLabel(org.status)} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (org) => (
        <button
          onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 text-primary-text text-sm font-medium hover:text-primary-text transition-colors rounded-[6px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          View <ArrowRight size={14} />
        </button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary leading-tight">Organizations</h1>
          <p className="text-sm text-text-secondary mt-1">Manage all tenant organizations on the platform.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => router.push('/super-admin/organizations/new')}
        >
          <Plus size={16} />
          New Organization
        </Button>
      </div>

      {/* Table card */}
      {!isLoading && error ? (
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-6 py-12 text-center text-danger text-sm">
          {error}
        </div>
      ) : (
        <ResponsiveTable
          columns={columns}
          rows={orgs}
          rowKey={(org) => org.id}
          loading={isLoading}
          emptyState={
            <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center">
                  <Building2 size={22} className="text-text-muted" />
                </div>
                <p className="text-text-secondary font-medium">No organizations yet</p>
                <p className="text-text-muted text-xs">Click "New Organization" to add one.</p>
              </div>
            </div>
          }
        />
      )}
    </div>
  )
}
