'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, Circle, Download, ExternalLink, FileText, FileWarning, ListChecks, MessageSquare, Play, Send, SkipForward, StickyNote, Undo2 } from 'lucide-react'
import { AttachmentChips } from '@/components/ui/AttachmentList'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { workflowErrorMessage, workflowErrorStatus } from '@/lib/api/workflows'
import { formatBytes } from '@/lib/attachments'
import type { Task, TaskAttachment, TaskChecklistItem, TaskComment } from '@/lib/types/tasks'
import type { InstanceNote, WorkflowInstanceStep } from '@/lib/types/workflows'
import { NoteItem } from './InstanceNotes'
import Sheet from './Sheet'
import { Avatar, BTN, CompletionChip, ErrorBanner, GatedButton, Skeleton, StepStatusBadge, fmtDateTime, fmtDayDateTime, taskHref } from './shared'

type Load<T> = { status: 'idle' | 'loading' | 'ready' | 'failed' | 'hidden'; data: T; error?: string }

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2.5 border-b border-[#F1F5F9] last:border-b-0">
      <dt className="text-[13px] text-[#475569]">{label}</dt>
      <dd className="text-sm text-[#0F172A] min-w-0 break-words">{children}</dd>
    </div>
  )
}

const itemDone = (i: TaskChecklistItem) =>
  i.is_completed || i.cant_do === true || (typeof i.done_count === 'number' && typeof i.assignee_count === 'number' && i.assignee_count > 0 && i.done_count + (i.skipped_count ?? 0) >= i.assignee_count)

function groupItems<T extends { group_title?: string | null }>(items: T[]): { heading: string; items: T[] }[] {
  const out: { heading: string; items: T[] }[] = []
  for (const it of items) {
    const h = it.group_title?.trim() || ''
    const last = out[out.length - 1]
    if (last && last.heading === h) last.items.push(it)
    else out.push({ heading: h, items: [it] })
  }
  return out
}

/**
 * One instance step in a side panel: who has it, when it is due, notes left for it, its
 * checklist, proof and comments — everyone in the instance sees these, and may comment. Send back and Skip
 * hand over to the page, which closes this panel and opens their dialog (never a dialog
 * on top of a panel).
 */
