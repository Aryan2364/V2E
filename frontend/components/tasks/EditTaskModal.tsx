'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, History } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import StyledSelect from '@/components/ui/StyledSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import { PendingFileList, AttachmentList } from '@/components/ui/AttachmentList'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { tasksApi } from '@/lib/api/tasks'
import { holidaysApi } from '@/lib/api/holidays'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import type { Task, TaskCategory, TaskPriority, TaskStatus, CompletionMode, ChecklistTemplate, TaskAttachment, SelectedAssignee } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import type { HolidayCheckResult } from '@/lib/types/holidays'
import ChecklistBuilderField, {
  buildChecklistItems,
  groupsFromChecklistItems,
  type ChecklistGroup,
} from '@/components/tasks/ChecklistBuilderField'
import GoalSelectField from '@/components/tasks/GoalSelectField'
import ProofRequirementField from './ProofRequirementField'
import HolidayWarningBadge from '@/components/holidays/HolidayWarningBadge'
import LeaveWarningBadge from '@/components/leave/LeaveWarningBadge'
import { leaveApi } from '@/lib/api/leave'
import type { LeaveAvailability } from '@/lib/types/leave'
import { expandLeaveDays, leaveHorizon } from '@/lib/leave-availability'

interface Props {
  task: Task
  categories: TaskCategory[]
  priorities: TaskPriority[]
  statuses: TaskStatus[]
  onClose: () => void
  onSaved: (updated: Task) => void
}

