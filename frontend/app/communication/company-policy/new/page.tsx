'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createPolicy } from '@/lib/api/company-policy'
import PolicyForm from '@/components/company-policy/PolicyForm'
import { POLICY_BASE, POLICY_REASONS, PolicyBreadcrumb, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'

export default function NewPolicyPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const { canWrite } = usePolicyPermissions()

  return (
    <div className="max-w-3xl">
      <PolicyBreadcrumb trail={[{ label: 'Company Policy', href: POLICY_BASE }, { label: 'New policy' }]} />
      <h1 className="text-card-heading sm:text-page-title font-medium text-text-primary mb-6 leading-tight">Create Company Policy</h1>
      <PolicyForm
        initial={{ title: '', description: '' }}
        submitLabel="Create policy"
        cancelHref={POLICY_BASE}
        allowed={canWrite}
        deniedReason={POLICY_REASONS.create}
        onSubmit={async (v) => {
          const policy = await createPolicy(orgId, { title: v.title, description: v.description || undefined })
          router.push(policyHref(policy.id))
        }}
      />
    </div>
  )
}
