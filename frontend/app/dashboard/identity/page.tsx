'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getOrgIdentity } from '@/lib/api/org-identity'
import Button from '@/components/ui/button'
import IdentityFormDrawer from '@/components/identity/IdentityFormDrawer'
import type { OrgIdentity } from '@/lib/types'
import { Building2, Pencil, Target, Rocket, Heart } from 'lucide-react'

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
  icon: typeof Rocket
  iconColor: string
  iconBg: string
  label: string
  content?: string
}) {
  if (!content) return null
  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={16} style={{ color: iconColor }} />
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-text-secondary">
          {label}
        </span>
      </div>
      <p className="text-[15px] text-text-primary leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  )
}

// ─── Empty state (unchanged) ──────────────────────────────────────────────────

function EmptyState({ canEdit, onEdit }: { canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-control flex items-center justify-center mb-4">
        <Building2 size={28} className="text-text-muted" />
      </div>
      <h2 className="text-lg font-medium text-text-primary">No identity defined yet</h2>
      <p className="text-text-secondary text-sm mt-1 max-w-xs">
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
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] sm:text-[28px] font-medium text-text-primary leading-tight">
            Organization Identity
          </h1>
          <p className="mt-1 text-[14px] sm:text-[15px] text-text-secondary">
            Why we exist and how we behave.
          </p>
        </div>
        {canEdit && hasContent && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        )}
      </div>

      {!hasContent ? (
        <EmptyState canEdit={canEdit} onEdit={() => setEditing(true)} />
      ) : (
        <>
          {/* VISION — hero */}
          {identity?.vision && (
            <section className="rounded-[16px] bg-primary-subtle border border-primary-border p-8 sm:p-8">
              <div className="flex items-center gap-2 mb-4">
                <Target size={16} className="text-primary-text" />
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-primary-text">
                  Vision
                </span>
              </div>
              <p className="text-text-primary font-medium text-[20px] sm:text-[22px] leading-snug whitespace-pre-wrap">
                {identity.vision}
              </p>
            </section>
          )}

          {/* MISSION + PURPOSE — two equal cards */}
          {(identity?.mission || identity?.purpose) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PillarCard
                icon={Rocket}
                iconColor="var(--primary-text)"
                iconBg="var(--primary-subtle)"
                label="Mission"
                content={identity?.mission}
              />
              <PillarCard
                icon={Heart}
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
              <h2 className="text-[18px] sm:text-[20px] font-medium text-text-primary mb-4">
                Core Values
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {values.map((v, i) => {
                  const color = STRIPE_COLORS[i % STRIPE_COLORS.length]
                  return (
                    <div
                      key={i}
                      className="flex flex-row sm:flex-col bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden"
                    >
                      {/* Stripe: left edge on mobile, top edge on desktop */}
                      <div
                        className="w-1.5 sm:w-full sm:h-1.5 shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="p-4 flex-1 min-w-0">
                        <span
                          className="block text-sm font-medium tabular-nums mb-2"
                          style={{ color }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="font-medium text-[15px] text-text-primary">{v.title}</h3>
                        {v.description && (
                          <p className="text-[13px] text-text-secondary mt-1.5 leading-relaxed whitespace-pre-wrap">
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
