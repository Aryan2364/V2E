'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { tasksApi } from '@/lib/api/tasks'
import { useBack } from '@/lib/back'
import { ACCEPT_ATTR, validateFile } from '@/lib/attachments'
import { shrinkImageForUpload } from '@/lib/image-resize'
import type { TaskPriority } from '@/lib/types/tasks'
import { PHONE_HOME, RECURRING_TEMPLATES_HREF, type PhoneRoute } from '@/lib/phone-routes'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import { makeReminderRow, buildReminderSpecs, validateRemindersAgainstDeadline, type ReminderRow } from '@/components/tasks/RemindersField'
import { buildChecklistItems } from '@/components/tasks/ChecklistBuilderField'
import { buildRecurringPayload, scheduleEntryError } from '@/lib/tasks/recurring-payload'
import type { RecurringScheduleType } from '@/lib/types/tasks'
import { useDraft } from '@/lib/drafts'
import { DraftBanner } from '../DraftBanner'
import { shouldOfferPushNow, declinePushOffer } from '@/lib/push'
import PhoneScreen from '../PhoneScreen'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NotificationOfferSheet } from '../NotificationOfferSheet'
import { RepeatFields, entryForFrequency } from '../RepeatFields'
import { PhoneButton, PhoneField, cx, enterMovesNext, focusFirstInvalid } from '../primitives'
import { StagedFileRow, newStagedFile, type StagedFile } from '../FileRows'
import {
  TaskFormFields,
  HolidayKeepDialog,
  EMPTY_TASK_FORM,
  TITLE_MAX,
  DESCRIPTION_MAX,
  checklistPayload,
  cleanChecklist,
  deadlineToIso,
  isHolidayRefusal,
  type TaskFormValues,
} from '../TaskFormFields'

/*
 * "Give task" - plan-phone-2026-10-14.md §5.4 (slice 4), kit §41.7.
 *
 *   - Minimum fields: title, assignee(s) via a searchable bottom sheet, due
 *     date via the browser's native picker, priority. Description is one
 *     tap away (an expandable field, not a separate screen).
 *   - The fields themselves live in components/phone/TaskFormFields.tsx and
 *     are shared with Edit task. Behind "Add ..." rows: CC, description,
 *     checklist (with "Add from template"), tags. Also on the form: proof
 *     required, and "who completes it" once there are 2+ assignees.
 *   - Files: picked here, kept in memory, and uploaded one by one right after
 *     the task is created (as the computer's create dialog does), with the
 *     same size and type limits (lib/attachments validateFile).
 *   - Validated against the real CreateTaskDto: title required, <= 50
 *     chars; description <= 2000.
 *   - Draft: lib/drafts.ts (kit §41.7 rules 12-15), form id "task-give",
 *     record "new". Offered back with a banner ("You have an unsaved
 *     draft from ...") - never restored silently. Cleared on save and on
 *     Discard draft; also cleared for everyone on sign-out (lib/auth's
 *     logout calls clearDrafts). Picked files are not part of a draft.
 *   - Repeat (Daily/Weekly/Monthly/Yearly): choosing one swaps the Due date
 *     for the schedule fields (components/phone/RepeatFields.tsx) and Save
 *     creates a recurring TEMPLATE with the desktop's own payload builder
 *     (lib/tasks/recurring-payload.ts). Everything the phone form does not
 *     show takes the desktop's default (no escalation, no goal).
 *   - Reminders: one from the org's default days before, as the desktop seeds
 *     it, behind the Reminders row; a one-off sends them against its due date
 *     (none without one), a repeating task sends them relative.
 *     Then the recurring list opens.
 *   - After saving: back to the previous list with a toast. The task only
 *     shows on My work if the current user is actually one of its
 *     assignees - that's the backend's own grouping, not something this
 *     screen has to enforce.
 */

type GiveTaskValues = TaskFormValues & {
  /** null = does not repeat. */
  schedule: ScheduleEntryDraft | null
}

const EMPTY_DRAFT: GiveTaskValues = { ...EMPTY_TASK_FORM, schedule: null }

