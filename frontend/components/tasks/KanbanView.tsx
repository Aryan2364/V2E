'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock, CheckCircle2, XCircle, RotateCcw, Hand } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import type { Task, TaskStatus, TaskPriority, TaskCategory } from '@/lib/types/tasks'
import {
  kanbanColumnId,
  resolveKanbanDrop,
  isTerminalType,
  withinUndoWindow,
  type KanbanPerspective,
} from '@/lib/tasks/kanban-actions'
import QuadrantBadge from './QuadrantBadge'
import AssigneeAvatars from './AssigneeAvatars'
import TagList from './TagList'

interface Props {
  orgId: string
  tasks: Task[]
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  categories: TaskCategory[]
  /** 'assignee' = My Tasks (act on my part); 'owner' = Assigned by me (act on whole task). */
  perspective: KanbanPerspective
  currentUserId?: string
  /** Called with the updated task after any successful drop action. */
  onChanged: (updated: Task) => void
  onTaskClick: (taskId: string) => void
}

function isOverdue(deadline?: string, statusType?: string): boolean {
  if (!deadline || isTerminalType(statusType)) return false
  return new Date(deadline) < new Date()
}

/** Surface the backend's actual reason (e.g. "Tick every checklist item…") instead of a generic error. */
function apiErrorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(m)) return m[0] ?? fallback
  return typeof m === 'string' && m ? m : fallback
}

// A pending drop that needs a reason before it can complete.
type PendingReason = { task: Task; target: TaskStatus; mode: 'flag' | 'incomplete' }

