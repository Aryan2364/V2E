'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MultiSelect, { type MultiSelectOption } from '@/components/ui/MultiSelect'
import TagChip from '@/components/ui/TagChip'
import { isTagConflictError, tagErrorMessage, tasksApi } from '@/lib/api/tasks'
import { usePermissions } from '@/lib/auth/use-permissions'
import { tagDotClass } from '@/lib/tasks/tagColors'
import { upsertCachedTag, useTaskTags } from '@/lib/tasks/useTaskTags'
import { MAX_TAGS_PER_TASK, type TaskTag, type TaskTagRef } from '@/lib/types/tasks'

interface TagPickerProps {
  orgId: string
  /** Selected tag ids. */
  value: string[]
  onChange: (ids: string[]) => void
  /** Most tags allowed. Default 10 (MAX_TAGS_PER_TASK). */
  max?: number
  disabled?: boolean
  placeholder?: string
  /**
   * The record's own tag refs (e.g. `task.tags`, a template's `tags`). A selected id the
   * org's list doesn't resolve — a tag created elsewhere since the list was cached —
   * still gets its chip (and its ✕) from these.
   */
  knownTags?: TaskTagRef[] | null
}

export const CREATE_TAG_REASON = 'Only people allowed to create task tags can do this.'
const NAME_MAX = 40

/** Mirrors the server's DTO rules so the create row never offers a name it would reject. */
function invalidTagName(name: string): string | null {
  if (/[,|]/.test(name)) return 'Tag names can’t contain commas or pipes'
  if (name.length > NAME_MAX) return `Tag names can be up to ${NAME_MAX} characters`
  return null
}

type Notice =
  | { kind: 'conflict'; name: string; tagId: string | null }
  | { kind: 'error'; message: string }

/**
 * The Tags field for task (and recurring template) forms and the inline "+ Add tag"
 * control. Built on the shared MultiSelect (kit §4.1: extended, not forked).
 *
 * - Selected tags show as coloured TagChips. A tag that has since been deactivated
 *   stays shown (muted) while it is selected, but inactive tags are never offered as
 *   new options.
 * - Typing a name with no exact match offers "Create tag "<name>"". It is gated on
 *   tasks.tags.create / tasks.config.tags.manage (write): disabled with a permission
 *   tooltip when not allowed, disabled with no reason while permissions load. A new
 *   tag is selected immediately.
 * - If the name belongs to a deactivated tag, an inline message explains; someone who
 *   manages tags gets a Reactivate action instead.
 * - Loading shows a skeleton; a failed load shows "Couldn't load tags · Retry" and the
 *   rest of the form keeps working.
 * - At `max` tags, further options are disabled with "Up to 10 tags per task".
 */
