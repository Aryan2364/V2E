'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Ellipsis, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { notificationsApi, type AppNotification } from '@/lib/api/notifications'
import { useNotifications } from '@/lib/notifications/NotificationsProvider'
import PhoneScreen from '../PhoneScreen'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneSheet } from '../PhoneSheet'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { PhoneButton, ROW, ROW_BLOCK, cx } from '../primitives'

/*
 * Notifications on phone - FRONTEND_RULES_PHONE.md 41.12 rule 1, 41.5.
 *
 * A screen of its own (a tab), not the desktop bell panel. It reads the same
 * data as the desktop page (/dashboard/notifications, lib/api/notifications)
 * and shares the app's unread count (NotificationsProvider), so the tab's
 * count, the bell and this list never disagree.
 *
 *   - Rows edge to edge, newest first: the title in body strong, the text
 *     clamped at two lines with no "Show more" (the full text is on the item
 *     the row opens), then when it arrived. Tapping a row marks it read and
 *     opens its link - the same address on any device (41.2 rule 4).
 *   - The unread dot: a filled primary dot while unread, a hollow
 *     border-outlined dot once read (41.9 rule 9). On an unread row it is a
 *     44px button, "Mark as read" (41.12 rule 6). The backend has no way to
 *     mark a notification unread again, so a read row's dot is a mark only.
 *   - "Mark all as read" sits in the app bar's three-dot menu, a bottom sheet
 *     (41.12 rule 1, 41.8).
 *   - 25 rows first, the next 25 as the end comes near, stopping at 200 with
 *     one line saying so (41.5 rules 14 and 15).
 */

const PAGE = 25
const MAX_ROWS = 200

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : WHEN.format(d)
}

type LoadState = 'loading' | 'ready' | 'failed'

export default function NotificationsScreen({ title }: { title: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { unreadCount, markAllRead, refresh: refreshCount } = useNotifications()

  const [items, setItems] = React.useState<AppNotification[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [state, setState] = React.useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  const load = React.useCallback(async () => {
    if (!orgId) return
    setState('loading')
    try {
      const res = await notificationsApi.list(orgId, undefined, PAGE)
      setItems(res.items)
      setCursor(res.next_cursor)
      setState('ready')
    } catch {
      setState('failed')
    }
  }, [orgId])

  React.useEffect(() => {
    void load()
  }, [load])

  const capped = items.length >= MAX_ROWS
  const loadMore = React.useCallback(async () => {
    if (!cursor || loadingMore || capped || !orgId) return
    setLoadingMore(true)
    try {
      const res = await notificationsApi.list(orgId, cursor, PAGE)
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id))
        return [...prev, ...res.items.filter((n) => !seen.has(n.id))].slice(0, MAX_ROWS)
      })
      setCursor(res.next_cursor)
    } catch {
      /* the end marker stays; scrolling again retries */
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, capped, orgId])

  // The next page loads as the end of the list comes near (41.5 rule 14).
  React.useEffect(() => {
    const el = endRef.current
    if (!el || !cursor || capped) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [cursor, capped, loadMore])

  const markOneRead = (n: AppNotification) => {
    if (n.is_read) return
    // In place, same key: the row never flickers (update, not re-create).
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)))
    notificationsApi
      .markRead(orgId, n.id)
      .then(refreshCount)
      .catch(() => null)
  }

  const open = (n: AppNotification) => {
    markOneRead(n)
    if (n.link) router.push(n.link)
  }

  const onMarkAll = async () => {
    setMenuOpen(false)
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })))
    await markAllRead()
  }

  const anyUnread = unreadCount > 0 || items.some((n) => !n.is_read)

  return (
    <PhoneScreen
      title={title}
      actions={
        <button
          type="button"
          aria-label="More actions"
          className={APP_BAR_BUTTON}
          onClick={() => setMenuOpen(true)}
        >
          <Ellipsis aria-hidden />
        </button>
      }
    >
      {state === 'loading' ? (
        <SkeletonRows />
      ) : state === 'failed' ? (
        <PhoneEmptyState
          icon={<RefreshCw />}
          heading="Notifications could not be loaded"
          line="Check your connection, then try again."
        >
          <PhoneButton variant="primary" fullWidth onClick={() => void load()}>
            Try again
          </PhoneButton>
        </PhoneEmptyState>
      ) : items.length === 0 ? (
        <PhoneEmptyState
          icon={<Bell />}
          heading="No notifications"
          line="Activity on your tasks, meetings and projects will appear here."
        />
      ) : (
        <>
          <p className="mb-[12px] text-phone-label text-phone-text-secondary">
            {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up.'}
          </p>
          <ul className={ROW_BLOCK}>
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={open} onMarkRead={markOneRead} />
            ))}
          </ul>
          <div ref={endRef} aria-hidden />
          {loadingMore ? <SkeletonRows count={3} /> : null}
          {capped && cursor ? (
            <p className="mt-[16px] text-center text-phone-label text-phone-text-secondary">
              Showing the latest {MAX_ROWS}. Older notifications are on the computer.
            </p>
          ) : null}
        </>
      )}

      <PhoneSheet open={menuOpen} onOpenChange={setMenuOpen} title="Notifications">
        <ul className="-mx-[16px]">
          <li>
            <button
              type="button"
              disabled={!anyUnread}
              onClick={() => void onMarkAll()}
              className={cx(ROW, 'disabled:text-phone-text-secondary disabled:active:bg-transparent')}
            >
              Mark all as read
            </button>
          </li>
        </ul>
        {!anyUnread ? (
          <p className="mt-[4px] text-phone-label text-phone-text-secondary">Everything is already read.</p>
        ) : null}
      </PhoneSheet>
    </PhoneScreen>
  )
}

