'use client'

import { Suspense, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getAnnouncementsPaged, markAnnouncementRead, togglePinAnnouncement, deleteAnnouncement } from '@/lib/api/announcements'
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
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { useListAddress, queryOf, type AddressParams } from '@/lib/list-address'

const PAGE_SIZE = 25

type Criteria = { type: string; priority: string; page: number }

function readCriteria(params: AddressParams): Criteria {
  return {
    type: params.get('type') ?? '',
    priority: params.get('priority') ?? '',
    page: Number(params.get('page')) > 0 ? Number(params.get('page')) : 1,
  }
}
function criteriaQuery(c: Criteria): string {
  return queryOf([
    ['type', c.type],
    ['priority', c.priority],
    ['page', c.page !== 1 && c.page.toString()],
  ])
}

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

function AnnouncementsPageInner() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [items, setItems] = useState<Announcement[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const { criteria, apply } = useListAddress<Criteria>({ read: readCriteria, query: criteriaQuery })
  const { type, priority, page } = criteria
  const filter = { type: type || undefined, priority: priority || undefined }

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    getAnnouncementsPaged(orgId, { ...filter, page, pageSize: PAGE_SIZE })
      .then((res) => { setItems(res.items); setTotal(res.total) })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, type, priority, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const setPage = (next: number) => apply({ ...criteria, page: next }, 'push')
  const toggleType = (t: string) => apply({ ...criteria, type: type === t ? '' : t, page: 1 }, 'push')
  const togglePriority = (p: string) => apply({ ...criteria, priority: priority === p ? '' : p, page: 1 }, 'push')

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
              variant={type === t ? 'primary' : 'secondary'}
              className="capitalize"
              onClick={() => toggleType(t)}
            >
              {t}
            </Button>
          ))}
          {['urgent', 'high'].map(p => (
            <Button
              key={p}
              size="sm"
              variant={priority === p ? 'primary' : 'secondary'}
              className="capitalize"
              onClick={() => togglePriority(p)}
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
          <>
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
          <PaginationBar className="mt-4 rounded-card">
            <PaginationCount>{rangeStart}–{rangeEnd} of {total}</PaginationCount>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious aria-disabled={page <= 1} onClick={() => page > 1 && setPage(page - 1)} />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive>{page}</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext aria-disabled={page >= totalPages} onClick={() => page < totalPages && setPage(page + 1)} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </PaginationBar>
          </>
        )}
      </div>
    </div>
  )
}

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={null}>
      <AnnouncementsPageInner />
    </Suspense>
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
