'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, StickyNote, Undo2, Workflow as WorkflowIcon } from 'lucide-react'
import { workflowsApi } from '@/lib/api/workflows'
import type { WorkflowStepContext } from '@/lib/types/workflows'
import SendBackDialog, { type SendBackSubject } from './SendBackDialog'
import { NoteItem } from './InstanceNotes'
import SendBackNote from './SendBackNote'
import { instanceTitle } from './instanceLabel'
import { BTN, runHref } from './shared'

/**
 * On a task a workflow created: why it was sent back (if it was), which workflow,
 * instance and step it belongs to, notes left for this step, a link to the instance, and
 * "Send back" for the step's assignees (the server says who may).
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
  const instanceName = ctx?.instance_name ?? fallback?.instance_name
  const notes = (ctx?.notes ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 shrink-0">
      {/* Sent back: why this step was reopened (or why it is waiting), first. */}
      {ctx?.send_back && <SendBackNote sendBack={ctx.send_back} variant={ctx.send_back.role === 'target' ? 'banner' : 'panel'} />}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <WorkflowIcon size={18} className="shrink-0 mt-0.5 text-[#1D4ED8]" />
          <div className="min-w-0 text-sm text-[#1E3A8A]">
            <p className="font-semibold break-words">{stepLabel}</p>
            <p className="break-words">
              {instanceName && <span className="font-medium">{instanceName}</span>}
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
        <div className="flex items-center gap-2 shrink-0">
          {ctx?.can_send_back && (
            <button
              type="button"
              onClick={() =>
                setSubject({
                  templateId: ctx.template_id,
                  instanceId: ctx.instance_id,
                  rowId: ctx.row_id,
                  stepTitle: ctx.step_title,
                  stepLabel: ctx.step_label ?? null,
                })
              }
              className={BTN.secondary}
            >
              <Undo2 size={16} /> Send back
            </button>
          )}
          {ctx && ctx.can_open_run !== false && (
            <Link href={runHref(ctx.template_id, ctx.instance_id)} className={BTN.quiet}>
              Open instance <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </div>

      {notes.length > 0 && (
        <section aria-labelledby="task-step-notes" className="flex flex-col gap-2 border-t border-[#BFDBFE] pt-3">
          <h3 id="task-step-notes" className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A]">
            <StickyNote size={15} className="text-[#92400E]" /> Notes for this step
          </h3>
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <NoteItem key={n.id} note={n} showStep={false} />
            ))}
          </ul>
        </section>
      )}

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
