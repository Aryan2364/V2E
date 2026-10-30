'use client'

import React from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import type { Meeting } from '@/lib/types/meetings'
import { PhoneSheet } from '../PhoneSheet'
import { GrowTextarea, PhoneButton, PhoneField, PHONE_INPUT, ROW, ROW_BLOCK } from '../primitives'

/*
 * Agenda and minutes - the computer's record tab (MeetingRecordTab.tsx):
 * the same two fields, saved with PUT :id/record. Read-only once the meeting
 * is closed or cancelled (MeetingRecordTab line 18), or for someone who is
 * not on the meeting. The row always opens, so a reader can still read them.
 */
export function MeetingMinutesSection({
  orgId,
  meeting,
  locked,
  canEdit,
  onChanged,
}: {
  orgId: string
  meeting: Meeting
  locked: boolean
  canEdit: boolean
  onChanged: (m: Meeting) => void
}) {
  const { addToast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [agenda, setAgenda] = React.useState('')
  const [minutes, setMinutes] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const readOnly = locked || !canEdit

  function openSheet() {
    setAgenda(meeting.agenda ?? '')
    setMinutes(meeting.minutes ?? '')
    setOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      const updated = await meetingsApi.updateRecord(orgId, meeting.id, { agenda, minutes })
      onChanged(updated)
      addToast('Record saved', 'success')
      setOpen(false)
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not save the record. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const summary = (meeting.minutes ?? '').trim()

  return (
    <>
      <div className={ROW_BLOCK}>
        <button type="button" className={ROW} onClick={openSheet}>
          <span className="min-w-0 flex-1">
            <span className="block text-body text-text-primary">{readOnly || summary ? 'Minutes' : 'Add minutes'}</span>
            {summary ? <span className="block truncate text-meta text-text-secondary">{summary.replace(/\s+/g, ' ')}</span> : null}
          </span>
          <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
        </button>
      </div>
      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        title="Agenda and minutes"
        fullHeight
        footer={
          readOnly ? undefined : (
            <PhoneButton variant="primary" loading={saving} onClick={() => void save()}>
              Save record
            </PhoneButton>
          )
        }
      >
        <div className="flex flex-col gap-[16px]">
          {meeting.status === 'closed' ? (
            <p className="flex items-center gap-[8px] rounded-[8px] bg-surface-control px-[12px] py-[8px] text-meta text-text-secondary">
              <Lock aria-hidden className="size-[14px] shrink-0" /> This meeting is closed. The record is the official, locked version.
            </p>
          ) : null}
          {readOnly ? (
            <>
              <ReadBlock label="Agenda" text={meeting.agenda} />
              <ReadBlock label="Minutes" text={meeting.minutes} />
            </>
          ) : (
            <>
              <PhoneField label="Agenda" htmlFor="mt-agenda">
                <GrowTextarea id="mt-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} placeholder="What will you discuss? One point per line." className={`${PHONE_INPUT} min-h-[88px] py-[10px]`} />
              </PhoneField>
              <PhoneField label="Minutes" htmlFor="mt-minutes">
                <GrowTextarea id="mt-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} rows={6} placeholder="Capture what was discussed and the decisions made." className={`${PHONE_INPUT} min-h-[140px] py-[10px]`} />
              </PhoneField>
            </>
          )}
        </div>
      </PhoneSheet>
    </>
  )
}

function ReadBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="flex flex-col gap-[4px]">
      <h3 className="text-label font-medium text-text-secondary">{label}</h3>
      <p className="whitespace-pre-wrap text-body text-text-primary">{text?.trim() ? text : 'Nothing written yet.'}</p>
    </div>
  )
}