// Format a stored UTC instant in the user's LOCAL date/time for the form inputs.
// (Slicing the raw ISO string would show UTC — wrong for IST users.)
const pad2 = (n: number) => String(n).padStart(2, '0')
const toLocalDateStr = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const toLocalTimeStr = (iso: string) => {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Order-independent signature of who is on a task and in which role — for the dirty check. */
const rosterSig = (r: { user_id: string; is_cc: boolean }[]) =>
  JSON.stringify(r.map((x) => `${x.user_id}:${x.is_cc ? 1 : 0}`).sort())

export default function EditTaskModal({ task, categories, priorities, statuses, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const { can, isAdmin } = usePermissions()
  const orgId = user?.organizationId ?? ''

  // ── Split rights (see the backend's updateTask for the authoritative rule) ──────
  // Reassigning the work and moving the deadline are assigner-level acts. Looping a
  // colleague in as CC is not — it changes nobody's workload and is trivially undone,
  // so anyone already on the task may do it. Gated on the real permission leaf, never
  // a hardcoded role: the creator and admins qualify, as does anyone holding
  // tasks.task.manage/edit. The backend re-checks (including data scope, which the
  // client can't evaluate) and returns a plain-language reason if it disagrees.
  const isCreator = task.created_by_user_id === user?.id
  const canReassign = isCreator || isAdmin || can('tasks.task.manage', 'edit')
  const isOnTask = (task.assignees ?? []).some((a) => a.user_id === user?.id)
  const canEditCc = canReassign || isOnTask

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [priorityId, setPriorityId] = useState(task.priority_id ?? '')
  const [categoryId, setCategoryId] = useState(task.category_id ?? '')
  const [statusId, setStatusId] = useState(task.status_id)
  // Terminal states (Complete / Incomplete) are managed via the task's actions, not
  // edited here — so a closed task shows its status read-only, and the picker only
  // offers open states.
  const currentStatus = statuses.find((s) => s.id === task.status_id)
  const taskIsTerminal = !!currentStatus && TERMINAL_STATUS_PHASES.includes(currentStatus.type)
  const openStatuses = statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))
  const [completionMode, setCompletionMode] = useState<CompletionMode>(task.completion_mode ?? 'any_can_complete')
  const [proofRequired, setProofRequired] = useState(task.proof_required ?? false)
  const [proofAllowedExtensions, setProofAllowedExtensions] = useState<string[]>(task.proof_allowed_extensions ?? [])
  const [goalId, setGoalId] = useState(task.goal_id ?? '')

  // Checklist — editable post-creation. Seeded from the task's existing items (each
  // carrying its id so unchanged items keep every assignee's tick/skip progress on
  // save). Frozen once the task is closed, mirroring the backend guard.
  const [checklistGroups, setChecklistGroups] = useState<ChecklistGroup[]>(() =>
    groupsFromChecklistItems(task.checklist),
  )
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([])
  const [checklistOpen, setChecklistOpen] = useState(false)
  // Signature of the checklist as loaded, to detect edits for the dirty check.
  const initialChecklistSig = React.useMemo(
    () => JSON.stringify(buildChecklistItems(groupsFromChecklistItems(task.checklist)) ?? []),
    [task.checklist],
  )

  // Load the checklist templates this user may apply (for "add from a template").
  useEffect(() => {
    if (!orgId || taskIsTerminal) return
    tasksApi.getAccessibleChecklistTemplates(orgId).then(setChecklistTemplates).catch(() => setChecklistTemplates([]))
  }, [orgId, taskIsTerminal])

  // Attachments — existing files load on open (each removable only by its uploader,
  // enforced server-side); new files are queued and uploaded on save.
  const [existingAttachments, setExistingAttachments] = useState<TaskAttachment[]>([])
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [deletingAttachmentIds, setDeletingAttachmentIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!orgId) return
    tasksApi.listAttachments(orgId, task.id).then(setExistingAttachments).catch(() => setExistingAttachments([]))
  }, [orgId, task.id])
  const [deadlineDate, setDeadlineDate] = useState(() => task.deadline ? toLocalDateStr(task.deadline) : '')
  const [deadlineTime, setDeadlineTime] = useState(() => task.deadline ? toLocalTimeStr(task.deadline) : '')
  const todayStr = new Date().toISOString().split('T')[0]
  // Convert the user's local date+time to an ISO instant so the backend stores the
  // exact moment regardless of the server's timezone (EC2 runs UTC, local runs IST).
  const deadline = deadlineDate
    ? new Date(deadlineTime ? `${deadlineDate}T${deadlineTime}` : `${deadlineDate}T23:59`).toISOString()
    : ''

  // Optional note on WHY the deadline moved. Not mandatory — the reports grade
  // against the original date, so a revision can't buy a clean score and a forced
  // justification box would be friction with no integrity benefit.
  const [deadlineReason, setDeadlineReason] = useState('')
  const [revisionsOpen, setRevisionsOpen] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // In-app confirmations (DESIGN_RULES Part 7 — never a native browser dialog).
  const [discardOpen, setDiscardOpen] = useState(false)
  const [pendingAttachmentRemoval, setPendingAttachmentRemoval] = useState<TaskAttachment | null>(null)
  const [holidayPrompt, setHolidayPrompt] = useState<string | null>(null)
  const [holidayCheck, setHolidayCheck] = useState<HolidayCheckResult | null>(null)
  // The system suggests a non-working-day adjustment; the user may override it.
  const [holidayOverride, setHolidayOverride] = useState(false)
  const holidayDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [leaveAvail, setLeaveAvail] = useState<LeaveAvailability | null>(null)
  // Portal target only exists on the client — guard against SSR mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // The task's people, now editable here rather than only on the detail page.
  // AssigneeSelector carries both roles in one list (CC is a toggle on a selected
  // chip), which is also how the backend reconcile wants them.
  const [roster, setRoster] = useState<SelectedAssignee[]>(() =>
    (task.assignees ?? []).map((a) => ({
      user_id: a.user_id,
      name: a.user?.name ?? a.user_name ?? 'Unknown',
      is_cc: a.is_cc,
    })),
  )
  const initialRosterSig = React.useMemo(
    () => rosterSig((task.assignees ?? []).map((a) => ({ user_id: a.user_id, is_cc: a.is_cc }))),
    [task.assignees],
  )

  const primaryAssignees = roster.filter((a) => !a.is_cc)
  const ccAssignees = roster.filter((a) => a.is_cc)
  const assigneeCount = primaryAssignees.length
  // Derived from the LIVE edit, so the leave warning and the completion-mode control
  // react as people are added or removed — not just to whoever was on it at open.
  const primaryIdsKey = primaryAssignees.map((a) => a.user_id).sort().join(',')

  // Warn if the task's existing assignees are on leave around the (possibly changed) deadline.
  useEffect(() => {
    const ids = primaryIdsKey ? primaryIdsKey.split(',') : []
    if (ids.length === 0 || !orgId) { setLeaveAvail(null); return }
    let cancelled = false
    leaveApi
      .availability(orgId, ids, todayStr, leaveHorizon())
      .then((res) => { if (!cancelled) setLeaveAvail(res) })
      .catch(() => { if (!cancelled) setLeaveAvail(null) })
    return () => { cancelled = true }
  }, [primaryIdsKey, orgId, todayStr])

  const leaveMarkedDays = React.useMemo(
    () => expandLeaveDays(leaveAvail, todayStr, leaveHorizon()),
    [leaveAvail, todayStr],
  )

  useEffect(() => {
    if (holidayDebounceRef.current) clearTimeout(holidayDebounceRef.current)
    // A new deadline is a fresh decision — clear any prior override.
    setHolidayOverride(false)
    if (!deadlineDate || !orgId) { setHolidayCheck(null); return }
    holidayDebounceRef.current = setTimeout(async () => {
      try { setHolidayCheck(await holidaysApi.checkDate(orgId, deadlineDate)) }
      catch { setHolidayCheck(null) }
    }, 300)
    return () => { if (holidayDebounceRef.current) clearTimeout(holidayDebounceRef.current) }
  }, [deadlineDate, orgId])

  useEffect(() => {
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') handleCloseAttempt() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  })

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Surface the backend's real reason (e.g. an inactive category, an ineligible
  // assignee) instead of a generic message — the same convention as CreateTaskModal.
  function apiErrorMessage(e: unknown, fallback: string): string {
    const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
    if (Array.isArray(m)) return m[0] ?? fallback
    return typeof m === 'string' && m ? m : fallback
  }

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    priorityId !== (task.priority_id ?? '') ||
    categoryId !== (task.category_id ?? '') ||
    (!taskIsTerminal && statusId !== task.status_id) ||
    deadline !== (task.deadline ?? '') ||
    completionMode !== (task.completion_mode ?? 'any_can_complete') ||
    proofRequired !== (task.proof_required ?? false) ||
    goalId !== (task.goal_id ?? '') ||
    attachmentFiles.length > 0 ||
    (!taskIsTerminal && rosterSig(roster) !== initialRosterSig) ||
    deadlineReason.trim() !== '' ||
    (!taskIsTerminal && JSON.stringify(buildChecklistItems(checklistGroups) ?? []) !== initialChecklistSig)

  function handleCloseAttempt() {
    if (isDirty) { setDiscardOpen(true); return }
    onClose()
  }

  function handleDownloadAttachment(a: TaskAttachment) {
    tasksApi.downloadAttachment(orgId, task.id, a.id).catch(() => {
      setError('Could not open that file. Please try again.')
    })
  }

  // Removing an existing attachment takes effect immediately (server allows the
  // uploader only). It's a file the user chose to delete — no "Save" needed.
  async function handleRemoveExistingAttachment(a: TaskAttachment) {
    if (deletingAttachmentIds.has(a.id)) return
    setPendingAttachmentRemoval(a)
  }

  async function confirmRemoveAttachment() {
    const a = pendingAttachmentRemoval
    if (!a) return
    setDeletingAttachmentIds((prev) => new Set(prev).add(a.id))
    try {
      await tasksApi.deleteAttachment(orgId, task.id, a.id)
      setExistingAttachments((prev) => prev.filter((x) => x.id !== a.id))
      setPendingAttachmentRemoval(null)
    } catch (e2) {
      setError(apiErrorMessage(e2, 'Could not remove that file. Please try again.'))
      setPendingAttachmentRemoval(null)
    } finally {
      setDeletingAttachmentIds((prev) => { const n = new Set(prev); n.delete(a.id); return n })
    }
  }

  async function handleSubmit(e: React.FormEvent, holidayOverrideArg?: boolean) {
    e.preventDefault()
    const useHolidayOverride = holidayOverrideArg ?? holidayOverride
    if (!title.trim()) { setError('Title is required.'); return }
    if (!deadlineDate) { setError('Deadline is required.'); return }
    // Mirrors the backend rule, caught here so the user isn't bounced by a 400.
    if (!taskIsTerminal && canReassign && primaryAssignees.length === 0) {
      setError('A task needs at least one assignee. Add someone to do the work, or make a CC an assignee.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const updated = await tasksApi.updateTask(orgId, task.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority_id: priorityId || undefined,
        category_id: categoryId || undefined,
        // Don't touch status for a closed task — that's the Reopen action's job.
        status_id: taskIsTerminal ? undefined : (statusId || undefined),
        deadline: deadline || undefined,
        holiday_override: useHolidayOverride,
        completion_mode: completionMode,
        proof_required: proofRequired,
        proof_allowed_extensions: proofRequired ? proofAllowedExtensions : [],
        goal_id: goalId || undefined,
        // Only send a reason when the date actually moved off an existing one —
        // otherwise it's a note attached to nothing.
        ...(task.deadline && deadline !== task.deadline && deadlineReason.trim()
          ? { deadline_reason: deadlineReason.trim() }
          : {}),
        // Roster + checklist edits only apply to an open task (the backend freezes
        // both once closed). Send only the lists this user is allowed to change:
        // omitting a list leaves that group untouched, so a plain assignee's CC-only
        // save cannot disturb who is doing the work.
        ...(taskIsTerminal
          ? {}
          : {
              ...(canReassign
                ? {
                    assignee_user_ids: primaryAssignees.map((a) => a.user_id),
                    cc_user_ids: ccAssignees.map((a) => a.user_id),
                  }
                : canEditCc
                  ? { cc_user_ids: ccAssignees.map((a) => a.user_id) }
                  : {}),
              checklist_items: buildChecklistItems(checklistGroups) ?? [],
              checklist_template_ids: Array.from(
                new Set(checklistGroups.filter((g) => g.templateId).map((g) => g.templateId as string)),
              ),
            }),
      } as any)
      // Upload any newly-queued files after the field update lands. Sequential so a
      // partial failure is easy to surface without losing the rest of the edit.
      if (attachmentFiles.length > 0) {
        try {
          for (const file of attachmentFiles) {
            await tasksApi.uploadTaskAttachment(orgId, task.id, file)
          }
          setAttachmentFiles([])
        } catch {
          setError('Your changes were saved, but a file failed to upload. Reopen the task to add it again.')
          onSaved(updated)
          return
        }
      }
      onSaved(updated)
    } catch (e2) {
      const msg = apiErrorMessage(e2, 'Failed to save changes. Please try again.')
      // The holiday rule never forces itself — if this is the holiday rejection,
      // offer to keep the date as-is instead of just failing. Styled dialog, not a
      // native confirm (DESIGN_RULES Part 7).
      if (/non-working day/i.test(msg)) {
        setHolidayPrompt(msg)
        return
      }
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  /** Re-save with the holiday rule explicitly overridden, keeping the chosen date. */
  async function keepHolidayDateAnyway() {
    setHolidayPrompt(null)
    setHolidayOverride(true)
    await handleSubmit({ preventDefault: () => {} } as React.FormEvent, true)
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleCloseAttempt() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-task-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#E2E8F0] shrink-0">
          <h2 id="edit-task-modal-title" className="text-[22px] font-semibold text-[#0F172A]">Edit Task</h2>
          <button onClick={handleCloseAttempt} className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Title <span className="text-[#DC2626]">*</span></label>
            <div className="relative">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                maxLength={50}
                className="w-full border border-[#CBD5E1] rounded-[8px] pl-3 pr-14 py-[10px] text-base sm:text-sm text-[#0F172A] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white"
              />
              <span className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${title.length >= 50 ? 'text-[#DC2626]' : 'text-[#94A3B8]'}`}>
                {title.length}/50
              </span>
            </div>
          </div>

          {/* Assignees & CC — finally where you'd look for them, rather than only on
              the detail page. One list carries both roles: click a person's chip to
              flip them between Assignee and CC. A flip is an in-place role change on
              the server, so that person keeps their status and checklist progress. */}
          {(canReassign || canEditCc) && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-[#374151]">
                  Assignees &amp; CC <span className="text-[#DC2626]">*</span>
                </label>
                {roster.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
                    {roster.length}
                  </span>
                )}
              </div>

              {taskIsTerminal ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {roster.map((a) => (
                      <span
                        key={a.user_id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] pl-2 pr-2.5 py-1 text-[13px] text-[#1E293B]"
                      >
                        {a.name}
                        {a.is_cc && (
                          <span className="text-[10px] font-semibold text-[#0369A1] bg-[#E0F2FE] border border-[#BAE6FD] rounded-full px-1.5">
                            CC
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#475569] mt-1.5">
                    This task is closed, so its people are a frozen record. Reopen it to change who is on it.
                  </p>
                </>
              ) : canReassign ? (
                <>
                  <AssigneeSelector
                    orgId={orgId}
                    value={roster}
                    onChange={setRoster}
                    disabled={submitting}
                    currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                  />
                  <p className="text-[11px] text-[#475569] mt-1">
                    Add or remove people · click their badge to toggle between Assignee and CC
                  </p>
                </>
              ) : (
                /* Split rights: this user may loop people in as CC but not reassign
                   the work, so the working assignees stay read-only and only the CC
                   list is editable. */
                <>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {primaryAssignees.map((a) => (
                      <span
                        key={a.user_id}
                        className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[13px] text-[#1E293B]"
                      >
                        {a.name}
                      </span>
                    ))}
                  </div>
                  <AssigneeSelector
                    orgId={orgId}
                    value={ccAssignees}
                    onChange={(next) =>
                      setRoster([...primaryAssignees, ...next.map((x) => ({ ...x, is_cc: true }))])
                    }
                    disabled={submitting}
                    currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                  />
                  <p className="text-[11px] text-[#475569] mt-1">
                    You can CC people in on this task. Changing who it&apos;s assigned to is up to{' '}
                    {task.created_by?.name ?? 'whoever assigned it'}.
                  </p>
                </>
              )}

              {/* People taken off the task. Removal is soft on purpose — the record
                  that someone held this task survives, so a person who was already
                  late can't be quietly removed into a clean scorecard. */}
              {(task.removed_assignees?.length ?? 0) > 0 && (
                <div className="mt-2.5 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#475569] mb-1">Previously on this task</p>
                  <ul className="space-y-0.5">
                    {task.removed_assignees!.map((a) => (
                      <li key={a.id} className="text-[12px] text-[#475569]">
                        <span className="text-[#1E293B]">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                        {a.is_cc ? ' (CC)' : ''}
                        {a.removed_at ? ` · removed ${fmtDate(a.removed_at)}` : ''}
                        {a.removed_by?.name ? ` by ${a.removed_by.name}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Completion mode */}
          {assigneeCount > 1 && (
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-2">Completion Mode</label>
              <div className="flex gap-3">
                {(['any_can_complete', 'all_must_complete'] as CompletionMode[]).map((mode) => (
                  <label key={mode} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="completionMode" value={mode} checked={completionMode === mode} onChange={() => setCompletionMode(mode)} className="accent-[#2563EB]" />
                    <span className="text-sm text-[#1E293B]">{mode === 'any_can_complete' ? 'Any assignee can complete' : 'All assignees must complete'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Deadline */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[#374151]">Deadline <span className="text-[#DC2626]">*</span></label>
              {deadlineDate && (
                <button type="button" onClick={() => { setDeadlineDate(''); setDeadlineTime('') }} className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#DC2626] transition-colors">
                  <X size={10} /> Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {/* Date picker — shared calendar component (opens on click) */}
              <div className="flex-1">
                <DatePicker
                  value={deadlineDate}
                  onChange={(iso) => {
                    if (!iso) { setDeadlineDate(''); setDeadlineTime(''); return }
                    setDeadlineDate(iso)
                    if (!deadlineTime) setDeadlineTime('23:59')
                  }}
                  min={todayStr}
                  max="2100-12-31"
                  placeholder="Select date"
                  markedDates={leaveMarkedDays}
                  markedHint="An assignee is on leave"
                />
              </div>
              {/* Time picker — always present, disabled until a date is picked */}
              <div className="flex-1">
                <TimeField
                  value={deadlineTime}
                  onChange={setDeadlineTime}
                  disabled={!deadlineDate}
                  label="Deadline time"
                />
              </div>
            </div>
            <HolidayWarningBadge
              check={holidayCheck}
              overridden={holidayOverride}
              onToggleOverride={setHolidayOverride}
            />
            {deadlineDate && <LeaveWarningBadge availability={leaveAvail} deadline={deadlineDate} today={todayStr} />}

            {/* The compliance baseline. On-time vs late is graded against the date
                this task was FIRST committed to, not the live one — so moving a
                deadline is allowed and visible, but never rewrites history. Saying so
                here is the point: it's what stops a revision feeling like a loophole. */}
            {(task.deadline_revision_count ?? 0) > 0 && task.original_deadline && (
              <div className="mt-2 rounded-[8px] border border-[#FDE68A] bg-[#FEF9C3] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] text-[#713F12]">
                    Originally due <strong className="font-semibold">{fmtDate(task.original_deadline)}</strong>
                    {' · '}revised {task.deadline_revision_count}
                    {task.deadline_revision_count === 1 ? ' time' : ' times'}.
                    <br />
                    Compliance reporting grades this task against the original date.
                  </p>
                  {(task.deadline_revisions?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setRevisionsOpen((v) => !v)}
                      aria-expanded={revisionsOpen}
                      className="flex items-center gap-1 shrink-0 text-[11px] font-semibold text-[#713F12] hover:text-[#0F172A] transition-colors"
                    >
                      <History size={12} />
                      {revisionsOpen ? 'Hide' : 'History'}
                    </button>
                  )}
                </div>
                {revisionsOpen && (
                  <ul className="mt-2 space-y-1 border-t border-[#FDE68A] pt-2 max-h-[160px] overflow-y-auto">
                    {task.deadline_revisions!.map((r) => (
                      <li key={r.id} className="text-[11px] text-[#713F12]">
                        {r.from_deadline ? fmtDate(r.from_deadline) : 'no deadline'} →{' '}
                        {r.to_deadline ? fmtDate(r.to_deadline) : 'no deadline'}
                        {r.changed_by?.name ? ` · ${r.changed_by.name}` : ''}
                        {' · '}
                        {fmtDate(r.changed_at)}
                        {r.reason ? <span className="block italic">“{r.reason}”</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Optional reason, shown only once the date has actually been moved off
                an existing one — a note attached to nothing is just noise. */}
            {task.deadline && deadline !== task.deadline && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-[#374151] mb-1.5">
                  Why is the deadline changing? <span className="text-[#475569] font-normal">Optional</span>
                </label>
                <input
                  type="text"
                  value={deadlineReason}
                  onChange={(e) => setDeadlineReason(e.target.value.slice(0, 500))}
                  maxLength={500}
                  placeholder="e.g. client pushed the review to next week"
                  className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-[10px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white"
                />
                <p className="text-[11px] text-[#475569] mt-1">
                  Recorded against this change, and everyone on the task is told the date moved.
                </p>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                maxLength={2000}
                rows={3}
                className="w-full border border-[#CBD5E1] rounded-[8px] px-3 pt-[10px] pb-6 text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white resize-none"
              />
              <span className={`pointer-events-none absolute right-3 bottom-2 text-[11px] ${description.length >= 2000 ? 'text-[#DC2626]' : 'text-[#94A3B8]'}`}>
                {description.length}/2000
              </span>
            </div>
          </div>

          {/* Priority + Category + Status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
              <StyledSelect
                value={priorityId}
                onChange={(v) => setPriorityId(v)}
                placeholder="No priority"
                options={[
                  { value: '', label: 'No priority' },
                  ...priorities.map((p) => ({ value: p.id, label: p.label, color: p.color })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Category</label>
              <StyledSelect
                value={categoryId}
                onChange={(v) => setCategoryId(v)}
                placeholder="No category"
                options={[
                  { value: '', label: 'No category' },
                  ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
              {taskIsTerminal && currentStatus ? (
                <div className="flex items-center h-[42px]">
                  <span
                    className="inline-flex items-center rounded-[999px] px-3 py-1 text-sm font-medium"
                    style={{ backgroundColor: currentStatus.color + '22', color: currentStatus.color, border: `1px solid ${currentStatus.color}44` }}
                  >
                    {currentStatus.label}
                  </span>
                </div>
              ) : (
                <StyledSelect
                  value={statusId}
                  onChange={(v) => setStatusId(v)}
                  options={openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                />
              )}
            </div>
          </div>

          {/* Proof required + allowed file types */}
          <ProofRequirementField
            proofRequired={proofRequired}
            onProofRequiredChange={setProofRequired}
            allowedExtensions={proofAllowedExtensions}
            onAllowedExtensionsChange={setProofAllowedExtensions}
          />

          {/* Link to goal — re-link or unlink the quarterly goal this task counts
              toward. Hidden when the org has no goals. */}
          <GoalSelectField orgId={orgId} value={goalId} onChange={setGoalId} />

          {/* Checklist — add, edit or remove items. Editing an item keeps every
              assignee's existing tick/skip; removing one clears it. Hidden once the
              task is closed (the checklist is then a frozen record). */}
          {!taskIsTerminal && (
            <ChecklistBuilderField
              groups={checklistGroups}
              onChange={setChecklistGroups}
              templates={checklistTemplates}
              open={checklistOpen}
              onOpenChange={setChecklistOpen}
            />
          )}

          {/* Attachments — existing files (removable by their uploader) plus a
              dropzone to add more. Collapsed by default; the badge counts existing +
              queued. Adding a file uploads on Save; removing one deletes immediately. */}
          <div>
            <div className="rounded-[12px] border border-[#E2E8F0] bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setAttachmentsOpen((v) => !v)}
                aria-expanded={attachmentsOpen}
                className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-[#F8FAFC] transition-colors"
              >
                <label className="text-sm font-medium text-[#374151] cursor-pointer">Attachments</label>
                <span className="text-xs font-normal text-[#475569]">Optional</span>
                {existingAttachments.length + attachmentFiles.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
                    {existingAttachments.length + attachmentFiles.length}
                  </span>
                )}
                <span
                  className={['ml-auto flex items-center justify-center w-6 h-6 rounded-[6px] text-[#2563EB] transition-transform', attachmentsOpen ? 'rotate-45' : ''].join(' ')}
                  aria-hidden
                >
                  <Plus size={18} />
                </span>
              </button>
              {attachmentsOpen && (
                <div className="px-3 pb-3 pt-0 space-y-2">
                  <FileDropzone
                    onFiles={(fs) => setAttachmentFiles((prev) => [...prev, ...fs])}
                    onReject={setAttachErrors}
                    disabled={submitting}
                  />
                  {(attachErrors.length > 0 || existingAttachments.length > 0 || attachmentFiles.length > 0) && (
                    <div className="max-h-[260px] overflow-y-auto space-y-2">
                      {attachErrors.length > 0 && (
                        <AttachmentErrorBox errors={attachErrors} onDismiss={() => setAttachErrors([])} />
                      )}
                      {/* Already-uploaded files — remove is uploader-only (server-enforced). */}
                      <AttachmentList
                        attachments={existingAttachments}
                        onDownload={handleDownloadAttachment}
                        onRemove={handleRemoveExistingAttachment}
                        canRemove={(a) => a.uploaded_by_user_id === user?.id}
                      />
                      {/* Newly-queued files — uploaded on Save. */}
                      <PendingFileList
                        files={attachmentFiles}
                        uploading={submitting && attachmentFiles.length > 0}
                        onRemove={(idx) => setAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Footer — no Cancel button; the header X / Escape / backdrop close the modal.
            Error sits here so it's always visible next to Save, not hidden above
            the fold when the form is scrolled down. */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E2E8F0] space-y-3">
          {error && (
            <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3 text-sm text-[#DC2626]">{error}</div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full sm:w-auto px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Styled confirmations — never a native browser dialog (DESIGN_RULES Part 7). */}
      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        message="Your edits to this task haven't been saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={() => { setDiscardOpen(false); onClose() }}
        onCancel={() => setDiscardOpen(false)}
      />

      <ConfirmDialog
        open={!!pendingAttachmentRemoval}
        title="Remove this file?"
        message={
          pendingAttachmentRemoval
            ? `“${pendingAttachmentRemoval.file_name}” will be deleted for everyone on the task.`
            : undefined
        }
        confirmLabel="Remove"
        danger
        loading={!!pendingAttachmentRemoval && deletingAttachmentIds.has(pendingAttachmentRemoval.id)}
        onConfirm={confirmRemoveAttachment}
        onCancel={() => setPendingAttachmentRemoval(null)}
      />

      {/* The holiday rule suggests, it never forces — so a rejected date offers to
          stand rather than just failing (no dead end). */}
      <ConfirmDialog
        open={!!holidayPrompt}
        title="Keep this date anyway?"
        message={holidayPrompt ?? undefined}
        confirmLabel="Keep the date"
        cancelLabel="Pick another"
        onConfirm={keepHolidayDateAnyway}
        onCancel={() => { setHolidayPrompt(null); setError(null) }}
      />
    </div>,
    document.body,
  )
}
