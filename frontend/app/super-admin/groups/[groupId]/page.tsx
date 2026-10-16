'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Layers, ChevronLeft, Building2, Plus, X, Users } from 'lucide-react'
import { getGroup, addOrgToGroup, removeOrgFromGroup } from '@/lib/api/groups'
import { getOrganizations } from '@/lib/api/organizations'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
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
        <div className="h-7 w-48 rounded-md bg-[#E2E8F0] animate-pulse" />
        <div className="h-40 rounded-[12px] bg-[#E2E8F0] animate-pulse" />
        <div className="h-48 rounded-[12px] bg-[#E2E8F0] animate-pulse" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-[#475569]">Group not found.</p>
        <Button variant="secondary" onClick={() => router.push('/super-admin/groups')}>Back to list</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <button
          onClick={() => router.push('/super-admin/groups')}
          className="inline-flex items-center gap-1 text-sm text-[#475569] hover:text-[#0F172A] mb-3 transition-colors"
        >
          <ChevronLeft size={16} /> Groups
        </button>
        <h1 className="text-[28px] font-bold text-[#0F172A]">{group.name}</h1>
        {group.description && <p className="text-sm text-[#475569] mt-1">{group.description}</p>}
      </div>

      {/* Overview card */}
      <Card>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-[12px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
            <Layers size={26} className="text-[#2563EB]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#0F172A]">{group.name}</h2>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-[#E2E8F0] flex gap-8">
          <div>
            <p className="text-xs text-[#94A3B8] uppercase tracking-wider font-medium">Organizations</p>
            <p className="text-2xl font-bold text-[#0F172A] mt-0.5">{group.organizations?.length ?? 0}</p>
          </div>
        </div>
      </Card>

      {/* Member orgs */}
      <Card title="Member Organizations">
        {actionError && (
          <div className="mb-4 rounded-[8px] bg-[#FEE2E2] border border-[#FECACA] px-4 py-2.5 text-sm text-[#DC2626]">
            {actionError}
          </div>
        )}

        {/* Add org */}
        {availableOrgs.length > 0 && (
          <div className="flex gap-3 mb-5 pb-5 border-b border-[#E2E8F0]">
            <select
              value={addOrgId}
              onChange={(e) => setAddOrgId(e.target.value)}
              className="flex-1 rounded-[8px] bg-white border border-[#CBD5E1] px-3 py-[10px] text-sm text-[#0F172A] focus:outline-hidden focus:border-2 focus:border-[#2563EB]"
            >
              <option value="">Select organization to add…</option>
              {availableOrgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <Button variant="primary" onClick={handleAddOrg} isLoading={isAdding} disabled={!addOrgId}>
              <Plus size={16} /> Add
            </Button>
          </div>
        )}

        {(!group.organizations || group.organizations.length === 0) ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <Building2 size={28} className="text-[#CBD5E1]" />
            <p className="text-sm text-[#94A3B8]">No organizations in this group yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {group.organizations.map((org) => (
              <div key={org.id} className="flex items-center gap-3 p-3 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC]">
                <div className="w-8 h-8 rounded-[8px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
                  <Building2 size={16} className="text-[#2563EB]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0F172A] truncate">{org.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
                    className="text-xs text-[#2563EB] font-medium hover:text-[#1D4ED8] transition-colors px-2 py-1"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleRemoveOrg(org.id)}
                    disabled={removingId === org.id}
                    className="w-6 h-6 rounded-[4px] flex items-center justify-center text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors disabled:opacity-50"
                    aria-label="Remove from group"
                  >
                    {removingId === org.id ? (
                      <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <X size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Users in group */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Users size={16} className="text-[#475569]" />
          <h3 className="text-[18px] font-semibold text-[#0F172A]">Users across group</h3>
        </div>
        <p className="text-sm text-[#475569] mb-4">
          All users who are members of any organization in this group.
        </p>
        <GroupUsersTable groupId={groupId} />
      </Card>
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
      className="border-0 shadow-none rounded-none -mx-6 -mb-6 md:mx-0 md:mb-0"
      loading={isLoading}
      skeletonRows={3}
      columns={[
        {
          key: 'name',
          header: 'Name',
          primary: true,
          render: (u) => <span className="font-medium text-[#0F172A]">{u.name}</span>,
        },
        {
          key: 'email',
          header: 'Email',
          render: (u) => <span className="text-[#475569]">{u.email}</span>,
        },
        {
          key: 'member_of',
          header: 'Member of',
          render: (u) => (
            <div className="flex flex-wrap gap-1 md:justify-start justify-end">
              {u.orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => router.push(`/super-admin/organizations/${org.id}`)}
                  className="inline-flex items-center rounded-[999px] bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD] text-[11px] font-medium px-2 py-0.5 hover:bg-[#BAE6FD] transition-colors"
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
      emptyState={<p className="text-sm text-[#94A3B8] text-center py-4">No users yet.</p>}
    />
  )
}