export default function KanbanView({
  orgId, tasks, statuses, priorities, categories, perspective, currentUserId, onChanged, onTaskClick,
}: Props) {
  const { addToast } = useToast()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingReason | null>(null)
  const [reason, setReason] = useState('')
  const [savingReason, setSavingReason] = useState(false)

  // Use the app's shared amber toast for blocked/failed drops (not a bespoke one).
  function flash(msg: string) {
    addToast(msg, 'warning')
  }

  // "Partially Completed" is a whole-task rollup — never a personal state — so it's hidden
  // on My Tasks (assignee) where columns are the viewer's own progress. It stays on the
  // owner board, where columns are the overall status — placed right AFTER Incomplete
  // (Completed → Incomplete → Partially Completed) regardless of stored order.
  const columns = (() => {
    const visible = perspective === 'assignee' ? statuses.filter((s) => s.type !== 'partially_completed') : [...statuses]
    const partial = visible.find((s) => s.type === 'partially_completed')
    const rest = visible.filter((s) => s.type !== 'partially_completed')
    const incIdx = rest.findIndex((s) => s.type === 'incomplete')
    if (partial && incIdx >= 0) rest.splice(incIdx + 1, 0, partial) // insert just after Incomplete
    else if (partial) rest.push(partial)
    return rest
  })()

  // Group cards by the viewer's column (personal progress on My Tasks; overall otherwise).
  const tasksByCol = statuses.reduce<Record<string, Task[]>>((acc, s) => { acc[s.id] = []; return acc }, {})
  for (const t of tasks) {
    const col = kanbanColumnId(t, perspective, currentUserId, statuses)
    ;(tasksByCol[col] ??= []).push(t)
  }

  async function runDrop(task: Task, target: TaskStatus, providedReason?: string) {
    setUpdating(task.id)
    try {
      const res = await resolveKanbanDrop(task, target, { orgId, perspective }, providedReason)
      if (res.kind === 'blocked') { flash(res.message); return }
      if (res.kind === 'needsReason') { setReason(''); setPending({ task, target, mode: res.mode }); return }
      if (res.kind === 'done') { onChanged(res.task) }
    } catch (e) {
      flash(apiErrorMessage(e, 'Couldn’t move that task — please try again.'))
    } finally {
      setUpdating(null)
    }
  }

  async function handleDrop(e: React.DragEvent, target: TaskStatus) {
    e.preventDefault()
    setDragOverCol(null)
    const id = draggingId
    setDraggingId(null)
    if (!id) return
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    // Dropping onto the card's own column is a no-op.
    if (kanbanColumnId(task, perspective, currentUserId, statuses) === target.id) return
    await runDrop(task, target)
  }

  async function confirmReason() {
    if (!pending || !reason.trim()) return
    setSavingReason(true)
    try {
      const res = await resolveKanbanDrop(pending.task, pending.target, { orgId, perspective }, reason.trim())
      if (res.kind === 'done') { onChanged(res.task); setPending(null); setReason('') }
      else if (res.kind === 'blocked') { flash(res.message); setPending(null) }
    } catch (e) {
      flash(apiErrorMessage(e, 'Couldn’t save — please try again.'))
    } finally {
      setSavingReason(false)
    }
  }

  return (
    <div>
      {/* Touch devices can't HTML5-drag — tell them to open the card instead, shown
          only on coarse pointers so it's not noise on desktop. */}
      <div className="[@media(pointer:fine)]:hidden mb-3 flex items-center gap-2 text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-[8px] px-3 py-2">
        <Hand size={13} className="shrink-0" />
        Drag isn’t available on touch — tap a card to open it and change its status there.
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[60vh]">
      {columns.map((status) => {
        const colTasks = tasksByCol[status.id] ?? []
        const isPartialCol = status.type === 'partially_completed'
        const isOver = dragOverCol === status.id && !isPartialCol
        return (
          <div
            key={status.id}
            className="flex flex-col shrink-0 w-72"
            onDragOver={(e) => { if (!isPartialCol) { e.preventDefault(); setDragOverCol(status.id) } }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => handleDrop(e, status)}
          >
            {/* Column header */}
            <div
              className={`flex items-center gap-2 px-3 py-2.5 rounded-[10px] mb-3 border transition-colors ${
                isOver ? 'border-[#2563EB] bg-[#EFF6FF]' : isPartialCol ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-[#E2E8F0] bg-white'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
              <span className="text-sm font-semibold text-[#0F172A] flex-1">{status.label}</span>
              {isPartialCol && <Lock size={12} className="text-[#94A3B8] shrink-0" aria-label="Set automatically" />}
              <span className="text-xs font-medium text-[#94A3B8] bg-[#F1F5F9] px-2 py-0.5 rounded-full">{colTasks.length}</span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 flex-1">
              {colTasks.map((task) => {
                const priority = priorities.find((p) => p.id === task.priority_id)
                const overdue = isOverdue(task.deadline, task.status?.type)
                const isUpdating = updating === task.id
                const terminal = isTerminalType(task.status?.type)
                const inWindow = terminal && withinUndoWindow(task)
                const locked = terminal && !inWindow
                const workers = task.assignees?.filter((a) => !a.is_cc) ?? []
                const allMust = task.completion_mode === 'all_must_complete'
                const me = perspective === 'assignee' ? workers.find((a) => a.user_id === currentUserId) : undefined
                const people = [...(task.assignees ?? [])]
                  .sort((a, b) => Number(a.is_cc) - Number(b.is_cc))
                  .map((a) => ({ id: a.id, name: a.user?.name ?? a.user_name ?? '?', department: a.user?.department, role: a.user?.role_title, isCC: a.is_cc }))

                return (
                  <div
                    key={task.id}
                    draggable={!locked}
                    onDragStart={() => { if (!locked) setDraggingId(task.id) }}
                    onDragEnd={() => { setDraggingId(null); setDragOverCol(null) }}
                    onClick={() => onTaskClick(task.id)}
                    className={`bg-white border rounded-[10px] p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all select-none ${
                      locked ? 'cursor-pointer opacity-90' : 'cursor-grab active:cursor-grabbing'
                    } ${draggingId === task.id ? 'opacity-40 border-[#2563EB]' : 'border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)]'} ${isUpdating ? 'opacity-60' : ''}`}
                  >
                    <p className="text-sm font-semibold text-[#0F172A] leading-snug mb-2 line-clamp-2">{task.title}</p>

                    {/* Badges row — urgency (quadrant + priority), then tags. The column is the
                        status (kit §35.5), so the card stays at title · urgency · tags · one
                        meta line. Tags wrap onto their own line when the card is narrow. */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      <QuadrantBadge quadrant={task.quadrant} />
                      {priority && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: priority.color + '18', color: priority.color }}>
                          {priority.label}
                        </span>
                      )}
                      <TagList tags={task.tags} max={2} />
                    </div>

                    {/* Per-person + roll-up context (assignee, all_must, open) */}
                    {me && allMust && !terminal && (
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {me.is_completed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-full px-2 py-0.5"><CheckCircle2 size={11} /> Your part done</span>
                        ) : me.cannot_complete ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-full px-2 py-0.5"><XCircle size={11} /> You can’t complete</span>
                        ) : null}
                        {workers.length > 1 && (
                          <span className="text-[10px] font-medium text-[#64748B]">Task {workers.filter((a) => a.is_completed).length}/{workers.length} · still open</span>
                        )}
                      </div>
                    )}

                    {/* Undo hint on a freshly-closed card */}
                    {inWindow && (
                      <div className="mb-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#D97706] bg-[#FEF9C3] border border-[#FDE68A] rounded-full px-2 py-0.5"><RotateCcw size={10} /> Undo available — drag out to revert</span>
                      </div>
                    )}
                    {locked && (
                      <div className="mb-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#94A3B8]"><Lock size={10} /> Locked — reopen from the task page</span>
                      </div>
                    )}

                    {/* Footer: deadline + avatars */}
                    <div className="flex items-center justify-between mt-1">
                      {task.deadline ? (
                        <span className={`text-[11px] font-medium ${overdue ? 'text-[#DC2626]' : 'text-[#64748B]'}`}>
                          {new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {overdue && ' · Overdue'}
                        </span>
                      ) : <span />}
                      {people.length > 0 && <AssigneeAvatars people={people} max={3} size="sm" />}
                    </div>
                  </div>
                )
              })}

              {isOver && (
                <div className="h-16 border-2 border-dashed border-[#2563EB] rounded-[10px] bg-[#EFF6FF] flex items-center justify-center">
                  <span className="text-xs text-[#2563EB] font-medium">Drop here</span>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Reason dialog for an Incomplete / can't-complete drop */}
      {pending && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !savingReason) { setPending(null); setReason('') } }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-sm bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center shrink-0"><XCircle size={18} className="text-[#DC2626]" /></div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-[#0F172A]">{pending.mode === 'flag' ? "Can’t complete your part?" : 'Mark this task incomplete?'}</h3>
                <p className="text-sm text-[#475569] mt-1">{pending.mode === 'flag' ? 'Your part will be flagged as not-done — a reason is required.' : 'The task will be closed as not-done — a reason is required.'}</p>
              </div>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              rows={3}
              autoFocus
              className="mt-3 w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#DC2626] resize-none"
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
              <button type="button" onClick={() => { setPending(null); setReason('') }} disabled={savingReason} className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-[#475569] bg-white border border-[#CBD5E1] rounded-[8px] hover:bg-[#F8FAFC] disabled:opacity-60 transition-colors">Cancel</button>
              <button type="button" onClick={confirmReason} disabled={savingReason || !reason.trim()} className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] disabled:opacity-60 disabled:cursor-not-allowed transition-colors">{savingReason ? 'Saving…' : pending.mode === 'flag' ? 'Flag my part' : 'Confirm Incomplete'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      </div>
    </div>
  )
}
