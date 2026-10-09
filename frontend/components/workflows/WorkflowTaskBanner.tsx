'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Undo2, Workflow as WorkflowIcon } from 'lucide-react'
import { workflowsApi } from '@/lib/api/workflows'
import type { WorkflowStepContext } from '@/lib/types/workflows'
import SendBackDialog, { type SendBackSubject } from './SendBackDialog'
import { BTN, runHref } from './shared'

/**
 * On a task a workflow created: which workflow, run and step it belongs to, a link to
 * the run, and "Send back" for the step's assignees (the server says who may).
 */
export default function WorkflowTaskBanner({
  orgId,
  taskId,
  workflowInstanceStepId,
  fallback,
  onChanged,
}: {
  orgId: string
  taskId: string
  workflowInstanceStepId?: string | null
  /** What the task itself says about its workflow, shown if the details can't be loaded. */
  fallback?: { step_order?: number; template_name?: string; instance_name?: string } | null
  onChanged?: () => void
}) {
  const [ctx, setCtx] = useState<WorkflowStepContext | null>(null)
  const [failed, setFailed] = useState(false)
  const [subject, setSubject] = useState<SendBackSubject | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !taskId || !workflowInstanceStepId) return
    try {
      const c = await workflowsApi.getStepContext(orgId, taskId)
      setCtx(c && typeof c === 'object' && 'instance_id' in c ? c : null)
      setFailed(!c)
    } catch {
      setFailed(true)
    }
  }, [orgId, taskId, workflowInstanceStepId])

  useEffect(() => {
    load()
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
  const runName = ctx?.instance_name ?? fallback?.instance_name

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 shrink-0">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <WorkflowIcon size={18} className="shrink-0 mt-0.5 text-[#1D4ED8]" />
        <p className="text-sm text-[#1E3A8A] min-w-0">
          <span className="font-semibold">{stepLabel}</span>
          <span> in </span>
          <span className="font-semibold">{workflowName}</span>
          {runName && <span className="text-[#1E40AF]"> · {runName}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {ctx?.can_send_back && (
          <button
            type="button"
            onClick={() => setSubject({ templateId: ctx.template_id, instanceId: ctx.instance_id, rowId: ctx.row_id, stepTitle: ctx.step_title, stepLabel: ctx.step_label ?? null })}
            className={BTN.secondary}
          >
            <Undo2 size={16} /> Send back
          </button>
        )}
        {ctx && ctx.can_open_run !== false && (
          <Link href={runHref(ctx.template_id, ctx.instance_id)} className={BTN.quiet}>
            Open run <ArrowRight size={16} />
          </Link>
        )}
      </div>

      {ctx && (
        <SendBackDialog
          orgId={orgId}
          subject={subject}
          onClose={() => setSubject(null)}
          onDone={() => {
            load()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
