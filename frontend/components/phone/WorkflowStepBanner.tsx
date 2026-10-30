'use client'

import React from 'react'
import { ArrowRight, Undo2, Workflow as WorkflowIcon } from 'lucide-react'
import { workflowsApi } from '@/lib/api/workflows'
import type { WorkflowStepContext } from '@/lib/types/workflows'
import type { SendBackSubject } from '@/components/workflows/SendBackDialog'
import SendBackNote from '@/components/workflows/SendBackNote'
import StepNotes from '@/components/workflows/StepNotes'
import { instanceTitle } from '@/components/workflows/instanceLabel'
import { workflowRunHref } from '@/lib/phone-routes'
import { PhoneButton, PhoneLinkButton } from './primitives'
import { WorkflowSendBackSheet } from './WorkflowSendBackSheet'

/*
 * On a task a workflow created: why it was sent back (if it was), which
 * workflow, instance and step it belongs to, notes left for this step, a link
 * to the instance and "Send back" for the step's assignees. The phone twin of
 * the computer's WorkflowTaskBanner (components/workflows/WorkflowTaskBanner.tsx
 * ~112, rendered at app/dashboard/tasks/[taskId]/page.tsx ~1009): same
 * GET workflows/step-context/:taskId, same wording, and Send back shows only
 * when the server says ctx.can_send_back (the computer hides it otherwise too).
 * The loaded context goes up through onContext, because the task screen's
 * Comments are the instance discussion only when ctx.can_view_discussion.
 */
export function WorkflowStepBanner({
  orgId,
  taskId,
  workflowInstanceStepId,
  fallback,
  onChanged,
  onContext,
}: {
  orgId: string
  taskId: string
  workflowInstanceStepId?: string | null
  /** What the task itself says about its workflow, shown if the details can't be loaded. */
  fallback?: { step_order?: number; template_name?: string; instance_name?: string } | null
  onChanged?: () => void
  /** The loaded step context (null when it isn't a workflow step task or failed). */
  onContext?: (ctx: WorkflowStepContext | null) => void
}) {
  const [ctx, setCtx] = React.useState<WorkflowStepContext | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [subject, setSubject] = React.useState<SendBackSubject | null>(null)
  const onContextRef = React.useRef(onContext)
  React.useEffect(() => {
    onContextRef.current = onContext
  })

  const load = React.useCallback(async () => {
    if (!orgId || !taskId || !workflowInstanceStepId) return
    try {
      const c = await workflowsApi.getStepContext(orgId, taskId)
      const next = c && typeof c === 'object' && 'instance_id' in c ? c : null
      setCtx(next)
      setFailed(!c)
      onContextRef.current?.(next)
    } catch {
      setFailed(true)
      onContextRef.current?.(null)
    }
  }, [orgId, taskId, workflowInstanceStepId])

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  if (!workflowInstanceStepId) return null
  if (!ctx && !(failed && fallback?.template_name)) return null

  const stepLabel = ctx
    ? ctx.step_label || ctx.step_number
      ? `Step ${ctx.step_label || ctx.step_number}${ctx.total_steps ? ` of ${ctx.total_steps}` : ''} · ${ctx.step_title}`
      : ctx.step_title
    : fallback?.step_order
      ? `Step ${fallback.step_order}`
      : 'Workflow step'
  const workflowName = ctx?.template_name ?? fallback?.template_name ?? 'Workflow'
  const instanceName = ctx?.instance_name ?? fallback?.instance_name

  return (
    <section aria-label="Workflow step" className="flex flex-col gap-[12px] rounded-[10px] border border-primary-border bg-primary-subtle p-[16px]">
      {/* Sent back: why this step was reopened (or why it is waiting), first. */}
      {ctx?.send_back ? <SendBackNote sendBack={ctx.send_back} variant={ctx.send_back.role === 'target' ? 'banner' : 'panel'} /> : null}
      <div className="flex items-start gap-[10px] text-body text-primary-text">
        <WorkflowIcon aria-hidden className="mt-[2px] size-[18px] shrink-0" />
        <div className="min-w-0">
          <p className="font-medium wrap-break-word">{stepLabel}</p>
          <p className="wrap-break-word">
            {instanceName ? <span className="font-medium">{instanceName}</span> : null}
            {ctx?.instance_number ? (
              <span>
                {instanceName ? ' · ' : ''}
                {instanceTitle(ctx.instance_number)}
              </span>
            ) : null}
            <span>
              {instanceName || ctx?.instance_number ? ' of ' : 'Workflow: '}
              <span className="font-medium">{workflowName}</span>
            </span>
          </p>
        </div>
      </div>

      {ctx && (ctx.can_send_back || ctx.can_open_run !== false) ? (
        <div className="flex flex-col gap-[8px]">
          {ctx.can_send_back ? (
            <PhoneButton
              variant="secondary"
              fullWidth
              onClick={() =>
                setSubject({
                  templateId: ctx.template_id,
                  instanceId: ctx.instance_id,
                  rowId: ctx.row_id,
                  stepTitle: ctx.step_title,
                  stepLabel: ctx.step_label ?? null,
                })
              }
            >
              <Undo2 aria-hidden /> Send back
            </PhoneButton>
          ) : null}
          {ctx.can_open_run !== false ? (
            <PhoneLinkButton href={workflowRunHref(ctx.template_id, ctx.instance_id)} fullWidth>
              Open instance <ArrowRight aria-hidden />
            </PhoneLinkButton>
          ) : null}
        </div>
      ) : null}

      <StepNotes notes={ctx?.notes ?? []} headingId="task-step-notes" className="border-t border-primary-border pt-[12px]" />

      {ctx ? (
        <WorkflowSendBackSheet
          orgId={orgId}
          subject={subject}
          onClose={() => setSubject(null)}
          onDone={() => {
            void load()
            onChanged?.()
          }}
        />
      ) : null}
    </section>
  )
}
