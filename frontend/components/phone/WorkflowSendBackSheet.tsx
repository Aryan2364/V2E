'use client'

import React from 'react'
import { Check } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { SendBackTarget, WorkflowInstance } from '@/lib/types/workflows'
import type { SendBackSubject } from '@/components/workflows/SendBackDialog'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, PhoneField, PHONE_INPUT, ROW_BLOCK, ROW, cx } from './primitives'

/*
 * Send back, on the phone: the same call, targets and reason rule as the
 * computer's SendBackDialog (components/workflows/SendBackDialog.tsx): pick an
 * earlier finished step (the one just before it first), say what needs fixing
 * (5 to 2000 characters), and that step's task reopens with the reason while
 * this one waits. Used by the workflow banner on a step task and by the run
 * screen. Mounted only while open, so each opening starts clean.
 */
const MIN = 5
const MAX = 2000

/** "B1 “Budget check”" (or just the title when the server sends no number). */
const targetName = (t: SendBackTarget) => (t.number_label ? `${t.number_label} “${t.title}”` : `“${t.title}”`)

export function WorkflowSendBackSheet(props: {
  orgId: string
  /** null = closed. */
  subject: SendBackSubject | null
  onClose: () => void
  onDone: (run: WorkflowInstance | null) => void
}) {
  return props.subject ? <Body {...props} subject={props.subject} /> : null
}

function Body({
  orgId,
  subject,
  onClose,
  onDone,
}: {
  orgId: string
  subject: SendBackSubject
  onClose: () => void
  onDone: (run: WorkflowInstance | null) => void
}) {
  const { addToast } = useToast()
  const [targets, setTargets] = React.useState<SendBackTarget[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [target, setTarget] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadTargets = React.useCallback(() => {
    setTargets(null)
    setLoadError(null)
    workflowsApi
      .getSendBackTargets(orgId, subject.templateId, subject.instanceId, subject.rowId)
      .then((list) => {
        const arr = Array.isArray(list) ? list : []
        setTargets(arr)
        setTarget(arr[0]?.row_id ?? '')
      })
      .catch((e) => setLoadError(workflowErrorMessage(e, 'The earlier steps could not be loaded.')))
  }, [orgId, subject.templateId, subject.instanceId, subject.rowId])

  React.useEffect(() => {
    const t = setTimeout(loadTargets, 0)
    return () => clearTimeout(t)
  }, [loadTargets])

  const trimmed = reason.trim()
  const reasonProblem = trimmed.length > 0 && trimmed.length < MIN ? `Enter at least ${MIN} characters.` : null

  async function submit() {
    if (busy || !target || trimmed.length < MIN || trimmed.length > MAX) return
    setBusy(true)
    setError(null)
    try {
      const run = await workflowsApi.sendBack(orgId, subject.templateId, subject.instanceId, subject.rowId, { to_row_id: target, reason: trimmed })
      const to = targets?.find((t) => t.row_id === target)
      addToast(`Sent back to ${to ? targetName(to) : 'the earlier step'}`, 'success')
      onDone(run && typeof run === 'object' && 'id' in run ? run : null)
      onClose()
    } catch (e) {
      setError(workflowErrorMessage(e, 'It could not be sent back. Try again.'))
      setBusy(false)
    }
  }

  const targetTitle = targets?.find((t) => t.row_id === target)?.title

  return (
    <PhoneSheet
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Send back"
      footer={
        <PhoneButton variant="primary" fullWidth loading={busy} disabled={!target || trimmed.length < MIN} onClick={() => void submit()}>
          {busy ? 'Sending back…' : 'Send back'}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <p className="text-body text-text-secondary">
          The step you choose reopens with your reason. {subject.stepLabel ? `${subject.stepLabel} ` : ''}“{subject.stepTitle}” waits until it is done again.
        </p>

        <div className="flex flex-col gap-[6px]">
          <span className="text-label font-medium text-text-primary">Send back to</span>
          {loadError ? (
            <div className="flex flex-col items-start gap-[8px]">
              <p className="text-body text-danger">{loadError}</p>
              <PhoneButton variant="secondary" onClick={loadTargets}>
                Try again
              </PhoneButton>
            </div>
          ) : targets === null ? (
            <span className="h-[48px] rounded-[8px] bg-surface-control" aria-hidden />
          ) : targets.length === 0 ? (
            <p className="text-body text-text-secondary">No earlier finished step to send back to.</p>
          ) : (
            <ul role="radiogroup" aria-label="Send back to" className={ROW_BLOCK}>
              {targets.map((t, i) => {
                const name = t.number_label ? `${t.number_label} · ${t.title}` : t.title
                const selected = t.row_id === target
                return (
                  <li key={t.row_id}>
                    <button type="button" role="radio" aria-checked={selected} disabled={busy} onClick={() => setTarget(t.row_id)} className={cx(ROW, selected && 'font-medium')}>
                      <span className="min-w-0 flex-1 wrap-break-word">
                        {name}
                        {(t.is_direct ?? i === 0) ? <span className="text-text-secondary"> (previous)</span> : null}
                      </span>
                      {selected ? <Check aria-hidden className="size-[20px] shrink-0 text-primary-text" /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-meta text-text-secondary">Steps in between are not redone.</p>
        </div>

        <PhoneField label="What needs fixing" htmlFor="send-back-reason" required error={reasonProblem ?? error}>
          <textarea
            id="send-back-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={MAX}
            disabled={busy}
            placeholder={targetTitle ? `What should change in “${targetTitle}”?` : 'What should change?'}
            aria-invalid={reasonProblem || error ? true : undefined}
            className={`${PHONE_INPUT} min-h-[112px] py-[10px]`}
          />
          <span className="text-meta text-text-secondary">At least {MIN} characters.</span>
        </PhoneField>
      </div>
    </PhoneSheet>
  )
}
