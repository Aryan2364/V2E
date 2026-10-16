'use client'

import React from 'react'
import { RESPONSE_META, type MeetingAttendee } from '@/lib/types/meetings'
import { PhoneSheet } from './PhoneSheet'

/*
 * "Attendees · N" row opens this - plan-phone-2026-10-14.md §5.8. Read-only
 * list: name, required/optional, response. No editing on phone.
 */
export function AttendeesListSheet({
  open,
  onOpenChange,
  attendees,
  organizerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attendees: MeetingAttendee[]
  organizerId?: string
}) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} title={`Attendees · ${attendees.length}`}>
      <ul className="mx-[-16px] divide-y divide-phone-border-light">
        {attendees.map((a) => {
          const isOrganiser = a.user_id === organizerId || a.is_organizer
          const rm = a.response === 'declined' ? RESPONSE_META.declined : null
          return (
            <li key={a.id} className="flex min-h-[48px] items-center justify-between gap-[12px] px-[16px] py-[10px]">
              <span className="min-w-0 flex-1 truncate text-phone-body text-phone-text-primary">
                {a.user?.name ?? 'Unknown'}
                {isOrganiser ? <span className="ml-[6px] text-phone-meta text-phone-text-secondary">· Organiser</span> : null}
                {!a.is_required && !isOrganiser ? <span className="ml-[6px] text-phone-meta text-phone-text-secondary">· Optional</span> : null}
              </span>
              {rm ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-phone-meta font-medium"
                  style={{ backgroundColor: rm.bg, color: rm.text }}
                >
                  {rm.label}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </PhoneSheet>
  )
}
