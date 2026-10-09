'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getPolicy, updatePolicy } from '@/lib/api/company-policy'
import PolicyForm from '@/components/company-policy/PolicyForm'
import { POLICY_BASE, POLICY_REASONS, PolicyBreadcrumb, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'
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
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
  }

  if (status === 'failed' || !policy) {
    return (
      <div className="max-w-3xl">
        <PolicyBreadcrumb trail={[{ label: 'Company Policy', href: POLICY_BASE }, { label: 'Edit policy' }]} />
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-8 flex flex-col items-center text-center gap-2">
          <p className="text-sm font-semibold text-[#0F172A]">This policy could not be loaded</p>
          <p className="text-sm text-[#475569]">It may have been deleted, or the connection dropped.</p>
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={load} className="px-4 py-2 text-sm font-semibold text-[#2563EB] border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors">Retry</button>
            <Link href={POLICY_BASE} className="px-4 py-2 text-sm font-semibold text-[#475569] hover:text-[#0F172A] transition-colors">All policies</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <PolicyBreadcrumb
        trail={[
          { label: 'Company Policy', href: POLICY_BASE },
          { label: policy.title, href: policyHref(policyId) },
          { label: 'Edit' },
        ]}
      />
      <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] mb-6 leading-tight">Edit Policy</h1>
      <PolicyForm
        initial={{ title: policy.title, description: policy.description ?? '' }}
        submitLabel="Save changes"
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
