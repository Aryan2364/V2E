'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, ArrowRight, Plus, Building2 } from 'lucide-react'
import { getGroups } from '@/lib/api/groups'
import Button from '@/components/ui/button'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary leading-tight">Groups</h1>
          <p className="text-sm text-text-secondary mt-1">Manage organization groups — cluster related companies and share users across them.</p>
        </div>
        <Button variant="primary" onClick={() => router.push('/super-admin/groups/new')}>
          <Plus size={16} />
          New Group
        </Button>
      </div>

      {!isLoading && error ? (
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-6 py-12 text-center text-danger text-sm">
          {error}
        </div>
      ) : (
        <ResponsiveTable<OrganizationGroup>
          columns={[
            {
              key: 'name',
              header: 'Name',
              primary: true,
              render: (g) => (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[8px] bg-primary-subtle flex items-center justify-center shrink-0">
                    <Layers size={16} className="text-primary-text" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">{g.name}</p>
                    {g.description && <p className="text-xs text-text-secondary mt-0.5">{g.description}</p>}
                  </div>
                </div>
              ),
            },
            {
              key: 'organizations',
              header: 'Organizations',
              render: (g) => (
                <div className="flex items-center gap-1.5 text-text-secondary md:justify-start justify-end">
                  <Building2 size={14} />
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
                  className="inline-flex items-center gap-1 text-primary-text text-sm font-medium hover:text-primary-text transition-colors"
                >
                  View <ArrowRight size={14} />
                </button>
              ),
            },
          ]}
          rows={groups}
          rowKey={(g) => g.id}
          loading={isLoading}
          skeletonRows={4}
          emptyState={
            <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center">
                  <Layers size={22} className="text-text-muted" />
                </div>
                <p className="text-text-secondary font-medium">No groups yet</p>
                <p className="text-text-muted text-xs">Click "New Group" to create your first organization group.</p>
              </div>
            </div>
          }
        />
      )}
    </div>
  )
}
