'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getPolicy, updatePolicy } from '@/lib/api/company-policy'
import PolicyForm from '@/components/company-policy/PolicyForm'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { POLICY_BASE, POLICY_REASONS, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'
import type { CompanyPolicy } from '@/lib/types/company-policy'

export default function EditPolicyPage() {
  const { policyId } = useParams<{ policyId: string }>()
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const { canEdit } = usePolicyPermissions()

  const [policy, setPolicy] = useState<CompanyPolicy | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  const load = useCallback(() => {
    if (!orgId || !policyId) return
    setStatus('loading')
    getPolicy(orgId, policyId)
      .then((p) => { setPolicy(p); setStatus('ready') })
      .catch(() => setStatus('failed'))
  }, [orgId, policyId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  }

  if (status === 'failed' || !policy) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Edit policy" trail={[{ label: 'Company policy', href: POLICY_BASE }]} />
        <div className="bg-surface border border-border-light rounded-card p-8 flex flex-col items-center text-center gap-2">
          <p className="text-label font-medium text-text-primary">This policy could not be loaded</p>
          <p className="text-label text-text-secondary">It may have been deleted, or the connection dropped.</p>
          <div className="flex gap-3 mt-2">
            <Button type="button" variant="secondary" onClick={load}>Retry</Button>
            <Button variant="secondary" render={<Link href={POLICY_BASE} />}>All policies</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Edit policy"
        trail={[
          { label: 'Company policy', href: POLICY_BASE },
          { label: policy.title, href: policyHref(policyId) },
        ]}
      />
      <PolicyForm
        initial={{ title: policy.title, description: policy.description ?? '' }}
        submitLabel="Save policy"
        cancelHref={policyHref(policyId)}
        allowed={canEdit}
        deniedReason={POLICY_REASONS.edit}
        onSubmit={async (v) => {
          await updatePolicy(orgId, policyId, { title: v.title, description: v.description || undefined })
          router.push(policyHref(policyId))
        }}
      />
    </div>
  )
}
