'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getCultureStandards } from '@/lib/api/culture'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'
import CultureManagerDrawer from '@/components/culture/CultureManagerDrawer'
import type { CultureStandard } from '@/lib/types'
import { CheckCircle2Icon, XCircleIcon, PencilIcon, HeartIcon } from 'lucide-react'

// ─── Standard card ─────────────────────────────────────────────────────────────

function StandardCard({
  standard,
  type,
}: {
  standard: CultureStandard
  type: 'expected' | 'unacceptable'
}) {
  const isExpected = type === 'expected'
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4 flex gap-3">
      <div className="shrink-0 mt-0.5">
        {isExpected ? (
          <CheckCircle2Icon size={18} className="text-success" />
        ) : (
          <XCircleIcon size={18} className="text-danger" />
        )}
      </div>
      <div>
        <h3 className="font-medium text-text-primary text-sm leading-snug">{standard.title}</h3>
        {standard.description && (
          <p className="text-text-primary text-xs mt-1.5 leading-relaxed">{standard.description}</p>
        )}
      </div>
    </div>
  )
}

// ─── Column ────────────────────────────────────────────────────────────────────

function Column({
  title,
  accent,
  accentBg,
  icon,
  items,
  type,
}: {
  title: string
  accent: string
  accentBg: string
  icon: React.ReactNode
  items: CultureStandard[]
  type: 'expected' | 'unacceptable'
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg ${accentBg}`}
      >
        <span className={accent}>{icon}</span>
        <h2 className={`font-medium text-sm ${accent}`}>{title}</h2>
        <span
          className={`ml-auto text-xs font-medium rounded-full px-2 py-0.5 ${accentBg} ${accent} border ${
            type === 'expected' ? 'border-success-border' : 'border-danger-border'
          }`}
        >
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-8">No standards defined yet.</p>
      ) : (
        items.map((s) => <StandardCard key={s.id} standard={s} type={type} />)
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ canEdit, onEdit }: { canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-control flex items-center justify-center mb-4">
        <HeartIcon size={28} className="text-text-muted" />
      </div>
      <h2 className="text-lg font-medium text-text-primary">No culture standards defined yet</h2>
      <p className="text-text-secondary text-sm mt-1 max-w-xs">
        Define the behaviors your organization expects and prohibits.
      </p>
      {canEdit && (
        <Button className="mt-4" onClick={onEdit}>
          Define culture
        </Button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CulturePage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const canEdit = !!user?.is_admin

  const [standards, setStandards] = useState<CultureStandard[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    getCultureStandards(orgId)
      .then(setStandards)
      .catch(() => setStandards([]))
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const expected = standards.filter((s) => s.type === 'expected_behavior')
  const unacceptable = standards.filter((s) => s.type === 'unacceptable_behavior')

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
        title="Culture Standards"
        meta="The behaviors your organization expects and prohibits."
        actions={
          canEdit && standards.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon size={14} />
              Edit
            </Button>
          ) : undefined
        }
      />

      {standards.length === 0 ? (
        <EmptyState canEdit={canEdit} onEdit={() => setEditing(true)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Column
            title="Expected Behaviors"
            accent="text-success"
            accentBg="bg-success-bg"
            icon={<CheckCircle2Icon size={16} />}
            items={expected}
            type="expected"
          />
          <Column
            title="Unacceptable Behaviors"
            accent="text-danger"
            accentBg="bg-danger-bg"
            icon={<XCircleIcon size={16} />}
            items={unacceptable}
            type="unacceptable"
          />
        </div>
      )}

      {canEdit && (
        <CultureManagerDrawer
          open={editing}
          orgId={orgId}
          onClose={() => setEditing(false)}
          onChanged={load}
        />
      )}
    </div>
  )
}
