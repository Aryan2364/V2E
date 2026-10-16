'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getOrgIdentity } from '@/lib/api/org-identity'
import Button from '@/components/ui/Button'
import IdentityFormDrawer from '@/components/identity/IdentityFormDrawer'
import type { OrgIdentity } from '@/lib/types'
import { Building2, Pencil, Target, Rocket, Heart } from 'lucide-react'

// Core-value stripe colors. Cycles automatically for any number of values.
const STRIPE_COLORS = ['#7C3AED', '#16A34A', '#EA580C'] // purple, green, orange

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
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={16} style={{ color: iconColor }} />
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-[#475569]">
          {label}
        </span>
      </div>
      <p className="text-[15px] text-[#1E293B] leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  )
}

// ─── Empty state (unchanged) ──────────────────────────────────────────────────

function EmptyState({ canEdit, onEdit }: { canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
        <Building2 size={28} className="text-[#94A3B8]" />
      </div>
      <h2 className="text-lg font-semibold text-[#0F172A]">No identity defined yet</h2>
      <p className="text-[#475569] text-sm mt-1 max-w-xs">
        Define your organization&apos;s vision, mission, purpose and values.
      </p>
      {canEdit && (
        <Button className="mt-5" onClick={onEdit}>
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
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] sm:text-[28px] font-bold text-[#0F172A] leading-tight">
            Organization Identity
          </h1>
          <p className="mt-1 text-[14px] sm:text-[15px] text-[#475569]">
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
            <section className="rounded-[16px] bg-[#EFF6FF] border border-[#DBEAFE] p-7 sm:p-9">
              <div className="flex items-center gap-2 mb-4">
                <Target size={16} className="text-[#2563EB]" />
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#2563EB]">
                  Vision
                </span>
              </div>
              <p className="text-[#0F172A] font-bold text-[20px] sm:text-[22px] leading-snug whitespace-pre-wrap">
                {identity.vision}
              </p>
            </section>
          )}

          {/* MISSION + PURPOSE — two equal cards */}
          {(identity?.mission || identity?.purpose) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <PillarCard
                icon={Rocket}
                iconColor="#2563EB"
                iconBg="#EFF6FF"
                label="Mission"
                content={identity?.mission}
              />
              <PillarCard
                icon={Heart}
                iconColor="#7C3AED"
                iconBg="#F5F3FF"
                label="Purpose"
                content={identity?.purpose}
              />
            </div>
          )}

          {/* CORE VALUES */}
          {values.length > 0 && (
            <div>
              <h2 className="text-[18px] sm:text-[20px] font-semibold text-[#0F172A] mb-5">
                Core Values
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {values.map((v, i) => {
                  const color = STRIPE_COLORS[i % STRIPE_COLORS.length]
                  return (
                    <div
                      key={i}
                      className="flex flex-row sm:flex-col bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden"
                    >
                      {/* Stripe: left edge on mobile, top edge on desktop */}
                      <div
                        className="w-1.5 sm:w-full sm:h-1.5 shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="p-5 flex-1 min-w-0">
                        <span
                          className="block text-sm font-bold tabular-nums mb-2"
                          style={{ color }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="font-bold text-[15px] text-[#0F172A]">{v.title}</h3>
                        {v.description && (
                          <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed whitespace-pre-wrap">
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