function NotificationRow({
  n,
  onOpen,
  onMarkRead,
}: {
  n: AppNotification
  onOpen: (n: AppNotification) => void
  onMarkRead: (n: AppNotification) => void
}) {
  return (
    <li className="relative flex min-h-[64px] bg-phone-surface">
      {/* The dot: 44px target on an unread row (41.12 rule 6, 41.9 rule 9). */}
      {n.is_read ? (
        <span aria-hidden className="flex w-[44px] shrink-0 justify-center pt-[19px]">
          <span className="size-[10px] rounded-full border-2 border-phone-border" />
        </span>
      ) : (
        <button
          type="button"
          aria-label="Mark as read"
          onClick={() => onMarkRead(n)}
          className="flex w-[44px] shrink-0 justify-center pt-[19px] outline-none active:bg-phone-surface-control focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phone-primary-ring"
        >
          <span className="size-[10px] rounded-full bg-phone-primary" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="min-w-0 flex-1 py-[12px] pr-[16px] text-left outline-none transition-[background-color] duration-[var(--duration-fast)] active:bg-phone-surface-control focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phone-primary-ring"
      >
        <span
          className={cx(
            'line-clamp-2 text-phone-body text-phone-text-primary',
            n.is_read ? 'font-normal' : 'font-semibold',
          )}
        >
          {n.title}
        </span>
        {n.body ? (
          <span className="mt-[2px] line-clamp-2 text-phone-label text-phone-text-secondary">{n.body}</span>
        ) : null}
        <span className="mt-[4px] block text-phone-meta text-phone-text-muted">{formatWhen(n.created_at)}</span>
      </button>
    </li>
  )
}

function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <ul aria-hidden className={cx(ROW_BLOCK, 'mt-[12px]')}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex min-h-[64px] items-start gap-[12px] px-[16px] py-[14px]">
          <span className="mt-[4px] size-[10px] shrink-0 rounded-full bg-phone-surface-control-pressed" />
          <span className="flex flex-1 flex-col gap-[8px]">
            <span className="h-[14px] w-3/4 animate-pulse rounded bg-phone-surface-control-pressed" />
            <span className="h-[12px] w-1/2 animate-pulse rounded bg-phone-surface-control" />
          </span>
        </li>
      ))}
    </ul>
  )
}
