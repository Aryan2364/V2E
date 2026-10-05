'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, GitMerge, Pencil, Plus, Power, RotateCcw, Search, Trash2, X } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/Tooltip'
import TagChip from '@/components/ui/TagChip'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { CREATE_TAG_REASON } from '@/components/tasks/TagPicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { isTagConflictError, tagErrorMessage, tasksApi } from '@/lib/api/tasks'
import { TAG_COLORS, type TagColor, type TaskTag, type UpdateTagInput } from '@/lib/types/tasks'
import { TAG_COLOR_LABELS, normalizeTagColor, tagDotClass } from '@/lib/tasks/tagColors'
import { invalidateTaskTags, removeCachedTag, upsertCachedTag } from '@/lib/tasks/useTaskTags'
import { useSessionState } from '@/lib/tasks/useSessionState'

/**
 * Work Settings → Tags (TASK_TAGS_PLAN.md §5.3). Most tags arrive from the task picker,
 * so this tab is for curation: rename, recolour, deactivate, delete, merge.
 *
 * Gates (plan §10.3): create = tasks.tags.create write OR tasks.config.tags.manage write;
 * edit / deactivate / reactivate = manage edit; delete = manage delete; merge = edit AND
 * delete. Admins pass all. An action the user can't take is shown disabled with the
 * reason (kit §26), never hidden; the whole tab is hidden by the page for non-holders.
 */

const MANAGE_LEAF = 'tasks.config.tags.manage'
const MANAGE_REASON = 'Only people allowed to manage task tags can do this.'
const NAME_MAX = 40
const DESCRIPTION_MAX = 200

type SortKey = 'name' | 'most_used' | 'least_used'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'most_used', label: 'Most used' },
  { value: 'least_used', label: 'Least used' },
]

// Desktop column template, shared by the header and every row so they always line up.
// Below lg each row stacks as a card; "Created by" gets its own column only from xl.
const GRID = 'lg:grid lg:items-center lg:gap-4 lg:grid-cols-[minmax(0,1fr)_10rem_6rem_10.5rem] xl:grid-cols-[minmax(0,1fr)_10rem_11rem_6rem_10.5rem]'

const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 h-11 lg:h-9 px-4 rounded-btn bg-primary text-sm font-semibold text-white hover:bg-primary-hover disabled:bg-border disabled:text-secondary disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 h-11 lg:h-9 px-4 rounded-btn border border-primary bg-white text-sm font-semibold text-primary hover:bg-slate-50 active:bg-slate-100 disabled:border-border disabled:text-muted disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
const fieldCls =
  'w-full rounded-btn border bg-white px-3 text-base lg:text-sm text-heading placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-[border-color]'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Same normalisation as the server (§10.5): trim, collapse inner whitespace. */
const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ')
const nameKey = (s: string) => normalizeName(s).toLowerCase()
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const usageOf = (t: TaskTag) => t.usage_count ?? 0
const byName = (a: TaskTag, b: TaskTag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function nameError(raw: string): string | null {
  const name = normalizeName(raw)
  if (!name) return 'Enter a tag name.'
  if (/[,|]/.test(name)) return 'Tag names can’t contain commas or pipes.'
  if (name.length > NAME_MAX) return `Tag names can be up to ${NAME_MAX} characters.`
  return null
}

function httpStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } } | null)?.response?.status
}

/** The palette colour fewest active tags use (ties go to palette order) — mirrors the server's pick. */
function leastUsedColor(tags: TaskTag[]): TagColor {
  const counts = new Map<TagColor, number>(TAG_COLORS.map((c) => [c, 0]))
  for (const t of tags) {
    if (!t.is_active) continue
    const c = normalizeTagColor(t.color)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = TAG_COLORS[0]
  for (const c of TAG_COLORS) if ((counts.get(c) ?? 0) < (counts.get(best) ?? 0)) best = c
  return best
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center h-6 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
        active ? 'border-green-200 bg-green-50 text-green-800' : 'border-border bg-slate-100 text-secondary',
      ].join(' ')}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

/**
 * A quiet icon button for a row action (kit §6.3). `allowed` folds the permission and
 * any record rule together: true → enabled with its label as tooltip; false → disabled,
 * the reason on a focusable wrapper (PermissionTooltip); undefined → disabled, no reason.
 */
