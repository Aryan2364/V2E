'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { tasksApi } from '@/lib/api/tasks'
import type { CompletionMode, RecurringScheduleEntry, RecurringTemplate, TaskPriority, YearlyDate } from '@/lib/types/tasks'
import { PHONE_HOME, RECURRING_TEMPLATES_HREF, recurringInstancesHref, type PhoneRoute } from '@/lib/phone-routes'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { groupsFromChecklistItems, buildChecklistItems } from '@/components/tasks/ChecklistBuilderField'
import { buildReminderSpecs, rowsFromReminderSpecs, type ReminderRow } from '@/components/tasks/RemindersField'
import { buildRecurringPayload, defaultScheduleEntry, scheduleEntriesError } from '@/lib/tasks/recurring-payload'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import PhoneScreen from '../PhoneScreen'
import { PhoneFailedState } from '../PhoneEmptyState'
import { RepeatFields } from '../RepeatFields'
import { PhoneButton, PhoneField, PhoneLinkButton, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import {
  TaskFormFields,
  EMPTY_TASK_FORM,
  TITLE_MAX,
  DESCRIPTION_MAX,
  cleanChecklist,
  type TaskFormValues,
} from '../TaskFormFields'

/*
 * "Edit recurring task" - phone only (the computer edits in a dialog,
 * components/tasks/EditRecurringModal.tsx, so /dashboard/tasks/recurring/:id/edit
 * forwards to the template's instances there).
 *
 *   - The same fields as Give task (components/phone/TaskFormFields.tsx) with
 *     the schedule in place of the due date: title, description, assignees,
 *     CC, schedule, priority, tags, checklist, proof, who completes it and
 *     reminders. Things the phone form does not show (category, goal,
 *     escalation, proof file types, extra schedule entries) are sent back as
 *     they are, so saving here never clears them.
 *   - Who may edit is the template's own `can_edit` (creator, admin or an
 *     edit share - assignees cannot), the flag the computer uses to show Edit.
 *     Anyone else gets a plain message and a way back.
 *   - Save is the computer's own PATCH (tasksApi.updateRecurring) with the
 *     shared payload builder (lib/tasks/recurring-payload.ts). Tags are sent
 *     only when they changed; the schedule is a full replacement; reminders
 *     and the checklist are full replacements. Changes reach future tasks only,
 *     unless the people changed and the person chooses to update open ones too.
 *   - A template with more than one schedule keeps them all: changing
 *     schedules is left to the computer, and the rest of the form still saves.
 *   - Files on the template stay on the computer's edit dialog.
 */

const sig = (ids: string[]) => [...ids].sort().join(',')

const APPLY_ITEMS: Record<string, string> = {
  future_only: 'Future tasks only',
  future_and_open: 'Future tasks and open ones',
}

/** One stored schedule entry as the editable draft (the computer's entryToScheduleEntryDraft). */
function draftFromEntry(e: RecurringScheduleEntry): ScheduleEntryDraft {
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

export default function RecurringEditScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ id: string }>()
  const templateId = params?.id
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const parent = route.parent ?? RECURRING_TEMPLATES_HREF

  const [template, setTemplate] = React.useState<RecurringTemplate | null | undefined>(undefined)
  const [names, setNames] = React.useState<Map<string, string> | null>(null)
  const [failed, setFailed] = React.useState(false)

  const load = React.useCallback(() => {
    if (!orgId || !templateId) return
    // The same two lookups the computer's dialog makes: the template, and the directory its people's names come from.
    tasksApi
      .getRecurringTemplates(orgId)
      .then((list) => setTemplate(list.find((t) => t.id === templateId) ?? null))
      .catch(() => setFailed(true))
    tasksApi
      .getEligibleAssignees(orgId)
      .then((res) => setNames(new Map(res.departments.flatMap((d) => d.users).map((u) => [u.user_id, u.name]))))
      .catch(() => setNames(new Map()))
  }, [orgId, templateId])
  React.useEffect(load, [load])

  if (failed) {
    return (
      <PhoneScreen title="Edit recurring task" parent={parent}>
        <PhoneFailedState what="This recurring task" onRetry={() => { setFailed(false); load() }} />
        <PhoneLinkButton href={PHONE_HOME} fullWidth>
          Go to home
        </PhoneLinkButton>
      </PhoneScreen>
    )
  }

  if (template === undefined || names === null) {
    return (
      <PhoneScreen title="Edit recurring task" parent={parent}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  if (template === null) {
    return (
      <PhoneScreen title="Edit recurring task" parent={parent}>
        <div className="flex flex-col gap-[16px]">
          <p className="text-body text-text-primary">This recurring task was not found. It may have been deleted, or you may not have access to it.</p>
          <PhoneLinkButton href={RECURRING_TEMPLATES_HREF} fullWidth>
            Back to recurring tasks
          </PhoneLinkButton>
        </div>
      </PhoneScreen>
    )
  }

  if (!template.can_edit) {
    return (
      <PhoneScreen title="Edit recurring task" parent={parent}>
        <div className="flex flex-col gap-[16px]">
          <p className="text-body text-text-primary">
            You cannot edit this recurring task. It can be edited by the person who created it, an admin, or someone it has been shared with for editing.
          </p>
          <PhoneLinkButton href={recurringInstancesHref(template.id)} fullWidth>
            Back to the recurring task
          </PhoneLinkButton>
        </div>
      </PhoneScreen>
    )
  }

  return <RecurringEditForm template={template} names={names} orgId={orgId} parent={parent} />
}

function RecurringEditForm({
  template,
  names,
  orgId,
  parent,
}: {
  template: RecurringTemplate
  names: Map<string, string>
  orgId: string
  parent: string
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const initial = React.useMemo<TaskFormValues>(() => {
    const person = (uid: string) => ({ user_id: uid, name: names.get(uid) ?? 'Someone' })
    return {
      ...EMPTY_TASK_FORM,
      title: template.title,
      description: template.description ?? '',
      priorityId: template.priority_id ?? '',
      assignees: (template.assignee_user_ids ?? []).map(person),
      cc: (template.cc_user_ids ?? []).map(person),
      tags: (template.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, is_active: t.is_active })),
      checklist: groupsFromChecklistItems(template.checklist_items),
      proofRequired: template.proof_required,
      completionMode: template.completion_mode as CompletionMode,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id])

  const entries = template.schedule_entries ?? []
  const multipleSchedules = entries.length > 1
  const [values, setValues] = React.useState<TaskFormValues>(initial)
  const [schedule, setSchedule] = React.useState<ScheduleEntryDraft>(() => (entries[0] ? draftFromEntry(entries[0]) : defaultScheduleEntry()))
  const [reminders, setReminders] = React.useState<ReminderRow[]>(() => rowsFromReminderSpecs(template.reminder_specs))
  const [applyTo, setApplyTo] = React.useState<'future_only' | 'future_and_open'>('future_only')
  const [priorities, setPriorities] = React.useState<TaskPriority[]>([])
  const [saving, setSaving] = React.useState(false)
  const [attempted, setAttempted] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    tasksApi.getPriorities(orgId).then(setPriorities).catch(() => {})
  }, [orgId])

  const ids = (list: { user_id: string }[]) => list.map((p) => p.user_id)
  const rosterChanged =
    sig(ids(values.assignees)) !== sig(ids(initial.assignees)) || sig(ids(values.cc)) !== sig(ids(initial.cc))
  const tagsChanged = sig(values.tags.map((t) => t.id)) !== sig(initial.tags.map((t) => t.id))

  const titleError =
    values.title.length > TITLE_MAX
      ? `Shorten the title to ${TITLE_MAX} characters or fewer.`
      : attempted && values.title.trim().length === 0
        ? 'Enter a title.'
        : null
  const descriptionError = values.description.length > DESCRIPTION_MAX ? `Shorten the description to ${DESCRIPTION_MAX} characters or fewer.` : null
  const assigneesError =
    attempted && values.assignees.length === 0
      ? 'Choose at least one assignee. A task with only people in CC has no one to do it.'
      : null

  async function onSave() {
    if (saving) return
    setAttempted(true)
    const invalid =
      values.title.trim().length === 0 ||
      values.title.length > TITLE_MAX ||
      !!descriptionError ||
      values.assignees.length === 0 ||
      (!multipleSchedules && !!scheduleEntriesError([schedule]))
    if (invalid) {
      focusFirstInvalid(formRef.current)
      return
    }
    if (reminders.some((r) => r.kind === 'absolute' && !r.date)) {
      addToast('Pick a date for each "on a date" reminder.', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = buildRecurringPayload({
        title: values.title,
        description: values.description,
        categoryId: template.category_id,
        priorityId: values.priorityId,
        scheduleEntries: [schedule],
        completionMode: values.completionMode,
        proofRequired: values.proofRequired,
        proofAllowedExtensions: template.proof_allowed_extensions ?? [],
        escalationIds: template.escalation_user_ids ?? [],
        goalId: template.linked_goal_id ?? undefined,
        assignees: [...values.assignees.map((a) => ({ ...a, is_cc: false })), ...values.cc.map((a) => ({ ...a, is_cc: true }))],
        checklistItems: buildChecklistItems(cleanChecklist(values.checklist)) ?? [],
        reminders: buildReminderSpecs(reminders, false),
      })
      const { schedule_entries, ...rest } = payload
      const result = await tasksApi.updateRecurring(orgId, template.id, {
        ...rest,
        // Only when the set changed (the computer's rule): resending an untouched list could undo someone else's change.
        // [] is sent when the person cleared them.
        ...(tagsChanged ? { tag_ids: values.tags.map((t) => t.id) } : {}),
        // A template with several schedules keeps them; leaving the field out leaves them untouched.
        ...(multipleSchedules ? {} : { schedule_entries }),
        // Only meaningful when the people changed; the server treats anything else as future-only.
        apply_to: rosterChanged ? applyTo : 'future_only',
      } as never)
      // Applying people to open tasks can skip some (an open task cannot be left with nobody doing it); say so.
      const skipped = (result as unknown as { propagation?: { skipped?: unknown[] } })?.propagation?.skipped ?? []
      if (skipped.length > 0) {
        addToast(`Saved. ${skipped.length} open ${skipped.length === 1 ? 'task was' : 'tasks were'} left with their current people.`, 'warning')
      } else {
        addToast('Recurring task updated', 'success')
      }
      router.replace(recurringInstancesHref(template.id))
    } catch (e) {
      addToast(apiErrorMessage(e, '') || 'Could not save the changes. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhoneScreen title="Edit recurring task" parent={parent}>
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-[20px] pb-[80px]"
        onKeyDown={enterMovesNext}
        onSubmit={(e) => e.preventDefault()}
      >
        <TaskFormFields
          values={values}
          setValues={setValues}
          priorities={priorities}
          orgId={orgId}
          idPrefix="edit-recurring"
          titleError={titleError}
          descriptionError={descriptionError}
          assigneesError={assigneesError}
          reminders={{ rows: reminders, onChange: setReminders, mode: 'recurring' }}
          when={
            multipleSchedules ? (
              <p className="text-body text-text-secondary">
                This task has {entries.length} schedules. They are kept as they are; changing schedules is done on a computer.
              </p>
            ) : (
              <RepeatFields entry={schedule} onChange={setSchedule} showErrors={attempted} />
            )
          }
        />

        {rosterChanged ? (
          <PhoneField label="Apply the new people to">
            <Select value={applyTo} items={APPLY_ITEMS} onValueChange={(v) => setApplyTo(v === 'future_and_open' ? 'future_and_open' : 'future_only')}>
              <SelectTrigger aria-label="Apply the new people to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(APPLY_ITEMS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-meta text-text-secondary">
              {applyTo === 'future_and_open'
                ? 'Also changes who every not-yet-completed task from this one is assigned to. Closed tasks are never touched.'
                : 'Tasks already created keep their current people.'}
            </p>
          </PhoneField>
        ) : (
          <p className="text-meta text-text-secondary">Changes apply to future tasks only. Tasks already created stay as they are.</p>
        )}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-(--z-shell) flex gap-[8px] border-t border-border-light bg-surface px-[16px] pt-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton type="button" variant="primary" fullWidth loading={saving} onClick={() => void onSave()}>
          Save changes
        </PhoneButton>
      </div>
    </PhoneScreen>
  )
}
