'use client'

import { fmtDateTime, fmtTime } from '@/lib/phone-format'
import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronRight, Video, MapPin, MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting } from '@/lib/types/meetings'
import { MEETING_STATUS_META } from '@/lib/types/meetings'
import { MEETINGS_HREF, meetingRhythmHref, type PhoneRoute } from '@/lib/phone-routes'
import PhoneScreen from '../PhoneScreen'
import { PhoneFailedState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, cx } from '../primitives'
import { DeclineMeetingSheet } from '../DeclineMeetingSheet'
import { AttendeesListSheet } from '../AttendeesListSheet'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { MeetingActionsSheet } from '../MeetingActionsSheet'
import { MeetingPasswordRow } from '../MeetingPasswordRow'
import { MeetingLifecycleBar } from '../meeting/MeetingLifecycleBar'
import { MeetingMinutesSection } from '../meeting/MeetingMinutesSection'
import { MeetingAttendanceSheet } from '../meeting/MeetingAttendanceSheet'
import { MeetingActionItemsSection } from '../meeting/MeetingActionItemsSection'
import { MeetingDecisionsSection } from '../meeting/MeetingDecisionsSection'
import { MeetingMyNoteSection } from '../meeting/MeetingMyNoteSection'
import { meetingEditGates } from '../meeting/meetingShared'

/*
 * Meeting detail - plan-phone-2026-10-14.md §5.8, kit §41.6. Title + status,
 * 4 key facts, Join/decline in the action bar, attendees and agenda below.
 * Running a meeting is on the phone too (the owner's rule: no meeting flow
 * is half on the phone and half on the computer): Start/End/Close/Reopen,
 * attendance, minutes, action items, decisions and my private note, drawn
 * from components/phone/meeting/ with the computer's gates. This replaces
 * the earlier D11 "left out on purpose".
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
  const [menuOpen, setMenuOpen] = React.useState(false)
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
        <PhoneFailedState what="This meeting" onRetry={() => { setError(false); load() }} />
        <PhoneLinkButton href={route.parent ?? MEETINGS_HREF} fullWidth>
          Go to meetings
        </PhoneLinkButton>
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
      addToast('Could not decline the meeting. Try again.', 'error')
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
      addToast('Could not undo the decline. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function onJoinOrDirections() {
    // Desktop shows the join link for anything that is not in person (MP ~144), hybrid included.
    if (meeting!.type !== 'offline' && meeting!.online_link) {
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

  const hasOnline = meeting.type !== 'offline'
  const hasPlace = meeting.type !== 'online'

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'When', value: when },
    ...(hasOnline ? [{ label: 'Join', value: meeting.online_link || 'Online meeting' }] : []),
    ...(hasPlace ? [{ label: 'Where', value: meeting.location || 'No location set' }] : []),
    { label: 'Organiser', value: meeting.organizer?.name ?? '—' },
    { label: 'My response', value: amAttendee ? (declined ? "Won't make it" : 'Attending') : 'Not an attendee' },
  ]

  const hasLink = hasOnline && !!meeting.online_link
  const canJoin = hasLink || (hasPlace && !!meeting.location)
  const showDecline = amAttendee && meeting.status !== 'cancelled' && meeting.status !== 'closed'
  const gates = meetingEditGates(meeting, user?.id)

  return (
    <PhoneScreen
      title="Meeting"
      parent={route.parent ?? MEETINGS_HREF}
      actions={
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setMenuOpen(true)}>
          <MoreHorizontal aria-hidden />
        </button>
      }
    >
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

        {hasOnline && meeting.online_password ? <MeetingPasswordRow password={meeting.online_password} /> : null}

        {meeting.rhythm_id ? (
          <Link
            href={meetingRhythmHref(meeting.rhythm_id)}
            className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-strong bg-surface px-[12px] active:bg-surface-control"
          >
            <span className="text-body text-text-primary">Part of a recurring meeting</span>
            <ChevronRight aria-hidden className="size-[18px] text-text-secondary" />
          </Link>
        ) : null}

        <MeetingLifecycleBar orgId={orgId} meeting={meeting} onChanged={setMeeting} />

        <button
          type="button"
          onClick={() => setAttendeesOpen(true)}
          className="flex min-h-[48px] items-center justify-between rounded-[8px] border border-border-strong bg-surface px-[12px] text-left active:bg-surface-control"
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

        <MeetingAttendanceSheet orgId={orgId} meeting={meeting} onChanged={setMeeting} />
        <MeetingMinutesSection orgId={orgId} meeting={meeting} locked={gates.locked} canEdit={gates.canEdit} onChanged={setMeeting} />
        <MeetingActionItemsSection orgId={orgId} meeting={meeting} locked={gates.locked} canEdit={gates.canEdit} onChanged={setMeeting} />
        <MeetingDecisionsSection orgId={orgId} meeting={meeting} locked={gates.locked} canEdit={gates.canEdit} onChanged={setMeeting} />
        <MeetingMyNoteSection orgId={orgId} meeting={meeting} />
      </div>

      {canJoin || showDecline ? (
        <div
          className={cx(
            'fixed inset-x-0 bottom-0 z-(--z-shell) flex gap-[8px] border-t border-border-light bg-surface px-[16px] py-[12px]',
            'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
          )}
        >
          {showDecline ? (
            declined ? (
              <PhoneButton variant="secondary" className="flex-1" loading={busy} onClick={() => void doUndoDecline()}>
                Undo decline
              </PhoneButton>
            ) : (
              <PhoneButton variant="secondary" className="flex-1" onClick={() => setDeclineOpen(true)}>
                Decline meeting
              </PhoneButton>
            )
          ) : null}
          {canJoin ? (
            <PhoneButton variant="primary" className="flex-1" onClick={onJoinOrDirections}>
              {hasLink ? (
                <>
                  <Video aria-hidden /> Join meeting
                </>
              ) : (
                <>
                  <MapPin aria-hidden /> Get directions
                </>
              )}
            </PhoneButton>
          ) : null}
        </div>
      ) : null}

      <DeclineMeetingSheet open={declineOpen} onOpenChange={setDeclineOpen} onConfirm={(reason) => void doDecline(reason)} submitting={busy} />
      {menuOpen ? <MeetingActionsSheet orgId={orgId} meeting={meeting} open={menuOpen} onOpenChange={setMenuOpen} /> : null}
      <AttendeesListSheet
        open={attendeesOpen}
        onOpenChange={setAttendeesOpen}
        attendees={meeting.attendees ?? []}
        organizerId={meeting.organizer?.id}
      />
    </PhoneScreen>
  )
}