export default function RunStepDrawer({
  orgId,
  row: rowProp,
  rows,
  label,
  onClose,
  canSendBack,
  sendBackReason,
  onSendBack,
  canSkip,
  skipReason,
  onSkip,
  onChanged,
  canStartNow,
  startNowReason = '',
  startingNow = false,
  onStartNow,
  notes = [],
}: {
  orgId: string
  row: WorkflowInstanceStep | null
  rows: WorkflowInstanceStep[]
  label: string
  onClose: () => void
  canSendBack: boolean | undefined
  sendBackReason: string
  onSendBack: (row: WorkflowInstanceStep) => void
  canSkip: boolean | undefined
  skipReason: string
  onSkip: (row: WorkflowInstanceStep) => void
  /** A comment was added (the run's counts may change). */
  onChanged?: () => void
  /** A waiting step may be started now: undefined = not offered (not waiting, or not listed). */
  canStartNow?: boolean | undefined
  startNowReason?: string
  startingNow?: boolean
  onStartNow?: (row: WorkflowInstanceStep) => void
  /** Instance notes left for this step (newest first). */
  notes?: InstanceNote[]
}) {
  const { addToast } = useToast()
  // Keep showing the last step while the panel slides away.
  const lastRow = useRef(rowProp)
  if (rowProp) lastRow.current = rowProp
  const row = rowProp ?? lastRow.current
  const taskId = row && !row.task_deleted ? row.task_id ?? row.task?.id ?? null : null
  const [task, setTask] = useState<Load<Task | null>>({ status: 'idle', data: null })
  const [comments, setComments] = useState<Load<TaskComment[]>>({ status: 'idle', data: [] })
  const [proofs, setProofs] = useState<Load<TaskAttachment[]>>({ status: 'idle', data: [] })
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  const loadComments = useCallback(async () => {
    if (!taskId) return
    setComments((c) => ({ ...c, status: c.status === 'ready' ? 'ready' : 'loading' }))
    try {
      const list = await tasksApi.getComments(orgId, taskId)
      setComments({ status: 'ready', data: Array.isArray(list) ? list : [] })
    } catch (e) {
      setComments({ status: workflowErrorStatus(e) === 403 ? 'hidden' : 'failed', data: [], error: workflowErrorMessage(e, 'Comments could not be loaded.') })
    }
  }, [orgId, taskId])

  const loadAll = useCallback(async () => {
    if (!taskId) return
    setTask({ status: 'loading', data: null })
    setProofs({ status: 'loading', data: [] })
    tasksApi
      .getTask(orgId, taskId)
      .then((t) => setTask({ status: 'ready', data: t }))
      .catch((e) => setTask({ status: workflowErrorStatus(e) === 403 ? 'hidden' : 'failed', data: null, error: workflowErrorMessage(e, 'The task could not be loaded.') }))
    tasksApi
      .listProofs(orgId, taskId)
      .then((p) => setProofs({ status: 'ready', data: Array.isArray(p) ? p : [] }))
      .catch((e) => setProofs({ status: workflowErrorStatus(e) === 403 ? 'hidden' : 'failed', data: [], error: workflowErrorMessage(e, 'Proof could not be loaded.') }))
    loadComments()
  }, [orgId, taskId, loadComments])

  useEffect(() => {
    setDraft('')
    setPostError(null)
    if (taskId) loadAll()
    else {
      setTask({ status: 'idle', data: null })
      setComments({ status: 'idle', data: [] })
      setProofs({ status: 'idle', data: [] })
    }
  }, [taskId, loadAll])

  async function post() {
    const body = draft.trim()
    if (!taskId || !body || posting) return
    setPosting(true)
    setPostError(null)
    try {
      await tasksApi.addComment(orgId, taskId, body)
      setDraft('')
      await loadComments()
      onChanged?.()
    } catch (e) {
      setPostError(workflowErrorMessage(e, 'Your comment was not posted. Try again.'))
    } finally {
      setPosting(false)
    }
  }

  const download = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be downloaded. Try again.'), 'error')
    }
  }

  if (!row) return null

  const title = (id: string | null | undefined) => {
    const r = rows.find((x) => x.id === id)
    if (!r) return 'an earlier step'
    return `${r.number_label ? `${r.number_label} ` : ''}“${r.title || 'Untitled step'}”`
  }
  const people = row.assignees?.length ? row.assignees : row.assigned_to ? [row.assigned_to] : []
  const deadline = row.task?.deadline ?? row.scheduled_at
  const overdue = row.task?.is_overdue || row.status === 'overdue' || row.status === 'moved_on'
  const live = ['active', 'overdue', 'sent_back', 'moved_on'].includes(row.status)
  const waiting = typeof row.waiting === 'boolean' ? row.waiting : row.status === 'pending' && !!row.start_at
  const plannedSame = (a?: string | null, b?: string | null) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime()

  const checklist: { title: string; group_title?: string | null; done: boolean | null }[] =
    task.status === 'ready' && task.data?.checklist
      ? task.data.checklist.slice().sort((a, b) => a.order_index - b.order_index).map((i) => ({ title: i.title, group_title: i.group_title, done: itemDone(i) }))
      : (row.checklist_items ?? []).map((i) => ({ title: i.title, group_title: i.group_title, done: null }))
  const doneCount = checklist.filter((c) => c.done).length
  const totalCount = checklist.length || row.task?.checklist_total || 0

  const footer = (
    <>
      {waiting && canStartNow !== undefined && onStartNow && (
        <GatedButton allowed={canStartNow} reason={startNowReason} icon={Play} variant="primary" loading={startingNow} onClick={() => onStartNow(row)}>
          Start now
        </GatedButton>
      )}
      {canSendBack !== undefined && live && row.status !== 'sent_back' && (
        <GatedButton allowed={canSendBack} reason={sendBackReason} icon={Undo2} variant="secondary" onClick={() => onSendBack(row)}>
          Send back
        </GatedButton>
      )}
      {live && (
        <GatedButton allowed={canSkip} reason={skipReason} icon={SkipForward} variant="quiet" onClick={() => onSkip(row)}>
          Skip step
        </GatedButton>
      )}
      {taskId && (
        <Link href={taskHref(taskId)} className={BTN.primary}>
          <ExternalLink size={16} /> Open task
        </Link>
      )}
    </>
  )

  return (
    <Sheet
      open={!!rowProp}
      onClose={onClose}
      labelId="run-step-title"
      eyebrow={label}
      title={row.title || 'Untitled step'}
      headerExtra={
        <>
          <StepStatusBadge status={row.status} waiting={waiting} />
          {row.task?.status?.label && <span className="text-[12px] text-[#475569]">Task: {row.task.status.label}</span>}
        </>
      }
      footer={footer}
    >
      {row.status === 'sent_back' && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[#DDD6FE] bg-[#F5F3FF] px-3.5 py-2.5 text-sm text-[#4C1D95]">
          <Undo2 size={16} className="shrink-0 mt-0.5" />
          <span>
            Waiting for info from <span className="font-semibold">{title(row.waiting_on_row_id)}</span>. Resumes when that step is done.
          </span>
        </div>
      )}
      {row.returned_to_row_id && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[#DDD6FE] bg-[#F5F3FF] px-3.5 py-2.5 text-sm text-[#4C1D95]">
          <Undo2 size={16} className="shrink-0 mt-0.5" />
          <span>
            Sent back from <span className="font-semibold">{title(row.returned_to_row_id)}</span>. The reason is in the comments. When done, the instance returns there.
          </span>
        </div>
      )}
      {row.status === 'moved_on' && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
          <FileWarning size={16} className="shrink-0 mt-0.5" />
          <span>This step is late. Next steps started anyway; this task stays open.</span>
        </div>
      )}
      {waiting && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-2.5 text-sm text-[#1E3A8A]">
          <CalendarClock size={16} className="shrink-0 mt-0.5" />
          <span>
            Starts on <span className="font-semibold">{fmtDayDateTime(row.start_at)}</span>.{canStartNow !== undefined ? ' You can also start it now.' : ''}
          </span>
        </div>
      )}
      {row.last_error && <ErrorBanner message={row.last_error} />}
      {row.task_deleted && (
        <ErrorBanner message="This step’s task was deleted. An editor or admin must retry or skip it." />
      )}

      {notes.length > 0 && (
        <section aria-labelledby="step-notes" className="flex flex-col gap-2">
          <h3 id="step-notes" className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A]">
            <StickyNote size={15} /> Notes for this step
          </h3>
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <NoteItem key={n.id} note={n} showStep={false} />
            ))}
          </ul>
        </section>
      )}

      <dl>
        <Fact label="Assigned to">
          {people.length ? (
            <span className="flex flex-col gap-1.5">
              {people.map((p) => (
                <span key={p.id} className="flex items-center gap-2">
                  <Avatar name={p.name} /> {p.name}
                </span>
              ))}
              {/* Who has to complete it — from the step's live task (2+ people only). */}
              {task.status === 'ready' && task.data?.completion_mode && (
                <span className="self-start">
                  <CompletionChip mode={task.data.completion_mode} count={people.length} />
                </span>
              )}
            </span>
          ) : waiting ? (
            'Assigned when it starts'
          ) : row.status === 'pending' ? (
            'Assigned when previous steps are done'
          ) : (
            '—'
          )}
        </Fact>
        {(row.planned_start_at || row.planned_due_at) && (
          <Fact label="Planned">
            <span className="flex flex-col">
              <span>Start {fmtDayDateTime(row.planned_start_at)}</span>
              <span>Due {fmtDayDateTime(row.planned_due_at)}</span>
            </span>
          </Fact>
        )}
        {waiting && !plannedSame(row.start_at, row.planned_start_at) && <Fact label="Starts">{fmtDayDateTime(row.start_at)}</Fact>}
        <Fact label="Deadline">
          {deadline ? (
            <span className={overdue && !row.completed_at ? 'text-[#B91C1C] font-medium' : ''}>
              {fmtDateTime(deadline)}
              {overdue && !row.completed_at ? ' · overdue' : ''}
            </span>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="Started">{row.task_created_at ? fmtDateTime(row.task_created_at) : '—'}</Fact>
        <Fact label="Completed">{row.completed_at ? fmtDateTime(row.completed_at) : '—'}</Fact>
        {(row.sent_back_count ?? 0) > 0 && <Fact label="Sent back">{row.sent_back_count === 1 ? 'Once' : `${row.sent_back_count} times`}</Fact>}
      </dl>

      {row.description && (
        <section>
          <h3 className="text-sm font-semibold text-[#0F172A] mb-1">Description</h3>
          <p className="text-sm text-[#1E293B] whitespace-pre-wrap break-words">{row.description}</p>
        </section>
      )}

      {/* Checklist */}
      {totalCount > 0 && (
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A] mb-2">
            <ListChecks size={15} /> Checklist
            {checklist.some((c) => c.done !== null) && (
              <span className="ml-auto text-[13px] font-normal text-[#334155] tabular-nums">
                {doneCount} of {checklist.length} done
              </span>
            )}
          </h3>
          {checklist.some((c) => c.done !== null) && (
            <div className="h-2 rounded-full bg-[#E2E8F0] overflow-hidden mb-3" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={doneCount} aria-label="Checklist done">
              <div className="h-full rounded-full bg-[#16A34A]" style={{ width: `${checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0}%` }} />
            </div>
          )}
          {task.status === 'loading' ? (
            <Skeleton className="h-16" />
          ) : (
            <div className="flex flex-col gap-3">
              {groupItems(checklist).map((g, gi) => (
                <div key={gi}>
                  {g.heading && <h4 className="text-[13px] font-semibold text-[#334155] mb-1.5 break-words">{g.heading}</h4>}
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[#1E293B] px-3 py-2 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0]">
                        {c.done ? (
                          <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[#16A34A]" aria-label="Done" />
                        ) : (
                          <Circle size={16} className="shrink-0 mt-0.5 text-[#94A3B8]" aria-label={c.done === null ? undefined : 'Not done'} />
                        )}
                        <span className={`break-words min-w-0 ${c.done ? 'text-[#334155]' : ''}`}>{c.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Proof */}
      {taskId && (row.proof_required || proofs.data.length > 0) && (
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A] mb-2">
            <FileText size={15} /> Proof
          </h3>
          {proofs.status === 'loading' ? (
            <Skeleton className="h-10" />
          ) : proofs.status === 'failed' ? (
            <p className="text-sm text-[#B91C1C]">{proofs.error}</p>
          ) : proofs.data.length === 0 ? (
            <p className="text-sm text-[#475569]">{row.proof_required ? 'Proof required. None added yet.' : 'No proof added.'}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {proofs.data.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-[8px] border border-[#E2E8F0] px-3 py-2">
                  <FileText size={15} className="shrink-0 text-[#475569]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[#0F172A] truncate">{f.file_name}</span>
                    <span className="block text-[12px] text-[#475569]">
                      {formatBytes(f.size_bytes)}
                      {f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''} · {fmtDateTime(f.created_at)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Download ${f.file_name}`}
                    onClick={() => download(() => tasksApi.downloadProof(orgId, taskId, f.id))}
                    className={BTN.icon}
                  >
                    <Download size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Comments */}
      {taskId && (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A]">
            <MessageSquare size={15} /> Comments
          </h3>
          {comments.status === 'loading' || comments.status === 'idle' ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : comments.status === 'hidden' ? (
            <p className="text-sm text-[#475569]">You don’t have access to these comments.</p>
          ) : comments.status === 'failed' ? (
            <div className="flex items-center gap-2 text-sm text-[#B91C1C]">
              <span>{comments.error}</span>
              <button type="button" onClick={loadComments} className="font-semibold underline">
                Try again
              </button>
            </div>
          ) : comments.data.filter((c) => !c.is_deleted).length === 0 ? (
            <p className="text-sm text-[#475569]">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.data
                .filter((c) => !c.is_deleted)
                .map((c) => (
                  <li key={c.id} className="flex flex-col gap-2">
                    <CommentBubble c={c} onDownload={(a) => download(() => tasksApi.downloadAttachment(orgId, taskId, a.id))} />
                    {(c.replies ?? [])
                      .filter((r) => !r.is_deleted)
                      .map((r) => (
                        <div key={r.id} className="pl-8">
                          <CommentBubble c={r} onDownload={(a) => download(() => tasksApi.downloadAttachment(orgId, taskId, a.id))} />
                        </div>
                      ))}
                  </li>
                ))}
            </ul>
          )}

          {comments.status !== 'hidden' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="run-step-comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="run-step-comment"
                value={draft}
                rows={2}
                maxLength={5000}
                disabled={posting}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    post()
                  }
                }}
                placeholder="Add a comment"
                className="w-full px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-y"
              />
              {postError && <ErrorBanner message={postError} onClose={() => setPostError(null)} />}
              <button type="button" onClick={post} disabled={!draft.trim() || posting} className={`${BTN.secondary} self-end`}>
                <Send size={16} /> {posting ? 'Posting…' : 'Comment'}
              </button>
            </div>
          )}
        </section>
      )}

      {!taskId && !row.task_deleted && !waiting && (
        <p className="text-sm text-[#475569]">
          {row.status === 'pending'
              ? 'Not started yet.'
              : 'This step has no task.'}
        </p>
      )}
      {task.status === 'hidden' && (
        <p className="text-[13px] text-[#475569]">Some details are visible only to people on this task.</p>
      )}
    </Sheet>
  )
}

function CommentBubble({ c, onDownload }: { c: TaskComment; onDownload: (a: TaskAttachment) => void }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={c.user_name || '?'} size="md" />
      <div className="min-w-0 flex-1 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
        <p className="text-[13px]">
          <span className="font-semibold text-[#0F172A]">{c.user_name || 'Someone'}</span>
          <span className="text-[#475569]"> · {fmtDateTime(c.created_at)}</span>
        </p>
        <p className="text-sm text-[#1E293B] whitespace-pre-wrap break-words">{c.body}</p>
        {c.attachments && c.attachments.length > 0 && <AttachmentChips attachments={c.attachments} onDownload={onDownload} />}
      </div>
    </div>
  )
}
