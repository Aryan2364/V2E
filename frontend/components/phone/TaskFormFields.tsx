'use client'

import React from 'react'
import { Check, Plus, X } from 'lucide-react'
import { isTagConflictError, tagErrorMessage, tasksApi } from '@/lib/api/tasks'
import { holidaysApi } from '@/lib/api/holidays'
import { leaveApi } from '@/lib/api/leave'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { todayIso, leaveHorizon } from '@/lib/leave-availability'
import { formatDate } from '@/lib/format'
import type { HolidayCheckResult } from '@/lib/types/holidays'
import type { LeaveAvailability } from '@/lib/types/leave'
import LeaveWarningBadge from '@/components/leave/LeaveWarningBadge'
import { makeReminderRow, reminderIsPast, reminderLabel, type ReminderRow } from '@/components/tasks/RemindersField'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import { tagDotClass } from '@/lib/tasks/tagColors'
import { MAX_TAGS_PER_TASK } from '@/lib/types/tasks'
import type { ChecklistTemplate, CompletionMode, TaskPriority, TaskTagRef } from '@/lib/types/tasks'
import { buildChecklistItems, type ChecklistGroup } from '@/components/tasks/ChecklistBuilderField'
import { useEligibleAssignees, type AssigneeSortMode } from '@/components/tasks/useEligibleAssignees'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PeoplePickerSheet, SelectedPeopleList, type PickedPerson, type PickerSection } from './PeoplePickerSheet'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, PhoneField, GrowTextarea, ROW, PHONE_INPUT, cx } from './primitives'
import { PhoneDateField, PhoneTimeField } from './PhoneDateTimeField'

/*
 * The task form's fields, shared by Give task and Edit task so the two
 * screens cannot drift (plan-phone-2026-10-14.md section 5.4). The screens own
 * their values, validation and save; this file draws the fields and holds the
 * pieces both need: the people pickers, the tag and checklist helpers and the
 * "keep this date anyway" dialog.
 *
 *   - Assignees and CC are two separate people fields. A person is one or the
 *     other: choosing them in one removes them from the other.
 *   - The less-used fields (CC, checklist, tags, reminders) sit behind "Add ..."
 *     rows, like "Add description", until they hold something.
 *   - Under the due date: the computer's holiday and leave notes (holidaysApi
 *     .checkDate, leaveApi.availability). Notes only - they never block; the
 *     "Keep this date anyway?" dialog below stays the way to go on.
 *   - Reminders (only where the screen passes `reminders`): the computer's
 *     reminder rows, edited in a sheet. Edit task passes none, as the
 *     computer's edit dialog has none.
 *   - A new tag can be made from the tag sheet by someone the computer's tag
 *     picker would let create one.
 *   - Everything the form does not show takes the computer's defaults.
 */

export const TITLE_MAX = 50
export const DESCRIPTION_MAX = 2000
const CHECKLIST_ITEM_MAX = 200

export type TaskFormValues = {
  title: string
  description: string
  /** Local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; empty = no due date. */
  deadline: string
  priorityId: string
  assignees: PickedPerson[]
  cc: PickedPerson[]
  tags: Pick<TaskTagRef, 'id' | 'name' | 'color' | 'is_active'>[]
  checklist: ChecklistGroup[]
  proofRequired: boolean
  completionMode: CompletionMode
}

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: '',
  description: '',
  deadline: '',
  priorityId: '',
  assignees: [],
  cc: [],
  tags: [],
  checklist: [],
  proofRequired: false,
  completionMode: 'any_can_complete',
}

/** A due date without a time lands at the end of that day, as on the computer; sent as an instant. */
export function deadlineToIso(deadline: string): string | undefined {
  if (!deadline) return undefined
  return new Date(deadline.length === 10 ? `${deadline}T23:59` : deadline).toISOString()
}

/** The same instant as the local "YYYY-MM-DDTHH:mm" the date and time fields hold. */
export function isoToLocalDeadline(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The checklist as the computer's payload sends it: blank items dropped, then the desktop builder. */
export function cleanChecklist(groups: ChecklistGroup[]): ChecklistGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.title.trim().length > 0).map((i) => ({ ...i, title: i.title.trim() })) }))
}

export function checklistPayload(groups: ChecklistGroup[]) {
  return {
    checklist_items: buildChecklistItems(cleanChecklist(groups)),
    checklist_template_ids: Array.from(new Set(groups.filter((g) => g.templateId).map((g) => g.templateId as string))),
  }
}

/** True when the backend refused only because the date is a non-working day (the person may keep it). */
export const isHolidayRefusal = (message: string) => /non-working day/i.test(message)