function RowAction({
  label,
  icon,
  allowed,
  reason,
  busy = false,
  danger = false,
  onClick,
}: {
  label: string
  icon: ReactNode
  allowed: boolean | undefined
  reason: string
  busy?: boolean
  danger?: boolean
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={allowed !== true || busy}
      className={[
        'inline-flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-btn text-secondary transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'disabled:text-muted disabled:hover:bg-transparent disabled:cursor-not-allowed',
        danger ? 'hover:bg-red-50 hover:text-danger active:bg-red-100' : 'hover:bg-slate-100 hover:text-heading active:bg-slate-200',
      ].join(' ')}
    >
      {icon}
    </button>
  )
  if (allowed === true) return <Tooltip label={label}>{button}</Tooltip>
  return (
    <PermissionTooltip allowed={allowed} reason={reason}>
      {button}
    </PermissionTooltip>
  )
}

function EmptyState({ title, line, action }: { title: string; line: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-12 text-center">
      <p className="text-base font-semibold text-heading">{title}</p>
      <p className="max-w-md text-sm text-secondary">{line}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tags">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`border-b border-border px-4 py-3 last:border-b-0 ${GRID}`}>
          <div className="min-w-0 space-y-2">
            <div className="h-6 w-28 rounded-full bg-border animate-pulse" />
            <div className="h-3.5 w-3/5 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="mt-2 h-4 w-24 rounded bg-slate-100 animate-pulse lg:mt-0" />
          <div className="hidden h-4 w-24 rounded bg-slate-100 animate-pulse xl:block" />
          <div className="hidden h-6 w-16 rounded-full bg-slate-100 animate-pulse lg:block" />
          <div className="mt-2 flex gap-1 lg:mt-0 lg:justify-end">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-9 w-9 rounded-btn bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Create / edit form (one component, kit §11.3) ────────────────────────────

type FormTarget = { mode: 'create' } | { mode: 'edit'; tag: TaskTag }
type SavedKind = 'created' | 'updated' | 'reactivated'

function ColorSwatches({ value, onChange, labelledBy }: { value: TagColor; onChange: (c: TagColor) => void; labelledBy: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % TAG_COLORS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + TAG_COLORS.length) % TAG_COLORS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TAG_COLORS.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(TAG_COLORS[next])
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {TAG_COLORS.map((c, i) => {
        const selected = c === value
        return (
          <button
            key={c}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={TAG_COLOR_LABELS[c]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(c)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'inline-flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-full border-2 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              selected ? 'border-heading' : 'border-transparent hover:border-input',
            ].join(' ')}
          >
            <span className={`inline-flex h-7 w-7 lg:h-6 lg:w-6 items-center justify-center rounded-full ${tagDotClass(c)}`}>
              {selected && <Check size={14} strokeWidth={3} className="text-white" aria-hidden="true" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TagFormModal({
  orgId,
  target,
  allTags,
  canReactivate,
  onClose,
  onSaved,
  onExisting,
}: {
  orgId: string
  target: FormTarget
  allTags: TaskTag[]
  canReactivate: boolean | undefined
  onClose: () => void
  onSaved: (tag: TaskTag, kind: SavedKind) => void
  /** Create answered with an existing active tag this list didn't have. */
  onExisting: (tag: TaskTag) => void
}) {
  const editing = target.mode === 'edit' ? target.tag : null
  // Snapshot once per open; later list updates must not reset what the user typed.
  const [initial] = useState(() => ({
    name: editing?.name ?? '',
    color: editing ? normalizeTagColor(editing.color) : leastUsedColor(allTags),
    description: editing?.description ?? '',
  }))
  const [name, setName] = useState(initial.name)
  const [color, setColor] = useState<TagColor>(initial.color)
  const [description, setDescription] = useState(initial.description)
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ name: string; tagId: string | null } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const nameId = useId()
  const nameErrId = useId()
  const colorLabelId = useId()
  const descId = useId()

  const dirty =
    normalizeName(name) !== normalizeName(initial.name) ||
    color !== initial.color ||
    description.trim() !== initial.description.trim()

  // Kit §11.3 rule 10: closing with real changes asks first.
  const requestClose = useCallback(() => {
    if (submitting || reactivating) return
    if (dirty) setConfirmLeave(true)
    else onClose()
  }, [dirty, submitting, reactivating, onClose])

  function clash(n: string): TaskTag | undefined {
    const key = nameKey(n)
    return allTags.find((t) => t.id !== editing?.id && nameKey(t.name) === key)
  }

  async function submit() {
    const err = nameError(name)
    if (err) {
      setNameErr(err)
      return
    }
    const n = normalizeName(name)
    const d = description.trim()
    setFormErr(null)
    setConflict(null)

    const existing = clash(n)
    if (existing) {
      if (!editing && !existing.is_active) setConflict({ name: existing.name, tagId: existing.id })
      else setNameErr(`A tag named ‘${existing.name}’ already exists.`)
      return
    }

    if (editing) {
      const body: UpdateTagInput = {}
      if (n !== editing.name) body.name = n
      if (color !== normalizeTagColor(editing.color)) body.color = color
      if (d !== (editing.description ?? '').trim()) body.description = d || null
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      setSubmitting(true)
      try {
        const updated = await tasksApi.updateTag(orgId, editing.id, body)
        onSaved(updated, 'updated')
      } catch (e) {
        if (httpStatus(e) === 409) setNameErr(tagErrorMessage(e, `A tag named ‘${n}’ already exists.`))
        else setFormErr(tagErrorMessage(e, 'We couldn’t save this tag. Try again.'))
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      const { tag: created, created: isNew } = await tasksApi.createTagDetailed(orgId, {
        name: n,
        color,
        description: d || undefined,
      })
      // The server answers an exact match on an ACTIVE tag with that tag (200), not an
      // error. It may be one this list hasn't seen (someone else created it since): never
      // present it as new — say it exists, and have the list refetch it with its real
      // creator and usage.
      if (!isNew || allTags.some((t) => t.id === created.id)) {
        setNameErr(`A tag named ‘${created.name}’ already exists.`)
        if (!allTags.some((t) => t.id === created.id)) onExisting(created)
        return
      }
      onSaved(created, 'created')
    } catch (e) {
      if (isTagConflictError(e)) setConflict({ name: n, tagId: e.tagId })
      else setFormErr(tagErrorMessage(e, 'We couldn’t create this tag. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function reactivate() {
    if (!conflict?.tagId) return
    setReactivating(true)
    setFormErr(null)
    try {
      const tag = await tasksApi.updateTag(orgId, conflict.tagId, { is_active: true })
      onSaved(tag, 'reactivated')
    } catch (e) {
      setFormErr(tagErrorMessage(e, 'We couldn’t reactivate that tag. Try again.'))
    } finally {
      setReactivating(false)
    }
  }

  const preview = { id: 'preview', name: normalizeName(name) || 'Tag name', color, is_active: true }
  const nameInvalid = !!nameErr || !!conflict

  return (
    <>
      <Modal isOpen onClose={requestClose} title={editing ? 'Edit tag' : 'Create tag'} size="md">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-6"
        >
          {/* Name */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor={nameId} className="text-sm font-medium text-label">
                Name <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <span className="text-xs tabular-nums text-helper" aria-hidden="true">
                {name.length}/{NAME_MAX}
              </span>
            </div>
            <input
              id={nameId}
              type="text"
              autoFocus
              required
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameErr) setNameErr(null)
                if (conflict) setConflict(null)
              }}
              onBlur={() => {
                if (name.trim() || nameErr) setNameErr(nameError(name))
              }}
              placeholder="e.g. Client follow-up"
              aria-invalid={nameInvalid}
              aria-describedby={nameInvalid ? nameErrId : undefined}
              className={`${fieldCls} h-11 lg:h-9 ${nameInvalid ? 'border-danger' : 'border-input hover:border-secondary'}`}
            />
            {nameErr && (
              <p id={nameErrId} role="alert" className="mt-1 text-sm text-danger">
                {nameErr}
              </p>
            )}
            {conflict && (
              <div id={nameErrId} role="alert" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-danger">
                <span>‘{conflict.name}’ exists but is deactivated.</span>
                {conflict.tagId && canReactivate === true ? (
                  <button
                    type="button"
                    onClick={() => void reactivate()}
                    disabled={reactivating}
                    className="rounded font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {reactivating ? 'Reactivating…' : 'Reactivate it'}
                  </button>
                ) : (
                  <span className="text-secondary">Ask someone who manages task tags to reactivate it.</span>
                )}
              </div>
            )}
          </div>

          {/* Colour */}
          <div>
            <p id={colorLabelId} className="mb-1.5 text-sm font-medium text-label">
              Colour <span className="font-normal text-helper">· {TAG_COLOR_LABELS[color]}</span>
            </p>
            <ColorSwatches value={color} onChange={setColor} labelledBy={colorLabelId} />
          </div>

          {/* Description */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor={descId} className="text-sm font-medium text-label">
                Description
              </label>
              <span className="text-xs tabular-nums text-helper" aria-hidden="true">
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <textarea
              id={descId}
              rows={3}
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Waiting on the client before work can continue"
              className={`${fieldCls} resize-none border-input py-2 hover:border-secondary`}
            />
          </div>

          {/* Preview — the real chip, same component the task lists render */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-label">Preview</p>
            <TagChip tag={preview} size="md" />
          </div>

          {formErr && (
            <p role="alert" className="rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formErr}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={requestClose} disabled={submitting || reactivating} className={secondaryBtn}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || reactivating} className={primaryBtn}>
              {submitting ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create tag'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave without saving?"
        message="Your changes to this tag will be lost."
        cancelLabel="Stay"
        confirmLabel="Leave without saving"
        danger
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          onClose()
        }}
      />
    </>
  )
}

// ─── Merge: pick the tag to keep ──────────────────────────────────────────────

function MergePickModal({
  source,
  targets,
  onCancel,
  onContinue,
}: {
  source: TaskTag
  targets: TaskTag[]
  onCancel: () => void
  onContinue: (into: TaskTag) => void
}) {
  const [intoId, setIntoId] = useState('')
  const into = targets.find((t) => t.id === intoId) ?? null
  const options = targets.map((t) => ({ value: t.id, label: `${t.name} · ${plural(usageOf(t), 'task')}` }))

  return (
    <Modal isOpen onClose={onCancel} title={`Merge ‘${source.name}’`} size="md">
      <div className="flex flex-col gap-6">
        <p className="text-sm text-secondary">
          Pick the tag to keep. Every task tagged ‘{source.name}’ moves to it, then ‘{source.name}’ is deleted. Use this to
          clean up duplicates such as “urgent” and “Urgent!”.
        </p>
        <div>
          <p className="mb-1.5 text-sm font-medium text-label">
            Merge into <span className="text-danger" aria-hidden="true">*</span>
          </p>
          <StyledSelect value={intoId} onChange={setIntoId} options={options} placeholder="Choose a tag" searchPlaceholder="Search tags…" />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" disabled={!into} onClick={() => into && onContinue(into)} className={primaryBtn}>
            Continue
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface RowPerms {
  canEdit: boolean | undefined
  canDelete: boolean | undefined
  canMerge: boolean | undefined
}

function TagRow({
  tag,
  flash,
  busy,
  perms,
  hasMergeTarget,
  onEdit,
  onDeactivate,
  onReactivate,
  onDelete,
  onMerge,
}: {
  tag: TaskTag
  flash: boolean
  busy: boolean
  perms: RowPerms
  hasMergeTarget: boolean
  onEdit: () => void
  onDeactivate: () => void
  onReactivate: () => void
  onDelete: () => void
  onMerge: () => void
}) {
  const used = usageOf(tag)
  const creator = tag.created_by?.name ?? '—'

  // A permission answer wins over a record rule: only explain the rule to someone who could otherwise act.
  const deleteAllowed = perms.canDelete !== true ? perms.canDelete : used === 0
  const deleteReason = perms.canDelete === false ? MANAGE_REASON : `This tag is on ${plural(used, 'task')}, so it can only be deactivated.`
  const mergeAllowed = perms.canMerge !== true ? perms.canMerge : hasMergeTarget
  const mergeReason = perms.canMerge === false ? MANAGE_REASON : 'There’s no other active tag to merge this into.'

  return (
    <div
      data-tag-row={tag.id}
      className={[
        'border-b border-border px-4 py-3 last:border-b-0 transition-colors duration-500',
        flash ? 'bg-primary-light' : 'bg-white hover:bg-slate-50',
        GRID,
      ].join(' ')}
    >
      {/* Tag + description */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <TagChip tag={tag} size="md" />
          <span className="ml-auto shrink-0 lg:hidden">
            <StatusBadge active={tag.is_active} />
          </span>
        </div>
        {tag.description && <p className="mt-1 break-words text-sm text-secondary">{tag.description}</p>}
      </div>

      {/* Usage (+ creator below xl) */}
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm lg:mt-0">
        {used > 0 ? (
          <Link
            href={`/dashboard/tasks?tag_ids=${encodeURIComponent(tag.id)}`}
            className="rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Used on {plural(used, 'task')}
          </Link>
        ) : (
          <span className="text-helper">Not used yet</span>
        )}
        <span className="truncate text-helper xl:hidden">Created by {creator}</span>
      </div>

      {/* Created by (xl column) */}
      <div className="hidden min-w-0 truncate text-sm text-body xl:block">{creator}</div>

      {/* Status (lg column) */}
      <div className="hidden lg:block">
        <StatusBadge active={tag.is_active} />
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1 lg:mt-0 lg:justify-end">
        <RowAction label={`Edit ${tag.name}`} icon={<Pencil size={16} />} allowed={perms.canEdit} reason={MANAGE_REASON} busy={busy} onClick={onEdit} />
        {tag.is_active ? (
          <RowAction
            label={`Deactivate ${tag.name}`}
            icon={<Power size={16} />}
            allowed={perms.canEdit}
            reason={MANAGE_REASON}
            busy={busy}
            onClick={onDeactivate}
          />
        ) : (
          <RowAction
            label={`Reactivate ${tag.name}`}
            icon={<RotateCcw size={16} />}
            allowed={perms.canEdit}
            reason={MANAGE_REASON}
            busy={busy}
            onClick={onReactivate}
          />
        )}
        <RowAction
          label={`Merge ${tag.name} into another tag`}
          icon={<GitMerge size={16} />}
          allowed={mergeAllowed}
          reason={mergeReason}
          busy={busy}
          onClick={onMerge}
        />
        <RowAction
          label={`Delete ${tag.name}`}
          icon={<Trash2 size={16} />}
          allowed={deleteAllowed}
          reason={deleteReason}
          busy={busy}
          danger
          onClick={onDelete}
        />
      </div>
    </div>
  )
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

type Pending =
  | { kind: 'deactivate'; tag: TaskTag }
  | { kind: 'delete'; tag: TaskTag }
  | { kind: 'merge-pick'; tag: TaskTag }
  | { kind: 'merge-confirm'; tag: TaskTag; into: TaskTag }
  | null

export function TagsTab({ orgId }: { orgId: string }) {
  const { user } = useAuth()
  const perms = usePermissions()
  const { addToast } = useToast()

  // undefined = not known yet (kit §26.1): disabled with no reason.
  const known = !perms.loading
  const canCreate = known ? perms.isAdmin || perms.can('tasks.tags.create', 'write') || perms.can(MANAGE_LEAF, 'write') : undefined
  const canEdit = known ? perms.isAdmin || perms.can(MANAGE_LEAF, 'edit') : undefined
  const canDelete = known ? perms.isAdmin || perms.can(MANAGE_LEAF, 'delete') : undefined
  const canMerge = canEdit === undefined || canDelete === undefined ? undefined : canEdit && canDelete
  const rowPerms = useMemo<RowPerms>(() => ({ canEdit, canDelete, canMerge }), [canEdit, canDelete, canMerge])

  // ── Data: loading / failed / loaded are separate branches (kit §14.3) ──
  const [tags, setTags] = useState<TaskTag[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setTags(await tasksApi.getTags(orgId, { includeInactive: true }))
    } catch (e) {
      setLoadError(tagErrorMessage(e, 'Check your connection and try again.'))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  // Refetch in the background, keeping the rows on screen (rows update in place by id).
  // A failure keeps what is shown; the next visit loads afresh.
  const refreshQuietly = useCallback(async () => {
    try {
      setTags(await tasksApi.getTags(orgId, { includeInactive: true }))
    } catch {
      /* keep the current list */
    }
  }, [orgId])

  // ── Search / sort / show inactive — kept for the session (kit §27.3) ──
  const [query, setQuery] = useSessionState('tasks.masters.tags.search', '')
  const [debounced, setDebounced] = useState(query)
  const [sort, setSort] = useSessionState<SortKey>('tasks.masters.tags.sort', 'name')
  const [showInactive, setShowInactive] = useSessionState('tasks.masters.tags.showInactive', false)
  // Rows changed to inactive in this visit stay in view (with Reactivate) even while inactive tags are hidden.
  const [keepVisible, setKeepVisible] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const clearSearch = () => {
    setQuery('')
    setDebounced('')
  }

  const all = useMemo(() => tags ?? [], [tags])
  const inactiveCount = useMemo(() => all.filter((t) => !t.is_active).length, [all])
  const activeTags = useMemo(() => all.filter((t) => t.is_active), [all])
  const q = debounced.trim().toLowerCase()

  const visible = useMemo(() => {
    let list = all.filter((t) => showInactive || t.is_active || keepVisible.has(t.id))
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          (t.created_by?.name ?? '').toLowerCase().includes(q),
      )
    }
    const cmp =
      sort === 'most_used'
        ? (a: TaskTag, b: TaskTag) => usageOf(b) - usageOf(a) || byName(a, b)
        : sort === 'least_used'
          ? (a: TaskTag, b: TaskTag) => usageOf(a) - usageOf(b) || byName(a, b)
          : byName
    return [...list].sort(cmp)
  }, [all, showInactive, keepVisible, q, sort])

  // ── Reveal a row by scrolling the LIST box (never the page), then flash it ──
  const listRef = useRef<HTMLDivElement>(null)
  const [revealId, setRevealId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  useEffect(() => {
    if (!revealId) return
    const box = listRef.current
    const row = box?.querySelector<HTMLElement>(`[data-tag-row="${revealId}"]`)
    if (!box || !row) {
      // Not on screen (e.g. hidden by a filter): drop the request so it can't fire later.
      setRevealId(null)
      return
    }
    const top = row.offsetTop - (box.clientHeight - row.offsetHeight) / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    setFlashId(revealId)
    setRevealId(null)
  }, [revealId, visible])

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(t)
  }, [flashId])

  function reveal(tag: TaskTag) {
    const qq = query.trim().toLowerCase()
    if (qq && !tag.name.toLowerCase().includes(qq) && !(tag.description ?? '').toLowerCase().includes(qq)) clearSearch()
    if (!tag.is_active && !showInactive) setKeepVisible((s) => new Set(s).add(tag.id))
    setRevealId(tag.id)
  }

  // ── Local + shared-cache updates (in place, same key → no flicker) ──
  const applyTag = useCallback(
    (next: TaskTag) => {
      setTags((prev) => {
        if (!prev) return [next]
        return prev.some((t) => t.id === next.id) ? prev.map((t) => (t.id === next.id ? { ...t, ...next } : t)) : [...prev, next]
      })
      upsertCachedTag(orgId, next)
    },
    [orgId],
  )

  const dropTag = useCallback(
    (id: string) => {
      setTags((prev) => (prev ? prev.filter((t) => t.id !== id) : prev))
      removeCachedTag(orgId, id)
    },
    [orgId],
  )

  // ── Dialogs ──
  const [form, setForm] = useState<FormTarget | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)

  const openPending = (p: Pending) => {
    setActionError(null)
    setPending(p)
  }
  const closePending = () => {
    if (busy) return
    setPending(null)
    setActionError(null)
  }

  function handleSaved(tag: TaskTag, kind: SavedKind) {
    const full: TaskTag =
      kind === 'created'
        ? { ...tag, usage_count: tag.usage_count ?? 0, created_by: tag.created_by ?? (user ? { id: user.id, name: user.name } : null) }
        : tag
    applyTag(full)
    setForm(null)
    if (kind === 'created') addToast(`Tag ‘${full.name}’ created`, 'success')
    else if (kind === 'reactivated') addToast(`‘${full.name}’ reactivated`, 'success')
    else addToast(`‘${full.name}’ saved`, 'success')
    reveal(full)
  }

  // Create answered with an active tag someone else made since this list loaded. The
  // dialog says it exists; pickers get it now, and this list refetches it with its real
  // creator and usage rather than presenting it as ours with 0 uses.
  function handleExisting(tag: TaskTag) {
    upsertCachedTag(orgId, tag)
    void refreshQuietly()
  }

  async function confirmDeactivate(tag: TaskTag) {
    setBusy(true)
    setActionError(null)
    try {
      const updated = await tasksApi.updateTag(orgId, tag.id, { is_active: false })
      setKeepVisible((s) => new Set(s).add(tag.id))
      applyTag(updated)
      setPending(null)
      addToast(`‘${tag.name}’ deactivated`, 'success')
    } catch (e) {
      setActionError(tagErrorMessage(e, 'We couldn’t deactivate this tag. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(tag: TaskTag) {
    setRowBusyId(tag.id)
    try {
      const updated = await tasksApi.updateTag(orgId, tag.id, { is_active: true })
      applyTag(updated)
      addToast(`‘${tag.name}’ reactivated`, 'success')
    } catch (e) {
      addToast(tagErrorMessage(e, 'We couldn’t reactivate this tag. Try again.'), 'error')
    } finally {
      setRowBusyId(null)
    }
  }

  async function confirmDelete(tag: TaskTag) {
    setBusy(true)
    setActionError(null)
    try {
      const res = await tasksApi.deleteTag(orgId, tag.id)
      setPending(null)
      if (res.result === 'deleted') {
        dropTag(tag.id)
        addToast(`‘${tag.name}’ deleted`, 'success')
      } else {
        // The server found a reference we couldn't see (a recurring task, or a task tagged just now).
        setKeepVisible((s) => new Set(s).add(tag.id))
        applyTag({ ...tag, is_active: false })
        addToast(`‘${tag.name}’ is still used by a recurring task, so it was deactivated instead of deleted.`, 'info')
      }
    } catch (e) {
      setActionError(tagErrorMessage(e, 'We couldn’t delete this tag. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmMerge(source: TaskTag, into: TaskTag) {
    setBusy(true)
    setActionError(null)
    try {
      const res = await tasksApi.mergeTag(orgId, source.id, into.id)
      setPending(null)
      setTags((prev) => (prev ? prev.filter((t) => t.id !== source.id).map((t) => (t.id === res.into.id ? { ...t, ...res.into } : t)) : prev))
      // A merge changes two tags and every picker's list: refetch them all.
      invalidateTaskTags(orgId)
      addToast(`Merged ‘${source.name}’ into ‘${res.into.name}’ · ${plural(res.moved, 'task')} moved`, 'success')
      reveal(res.into)
    } catch (e) {
      setActionError(tagErrorMessage(e, 'We couldn’t merge these tags. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──
  const totalLine = tags
    ? `${plural(activeTags.length, 'active tag')}${inactiveCount ? ` · ${inactiveCount} inactive` : ''}`
    : ' '

  const createButton = (variant: 'primary' | 'secondary') => (
    <PermissionTooltip allowed={canCreate} reason={CREATE_TAG_REASON}>
      <button
        type="button"
        disabled={canCreate !== true}
        onClick={() => setForm({ mode: 'create' })}
        className={variant === 'primary' ? primaryBtn : secondaryBtn}
      >
        <Plus size={16} aria-hidden="true" /> Create tag
      </button>
    </PermissionTooltip>
  )

  let body: ReactNode
  if (loading) {
    body = <RowsSkeleton />
  } else if (loadError) {
    body = (
      <EmptyState
        title="Couldn’t load tags"
        line={loadError}
        action={
          <button type="button" onClick={() => void load()} className={secondaryBtn}>
            <RotateCcw size={16} aria-hidden="true" /> Retry
          </button>
        }
      />
    )
  } else if (all.length === 0) {
    body = (
      <EmptyState
        title="No tags yet"
        line="Tags let you label tasks across categories. Most are created while tagging a task."
        action={canCreate === true ? createButton('secondary') : undefined}
      />
    )
  } else if (visible.length === 0 && q) {
    body = (
      <EmptyState
        title={`No tags match ‘${debounced.trim()}’`}
        line="Check the spelling, or search by another word from the name or description."
        action={
          <button type="button" onClick={clearSearch} className={secondaryBtn}>
            Clear search
          </button>
        }
      />
    )
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        title="No active tags"
        line={`${plural(inactiveCount, 'inactive tag is', 'inactive tags are')} hidden.`}
        action={
          <button type="button" onClick={() => setShowInactive(true)} className={secondaryBtn}>
            Show inactive
          </button>
        }
      />
    )
  } else {
    body = visible.map((tag) => (
      <TagRow
        key={tag.id}
        tag={tag}
        flash={flashId === tag.id}
        busy={rowBusyId === tag.id}
        perms={rowPerms}
        hasMergeTarget={activeTags.some((t) => t.id !== tag.id)}
        onEdit={() => setForm({ mode: 'edit', tag })}
        onDeactivate={() => openPending({ kind: 'deactivate', tag })}
        onReactivate={() => void reactivate(tag)}
        onDelete={() => openPending({ kind: 'delete', tag })}
        onMerge={() => openPending({ kind: 'merge-pick', tag })}
      />
    ))
  }

  const p = pending
  const used = p ? usageOf(p.tag) : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Header: what this is + the one primary action */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-secondary">
            People add tags while tagging tasks. Rename, recolour, merge or retire them here.
          </p>
          <p className="mt-0.5 text-xs text-helper" aria-live="polite">
            {totalLine}
          </p>
        </div>
        <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{createButton('primary')}</div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative w-full sm:w-[280px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-helper" aria-hidden="true" />
          <Tooltip label="Searches tag names, descriptions and who created them">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags"
              aria-label="Search tags"
              className={`${fieldCls} h-11 lg:h-9 border-input pl-9 pr-10 hover:border-secondary [&::-webkit-search-cancel-button]:hidden`}
            />
          </Tooltip>
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 inline-flex h-9 w-9 lg:h-7 lg:w-7 -translate-y-1/2 items-center justify-center rounded-btn text-secondary hover:bg-slate-100 hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {tags && q && <span className="text-sm text-secondary whitespace-nowrap">{plural(visible.length, 'result')}</span>}

        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-sm text-secondary">Sort</span>
          <StyledSelect
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={SORT_OPTIONS}
            wrapperClassName="w-full sm:w-44"
            searchable={false}
          />
        </div>

        <label className="inline-flex h-11 lg:h-9 cursor-pointer select-none items-center gap-2 rounded-btn border border-border bg-white px-3 text-sm text-body hover:bg-slate-50">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Show inactive
          {inactiveCount > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-white">
              {inactiveCount > 99 ? '99+' : inactiveCount}
            </span>
          )}
        </label>
      </div>

      {/* List: header pinned, rows scroll inside their own box */}
      <div className="overflow-hidden rounded-card border border-border bg-white">
        <div
          className={`hidden border-b border-border bg-slate-50 px-4 py-2 text-xs font-medium text-secondary ${GRID}`}
          aria-hidden="true"
        >
          <span>Tag</span>
          <span>Usage</span>
          <span className="hidden xl:block">Created by</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>
        <div ref={listRef} className="relative max-h-[calc(100dvh-28rem)] min-h-[18rem] overflow-y-auto overscroll-contain">
          {body}
        </div>
      </div>

      {/* ── Dialogs ── */}
      {form && (
        <TagFormModal
          key={form.mode === 'edit' ? form.tag.id : 'create'}
          orgId={orgId}
          target={form}
          allTags={all}
          canReactivate={canEdit}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
          onExisting={handleExisting}
        />
      )}

      {p?.kind === 'merge-pick' && (
        <MergePickModal
          source={p.tag}
          targets={activeTags.filter((t) => t.id !== p.tag.id)}
          onCancel={closePending}
          // Replace this dialog with the confirmation — never one dialog on top of another (kit §24.4).
          onContinue={(into) => openPending({ kind: 'merge-confirm', tag: p.tag, into })}
        />
      )}

      <ConfirmDialog
        open={p?.kind === 'deactivate'}
        title={p ? `Deactivate ‘${p.tag.name}’?` : ''}
        message={
          used > 0
            ? `It stays on ${plural(used, 'existing task')} but can’t be added to new ones.`
            : 'It isn’t on any tasks. It won’t be offered when tagging tasks until someone reactivates it.'
        }
        confirmLabel="Deactivate tag"
        loading={busy}
        error={actionError}
        onCancel={closePending}
        onConfirm={() => p && void confirmDeactivate(p.tag)}
      />

      <ConfirmDialog
        open={p?.kind === 'delete'}
        title={p ? `Delete ‘${p.tag.name}’?` : ''}
        message="No task uses this tag, so it will be removed for good. This can’t be undone."
        confirmLabel="Delete tag"
        danger
        loading={busy}
        error={actionError}
        onCancel={closePending}
        onConfirm={() => p && void confirmDelete(p.tag)}
      />

      <ConfirmDialog
        open={p?.kind === 'merge-confirm'}
        title={p?.kind === 'merge-confirm' ? `Merge ‘${p.tag.name}’ into ‘${p.into.name}’?` : ''}
        message={
          p?.kind === 'merge-confirm'
            ? `${
                used > 0
                  ? `${plural(used, 'task')} tagged ‘${p.tag.name}’ will be tagged ‘${p.into.name}’ instead.`
                  : `‘${p.tag.name}’ isn’t on any tasks.`
              } Recurring tasks that use it switch to ‘${p.into.name}’, and ‘${p.tag.name}’ is deleted. This can’t be undone.`
            : undefined
        }
        confirmLabel="Merge tags"
        danger
        loading={busy}
        error={actionError}
        onCancel={closePending}
        onConfirm={() => p?.kind === 'merge-confirm' && void confirmMerge(p.tag, p.into)}
      />
    </div>
  )
}

export default TagsTab
