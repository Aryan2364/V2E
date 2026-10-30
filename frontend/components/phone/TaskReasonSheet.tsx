'use client'

import React from 'react'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, PhoneField, PHONE_INPUT, cx } from './primitives'

/*
 * One reason sheet for the task actions that need a written reason: Reopen
 * after the undo window, Can't complete, and Delete (the backend requires a
 * non-blank reason for each). The confirm button stays disabled until
 * something is typed; the server's own refusal shows inline under the field
 * and the sheet stays open so nothing typed is lost.
 */
export function TaskReasonSheet(props: ReasonSheetProps) {
  // Mounted only while open, so every opening starts with an empty reason and no old error.
  return props.open ? <ReasonSheetBody {...props} /> : null
}

type ReasonSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** One plain sentence on what the button does. */
  intro: string
  label?: string
  placeholder?: string
  confirmLabel: string
  busyLabel: string
  /** Delete: the confirm button is red. */
  destructive?: boolean
  /** Throws when the server refuses; the message is shown in the sheet. */
  onConfirm: (reason: string) => Promise<void>
}

function ReasonSheetBody({
  open,
  onOpenChange,
  title,
  intro,
  label = 'Reason',
  placeholder,
  confirmLabel,
  busyLabel,
  destructive = false,
  onConfirm,
}: ReasonSheetProps) {
  const [reason, setReason] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit() {
    const text = reason.trim()
    if (!text || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(text)
      onOpenChange(false)
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not do that. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <PhoneButton
          type="button"
          variant="primary"
          fullWidth
          loading={submitting}
          disabled={reason.trim().length === 0}
          className={cx(destructive && 'border-danger bg-danger active:border-danger active:bg-danger disabled:border-surface-control-pressed disabled:bg-surface-control-pressed')}
          onClick={() => void submit()}
        >
          {submitting ? busyLabel : confirmLabel}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[12px]">
        <p className="text-body text-text-secondary">{intro}</p>
        <PhoneField label={label} htmlFor="task-reason" required error={error}>
          <textarea
            id="task-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            className={`${PHONE_INPUT} min-h-[88px] py-[10px]`}
          />
        </PhoneField>
      </div>
    </PhoneSheet>
  )
}