export function TagPicker({
  orgId,
  value,
  onChange,
  max = MAX_TAGS_PER_TASK,
  disabled = false,
  placeholder = 'No tags',
  knownTags,
}: TagPickerProps) {
  // includeInactive: a selected tag may have been deactivated since; we still need its chip.
  // ensureIds: a selected tag the cached list lacks (created elsewhere) triggers one refetch.
  const { tags, loading, error, resolving, reload, createTag } = useTaskTags(orgId, { includeInactive: true, ensureIds: value })
  const perms = usePermissions()

  const canCreate: boolean | undefined = perms.loading
    ? undefined
    : perms.isAdmin || perms.can('tasks.tags.create', 'write') || perms.can('tasks.config.tags.manage', 'write')
  const canReactivate: boolean | undefined = perms.loading
    ? undefined
    : perms.isAdmin || perms.can('tasks.config.tags.manage', 'edit')

  const [notice, setNotice] = useState<Notice | null>(null)
  const [reactivating, setReactivating] = useState(false)

  // Async callbacks must add to the CURRENT selection, not the one they closed over.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  const select = useCallback(
    (id: string) => {
      const cur = valueRef.current
      if (!cur.includes(id) && cur.length < max) onChange([...cur, id])
    },
    [onChange, max],
  )

  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  // Selected ids the org list can't resolve: named from the record's own refs when it
  // has them, otherwise a muted placeholder — either way the chip shows and its ✕ works,
  // so an id can never sit invisibly in the value counting toward the limit.
  const extraSelected = useMemo<TaskTagRef[]>(
    () =>
      value
        .filter((id) => !byId.has(id))
        .map(
          (id) =>
            knownTags?.find((t) => t.id === id) ?? {
              id,
              name: resolving ? '…' : 'Unknown tag',
              color: 'slate' as const,
              is_active: false,
            },
        ),
    [knownTags, value, byId, resolving],
  )

  const chipById = useMemo(() => {
    const m = new Map<string, TaskTagRef>(byId)
    for (const t of extraSelected) m.set(t.id, t)
    return m
  }, [byId, extraSelected])

  const options: MultiSelectOption[] = useMemo(
    () =>
      [...tags.filter((t) => t.is_active || value.includes(t.id)), ...extraSelected].map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.is_active
          ? undefined
          : byId.has(t.id) || knownTags?.some((k) => k.id === t.id)
            ? 'Inactive — can stay on this task, but can’t be added again'
            : 'Not found — it may have been deleted',
        colorClassName: tagDotClass(t.color, !t.is_active),
      })),
    [tags, value, extraSelected, byId, knownTags],
  )

  const handleCreate = useCallback(
    async (query: string) => {
      setNotice(null)
      try {
        const tag = await createTag(query)
        select(tag.id)
      } catch (e) {
        if (isTagConflictError(e)) {
          // The picker loads inactive tags too, so fall back to a name match when the
          // error body doesn't carry tag_id.
          const key = query.trim().replace(/\s+/g, ' ').toLowerCase()
          const existing =
            (e.tagId ? byId.get(e.tagId) : undefined) ??
            tags.find((t) => !t.is_active && t.name.toLowerCase() === key)
          setNotice({ kind: 'conflict', name: existing?.name ?? query.trim(), tagId: existing?.id ?? e.tagId })
        } else {
          setNotice({ kind: 'error', message: tagErrorMessage(e, 'Couldn’t create that tag. Try again.') })
        }
        throw e
      }
    },
    [createTag, select, byId, tags],
  )

  const reactivate = useCallback(
    async (tagId: string) => {
      setReactivating(true)
      try {
        const tag: TaskTag = await tasksApi.updateTag(orgId, tagId, { is_active: true })
        upsertCachedTag(orgId, tag)
        select(tag.id)
        setNotice(null)
      } catch (e) {
        setNotice({ kind: 'error', message: tagErrorMessage(e, 'Couldn’t reactivate that tag. Try again.') })
      } finally {
        setReactivating(false)
      }
    },
    [orgId, select],
  )

  if (loading) {
    // Same height as the field, so nothing below moves when the tags land (kit §14).
    return <div aria-busy="true" aria-label="Loading tags" className="h-[42px] w-full rounded-lg bg-border animate-pulse" />
  }

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-2 h-[42px] w-full rounded-lg border border-border bg-white px-3 text-sm text-secondary">
        <span>Couldn’t load tags</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => void reload()}
          className="font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="w-full">
      <MultiSelect
        value={value}
        onChange={(ids) => {
          setNotice(null)
          onChange(ids)
        }}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={canCreate ? 'Search or create a tag…' : 'Search tags…'}
        emptyText={canCreate ? 'No tags yet. Type a name to create one.' : 'No tags yet.'}
        renderChip={(o, onRemove) => {
          const tag = chipById.get(o.value)
          if (!tag) return null
          return <TagChip tag={tag} size="sm" onRemove={disabled ? undefined : onRemove} />
        }}
        onCreate={handleCreate}
        createLabel={(q) => `Create tag "${q}"`}
        canCreate={canCreate}
        createDisabledReason={CREATE_TAG_REASON}
        createInvalidReason={invalidTagName}
        maxSelected={max}
        maxSelectedHint={`Up to ${max} tags per task`}
      />

      {notice?.kind === 'conflict' && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary">
          {canReactivate && notice.tagId ? (
            <>
              <span>‘{notice.name}’ exists but is deactivated.</span>
              <button
                type="button"
                disabled={reactivating || value.length >= max}
                onClick={() => notice.tagId && void reactivate(notice.tagId)}
                className="font-medium text-primary hover:underline disabled:text-secondary disabled:no-underline disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                {reactivating ? 'Reactivating…' : 'Reactivate it'}
              </button>
            </>
          ) : (
            <span>‘{notice.name}’ exists but is deactivated — ask someone who manages tags to reactivate it.</span>
          )}
        </p>
      )}
      {notice?.kind === 'error' && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {notice.message}
        </p>
      )}
    </div>
  )
}

export default TagPicker
