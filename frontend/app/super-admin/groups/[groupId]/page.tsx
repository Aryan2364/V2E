'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LayersIcon, Building2Icon, PlusIcon, XIcon, UsersIcon, OctagonXIcon } from 'lucide-react'
import { getGroup, addOrgToGroup, removeOrgFromGroup } from '@/lib/api/groups'
import { getOrganizations } from '@/lib/api/organizations'
import { Button } from '@/components/ui/button'
import Card from '@/components/ui/card'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import { Skeleton } from '@/components/ui/skeleton'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { PageHeader } from '@/components/shell/page-header'
import type { OrganizationGroup, Organization } from '@/lib/types'

interface GroupUser {
  user_id: string
  name: string
  email: string
  orgs: { id: string; name: string }[]
}

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const router = useRouter()

  const [group, setGroup] = useState<OrganizationGroup | null>(null)
  const [allOrgs, setAllOrgs] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [addOrgId, setAddOrgId] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    Promise.allSettled([getGroup(groupId), getOrganizations()])
      .then(([groupRes, orgsRes]) => {
        if (cancelled) return
        if (groupRes.status === 'fulfilled') setGroup(groupRes.value)
        if (orgsRes.status === 'fulfilled') setAllOrgs(orgsRes.value)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [groupId])

  const memberOrgIds = new Set(group?.organizations?.map((o) => o.id) ?? [])
  const availableOrgs = allOrgs.filter((o) => !memberOrgIds.has(o.id))
  const availableOrgOptions = availableOrgs.reduce<Record<string, string>>((acc, o) => {
    acc[o.id] = o.name
    return acc
  }, {})

  async function handleAddOrg() {
    if (!groupId || !addOrgId) return
    setIsAdding(true)
    setActionError(null)
    try {
      await addOrgToGroup(groupId, addOrgId)
      const updated = await getGroup(groupId)
      setGroup(updated)
      setAddOrgId('')
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to add organization.')
    } finally {
      setIsAdding(false)
    }
  }

  async function handleRemoveOrg(orgId: string) {
    if (!groupId) return
    setRemovingId(orgId)
    setActionError(null)
    try {
      await removeOrgFromGroup(groupId, orgId)
      setGroup((prev) => prev ? { ...prev, organizations: prev.organizations?.filter((o) => o.id !== orgId) } : prev)
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to remove organization.')
    } finally {
      setRemovingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-48 rounded-card" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-text-secondary">Group not found.</p>
        <Button variant="secondary" onClick={() => router.push('/super-admin/groups')}>Back to list</Button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={group.name}
        meta={group.description}
        trail={[
          { label: 'Groups', href: '/super-admin/groups' },
          { label: group.name, href: `/super-admin/groups/${groupId}` },
        ]}
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Overview card */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-card bg-primary-subtle">
              <LayersIcon size={26} className="text-primary-text" />
            </div>
            <div>
              <h2 className="text-section font-medium text-text-primary">{group.name}</h2>
            </div>
          </div>
          <div className="mt-4 flex gap-8 border-t border-border-light pt-4">
            <div>
              <p className="text-label font-medium text-text-muted">Organizations</p>
              <p className="mt-1 text-section font-medium text-text-primary">{group.organizations?.length ?? 0}</p>
            </div>
          </div>
        </Card>

        {/* Member orgs */}
        <Card title="Member organizations">
          {actionError ? (
            <Banner variant="danger" className="mb-4">
              <OctagonXIcon />
              <BannerDescription>{actionError}</BannerDescription>
            </Banner>
          ) : null}

          {/* Add org */}
          {availableOrgs.length > 0 && (
            <div className="mb-4 flex gap-3 border-b border-border-light pb-4">
              <div className="flex-1">
                <SearchableSelect
                  options={availableOrgOptions}
                  value={addOrgId}
                  onValueChange={setAddOrgId}
                  placeholder="Select organization to add…"
                />
              </div>
              <Button onClick={handleAddOrg} loading={isAdding} loadingLabel="Adding" disabled={!addOrgId}>
                <PlusIcon size={16} /> Add
              </Button>
            </div>
          )}

          {(!group.organizations || group.organizations.length === 0) ? (
            <EmptyState variant="nothing-yet" heading="No organizations yet">
              Add an organization above to bring it into this group.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {group.organizations.map((org) => (
                <div key={org.id} className="flex items-center gap-3 rounded-lg border border-border-light bg-surface-sunken p-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle">
                    <Building2Icon size={16} className="text-primary-text" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-text-primary">{org.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
                      variant="secondary"
                      size="sm"
                    >
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveOrg(org.id)}
                      disabled={removingId === org.id}
                      aria-label="Remove from group"
                      className="size-6 text-text-muted hover:bg-danger-bg hover:text-danger"
                    >
                      <XIcon size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Users in group */}
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <UsersIcon size={16} className="text-text-secondary" />
            <h3 className="text-section font-medium text-text-primary">Users across group</h3>
          </div>
          <p className="mb-4 text-body text-text-secondary">
            All users who are members of any organization in this group.
          </p>
          <GroupUsersTable groupId={groupId} />
        </Card>
      </div>
    </div>
  )
}

function GroupUsersTable({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [users, setUsers] = useState<GroupUser[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    import('@/lib/api/groups').then(({ getGroupUsers }) =>
      getGroupUsers(groupId)
        .then((d) => { if (!cancelled) setUsers(d) })
        .catch(() => { if (!cancelled) setUsers([]) })
        .finally(() => { if (!cancelled) setIsLoading(false) })
    )
    return () => { cancelled = true }
  }, [groupId])

  return (
    <ResponsiveTable<GroupUser>
      className="-mx-6 -mb-6 rounded-none border-0 shadow-none md:mx-0 md:mb-0"
      loading={isLoading}
      skeletonRows={3}
      columns={[
        {
          key: 'name',
          header: 'Name',
          primary: true,
          render: (u) => <span className="font-medium text-text-primary">{u.name}</span>,
        },
        {
          key: 'email',
          header: 'Email',
          render: (u) => <span className="text-text-secondary">{u.email}</span>,
        },
        {
          key: 'member_of',
          header: 'Member of',
          render: (u) => (
            <div className="flex flex-wrap justify-end gap-1 md:justify-start">
              {u.orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
                  className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring inline-flex items-center rounded-full border border-border-light bg-surface-control px-2 py-0.5 text-meta font-medium text-text-secondary hover:bg-surface-control"
                >
                  {org.name}
                </button>
              ))}
            </div>
          ),
        },
      ]}
      rows={users}
      rowKey={(u) => u.user_id}
      emptyState={<p className="py-4 text-center text-body text-text-muted">No users yet.</p>}
    />
  )
}
