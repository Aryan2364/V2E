'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getAnnouncement, markAnnouncementRead, getReadStatus } from '@/lib/api/announcements'
import type { Announcement } from '@/lib/types/communication'
import Link from 'next/link'
import { ArrowLeft, Pin, Users } from 'lucide-react'

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
        <Link
          href="/communication/announcements"
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 w-fit"
        >
          <ArrowLeft size={16} />
          Back to Announcements
        </Link>

        <div className="bg-white border border-border-light rounded-[12px] p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_BADGE[ann.priority] ?? PRIORITY_BADGE.normal}`}>
              {ann.priority.toUpperCase()}
            </span>
            <span className="text-xs bg-surface-control text-text-secondary px-2 py-0.5 rounded-full capitalize">{ann.type}</span>
            {ann.is_pinned && <Pin size={12} className="text-primary-text" />}
          </div>

          <h1 className="text-2xl font-bold text-text-primary mb-2">{ann.title}</h1>

          <div className="flex items-center gap-3 text-xs text-text-muted mb-6">
            <span>By {ann.created_by?.name}</span>
            <span>·</span>
            <span>{new Date(ann.published_at ?? ann.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>

          <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap border-t border-border-light pt-5">
            {ann.body}
          </div>

          {isHR && readStatus && (
            <div className="mt-8 border-t border-border-light pt-5">
              <button
                onClick={() => setShowReads(s => !s)}
                className="flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
              >
                <Users size={16} />
                Read by {readStatus.read_count} / {readStatus.total_employees} employees
              </button>
              {showReads && (
                <div className="mt-3 flex flex-col gap-2">
                  {readStatus.reads.map((r: any) => (
                    <div key={r.user?.id ?? r.user_id} className="flex items-center justify-between text-sm">
                      <span className="text-text-primary font-medium">{r.user?.name}</span>
                      <span className="text-text-muted text-xs">{new Date(r.read_at).toLocaleString()}</span>
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
