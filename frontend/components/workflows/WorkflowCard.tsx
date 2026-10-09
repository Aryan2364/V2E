'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, CalendarClock, Eye, ListChecks, Pause, Pencil, Play, History, Users, Workflow as WorkflowIcon } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import type { WorkflowTemplate } from '@/lib/types/workflows'
import ActionMenu, { type ActionMenuItem } from './ActionMenu'
import {
  REASONS,
  TemplateStatusBadge,
  editHref,
  fmtDate,
  fmtDateTime,
  gate,
  namesSummary,
  plural,
  recurrenceLabel,
  instancesHref,
  startGate,
  startsSummary,
  workflowHref,
} from './shared'

interface Props {
  workflow: WorkflowTemplate
  writable: boolean | undefined
  onStart: (w: WorkflowTemplate) => void
  onArchive: (w: WorkflowTemplate) => void
  onRestore: (w: WorkflowTemplate) => void
  onPause?: (w: WorkflowTemplate) => void
  onResume?: (w: WorkflowTemplate) => void
}

/**
 * A workflow as a record card: the whole card opens the workflow page. The three-dot menu holds the other actions, each gated on the
 * server's capabilities and the org's write switch.
 */
export default function WorkflowCard({ workflow: w, writable, onStart, onArchive, onRestore, onPause, onResume }: Props) {
  const router = useRouter()
  const caps = w.capabilities
  const edit = gate(caps?.can_edit, writable, REASONS.edit)
  const start = startGate(w, writable)

  const items: ActionMenuItem[] = [
    { key: 'open', label: 'Open workflow', icon: Eye, onSelect: () => router.push(workflowHref(w.id)) },
    {
      key: 'edit',
      label: 'Edit workflow',
      icon: Pencil,
      allowed: edit.allowed,
      reason: edit.reason,
      onSelect: () => router.push(editHref(w.id)),
      hidden: w.status === 'archived',
    },
    {
      key: 'start',
      label: 'Run workflow',
      icon: Play,
      allowed: start.allowed,
      reason: start.reason,
      onSelect: () => onStart(w),
      hidden: start.hidden,
    },
    {
      key: 'pause',
      label: 'Pause workflow',
      icon: Pause,
      allowed: edit.allowed,
      reason: edit.reason,
      onSelect: () => onPause?.(w),
      hidden: w.status !== 'active' || !onPause,
    },
    {
      key: 'resume',
      label: 'Resume workflow',
      icon: Play,
      allowed: edit.allowed,
      reason: edit.reason,
      onSelect: () => onResume?.(w),
      hidden: w.status !== 'paused' || !onResume,
    },
    { key: 'instances', label: 'View instances', icon: History, onSelect: () => router.push(instancesHref(w.id)) },
    {
      key: 'archive',
      label: 'Archive workflow',
      icon: Archive,
      danger: true,
      allowed: edit.allowed,
      reason: edit.reason,
      onSelect: () => onArchive(w),
      hidden: w.status === 'archived',
    },
    {
      key: 'restore',
      label: 'Restore workflow',
      icon: ArchiveRestore,
      allowed: edit.allowed,
      reason: edit.reason,
      onSelect: () => onRestore(w),
      hidden: w.status !== 'archived',
    },
  ]

  const running = w._count?.running_instances ?? 0
  // Who can change it: its editors (the creator first), else the creator alone.
  const editors = w.people?.editors?.length ? w.people.editors : w.created_by ? [w.created_by] : w.owners ?? []
  const steps = w._count?.steps ?? w.steps?.length ?? 0

  return (
    <div className="group relative h-full bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:border-[#93C5FD] hover:shadow-[0_4px_14px_rgba(15,23,42,0.08)] transition-[box-shadow,border-color] duration-150 p-5 flex flex-col gap-3 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-[#2563EB]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-[#EFF6FF] flex items-center justify-center shrink-0">
          <WorkflowIcon size={18} className="text-[#2563EB]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[16px] font-semibold text-[#0F172A] leading-snug">
            {/* Stretched link: the whole card opens the workflow; the menu sits above it. */}
            <Link
              href={workflowHref(w.id)}
              className="line-clamp-2 break-words focus:outline-none after:absolute after:inset-0 after:rounded-[12px] after:content-['']"
            >
              {w.name}
            </Link>
          </h3>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <TemplateStatusBadge status={w.status} />
          </div>
        </div>
        <div className="relative z-10 -mr-2 -mt-1">
          <ActionMenu items={items} label={`Actions for ${w.name}`} />
        </div>
      </div>

      <p className="text-[14px] text-[#475569] line-clamp-2 min-h-[42px] break-words">
        {w.description || <span className="text-[#64748B]">No description</span>}
      </p>

      <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[13px] text-[#334155]">
        {/* A limited card (you run it or work in it, but can't see its design) has no step count. */}
        {w.view !== 'limited' && (
          <span className="inline-flex items-center gap-1.5">
            <ListChecks size={14} className="text-[#475569]" />
            {plural(steps, 'step')}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <History size={14} className="text-[#475569]" />
          {running > 0 ? `${running} running` : plural(w._count?.instances ?? 0, 'instance')}
        </span>
        {(w.schedules ?? []).length > 0 && (
          <Tooltip label={`Starts: ${startsSummary(w)}`}>
            <span tabIndex={0} className="relative z-10 inline-flex items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
              <CalendarClock size={14} className="text-[#475569]" />
              {/* The schedule, said once: how it repeats, then when it next runs. */}
              {recurrenceLabel(w) ?? 'On a schedule'}
              {w.next_run_at ? ` · next ${fmtDateTime(w.next_run_at)}` : w.status === 'paused' ? ' · paused' : ''}
            </span>
          </Tooltip>
        )}
      </div>

      <div className="mt-auto pt-3 border-t border-[#F1F5F9] flex items-center justify-between gap-3 text-[13px] text-[#475569]">
        <Tooltip label="Editors">
          <span tabIndex={0} className="relative z-10 inline-flex items-center gap-1.5 min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
            <Users size={14} className="shrink-0" />
            <span className="truncate">{namesSummary(editors)}</span>
          </span>
        </Tooltip>
        <span className="shrink-0">Updated {fmtDate(w.updated_at)}</span>
      </div>
    </div>
  )
}

export function WorkflowCardSkeleton() {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-5 flex flex-col gap-3 animate-pulse motion-reduce:animate-none h-[228px]">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-[#F1F5F9]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-[#F1F5F9] rounded w-2/3" />
          <div className="h-4 bg-[#F1F5F9] rounded w-1/3" />
        </div>
      </div>
      <div className="h-3 bg-[#F1F5F9] rounded w-full" />
      <div className="h-3 bg-[#F1F5F9] rounded w-4/5" />
      <div className="mt-auto h-4 bg-[#F1F5F9] rounded w-1/2" />
    </div>
  )
}
