'use client'

import React from 'react'
import { Calendar, ArrowRight, Repeat, Check } from 'lucide-react'
import { getNow } from '@/lib/clock'
import type { Task } from '@/lib/types/tasks'
import AssigneeAvatars, { type AvatarPerson } from '@/components/tasks/AssigneeAvatars'
import TagList from '@/components/tasks/TagList'
import WorkflowTaskBadge, { taskWorkflow } from '@/components/tasks/WorkflowTaskBadge'

// ─── Deadline helpers (mirror TaskCard) ─────────────────────────────────────────

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

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[999px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────────

/**
 * Dense, dashboard-grade task row: priority rail, title, assigner → assignees,
 * category + priority + tag chips, status, and a colour-coded deadline. Built for high information
 * density across the result surface and drill-down panels.
 */
export default function TaskRow({
  task,
  onClick,
  selectable,
  selected,
  onToggleSelect,
}: {
  task: Task
  onClick: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const priority = task.priority
  const status = task.status
  const category = task.category
  // A workflow step's task: its source is the workflow instance, not the step's assigner.
  const wf = taskWorkflow(task)
  const assigner = wf ? null : task.created_by?.name

  const people: AvatarPerson[] = [...(task.assignees ?? [])]
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
      className={`bg-white border rounded-[10px] px-4 py-3 flex items-center gap-3 sm:gap-4 cursor-pointer hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-150 group ${selected ? 'border-[#2563EB] ring-1 ring-[#2563EB]' : 'border-[#E2E8F0] hover:border-[#2563EB]'}`}
    >
      {/* Selection checkbox */}
      {selectable && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.() }}
          className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-[#2563EB] border-[#2563EB]' : 'border-[#CBD5E1] hover:border-[#2563EB] bg-white'}`}
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          {selected && <Check size={12} className="text-white" />}
        </button>
      )}

      {/* Priority rail */}
      <span
        className="w-1 self-stretch rounded-full shrink-0"
        style={{ backgroundColor: priority?.color ?? '#CBD5E1' }}
      />

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-[#0F172A] truncate group-hover:text-[#2563EB] transition-colors">
            {task.title}
          </p>
          {task.type === 'recurring' && (
            <Repeat size={12} className="text-[#0891B2] shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {category && <Chip label={category.name} color={category.color} />}
          {priority && <Chip label={priority.label} color={priority.color} />}
          {/* Tags: two chips, then "+N" (kit §11.6 card budget). Clicks never open the row. */}
          <TagList tags={task.tags} max={2} />
          {wf && <WorkflowTaskBadge workflow={wf} />}
          {assigner && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#475569]">
              <span className="text-[#94A3B8]">by</span>
              <span className="font-medium text-[#334155]">{assigner}</span>
              <ArrowRight size={10} className="text-[#94A3B8]" />
            </span>
          )}
        </div>
      </div>

      {/* Assignees */}
      <div className="shrink-0 hidden sm:flex items-center">
        {people.length > 0 && <AssigneeAvatars people={people} max={3} size="sm" />}
      </div>

      {/* Deadline */}
      {task.deadline && (
        <div className={`shrink-0 hidden md:flex items-center gap-1 text-xs ${deadlineClass(task.deadline)}`}>
          <Calendar size={12} />
          <span className="whitespace-nowrap">{formatDeadline(task.deadline)}</span>
        </div>
      )}

      {/* Status */}
      {status && (
        <div className="shrink-0">
          <Chip label={status.label} color={status.color} />
        </div>
      )}
    </div>
  )
}
