'use client'

import Link from 'next/link'
import { Fragment } from 'react'
import { usePermissions } from '@/lib/auth/use-permissions'

/** Company Policy now lives under Communication. The API stays at /ecs/policies. */
export const POLICY_BASE = '/communication/company-policy'
export const policyHref = (id: string) => `${POLICY_BASE}/${encodeURIComponent(id)}`

const LEAF = 'ecs.policy.manage'

/** Reasons in the kit's §26.2 wording: who may do it, by what they may do. */
export const POLICY_REASONS = {
  create: 'Only people allowed to manage company policies can do this.',
  edit: 'Only people allowed to edit company policies can do this.',
  deleteItem: 'Only people allowed to delete company policy content can do this.',
  deletePolicy: 'Only people who manage access for your organization can delete a policy.',
} as const

/**
 * What the signed-in person may do with company policies, mirroring the server's
 * gates on /ecs/policies: write (create, publish, archive, add items, assign), edit,
 * delete (items), read (assignments). Deleting a whole policy is admin-only on the
 * server. Each answer is tri-state: undefined while permissions are still loading.
 */
export function usePolicyPermissions() {
  const { loading, isAdmin, can } = usePermissions()
  const known = !loading
  const ans = (v: boolean) => (known ? v : undefined)
  return {
    canWrite: ans(isAdmin || can(LEAF, 'write')),
    canEdit: ans(isAdmin || can(LEAF, 'edit')),
    canDeleteItem: ans(isAdmin || can(LEAF, 'delete')),
    canDeletePolicy: ans(isAdmin),
    canReadAssignments: ans(isAdmin || can(LEAF, 'read')),
  }
}

/** Breadcrumb trail — the way back out (the kit uses breadcrumbs, never a back arrow). */
export function PolicyBreadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-[13px] text-[#475569] mb-4 min-w-0">
      {trail.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-[#94A3B8]" aria-hidden>›</span>}
          {c.href ? (
            <Link
              href={c.href}
              className="font-medium text-[#475569] hover:text-[#2563EB] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              {c.label}
            </Link>
          ) : (
            <span className="font-semibold text-[#0F172A] truncate max-w-[60vw]" aria-current="page">
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
