'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Calendar, GitBranch, MessageSquare, Paperclip, ChevronDown, Check, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { getNow } from '@/lib/clock'
import type { Task, TaskPriority, TaskStatus, TaskCategory } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import AssigneeAvatars, { type AvatarPerson } from './AssigneeAvatars'
import Tooltip from '@/components/ui/Tooltip'
import TagList from './TagList'
// import QuadrantBadge from './QuadrantBadge'

interface TaskCardProps {
  task: Task
  onClick: () => void
  priorities: TaskPriority[]
  statuses: TaskStatus[]
  categories: TaskCategory[]
  /** When provided, the status pill becomes a click-to-change control (no drill-in). */
  onStatusChange?: (statusId: string) => void | Promise<void>
  /** When provided (My Tasks only), the status menu also offers a "Mark Complete" action. */
  onComplete?: () => void
  /** When provided (My Tasks only), the status menu also offers a "Mark Incomplete" action. */
  onMarkIncomplete?: () => void
  // The viewer's user id. Lets the row show who assigned the task and list the
  // OTHER assignees (everyone but the viewer). Omit on cross-org/collective views.
  currentUserId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deadlineClass(deadline?: string): string {
  if (!deadline) return 'text-[#475569]'
  const d = new Date(deadline)
  const now = getNow()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dl = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (dl < today) return 'text-[#DC2626] font-medium'
  if (dl.getTime() === today.getTime()) return 'text-[#D97706] font-medium'
  return 'text-[#475569]'
}

function formatDeadline(deadline: string): string {
  const d = new Date(deadline)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date}, ${time}`
}

// Order statuses by their lifecycle phase, then their configured order — so the
// change menu reads Not started → In progress → Completed / Incomplete.
const PHASE_ORDER: Record<TaskStatus['type'], number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
  partially_completed: 3,
  incomplete: 4,
}

// ─── Status change control ──────────────────────────────────────────────────────

export function StatusControl({
  status,
  statuses,
  onChange,
  onComplete,
  onMarkIncomplete,
}: {
  status: TaskStatus
  statuses: TaskStatus[]
  // Optional: when omitted the menu shows only the terminal actions (Complete /
  // Incomplete) — e.g. an assigner who shouldn't move a worker's per-person status.
  onChange?: (statusId: string) => void | Promise<void>
  onComplete?: () => void
  onMarkIncomplete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape. The menu is absolutely anchored to this
  // control (not a fixed portal), so it moves with the row and never drifts.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const ordered = [...statuses].sort(
    (a, b) => PHASE_ORDER[a.type] - PHASE_ORDER[b.type] || a.order_index - b.order_index,
  )

  async function pick(id: string) {
    setOpen(false)
    if (id === status.id || !onChange) return
    try {
      setBusy(true)
      await onChange(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-[999px] pl-2.5 pr-1.5 py-0.5 text-[11px] font-medium transition-shadow hover:shadow-sm disabled:opacity-60"
        style={{
          backgroundColor: status.color + '22',
          color: status.color,
          border: `1px solid ${status.color}44`,
        }}
      >
        {status.label}
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 z-50 w-52 max-h-64 overflow-y-auto rounded-[10px] border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1"
        >
          {onChange && ordered.map((s) => {
            const active = s.id === status.id
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(s.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  active ? 'bg-[#F1F5F9]' : 'hover:bg-[#F8FAFC]'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="flex-1 truncate text-[#0F172A]">{s.label}</span>
                {active && <Check size={14} className="text-[#2563EB] shrink-0" />}
              </button>
            )
          })}

          {/* Terminal outcomes. These aren't plain status moves — Complete runs the
              real completion gate (checklist/proof); Incomplete needs a reason. The
              divider only shows when the status list sits above them. */}
          {onChange && (onComplete || onMarkIncomplete) && (
            <div className="my-1 border-t border-[#E2E8F0]" />
          )}
          {onComplete && (
            <button
              type="button"
              onClick={() => { setOpen(false); onComplete() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[#15803D] hover:bg-[#F0FDF4] transition-colors"
            >
              <CheckCircle2 size={14} className="shrink-0" />
              <span className="flex-1">Mark Complete</span>
            </button>
          )}
          {onMarkIncomplete && (
            <button
              type="button"
              onClick={() => { setOpen(false); onMarkIncomplete() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
            >
              <XCircle size={14} className="shrink-0" />
              <span className="flex-1">Mark Incomplete</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskCard({ task, onClick, priorities, statuses, categories, onStatusChange, onComplete, onMarkIncomplete, currentUserId }: TaskCardProps) {
  const priority = priorities.find((p) => p.id === task.priority_id)
  const status = statuses.find((s) => s.id === task.status_id) ?? task.status
  const category = categories.find((c) => c.id === task.category_id) ?? task.category

  const commentCount = task._count?.comments ?? 0
  const unread = task.unread_comments ?? 0
  const attachmentCount = task._count?.attachments ?? 0

  // The inline control only moves a task between OPEN states. Terminal states
  // (completed / incomplete) are reached via the Complete / Reopen actions on the
  // task, so a task already in a terminal state shows a read-only pill.
  const isTerminalStatus = !!status && TERMINAL_STATUS_PHASES.includes(status.type)
  const openStatuses = statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))

  // Who assigned the task. Hidden when the viewer is the assigner (no "By me").
  const assignerName = task.created_by?.name ?? null
  const showAssigner = !!assignerName && task.created_by_user_id !== currentUserId

  // Other assignees = everyone but the viewer (primary first, then CC), each with
  // name/dept/role for the hover tooltip. When currentUserId is omitted, this is
  // simply the full assignee list.
  const otherPeople: AvatarPerson[] = [...(task.assignees ?? [])]
    .filter((a) => a.user_id !== currentUserId)
    .sort((a, b) => Number(a.is_cc) - Number(b.is_cc))
    .map((a) => ({
      id: a.id,
      name: a.user?.name ?? a.user_name ?? '?',
      department: a.user?.department,
      role: a.user?.role_title,
      isCC: a.is_cc,
    }))

  return (
    <div
      onClick={onClick}
      className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] px-5 py-4 flex items-center gap-4 cursor-pointer hover:border-[#2563EB] hover:shadow-md transition-all duration-150 group"
    >
      {/* Title + Category + Priority */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#0F172A] truncate group-hover:text-[#2563EB] transition-colors">
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {category && (
            <span
              className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: category.color + '22',
                color: category.color,
                border: `1px solid ${category.color}44`,
              }}
            >
              {category.name}
            </span>
          )}
          {/* Tags sit with the category as one classification fact (two chips + "+N"). */}
          <TagList tags={task.tags} max={2} />
          {task.workflow_step?.show_on_card && (
            <span className="inline-flex items-center gap-0.5 rounded-[999px] px-2 py-0.5 text-[10px] font-semibold bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
              <GitBranch size={9} />
              {task.workflow_step.template_name} — Step {task.workflow_step.step_order}
            </span>
          )}
        </div>
      </div>

      {/* Meta cluster — chats (with unread) + attachments. Glanceable, no drill-in. */}
      <div className="shrink-0 flex items-center gap-3">
        {/* Chats / comments — total count beside the icon; the unread badge sits on
            the icon's corner (with a white ring) so it never overlaps the count. */}
        <Tooltip
          label={
            commentCount === 0
              ? 'No comments'
              : `${commentCount} comment${commentCount !== 1 ? 's' : ''}${unread > 0 ? ` · ${unread} unread` : ''}`
          }
        >
          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            <span className="relative inline-flex shrink-0">
              <MessageSquare size={14} className={unread > 0 ? 'text-[#2563EB]' : ''} />
              {unread > 0 && (
                <span className="absolute -top-2 -right-1.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-[#2563EB] text-white text-[9px] font-bold leading-none ring-2 ring-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            <span className={unread > 0 ? 'font-semibold text-[#2563EB]' : ''}>{commentCount}</span>
          </div>
        </Tooltip>

        {/* Attachments — shows "None" when there are no files */}
        <Tooltip label={attachmentCount === 0 ? 'No attachments' : `${attachmentCount} attachment${attachmentCount !== 1 ? 's' : ''}`}>
          <div className="flex items-center gap-1 text-xs text-[#64748B]">
            <Paperclip size={14} className={attachmentCount === 0 ? 'text-[#CBD5E1]' : ''} />
            {attachmentCount === 0 ? <span className="text-[#94A3B8]">None</span> : <span>{attachmentCount}</span>}
          </div>
        </Tooltip>
      </div>

      {/* People — a single clean line: who assigned it (muted) + the assignee
          avatars, or a "Self" tag when it's a task you assigned to yourself. */}
      <div className="shrink-0 flex items-center gap-2 justify-end max-w-[240px]">
        {showAssigner && (
          <Tooltip label={`Assigned by ${assignerName}`}>
            <span className="text-[11px] text-[#94A3B8] truncate max-w-[120px]">
              by {assignerName}
            </span>
          </Tooltip>
        )}
        {otherPeople.length > 0 ? (
          <AssigneeAvatars people={otherPeople} max={3} size="sm" />
        ) : !showAssigner ? (
          <span className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
            Self
          </span>
        ) : null}
      </div>

      {/* Deadline */}
      {task.deadline && (
        <div className={`shrink-0 flex items-center gap-1 text-xs ${deadlineClass(task.deadline)}`}>
          <Calendar size={12} />
          <span>{formatDeadline(task.deadline)}</span>
        </div>
      )}

      {/* Overdue — a red flag when the deadline has passed and the task is still
          open. Orthogonal to status, so it rides alongside the status pill. */}
      {task.is_overdue && (
        <div className="shrink-0">
          <span className="inline-flex items-center gap-1 rounded-[999px] px-2 py-0.5 text-[11px] font-medium bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]">
            <AlertTriangle size={11} />
            Overdue
          </span>
        </div>
      )}

      {/* Priority — moved out of the title sub-row to sit alongside the deadline
          and status in the right-hand meta cluster. */}
      {priority && (
        <div className="shrink-0">
          <span
            className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: priority.color + '22',
              color: priority.color,
              border: `1px solid ${priority.color}44`,
            }}
          >
            {priority.label}
          </span>
        </div>
      )}

      {/* Status — interactive control for open states only; terminal states are a
          read-only pill (close/reopen happens via actions on the task). */}
      {status && (
        (onStatusChange || onComplete || onMarkIncomplete) && !isTerminalStatus ? (
          <StatusControl
            status={status}
            statuses={openStatuses}
            onChange={onStatusChange}
            onComplete={onComplete}
            onMarkIncomplete={onMarkIncomplete}
          />
        ) : (
          <div className="shrink-0">
            <span
              className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: status.color + '22',
                color: status.color,
                border: `1px solid ${status.color}44`,
              }}
            >
              {status.label}
            </span>
          </div>
        )
      )}
    </div>
  )
}
