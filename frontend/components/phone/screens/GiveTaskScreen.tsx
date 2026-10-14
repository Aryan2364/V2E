'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { useBack } from '@/lib/back'
import type { EligibleAssigneeUser, TaskPriority } from '@/lib/types/tasks'
import { PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import { useDraft } from '@/lib/drafts'
import { DraftBanner } from '../DraftBanner'
import PhoneScreen from '../PhoneScreen'
import { PhoneSheet } from '../PhoneSheet'
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
 *   - Repeat (Daily/Weekly/Monthly): the plan does not call this feasible
 *     for slice 4 (recurring templates are their own, heavier object with
 *     schedule entries) - DEFERRED, not built here.
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
}

const EMPTY_DRAFT: GiveTaskValues = { title: '', description: '', deadline: '', priorityId: '', assignees: [] }

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
  }, [orgId])

  const titleError = draft.title.length > TITLE_MAX ? `Title must be ${TITLE_MAX} characters or fewer` : null
  const descriptionError = draft.description.length > DESCRIPTION_MAX ? `Description must be ${DESCRIPTION_MAX} characters or fewer` : null
  const canSave = draft.title.trim().length > 0 && !titleError && !descriptionError && !saving

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    try {
      await tasksApi.createTask(orgId, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        priority_id: draft.priorityId || undefined,
        deadline: draft.deadline ? new Date(draft.deadline).toISOString() : undefined,
        assignee_user_ids: draft.assignees.map((a) => a.user_id),
      })
      fileDraft.clear()
      addToast('Task given', 'success')
      back()
    } catch {
      addToast('Could not give the task. Try again.', 'error')
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
              'min-h-[var(--h-control)] w-full rounded-[8px] border bg-phone-surface px-[12px] text-[16px] text-phone-text-primary outline-none focus-visible:border-phone-primary',
              titleError ? 'border-phone-danger' : 'border-phone-border-strong',
            )}
          />
        </Field>

        <Field label="Assignee(s)">
          <button type="button" onClick={() => setAssigneePicker(true)} className={cx(ROW, '-mx-0 rounded-[8px] border border-phone-border-strong bg-phone-surface')}>
            <span className="min-w-0 flex-1 truncate text-left">
              {draft.assignees.length === 0 ? (
                <span className="text-phone-text-secondary">Choose who this is for</span>
              ) : (
                draft.assignees.map((a) => a.name).join(', ')
              )}
            </span>
          </button>
        </Field>

        <Field label="Due date">
          <input
            type="datetime-local"
            value={draft.deadline}
            onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
            className="min-h-[var(--h-control)] w-full rounded-[8px] border border-phone-border-strong bg-phone-surface px-[12px] text-[16px] text-phone-text-primary outline-none focus-visible:border-phone-primary"
          />
        </Field>

        <Field label="Priority">
          <select
            value={draft.priorityId}
            onChange={(e) => setDraft((d) => ({ ...d, priorityId: e.target.value }))}
            className="min-h-[var(--h-control)] w-full rounded-[8px] border border-phone-border-strong bg-phone-surface px-[12px] text-[16px] text-phone-text-primary outline-none focus-visible:border-phone-primary"
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
                'w-full resize-none rounded-[8px] border bg-phone-surface px-[12px] py-[10px] text-[16px] text-phone-text-primary outline-none focus-visible:border-phone-primary',
                descriptionError ? 'border-phone-danger' : 'border-phone-border-strong',
              )}
            />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowDescription(true)} className="self-start text-phone-label font-semibold text-phone-primary-text">
            + Add description
          </button>
        )}

        <p className="text-phone-meta text-phone-text-secondary">Repeat (daily/weekly/monthly) isn&apos;t available from the phone yet - set it up on a computer.</p>

        {(draft.title || draft.description) ? (
          <button type="button" onClick={onDiscard} className="self-start text-phone-label font-semibold text-phone-danger">
            Discard draft
          </button>
        ) : null}
      </form>

      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-30 flex gap-[8px] border-t border-phone-border-light bg-phone-surface px-[16px] pt-[12px]',
          'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <PhoneButton type="button" variant="primary" fullWidth disabled={!canSave} title={!draft.title.trim() ? 'A title is required' : undefined} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save'}
        </PhoneButton>
      </div>

      <AssigneePickerSheet
        open={assigneePicker}
        onOpenChange={setAssigneePicker}
        orgId={orgId}
        selected={draft.assignees}
        onChange={(assignees) => setDraft((d) => ({ ...d, assignees }))}
      />
    </PhoneScreen>
  )
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-phone-label font-medium text-phone-text-secondary">{label}</span>
      {children}
      {error ? <span className="text-phone-meta text-phone-danger">{error}</span> : null}
    </label>
  )
}

function AssigneePickerSheet({
  open,
  onOpenChange,
  orgId,
  selected,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  selected: { user_id: string; name: string }[]
  onChange: (next: { user_id: string; name: string }[]) => void
}) {
  const [query, setQuery] = React.useState('')
  const [users, setUsers] = React.useState<EligibleAssigneeUser[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open || !orgId) return
    setLoading(true)
    const t = window.setTimeout(() => {
      tasksApi
        .getEligibleAssignees(orgId, query || undefined, 'name')
        .then((res) => setUsers(res.departments.flatMap((d) => d.users)))
        .catch(() => setUsers([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => window.clearTimeout(t)
  }, [open, orgId, query])

  function toggle(u: EligibleAssigneeUser) {
    const exists = selected.some((s) => s.user_id === u.user_id)
    onChange(exists ? selected.filter((s) => s.user_id !== u.user_id) : [...selected, { user_id: u.user_id, name: u.name }])
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Choose assignees"
      footer={
        <PhoneButton type="button" variant="primary" fullWidth onClick={() => onOpenChange(false)}>
          Done{selected.length > 0 ? ` (${selected.length})` : ''}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[12px]">
        <div className="relative">
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-[16px] -translate-y-1/2 text-phone-text-secondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            className="min-h-[var(--h-control)] w-full rounded-[8px] border border-phone-border-strong bg-phone-surface py-[8px] pl-[36px] pr-[12px] text-[16px] text-phone-text-primary outline-none focus-visible:border-phone-primary"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-[8px] top-1/2 -translate-y-1/2">
              <X aria-hidden className="size-[16px] text-phone-text-secondary" />
            </button>
          ) : null}
        </div>

        {loading ? (
          <p className="text-phone-body text-phone-text-secondary">Searching…</p>
        ) : users.length === 0 ? (
          <p className="text-phone-body text-phone-text-secondary">No one matches.</p>
        ) : (
          <ul className="flex flex-col">
            {users.map((u) => {
              const checked = selected.some((s) => s.user_id === u.user_id)
              return (
                <li key={u.user_id}>
                  <button type="button" onClick={() => toggle(u)} className={ROW}>
                    <span
                      aria-hidden
                      className={cx(
                        'flex size-[20px] shrink-0 items-center justify-center rounded-[4px] border-2',
                        checked ? 'border-phone-primary bg-phone-primary' : 'border-phone-border-strong',
                      )}
                    >
                      {checked ? (
                        <svg viewBox="0 0 16 16" className="size-[12px] text-phone-primary-foreground" fill="none">
                          <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">
                      <span className="block truncate text-phone-body text-phone-text-primary">{u.name}</span>
                      <span className="block truncate text-phone-meta text-phone-text-secondary">{u.department_name}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </PhoneSheet>
  )
}