let groupSeq = 0
const newGroupKey = () => `p${Date.now().toString(36)}${(groupSeq += 1)}`

const COMPLETION_ITEMS: Record<string, string> = {
  any_can_complete: 'Any one completes it',
  all_must_complete: 'Everyone must complete it',
}

const LINK_BUTTON = 'flex min-h-[44px] items-center gap-[4px] self-start text-label font-medium text-primary-text'

export function TaskFormFields<V extends TaskFormValues>({
  values,
  setValues,
  priorities,
  orgId,
  idPrefix,
  titleError,
  descriptionError,
  assigneesError,
  autoFocusTitle = false,
  onTitleBlur,
  beforeWhen,
  when,
  allowNoPriority = true,
  reminders,
}: {
  values: V
  setValues: React.Dispatch<React.SetStateAction<V>>
  priorities: TaskPriority[]
  orgId: string
  idPrefix: string
  titleError?: string | null
  descriptionError?: string | null
  assigneesError?: string | null
  autoFocusTitle?: boolean
  onTitleBlur?: () => void
  /** Drawn between the people and the due date (Give task's Repeat). */
  beforeWhen?: React.ReactNode
  /** Replaces the due date and time (Give task's schedule fields). */
  when?: React.ReactNode
  /** Edit cannot clear a priority the task already has, as on the computer. */
  allowNoPriority?: boolean
  /** Give task (one-off and repeating) holds reminders; Edit task does not. */
  reminders?: { rows: ReminderRow[]; onChange: (rows: ReminderRow[]) => void; mode: 'one_time' | 'recurring' }
}) {
  const { user } = useAuth()
  const me = user ? { user_id: user.id, name: user.name } : undefined
  const [picker, setPicker] = React.useState<'assignees' | 'cc' | null>(null)
  const [ccOpen, setCcOpen] = React.useState(false)
  const [descriptionOpen, setDescriptionOpen] = React.useState(false)
  const showCc = ccOpen || values.cc.length > 0
  const showDescription = descriptionOpen || values.description.length > 0

  const set = (patch: Partial<TaskFormValues>) => setValues((v) => ({ ...v, ...patch }))

  const setAssignees = (assignees: PickedPerson[]) =>
    setValues((v) => ({
      ...v,
      assignees,
      cc: v.cc.filter((c) => !assignees.some((a) => a.user_id === c.user_id)),
      completionMode: assignees.length <= 1 ? 'any_can_complete' : v.completionMode,
    }))
  const setCc = (cc: PickedPerson[]) =>
    setValues((v) => {
      const assignees = v.assignees.filter((a) => !cc.some((c) => c.user_id === a.user_id))
      return { ...v, cc, assignees, completionMode: assignees.length <= 1 ? 'any_can_complete' : v.completionMode }
    })

  return (
    <>
      <PhoneField label="Title" htmlFor={`${idPrefix}-title`} required error={titleError}>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          onBlur={onTitleBlur}
          placeholder="For example, Send the quarterly report"
          maxLength={TITLE_MAX + 20}
          enterKeyHint="next"
          autoComplete="off"
          autoFocus={autoFocusTitle}
          aria-invalid={titleError ? true : undefined}
          className={PHONE_INPUT}
        />
      </PhoneField>

      <PhoneField label="Assignees" htmlFor={`${idPrefix}-assignees`} required error={assigneesError}>
        <div className="flex flex-col gap-[8px]">
          <button
            id={`${idPrefix}-assignees`}
            type="button"
            data-field
            aria-invalid={assigneesError ? true : undefined}
            onClick={() => setPicker('assignees')}
            className={cx(ROW, 'mx-0 rounded-[8px] border bg-surface', assigneesError ? 'border-danger' : 'border-border-strong')}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {values.assignees.length === 0 ? (
                <span className="text-text-secondary">Choose who this is for</span>
              ) : (
                <span>{values.assignees.length} chosen</span>
              )}
            </span>
          </button>
          <SelectedPeopleList people={values.assignees} onRemove={(id) => setAssignees(values.assignees.filter((a) => a.user_id !== id))} />
        </div>
      </PhoneField>

      {showCc ? (
        <PhoneField label="CC" htmlFor={`${idPrefix}-cc`}>
          <div className="flex flex-col gap-[8px]">
            <button
              id={`${idPrefix}-cc`}
              type="button"
              data-field
              onClick={() => setPicker('cc')}
              className={cx(ROW, 'mx-0 rounded-[8px] border border-border-strong bg-surface')}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {values.cc.length === 0 ? (
                  <span className="text-text-secondary">Choose who to keep in the loop</span>
                ) : (
                  <span>{values.cc.length} chosen</span>
                )}
              </span>
            </button>
            <SelectedPeopleList people={values.cc} onRemove={(id) => setCc(values.cc.filter((c) => c.user_id !== id))} />
          </div>
        </PhoneField>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCcOpen(true)
            setPicker('cc')
          }}
          className={LINK_BUTTON}
        >
          <Plus aria-hidden className="size-[16px]" />
          Add CC
        </button>
      )}

      {values.assignees.length >= 2 ? (
        <PhoneField label="Who completes it">
          <Select
            value={values.completionMode}
            items={COMPLETION_ITEMS}
            onValueChange={(value) => set({ completionMode: value === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete' })}
          >
            <SelectTrigger aria-label="Who completes it">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(COMPLETION_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PhoneField>
      ) : null}

      {beforeWhen}

      {when ?? (
        <div className="flex flex-col gap-[8px]">
          <div className="grid grid-cols-2 gap-[12px]">
            <PhoneDateField
              id={`${idPrefix}-due-date`}
              label="Due date"
              value={values.deadline.slice(0, 10)}
              onChange={(v) => setValues((d) => ({ ...d, deadline: v ? `${v}${d.deadline.length >= 16 ? d.deadline.slice(10) : ''}` : '' }))}
            />
            <PhoneTimeField
              id={`${idPrefix}-due-time`}
              label="Due time"
              value={values.deadline.slice(11, 16)}
              onChange={(v) =>
                setValues((d) => ({ ...d, deadline: d.deadline.length >= 10 ? `${d.deadline.slice(0, 10)}${v ? `T${v}` : ''}` : d.deadline }))
              }
            />
          </div>
          <DueDateNotes orgId={orgId} date={values.deadline.slice(0, 10)} assigneeIds={values.assignees.map((a) => a.user_id)} />
        </div>
      )}

      <PhoneField label="Priority">
        <Select
          value={values.priorityId || 'none'}
          items={{ none: 'No priority', ...Object.fromEntries(priorities.map((p) => [p.id, p.label])) }}
          onValueChange={(value) => set({ priorityId: !value || value === 'none' ? '' : String(value) })}
        >
          <SelectTrigger aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowNoPriority || !values.priorityId ? <SelectItem value="none">No priority</SelectItem> : null}
            {priorities.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PhoneField>

      {showDescription ? (
        <PhoneField label="Description" htmlFor={`${idPrefix}-description`} error={descriptionError}>
          <GrowTextarea
            id={`${idPrefix}-description`}
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={4}
            aria-invalid={descriptionError ? true : undefined}
            className={cx(PHONE_INPUT, 'py-[10px]')}
          />
        </PhoneField>
      ) : (
        <button type="button" onClick={() => setDescriptionOpen(true)} className={LINK_BUTTON}>
          <Plus aria-hidden className="size-[16px]" />
          Add description
        </button>
      )}

      <ChecklistField orgId={orgId} groups={values.checklist} onChange={(checklist) => set({ checklist })} />

      <TagsField orgId={orgId} tags={values.tags} onChange={(tags) => set({ tags })} />

      {reminders ? (
        <RemindersSection
          rows={reminders.rows}
          onChange={reminders.onChange}
          mode={reminders.mode}
          deadlineDate={values.deadline.slice(0, 10)}
        />
      ) : null}

      <label className="flex min-h-[48px] items-start gap-[12px] py-[8px] text-body text-text-primary">
        <input
          type="checkbox"
          checked={values.proofRequired}
          onChange={(e) => set({ proofRequired: e.target.checked })}
          className="mt-[2px] size-[20px] shrink-0 accent-primary"
        />
        <span className="flex flex-col">
          <span>Proof required</span>
          <span className="text-meta text-text-secondary">The assignee attaches a file when they finish.</span>
        </span>
      </label>

      <TaskPeoplePicker
        open={picker === 'assignees'}
        onOpenChange={(open) => !open && setPicker(null)}
        orgId={orgId}
        currentUser={me}
        selected={values.assignees}
        onDone={setAssignees}
        title="Assign to"
        meLabel="Assign to me"
      />
      <TaskPeoplePicker
        open={picker === 'cc'}
        onOpenChange={(open) => !open && setPicker(null)}
        orgId={orgId}
        currentUser={me}
        selected={values.cc}
        onDone={setCc}
        title="CC"
        meLabel="CC me"
      />
    </>
  )
}

const PEOPLE_SORTS: { key: AssigneeSortMode; label: string }[] = [
  { key: 'frequency', label: 'Frequent' },
  { key: 'workload', label: 'Workload' },
  { key: 'name', label: 'A-Z' },
]

/* Task assignees and CC: the shared people picker fed by useEligibleAssignees. */
function TaskPeoplePicker({
  open,
  onOpenChange,
  orgId,
  currentUser,
  selected,
  onDone,
  title,
  meLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  currentUser?: PickedPerson
  selected: PickedPerson[]
  onDone: (selected: PickedPerson[]) => void
  title: string
  meLabel: string
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
      title={title}
      sections={sections}
      loading={loading}
      failed={failed}
      onRetry={reload}
      currentUser={currentUser ? { ...currentUser, role: me?.role_title, department: me?.department_name } : undefined}
      meLabel={meLabel}
      selected={selected}
      onDone={(people) => onDone(people)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by name, role or department"
      sort={{ value: sort, onChange: setSort, options: PEOPLE_SORTS }}
    />
  )
}

/* ---------------------------------- Tags ---------------------------------- */

/* Tags come from the same list the computer's tag picker uses (useTaskTags). A new tag can be created in the sheet by someone the computer's picker lets create one. */
function TagsField({
  orgId,
  tags,
  onChange,
}: {
  orgId: string
  tags: TaskFormValues['tags']
  onChange: (tags: TaskFormValues['tags']) => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      {tags.length === 0 ? (
        <button type="button" onClick={() => setOpen(true)} className={LINK_BUTTON}>
          <Plus aria-hidden className="size-[16px]" />
          Add tags
        </button>
      ) : (
        <PhoneField label="Tags">
          <div className="flex flex-col gap-[8px]">
            <ul className="flex flex-col divide-y divide-border-light rounded-[8px] border border-border-light bg-surface">
              {tags.map((t) => (
                <li key={t.id} className="flex min-h-[48px] items-center gap-[12px] pl-[12px]">
                  <span aria-hidden className={cx('size-[10px] shrink-0 rounded-full', tagDotClass(t.color, !t.is_active))} />
                  <span className="min-w-0 flex-1 truncate text-body text-text-primary">{t.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => onChange(tags.filter((x) => x.id !== t.id))}
                    className="flex size-[44px] shrink-0 items-center justify-center text-text-secondary active:bg-surface-control"
                  >
                    <X aria-hidden className="size-[18px]" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setOpen(true)} className={LINK_BUTTON}>
              <Plus aria-hidden className="size-[16px]" />
              Change tags
            </button>
          </div>
        </PhoneField>
      )}
      <TagsSheet open={open} onOpenChange={setOpen} orgId={orgId} selected={tags} onDone={onChange} />
    </>
  )
}

function TagsSheet({
  open,
  onOpenChange,
  orgId,
  selected,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  selected: TaskFormValues['tags']
  onDone: (tags: TaskFormValues['tags']) => void
}) {
  const { tags, loading, error, reload, createTag } = useTaskTags(open ? orgId : null, { includeInactive: true })
  const perms = usePermissions()
  // The computer's tag picker rule (TagPicker.tsx): creating is offered only to someone who may. Unknown yet = not offered.
  const canCreate = !perms.loading && (perms.isAdmin || perms.can('tasks.tags.create', 'write') || perms.can('tasks.config.tags.manage', 'write'))
  const [draft, setDraft] = React.useState<TaskFormValues['tags']>(selected)
  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  React.useEffect(() => {
    // Each opening starts from what the form holds.
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(selected)
      setNewName('')
      setCreateError(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onCreate() {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const tag = await createTag(name)
      setNewName('')
      setDraft((cur) =>
        cur.some((x) => x.id === tag.id) || cur.length >= MAX_TAGS_PER_TASK
          ? cur
          : [...cur, { id: tag.id, name: tag.name, color: tag.color, is_active: tag.is_active }],
      )
    } catch (e) {
      setCreateError(
        isTagConflictError(e) ? 'A tag with that name already exists. Choose it from the list.' : tagErrorMessage(e, 'Could not create that tag. Try again.'),
      )
    } finally {
      setCreating(false)
    }
  }

  // Active tags can be added; an inactive one stays only while it is already on the task.
  const options = [
    ...tags.filter((t) => t.is_active),
    ...selected.filter((s) => !s.is_active && !tags.some((t) => t.id === s.id)),
    ...tags.filter((t) => !t.is_active && selected.some((s) => s.id === t.id)),
  ]
  const full = draft.length >= MAX_TAGS_PER_TASK

  function toggle(t: TaskFormValues['tags'][number]) {
    setDraft((cur) =>
      cur.some((x) => x.id === t.id)
        ? cur.filter((x) => x.id !== t.id)
        : cur.length >= MAX_TAGS_PER_TASK
          ? cur
          : [...cur, { id: t.id, name: t.name, color: t.color, is_active: t.is_active }],
    )
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Tags"
      footer={
        <PhoneButton
          variant="primary"
          fullWidth
          onClick={() => {
            onDone(draft)
            onOpenChange(false)
          }}
        >
          Done
        </PhoneButton>
      }
    >
      {loading ? (
        <p className="py-[16px] text-body text-text-secondary">Loading tags...</p>
      ) : error ? (
        <div className="flex flex-col items-start gap-[8px] py-[16px]">
          <p className="text-body text-text-secondary">Tags could not be loaded. Check your connection, then try again.</p>
          <PhoneButton variant="secondary" onClick={() => void reload()}>
            Try again
          </PhoneButton>
        </div>
      ) : (
        <>
          {canCreate ? (
            <div className="flex flex-col gap-[6px] pb-[12px]">
              <div className="flex items-center gap-[8px]">
                <input
                  type="text"
                  aria-label="New tag name"
                  value={newName}
                  placeholder="New tag name"
                  maxLength={50}
                  disabled={full}
                  onChange={(e) => {
                    setNewName(e.target.value)
                    setCreateError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                    e.preventDefault()
                    e.stopPropagation()
                    void onCreate()
                  }}
                  enterKeyHint="done"
                  autoComplete="off"
                  aria-invalid={createError ? true : undefined}
                  className={PHONE_INPUT}
                />
                <PhoneButton variant="secondary" loading={creating} disabled={full || newName.trim().length === 0} onClick={() => void onCreate()}>
                  Create
                </PhoneButton>
              </div>
              {createError ? (
                <p role="alert" className="text-meta text-danger">
                  {createError}
                </p>
              ) : null}
            </div>
          ) : null}
          {options.length === 0 ? (
            <p className="py-[16px] text-body text-text-secondary">
              {canCreate ? 'Your organisation has no tags yet. Type a name above to create one.' : 'Your organisation has no tags yet.'}
            </p>
          ) : null}
          {full ?<p className="px-[16px] pb-[8px] text-meta text-text-secondary">Up to {MAX_TAGS_PER_TASK} tags per task.</p> : null}
          <ul className="divide-y divide-border-light">
            {options.map((t) => {
              const on = draft.some((x) => x.id === t.id)
              const blocked = !on && (full || !t.is_active)
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={blocked}
                    onClick={() => toggle(t)}
                    className={cx(ROW, blocked && 'text-text-secondary')}
                  >
                    <span aria-hidden className={cx('size-[10px] shrink-0 rounded-full', tagDotClass(t.color, !t.is_active))} />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {on ? <Check aria-hidden className="size-[18px] shrink-0 text-primary-text" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </PhoneSheet>
  )
}

/* -------------------------------- Checklist -------------------------------- */

/*
 * A simple list of items. Under the hood it is the computer's own
 * ChecklistGroup list, so the payload is the same: an applied template is a
 * group of its own and "Add an item" always goes to the last custom group.
 * An item that already exists on the task keeps its `id`, so its ticks survive
 * an edit.
 */
function ChecklistField({
  orgId,
  groups,
  onChange,
}: {
  orgId: string
  groups: ChecklistGroup[]
  onChange: (groups: ChecklistGroup[]) => void
}) {
  const [opened, setOpened] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [templateSheet, setTemplateSheet] = React.useState(false)
  const [templates, setTemplates] = React.useState<ChecklistTemplate[] | null>(null)
  const [templatesFailed, setTemplatesFailed] = React.useState(false)
  const show = opened || groups.length > 0

  function loadTemplates() {
    tasksApi
      .getAccessibleChecklistTemplates(orgId)
      .then(setTemplates)
      .catch(() => {
        setTemplates([])
        setTemplatesFailed(true)
      })
  }
  React.useEffect(() => {
    if (templateSheet && templates === null && orgId) loadTemplates()
  }, [templateSheet]) // eslint-disable-line react-hooks/exhaustive-deps

  function addItem() {
    const title = draft.trim().slice(0, CHECKLIST_ITEM_MAX)
    if (!title) return
    setDraft('')
    const lastCustom = [...groups].reverse().find((g) => g.source === 'custom')
    if (lastCustom) {
      onChange(groups.map((g) => (g.key === lastCustom.key ? { ...g, items: [...g.items, { title }] } : g)))
    } else {
      onChange([
        ...groups,
        { key: newGroupKey(), title: groups.length === 0 ? 'Checklist' : `Checklist ${groups.length + 1}`, source: 'custom', items: [{ title }], draft: '' },
      ])
    }
  }

  function applyTemplate(tpl: ChecklistTemplate) {
    const sorted = [...(tpl.items ?? [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    onChange([
      ...groups,
      { key: newGroupKey(), title: tpl.name, source: 'template', templateId: tpl.id, items: sorted.map((i) => ({ title: i.title })), draft: '' },
    ])
    setTemplateSheet(false)
  }

  const editItem = (key: string, index: number, title: string) =>
    onChange(groups.map((g) => (g.key === key ? { ...g, items: g.items.map((it, i) => (i === index ? { ...it, title } : it)) } : g)))
  const removeItem = (key: string, index: number) =>
    onChange(groups.map((g) => (g.key === key ? { ...g, items: g.items.filter((_, i) => i !== index) } : g)).filter((g) => g.items.length > 0 || g.source === 'custom'))

  if (!show) {
    return (
      <button type="button" onClick={() => setOpened(true)} className={LINK_BUTTON}>
        <Plus aria-hidden className="size-[16px]" />
        Add checklist
      </button>
    )
  }

  const labelled = groups.length > 1 || groups.some((g) => g.source === 'template')
  return (
    <PhoneField label="Checklist">
      <div className="flex flex-col gap-[12px]">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-[8px]">
            {labelled && g.items.length > 0 ? <p className="text-label font-medium text-text-secondary">{g.title}</p> : null}
            {g.items.length > 0 ? (
              <ul className="flex flex-col gap-[8px]">
                {g.items.map((it, i) => (
                  <li key={it.id ?? `${g.key}-${i}`} className="flex items-center gap-[4px]">
                    <input
                      type="text"
                      aria-label={`Checklist item ${i + 1}`}
                      value={it.title}
                      maxLength={CHECKLIST_ITEM_MAX}
                      onChange={(e) => editItem(g.key, i, e.target.value)}
                      enterKeyHint="done"
                      autoComplete="off"
                      className={PHONE_INPUT}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${it.title || `item ${i + 1}`}`}
                      onClick={() => removeItem(g.key, i)}
                      className="flex size-[44px] shrink-0 items-center justify-center text-text-secondary active:bg-surface-control"
                    >
                      <X aria-hidden className="size-[18px]" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        <div className="flex items-center gap-[8px]">
          <input
            type="text"
            aria-label="New checklist item"
            value={draft}
            maxLength={CHECKLIST_ITEM_MAX}
            placeholder="Add an item"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={addItem}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              // Enter adds the item and stays here for the next one (it does not move on).
              e.preventDefault()
              e.stopPropagation()
              addItem()
            }}
            enterKeyHint="done"
            autoComplete="off"
            className={PHONE_INPUT}
          />
          <PhoneButton variant="secondary" onMouseDown={(e) => e.preventDefault()} onClick={addItem} disabled={draft.trim().length === 0}>
            Add
          </PhoneButton>
        </div>

        <button type="button" onClick={() => setTemplateSheet(true)} className={LINK_BUTTON}>
          <Plus aria-hidden className="size-[16px]" />
          Add from template
        </button>
      </div>

      <PhoneSheet open={templateSheet} onOpenChange={setTemplateSheet} title="Add from template">
        {templates === null ? (
          <p className="py-[16px] text-body text-text-secondary">Loading templates...</p>
        ) : templatesFailed ? (
          <div className="flex flex-col items-start gap-[8px] py-[16px]">
            <p className="text-body text-text-secondary">Templates could not be loaded. Check your connection, then try again.</p>
            <PhoneButton
              variant="secondary"
              onClick={() => {
                setTemplatesFailed(false)
                setTemplates(null)
                loadTemplates()
              }}
            >
              Try again
            </PhoneButton>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-[16px] text-body text-text-secondary">There are no checklist templates you can use.</p>
        ) : (
          <ul className="divide-y divide-border-light">
            {templates.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => applyTemplate(t)} className={ROW}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{t.name}</span>
                    <span className="text-meta text-text-secondary">{t.items?.length ?? 0} items</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PhoneSheet>
    </PhoneField>
  )
}

/* ------------------------- "Keep this date anyway?" ------------------------- */

/* The holiday rule never forces itself: the person may keep a non-working day. A styled dialog, never a native one. */
export function HolidayKeepDialog({
  message,
  busy,
  onKeep,
  onCancel,
}: {
  message: string | null
  busy?: boolean
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={message !== null} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Keep this date anyway?</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Change the date</AlertDialogCancel>
          <AlertDialogAction disabled={busy} loading={busy} onClick={onKeep}>
            Keep this date
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/* ------------------------- Holiday and leave notes ------------------------- */

/*
 * What the computer shows under the deadline (HolidayWarningBadge and
 * LeaveWarningBadge), as notes. The holiday check runs 300ms after the date
 * stops changing (CreateTaskModal); the leave check covers the chosen
 * assignees. Neither stops a save.
 */
function DueDateNotes({ orgId, date, assigneeIds }: { orgId: string; date: string; assigneeIds: string[] }) {
  // Each answer remembers what it was asked for, so a late answer for an older date is never shown.
  const [holiday, setHoliday] = React.useState<{ date: string; result: HolidayCheckResult | null } | null>(null)
  const [leave, setLeave] = React.useState<{ key: string; result: LeaveAvailability | null } | null>(null)
  const idsKey = [...assigneeIds].sort().join(',')

  React.useEffect(() => {
    if (!date || !orgId) return
    const t = window.setTimeout(() => {
      holidaysApi
        .checkDate(orgId, date)
        .then((result) => setHoliday({ date, result }))
        .catch(() => setHoliday({ date, result: null }))
    }, 300)
    return () => window.clearTimeout(t)
  }, [orgId, date])

  React.useEffect(() => {
    if (!date || !orgId || !idsKey) return
    let cancelled = false
    leaveApi
      .availability(orgId, idsKey.split(','), todayIso(), leaveHorizon())
      .then((result) => !cancelled && setLeave({ key: idsKey, result }))
      .catch(() => !cancelled && setLeave({ key: idsKey, result: null }))
    return () => {
      cancelled = true
    }
  }, [orgId, idsKey, !!date]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!date) return null
  const check = holiday?.date === date ? holiday.result : null
  const availability = leave?.key === idsKey ? leave.result : null
  return (
    <>
      <HolidayNote check={check} />
      <LeaveWarningBadge availability={availability} deadline={date} today={todayIso()} />
    </>
  )
}

function HolidayNote({ check }: { check: HolidayCheckResult | null }) {
  if (!check || check.is_working_day) return null
  const reason = check.reason ? `${check.reason} - ` : ''
  let text: string
  let tone: 'danger' | 'warning' = 'warning'
  if (check.action === 'create_anyway') {
    text = `${reason}This is a non-working day, but the task will still be created.`
  } else if (check.action === 'skip_create') {
    tone = 'danger'
    text = `${reason}Your organisation normally blocks tasks on this date. Change the date, or keep it when you save.`
  } else {
    const where = check.action === 'move_to_next_working_day' ? 'moved forward' : 'moved back'
    text = `${reason}Suggested: due date ${where}${check.adjusted_date ? ` to ${formatDate(new Date(check.adjusted_date))}` : ''}.`
  }
  return (
    <p
      className={cx(
        'rounded-[8px] border px-[12px] py-[8px] text-meta',
        tone === 'danger' ? 'border-danger-border bg-danger-bg text-danger' : 'border-warning-border bg-warning-bg text-warning',
      )}
    >
      {text}
    </p>
  )
}

/* -------------------------------- Reminders -------------------------------- */

/* The computer's reminder rows (components/tasks/RemindersField): days before the due date or a date, a time, and who else is told. */
function RemindersSection({
  rows,
  onChange,
  mode,
  deadlineDate,
}: {
  rows: ReminderRow[]
  onChange: (rows: ReminderRow[]) => void
  mode: 'one_time' | 'recurring'
  deadlineDate: string
}) {
  const [open, setOpen] = React.useState(false)
  const needsDate = mode === 'one_time' && !deadlineDate
  const update = (key: string, patch: Partial<ReminderRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <>
      {rows.length === 0 ? (
        <button type="button" onClick={() => setOpen(true)} className={LINK_BUTTON}>
          <Plus aria-hidden className="size-[16px]" />
          Add reminder
        </button>
      ) : (
        <PhoneField label="Reminders">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cx(ROW, 'mx-0 rounded-[8px] border border-border-strong bg-surface')}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {reminderLabel(rows[0])}
              {rows.length > 1 ? ` + ${rows.length - 1} more` : ''}
            </span>
          </button>
        </PhoneField>
      )}

      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        title="Reminders"
        footer={
          <PhoneButton variant="primary" fullWidth onClick={() => setOpen(false)}>
            Done
          </PhoneButton>
        }
      >
        {needsDate ? (
          <p className="py-[16px] text-body text-text-secondary">Choose a due date first, then set reminders.</p>
        ) : (
          <div className="flex flex-col gap-[16px] pb-[8px]">
            {rows.length === 0 ? <p className="text-body text-text-secondary">No reminders. The assignee will not be nudged before the due date.</p> : null}
            {rows.map((r) => {
              let hint: string | null = null
              if (r.kind === 'relative' && mode === 'one_time' && deadlineDate) {
                const d = new Date(`${deadlineDate}T00:00`)
                d.setDate(d.getDate() - r.offsetDays)
                hint = formatDate(d)
              }
              const past = mode === 'one_time' && reminderIsPast(r, deadlineDate || undefined)
              return (
                <div key={r.key} className="flex flex-col gap-[12px] rounded-[8px] border border-border-light bg-surface-sunken p-[12px]">
                  <div className="flex items-center gap-[8px]">
                    <div className="grid flex-1 grid-cols-2 gap-[8px]">
                      {([
                        { k: 'relative' as const, label: 'Days before' },
                        { k: 'absolute' as const, label: 'On a date' },
                      ]).map(({ k, label }) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={r.kind === k}
                          onClick={() => update(r.key, { kind: k })}
                          className={cx(
                            'min-h-(--h-control) rounded-[8px] border text-body font-medium',
                            r.kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-surface text-text-primary active:bg-surface-control',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove reminder"
                      onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                      className="flex size-[44px] shrink-0 items-center justify-center text-text-secondary active:bg-surface-control"
                    >
                      <X aria-hidden className="size-[18px]" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-[12px]">
                    {r.kind === 'relative' ? (
                      <PhoneField label="Days before" htmlFor={`rem-${r.key}-days`}>
                        <OffsetDaysInput id={`rem-${r.key}-days`} value={r.offsetDays} onChange={(n) => update(r.key, { offsetDays: n })} />
                      </PhoneField>
                    ) : (
                      <PhoneDateField id={`rem-${r.key}-date`} label="Date" value={r.date} onChange={(v) => update(r.key, { date: v })} />
                    )}
                    <PhoneTimeField id={`rem-${r.key}-time`} label="Time" value={r.time} onChange={(v) => update(r.key, { time: v })} />
                  </div>
                  {hint ? <p className="-mt-[4px] text-meta text-primary-text">Reminds on {hint}</p> : null}

                  <fieldset className="flex flex-col">
                    <legend className="text-label font-medium text-text-secondary">Also tell</legend>
                    <label className="flex min-h-[44px] items-center gap-[12px] text-body text-text-primary">
                      <input type="checkbox" checked={r.toAssigner} onChange={(e) => update(r.key, { toAssigner: e.target.checked })} className="size-[20px] accent-primary" />
                      The person who gave the task
                    </label>
                    <label className="flex min-h-[44px] items-center gap-[12px] text-body text-text-primary">
                      <input type="checkbox" checked={r.toCc} onChange={(e) => update(r.key, { toCc: e.target.checked })} className="size-[20px] accent-primary" />
                      People in CC
                    </label>
                    <span className="text-meta text-text-secondary">The assignee is always told.</span>
                  </fieldset>

                  {past ? (
                    <p className="rounded-[8px] border border-warning-border bg-warning-bg px-[12px] py-[8px] text-meta text-warning">
                      This reminder falls in the past, so it will not be sent. The task will still save.
                    </p>
                  ) : null}
                </div>
              )
            })}
            <PhoneButton variant="secondary" fullWidth onClick={() => onChange([...rows, makeReminderRow()])}>
              Add reminder
            </PhoneButton>
          </div>
        )}
      </PhoneSheet>
    </>
  )
}

/* "Days before" that can be emptied while typing; the form only ever gets a whole number, and empty reads as 0 (the computer's rule). */
function OffsetDaysInput({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  const [raw, setRaw] = React.useState(String(value))
  React.useEffect(() => {
    // Re-sync only when the outside value no longer matches what is typed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (parseInt(raw || '0', 10) !== value) setRaw(String(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={raw}
      onChange={(e) => {
        const v = e.target.value.replace(/^0+(?=\d)/, '')
        if (!/^\d*$/.test(v)) return
        setRaw(v)
        onChange(v === '' ? 0 : Math.max(0, parseInt(v, 10)))
      }}
      onBlur={() => {
        if (raw === '') setRaw('0')
      }}
      className={PHONE_INPUT}
    />
  )
}
