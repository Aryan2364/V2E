'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { WorkflowTemplate } from '@/lib/types/workflows'
import { getNow } from '@/lib/clock'
import { BTN, ErrorBanner, InfoTip, fmtDate, runHref } from './shared'

/**
 * Start a run of a workflow by hand. The steps that start with the workflow get their
 * tasks now; every other step gets its task when the steps it starts after are done.
 */
export default function StartWorkflowModal({
  orgId,
  workflow,
  onClose,
}: {
  orgId: string
  workflow: Pick<WorkflowTemplate, 'id' | 'name' | 'steps'> | null
  onClose: () => void
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (workflow) {
      setName('')
      setError(null)
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [workflow])

  const firstSteps = (workflow?.steps ?? []).filter((s) => !(s.depends_on_step_ids ?? []).length)
  const startsNow = (s: { start_rule?: { kind: string } | null }) => !s.start_rule || s.start_rule.kind === 'immediate'
  // Steps with their own start time wait for it (it never comes before their turn).
  const nowSteps = firstSteps.filter(startsNow)
  const anyTimed = (workflow?.steps ?? []).some((s) => !startsNow(s))

  async function start(e?: React.FormEvent) {
    e?.preventDefault()
    if (!workflow || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await workflowsApi.triggerInstance(orgId, workflow.id, name)
      addToast('Workflow started', 'success')
      onClose()
      router.push(runHref(workflow.id, id))
    } catch (err) {
      setError(workflowErrorMessage(err, 'The workflow could not be started. Try again.'))
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={!!workflow} onClose={() => !busy && onClose()} title="Start workflow" size="md">
      <form onSubmit={start} className="flex flex-col gap-5">
        <p className="text-[15px] text-[#1E293B] leading-relaxed">
          Starts a new run of <span className="font-semibold text-[#0F172A]">{workflow?.name}</span>.{' '}
          {nowSteps.length === 1 ? (
            <>
              <span className="font-semibold text-[#0F172A]">
                {nowSteps[0].number_label ? `Step ${nowSteps[0].number_label} ` : ''}“{nowSteps[0].title}”
              </span>{' '}
              starts now.
            </>
          ) : nowSteps.length > 1 ? (
            <>{nowSteps.length} steps start now.</>
          ) : firstSteps.length > 0 ? (
            <>{firstSteps.length === 1 ? 'The first step starts at its set time.' : 'The first steps start at their set times.'}</>
          ) : (
            <>The first steps start now.</>
          )}{' '}
          <InfoTip
            label="Start workflow"
            text={anyTimed ? 'Other steps start when previous steps are done and their time comes.' : 'Other steps start when previous steps are done.'}
          />
        </p>

        <div>
          <label htmlFor="run-name" className="block text-sm font-medium text-[#374151] mb-2">
            Run name <InfoTip label="Run name" text="Optional. Leave empty to use the name and date shown." />
          </label>
          <input
            id="run-name"
            ref={inputRef}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${workflow?.name ?? 'Workflow'} — ${fmtDate(getNow())}`}
            className="w-full px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          />

        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={BTN.quiet}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={BTN.primary}>
            <Play size={16} />
            {busy ? 'Starting…' : 'Start workflow'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
