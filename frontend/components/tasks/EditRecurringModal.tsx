'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Info, Plus } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import type {
  RecurringTemplate, RecurringScheduleEntry, TaskAttachment,
  TaskCategory, TaskPriority, CompletionMode, SelectedAssignee, YearlyDate, ChecklistTemplate,
} from '@/lib/types/tasks'
import StyledSelect from '@/components/ui/StyledSelect'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import { AttachmentList, PendingFileList } from '@/components/ui/AttachmentList'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import ScheduleEntryList from '@/components/tasks/ScheduleEntryList'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import ChecklistBuilderField, { buildChecklistItems, groupsFromChecklistItems, type ChecklistGroup } from '@/components/tasks/ChecklistBuilderField'
import RemindersField, { buildReminderSpecs, rowsFromReminderSpecs, type ReminderRow } from '@/components/tasks/RemindersField'
import EscalationLevelsField from '@/components/tasks/EscalationLevelsField'
import GoalSelectField from '@/components/tasks/GoalSelectField'
import ProofRequirementField from '@/components/tasks/ProofRequirementField'

export interface EditRecurringModalProps {
  template: RecurringTemplate
  orgId: string
  categories: TaskCategory[]
  priorities: TaskPriority[]
  onClose: () => void
  onUpdated: (t: RecurringTemplate) => void
}

