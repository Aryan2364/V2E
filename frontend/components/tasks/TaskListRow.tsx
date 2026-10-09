'use client'

import React from 'react'
import { MessageSquare, Paperclip } from 'lucide-react'
import { getNow } from '@/lib/clock'
import type { Task, TaskPriority, TaskStatus, TaskCategory } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import AssigneeAvatars, { type AvatarPerson } from './AssigneeAvatars'
import { StatusControl } from './TaskCard'
import Tooltip from '@/components/ui/Tooltip'
import TagList from './TagList'
import WorkflowTaskBadge, { taskWorkflow } from './WorkflowTaskBadge'

interface TaskListRowProps {
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
  currentUserId?: string
  /** How the trailing deadline reads: just the time (when rows sit under a date header)
   *  or the full date (in a flat, ungrouped list). */
  deadlineDisplay?: 'time' | 'date'
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole days a still-open task is past its deadline (min 1). */
function overdueDays(deadline: string): number {
  const diff = Math.round((startOfDay(getNow()) - startOfDay(new Date(deadline))) / 86_400_000)
  return Math.max(1, diff)
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskListRow({
  task,
  onClick,
  priorities,
  statuses,
  categories,
  onStatusChange,
  onComplete,
  onMarkIncomplete,
  currentUserId,
  deadlineDisplay = 'date',
}: TaskListRowProps) {
  const priority = priorities.find((p) => p.id === task.priority_id)
  const status = statuses.find((s) => s.id === task.status_id) ?? task.status
  const category = categories.find((c) => c.id === task.category_id) ?? task.category

  const commentCount = task._count?.comments ?? 0
  const unread = task.unread_comments ?? 0
  const attachmentCount = task._count?.attachments ?? 0

  // A left accent bar carries urgency at a glance: red when overdue, else the
  // priority colour, else a neutral hairline.
  const accent = task.is_overdue ? '#DC2626' : priority?.color ?? '#CBD5E1'

  // The inline control only moves a task between OPEN states; terminal states show a
  // read-only pill (close / reopen happens via actions on the task) — same rule as TaskCard.
  const isTerminalStatus = !!status && TERMINAL_STATUS_PHASES.includes(status.type)
  const openStatuses = statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))

  // Who assigned it — hidden when the viewer is the assigner.
  // A workflow step's task isn't handed out by a person: its source is the workflow
  // instance (badge), never "Self" / "by <assigner>".
  const wf = taskWorkflow(task)
  const assignerName = task.created_by?.name ?? null
  const showAssigner = !wf && !!assignerName && task.created_by_user_id !== currentUserId

  // Everyone but the viewer (primary first, then CC), with name/dept/role for the tooltip.
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

  // Trailing deadline label: overdue → red "Overdue Nd"; due today → amber; otherwise muted.
  let deadlineNode: React.ReactNode = null
  if (task.deadline) {
    const d = new Date(task.deadline)
    if (task.is_overdue) {
      deadlineNode = (
        <span className="text-[13px] font-medium text-[#DC2626] whitespace-nowrap">
          Overdue {overdueDays(task.deadline)}d
        </span>
      )
    } else {
      const dueToday = startOfDay(d) === startOfDay(getNow())
      const text = deadlineDisplay === 'time' ? timeLabel(d) : `${dateLabel(d)}, ${timeLabel(d)}`
      deadlineNode = (
        <span className={`text-[13px] whitespace-nowrap ${dueToday ? 'text-[#D97706] font-medium' : 'text-[#475569]'}`}>
          {text}
        </span>
      )
    }
  }

  return (
    <div
      onClick={onClick}
      className="group flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[#F8FAFC] first:rounded-t-[11px] last:rounded-b-[11px]"
    >
      {/* Urgency accent */}
      <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ backgroundColor: accent }} />

      <div className="flex-1 min-w-0">
        {/* Line 1 — title + deadline */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium text-[#0F172A] truncate group-hover:text-[#2563EB] transition-colors">
            {task.title}
          </span>
          {deadlineNode}
        </div>

        {/* Line 2 — meta cluster + status */}
        <div className="flex items-center justify-between gap-3 mt-1.5">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0 text-[12px] text-[#475569]">
            {priority && (
              <span
                className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: priority.color + '22', color: priority.color, border: `1px solid ${priority.color}44` }}
              >
                {priority.label}
              </span>
            )}
            {category && (
              <span
                className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: category.color + '22', color: category.color, border: `1px solid ${category.color}44` }}
              >
                {category.name}
              </span>
            )}
            {/* Tags join priority + category as one classification cluster: at most two
                chips plus "+N", and nothing at all when the task has none. */}
            <TagList tags={task.tags} max={2} />

            {wf && <WorkflowTaskBadge workflow={wf} />}
            {showAssigner && (
              <Tooltip label={`Assigned by ${assignerName}`}>
                <span className="text-[11px] text-[#94A3B8] truncate max-w-[130px]">
                  by {assignerName}
                </span>
              </Tooltip>
            )}
            {otherPeople.length > 0 ? (
              <AssigneeAvatars people={otherPeople} max={3} size="sm" />
            ) : !showAssigner && !wf ? (
              <span className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
                Self
              </span>
            ) : null}

            {commentCount > 0 && (
              <Tooltip label={`${commentCount} comment${commentCount !== 1 ? 's' : ''}${unread > 0 ? ` · ${unread} unread` : ''}`}>
              <span className="inline-flex items-center gap-1">
                <span className="relative inline-flex shrink-0">
                  <MessageSquare size={14} className={unread > 0 ? 'text-[#2563EB]' : ''} />
                  {unread > 0 && (
                    <span className="absolute -top-2 -right-1.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-[#2563EB] text-white text-[9px] font-bold leading-none ring-2 ring-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span className={unread > 0 ? 'font-semibold text-[#2563EB]' : ''}>{commentCount}</span>
              </span>
              </Tooltip>
            )}
            {attachmentCount > 0 && (
              <Tooltip label={`${attachmentCount} attachment${attachmentCount !== 1 ? 's' : ''}`}>
                <span className="inline-flex items-center gap-1">
                  <Paperclip size={14} />
                  {attachmentCount}
                </span>
              </Tooltip>
            )}
          </div>

          {/* Status — interactive for open states, read-only pill once terminal. */}
          {status &&
            ((onStatusChange || onComplete || onMarkIncomplete) && !isTerminalStatus ? (
              <StatusControl
                status={status}
                statuses={openStatuses}
                onChange={onStatusChange}
                onComplete={onComplete}
                onMarkIncomplete={onMarkIncomplete}
              />
            ) : (
              <span
                className="shrink-0 inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: status.color + '22', color: status.color, border: `1px solid ${status.color}44` }}
              >
                {status.label}
              </span>
            ))}
        </div>
      </div>
    </div>
  )
}
