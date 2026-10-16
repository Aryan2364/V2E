'use client'

import { fmtShortDate, fmtTime } from '@/lib/phone-format'
import React from 'react'
import Link from 'next/link'
import { Video, MapPin } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { MEETING_STATUS_META, RESPONSE_META, type Meeting } from '@/lib/types/meetings'
import { cx } from './primitives'

/*
 * One row on the Meetings list (plan-phone-2026-10-14.md §5.7). Line 1:
 * title + status badge. Line 2: time range + place/online. Line 3:
 * organiser, or my response when I am not the organiser and have declined
 * (41.5 rules 9-11 — up to two supporting facts plus one meta line).
 */

function fmtTimeRange(start: string | null, end: string | null): string {
  if (!start) return 'No time set'
  const s = new Date(start)
  const startStr = fmtTime(s)
  if (!end) return startStr
  const e = new Date(end)
  const sameDay = s.toDateString() === e.toDateString()
  const endStr = fmtTime(e)
  return sameDay ? `${startStr} – ${endStr}` : `${startStr} – ${fmtShortDate(e)}, ${endStr}`
}

export function MeetingPhoneRow({ meeting, href }: { meeting: Meeting; href: string }) {
  const { user } = useAuth()
  const statusMeta = MEETING_STATUS_META[meeting.status]
  const mine = meeting.attendees?.find((a) => a.user_id === user?.id)
  const organiserName = meeting.organizer?.name ?? '—'
  const isOrganiser = meeting.organizer?.id === user?.id || meeting.created_by_user_id === user?.id

  let line3: React.ReactNode = <span className="truncate">Organiser: {organiserName}</span>
  if (!isOrganiser && mine?.response === 'declined') {
    const rm = RESPONSE_META.declined
    line3 = (
      <span className="inline-flex items-center rounded-full px-[8px] py-px text-phone-meta font-medium" style={{ backgroundColor: rm.bg, color: rm.text }}>
        {rm.label}
      </span>
    )
  }

  return (
    <Link href={href} className="flex min-h-[64px] w-full flex-col gap-[4px] px-[16px] py-[12px] text-left active:bg-surface-control">
      <span className="flex items-start justify-between gap-[8px]">
        <span className="min-w-0 flex-1 text-phone-body font-semibold text-text-primary line-clamp-2">{meeting.title}</span>
        <span
          className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-phone-meta font-semibold"
          style={{ backgroundColor: statusMeta.bg, color: statusMeta.text }}
        >
          {statusMeta.label}
        </span>
      </span>
      <span className="flex items-center gap-[6px] truncate text-phone-label text-text-secondary">
        <span className="truncate">{fmtTimeRange(meeting.scheduled_start, meeting.scheduled_end)}</span>
        <span aria-hidden>·</span>
        {meeting.type === 'online' ? (
          <span className="inline-flex items-center gap-[4px] truncate">
            <Video aria-hidden className="size-[14px] shrink-0" />
            Online
          </span>
        ) : (
          <span className="inline-flex items-center gap-[4px] truncate">
            <MapPin aria-hidden className="size-[14px] shrink-0" />
            {meeting.location || 'In person'}
          </span>
        )}
      </span>
      <span className="truncate text-phone-meta text-text-secondary">{line3}</span>
    </Link>
  )
}

export function MeetingPhoneRowSkeleton() {
  return (
    <div className="flex min-h-[64px] flex-col gap-[8px] px-[16px] py-[12px]" aria-hidden>
      <span className="h-[16px] w-3/4 rounded-full bg-surface-control" />
      <span className="h-[12px] w-1/2 rounded-full bg-surface-control" />
      <span className="h-[10px] w-1/3 rounded-full bg-surface-control" />
    </div>
  )
}
