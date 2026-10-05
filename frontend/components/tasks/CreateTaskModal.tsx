'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X, Plus, Calendar, RotateCcw, CheckCircle2, FilePlus2, Table } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import StyledSelect from '@/components/ui/StyledSelect'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import { PendingFileList } from '@/components/ui/AttachmentList'
import ScheduleEntryList from '@/components/tasks/ScheduleEntryList'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import ChecklistBuilderField, { buildChecklistItems, type ChecklistGroup } from '@/components/tasks/ChecklistBuilderField'
import RemindersField, {
  makeReminderRow,
  buildReminderSpecs,
  validateRemindersAgainstDeadline,
  type ReminderRow,
} from '@/components/tasks/RemindersField'
import EscalationLevelsField from '@/components/tasks/EscalationLevelsField'
import GoalSelectField from '@/components/tasks/GoalSelectField'
import TagPicker from '@/components/tasks/TagPicker'
import { isListboxOpen } from '@/components/tasks/InlineTaskTags'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import { holidaysApi } from '@/lib/api/holidays'
import type { Task, TaskCategory, TaskPriority, TaskStatus, CompletionMode, ChecklistTemplate, RecurringTemplate } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import type { SelectedAssignee } from '@/lib/types/tasks'
import type { HolidayCheckResult } from '@/lib/types/holidays'
// import QuadrantBadge from './QuadrantBadge'
import AssigneeSelector from './AssigneeSelector'
import ImportTasksModal from './ImportTasksModal'
import ProofRequirementField from './ProofRequirementField'
import HolidayWarningBadge from '@/components/holidays/HolidayWarningBadge'
import LeaveWarningBadge from '@/components/leave/LeaveWarningBadge'
import { leaveApi } from '@/lib/api/leave'
import type { LeaveAvailability } from '@/lib/types/leave'
import { expandLeaveDays, leaveHorizon } from '@/lib/leave-availability'

// One-time = a single task with a fixed deadline. Recurring = a template that
// auto-spawns instances on a schedule (reuses the existing recurring engine).
type TaskMode = 'one_time' | 'recurring'

