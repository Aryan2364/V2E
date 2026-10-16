'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getOrgIdentity } from '@/lib/api/org-identity'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'
import IdentityFormDrawer from '@/components/identity/IdentityFormDrawer'
import type { OrgIdentity } from '@/lib/types'
import { Building2Icon, PencilIcon, TargetIcon, RocketIcon, HeartIcon } from 'lucide-react'

// Core-value stripe colors. Cycles automatically for any number of values.
// A 3-series qualitative chart palette (kit section 21): chart-1..3 by position.
const STRIPE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']

// ─── Mission / Purpose card ───────────────────────────────────────────────────

function PillarCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  content,
}: {
  icon: typeof RocketIcon
  iconColor: string
  iconBg: string
  label: string
  content?: string
}) {
  if (!content) return null
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={16} style={{ color: iconColor }} />
        </span>
        <span className="text-meta font-medium uppercase tracking-widest text-text-secondary">
          {label}
        </span>
      </div>
      <p className="text-body text-text-primary leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  )
}

// ─── Empty state (unchanged) ──────────────────────────────────────────────────

function EmptyState({ canEdit, onEdit }: { canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-control flex items-center justify-center mb-4">
        <Building2Icon size={28} className="text-text-muted" />
      </div>
      <h2 className="text-card-heading font-medium text-text-primary">No identity defined yet</h2>
      <p className="text-text-secondary text-body mt-1 max-w-xs">
        Define your organization&apos;s vision, mission, purpose and values.
      </p>
      {canEdit && (
        <Button className="mt-4" onClick={onEdit}>
          Define identity
        </Button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IdentityPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const canEdit = !!user?.is_admin

  const [identity, setIdentity] = useState<OrgIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    getOrgIdentity(orgId)
      .then(setIdentity)
      .catch(() => setIdentity(null))
      .finally(() => setLoading(false))
  }, [orgId])

  const values = identity?.values ?? []
  const hasContent =
    !!identity &&
    (!!identity.vision || !!identity.mission || !!identity.purpose || values.length > 0)

  if (loading) {
    return (
      <div className="flex h-64 flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization Identity"
        meta="Why we exist and how we behave."
        actions={
          canEdit && hasContent ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon size={14} />
              Edit
            </Button>
          ) : undefined
        }
      />

      {!hasContent ? (
        <EmptyState canEdit={canEdit} onEdit={() => setEditing(true)} />
      ) : (
        <>
          {/* VISION — hero */}
          {identity?.vision && (
            <section className="rounded-card bg-primary-subtle border border-primary-border p-8 sm:p-8">
              <div className="flex items-center gap-2 mb-4">
                <TargetIcon size={16} className="text-primary-text" />
                <span className="text-meta font-medium uppercase tracking-[0.14em] text-primary-text">
                  Vision
                </span>
              </div>
              <p className="text-text-primary font-medium text-section leading-snug whitespace-pre-wrap">
                {identity.vision}
              </p>
            </section>
          )}

          {/* MISSION + PURPOSE — two equal cards */}
          {(identity?.mission || identity?.purpose) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PillarCard
                icon={RocketIcon}
                iconColor="var(--primary-text)"
                iconBg="var(--primary-subtle)"
                label="Mission"
                content={identity?.mission}
              />
              <PillarCard
                icon={HeartIcon}
                iconColor="var(--text-secondary)"
                iconBg="var(--surface-control)"
                label="Purpose"
                content={identity?.purpose}
              />
            </div>
          )}

          {/* CORE VALUES */}
          {values.length > 0 && (
            <div>
              <h2 className="text-section font-medium text-text-primary mb-4">
                Core Values
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {values.map((v, i) => {
                  const color = STRIPE_COLORS[i % STRIPE_COLORS.length]
                  return (
                    <div
                      key={i}
                      className="flex flex-row sm:flex-col bg-surface border border-border-light rounded-card shadow-card overflow-hidden"
                    >
                      {/* Stripe: left edge on mobile, top edge on desktop */}
                      <div
                        className="w-1.5 sm:w-full sm:h-1.5 shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="p-4 flex-1 min-w-0">
                        <span
                          className="block text-body font-medium tabular-nums mb-2"
                          style={{ color }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="font-medium text-body text-text-primary">{v.title}</h3>
                        {v.description && (
                          <p className="text-label text-text-secondary mt-1.5 leading-relaxed whitespace-pre-wrap">
                            {v.description}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {canEdit && (
        <IdentityFormDrawer
          open={editing}
          orgId={orgId}
          initial={identity}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setIdentity(saved)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}
