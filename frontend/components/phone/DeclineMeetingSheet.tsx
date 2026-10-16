'use client'

import React from 'react'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton } from './primitives'

/*
 * Decline reason sheet - plan-phone-2026-10-14.md §5.8, kit §41.6 rule 11.
 * The backend requires a reason (DeclineDto.reason), so Decline stays
 * disabled until something is typed.
 */
export function DeclineMeetingSheet({
  open,
  onOpenChange,
  onConfirm,
  submitting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
  submitting: boolean
}) {
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Decline meeting"
      footer={
        <PhoneButton
          type="button"
          variant="primary"
          fullWidth
          disabled={reason.trim().length === 0 || submitting}
          onClick={() => onConfirm(reason.trim())}
        >
          {submitting ? 'Declining…' : 'Decline meeting'}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[8px]">
        <label htmlFor="decline-reason" className="text-phone-label font-medium text-text-secondary">
          Reason <span aria-hidden>*</span>
        </label>
        <textarea
          id="decline-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Let the organiser know why you can't make it"
          className="min-h-[88px] w-full rounded-[8px] border border-border bg-surface px-[12px] py-[10px] text-phone-body text-text-primary outline-hidden focus-visible:border-primary"
        />
      </div>
    </PhoneSheet>
  )
}
