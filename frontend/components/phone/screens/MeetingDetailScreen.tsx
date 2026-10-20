'use client'

import { fmtDateTime, fmtTime } from '@/lib/phone-format'
import React from 'react'
import { useParams } from 'next/navigation'
import { ChevronRight, Video, MapPin } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting } from '@/lib/types/meetings'
import { MEETING_STATUS_META } from '@/lib/types/meetings'
import { PHONE_HOME, MEETINGS_HREF, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, cx } from '../primitives'
import { DeclineMeetingSheet } from '../DeclineMeetingSheet'
import { AttendeesListSheet } from '../AttendeesListSheet'

/*
 * Meeting detail - plan-phone-2026-10-14.md §5.8, kit §41.6. Title + status,
 * 4 key facts, Join/decline in the action bar, attendees and agenda below.
 * Start/End/Close/Cancel/Reopen and minutes stay on the computer (owner
 * scope, D11) — not drawn here even though the endpoints exist.
 */
export default function MeetingDetailScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ meetingId: string }>()
  const meetingId = params?.meetingId
  const { user } = useAuth()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [meeting, setMeeting] = React.useState<Meeting | null>(null)
  const [error, setError] = React.useState(false)
  const [declineOpen, setDeclineOpen] = React.useState(false)
  const [attendeesOpen, setAttendeesOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(() => {
    if (!orgId || !meetingId) return
    meetingsApi
      .get(orgId, meetingId)
      .then((m) => {
        setMeeting(m)
        setError(false)
      })
      .catch(() => setError(true))
  }, [orgId, meetingId])

  React.useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <PhoneScreen title="Meeting" parent={route.parent ?? MEETINGS_HREF}>
        <PhoneEmptyState
          icon={<span aria-hidden>!</span>}
          heading="This meeting could not be opened"
          line="It may have been removed, or you may no longer have access to it."
        >
          <PhoneLinkButton href={route.parent ?? MEETINGS_HREF} fullWidth>
            Go to Meetings
          </PhoneLinkButton>
        </PhoneEmptyState>
      </PhoneScreen>
    )
  }

  if (!meeting) {
    return (
      <PhoneScreen title="Meeting" parent={route.parent ?? MEETINGS_HREF}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  const mine = meeting.attendees?.find((a) => a.user_id === user?.id)
  const amAttendee = !!mine
  const declined = mine?.response === 'declined'
  const statusMeta = MEETING_STATUS_META[meeting.status]

  async function doDecline(reason: string) {
    if (!meetingId) return
    setBusy(true)
    try {
      const updated = await meetingsApi.decline(orgId, meetingId, reason)
      setMeeting(updated)
      setDeclineOpen(false)
      addToast('Meeting declined', 'success')
    } catch {
      addToast('Could not decline. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function doUndoDecline() {
    if (!meetingId) return
    setBusy(true)
    try {
      const updated = await meetingsApi.undoDecline(orgId, meetingId)
      setMeeting(updated)
      addToast('Decline undone', 'success')
    } catch {
      addToast('Could not undo. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function onJoinOrDirections() {
    if (meeting!.type === 'online' && meeting!.online_link) {
      window.open(meeting!.online_link, '_blank', 'noopener,noreferrer')
    } else if (meeting!.location) {
      window.open(`https://maps.google.com/?q=${encodeURIComponent(meeting!.location)}`, '_blank', 'noopener,noreferrer')
    }
  }

  const when = meeting.scheduled_start
    ? `${fmtDateTime(meeting.scheduled_start)}${
        meeting.scheduled_end ? ` – ${fmtTime(meeting.scheduled_end)}` : ''
      }`
    : 'No time set'

  const where = meeting.type === 'online' ? meeting.online_link || 'Online meeting' : meeting.location || 'No location set'

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'When', value: when },
    { label: meeting.type === 'online' ? 'Join' : 'Where', value: where },
    { label: 'Organiser', value: meeting.organizer?.name ?? '—' },
    { label: 'My response', value: amAttendee ? (declined ? "Won't make it" : 'Attending') : 'Not an attendee' },
  ]

  const canJoin = (meeting.type === 'online' && !!meeting.online_link) || (meeting.type !== 'online' && !!meeting.location)
  const showDecline = amAttendee && meeting.status !== 'cancelled' && meeting.status !== 'closed'

  return (
    <PhoneScreen title={meeting.title} parent={route.parent ?? MEETINGS_HREF}>
      <div className="flex flex-col gap-[20px] pb-[16px]">
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-card-heading font-medium text-text-primary">{meeting.title}</h2>
          <span
            className="inline-flex w-fit items-center rounded-full px-[10px] py-[2px] text-label font-medium"
            style={{ backgroundColor: statusMeta.bg, color: statusMeta.text }}
          >
            {statusMeta.label}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-y-[14px] gap-x-[12px]">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-[2px]">
              <dt className="text-meta text-text-secondary">{f.label}</dt>
              <dd className="truncate text-body text-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={() => setAttendeesOpen(true)}
          className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-light bg-surface px-[12px] text-left active:bg-surface-control"
        >
          <span className="text-body text-text-primary">Attendees · {meeting.attendees?.length ?? meeting._count?.attendees ?? 0}</span>
          <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
        </button>

        {meeting.agenda ? (
          <div className="flex flex-col gap-[4px]">
            <h3 className="text-label font-medium text-text-secondary">Agenda</h3>
            <p className="whitespace-pre-wrap text-body text-text-primary">{meeting.agenda}</p>
          </div>
        ) : null}
      </div>

      {canJoin || showDecline ? (
        <div
          className={cx(
            'fixed inset-x-0 bottom-0 z-30 flex gap-[8px] border-t border-border-light bg-surface px-[16px] py-[12px]',
            'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
          )}
        >
          {showDecline ? (
            declined ? (
              <PhoneButton variant="secondary" className="flex-1" disabled={busy} onClick={() => void doUndoDecline()}>
                Undo decline
              </PhoneButton>
            ) : (
              <PhoneButton variant="secondary" className="flex-1" disabled={busy} onClick={() => setDeclineOpen(true)}>
                Decline
              </PhoneButton>
            )
          ) : null}
          {canJoin ? (
            <PhoneButton variant="primary" className="flex-1" onClick={onJoinOrDirections}>
              {meeting.type === 'online' ? (
                <>
                  <Video aria-hidden /> Join
                </>
              ) : (
                <>
                  <MapPin aria-hidden /> Directions
                </>
              )}
            </PhoneButton>
          ) : null}
        </div>
      ) : null}

      <DeclineMeetingSheet open={declineOpen} onOpenChange={setDeclineOpen} onConfirm={(reason) => void doDecline(reason)} submitting={busy} />
      <AttendeesListSheet
        open={attendeesOpen}
        onOpenChange={setAttendeesOpen}
        attendees={meeting.attendees ?? []}
        organizerId={meeting.organizer?.id}
      />
    </PhoneScreen>
  )
}