function defaultScheduleEntry(): ScheduleEntryDraft {
  return {
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: getNow().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

interface CreateTaskModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  onTaskCreated?: (task: Task) => void
  categories: TaskCategory[]
  priorities: TaskPriority[]
  statuses: TaskStatus[]
  /** Which schedule mode the modal opens in (default one-time). */
  initialMode?: TaskMode
  /** Hide the One-time/Recurring toggle — used by the Recurring page so its
      create button always produces a recurring task. */
  lockMode?: boolean
  /** Show the "Single task | Bulk upload" tab (bulk = the Excel import flow).
      Defaults on; the Recurring page (lockMode) never shows it. */
  allowBulk?: boolean
  /** Refresh-only callback fired after a bulk import commits — unlike onCreated it
      must NOT close the modal (the import flow shows its own result/undo screen). */
  onImported?: () => void
}

// const quadrants: { value: TaskQuadrant; label: string; sublabel: string }[] = [
//   { value: 'Q1', label: 'Q1', sublabel: 'Urgent + Important' },
//   { value: 'Q2', label: 'Q2', sublabel: 'Not Urgent + Important' },
//   { value: 'Q3', label: 'Q3', sublabel: 'Urgent + Not Important' },
//   { value: 'Q4', label: 'Q4', sublabel: 'Not Urgent + Not Important' },
// ]
// const quadrantColors: Record<TaskQuadrant, { bg: string; text: string; border: string; activeBg: string }> = {
//   Q1: { bg: 'bg-[#FEE2E2]', text: 'text-[#DC2626]', border: 'border-[#FECACA]', activeBg: 'bg-[#DC2626]' },
//   Q2: { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', border: 'border-[#BFDBFE]', activeBg: 'bg-[#2563EB]' },
//   Q3: { bg: 'bg-[#FEF9C3]', text: 'text-[#D97706]', border: 'border-[#FDE68A]', activeBg: 'bg-[#D97706]' },
//   Q4: { bg: 'bg-[#F3F4F6]', text: 'text-[#6B7280]', border: 'border-[#E5E7EB]', activeBg: 'bg-[#6B7280]' },
// }

export default function CreateTaskModal({
  isOpen,
  onClose,
  onCreated,
  onTaskCreated,
  categories,
  priorities,
  statuses,
  initialMode = 'one_time',
  lockMode = false,
  allowBulk = true,
  onImported,
}: CreateTaskModalProps) {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  // Single task (this form) vs Bulk upload (the Excel import flow). The recurring
  // page locks the mode, so bulk is never offered there.
  const showBulkTab = allowBulk && !lockMode
  const [tab, setTab] = useState<'single' | 'bulk'>('single')

  // One-time vs recurring. One-time is the default.
  const [mode, setMode] = useState<TaskMode>(initialMode)
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryDraft[]>([defaultScheduleEntry()])
  // Set once a recurring template is created — drives the success confirmation.
  const [createdRecurring, setCreatedRecurring] = useState<RecurringTemplate | null>(null)

  // A brand-new task can't start in a terminal state — hide completed/incomplete
  // from the picker (and from default selection).
  const selectableStatuses = statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // const [quadrant, setQuadrant] = useState<TaskQuadrant>('Q2')
  const [priorityId, setPriorityId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [statusId, setStatusId] = useState('')
  const [deadlineDate, setDeadlineDate] = useState('')
  const [deadlineTime, setDeadlineTime] = useState('')
  // Convert the user's local date+time to an ISO instant so the backend stores the
  // exact moment regardless of the server's timezone (EC2 runs UTC, local runs IST).
  const deadline = deadlineDate
    ? new Date(deadlineTime ? `${deadlineDate}T${deadlineTime}` : `${deadlineDate}T23:59`).toISOString()
    : ''
  const todayStr = getNow().toISOString().split('T')[0]
  const [completionMode, setCompletionMode] = useState<CompletionMode>('any_can_complete')
  const [proofRequired, setProofRequired] = useState(false)
  const [proofAllowedExtensions, setProofAllowedExtensions] = useState<string[]>([])
  // Ordered escalation contacts — alerted level by level once the task is overdue.
  const [escalationIds, setEscalationIds] = useState<string[]>([])
  // Optional quarterly goal the task (or every spawned instance) links to.
  const [goalId, setGoalId] = useState('')
  const [assignees, setAssignees] = useState<SelectedAssignee[]>([])
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])
  // Attachments are collapsed by default to save space — expand via the + button.
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  // Checklist is likewise collapsed by default — expand via the + button.
  const [checklistOpen, setChecklistOpen] = useState(false)
  // Reminders collapse to a read-only summary until expanded for editing.
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [checklistGroups, setChecklistGroups] = useState<ChecklistGroup[]>([])
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [holidayCheck, setHolidayCheck] = useState<HolidayCheckResult | null>(null)
  // When the deadline lands on a non-working day the system suggests an
  // adjustment; the user may override and keep their chosen date.
  const [holidayOverride, setHolidayOverride] = useState(false)
  const holidayDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [leaveAvail, setLeaveAvail] = useState<LeaveAvailability | null>(null)
  // Reminders — one seeded from the admin default on open, all editable/removable.
  const [reminders, setReminders] = useState<ReminderRow[]>([])

  // Portal target only exists on the client — guard against SSR mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Load the checklist templates this user is allowed to apply, when the modal opens.
  useEffect(() => {
    if (!isOpen || !orgId) return
    tasksApi.getAccessibleChecklistTemplates(orgId).then(setChecklistTemplates).catch(() => setChecklistTemplates([]))
  }, [isOpen, orgId])

  // On open, seed a single reminder from the admin default (removable).
  useEffect(() => {
    if (!isOpen || !orgId) return
    tasksApi.getConfig(orgId)
      .then((cfg) => setReminders([makeReminderRow({ offsetDays: cfg?.default_reminder_days_before ?? 1 })]))
      .catch(() => setReminders([makeReminderRow({ offsetDays: 1 })]))
  }, [isOpen, orgId])

  const primaryAssignees = assignees.filter((a) => !a.is_cc)
  const primaryAssigneeCount = primaryAssignees.length
  const primaryIdsKey = primaryAssignees.map((a) => a.user_id).sort().join(',')

  // Fetch leave windows for the selected (primary) assignees over a bounded horizon.
  // Drives both the deadline warning and the date-picker dots. Non-blocking.
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
    if (primaryAssigneeCount <= 1) setCompletionMode('any_can_complete')
  }, [primaryAssigneeCount])

  // New tasks always start in the "Not Started" phase (the org's birth status).
  useEffect(() => {
    if (selectableStatuses.length > 0 && !statusId) {
      const def =
        selectableStatuses.find((s) => s.type === 'not_started') ??
        selectableStatuses.find((s) => s.is_default) ??
        selectableStatuses[0]
      setStatusId(def.id)
    }
  }, [selectableStatuses, statusId])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handle(e: KeyboardEvent) {
      // Escape inside an open picker (e.g. the Tags search) closes only that picker.
      if (e.key === 'Escape' && !isListboxOpen()) onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [isOpen, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Holiday check on deadline change (debounced 300ms)
  useEffect(() => {
    if (holidayDebounceRef.current) clearTimeout(holidayDebounceRef.current)
    // A new deadline is a fresh decision — clear any prior override.
    setHolidayOverride(false)
    if (!deadlineDate || !orgId) { setHolidayCheck(null); return }
    holidayDebounceRef.current = setTimeout(async () => {
      try {
        const result = await holidaysApi.checkDate(orgId, deadlineDate)
        setHolidayCheck(result)
      } catch {
        setHolidayCheck(null)
      }
    }, 300)
    return () => { if (holidayDebounceRef.current) clearTimeout(holidayDebounceRef.current) }
  }, [deadlineDate, orgId])

  const reset = useCallback(() => {
    setTab('single')
    setTitle('')
    setDescription('')
    // setQuadrant('Q2')
    setPriorityId('')
    setCategoryId('')
    setTagIds([])
    setStatusId(
      selectableStatuses.find((s) => s.type === 'not_started')?.id ??
        selectableStatuses.find((s) => s.is_default)?.id ??
        selectableStatuses[0]?.id ??
        '',
    )
    setDeadlineDate('')
    setDeadlineTime('')
    setHolidayOverride(false)
    setMode(initialMode)
    setScheduleEntries([defaultScheduleEntry()])
    setCreatedRecurring(null)
    setCompletionMode('any_can_complete')
    setProofRequired(false)
    setProofAllowedExtensions([])
    setEscalationIds([])
    setGoalId('')
    setAssignees([])
    setAttachmentFiles([])
    setAttachmentsOpen(false)
    setChecklistOpen(false)
    setRemindersOpen(false)
    setChecklistGroups([])
    setReminders([])
    setError(null)
    setHolidayCheck(null)
  }, [selectableStatuses, initialMode])

  function handleClose() {
    reset()
    onClose()
  }

  function handleDeadlineDateChange(val: string) {
    // Clearing the date also clears the time. Range is enforced by the DatePicker.
    if (!val) { setDeadlineDate(''); setDeadlineTime(''); setRemindersOpen(false); return }
    setDeadlineDate(val)
    // Surface the end-of-day default on the clock once a date is picked.
    if (!deadlineTime) setDeadlineTime('23:59')
  }

  // Surface the backend's real reason (e.g. an inactive category, an ineligible
  // assignee) instead of a generic message.
  function apiErrorMessage(e: unknown, fallback: string): string {
    const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
    if (Array.isArray(m)) return m[0] ?? fallback
    return typeof m === 'string' && m ? m : fallback
  }

  async function handleSubmit(e: React.FormEvent, holidayOverrideArg?: boolean) {
    e.preventDefault()
    // Default to the user's inline override choice; the confirm-fallback below
    // may force it true on retry.
    const useHolidayOverride = holidayOverrideArg ?? holidayOverride
    if (mode === 'recurring') { await handleCreateRecurring(); return }
    if (!title.trim()) { setError('Title is required.'); return }
    if (assignees.filter((a) => !a.is_cc).length === 0) { setError('At least one assignee is required. CC-only tasks are not allowed.'); return }
    if (!deadlineDate) { setError('Deadline is required.'); return }
    if (deadlineDate) {
      if (deadlineDate < todayStr) { setError('Deadline cannot be in the past.'); return }
      if (deadlineDate > '2100-12-31') { setError('Deadline year cannot exceed 2100.'); return }
    }
    const reminderError = validateRemindersAgainstDeadline(reminders, deadline || null, deadlineDate)
    if (reminderError) { setError(reminderError); return }
    setSubmitting(true)
    setError(null)
    try {
      const newTask = await tasksApi.createTask(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        // quadrant,
        priority_id: priorityId || undefined,
        category_id: categoryId || undefined,
        ...(tagIds.length > 0 ? { tag_ids: tagIds } : {}),
        status_id: statusId || undefined,
        deadline: deadline || undefined,
        holiday_override: useHolidayOverride,
        completion_mode: completionMode,
        proof_required: proofRequired,
        proof_allowed_extensions: proofRequired ? proofAllowedExtensions : [],
        escalation_user_ids: escalationIds.length > 0 ? escalationIds : undefined,
        goal_id: goalId || undefined,
        assignee_user_ids: assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
        cc_user_ids: assignees.filter((a) => a.is_cc).map((a) => a.user_id),
        checklist_items: buildChecklistItems(checklistGroups),
        checklist_template_ids: Array.from(
          new Set(checklistGroups.filter((g) => g.templateId).map((g) => g.templateId as string)),
        ),
        reminders: buildReminderSpecs(reminders, true, deadlineDate),
      } as any)
      // Upload any attached documents to the freshly-created task. Files upload
      // sequentially so a partial failure is easy to surface without losing the task.
      if (attachmentFiles.length > 0) {
        try {
          for (const file of attachmentFiles) {
            await tasksApi.uploadTaskAttachment(orgId, newTask.id, file)
          }
        } catch {
          // The task exists — only the upload failed. Keep the modal OPEN so the user
          // actually sees why: every caller closes the modal inside onCreated, which
          // would unmount this message before it ever rendered. onTaskCreated still
          // refreshes the underlying list so the new task is visible in the background.
          setError('Task created, but an attachment failed to upload. Close this to view the task and add it again.')
          onTaskCreated?.(newTask)
          return
        }
      }
      reset()
      onTaskCreated?.(newTask)
      onCreated()
    } catch (e2) {
      const msg = apiErrorMessage(e2, 'Failed to create task. Please try again.')
      // The holiday rule never forces itself — offer to keep the chosen date.
      if (/non-working day/i.test(msg)) {
        if (window.confirm(`${msg}\n\nKeep this date anyway?`)) {
          setSubmitting(false)
          await handleSubmit(e, true)
          return
        }
      }
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Recurring path — creates a template (reusing the existing recurring engine),
  // uploads its attachments (which the scheduler copies into every spawned
  // instance), then shows a confirmation pointing to the Recurring tab.
  async function handleCreateRecurring() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (assignees.filter((a) => !a.is_cc).length === 0) { setError('At least one assignee is required. CC-only tasks are not allowed.'); return }
    for (const entry of scheduleEntries) {
      if (entry.schedule_type === 'weekly' && entry.days.length === 0) {
        setError('Select at least one day of the week for each weekly schedule.'); return
      }
      if (entry.schedule_type === 'monthly' && entry.month_days.length === 0) {
        setError('Select at least one day of the month for each monthly schedule.'); return
      }
      if (entry.schedule_type === 'yearly' && entry.yearly_dates.length === 0) {
        setError('Select at least one date for each yearly schedule.'); return
      }
      if (entry.end_condition === 'on_date' && !entry.end_date) {
        setError('End date is required for schedules ending "On date".'); return
      }
    }
    if (reminders.some((r) => r.kind === 'absolute' && !r.date)) { setError('Pick a date for each “on a date” reminder.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const template = await tasksApi.createRecurring(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        category_id: categoryId || undefined,
        priority_id: priorityId || undefined,
        ...(tagIds.length > 0 ? { tag_ids: tagIds } : {}),
        schedule_entries: scheduleEntries.map((en, idx) => ({
          schedule_type: en.schedule_type,
          every: en.every,
          days: en.days,
          month_days: en.month_days,
          yearly_dates: en.yearly_dates,
          time: en.time,
          start_date: en.start_date,
          end_condition: en.end_condition,
          end_date: en.end_condition === 'on_date' ? en.end_date : undefined,
          end_after: en.end_condition === 'after_n' ? en.end_after : undefined,
          order_index: idx,
        })),
        completion_mode: completionMode,
        proof_required: proofRequired,
        proof_allowed_extensions: proofRequired ? proofAllowedExtensions : [],
        escalation_user_ids: escalationIds.length > 0 ? escalationIds : undefined,
        linked_goal_id: goalId || undefined,
        assignee_user_ids: assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
        cc_user_ids: assignees.filter((a) => a.is_cc).map((a) => a.user_id),
        checklist_items: buildChecklistItems(checklistGroups),
        reminders: buildReminderSpecs(reminders, false),
      })
      // Upload the template's attachments — copied into every spawned instance.
      if (attachmentFiles.length > 0) {
        try {
          for (const file of attachmentFiles) {
            await tasksApi.uploadRecurringAttachment(orgId, template.id, file)
          }
        } catch {
          if (lockMode) {
            alert('Recurring task created, but an attachment failed to upload. Please edit the task in the Recurring tab to add it.')
            onCreated()
            handleClose()
          } else {
            setError('Recurring task created, but an attachment failed to upload. Open it in the Recurring tab to add it again.')
            setCreatedRecurring(template)
          }
          return
        }
      }
      if (lockMode) {
        onCreated()
        handleClose()
      } else {
        setCreatedRecurring(template)
      }
    } catch {
      setError('Failed to create recurring task. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !mounted) return null

  // ── Success confirmation (recurring only) ───────────────────────────────────
  if (createdRecurring) {
    return createPortal(
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
        role="dialog"
        aria-modal="true"
      >
        <div className="relative w-full max-w-md bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-6">
          <div className="flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-[#DCFCE7] flex items-center justify-center mb-4">
              <CheckCircle2 size={28} className="text-[#16A34A]" />
            </div>
            <h2 className="text-[20px] font-semibold text-[#0F172A]">Recurring task created</h2>
            <p className="text-sm text-[#475569] mt-2">
              <span className="font-medium text-[#0F172A]">“{createdRecurring.title}”</span> now lives in the{' '}
              <span className="font-medium text-[#2563EB]">Recurring</span> tab under Work. New task instances will be
              created automatically on schedule — with these attachments included each time.
            </p>
            {error && (
              <div className="w-full mt-4 bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3 text-sm text-[#DC2626]">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full mt-6">
              <button
                type="button"
                onClick={() => { onCreated(); handleClose() }}
                className="w-full sm:flex-1 px-5 py-[10px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => { onCreated(); handleClose(); router.push('/dashboard/tasks/recurring') }}
                className="w-full sm:flex-1 px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"
              >
                Go to Recurring
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
      role="dialog"
      aria-modal="true"
    >
      {/* When the Bulk-upload tab exists, the card is a FIXED size so switching tabs only
          swaps the inner content — the frame never resizes (no width/height glitch). The
          recurring/lock-mode modal (no bulk tab) keeps its natural content-driven height. */}
      <div className={`relative w-full bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] flex flex-col ${showBulkTab ? 'max-w-3xl h-[88vh]' : 'max-w-2xl max-h-[92vh]'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#E2E8F0] shrink-0">
          <h2 className="text-[22px] font-semibold text-[#0F172A]">
            {lockMode && mode === 'recurring' ? 'Create Recurring Task' : 'Create Task'}
          </h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Single task | Bulk upload — bulk swaps the whole body to the Excel import flow. */}
        {showBulkTab && (
          <div className="shrink-0 px-6 pt-4">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0]">
              {([
                { value: 'single' as const, label: 'Single task', icon: FilePlus2 },
                { value: 'bulk' as const, label: 'Bulk upload', icon: Table },
              ]).map((opt) => {
                const active = tab === opt.value
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTab(opt.value)}
                    aria-pressed={active}
                    className={[
                      'flex items-center justify-center gap-2 px-3 py-2 rounded-[8px] text-sm font-semibold transition-colors',
                      active ? 'bg-white text-[#0F172A] shadow-sm border border-[#E2E8F0]' : 'text-[#475569] hover:text-[#0F172A]',
                    ].join(' ')}
                  >
                    <Icon size={16} className={active ? 'text-[#2563EB]' : 'text-[#94A3B8]'} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'bulk' ? (
          <ImportTasksModal
            embedded
            orgId={orgId}
            onClose={handleClose}
            onImported={onImported ?? onCreated}
          />
        ) : (
        <>
        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">
              Title <span className="text-[#DC2626]">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                maxLength={50}
                placeholder="Task title..."
                className="w-full border border-[#CBD5E1] rounded-[8px] pl-3 pr-14 py-[10px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white"
              />
              {/* Count lives inside the field, right-aligned */}
              <span className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${title.length >= 50 ? 'text-[#DC2626]' : 'text-[#94A3B8]'}`}>
                {title.length}/50
              </span>
            </div>
          </div>

          {/* Assignees & CC */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignees & CC</label>
            <AssigneeSelector
              orgId={orgId}
              value={assignees}
              onChange={setAssignees}
              currentUser={user ? { user_id: user.id, name: user.name } : undefined}
            />
            <p className="text-[11px] text-[#475569] mt-1">Add people · click their badge to toggle between Assignee and CC</p>
          </div>

          {/* Completion mode — only relevant when multiple assignees are selected */}
          {primaryAssigneeCount > 1 && <div>
            <label className="block text-sm font-medium text-[#374151] mb-2">Completion Mode</label>
            <div className="flex gap-3">
              {(['any_can_complete', 'all_must_complete'] as CompletionMode[]).map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="completionMode"
                    value={mode}
                    checked={completionMode === mode}
                    onChange={() => setCompletionMode(mode)}
                    className="accent-[#2563EB]"
                  />
                  <span className="text-sm text-[#1E293B]">
                    {mode === 'any_can_complete' ? 'Any assignee can complete' : 'All assignees must complete'}
                  </span>
                </label>
              ))}
            </div>
          </div>}

          {/* Schedule mode — one-time (single deadline) vs recurring (auto-spawns).
              Hidden when the host page locks the mode (e.g. the Recurring page). */}
          {!lockMode && <div>
            <label className="block text-sm font-medium text-[#374151] mb-2">Schedule</label>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-[#F1F5F9] border border-[#E2E8F0]">
              {([
                { value: 'one_time' as TaskMode, label: 'One-time', icon: Calendar },
                { value: 'recurring' as TaskMode, label: 'Recurring', icon: RotateCcw },
              ]).map((opt) => {
                const active = mode === opt.value
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setMode(opt.value); setError(null) }}
                    className={[
                      'flex items-center justify-center gap-2 px-3 py-2 rounded-[8px] text-sm font-medium transition-colors',
                      active ? 'bg-[#2563EB] text-white shadow-sm' : 'text-[#475569] hover:bg-white',
                    ].join(' ')}
                    aria-pressed={active}
                  >
                    <Icon size={15} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-[#475569] mt-1.5">
              {mode === 'one_time'
                ? 'A single task with a fixed deadline.'
                : 'Auto-creates task instances on a schedule. Managed in the Recurring tab; attachments repeat on every instance.'}
            </p>
          </div>}

          {mode === 'one_time' ? (
          /* Deadline */
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[#374151]">Deadline <span className="text-[#DC2626]">*</span></label>
              {deadlineDate && (
                <button
                  type="button"
                  onClick={() => { setDeadlineDate(''); setDeadlineTime(''); setRemindersOpen(false) }}
                  className="flex items-center gap-1 text-[11px] text-[#475569] hover:text-[#DC2626] transition-colors"
                >
                  <X size={10} />
                  Clear
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {/* Date picker — shared calendar component (opens on click) */}
              <div className="flex-1">
                <DatePicker
                  value={deadlineDate}
                  onChange={handleDeadlineDateChange}
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
          </div>
          ) : (
          /* Recurring schedule — reuses the recurring engine's schedule builder */
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-2">
              Recurrence <span className="text-[#DC2626]">*</span>
            </label>
            <ScheduleEntryList entries={scheduleEntries} onChange={setScheduleEntries} />
          </div>
          )}

          {/* Reminders — notify the assignee (and optionally the assigner / CC)
              before the deadline. Multiple entries; on a recurring task they apply
              to every spawned instance. */}
          <RemindersField
            reminders={reminders}
            onChange={setReminders}
            mode={mode}
            deadlineDate={deadlineDate}
            todayStr={todayStr}
            open={remindersOpen}
            onOpenChange={setRemindersOpen}
          />

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                maxLength={2000}
                placeholder="Add a description..."
                rows={3}
                className="w-full border border-[#CBD5E1] rounded-[8px] px-3 pt-[10px] pb-6 text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white resize-none"
              />
              {/* Count lives inside the field, bottom-right */}
              <span className={`pointer-events-none absolute right-3 bottom-2 text-[11px] ${description.length >= 2000 ? 'text-[#DC2626]' : 'text-[#94A3B8]'}`}>
                {description.length}/2000
              </span>
            </div>
          </div>

          {/* Quadrant — hidden */}
          {/* <div>
            <label className="block text-sm font-medium text-[#374151] mb-2">Quadrant</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {quadrants.map((q) => {
                const cfg = quadrantColors[q.value]
                const isSelected = quadrant === q.value
                return (
                  <button
                    key={q.value}
                    type="button"
                    onClick={() => setQuadrant(q.value)}
                    className={[
                      'flex flex-col items-center rounded-[8px] px-2 py-2.5 border-2 transition-all duration-150',
                      isSelected
                        ? `${cfg.activeBg} border-transparent text-white`
                        : `${cfg.bg} ${cfg.border} ${cfg.text} hover:opacity-80`,
                    ].join(' ')}
                  >
                    <span className="text-sm font-bold">{q.label}</span>
                    <span className={`text-[10px] leading-tight text-center mt-0.5 ${isSelected ? 'text-white/80' : 'opacity-70'}`}>
                      {q.sublabel}
                    </span>
                  </button>
                )
              })}
            </div>
          </div> */}

          {/* Priority + Category — every new task starts in "Not Started", so status
              is not shown here (set automatically). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
              <StyledSelect
                value={priorityId}
                onChange={setPriorityId}
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
                onChange={setCategoryId}
                placeholder="No category"
                options={[
                  { value: '', label: 'No category' },
                  ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
                ]}
              />
            </div>
          </div>

          {/* Tags — full width, directly under Category/Priority. On a recurring task
              they are copied onto every spawned instance. */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Tags</label>
            <TagPicker orgId={orgId} value={tagIds} onChange={setTagIds} disabled={submitting} />
          </div>

          {/* Link to goal — the task (or every spawned instance) counts as an
              initiative on a quarterly goal. Hidden when there are no goals. */}
          <GoalSelectField orgId={orgId} value={goalId} onChange={setGoalId} />

          {/* Proof required + allowed file types */}
          <ProofRequirementField
            proofRequired={proofRequired}
            onProofRequiredChange={setProofRequired}
            allowedExtensions={proofAllowedExtensions}
            onAllowedExtensionsChange={setProofAllowedExtensions}
          />

          {/* Escalation contacts — alerted level by level once the task is overdue.
              On a recurring task they apply to every spawned instance. */}
          <EscalationLevelsField
            orgId={orgId}
            value={escalationIds}
            onChange={setEscalationIds}
            assignerId={user?.id}
            defaultToAssigner
            excludeUserIds={primaryAssignees.map((a) => a.user_id)}
          />

          {/* Attachments — collapsed by default to save space; the + button in the
              header expands the full dropzone. Applies to both one-time and recurring
              (a recurring template's attachments repeat on every spawned instance). */}
          <div>
            <div className="rounded-[12px] border border-[#E2E8F0] bg-white overflow-hidden">
              {/* Card header — click anywhere to toggle; + button on the right */}
              <button
                type="button"
                onClick={() => setAttachmentsOpen((v) => !v)}
                aria-expanded={attachmentsOpen}
                className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-[#F8FAFC] transition-colors"
              >
                <label className="text-sm font-medium text-[#374151] cursor-pointer">Attachments</label>
                <span className="text-xs font-normal text-[#475569]">Optional</span>
                {attachmentFiles.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
                    {attachmentFiles.length}
                  </span>
                )}
                <span
                  className={[
                    'ml-auto flex items-center justify-center w-6 h-6 rounded-[6px] text-[#2563EB] transition-transform',
                    attachmentsOpen ? 'rotate-45' : '',
                  ].join(' ')}
                  aria-hidden
                >
                  <Plus size={18} />
                </span>
              </button>
              {/* Body — fixed dropzone button on top; errors + pending files
                  share ONE scroll region below so the error box scrolls away
                  with the list instead of staying pinned. */}
              {attachmentsOpen && (
                <div className="px-3 pb-3 pt-0">
                  <FileDropzone
                    onFiles={(fs) => setAttachmentFiles((prev) => [...prev, ...fs])}
                    onReject={setAttachErrors}
                    disabled={submitting}
                  />
                  {(attachErrors.length > 0 || attachmentFiles.length > 0) && (
                    <div className="max-h-[220px] overflow-y-auto mt-2 space-y-2">
                      {attachErrors.length > 0 && (
                        <AttachmentErrorBox errors={attachErrors} onDismiss={() => setAttachErrors([])} />
                      )}
                      {attachmentFiles.length > 0 && (
                        <PendingFileList
                          files={attachmentFiles}
                          uploading={submitting && attachmentFiles.length > 0}
                          onRemove={(idx) => setAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Checklist — collapsed by default; optional, several groups allowed. On a
              recurring task these repeat on every spawned instance. */}
          <ChecklistBuilderField
            groups={checklistGroups}
            onChange={setChecklistGroups}
            templates={checklistTemplates}
            open={checklistOpen}
            onOpenChange={setChecklistOpen}
          />
        </form>

        {/* Footer — no Cancel button; the header X closes the modal (see DESIGN_RULES).
            The error lives here (not at the top of the scrollable body) so it's
            always visible right next to Save — never hidden above the fold. */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E2E8F0] space-y-3">
          {error && (
            <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3 text-sm text-[#DC2626]">
              {error}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (mode === 'one_time' && holidayCheck?.action === 'skip_create' && !holidayCheck.is_working_day && !holidayOverride)}
              className="w-full sm:w-auto px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Creating...' : mode === 'recurring' ? 'Create Recurring Task' : 'Create Task'}
            </button>
          </div>
        </div>
        </>
        )}
      </div>
    </div>,
    document.body,
  )
}
