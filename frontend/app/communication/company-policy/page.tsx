'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FileText, Search, BookOpen, Users, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getPolicies } from '@/lib/api/company-policy'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { POLICY_BASE, POLICY_REASONS, policyHref, usePolicyPermissions } from '@/components/company-policy/shared'
import type { CompanyPolicy, PolicyStatus } from '@/lib/types/company-policy'

const STATUS_CONFIG: Record<PolicyStatus, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-warning-bg', text: 'text-warning', label: 'Draft' },
  published: { bg: 'bg-success-bg', text: 'text-success', label: 'Published' },
  archived:  { bg: 'bg-surface-control', text: 'text-text-secondary', label: 'Archived' },
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-meta font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

function PolicyCard({ policy }: { policy: CompanyPolicy }) {
  return (
    <Link
      href={policyHref(policy.id)}
      className="bg-surface border border-border-light rounded-card shadow-card p-4 hover:border-primary hover:shadow-md transition-all duration-150 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-9 h-9 rounded-control bg-primary-subtle flex items-center justify-center shrink-0">
          <FileText size={18} className="text-primary-text" />
        </div>
        <StatusBadge status={policy.status} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-body font-medium text-text-primary leading-snug line-clamp-2 wrap-break-word">{policy.title}</h3>
        {policy.description && (
          <p className="text-label text-text-secondary mt-1 line-clamp-2 leading-relaxed wrap-break-word">{policy.description}</p>
        )}
      </div>
      <div className="flex items-center gap-4 pt-1 border-t border-border-light">
        <span className="flex items-center gap-1.5 text-meta text-text-secondary">
          <BookOpen size={13} />
          {policy._count?.items ?? 0} items
        </span>
        <span className="flex items-center gap-1.5 text-meta text-text-secondary">
          <Users size={13} />
          {policy._count?.assignments ?? 0} assigned
        </span>
      </div>
    </Link>
  )
}

export default function CompanyPolicyPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { canWrite } = usePolicyPermissions()

  const [policies, setPolicies] = useState<CompanyPolicy[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | PolicyStatus>('all')

  const load = useCallback(() => {
    if (!orgId) return
    setStatus('loading')
    getPolicies(orgId)
      .then((p) => { setPolicies(p); setStatus('ready') })
      .catch(() => setStatus('failed'))
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = policies.filter((p) => {
    const matchSearch = p.title.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || p.status === filter
    return matchSearch && matchFilter
  })
  const filtering = !!search || filter !== 'all'

  const newPolicy = (variant: 'primary' | 'secondary') => {
    if (canWrite === true) {
      return (
        <Button variant={variant} render={<Link href={`${POLICY_BASE}/new`} />}>
          <Plus size={16} />
          New policy
        </Button>
      )
    }
    return (
      <PermissionTooltip allowed={canWrite} reason={POLICY_REASONS.create}>
        <Button type="button" disabled>
          <Plus size={16} />
          New policy
        </Button>
      </PermissionTooltip>
    )
  }

  return (
    <div>
      <PageHeader
        title="Company policy"
        meta={
          status === 'ready'
            ? `${policies.length} polic${policies.length !== 1 ? 'ies' : 'y'}`
            : 'Policies your organization asks everyone to read'
        }
        actions={newPolicy('primary')}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          <input
            type="text"
            aria-label="Search policies"
            placeholder="Search policies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-body sm:text-label border border-border rounded-control bg-surface text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        {(['all', 'draft', 'published', 'archived'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
            className={[
              'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring px-3 py-1.5 min-h-[36px] rounded-control text-meta font-medium capitalize transition-colors',
              filter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface text-text-secondary border border-border-light hover:border-primary hover:text-primary-text',
            ].join(' ')}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s as PolicyStatus].label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {status === 'loading' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 bg-surface-control rounded-card animate-pulse" />
          ))}
        </div>
      ) : status === 'failed' ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <h3 className="text-card-heading font-medium text-text-primary mb-1">Policies could not be loaded</h3>
          <p className="text-label text-text-secondary mb-4">Check your connection and try again.</p>
          <Button type="button" variant="secondary" onClick={load}>
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-card bg-primary-subtle flex items-center justify-center mb-4">
            <FileText size={24} className="text-primary-text" />
          </div>
          {filtering ? (
            <>
              <h3 className="text-card-heading font-medium text-text-primary mb-1">No policies match</h3>
              <p className="text-label text-text-secondary mb-4">Nothing matches your search and filter.</p>
              <Button type="button" variant="secondary" onClick={() => { setSearch(''); setFilter('all') }}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-card-heading font-medium text-text-primary mb-1">No policies yet</h3>
              <p className="text-label text-text-secondary mb-4">
                {canWrite === true
                  ? 'Create a policy, add its content, then publish and assign it.'
                  : 'Policies your organization publishes will appear here.'}
              </p>
              {canWrite === true && newPolicy('secondary')}
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtered.map((policy) => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}
    </div>
  )
}