function defaultEntry(): ScheduleEntryDraft {
  return {
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: new Date().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

function entryToScheduleEntryDraft(e: RecurringScheduleEntry): ScheduleEntryDraft {
  return {
    schedule_type: e.schedule_type,
    every: e.every,
    days: (e.days as number[]) ?? [],
    month_days: (e.month_days as number[]) ?? [],
    yearly_dates: (e.yearly_dates as YearlyDate[]) ?? [],
    time: e.time,
    start_date: new Date(e.start_date).toISOString().slice(0, 10),
    end_condition: e.end_condition,
    end_date: e.end_date ? new Date(e.end_date).toISOString().slice(0, 10) : '',
    end_after: e.end_after ?? 10,
  }
}

export default function EditRecurringModal({ template, orgId, categories, priorities, onClose, onUpdated }: EditRecurringModalProps) {
  const [title, setTitle] = useState(template.title)
  const [description, setDescription] = useState(template.description ?? '')
  const [priorityId, setPriorityId] = useState(template.priority_id ?? '')
  const [categoryId, setCategoryId] = useState(template.category_id ?? '')
  const [completionMode, setCompletionMode] = useState<CompletionMode>(template.completion_mode as CompletionMode)
  const [proofRequired, setProofRequired] = useState(template.proof_required)
  const [proofAllowedExtensions, setProofAllowedExtensions] = useState<string[]>(template.proof_allowed_extensions ?? [])
  const [escalationIds, setEscalationIds] = useState<string[]>(template.escalation_user_ids ?? [])
  const [goalId, setGoalId] = useState(template.linked_goal_id ?? '')
  const [assignees, setAssignees] = useState<SelectedAssignee[]>([])
  const [assigneesLoaded, setAssigneesLoaded] = useState(false)
  // Whether a roster change should reach occurrences that already exist. Defaults to
  // future-only — today's behaviour — so an unrelated edit never quietly reshuffles
  // live tasks. Only offered once the roster has actually changed (below).
  const [applyTo, setApplyTo] = useState<'future_only' | 'future_and_open'>('future_only')
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryDraft[]>(
    (template.schedule_entries ?? []).length > 0
      ? (template.schedule_entries ?? []).map(entryToScheduleEntryDraft)
      : [defaultEntry()]
  )

  // Checklist + reminders — prefilled from the template, fully editable.
  const [checklistGroups, setChecklistGroups] = useState<ChecklistGroup[]>(
    () => groupsFromChecklistItems(template.checklist_items),
  )
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([])
  const [checklistOpen, setChecklistOpen] = useState((template.checklist_items?.length ?? 0) > 0)
  const [reminders, setReminders] = useState<ReminderRow[]>(() => rowsFromReminderSpecs(template.reminder_specs))
  const [remindersOpen, setRemindersOpen] = useState(false)
  const todayStr = new Date().toISOString().split('T')[0]

  // Attachments — existing ones are managed live (remove hits the API right away);
  // new files upload when you save.
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [removingAttachment, setRemovingAttachment] = useState<TaskAttachment | null>(null)

  const primaryAssigneeCount = assignees.filter((a) => !a.is_cc).length

  useEffect(() => {
    if (assigneesLoaded && primaryAssigneeCount <= 1) setCompletionMode('any_can_complete')
  }, [primaryAssigneeCount, assigneesLoaded])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A committed save that propagation could not fully apply — held so the user sees
  // which occurrences were left alone before the modal closes.
  const [savedResult, setSavedResult] = useState<RecurringTemplate | null>(null)
  const [skippedNote, setSkippedNote] = useState<{ title: string; reason: string }[]>([])
  // Portal target only exists on the client — guard against SSR mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Prefill the assignee badges with the template's current people (names resolved
  // from the eligible-assignees directory) — editing no longer starts from a
  // confusing empty list.
  useEffect(() => {
    let cancelled = false
    tasksApi.getEligibleAssignees(orgId)
      .then((res) => {
        if (cancelled) return
        const names = new Map<string, string>()
        res.departments.forEach((d) => d.users.forEach((u) => names.set(u.user_id, u.name)))
        setAssignees([
          ...(template.assignee_user_ids ?? []).map((uid) => ({ user_id: uid, name: names.get(uid) ?? 'Unknown member', is_cc: false })),
          ...(template.cc_user_ids ?? []).map((uid) => ({ user_id: uid, name: names.get(uid) ?? 'Unknown member', is_cc: true })),
        ])
      })
      .catch(() => {
        if (cancelled) return
        setAssignees([
          ...(template.assignee_user_ids ?? []).map((uid) => ({ user_id: uid, name: 'Member', is_cc: false })),
          ...(template.cc_user_ids ?? []).map((uid) => ({ user_id: uid, name: 'Member', is_cc: true })),
        ])
      })
      .finally(() => { if (!cancelled) setAssigneesLoaded(true) })
    return () => { cancelled = true }
  }, [orgId, template.id, template.assignee_user_ids, template.cc_user_ids])

  // Has the roster actually moved? Drives whether we bother asking about existing
  // occurrences. Order-independent, and only once the current roster has loaded —
  // before that `assignees` is [] and everything would look "changed".
  const initialRosterSig = React.useMemo(
    () =>
      JSON.stringify(
        [
          ...(template.assignee_user_ids ?? []).map((u) => `${u}:0`),
          ...(template.cc_user_ids ?? []).map((u) => `${u}:1`),
        ].sort(),
      ),
    [template.assignee_user_ids, template.cc_user_ids],
  )
  const rosterChanged =
    assigneesLoaded &&
    JSON.stringify(assignees.map((a) => `${a.user_id}:${a.is_cc ? 1 : 0}`).sort()) !== initialRosterSig

  // Existing template attachments + the checklist templates this user may apply.
  useEffect(() => {
    tasksApi.listRecurringAttachments(orgId, template.id).then(setAttachments).catch(() => setAttachments([]))
    tasksApi.getAccessibleChecklistTemplates(orgId).then(setChecklistTemplates).catch(() => setChecklistTemplates([]))
  }, [orgId, template.id])

  async function handleRemoveAttachment(a: TaskAttachment) {
    try {
      await tasksApi.deleteRecurringAttachment(orgId, template.id, a.id)
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch {
      setError('Failed to remove the attachment. Please try again.')
    } finally {
      setRemovingAttachment(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
        setError('End date is required for schedule entries with "On date" end condition.'); return
      }
    }
    if (reminders.some((r) => r.kind === 'absolute' && !r.date)) { setError('Pick a date for each “on a date” reminder.'); return }

    setSubmitting(true)
    setError(null)
    try {
      const result = await tasksApi.updateRecurring(orgId, template.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority_id: priorityId || undefined,
        category_id: categoryId || undefined,
        completion_mode: completionMode,
        proof_required: proofRequired,
        proof_allowed_extensions: proofRequired ? proofAllowedExtensions : [],
        escalation_user_ids: escalationIds,
        linked_goal_id: goalId,
        // Full replacement — an emptied checklist/reminder list really clears it.
        checklist_items: buildChecklistItems(checklistGroups) ?? [],
        reminders: buildReminderSpecs(reminders, false),
        schedule_entries: scheduleEntries.map((e, idx) => ({
          schedule_type: e.schedule_type,
          every: e.every,
          days: e.days,
          month_days: e.month_days,
          yearly_dates: e.yearly_dates,
          time: e.time,
          start_date: e.start_date,
          end_condition: e.end_condition,
          end_date: e.end_condition === 'on_date' ? e.end_date : undefined,
          end_after: e.end_condition === 'after_n' ? e.end_after : undefined,
          order_index: idx,
        })) as never,
        assignee_user_ids: assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
        cc_user_ids: assignees.filter((a) => a.is_cc).map((a) => a.user_id),
        // Only meaningful when the roster moved; harmless otherwise (the backend
        // treats it as future-only unless there is actually a roster change).
        apply_to: rosterChanged ? applyTo : 'future_only',
      } as never)
      // Upload any newly added documents — future instances will carry them.
      if (pendingFiles.length > 0) {
        try {
          for (const file of pendingFiles) {
            await tasksApi.uploadRecurringAttachment(orgId, template.id, file)
          }
        } catch {
          setError('Changes saved, but an attachment failed to upload. Reopen Edit to add it again.')
          setPendingFiles([])
          setSubmitting(false)
          return
        }
      }
      // Propagating a roster to open occurrences can legitimately skip some — an open
      // task can't be left with nobody doing it. That has to be said out loud, or the
      // user walks away believing every occurrence was updated. Hold the modal open
      // with the list; the save itself has already committed.
      const skipped = (result as unknown as { propagation?: { skipped?: { title: string; reason: string }[] } })
        ?.propagation?.skipped ?? []
      if (skipped.length > 0) {
        setSavedResult(result!)
        setSkippedNote(skipped)
        setSubmitting(false)
        return
      }
      onUpdated(result!)
    } catch {
      setError('Failed to save changes. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h2 className="text-[22px] font-semibold text-[#0F172A]">Edit Recurring Template</h2>
            <p className="text-sm text-[#475569] mt-0.5">Changes apply to future task instances only.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          <div className="flex gap-3 bg-[#FFF7ED] border border-[#FED7AA] rounded-[10px] px-4 py-3">
            <Info size={16} className="text-[#EA580C] shrink-0 mt-0.5" />
            <div className="text-sm text-[#9A3412] space-y-1">
              <p className="font-semibold">What happens when you save?</p>
              <ul className="list-disc list-inside space-y-0.5 text-[13px]">
                <li>
                  Already-created task instances are{' '}
                  <span className="font-medium">
                    {rosterChanged && applyTo === 'future_and_open'
                      ? 'updated too — but only who they’re assigned to, and only if still open'
                      : 'not affected'}
                  </span>
                  {rosterChanged && applyTo === 'future_and_open' ? '.' : ' — they stay as-is.'}
                </li>
                <li>The next scheduled task and all future ones follow your updated settings, checklist, reminders and attachments.</li>
                <li>Schedule changes <span className="font-medium">fully replace</span> the existing schedule.</li>
              </ul>
            </div>
          </div>

          {error && (
            <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-4 py-3 text-sm text-[#DC2626]">{error}</div>
          )}

          <div className="space-y-4">
            <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Task Details</p>
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
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Assignees & CC</label>
              <AssigneeSelector orgId={orgId} value={assignees} onChange={setAssignees} disabled={!assigneesLoaded} />
              <p className="text-[11px] text-[#475569] mt-1">
                {assigneesLoaded
                  ? 'Add people · click their badge to toggle between Assignee and CC'
                  : 'Loading current assignees…'}
              </p>

              {/* Only asked once the roster has actually changed — a toggle nobody
                  needs is worse than no toggle. Mirrors the three delete modes, so it
                  should feel familiar. */}
              {rosterChanged && (
                <div className="mt-3 rounded-[10px] border border-[#BAE6FD] bg-[#E0F2FE] px-4 py-3">
                  <p className="text-sm font-semibold text-[#0369A1] mb-2">
                    You changed who this task goes to. Apply that to existing occurrences?
                  </p>
                  <div className="space-y-2">
                    {([
                      {
                        v: 'future_only' as const,
                        label: 'Future occurrences only',
                        hint: 'Tasks already created keep their current people.',
                      },
                      {
                        v: 'future_and_open' as const,
                        label: 'This and all open occurrences',
                        hint: 'Also updates every not-yet-completed task from this template. Closed ones are never touched.',
                      },
                    ]).map((opt) => (
                      <label key={opt.v} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="applyTo"
                          value={opt.v}
                          checked={applyTo === opt.v}
                          onChange={() => setApplyTo(opt.v)}
                          className="accent-[#2563EB] mt-0.5"
                        />
                        <span>
                          <span className="block text-sm text-[#0F172A]">{opt.label}</span>
                          <span className="block text-[11px] text-[#475569]">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {primaryAssigneeCount > 1 && (
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-2">Completion Mode</label>
                <div className="flex gap-4">
                  {(['any_can_complete', 'all_must_complete'] as CompletionMode[]).map((mode) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="editCompletionMode" value={mode} checked={completionMode === mode} onChange={() => setCompletionMode(mode)} className="accent-[#2563EB]" />
                      <span className="text-sm text-[#1E293B]">{mode === 'any_can_complete' ? 'Any assignee can complete' : 'All must complete'}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 2000))} maxLength={2000} placeholder="Add a description..." rows={2} className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-[10px] text-base sm:text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-none bg-white resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
            <GoalSelectField orgId={orgId} value={goalId} onChange={setGoalId} />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Schedule</p>
            <ScheduleEntryList entries={scheduleEntries} onChange={setScheduleEntries} />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Completion & Alerts</p>
            <ProofRequirementField
              proofRequired={proofRequired}
              onProofRequiredChange={setProofRequired}
              allowedExtensions={proofAllowedExtensions}
              onAllowedExtensionsChange={setProofAllowedExtensions}
            />
            <EscalationLevelsField
              orgId={orgId}
              value={escalationIds}
              onChange={setEscalationIds}
              excludeUserIds={assignees.filter((a) => !a.is_cc).map((a) => a.user_id)}
            />
            <RemindersField
              reminders={reminders}
              onChange={setReminders}
              mode="recurring"
              todayStr={todayStr}
              open={remindersOpen}
              onOpenChange={setRemindersOpen}
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Repeats On Every Instance</p>
            <ChecklistBuilderField
              groups={checklistGroups}
              onChange={setChecklistGroups}
              templates={checklistTemplates}
              open={checklistOpen}
              onOpenChange={setChecklistOpen}
            />

            {/* Attachments — existing files + add new; each future instance gets a copy. */}
            <div className="rounded-[12px] border border-[#E2E8F0] bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setAttachmentsOpen((v) => !v)}
                aria-expanded={attachmentsOpen}
                className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-[#F8FAFC] transition-colors"
              >
                <label className="text-sm font-medium text-[#374151] cursor-pointer">Attachments</label>
                <span className="text-xs font-normal text-[#475569]">Optional</span>
                {(attachments.length + pendingFiles.length) > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
                    {attachments.length + pendingFiles.length}
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
              {attachmentsOpen && (
                <div className="px-3 pb-3 pt-0 space-y-2">
                  <p className="text-xs text-[#475569]">
                    Removing a file takes effect immediately; new files upload when you save. Already-created instances keep their copies.
                  </p>
                  {attachments.length > 0 && (
                    <AttachmentList
                      attachments={attachments}
                      onDownload={(a) => tasksApi.downloadRecurringAttachment(orgId, template.id, a.id)}
                      onRemove={(a) => setRemovingAttachment(a)}
                      canRemove={() => true}
                    />
                  )}
                  <FileDropzone
                    onFiles={(fs) => setPendingFiles((prev) => [...prev, ...fs])}
                    onReject={setAttachErrors}
                    disabled={submitting}
                  />
                  {(attachErrors.length > 0 || pendingFiles.length > 0) && (
                    <div className="max-h-[220px] overflow-y-auto space-y-2">
                      {attachErrors.length > 0 && (
                        <AttachmentErrorBox errors={attachErrors} onDismiss={() => setAttachErrors([])} />
                      )}
                      {pendingFiles.length > 0 && (
                        <PendingFileList
                          files={pendingFiles}
                          uploading={submitting && pendingFiles.length > 0}
                          onRemove={(idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Footer — no Cancel button; the header X closes the modal (see DESIGN_RULES) */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E2E8F0] space-y-3">
          {/* Saved, but some open occurrences were deliberately left alone. */}
          {skippedNote.length > 0 && (
            <div className="rounded-[8px] border border-[#FDE68A] bg-[#FEF9C3] px-4 py-3">
              <p className="text-sm font-semibold text-[#713F12]">
                Saved. {skippedNote.length} open{' '}
                {skippedNote.length === 1 ? 'occurrence was' : 'occurrences were'} left unchanged:
              </p>
              <ul className="mt-1.5 space-y-1 max-h-[140px] overflow-y-auto">
                {skippedNote.map((s, i) => (
                  <li key={i} className="text-[12px] text-[#713F12]">
                    <span className="font-medium">{s.title}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {savedResult ? (
              <button
                type="button"
                onClick={() => onUpdated(savedResult)}
                className="w-full sm:w-auto px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] transition-colors"
              >
                Done
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={submitting} className="w-full sm:w-auto px-5 py-[10px] text-sm font-semibold text-white bg-[#2563EB] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors">
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Remove-attachment confirmation — destructive and immediate, so confirm first. */}
      {removingAttachment && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setRemovingAttachment(null) }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-5">
            <h3 className="text-[16px] font-semibold text-[#0F172A]">Remove attachment?</h3>
            <p className="text-sm text-[#475569] mt-1.5">
              “{removingAttachment.file_name}” will no longer be copied onto future instances. This happens right away.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setRemovingAttachment(null)}
                className="px-4 py-2 text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] rounded-[8px] hover:bg-[#EFF6FF] transition-colors"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => handleRemoveAttachment(removingAttachment)}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
