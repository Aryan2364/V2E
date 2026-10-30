'use client'

import React from 'react'
import { Check, Plus, X } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { useAuth } from '@/lib/auth/context'
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
 *   - The less-used fields (CC, checklist, tags) sit behind "Add ..." rows,
 *     like "Add description", until they hold something.
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

/* Tags come from the same list the computer's tag picker uses (useTaskTags). Creating a new tag stays on the computer. */
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
  const { tags, loading, error, reload } = useTaskTags(open ? orgId : null, { includeInactive: true })
  const [draft, setDraft] = React.useState<TaskFormValues['tags']>(selected)
  React.useEffect(() => {
    // Each opening starts from what the form holds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDraft(selected)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

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
      ) : options.length === 0 ? (
        <p className="py-[16px] text-body text-text-secondary">Your organisation has no tags yet. They are created on the computer.</p>
      ) : (
        <>
          {full ? <p className="px-[16px] pb-[8px] text-meta text-text-secondary">Up to {MAX_TAGS_PER_TASK} tags per task.</p> : null}
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
