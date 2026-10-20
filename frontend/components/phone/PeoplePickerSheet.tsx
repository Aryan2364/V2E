'use client'

import React from 'react'
import { Search, X, Check, ArrowUpDown } from 'lucide-react'
import { avatarColor, getInitials } from '@/components/tasks/AssigneeSelector'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, cx } from './primitives'

/*
 * ONE people picker for the phone - task assignees and meeting attendees.
 * Kit 41.8 (full-height sheet, search fixed at the top, never auto-focused,
 * search keyboard), 16.3 (multi-select), 22.1 (selection survives a search).
 *
 * Top to bottom: title, the search field with a Sort button beside it (only
 * when the caller offers sort options), then the people. The current user is
 * the first row (label from `meLabel`), styled like every other row and a
 * plain toggle. While searching, matches are shown flat.
 *
 * What differs between callers is data only: the sections, the sort options,
 * whether search is done by the server (controlled `search`) or here, and
 * whether a picked person can be marked optional.
 */

export type PickerPerson = {
  user_id: string
  name: string
  role?: string | null
  department?: string | null
  note?: string | null
}

export type PickerSection = {
  id: string
  /** Header text. Omit for a single flat list. */
  name?: string
  people: PickerPerson[]
}

export type PickedPerson = { user_id: string; name: string }

export type PickerSortOption<K extends string = string> = { key: K; label: string }

