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
import { DraftBanner } from '../DraftBanner'
import { shouldOfferPushNow, declinePushOffer } from '@/lib/push'
import PhoneScreen from '../PhoneScreen'
import { PeoplePickerSheet, SelectedPeopleList, type PickedPerson, type PickerSection } from '../PeoplePickerSheet'
import { useEligibleAssignees, type AssigneeSortMode } from '@/components/tasks/useEligibleAssignees'
import { NotificationOfferSheet } from '../NotificationOfferSheet'
import { RepeatFields, entryForFrequency } from '../RepeatFields'
import { PhoneButton, ROW, cx } from '../primitives'

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
  const [reminderDays, setReminderDays] = React.useState(1)
  const recurring = React.useRef(false)

  const draft = draftValues
  const fileDraft = useDraft<GiveTaskValues>({
    person: user?.id,
    form: 'task-give',
    record: 'new',
    values: draftValues,
  })

  React.useEffect(() => {
    if (!orgId) return
    tasksApi.getPriorities(orgId).then(setPriorities).catch(() => {})
    // The desktop seeds one reminder from this default on a new task.
    tasksApi.getConfig(orgId).then((cfg) => setReminderDays(cfg?.default_reminder_days_before ?? 1)).catch(() => {})
  }, [orgId])

  const titleError = draft.title.length > TITLE_MAX ? `Title must be ${TITLE_MAX} characters or fewer` : null
  const descriptionError = draft.description.length > DESCRIPTION_MAX ? `Description must be ${DESCRIPTION_MAX} characters or fewer` : null
  const schedule = draft.schedule
  const noAssigneeError = schedule && attempted && draft.assignees.length === 0 ? 'At least one assignee is required.' : null
  const canSave = draft.title.trim().length > 0 && !titleError && !descriptionError && !saving

  /** Leaves after a save: the recurring list for a template, otherwise back. */
  function leave() {
    if (recurring.current) router.replace(RECURRING_TEMPLATES_HREF)
    else back()
  }

  async function onSave() {
    if (!canSave) return
    if (schedule) {
      setAttempted(true)
      if (draft.assignees.length === 0 || scheduleEntryError(schedule)) return
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
        deadline: draft.deadline ? new Date(draft.deadline).toISOString() : undefined,
        assignee_user_ids: draft.assignees.map((a) => a.user_id),
      })
      fileDraft.clear()
      addToast('Task given', 'success')
      // The first useful moment to ask (plan §9, kit §41.12 rule 4): giving a
      // task is something you'd want to hear back about. Offered at most once
      // until declined/granted/denied; the screen still navigates back either way.
      if (shouldOfferPushNow(user?.id)) {
        setOfferPush(true)
      } else {
        leave()
      }
    } catch {
      addToast(schedule ? 'Could not create the recurring task. Try again.' : 'Could not give the task. Try again.', 'error')
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
      <form
        className="flex flex-col gap-[20px] pb-[80px]"
        onSubmit={(e) => {
          e.preventDefault()
          void onSave()
        }}
      >
        <DraftBanner
          draft={fileDraft}
          onUse={(kept) => {
            setDraft((d) => ({ ...d, ...kept }))
            if (kept.description) setShowDescription(true)
          }}
        />

        <Field label="Title" error={titleError}>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="What needs to be done?"
            maxLength={TITLE_MAX + 20}
            autoFocus
            className={cx(
              'min-h-(--h-control) w-full rounded-[8px] border bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary',
              titleError ? 'border-danger' : 'border-border-strong',
            )}
          />
        </Field>

        <Field label="Assignee(s)" error={noAssigneeError}>
          <div className="flex flex-col gap-[8px]">
            <button type="button" onClick={() => setAssigneePicker(true)} className={cx(ROW, 'mx-0 rounded-[8px] border border-border-strong bg-surface')}>
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
        </Field>

        {/* When: Repeat first, then either the one-off Due date or the schedule
            fields in its place - one decision, in one place. */}
        <Field label="Repeat">
          <select
            value={schedule?.schedule_type ?? ''}
            onChange={(e) => {
              setAttempted(false)
              setDraft((d) => {
                if (!e.target.value) return { ...d, schedule: null }
                const next = entryForFrequency(d.schedule, e.target.value as RecurringScheduleType)
                // Switching from a one-off due date: carry its date and time over as the
                // schedule's start, so what the user already picked is not thrown away.
                if (!d.schedule && d.deadline) {
                  next.start_date = d.deadline.slice(0, 10)
                  if (d.deadline.length >= 16) next.time = d.deadline.slice(11, 16)
                }
                return { ...d, schedule: next }
              })
            }}
            className="min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary"
          >
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>

        {schedule ? (
          <RepeatFields entry={schedule} onChange={(next) => setDraft((d) => ({ ...d, schedule: next }))} showErrors={attempted} />
        ) : null}

        {schedule ? null : (
        <Field label="Due date">
          <input
            type="datetime-local"
            value={draft.deadline}
            onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
            className="min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary"
          />
        </Field>
        )}

        <Field label="Priority">
          <select
            value={draft.priorityId}
            onChange={(e) => setDraft((d) => ({ ...d, priorityId: e.target.value }))}
            className="min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary"
          >
            <option value="">No priority</option>
            {priorities.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {showDescription ? (
          <Field label="Description" error={descriptionError}>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              rows={4}
              className={cx(
                'w-full resize-none rounded-[8px] border bg-surface px-[12px] py-[10px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary',
                descriptionError ? 'border-danger' : 'border-border-strong',
              )}
            />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowDescription(true)} className="self-start text-label font-medium text-primary-text">
            + Add description
          </button>
        )}

        {(draft.title || draft.description) ? (
          <button type="button" onClick={onDiscard} className="self-start text-label font-medium text-danger">
            Discard draft
          </button>
        ) : null}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-30 flex gap-[8px] border-t border-border-light bg-surface px-[16px] pt-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton type="button" variant="primary" fullWidth disabled={!canSave} title={!draft.title.trim() ? 'A title is required' : undefined} onClick={() => void onSave()}>
          {saving ? 'Saving…' : schedule ? 'Save recurring task' : 'Save'}
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

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-label font-medium text-text-secondary">{label}</span>
      {children}
      {error ? <span className="text-meta text-danger">{error}</span> : null}
    </label>
  )
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