export default function GiveTaskScreen({ route }: { route: PhoneRoute }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const router = useRouter()
  const back = useBack(route.parent ?? PHONE_HOME)
  const orgId = user?.organizationId ?? ''

  const [draftValues, setDraft] = React.useState<GiveTaskValues>(EMPTY_DRAFT)
  const [priorities, setPriorities] = React.useState<TaskPriority[]>([])
  const [saving, setSaving] = React.useState(false)
  const [offerPush, setOfferPush] = React.useState(false)
  const [attempted, setAttempted] = React.useState(false)
  const [titleTouched, setTitleTouched] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  // One reminder from the org's default days before, as the computer seeds it; the person may change or remove it.
  const [reminders, setReminders] = React.useState<ReminderRow[]>(() => [makeReminderRow({ offsetDays: 1 })])
  const remindersTouched = React.useRef(false)
  const [files, setFiles] = React.useState<StagedFile[]>([])
  const [fileErrors, setFileErrors] = React.useState<string[]>([])
  const [holidayMessage, setHolidayMessage] = React.useState<string | null>(null)
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
    tasksApi
      .getConfig(orgId)
      .then((cfg) => {
        if (!remindersTouched.current) setReminders([makeReminderRow({ offsetDays: cfg?.default_reminder_days_before ?? 1 })])
      })
      .catch(() => {})
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

  function onFilesPicked(list: FileList | null) {
    const picked = list ? Array.from(list) : []
    if (picked.length === 0) return
    const errors: string[] = []
    const good: StagedFile[] = []
    for (const f of picked) {
      const err = validateFile(f)
      if (err) errors.push(err)
      else good.push(newStagedFile(f))
    }
    setFileErrors(errors)
    if (good.length > 0) setFiles((prev) => [...prev, ...good])
  }

  const patchFile = (id: string, change: Partial<StagedFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...change } : f)))

  /** Uploads the picked files to the new task (or template), one at a time. Returns false if any failed. */
  async function uploadFiles(upload: (file: File, onProgress: (pct: number) => void) => Promise<unknown>): Promise<boolean> {
    let ok = true
    for (const item of files) {
      patchFile(item.id, { status: 'uploading', progress: 0 })
      try {
        await upload(await shrinkImageForUpload(item.file), (pct) => patchFile(item.id, { progress: pct }))
      } catch {
        patchFile(item.id, { status: 'failed' })
        ok = false
      }
    }
    return ok
  }

  async function onSave(holidayOverride = false) {
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
    const reminderError = schedule
      ? reminders.some((r) => r.kind === 'absolute' && !r.date)
        ? 'Pick a date for each "on a date" reminder.'
        : null
      : draft.deadline
        ? validateRemindersAgainstDeadline(reminders, deadlineToIso(draft.deadline) ?? null, draft.deadline.slice(0, 10))
        : null
    if (reminderError) {
      addToast(reminderError, 'error')
      return
    }
    setSaving(true)
    try {
      if (schedule) {
        const template = await tasksApi.createRecurring(
          orgId,
          buildRecurringPayload({
            title: draft.title,
            description: draft.description,
            priorityId: draft.priorityId,
            tagIds: draft.tags.map((t) => t.id),
            scheduleEntries: [schedule],
            completionMode: draft.completionMode,
            proofRequired: draft.proofRequired,
            proofAllowedExtensions: [],
            escalationIds: [],
            assignees: [
              ...draft.assignees.map((a) => ({ ...a, is_cc: false })),
              ...draft.cc.map((a) => ({ ...a, is_cc: true })),
            ],
            checklistItems: buildChecklistItems(cleanChecklist(draft.checklist)),
            reminders: buildReminderSpecs(reminders, false),
          }),
        )
        recurring.current = true
        fileDraft.clear()
        const filesOk = await uploadFiles((file, onProgress) => tasksApi.uploadRecurringAttachment(orgId, template.id, file, onProgress))
        if (filesOk) addToast('Recurring task created', 'success')
        else addToast('Recurring task created, but a file could not be uploaded. Add it again from the recurring task.', 'warning')
        if (shouldOfferPushNow(user?.id)) setOfferPush(true)
        else leave()
        return
      }
      const created = await tasksApi.createTask(orgId, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        priority_id: draft.priorityId || undefined,
        ...(draft.tags.length > 0 ? { tag_ids: draft.tags.map((t) => t.id) } : {}),
        deadline: deadlineToIso(draft.deadline),
        // Relative reminders are fixed against the due date; with no due date there is nothing to remind about.
        ...(draft.deadline ? { reminders: buildReminderSpecs(reminders, true, draft.deadline.slice(0, 10)) } : {}),
        holiday_override: holidayOverride,
        completion_mode: draft.completionMode,
        proof_required: draft.proofRequired,
        proof_allowed_extensions: [],
        assignee_user_ids: draft.assignees.map((a) => a.user_id),
        cc_user_ids: draft.cc.map((a) => a.user_id),
        ...checklistPayload(draft.checklist),
      } as Parameters<typeof tasksApi.createTask>[1])
      fileDraft.clear()
      const filesOk = await uploadFiles((file, onProgress) => tasksApi.uploadTaskAttachment(orgId, created.id, file, onProgress))
      if (filesOk) addToast('Task created', 'success')
      else addToast('Task created, but a file could not be uploaded. Open the task to add it again.', 'warning')
      // The first useful moment to ask (plan §9, kit §41.12 rule 4): giving a
      // task is something you'd want to hear back about. Offered at most once
      // until declined/granted/denied; the screen still navigates back either way.
      if (shouldOfferPushNow(user?.id)) {
        setOfferPush(true)
      } else {
        leave()
      }
    } catch (e) {
      const message = apiErrorMessage(e, '')
      // The holiday rule never forces itself - offer to keep the chosen date.
      if (!schedule && isHolidayRefusal(message)) setHolidayMessage(message)
      else if (message) addToast(message, 'error')
      else addToast(schedule ? 'Could not create the recurring task. Check your connection and try again.' : 'Could not create the task. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function onDiscard() {
    fileDraft.clear()
    setDraft(EMPTY_DRAFT)
    setFiles([])
    back()
  }

  return (
    <PhoneScreen title="Give task" parent={route.parent ?? PHONE_HOME}>
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-[20px] pb-[80px]"
        onKeyDown={enterMovesNext}
        onSubmit={(e) => e.preventDefault()}
      >
        <DraftBanner draft={fileDraft} onUse={(kept) => setDraft((d) => ({ ...d, ...kept }))} />

        <TaskFormFields
          values={draft}
          setValues={setDraft}
          priorities={priorities}
          orgId={orgId}
          idPrefix="task"
          titleError={titleError}
          descriptionError={descriptionError}
          assigneesError={noAssigneeError}
          autoFocusTitle
          reminders={{
            rows: reminders,
            mode: schedule ? 'recurring' : 'one_time',
            onChange: (rows) => {
              remindersTouched.current = true
              setReminders(rows)
            },
          }}
          onTitleBlur={() => setTitleTouched(true)}
          /* When: Repeat first, then either the one-off Due date or the schedule
              fields in its place - one decision, in one place. */
          beforeWhen={
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
          }
          when={
            schedule ? (
              <RepeatFields entry={schedule} onChange={(next) => setDraft((d) => ({ ...d, schedule: next }))} showErrors={attempted} />
            ) : undefined
          }
        />

        <section className="flex flex-col gap-[8px]">
          {files.length > 0 ? (
            <>
              <h2 className="text-label font-medium text-text-secondary">Files</h2>
              <ul className="flex flex-col gap-[8px]">
                {files.map((f) => (
                  <StagedFileRow
                    key={f.id}
                    item={f}
                    onRetry={() => {}}
                    onRemove={(id) => setFiles((prev) => prev.filter((x) => x.id !== id))}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {fileErrors.length > 0 ? (
            <ul className="flex flex-col gap-[4px]" role="alert">
              {fileErrors.map((m) => (
                <li key={m} className="text-meta text-danger">
                  {m}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[44px] items-center gap-[4px] self-start text-label font-medium text-primary-text"
          >
            <Plus aria-hidden className="size-[16px]" />
            {files.length > 0 ? 'Add another file' : 'Add file'}
          </button>
          {/* The phone's own picker: Camera, Photos & videos and Files in one list. No `capture`. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
        </section>

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

      <HolidayKeepDialog
        message={holidayMessage}
        onCancel={() => setHolidayMessage(null)}
        onKeep={() => {
          setHolidayMessage(null)
          void onSave(true)
        }}
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
