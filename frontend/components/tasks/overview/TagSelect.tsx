'use client'

import { useMemo } from 'react'
import MultiSelect, { type MultiSelectOption } from '@/components/ui/MultiSelect'
import TagChip from '@/components/ui/TagChip'
import { tagDotClass } from '@/lib/tasks/tagColors'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import type { TaskTagRef } from '@/lib/types/tasks'

/**
 * Pick existing tags, never create one — the overview's Tags filter (panel and table
 * header) and the bulk bar's "Remove tags". The shared MultiSelect with coloured
 * TagChips; TagPicker is the variant for forms, where a new tag may be created.
 *
 * Offers the org's active tags, plus any selected tag that has since been deactivated
 * (so it still shows, muted, and can be removed). Pass `pool` to offer exactly those
 * tags instead — e.g. the tags carried by the selected tasks.
 *
 * Loading is a skeleton the height of the field and a failed load is an inline
 * "Couldn't load tags · Retry" (kit §13, §14), so nothing around it moves.
 */
export default function TagSelect({
  orgId,
  value,
  onChange,
  pool,
  placeholder = 'All tags',
  emptyText = 'No tags yet.',
  disabled = false,
  wrapperClassName = 'w-full',
  maxSelected,
  maxSelectedHint,
}: {
  orgId: string
  value: string[]
  onChange: (ids: string[]) => void
  pool?: TaskTagRef[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  wrapperClassName?: string
  /** At most this many may be picked (e.g. the bulk endpoint's 50-id cap). */
  maxSelected?: number
  maxSelectedHint?: string
}) {
  // ensureIds: a value from a link (?tag_ids=) may name a tag created after the list was cached.
  const { tags, loading, error, resolving, reload } = useTaskTags(orgId, { includeInactive: true, ensureIds: value })

  const byId = useMemo(() => {
    const m = new Map<string, TaskTagRef>(tags.map((t) => [t.id, t]))
    for (const t of pool ?? []) if (!m.has(t.id)) m.set(t.id, t)
    return m
  }, [tags, pool])

  // A selected id nothing resolves still gets a (muted, removable) chip, so a filter is
  // never applied invisibly.
  const unresolved = useMemo<TaskTagRef[]>(
    () =>
      value
        .filter((id) => !byId.has(id))
        .map((id) => ({ id, name: resolving ? '…' : 'Unknown tag', color: 'slate' as const, is_active: false })),
    [value, byId, resolving],
  )

  const options: MultiSelectOption[] = useMemo(() => {
    const offered: TaskTagRef[] = [...(pool ?? tags.filter((t) => t.is_active || value.includes(t.id))), ...unresolved]
    return offered.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.is_active ? undefined : byId.has(t.id) ? 'Inactive' : 'Not found',
      colorClassName: tagDotClass(t.color, !t.is_active),
    }))
  }, [pool, tags, value, unresolved, byId])

  const chipById = useMemo(() => {
    const m = new Map(byId)
    for (const t of unresolved) m.set(t.id, t)
    return m
  }, [byId, unresolved])

  if (loading && !pool) {
    return <div aria-busy="true" aria-label="Loading tags" className={`h-[42px] rounded-lg bg-border animate-pulse ${wrapperClassName}`} />
  }

  if (error && !pool) {
    return (
      <div role="alert" className={`flex items-center gap-2 h-[42px] rounded-lg border border-border bg-white px-3 text-sm text-secondary ${wrapperClassName}`}>
        <span className="truncate">Couldn’t load tags</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => void reload()}
          className="shrink-0 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <MultiSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Search tags…"
      emptyText={emptyText}
      disabled={disabled}
      wrapperClassName={wrapperClassName}
      maxSelected={maxSelected}
      maxSelectedHint={maxSelectedHint}
      renderChip={(o, onRemove) => {
        const tag = chipById.get(o.value)
        return tag ? <TagChip tag={tag} size="sm" onRemove={disabled ? undefined : onRemove} /> : null
      }}
    />
  )
}
