'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import StyledSelect from '@/components/ui/StyledSelect'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { SendBackTarget, WorkflowInstance } from '@/lib/types/workflows'
import { BTN, ErrorBanner, InfoTip, Skeleton } from './shared'

const MIN = 5
const MAX = 2000

export interface SendBackSubject {
  templateId: string
  instanceId: string
  rowId: string
  stepTitle: string
  /** "1", "B2" — the step's number in its run, when known. */
  stepLabel?: string | null
}

/** "B1 “Budget check”" (or just the title when the server sends no number). */
const targetName = (t: SendBackTarget) => (t.number_label ? `${t.number_label} “${t.title}”` : `“${t.title}”`)

/**
 * Send a run back to an earlier step: that step's task reopens with the reason posted as
 * a comment, this step waits, and once the earlier step is done again the run comes
 * straight back here. Used on the run page and on the task page.
 */
export default function SendBackDialog({
  orgId,
  subject,
  onClose,
  onDone,
}: {
  orgId: string
  /** null = closed. */
  subject: SendBackSubject | null
  onClose: () => void
  onDone: (run: WorkflowInstance | null) => void
}) {
  const { addToast } = useToast()
  const [targets, setTargets] = useState<SendBackTarget[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  const load = async (s: SendBackSubject) => {
    setTargets(null)
    setLoadError(null)
    try {
      const list = await workflowsApi.getSendBackTargets(orgId, s.templateId, s.instanceId, s.rowId)
      const arr = Array.isArray(list) ? list : []
      setTargets(arr)
      setTarget(arr[0]?.row_id ?? '')
    } catch (e) {
      setLoadError(workflowErrorMessage(e, 'The earlier steps could not be loaded.'))
    }
  }

  useEffect(() => {
    if (!subject) return
    setReason('')
    setReasonError(null)
    setError(null)
    setBusy(false)
    load(subject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.rowId, subject?.instanceId])

  const trimmed = reason.trim()
  const reasonProblem = (v: string) =>
    v.trim().length < MIN ? `Enter at least ${MIN} characters.` : v.trim().length > MAX ? `Keep it under ${MAX} characters.` : null

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!subject || busy) return
    if (!target) {
      setError('Choose a step.')
      return
    }
    const problem = reasonProblem(reason)
    if (problem) {
      setReasonError(problem)
      reasonRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const run = await workflowsApi.sendBack(orgId, subject.templateId, subject.instanceId, subject.rowId, { to_row_id: target, reason: trimmed })
      const to = targets?.find((t) => t.row_id === target)
      addToast(`Sent back to ${to ? targetName(to) : 'the earlier step'}`, 'success')
      onDone(run && typeof run === 'object' && 'id' in run ? run : null)
      onClose()
    } catch (err) {
      setError(workflowErrorMessage(err, 'It could not be sent back. Try again.'))
      setBusy(false)
    }
  }

  const targetTitle = targets?.find((t) => t.row_id === target)?.title

  return (
    <Modal isOpen={!!subject} onClose={() => !busy && onClose()} title="Send back" size="md" closeOnEscape={!busy}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-[15px] text-[#1E293B] leading-relaxed">
          The chosen step reopens with your reason.{' '}
          <span className="font-semibold text-[#0F172A]">
            {subject?.stepLabel ? `${subject.stepLabel} ` : ''}“{subject?.stepTitle}”
          </span>{' '}
          waits until it is done again.
        </p>

        <div>
          <span className="block text-sm font-medium text-[#374151] mb-2">
            Send back to <span className="text-[#DC2626]">*</span> <InfoTip label="Send back to" text="Steps in between are not redone." />
          </span>
          {loadError ? (
            <div className="flex flex-col gap-2">
              <ErrorBanner message={loadError} />
              <button type="button" onClick={() => subject && load(subject)} className={`${BTN.quiet} self-start`}>
                Try again
              </button>
            </div>
          ) : targets === null ? (
            <Skeleton className="h-11" />
          ) : targets.length === 0 ? (
            <p className="text-sm text-[#334155] rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              No earlier finished step to send back to.
            </p>
          ) : (
            <StyledSelect
              value={target}
              onChange={setTarget}
              options={targets.map((t, i) => {
                const name = t.number_label ? `${t.number_label} · ${t.title}` : t.title
                return { value: t.row_id, label: (t.is_direct ?? i === 0) ? `${name} (previous)` : name }
              })}
              searchable={targets.length > 6}
              disabled={busy}
            />
          )}
        </div>

        <div>
          <label htmlFor="send-back-reason" className="block text-sm font-medium text-[#374151] mb-2">
            What needs fixing <span className="text-[#DC2626]">*</span>
          </label>
          <textarea
            id="send-back-reason"
            ref={reasonRef}
            value={reason}
            rows={4}
            maxLength={MAX}
            disabled={busy}
            aria-invalid={!!reasonError}
            onChange={(e) => {
              setReason(e.target.value)
              if (reasonError && !reasonProblem(e.target.value)) setReasonError(null)
            }}
            onBlur={() => reason && setReasonError(reasonProblem(reason))}
            placeholder={targetTitle ? `What should change in “${targetTitle}”?` : 'What should change?'}
            className={`w-full px-3 py-2.5 text-base sm:text-sm border rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 resize-y ${
              reasonError ? 'border-[#DC2626] focus:ring-[#DC2626]' : 'border-[#CBD5E1] focus:border-[#2563EB] focus:ring-[#2563EB]'
            }`}
          />
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className={`text-[13px] ${reasonError ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>{reasonError ?? `At least ${MIN} characters.`}</p>
            <span className={`text-[12px] tabular-nums shrink-0 ${trimmed.length < MIN ? 'text-[#475569]' : 'text-[#15803D]'}`}>
              {reason.length} / {MAX}
            </span>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={BTN.quiet}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !targets?.length || !target} className={BTN.primary}>
            <Undo2 size={16} />
            {busy ? 'Sending back…' : 'Send back'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
