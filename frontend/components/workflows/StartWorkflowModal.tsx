'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { instanceNameKey, normalizeInstanceName, workflowsApi, workflowErrorMessage, workflowErrorStatus, workflowErrorTarget } from '@/lib/api/workflows'
import type { WorkflowTemplate } from '@/lib/types/workflows'
import { instanceTitle } from './instanceLabel'
import { BTN, ErrorBanner, InfoTip, runHref } from './shared'

const NAME_MAX = 80
const NAME_TAKEN = 'An instance with this name already exists in this workflow.'

/**
 * The server refused the name (400 with `code: 'instance_name_…'` / `field: 'name'`) —
 * shown under the field, not as a banner.
 */
function isNameError(err: unknown, message: string): boolean {
  if (workflowErrorStatus(err) !== 400) return false
  const { code } = workflowErrorTarget(err)
  if (code) return code.startsWith('instance_name')
  return /name/i.test(message)
}

/**
 * Run a workflow by hand: creates a new instance, which needs a name (unique within the
 * workflow). The steps that start with the workflow get their tasks now; every other step
 * gets its task when the steps it starts after are done.
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
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  // Names already used in this workflow, for an early "already exists" (the server decides).
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const workflowId = workflow?.id
  useEffect(() => {
    if (!workflowId) return
    setName('')
    setTouched(false)
    setError(null)
    setNameError(null)
    setBusy(false)
    setTaken(new Set())
    requestAnimationFrame(() => inputRef.current?.focus())
    let alive = true
    workflowsApi
      .listInstances(orgId, workflowId)
      .then((list) => {
        if (alive) setTaken(new Set((Array.isArray(list) ? list : []).map((i) => instanceNameKey(i.name ?? ''))))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workflowId, orgId])

  const firstSteps = (workflow?.steps ?? []).filter((s) => !(s.depends_on_step_ids ?? []).length)
  const startsNow = (s: { start_rule?: { kind: string } | null }) => !s.start_rule || s.start_rule.kind === 'immediate'
  // Steps with their own start time wait for it (it never comes before their turn).
  const nowSteps = firstSteps.filter(startsNow)
  const anyTimed = (workflow?.steps ?? []).some((s) => !startsNow(s))

  const clean = normalizeInstanceName(name)
  const localError = !clean
    ? 'Enter a name for this instance.'
    : clean.length > NAME_MAX
      ? `Use ${NAME_MAX} characters or fewer.`
      : taken.has(instanceNameKey(clean))
        ? NAME_TAKEN
        : null
  const shownNameError = nameError ?? (touched ? localError : null)

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (!workflow || busy) return
    setTouched(true)
    if (localError) {
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    setNameError(null)
    try {
      const res = await workflowsApi.triggerInstance(orgId, workflow.id, clean)
      addToast(res.instance_number ? `Workflow started — ${instanceTitle(res.instance_number).toLowerCase()}` : 'Workflow started', 'success')
      onClose()
      router.push(runHref(workflow.id, res.id))
    } catch (err) {
      const msg = workflowErrorMessage(err, 'The workflow could not be run. Try again.')
      if (isNameError(err, msg)) {
        const taken = workflowErrorTarget(err).code === 'instance_name_taken' || /already exists/i.test(msg)
        setNameError(taken ? NAME_TAKEN : msg)
        if (taken) setTaken((t) => new Set(t).add(instanceNameKey(clean)))
        inputRef.current?.focus()
      } else {
        setError(msg)
      }
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={!!workflow} onClose={() => !busy && onClose()} title="Run workflow" size="md" closeOnEscape={!busy}>
      <form onSubmit={run} noValidate className="flex flex-col gap-5">
        <p className="text-[15px] text-[#1E293B] leading-relaxed">
          Creates a new instance of <span className="font-semibold text-[#0F172A]">{workflow?.name}</span>.{' '}
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
            label="Run workflow"
            text={anyTimed ? 'Other steps start when previous steps are done and their time comes.' : 'Other steps start when previous steps are done.'}
          />
        </p>

        <div>
          <label htmlFor="instance-name" className="block text-sm font-medium text-[#374151] mb-2">
            Instance name <span className="text-[#DC2626]">*</span>{' '}
            <InfoTip label="Instance name" text="Shown on every task of this instance. Each instance of a workflow needs its own name." />
          </label>
          <input
            id="instance-name"
            ref={inputRef}
            value={name}
            maxLength={NAME_MAX + 20}
            autoComplete="off"
            aria-required
            aria-invalid={!!shownNameError}
            aria-describedby={shownNameError ? 'instance-name-error' : 'instance-name-help'}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            onBlur={() => clean && setTouched(true)}
            placeholder="e.g. ACME Ltd onboarding"
            className={`w-full px-3 py-2.5 text-base sm:text-sm border rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 ${
              shownNameError ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]' : 'border-[#CBD5E1] focus:border-[#2563EB] focus:ring-[#2563EB]'
            }`}
          />
          {shownNameError ? (
            <p id="instance-name-error" role="alert" className="mt-1.5 text-[13px] text-[#B91C1C]">
              {shownNameError}
            </p>
          ) : (
            <p id="instance-name-help" className="mt-1.5 text-[13px] text-[#475569]">
              {clean.length}/{NAME_MAX}
            </p>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={BTN.quiet}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={BTN.primary}>
            <Play size={16} />
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
