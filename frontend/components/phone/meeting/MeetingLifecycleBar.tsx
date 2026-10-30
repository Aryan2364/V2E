'use client'

import React from 'react'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import type { Meeting } from '@/lib/types/meetings'
import { PhoneButton } from '../primitives'
import { ConfirmSheet } from './meetingShared'

type Step = 'start' | 'end' | 'close' | 'reopen'

const COPY: Record<Step, { label: string; toast: string; title?: string; body?: string }> = {
  start: { label: 'Start meeting', toast: 'Meeting started' },
  end: { label: 'End meeting', toast: 'Marked ended', title: 'End meeting', body: 'This marks the meeting as ended. You can still add minutes and close it afterwards.' },
  close: { label: 'Close meeting', toast: 'Meeting closed', title: 'Close meeting', body: 'Closing locks the record: minutes, action items and decisions can no longer be changed unless you reopen it.' },
  reopen: { label: 'Reopen meeting', toast: 'Meeting reopened', title: 'Reopen meeting', body: 'This unlocks the record so it can be changed again.' },
}

/*
 * Start / End / Close / Reopen - the computer's header buttons
 * (meetings/[meetingId]/page.tsx 150-153), same gates, only for people who
 * can manage the meeting (meeting.can_manage). Start is plain; End, Close
 * and Reopen ask first because they change what everyone else can edit.
 */
export function MeetingLifecycleBar({ orgId, meeting, onChanged }: { orgId: string; meeting: Meeting; onChanged: (m: Meeting) => void }) {
  const { addToast } = useToast()
  const [confirm, setConfirm] = React.useState<Step | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (!meeting.can_manage) return null
  const s = meeting.status
  const steps: Step[] = []
  if (s === 'scheduled') steps.push('start')
  if (s === 'in_progress') steps.push('end')
  if (s === 'in_progress' || s === 'scheduled') steps.push('close')
  if (s === 'closed') steps.push('reopen')
  if (steps.length === 0) return null

  async function run(step: Step) {
    setBusy(true)
    try {
      const updated = await meetingsApi[step](orgId, meeting.id)
      onChanged(updated)
      addToast(COPY[step].toast, 'success')
      setConfirm(null)
    } catch (e) {
      addToast(apiErrorMessage(e, 'Action failed. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  function press(step: Step) {
    if (step === 'start') void run(step)
    else setConfirm(step)
  }

  const primary = steps[0]
  return (
    <>
      <div className="flex gap-[8px]">
        {steps.map((step) => (
          <PhoneButton
            key={step}
            variant={step === primary ? 'primary' : 'secondary'}
            className="flex-1"
            loading={busy && step === 'start'}
            disabled={busy}
            onClick={() => press(step)}
          >
            {COPY[step].label}
          </PhoneButton>
        ))}
      </div>
      <ConfirmSheet
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? COPY[confirm].title ?? '' : ''}
        body={confirm ? COPY[confirm].body ?? '' : ''}
        confirmLabel={confirm ? COPY[confirm].label : ''}
        busy={busy}
        onConfirm={() => confirm && void run(confirm)}
      />
    </>
  )
}
