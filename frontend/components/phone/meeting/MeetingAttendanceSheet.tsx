'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { RESPONSE_META, type Meeting } from '@/lib/types/meetings'
import { PhoneSheet } from '../PhoneSheet'
import { ROW, ROW_BLOCK, cx } from '../primitives'
import { MANAGE_REASON } from './meetingShared'

/*
 * Attendance - the computer's People card (meetings/[meetingId]/page.tsx
 * 311-319): once the meeting is in progress or closed, the people who can
 * manage it mark each attendee present or absent (POST :id/attendance with
 * rows [{ user_id, attended }]). Everyone else sees who attended, read-only.
 * The computer has no "late" mark, so neither does this.
 */
export function MeetingAttendanceSheet({ orgId, meeting, onChanged }: { orgId: string; meeting: Meeting; onChanged: (m: Meeting) => void }) {
  const { addToast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const attendees = meeting.attendees ?? []
  const present = attendees.filter((a) => a.attended).length
  const canMark = !!meeting.can_manage && (meeting.status === 'in_progress' || meeting.status === 'closed')

  if (meeting.status !== 'in_progress' && meeting.status !== 'closed') return null

  async function mark(userId: string, attended: boolean) {
    setPending(userId)
    try {
      onChanged(await meetingsApi.markAttendance(orgId, meeting.id, [{ user_id: userId, attended }]))
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not mark attendance. Try again.'), 'error')
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <div className={ROW_BLOCK}>
        <button type="button" className={ROW} onClick={() => setOpen(true)}>
          <span className="min-w-0 flex-1 text-body text-text-primary">Attendance · {present} of {attendees.length} present</span>
          <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
        </button>
      </div>
      <PhoneSheet open={open} onOpenChange={setOpen} title="Attendance" fullHeight>
        {!canMark ? <p className="pb-[8px] text-meta text-text-secondary">{MANAGE_REASON} to mark who attended.</p> : null}
        <ul className="mx-[-16px] divide-y divide-border-light">
          {attendees.map((a) => {
            const declined = a.response === 'declined'
            return (
              <li key={a.id} className="flex min-h-[56px] items-center justify-between gap-[12px] px-[16px] py-[8px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-text-primary">{a.user?.name ?? 'Unknown'}</span>
                  {declined ? <span className="block text-meta" style={{ color: RESPONSE_META.declined.text }}>Said they can&apos;t make it</span> : null}
                </span>
                {canMark ? (
                  <div role="group" aria-label={`Attendance for ${a.user?.name ?? 'attendee'}`} className="flex shrink-0 overflow-hidden rounded-[8px] border-2 border-primary">
                    {([true, false] as const).map((val) => (
                      <button
                        key={String(val)}
                        type="button"
                        aria-pressed={a.attended === val}
                        disabled={pending === a.user_id}
                        onClick={() => a.attended !== val && void mark(a.user_id, val)}
                        className={cx(
                          'min-h-[44px] min-w-[72px] px-[12px] text-body font-medium',
                          a.attended === val ? 'bg-primary text-primary-foreground' : 'bg-surface text-primary-text',
                        )}
                      >
                        {val ? 'Present' : 'Absent'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-body text-text-secondary">{a.attended ? 'Present' : 'Absent'}</span>
                )}
              </li>
            )
          })}
        </ul>
      </PhoneSheet>
    </>
  )
}
