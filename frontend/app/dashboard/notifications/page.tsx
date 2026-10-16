'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { notificationsApi, type AppNotification } from '@/lib/api/notifications'
import { useNotifications } from '@/lib/notifications/NotificationsProvider'

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
  const d = new Date(iso)
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
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
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight">Notifications</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {unread > 0 ? `${unread} unread notification${unread !== 1 ? 's' : ''}` : 'You’re all caught up.'}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={handleMarkAll}
            className="flex items-center gap-2 px-4 py-[9px] text-sm font-semibold text-primary-text bg-primary-subtle border border-primary-border rounded-[8px] hover:bg-primary-subtle transition-colors shrink-0"
          >
            <CheckCheck size={15} /> Mark all read
          </button>
        )}
      </div>

      {/* Module filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MODULE_FILTERS.map((m) => (
          <button
            key={m}
            onClick={() => setModuleFilter(m)}
            className={[
              'px-3 py-1.5 rounded-[999px] text-xs font-semibold capitalize transition-colors',
              moduleFilter === m
                ? 'bg-primary text-white'
                : 'bg-white border border-border-light text-text-secondary hover:border-border',
            ].join(' ')}
          >
            {m === 'all' ? 'All' : m}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Bell size={24} className="text-text-muted" />
          </div>
          <p className="font-semibold text-text-primary">No notifications</p>
          <p className="text-sm text-text-secondary mt-1">Activity on your tasks and projects will appear here.</p>
        </div>
      ) : (
        <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] divide-y divide-surface-control overflow-hidden">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={[
                'w-full text-left px-5 py-4 transition-colors hover:bg-surface-sunken',
                n.is_read ? '' : 'bg-primary-subtle/40',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                {!n.is_read && <span className="mt-2 w-2 h-2 rounded-full bg-primary shrink-0" />}
                <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-5' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-text-primary">{n.title}</p>
                    <span
                      className={`inline-flex rounded-[999px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${MODULE_COLORS[n.module] ?? MODULE_COLORS.system}`}
                    >
                      {n.module}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mt-0.5 whitespace-pre-line">{n.body}</p>
                  <p className="text-xs text-text-muted mt-1.5">{formatWhen(n.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {cursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2.5 text-sm font-medium text-primary-text bg-white border border-border-light rounded-[10px] hover:bg-surface-sunken disabled:opacity-60 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load older notifications'}
        </button>
      )}
    </div>
  )
}
