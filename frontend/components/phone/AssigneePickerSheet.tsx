'use client'

import React from 'react'
import { Search, X, Check, UserPlus } from 'lucide-react'
import { avatarColor, getInitials } from '@/components/tasks/AssigneeSelector'
import { useEligibleAssignees, type AssigneeSortMode } from '@/components/tasks/useEligibleAssignees'
import type { EligibleAssigneeUser } from '@/lib/types/tasks'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, cx } from './primitives'

/*
 * The assignee picker as a phone sheet - the same data, visibility rules and
 * grouping as the desktop AssigneeSelector (shared useEligibleAssignees): an
 * "Assign to me" row, then the eligible people by department, searchable and
 * sortable. Full height, search and sort fixed at the top (41.7 rule 7, 41.8
 * rule 8), 48px rows with avatar, name and role, a tick on the selected ones,
 * Done in the footer.
 */

export type PickedAssignee = { user_id: string; name: string }

const SORTS: { key: AssigneeSortMode; label: string }[] = [
  { key: 'frequency', label: 'Frequent' },
  { key: 'workload', label: 'Workload' },
  { key: 'name', label: 'A-Z' },
]

export function AssigneePickerSheet({
  open,
  onOpenChange,
  orgId,
  currentUser,
  selected,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  currentUser?: PickedAssignee
  selected: PickedAssignee[]
  onChange: (next: PickedAssignee[]) => void
}) {
  const { search, setSearch, sort, setSort, loading, failed, departments, visibleTotal, reload } = useEligibleAssignees({
    orgId,
    open,
    currentUserId: currentUser?.user_id,
  })
  const selectedIds = new Set(selected.map((s) => s.user_id))

  function toggle(u: PickedAssignee) {
    onChange(
      selectedIds.has(u.user_id)
        ? selected.filter((s) => s.user_id !== u.user_id)
        : [...selected, { user_id: u.user_id, name: u.name }],
    )
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Choose assignees"
      fullHeight
      footer={
        <PhoneButton type="button" variant="primary" fullWidth onClick={() => onOpenChange(false)}>
          Done{selected.length > 0 ? ` (${selected.length})` : ''}
        </PhoneButton>
      }
    >
      <div className="sticky top-0 z-10 -mx-[16px] flex flex-col gap-[8px] bg-surface px-[16px] pb-[8px]">
        <div className="relative">
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-[16px] -translate-y-1/2 text-text-secondary" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, role or department"
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
        <div className="flex gap-[8px]" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sort === s.key}
              onClick={() => setSort(s.key)}
              className={cx(
                'min-h-[36px] rounded-full px-[14px] py-[6px] text-label font-medium',
                sort === s.key
                  ? 'border border-primary bg-primary-subtle text-primary-text'
                  : 'border border-border bg-surface text-text-secondary',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-[16px]">
        {currentUser && !selectedIds.has(currentUser.user_id) ? (
          <button
            type="button"
            onClick={() => toggle(currentUser)}
            className="flex min-h-[48px] w-full items-center gap-[12px] border-y border-border-light px-[16px] py-[12px] text-left text-body font-medium text-primary-text active:bg-surface-control"
          >
            <UserPlus aria-hidden className="size-[20px] shrink-0" />
            Assign to me
          </button>
        ) : null}

        {loading ? (
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
          <div className="flex flex-col items-center gap-[12px] px-[16px] py-[32px] text-center">
            <p className="text-body text-text-secondary">People could not be loaded.</p>
            <PhoneButton type="button" variant="secondary" onClick={reload}>
              Try again
            </PhoneButton>
          </div>
        ) : visibleTotal === 0 ? (
          <div className="px-[16px] py-[32px] text-center">
            <p className="text-body font-medium text-text-primary">{search ? 'No one found' : 'No eligible assignees'}</p>
            <p className="mt-[4px] text-meta text-text-secondary">
              {search ? 'Try a different search term.' : 'Check visibility settings in Task Masters.'}
            </p>
          </div>
        ) : (
          departments.map((dept) => (
            <section key={dept.department_id}>
              {dept.department_id !== 'search' ? (
                <h3 className="border-y border-border-light bg-surface-sunken px-[16px] py-[6px] text-meta font-medium text-text-secondary">
                  {dept.department_name} ({dept.users.length})
                </h3>
              ) : null}
              <ul className="divide-y divide-border-light">
                {dept.users.map((u) => (
                  <li key={u.user_id}>
                    <PersonRow user={u} checked={selectedIds.has(u.user_id)} onToggle={() => toggle(u)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </PhoneSheet>
  )
}

function PersonRow({ user, checked, onToggle }: { user: EligibleAssigneeUser; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cx(
        'flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[8px] text-left active:bg-surface-control',
        'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring',
        checked && 'bg-primary-subtle',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex size-[32px] shrink-0 items-center justify-center rounded-full text-meta font-medium text-primary-foreground',
          avatarColor(user.name),
        )}
      >
        {getInitials(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-text-primary">{user.name}</span>
        <span className="block truncate text-meta text-text-secondary">
          {[user.role_title, user.on_leave_today ? 'On leave' : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      {checked ? (
        <span aria-hidden className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary">
          <Check className="size-[14px] text-primary-foreground" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  )
}
