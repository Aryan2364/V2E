'use client'

import React from 'react'
import Link from 'next/link'
import { CalendarDays, Plus, RotateCw } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { useMeetingPermissions } from '@/components/meetings/shared'
import type { Meeting } from '@/lib/types/meetings'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState, PhoneFailedState } from '../PhoneEmptyState'
import { MeetingPhoneRow, MeetingPhoneRowSkeleton } from '../MeetingPhoneRow'
import { cx } from '../primitives'
import type { PhoneRoute } from '@/lib/phone-routes'

/*
 * Meetings tab list - plan-phone-2026-10-14.md §5.7. Today/Upcoming, each a
 * section of rows; a + button to create, shown only when the real
 * permission (meetings.write, the same leaf the desktop "+" uses) allows it.
 */

type Tab = 'today' | 'upcoming'

function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function isUpcoming(iso: string | null): boolean {
  if (!iso) return true // no time set yet — surfaced under Upcoming so it isn't lost
  const d = new Date(iso)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return d.getTime() >= startOfToday.getTime() && !isToday(iso)
}

export default function MeetingsScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const { perms, loading: permsLoading } = useMeetingPermissions(orgId)

  const [meetings, setMeetings] = React.useState<Meeting[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('today')

  const load = React.useCallback(async () => {
    if (!orgId) return
    const data = await meetingsApi.list(orgId)
    setMeetings(data)
  }, [orgId])

  const reload = React.useCallback(() => {
    if (!orgId) return
    setLoading(true)
    setFailed(false)
    load()
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [orgId, load])

  React.useEffect(() => {
    reload()
  }, [reload])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await load()
    } catch {
      addToast('Could not refresh. Try again.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const today = (meetings ?? [])
    .filter((m) => isToday(m.scheduled_start))
    .sort((a, b) => new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime())
  const upcoming = (meetings ?? [])
    .filter((m) => isUpcoming(m.scheduled_start))
    .sort((a, b) => new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime())

  const list = tab === 'today' ? today : upcoming
  const canCreate = !permsLoading && perms.write

  return (
    <PhoneScreen title={route.title}>
      <PullHint refreshing={refreshing} onRefresh={onRefresh} />

      <div className="mb-[16px] flex gap-[8px]" role="tablist" aria-label="Meetings">
        {(['today', 'upcoming'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx(
              'min-h-(--h-control) rounded-full px-[16px] py-[6px] text-label font-medium',
              tab === key
                ? 'border border-primary bg-primary-subtle text-primary-text'
                : 'border border-border bg-surface text-text-secondary',
            )}
          >
            {key === 'today' ? `Today${today.length ? ` · ${today.length}` : ''}` : `Upcoming${upcoming.length ? ` · ${upcoming.length}` : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <MeetingPhoneRowSkeleton key={i} />
          ))}
        </div>
      ) : failed ? (
        <PhoneFailedState what="Meetings" onRetry={reload} />
      ) : list.length === 0 ? (
        <PhoneEmptyState
          icon={<CalendarDays />}
          heading={tab === 'today' ? 'No meetings today' : 'Nothing upcoming'}
          line={tab === 'today' ? 'Meetings scheduled for today will show up here.' : 'Meetings scheduled after today will show up here.'}
        />
      ) : (
        <div className="mx-[-16px] mb-[88px] divide-y divide-border-light border-y border-border-light bg-surface">
          {list.map((m) => (
            <MeetingPhoneRow key={m.id} meeting={m} href={`/dashboard/governance/meetings/${m.id}`} />
          ))}
        </div>
      )}

      {canCreate ? (
        <Link
          href="/dashboard/governance/meetings/new"
          aria-label="Create meeting"
          className={cx(
            'fixed z-(--z-shell) flex size-[56px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-dialog active:bg-primary-pressed',
            'right-[max(16px,var(--safe-right))] bottom-[calc(var(--bottom-bar)+var(--safe-bottom)+16px)]',
          )}
        >
          <Plus aria-hidden className="size-[26px]" />
        </Link>
      ) : null}
    </PhoneScreen>
  )
}

function PullHint({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const [pull, setPull] = React.useState(0)
  const start = React.useRef<number | null>(null)
  const THRESHOLD = 64

  const onPointerDown = (e: React.PointerEvent) => {
    if (window.scrollY > 0) return
    start.current = e.clientY
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current === null || refreshing) return
    const dy = e.clientY - start.current
    if (dy > 0 && window.scrollY === 0) setPull(Math.min(dy, THRESHOLD * 1.5))
  }
  const onPointerUp = () => {
    if (pull >= THRESHOLD) onRefresh()
    setPull(0)
    start.current = null
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ height: refreshing ? 40 : pull }}
      className="flex items-center justify-center overflow-hidden transition-[height] duration-(--duration-fast)"
    >
      {refreshing || pull > 8 ? (
        <RotateCw aria-hidden className={cx('size-[20px] text-text-secondary', refreshing && 'animate-spin')} />
      ) : null}
    </div>
  )
}
