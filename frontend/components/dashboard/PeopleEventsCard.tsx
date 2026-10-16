'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Gift, Heart, UserPlus, Award, ArrowRight } from 'lucide-react'
import WishModal from './WishModal'
import type { PeopleEvent, PeopleEventsResponse } from '@/lib/types'

// ─── Avatar helpers ────────────────────────────────────────────────────────────

const avatarColors = [
  'bg-primary', 'bg-text-secondary', 'bg-text-secondary',
  'bg-warning', 'bg-success', 'bg-text-secondary',
]

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Tab config ────────────────────────────────────────────────────────────────

type TabKey = 'birthdays' | 'anniversaries' | 'new_hirings' | 'work_anniversaries'
type EventType = 'birthday' | 'anniversary' | 'new_hiring' | 'work_anniversary'

interface TabConfig {
  key: TabKey
  eventType: EventType
  label: string
  icon: React.ReactNode
  dot: string
  emptyText: string
}

const TABS: TabConfig[] = [
  {
    key: 'birthdays',
    eventType: 'birthday',
    label: 'Birthdays',
    icon: <Gift size={13} />,
    dot: 'bg-primary',
    emptyText: 'No upcoming birthdays in the next 30 days',
  },
  {
    key: 'anniversaries',
    eventType: 'anniversary',
    label: 'Anniversary',
    icon: <Heart size={13} />,
    dot: 'bg-text-secondary',
    emptyText: 'No upcoming anniversaries in the next 30 days',
  },
  {
    key: 'new_hirings',
    eventType: 'new_hiring',
    label: 'New Hiring',
    icon: <UserPlus size={13} />,
    dot: 'bg-success',
    emptyText: 'No new hires in the last 30 days',
  },
  {
    key: 'work_anniversaries',
    eventType: 'work_anniversary',
    label: 'Work Anniv.',
    icon: <Award size={13} />,
    dot: 'bg-warning',
    emptyText: 'No upcoming work anniversaries in the next 30 days',
  },
]

// ─── Row item ──────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 56 // px — must match the row className h-14

function EventRow({
  event,
  eventType,
  onWish,
}: {
  event: PeopleEvent
  eventType: EventType
  onWish: (ev: PeopleEvent, type: EventType) => void
}) {
  return (
    <div className="h-14 flex items-center gap-3 px-4 border-b border-border-light last:border-b-0">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(event.name)}`}
      >
        {getInitials(event.name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-text-primary truncate">{event.name}</p>
        <p className="text-meta text-text-secondary truncate">{event.label}</p>
      </div>
      <button
        onClick={() => onWish(event, eventType)}
        className="shrink-0 px-3 py-1 text-meta font-medium text-primary-text border border-primary rounded-full hover:bg-primary-subtle transition-colors"
      >
        Wish
      </button>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface PeopleEventsCardProps {
  data: PeopleEventsResponse
}

export default function PeopleEventsCard({ data }: PeopleEventsCardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('birthdays')
  const [scrollOffset, setScrollOffset] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [wishTarget, setWishTarget] = useState<{ event: PeopleEvent; type: EventType } | null>(null)

  const activeConfig = TABS.find((t) => t.key === activeTab)!
  const items: PeopleEvent[] = data[activeTab] ?? []

  const VISIBLE_ROWS = 4
  const containerHeight = VISIBLE_ROWS * ROW_HEIGHT

  // Auto-scroll: advances one row every 3 seconds when list overflows
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setScrollOffset(0)

    if (items.length > VISIBLE_ROWS) {
      intervalRef.current = setInterval(() => {
        setScrollOffset((prev) => {
          const maxOffset = items.length - VISIBLE_ROWS
          return prev >= maxOffset ? 0 : prev + 1
        })
      }, 3000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [activeTab, items.length])

  function handleTabChange(key: TabKey) {
    setActiveTab(key)
    setScrollOffset(0)
  }

  function handleWish(event: PeopleEvent, type: EventType) {
    setWishTarget({ event, type })
  }

  const totalCount = (data.birthdays?.length ?? 0) +
    (data.anniversaries?.length ?? 0) +
    (data.new_hirings?.length ?? 0) +
    (data.work_anniversaries?.length ?? 0)

  return (
    <>
      <div className="bg-surface border border-border-light rounded-xl shadow-card overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border-light">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-warning-bg flex items-center justify-center text-warning">
              <Gift size={16} />
            </div>
            <div>
              <h3 className="text-[15px] font-medium text-text-primary leading-tight">People Events</h3>
              {totalCount > 0 && (
                <p className="text-meta text-text-secondary">{totalCount} event{totalCount !== 1 ? 's' : ''} upcoming</p>
              )}
            </div>
          </div>
          <Link
            href="/settings/organization/employees"
            className="flex items-center gap-1 text-[12px] font-medium text-primary-text hover:text-primary-text transition-colors"
          >
            View all
            <ArrowRight size={12} />
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-light bg-surface-sunken">
          {TABS.map((tab) => {
            const count = data[tab.key]?.length ?? 0
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-meta font-medium transition-colors relative',
                  isActive
                    ? 'text-primary-text bg-surface'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface/60',
                ].join(' ')}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tab.dot}`} />
                <span className="truncate">{tab.label}</span>
                {count > 0 && (
                  <span
                    className={`text-meta font-medium px-1.5 py-0.5 rounded-full leading-none ${
                      isActive ? 'bg-primary-subtle text-primary-text' : 'bg-surface-control-pressed text-text-secondary'
                    }`}
                  >
                    {count}
                  </span>
                )}
                {/* Active underline */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            )
          })}
        </div>

        {/* Event list with auto-scroll */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center" style={{ minHeight: containerHeight }}>
            <div className={`w-8 h-8 rounded-full ${activeConfig.dot} opacity-20 flex items-center justify-center text-primary-foreground mb-2`}>
              {activeConfig.icon}
            </div>
            <p className="text-[13px] text-text-secondary">{activeConfig.emptyText}</p>
          </div>
        ) : (
          <div
            className="overflow-hidden relative"
            style={{ height: containerHeight }}
          >
            <div
              className="transition-transform duration-300 ease-in-out"
              style={{ transform: `translateY(-${scrollOffset * ROW_HEIGHT}px)` }}
            >
              {items.map((ev) => (
                <EventRow
                  key={`${ev.user_id}-${ev.event_date}`}
                  event={ev}
                  eventType={activeConfig.eventType}
                  onWish={handleWish}
                />
              ))}
            </div>
            {/* Fade gradient at bottom when scrollable */}
            {items.length > VISIBLE_ROWS && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-white to-transparent pointer-events-none" />
            )}
          </div>
        )}
      </div>

      {/* Wish modal */}
      {wishTarget && (
        <WishModal
          open={true}
          onClose={() => setWishTarget(null)}
          recipient={wishTarget.event}
          eventType={wishTarget.type}
        />
      )}
    </>
  )
}
