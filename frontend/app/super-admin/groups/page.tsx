'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LayersIcon, ArrowRightIcon, PlusIcon, Building2Icon, OctagonXIcon } from 'lucide-react'
import { getGroups } from '@/lib/api/groups'
import { Button } from '@/components/ui/button'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/shell/page-header'
import type { OrganizationGroup } from '@/lib/types'

export default function GroupsPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<OrganizationGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getGroups()
      .then((d) => { if (!cancelled) setGroups(d) })
      .catch(() => { if (!cancelled) setError('Failed to load groups.') })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <PageHeader
        title="Groups"
        meta="Manage organization groups — cluster related companies and share users across them."
        actions={
          <Button onClick={() => router.push('/super-admin/groups/new')}>
            <PlusIcon size={16} />
            New Group
          </Button>
        }
      />

      <div className="mt-6">
        {!isLoading && error ? (
          <Banner variant="danger">
            <OctagonXIcon />
            <BannerDescription>{error}</BannerDescription>
          </Banner>
        ) : (
          <ResponsiveTable<OrganizationGroup>
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (g) => (
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle">
                      <LayersIcon size={16} className="text-primary-text" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{g.name}</p>
                      {g.description && <p className="mt-1 text-meta text-text-secondary">{g.description}</p>}
                    </div>
                  </div>
                ),
              },
              {
                key: 'organizations',
                header: 'Organizations',
                render: (g) => (
                  <div className="flex items-center justify-end gap-1 text-text-secondary md:justify-start">
                    <Building2Icon size={14} />
                    <span>{g._count?.organizations ?? g.organizations?.length ?? 0}</span>
                  </div>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (g) => (
                  <button
                    onClick={() => router.push(`/super-admin/groups/${g.id}`)}
                    className="inline-flex items-center gap-1 text-body font-medium text-primary-text hover:text-primary-text"
                  >
                    View <ArrowRightIcon size={14} />
                  </button>
                ),
              },
            ]}
            rows={groups}
            rowKey={(g) => g.id}
            loading={isLoading}
            skeletonRows={4}
            emptyState={
              <EmptyState variant="nothing-yet" heading="No groups yet">
                Click &quot;New Group&quot; to create your first organization group.
              </EmptyState>
            }
          />
        )}
      </div>
    </div>
  )
}
