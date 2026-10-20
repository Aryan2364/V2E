'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { notificationsApi, type AppNotification } from '@/lib/api/notifications'
import { useNotifications } from '@/lib/notifications/NotificationsProvider'
import { formatDateTime } from '@/lib/format'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const MODULE_COLORS: Record<string, string> = {
  tasks: 'bg-primary-subtle text-primary-text border-primary-border',
  projects: 'bg-surface-control text-text-secondary border-border-light',
  workflows: 'bg-success-bg text-success border-success-border',
  tickets: 'bg-warning-bg text-warning border-warning-border',
  meetings: 'bg-success-bg text-success border-success-border',
  communication: 'bg-danger-bg text-text-secondary border-danger-border',
  system: 'bg-surface-control text-text-secondary border-border-light',
}

const MODULE_FILTERS = ['all', 'tasks', 'projects', 'workflows', 'tickets', 'meetings'] as const

function formatWhen(iso: string): string {
  return formatDateTime(iso)
}

export default function NotificationsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { markAllRead: markAllReadGlobal, refresh: refreshBell } = useNotifications()

  const [items, setItems] = useState<AppNotification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moduleFilter, setModuleFilter] = useState<(typeof MODULE_FILTERS)[number]>('all')

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await notificationsApi.list(orgId, undefined, 30)
      setItems(res.items)
      setCursor(res.next_cursor)
      setUnread(res.unread_count)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await notificationsApi.list(orgId, cursor, 30)
      setItems((prev) => [...prev, ...res.items])
      setCursor(res.next_cursor)
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleClick(n: AppNotification) {
    if (!n.is_read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)))
      setUnread((c) => Math.max(0, c - 1))
      notificationsApi.markRead(orgId, n.id).then(refreshBell).catch(() => null)
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })))
    setUnread(0)
    await markAllReadGlobal()
  }

  const filtered = moduleFilter === 'all' ? items : items.filter((n) => n.module === moduleFilter)

  if (loading) {
    return (
      <div className="space-y-3 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Notifications"
        meta={unread > 0 ? `${unread} unread notification${unread !== 1 ? 's' : ''}` : "You're all caught up."}
        actions={unread > 0 ? (
          <Button variant="secondary" onClick={handleMarkAll}>
            <CheckCheck size={15} /> Mark all read
          </Button>
        ) : undefined}
      />

      {/* Module filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MODULE_FILTERS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={moduleFilter === m}
            onClick={() => setModuleFilter(m)}
            className={[
              'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring px-3 py-1.5 rounded-full text-meta font-medium capitalize transition-colors',
              moduleFilter === m
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface border border-border-light text-text-secondary hover:border-border',
            ].join(' ')}
          >
            {m === 'all' ? 'All' : m}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-xl shadow-card flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Bell size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">No notifications</p>
          <p className="text-body text-text-secondary mt-1">Activity on your tasks and projects will appear here.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border-light rounded-xl shadow-card divide-y divide-surface-control overflow-hidden">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={[
                'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full text-left px-4 py-4 transition-colors hover:bg-surface-sunken',
                n.is_read ? '' : 'bg-primary-subtle/40',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                {!n.is_read && <span className="mt-2 w-2 h-2 rounded-full bg-primary shrink-0" />}
                <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-4' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-body font-medium text-text-primary">{n.title}</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-meta font-medium uppercase tracking-wide ${MODULE_COLORS[n.module] ?? MODULE_COLORS.system}`}
                    >
                      {n.module}
                    </span>
                  </div>
                  <p className="text-body text-text-secondary mt-0.5 whitespace-pre-line">{n.body}</p>
                  <p className="text-meta text-text-muted mt-1.5">{formatWhen(n.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {cursor && (
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore} loading={loadingMore} loadingLabel="Loading" className="w-full">
          Load older notifications
        </Button>
      )}
    </div>
  )
}
