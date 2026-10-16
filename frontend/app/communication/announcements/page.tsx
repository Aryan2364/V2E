'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getAnnouncements, markAnnouncementRead, togglePinAnnouncement, deleteAnnouncement } from '@/lib/api/announcements'
import type { Announcement } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
import Link from 'next/link'
import { Pin, Plus, Trash2, Eye, TriangleAlert, CircleDashed } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

const PRIORITY_VARIANT: Record<string, 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
}
const PRIORITY_ICON: Record<string, typeof TriangleAlert> = {
  urgent: TriangleAlert,
  high: TriangleAlert,
  normal: CircleDashed,
}

const TYPE_LABEL: Record<string, string> = {
  general: 'General',
  policy: 'Policy',
  event: 'Event',
  emergency: 'Emergency',
}

export default function AnnouncementsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<{ type?: string; priority?: string }>({})

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    getAnnouncements(orgId, filter)
      .then(setItems)
      .finally(() => setLoading(false))
  }, [orgId, filter])

  async function handleRead(id: string) {
    if (!orgId) return
    await markAnnouncementRead(orgId, id)
    setItems(prev => prev.map(a => a.id === id ? { ...a, reads: [{ read_at: new Date().toISOString() }] } : a))
  }

  async function handlePin(id: string) {
    if (!orgId) return
    const updated = await togglePinAnnouncement(orgId, id)
    setItems(prev => prev.map(a => a.id === id ? { ...a, is_pinned: updated.is_pinned } : a))
  }

  async function handleDelete(id: string) {
    if (!orgId) return
    await deleteAnnouncement(orgId, id)
    setItems(prev => prev.filter(a => a.id !== id))
  }

  const pinned = items.filter(a => a.is_pinned)
  const rest = items.filter(a => !a.is_pinned)

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-3xl mx-auto">
        <PageHeader
          title="Announcements"
          meta="Official communications from leadership"
          actions={
            isHR ? (
              <Button render={<Link href="/communication/announcements/new" />}>
                <Plus size={16} /> New announcement
              </Button>
            ) : undefined
          }
        />

        {/* Filters */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['general', 'policy', 'event', 'emergency'].map(t => (
            <Button
              key={t}
              size="sm"
              variant={filter.type === t ? 'primary' : 'secondary'}
              className="capitalize"
              onClick={() => setFilter(f => ({ ...f, type: f.type === t ? undefined : t }))}
            >
              {t}
            </Button>
          ))}
          {['urgent', 'high'].map(p => (
            <Button
              key={p}
              size="sm"
              variant={filter.priority === p ? 'primary' : 'secondary'}
              className="capitalize"
              onClick={() => setFilter(f => ({ ...f, priority: f.priority === p ? undefined : p }))}
            >
              {p}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState variant="nothing-yet" heading="No announcements">
            Check back later for updates.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {pinned.length > 0 && (
              <>
                <p className="text-meta font-medium text-text-muted uppercase tracking-wider">Pinned</p>
                {pinned.map(a => <AnnouncementCard key={a.id} ann={a} isHR={isHR} onRead={handleRead} onPin={handlePin} onDelete={handleDelete} />)}
                {rest.length > 0 && <p className="text-meta font-medium text-text-muted uppercase tracking-wider mt-2">Recent</p>}
              </>
            )}
            {rest.map(a => <AnnouncementCard key={a.id} ann={a} isHR={isHR} onRead={handleRead} onPin={handlePin} onDelete={handleDelete} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function AnnouncementCard({
  ann, isHR, onRead, onPin, onDelete,
}: {
  ann: Announcement
  isHR: boolean
  onRead: (id: string) => void
  onPin: (id: string) => void
  onDelete: (id: string) => void
}) {
  const hasRead = ann.reads && ann.reads.length > 0

  return (
    <div className={[
      'bg-surface border rounded-card p-4 flex flex-col gap-3',
      ann.is_pinned ? 'border-primary' : 'border-border-light',
      !hasRead ? 'border-l-4 border-l-primary' : '',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {(() => {
              const Icon = PRIORITY_ICON[ann.priority] ?? PRIORITY_ICON.normal
              return (
                <Badge variant={PRIORITY_VARIANT[ann.priority] ?? 'neutral'}>
                  <Icon /> {ann.priority.toUpperCase()}
                </Badge>
              )
            })()}
            <Badge variant="neutral">{TYPE_LABEL[ann.type] ?? ann.type}</Badge>
            {ann.is_pinned && <Pin size={12} className="text-primary-text" />}
          </div>
          <Link href={`/communication/announcements/${ann.id}`}>
            <h3 className="text-body font-medium text-text-primary hover:text-primary-text transition-colors line-clamp-1">
              {ann.title}
            </h3>
          </Link>
          <p className="text-label text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{ann.body}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!hasRead && (
            <Tooltip label="Mark as read">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Mark as read"
                onClick={() => onRead(ann.id)}
              >
                <Eye size={15} />
              </Button>
            </Tooltip>
          )}
          {isHR && (
            <>
              <Tooltip label={ann.is_pinned ? 'Unpin' : 'Pin'}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={ann.is_pinned ? 'Unpin' : 'Pin'}
                  className={ann.is_pinned ? 'text-primary-text' : ''}
                  onClick={() => onPin(ann.id)}
                >
                  <Pin size={15} />
                </Button>
              </Tooltip>
              <Tooltip label="Delete">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  className="hover:bg-danger-bg hover:text-danger"
                  onClick={() => onDelete(ann.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-meta text-text-muted">
        <span>By {ann.created_by?.name}</span>
        <span>·</span>
        <span>{formatDate(ann.published_at ?? ann.created_at)}</span>
        <span>·</span>
        <span>{ann._count?.reads ?? 0} read</span>
      </div>
    </div>
  )
}
