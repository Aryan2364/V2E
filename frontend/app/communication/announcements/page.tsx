'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getAnnouncements, markAnnouncementRead, togglePinAnnouncement, deleteAnnouncement } from '@/lib/api/announcements'
import type { Announcement } from '@/lib/types/communication'
import Link from 'next/link'
import { Bell, Pin, Plus, Trash2, Eye } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-danger-bg text-danger',
  high: 'bg-warning-bg text-warning',
  normal: 'bg-surface-control text-text-secondary',
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
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Announcements</h1>
            <p className="text-sm text-text-secondary mt-0.5">Official communications from leadership</p>
          </div>
          {isHR && (
            <Link
              href="/communication/announcements/new"
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-primary-hover transition-colors"
            >
              <Plus size={16} />
              New Announcement
            </Link>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['general', 'policy', 'event', 'emergency'].map(t => (
            <button
              key={t}
              onClick={() => setFilter(f => ({ ...f, type: f.type === t ? undefined : t }))}
              className={[
                'px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors',
                filter.type === t
                  ? 'bg-primary text-white'
                  : 'bg-white border border-border-light text-text-secondary hover:border-primary hover:text-primary-text',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
          {['urgent', 'high'].map(p => (
            <button
              key={p}
              onClick={() => setFilter(f => ({ ...f, priority: f.priority === p ? undefined : p }))}
              className={[
                'px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors',
                filter.priority === p
                  ? 'bg-primary text-white'
                  : 'bg-white border border-border-light text-text-secondary hover:border-primary hover:text-primary-text',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell size={40} className="text-[#CBD5E1] mb-3" />
            <p className="text-text-secondary font-medium">No announcements</p>
            <p className="text-sm text-text-muted">Check back later for updates</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pinned.length > 0 && (
              <>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Pinned</p>
                {pinned.map(a => <AnnouncementCard key={a.id} ann={a} isHR={isHR} onRead={handleRead} onPin={handlePin} onDelete={handleDelete} />)}
                {rest.length > 0 && <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mt-2">Recent</p>}
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
      'bg-white border rounded-[12px] p-5 flex flex-col gap-3',
      ann.is_pinned ? 'border-primary' : 'border-border-light',
      !hasRead ? 'border-l-4 border-l-primary' : '',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_BADGE[ann.priority] ?? PRIORITY_BADGE.normal}`}>
              {ann.priority.toUpperCase()}
            </span>
            <span className="text-xs text-text-secondary bg-surface-control px-2 py-0.5 rounded-full">
              {TYPE_LABEL[ann.type] ?? ann.type}
            </span>
            {ann.is_pinned && <Pin size={12} className="text-primary-text" />}
          </div>
          <Link href={`/communication/announcements/${ann.id}`}>
            <h3 className="text-base font-semibold text-text-primary hover:text-primary-text transition-colors line-clamp-1">
              {ann.title}
            </h3>
          </Link>
          <p className="text-sm text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{ann.body}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!hasRead && (
            <Tooltip label="Mark as read">
            <button
              onClick={() => onRead(ann.id)}
              aria-label="Mark as read"
              className="p-1.5 rounded-[6px] text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
            >
              <Eye size={15} />
            </button>
            </Tooltip>
          )}
          {isHR && (
            <>
              <Tooltip label={ann.is_pinned ? 'Unpin' : 'Pin'}>
              <button
                onClick={() => onPin(ann.id)}
                aria-label={ann.is_pinned ? 'Unpin' : 'Pin'}
                className={`p-1.5 rounded-[6px] transition-colors ${ann.is_pinned ? 'text-primary-text hover:bg-primary-subtle' : 'text-text-secondary hover:bg-surface-control'}`}
              >
                <Pin size={15} />
              </button>
              </Tooltip>
              <Tooltip label="Delete">
              <button
                onClick={() => onDelete(ann.id)}
                aria-label="Delete"
                className="p-1.5 rounded-[6px] text-text-secondary hover:bg-danger-bg hover:text-danger transition-colors"
              >
                <Trash2 size={15} />
              </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span>By {ann.created_by?.name}</span>
        <span>·</span>
        <span>{new Date(ann.published_at ?? ann.created_at).toLocaleDateString()}</span>
        <span>·</span>
        <span>{ann._count?.reads ?? 0} read</span>
      </div>
    </div>
  )
}
