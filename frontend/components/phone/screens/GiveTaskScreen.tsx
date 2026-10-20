'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { useBack } from '@/lib/back'
import type { TaskPriority } from '@/lib/types/tasks'
import { PHONE_HOME, RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { makeReminderRow, buildReminderSpecs } from '@/components/tasks/RemindersField'
import { buildRecurringPayload, scheduleEntryError } from '@/lib/tasks/recurring-payload'
import type { RecurringScheduleType } from '@/lib/types/tasks'
import { useDraft } from '@/lib/drafts'
import { isChanged, useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { DraftBanner } from '../DraftBanner'
import { shouldOfferPushNow, declinePushOffer } from '@/lib/push'
import PhoneScreen from '../PhoneScreen'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PeoplePickerSheet, SelectedPeopleList, type PickedPerson, type PickerSection } from '../PeoplePickerSheet'
import { useEligibleAssignees, type AssigneeSortMode } from '@/components/tasks/useEligibleAssignees'
import { NotificationOfferSheet } from '../NotificationOfferSheet'
import { RepeatFields, entryForFrequency } from '../RepeatFields'
import { PhoneButton, PhoneField, GrowTextarea, ROW, PHONE_INPUT, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import { PhoneDateField, PhoneTimeField } from '../PhoneDateTimeField'

/*
 * "Give task" - plan-phone-2026-10-14.md §5.4 (slice 4), kit §41.7.
 *
 *   - Minimum fields: title, assignee(s) via a searchable bottom sheet, due
 *     date via the browser's native picker, priority. Description is one
 *     tap away (an expandable field, not a separate screen).
 *   - Validated against the real CreateTaskDto: title required, <= 50
 *     chars; description <= 2000.
 *   - Draft: lib/drafts.ts (kit §41.7 rules 12-15), form id "task-give",
 *     record "new". Offered back with a banner ("You have an unsaved
 *     draft from ...") - never restored silently. Cleared on save and on
 *     Discard draft; also cleared for everyone on sign-out (lib/auth's
 *     logout calls clearDrafts).
 *   - Repeat (Daily/Weekly/Monthly/Yearly): choosing one swaps the Due date
 *     for the schedule fields (components/phone/RepeatFields.tsx) and Save
 *     creates a recurring TEMPLATE with the desktop's own payload builder
 *     (lib/tasks/recurring-payload.ts). Everything the phone form does not
 *     show takes the desktop's default (any assignee completes, no proof, no
 *     escalation, no goal, one reminder from the org's default days before).
 *     Then the recurring list opens.
 *   - After saving: back to the previous list with a toast. The task only
 *     shows on My work if the current user is actually one of its
 *     assignees - that's the backend's own grouping, not something this
 *     screen has to enforce.
 */

const TITLE_MAX = 50
const DESCRIPTION_MAX = 2000

type GiveTaskValues = {
  title: string
  description: string
  deadline: string
  priorityId: string
  assignees: { user_id: string; name: string }[]
  /** null = does not repeat. */
  schedule: ScheduleEntryDraft | null
}

const EMPTY_DRAFT: GiveTaskValues = { title: '', description: '', deadline: '', priorityId: '', assignees: [], schedule: null }

export default function GiveTaskScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const router = useRouter()
  const back = useBack(route.parent ?? PHONE_HOME)
  const orgId = user?.organizationId ?? ''

  const [draftValues, setDraft] = React.useState<GiveTaskValues>(EMPTY_DRAFT)
  const [showDescription, setShowDescription] = React.useState(false)
  const [priorities, setPriorities] = React.useState<TaskPriority[]>([])
  const [assigneePicker, setAssigneePicker] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [offerPush, setOfferPush] = React.useState(false)
  const [attempted, setAttempted] = React.useState(false)
  const [titleTouched, setTitleTouched] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [reminderDays, setReminderDays] = React.useState(1)
  const recurring = React.useRef(false)

  const draft = draftValues
  // Set once the task is saved, so leaving afterwards never asks (11.3 rule 10, 41.7 rule 3).
  const [saved, setSaved] = React.useState(false)
  const fileDraft = useDraft<GiveTaskValues>({
    person: user?.id,
    form: 'task-give',
    record: 'new',
    values: draftValues,
  })

  const unsaved = useUnsavedChanges({
    changed: !saved && isChanged(draftValues, EMPTY_DRAFT),
    noun: 'task',
    mode: 'create',
    onLeave: () => fileDraft.clear(),
  })

  React.useEffect(() => {
    if (!orgId) return
    tasksApi.getPriorities(orgId).then(setPriorities).catch(() => {})
    // The desktop seeds one reminder from this default on a new task.
    tasksApi.getConfig(orgId).then((cfg) => setReminderDays(cfg?.default_reminder_days_before ?? 1)).catch(() => {})
  }, [orgId])

  const showTitleErrors = titleTouched || attempted
  const titleError =
    draft.title.length > TITLE_MAX
      ? `Shorten the title to ${TITLE_MAX} characters or fewer.`
      : showTitleErrors && draft.title.trim().length === 0
        ? 'Enter a title.'
        : null
  const descriptionError = draft.description.length > DESCRIPTION_MAX ? `Shorten the description to ${DESCRIPTION_MAX} characters or fewer.` : null
  const schedule = draft.schedule
  const noAssigneeError = attempted && draft.assignees.length === 0 ? 'Choose at least one assignee.' : null

  /** Leaves after a save: the recurring list for a template, otherwise back. */
  function leave() {
    if (recurring.current) router.replace(RECURRING_TEMPLATES_HREF)
    else back()
  }

  async function onSave() {
    if (saving) return
    setAttempted(true)
    const invalid =
      draft.title.trim().length === 0 ||
      draft.title.length > TITLE_MAX ||
      !!descriptionError ||
      draft.assignees.length === 0 ||
      (!!schedule && !!scheduleEntryError(schedule))
    if (invalid) {
      // The messages render on the next paint; focus the first marked field after it.
      focusFirstInvalid(formRef.current)
      return
    }
    setSaving(true)
    try {
      if (schedule) {
        await tasksApi.createRecurring(
          orgId,
          buildRecurringPayload({
            title: draft.title,
            description: draft.description,
            priorityId: draft.priorityId,
            scheduleEntries: [schedule],
            completionMode: 'any_can_complete',
            proofRequired: false,
            proofAllowedExtensions: [],
            escalationIds: [],
            assignees: draft.assignees,
            checklistItems: undefined,
            reminders: buildReminderSpecs([makeReminderRow({ offsetDays: reminderDays })], false),
          }),
        )
        recurring.current = true
        setSaved(true)
        fileDraft.clear()
        addToast('Recurring task created', 'success')
        if (shouldOfferPushNow(user?.id)) setOfferPush(true)
        else leave()
        return
      }
      await tasksApi.createTask(orgId, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        priority_id: draft.priorityId || undefined,
        deadline: draft.deadline ? new Date(draft.deadline.length === 10 ? `${draft.deadline}T23:59` : draft.deadline).toISOString() : undefined,
        assignee_user_ids: draft.assignees.map((a) => a.user_id),
      })
      setSaved(true)
      fileDraft.clear()
      addToast('Task created', 'success')
      // The first useful moment to ask (plan §9, kit §41.12 rule 4): giving a
      // task is something you'd want to hear back about. Offered at most once
      // until declined/granted/denied; the screen still navigates back either way.
      if (shouldOfferPushNow(user?.id)) {
        setOfferPush(true)
      } else {
        leave()
      }
    } catch {
      addToast(schedule ? 'Could not create the recurring task. Check your connection and try again.' : 'Could not create the task. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function onDiscard() {
    fileDraft.clear()
    setDraft(EMPTY_DRAFT)
    back()
  }

  return (
    <PhoneScreen title="Give task" parent={route.parent ?? PHONE_HOME}>
      {unsaved.warning}
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-[20px] pb-[80px]"
        onKeyDown={enterMovesNext}
        onSubmit={(e) => e.preventDefault()}
      >
        <DraftBanner
          draft={fileDraft}
          onUse={(kept) => {
            setDraft((d) => ({ ...d, ...kept }))
            if (kept.description) setShowDescription(true)
          }}
        />

        <PhoneField label="Title" htmlFor="task-title" required error={titleError}>
          <input
            id="task-title"
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onBlur={() => setTitleTouched(true)}
            placeholder="For example, Send the quarterly report"
            maxLength={TITLE_MAX + 20}
            enterKeyHint="next"
            autoComplete="off"
            autoFocus
            aria-invalid={titleError ? true : undefined}
            className={PHONE_INPUT}
          />
        </PhoneField>

        <PhoneField label="Assignees" htmlFor="task-assignees" required error={noAssigneeError}>
          <div className="flex flex-col gap-[8px]">
            <button
              id="task-assignees"
              type="button"
              data-field
              aria-invalid={noAssigneeError ? true : undefined}
              onClick={() => setAssigneePicker(true)}
              className={cx(ROW, 'mx-0 rounded-[8px] border bg-surface', noAssigneeError ? 'border-danger' : 'border-border-strong')}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {draft.assignees.length === 0 ? (
                  <span className="text-text-secondary">Choose who this is for</span>
                ) : (
                  <span>{draft.assignees.length} chosen</span>
                )}
              </span>
            </button>
            <SelectedPeopleList
              people={draft.assignees}
              onRemove={(id) => setDraft((d) => ({ ...d, assignees: d.assignees.filter((a) => a.user_id !== id) }))}
            />
          </div>
        </PhoneField>

        {/* When: Repeat first, then either the one-off Due date or the schedule
            fields in its place - one decision, in one place. */}
        <PhoneField label="Repeat">
          <Select
            value={schedule?.schedule_type ?? 'none'}
            items={REPEAT_ITEMS}
            onValueChange={(value) => {
              setAttempted(false)
              setDraft((d) => {
                if (!value || value === 'none') return { ...d, schedule: null }
                const next = entryForFrequency(d.schedule, value as RecurringScheduleType)
                // Switching from a one-off due date: carry its date and time over as the
                // schedule's start, so what the user already picked is not thrown away.
                if (!d.schedule && d.deadline) {
                  next.start_date = d.deadline.slice(0, 10)
                  if (d.deadline.length >= 16) next.time = d.deadline.slice(11, 16)
                }
                return { ...d, schedule: next }
              })
            }}
          >
            <SelectTrigger aria-label="Repeat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REPEAT_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PhoneField>

        {schedule ? (
          <RepeatFields entry={schedule} onChange={(next) => setDraft((d) => ({ ...d, schedule: next }))} showErrors={attempted} />
        ) : null}

        {schedule ? null : (
          <div className="grid grid-cols-2 gap-[12px]">
            <PhoneDateField
              id="task-due-date"
              label="Due date"
              value={draft.deadline.slice(0, 10)}
              onChange={(v) => setDraft((d) => ({ ...d, deadline: v ? `${v}${d.deadline.length >= 16 ? d.deadline.slice(10) : ''}` : '' }))}
            />
            <PhoneTimeField
              id="task-due-time"
              label="Due time"
              value={draft.deadline.slice(11, 16)}
              onChange={(v) =>
                setDraft((d) => ({ ...d, deadline: d.deadline.length >= 10 ? `${d.deadline.slice(0, 10)}${v ? `T${v}` : ''}` : d.deadline }))
              }
            />
          </div>
        )}

        <PhoneField label="Priority">
          <Select
            value={draft.priorityId || 'none'}
            items={{ none: 'No priority', ...Object.fromEntries(priorities.map((p) => [p.id, p.label])) }}
            onValueChange={(value) => setDraft((d) => ({ ...d, priorityId: !value || value === 'none' ? '' : String(value) }))}
          >
            <SelectTrigger aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No priority</SelectItem>
              {priorities.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PhoneField>

        {showDescription ? (
          <PhoneField label="Description" htmlFor="task-description" error={descriptionError}>
            <GrowTextarea
              id="task-description"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              rows={4}
              aria-invalid={descriptionError ? true : undefined}
              className={cx(PHONE_INPUT, 'py-[10px]')}
            />
          </PhoneField>
        ) : (
          <button type="button" onClick={() => setShowDescription(true)} className="flex min-h-[44px] items-center self-start text-label font-medium text-primary-text">
            Add description
          </button>
        )}

        {(draft.title || draft.description) ? (
          <button type="button" onClick={onDiscard} className="flex min-h-[44px] items-center self-start text-label font-medium text-danger">
            Discard draft
          </button>
        ) : null}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-(--z-shell) flex gap-[8px] border-t border-border-light bg-surface px-[16px] pt-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton type="button" variant="primary" fullWidth loading={saving} onClick={() => void onSave()}>
          {schedule ? "Save recurring task" : "Save task"}
        </PhoneButton>
      </div>

      <AssigneePicker
        open={assigneePicker}
        onOpenChange={setAssigneePicker}
        orgId={orgId}
        currentUser={user ? { user_id: user.id, name: user.name } : undefined}
        selected={draft.assignees}
        onDone={(assignees) => setDraft((d) => ({ ...d, assignees }))}
      />

      <NotificationOfferSheet
        orgId={orgId}
        open={offerPush}
        onOpenChange={(open) => {
          setOfferPush(open)
          if (!open) leave()
        }}
        onDeclined={() => declinePushOffer(user?.id)}
      />
    </PhoneScreen>
  )
}

const REPEAT_ITEMS: Record<string, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const ASSIGNEE_SORTS: { key: AssigneeSortMode; label: string }[] = [
  { key: 'frequency', label: 'Frequent' },
  { key: 'workload', label: 'Workload' },
  { key: 'name', label: 'A-Z' },
]

/* Task assignees: the shared people picker fed by useEligibleAssignees. */
function AssigneePicker({
  open,
  onOpenChange,
  orgId,
  currentUser,
  selected,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  currentUser?: PickedPerson
  selected: PickedPerson[]
  onDone: (selected: PickedPerson[]) => void
}) {
  const { search, setSearch, sort, setSort, loading, failed, departments, data, reload } = useEligibleAssignees({
    orgId,
    open,
    currentUserId: currentUser?.user_id,
  })
  const sections: PickerSection[] = departments.map((d) => ({
    id: d.department_id,
    name: d.department_id === 'search' ? undefined : d.department_name,
    people: d.users.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      role: u.role_title,
      department: u.department_id === 'search' ? null : u.department_name,
      note: u.on_leave_today ? 'On leave' : null,
    })),
  }))
  const me = data?.departments.flatMap((d) => d.users).find((u) => u.user_id === currentUser?.user_id)
  return (
    <PeoplePickerSheet<AssigneeSortMode>
      open={open}
      onOpenChange={onOpenChange}
      title="Assign to"
      sections={sections}
      loading={loading}
      failed={failed}
      onRetry={reload}
      currentUser={currentUser ? { ...currentUser, role: me?.role_title, department: me?.department_name } : undefined}
      meLabel="Assign to me"
      selected={selected}
      onDone={(people) => onDone(people)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by name, role or department"
      sort={{ value: sort, onChange: setSort, options: ASSIGNEE_SORTS }}
    />
  )
}