export function PeoplePickerSheet<K extends string = string>({
  open,
  onOpenChange,
  title,
  sections,
  loading = false,
  failed = false,
  onRetry,
  currentUser,
  meLabel = 'Assign to me',
  selected,
  optionalIds,
  allowOptional = false,
  onDone,
  search: controlledSearch,
  onSearchChange,
  searchPlaceholder = 'Search people',
  sort,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  sections: PickerSection[]
  loading?: boolean
  failed?: boolean
  onRetry?: () => void
  /** Shown as the first row, labelled `meLabel`, when given. */
  currentUser?: PickerPerson
  meLabel?: string
  selected: PickedPerson[]
  optionalIds?: string[]
  /** Picked people get a Required / Optional toggle (meeting attendees). */
  allowOptional?: boolean
  onDone: (selected: PickedPerson[], optionalIds: string[]) => void
  /** Pass both when the server does the searching; otherwise the sheet filters locally. */
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  /** Pass to offer the Sort button. */
  sort?: { value: K; onChange: (key: K) => void; options: PickerSortOption<K>[] }
}) {
  const [localSearch, setLocalSearch] = React.useState('')
  const serverSearch = controlledSearch !== undefined && onSearchChange !== undefined
  const search = serverSearch ? controlledSearch : localSearch
  const setSearch = serverSearch ? onSearchChange : setLocalSearch

  const [draft, setDraft] = React.useState<PickedPerson[]>(selected)
  const [draftOptional, setDraftOptional] = React.useState<string[]>(optionalIds ?? [])

  // Each opening starts from what the caller holds, with a clean search.
  React.useEffect(() => {
    if (open) {
      setDraft(selected)
      setDraftOptional(optionalIds ?? [])
      setLocalSearch('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickedIds = new Set(draft.map((p) => p.user_id))

  function toggle(p: PickerPerson) {
    setDraft((cur) =>
      cur.some((s) => s.user_id === p.user_id)
        ? cur.filter((s) => s.user_id !== p.user_id)
        : [...cur, { user_id: p.user_id, name: p.name }],
    )
  }
  function toggleOptional(id: string) {
    setDraftOptional((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const q = search.trim().toLowerCase()
  const matches = (p: PickerPerson) =>
    !q || [p.name, p.role, p.department].some((v) => v && v.toLowerCase().includes(q))

  // Local filtering only; a server search has already filtered `sections`.
  const visibleSections = sections
    .map((s) => ({ ...s, people: serverSearch ? s.people : s.people.filter(matches) }))
    .filter((s) => s.people.length > 0)
  const flat = q ? visibleSections.flatMap((s) => s.people) : []
  const meShown = !!currentUser && (!q || matches(currentUser) || meLabel.toLowerCase().includes(q))
  const total = visibleSections.reduce((n, s) => n + s.people.length, 0) + (meShown ? 1 : 0)

  function done() {
    onDone(draft, draftOptional.filter((id) => pickedIds.has(id)))
    onOpenChange(false)
  }

  const row = (p: PickerPerson, label?: string) => (
    <PersonRow
      person={p}
      label={label}
      checked={pickedIds.has(p.user_id)}
      onToggle={() => toggle(p)}
      optional={allowOptional ? draftOptional.includes(p.user_id) : undefined}
      onToggleOptional={() => toggleOptional(p.user_id)}
    />
  )

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      fullHeight
      footer={
        <PhoneButton type="button" variant="primary" fullWidth onClick={done}>
          Done{draft.length > 0 ? ` · ${draft.length}` : ''}
        </PhoneButton>
      }
    >
      <div className="sticky top-0 z-10 -mx-[16px] flex items-center gap-[4px] bg-surface px-[16px] pb-[8px]">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-[16px] -translate-y-1/2 text-text-secondary" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface py-[8px] pl-[36px] pr-[44px] text-[16px] text-text-primary outline-hidden placeholder:text-text-muted focus-visible:border-primary"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="absolute right-0 top-1/2 flex size-[44px] -translate-y-1/2 items-center justify-center text-text-secondary"
            >
              <X aria-hidden className="size-[16px]" />
            </button>
          ) : null}
        </div>
        {sort ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Sort"
              className="flex size-[44px] shrink-0 items-center justify-center rounded-[8px] text-text-secondary active:bg-surface-control"
            >
              <ArrowUpDown aria-hidden className="size-[20px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={sort.value} onValueChange={(v) => sort.onChange(v as K)}>
                  {sort.options.map((o) => (
                    <DropdownMenuRadioItem key={o.key} value={o.key}>
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="-mx-[16px]">
        {loading && sections.length === 0 ? (
          <div aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex min-h-[48px] items-center gap-[12px] px-[16px] py-[8px]">
                <span className="size-[32px] shrink-0 rounded-full bg-surface-control" />
                <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
                  <span className="h-[12px] w-1/2 rounded-full bg-surface-control" />
                  <span className="h-[10px] w-1/3 rounded-full bg-surface-control" />
                </span>
              </div>
            ))}
          </div>
        ) : failed ? (
          <EmptyState variant="failed" heading="People could not be loaded" actionLabel="Try again" onAction={onRetry}>
            Check your connection and try again.
          </EmptyState>
        ) : total === 0 ? (
          q ? (
            <EmptyState variant="nothing-found" heading={`No one matches "${search.trim()}"`}>
              Try a different name, role or department.
            </EmptyState>
          ) : (
            <EmptyState variant="nothing-yet" heading="No one to choose">
              Nobody is available to pick right now.
            </EmptyState>
          )
        ) : (
          <>
            {meShown && currentUser ? (
              <ul className="divide-y divide-border-light border-b border-border-light">
                <li>{row(currentUser, meLabel)}</li>
              </ul>
            ) : null}
            {q ? (
              <ul className="divide-y divide-border-light">
                {flat.map((p) => (
                  <li key={p.user_id}>{row(p)}</li>
                ))}
              </ul>
            ) : (
              visibleSections.map((s) => (
                <section key={s.id}>
                  {s.name ? (
                    <h3 className="border-y border-border-light bg-surface-sunken px-[16px] py-[6px] text-meta font-medium text-text-secondary">
                      {s.name} ({s.people.length})
                    </h3>
                  ) : null}
                  <ul className="divide-y divide-border-light">
                    {s.people.map((p) => (
                      <li key={p.user_id}>{row(p)}</li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </PhoneSheet>
  )
}

function PersonRow({
  person,
  label,
  checked,
  onToggle,
  optional,
  onToggleOptional,
}: {
  person: PickerPerson
  label?: string
  checked: boolean
  onToggle: () => void
  /** Defined only where picked people can be marked optional. */
  optional?: boolean
  onToggleOptional?: () => void
}) {
  const secondary = [person.role, person.department, person.note].filter(Boolean).join(' · ')
  return (
    <div className={cx('flex min-h-[48px] items-center', checked && 'bg-primary-subtle')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className={cx(
          'flex min-h-[48px] min-w-0 flex-1 items-center gap-[12px] px-[16px] py-[8px] text-left active:bg-surface-control',
          'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'flex size-[32px] shrink-0 items-center justify-center rounded-full text-meta font-medium text-primary-foreground',
            avatarColor(person.name),
          )}
        >
          {getInitials(person.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-text-primary">{label ?? person.name}</span>
          {secondary ? <span className="block truncate text-meta text-text-secondary">{secondary}</span> : null}
        </span>
        {checked ? (
          <span aria-hidden className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary">
            <Check className="size-[14px] text-primary-foreground" strokeWidth={3} />
          </span>
        ) : null}
      </button>
      {checked && optional !== undefined ? (
        <button
          type="button"
          onClick={onToggleOptional}
          className={cx(
            'mr-[12px] min-h-[36px] shrink-0 rounded-full border px-[10px] text-meta font-medium',
            optional ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border text-text-secondary',
          )}
        >
          {optional ? 'Optional' : 'Required'}
        </button>
      ) : null}
    </div>
  )
}

/*
 * The chosen people on a form, each removable without reopening the sheet.
 * The x is a 44px tap area; the name truncates.
 */
export function SelectedPeopleList({
  people,
  onRemove,
}: {
  people: PickedPerson[]
  onRemove: (id: string) => void
}) {
  if (people.length === 0) return null
  return (
    <ul className="flex flex-col divide-y divide-border-light rounded-[8px] border border-border-light bg-surface">
      {people.map((p) => (
        <li key={p.user_id} className="flex min-h-[48px] items-center gap-[12px] pl-[12px]">
          <span
            aria-hidden
            className={cx(
              'flex size-[32px] shrink-0 items-center justify-center rounded-full text-meta font-medium text-primary-foreground',
              avatarColor(p.name),
            )}
          >
            {getInitials(p.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-text-primary">{p.name}</span>
          <button
            type="button"
            aria-label={`Remove ${p.name}`}
            onClick={() => onRemove(p.user_id)}
            className="flex size-[44px] shrink-0 items-center justify-center text-text-secondary active:bg-surface-control"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        </li>
      ))}
    </ul>
  )
}
