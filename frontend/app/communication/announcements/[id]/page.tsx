'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getAnnouncement, markAnnouncementRead, getReadStatus } from '@/lib/api/announcements'
import type { Announcement } from '@/lib/types/communication'
import { formatDate, formatDateTime } from '@/lib/format'
import Link from 'next/link'
import { Pin, Users } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-danger-bg text-danger',
  high: 'bg-warning-bg text-warning',
  normal: 'bg-surface-control text-text-secondary',
}

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [ann, setAnn] = useState<Announcement | null>(null)
  const [readStatus, setReadStatus] = useState<{ total_employees: number; read_count: number; reads: any[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReads, setShowReads] = useState(false)

  useEffect(() => {
    if (!orgId || !id) return
    Promise.all([
      getAnnouncement(orgId, id),
      isHR ? getReadStatus(orgId, id) : Promise.resolve(null),
    ]).then(([a, rs]) => {
      setAnn(a)
      setReadStatus(rs)
      if (a && (!a.reads || a.reads.length === 0)) {
        markAnnouncementRead(orgId, id)
      }
    }).finally(() => setLoading(false))
  }, [orgId, id, isHR])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!ann) return null

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-2xl mx-auto">
        <PageHeader title={ann.title} trail={[{ label: 'Announcements', href: '/communication/announcements' }]} />

        <div className="bg-surface border border-border-light rounded-card p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`text-meta font-medium px-2 py-0.5 rounded-full ${PRIORITY_BADGE[ann.priority] ?? PRIORITY_BADGE.normal}`}>
              {ann.priority.toUpperCase()}
            </span>
            <span className="text-meta bg-surface-control text-text-secondary px-2 py-0.5 rounded-full capitalize">{ann.type}</span>
            {ann.is_pinned && <Pin size={12} className="text-primary-text" />}
          </div>

          <div className="flex items-center gap-3 text-meta text-text-muted mt-3 mb-6">
            <span>By {ann.created_by?.name}</span>
            <span>·</span>
            <span>{formatDate(ann.published_at ?? ann.created_at)}</span>
          </div>

          <div className="text-label text-text-primary leading-relaxed whitespace-pre-wrap border-t border-border-light pt-4">
            {ann.body}
          </div>

          {isHR && readStatus && (
            <div className="mt-8 border-t border-border-light pt-4">
              <Button variant="secondary" onClick={() => setShowReads(s => !s)} aria-expanded={showReads}>
                <Users size={16} />
                Read by {readStatus.read_count} / {readStatus.total_employees} employees
              </Button>
              {showReads && (
                <div className="mt-3 flex flex-col gap-2">
                  {readStatus.reads.map((r: any) => (
                    <div key={r.user?.id ?? r.user_id} className="flex items-center justify-between text-label">
                      <span className="text-text-primary font-medium">{r.user?.name}</span>
                      <span className="text-text-muted text-meta">{formatDateTime(r.read_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
