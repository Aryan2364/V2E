'use client'

import { useMemo, useState } from 'react'
import { X, RotateCcw, CalendarSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import type { Meeting } from '@/lib/types/meetings'
import { ResponseBadge, fmtDateTime, fmtTime } from './shared'
import BusyTimesPanel from './BusyTimesPanel'

const inputClass = 'border border-border rounded-[8px] px-3 py-2 text-body text-text-primary focus:outline-hidden focus:border-primary'

export default function MeetingScheduleTab({
  orgId, meeting, userId, canManage, onChanged,
}: { orgId: string; meeting: Meeting; userId: string; canManage: boolean; onChanged: (m: Meeting) => void }) {
  const attendees = meeting.attendees ?? []
  const me = attendees.find((a) => a.user_id === userId)
  const [showBusy, setShowBusy] = useState(false)
  const open = meeting.status === 'scheduled' || meeting.status === 'in_progress'

  const nonDeclinedIds = useMemo(() => attendees.filter((a) => a.response !== 'declined').map((a) => a.user_id), [attendees])
  const requiredIds = useMemo(() => attendees.filter((a) => a.is_required && a.response !== 'declined').map((a) => a.user_id), [attendees])

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface border border-border-light rounded-[12px] p-6">
        <h3 className="text-card-heading font-medium text-text-primary mb-1">Scheduled time</h3>
        <p className="text-body text-text-primary">{fmtDateTime(meeting.scheduled_start)} – {fmtTime(meeting.scheduled_end)}</p>
        <p className="text-meta text-text-muted mt-1">The organiser sets the time. If it changes, everyone on the meeting is notified.</p>

        {/* My own response — the only action is to decline (opt-out). */}
        {open && me && !me.is_organizer && (
          <MyResponse meeting={meeting} orgId={orgId} onChanged={onChanged} declined={me.response === 'declined'} reason={me.reject_reason} />
        )}

        {/* Organiser can peek at busy times when considering a reschedule (via edit). */}
        {canManage && open && (
          <div className="mt-4 pt-4 border-t border-border-light">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowBusy((v) => !v)}>
              <CalendarSearch size={15} /> {showBusy ? 'Hide' : 'Check'} busy times around this meeting
            </Button>
            {showBusy && meeting.scheduled_start && (
              <div className="mt-2">
                <BusyTimesPanel
                  orgId={orgId}
                  userIds={nonDeclinedIds}
                  requiredIds={requiredIds}
                  from={new Date(new Date(meeting.scheduled_start).setHours(0, 0, 0, 0)).toISOString()}
                  to={new Date(new Date(meeting.scheduled_start).setHours(23, 59, 0, 0)).toISOString()}
                />
                <p className="text-meta text-text-muted mt-1">To move it, use Edit on the meeting header — you pick the new time.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border-light rounded-[12px] p-6">
        <h3 className="text-card-heading font-medium text-text-primary mb-3">Who’s coming</h3>
        <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
          {attendees.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 border border-border-light rounded-[8px] px-3 py-2">
              <div className="min-w-0">
                <span className="text-body text-text-primary">
                  {a.user?.name ?? 'Unknown'}
                  {a.is_organizer && <span className="text-meta text-text-muted ml-1">(organizer)</span>}
                  {!a.is_organizer && (
                    a.is_required
                      ? <span className="text-meta font-medium text-primary-text bg-primary-subtle rounded-full px-2 py-0.5 ml-2">Required</span>
                      : <span className="text-meta font-medium text-text-muted bg-surface-control rounded-full px-2 py-0.5 ml-2">Optional</span>
                  )}
                </span>
                {a.response === 'declined' && a.reject_reason && (
                  <p className="text-meta text-danger mt-0.5">
                    “{a.reject_reason}”{a.is_required ? <span className="text-warning"> · was required</span> : null}
                  </p>
                )}
              </div>
              <ResponseBadge response={a.response} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MyResponse({ meeting, orgId, onChanged, declined, reason }: { meeting: Meeting; orgId: string; onChanged: (m: Meeting) => void; declined: boolean; reason: string | null }) {
  const { addToast } = useToast()
  const [mode, setMode] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (fn: () => Promise<Meeting>, ok: string) => {
    setBusy(true)
    try { onChanged(await fn()); addToast(ok, 'success'); setMode(false); setText('') }
    catch (e: any) { addToast(e?.response?.data?.message ?? 'Failed', 'error') }
    finally { setBusy(false) }
  }

  if (declined) {
    return (
      <div className="mt-4 pt-4 border-t border-border-light">
        <div className="flex items-center justify-between gap-3 bg-danger-bg border border-danger-border rounded-[8px] px-3 py-2">
          <p className="text-body text-danger">You said you can’t make it{reason ? `: “${reason}”` : ''}.</p>
          <Button variant="secondary" size="sm" onClick={() => submit(() => meetingsApi.undoDecline(orgId, meeting.id), 'You’re back on the meeting')} disabled={busy}>
            <RotateCcw size={14} /> I can make it after all
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-light">
      <p className="text-body font-medium text-text-secondary mb-2">You’re on this meeting.</p>
      {!mode ? (
        <Button variant="secondary" onClick={() => setMode(true)}>
          <X size={15} /> Can’t make it
        </Button>
      ) : (
        <div className="flex gap-2">
          <input className={`${inputClass} flex-1`} placeholder="Reason (required)" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <Button variant="danger" disabled={!text.trim() || busy} onClick={() => submit(() => meetingsApi.decline(orgId, meeting.id, text.trim()), 'You declined')}>Submit</Button>
          <Button variant="secondary" onClick={() => setMode(false)}>Cancel</Button>
        </div>
      )}
    </div>
  )
}
