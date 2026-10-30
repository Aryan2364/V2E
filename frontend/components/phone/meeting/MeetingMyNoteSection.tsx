'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import type { Meeting } from '@/lib/types/meetings'
import { PhoneSheet } from '../PhoneSheet'
import { GrowTextarea, PhoneButton, PHONE_INPUT, ROW, ROW_BLOCK } from '../primitives'

/*
 * My private note - the computer's NotesCard (meetings/[meetingId]/page.tsx
 * 372-387, PUT :id/my-note). Only the person sees it; it is never part of the
 * record, and it can be written in any meeting status, as on the computer.
 */
export function MeetingMyNoteSection({ orgId, meeting }: { orgId: string; meeting: Meeting }) {
  const { addToast } = useToast()
  const [saved, setSaved] = React.useState(meeting.my_note ?? '')
  const [open, setOpen] = React.useState(false)
  const [body, setBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function save() {
    setSaving(true)
    try {
      await meetingsApi.saveMyNote(orgId, meeting.id, body)
      setSaved(body)
      addToast('Notes saved', 'success')
      setOpen(false)
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not save your note. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className={ROW_BLOCK}>
        <button
          type="button"
          className={ROW}
          onClick={() => {
            setBody(saved)
            setOpen(true)
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-body text-text-primary">My private note</span>
            <span className="block truncate text-meta text-text-secondary">{saved.trim() ? saved.replace(/\s+/g, ' ') : 'Only you can see this'}</span>
          </span>
          <ChevronRight aria-hidden className="size-[18px] shrink-0 text-text-secondary" />
        </button>
      </div>
      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        title="My private note"
        fullHeight
        footer={
          <PhoneButton variant="primary" loading={saving} onClick={() => void save()}>
            Save note
          </PhoneButton>
        }
      >
        <div className="flex flex-col gap-[8px]">
          <p className="text-meta text-text-secondary">Only you can see this. It is never part of the official record.</p>
          <GrowTextarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="My private note" className={`${PHONE_INPUT} min-h-[200px] py-[10px]`} />
        </div>
      </PhoneSheet>
    </>
  )
}
