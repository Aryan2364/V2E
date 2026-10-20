'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Search, X, Plus, Check, Zap, Briefcase, UserPlus } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useEligibleAssignees, type AssigneeSortMode } from './useEligibleAssignees'
import type { EligibleAssigneeUser, SelectedAssignee } from '@/lib/types/tasks'

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const avatarColors = [
  'bg-primary', 'bg-text-secondary', 'bg-success',
  'bg-warning', 'bg-danger', 'bg-text-secondary',
]
export function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}
export function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

// ─── Sort type ────────────────────────────────────────────────────────────────

type SortMode = AssigneeSortMode

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-surface-control shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-surface-control rounded-xs w-32" />
        <div className="h-2.5 bg-surface-control rounded-xs w-20" />
      </div>
    </div>
  )
}

// ─── User row ─────────────────────────────────────────────────────────────────

function UserRow({
  user,
  selected,
  onToggle,
}: {
  user: EligibleAssigneeUser
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
        selected ? 'bg-primary-subtle' : 'hover:bg-surface-sunken'
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(user.name)}`}
      >
        {getInitials(user.name)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-text-primary truncate">{user.name}</p>
        <p className="text-meta text-text-muted truncate">{user.role_title}</p>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {user.on_leave_today && (
          <Tooltip label={user.leave_until ? `On leave until ${user.leave_until}` : 'On leave'}>
            <span className="flex items-center gap-0.5 text-meta font-medium px-1.5 py-0.5 rounded-full bg-warning-bg text-warning">
              On leave
            </span>
          </Tooltip>
        )}
        {user.is_frequent && (
          <span className="flex items-center gap-0.5 text-meta font-medium px-1.5 py-0.5 rounded-full bg-primary-subtle text-primary-text">
            <Zap size={9} />
            Frequent
          </span>
        )}
        <Tooltip label="Active tasks">
          <span className="flex items-center gap-0.5 text-meta font-medium text-text-muted bg-surface-control px-1.5 py-0.5 rounded-full">
            <Briefcase size={9} />
            {user.active_task_count}
          </span>
        </Tooltip>
        {selected && (
          <span className="w-4 h-4 flex items-center justify-center bg-primary rounded-full shrink-0">
            <Check size={10} className="text-primary-foreground" strokeWidth={3} />
          </span>
        )}
      </div>
    </button>
  )
}

// ─── Assignee chip ────────────────────────────────────────────────────────────

function AssigneeChip({
  assignee,
  onToggleCC,
  onRemove,
  allowCC = true,
}: {
  assignee: SelectedAssignee
  onToggleCC: () => void
  onRemove: () => void
  /** false → a plain person chip: no Assignee/CC badge. */
  allowCC?: boolean
}) {
  return (
    <div
      title={assignee.name}
      className="inline-flex items-center gap-1.5 bg-surface-sunken border border-border-light rounded-lg pl-1.5 pr-1 py-1 max-w-[180px]"
    >
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(assignee.name)}`}
      >
        {getInitials(assignee.name)}
      </div>
      <span className="text-meta font-medium text-text-primary truncate hidden sm:inline">{assignee.name.split(' ')[0]}</span>
      <span className="text-meta font-medium text-text-primary truncate sm:hidden">{assignee.name.split(' ')[0]}</span>
      {allowCC && <Tooltip label={assignee.is_cc ? 'Click to make Assignee' : 'Click to make CC'}>
        <button
          type="button"
          onClick={onToggleCC}
          className={`text-meta font-medium rounded-tick px-1.5 py-0.5 transition-colors shrink-0 ${
            assignee.is_cc
              ? 'bg-warning-bg text-warning border border-warning-border'
              : 'bg-primary-subtle text-primary-text border border-primary-border'
          }`}
        >
          {assignee.is_cc ? 'CC' : 'Assignee'}
        </button>
      </Tooltip>}
      <button
        type="button"
        onClick={onRemove}
        className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-danger transition-colors shrink-0"
        aria-label={`Remove ${assignee.name}`}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  orgId: string
  value: SelectedAssignee[]
  onChange: (assignees: SelectedAssignee[]) => void
  disabled?: boolean
  currentUser?: { user_id: string; name: string }
  /**
   * false → a plain people list (e.g. "Who can start it", workflow owners): no
   * Assignee/CC badge on the chips, and nobody is ever marked CC. Default true.
   */
  allowCC?: boolean
  /** Picker dialog heading. Default "Assignees & CC". */
  title?: string
  /** Trigger button text. Default "Add". */
  addLabel?: string
  /** Muted text shown in the box while nobody is selected. Default: none. */
  placeholder?: string
  /** The "add myself" shortcut's text. Default "Assign to me". */
  selfLabel?: string
  /** Red border, for a required list that failed validation. */
  invalid?: boolean
  /** Fixed chips shown first in the box (e.g. a workflow's creator, who can't be removed). */
  leading?: React.ReactNode
  /** People never offered in the picker (already covered by a fixed chip). */
  hiddenIds?: string[]
}

export default function AssigneeSelector({
  orgId,
  value,
  onChange,
  disabled,
  currentUser,
  allowCC = true,
  title = 'Assignees & CC',
  addLabel = 'Add',
  placeholder,
  selfLabel = 'Assign to me',
  invalid,
  leading,
  hiddenIds,
}: Props) {
  const [open, setOpen] = useState(false)
  const { search, setSearch, sort, setSort, data, loading, departments, visibleTotal } = useEligibleAssignees({
    orgId,
    open,
    currentUserId: currentUser?.user_id,
    hiddenIds,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedIds = new Set(value.map((a) => a.user_id))

  // Escape and backdrop-click are now the kit Dialog's own behaviour.

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [open])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleUser(user: EligibleAssigneeUser) {
    if (selectedIds.has(user.user_id)) {
      onChange(value.filter((a) => a.user_id !== user.user_id))
    } else {
      onChange([...value, { user_id: user.user_id, name: user.name, is_cc: false }])
    }
  }

  function toggleCC(userId: string) {
    onChange(value.map((a) => a.user_id === userId ? { ...a, is_cc: !a.is_cc } : a))
  }

  function removeAssignee(userId: string) {
    onChange(value.filter((a) => a.user_id !== userId))
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips + trigger */}
      <div
        className={`flex flex-wrap gap-1.5 items-center min-h-[42px] p-1.5 border rounded-lg bg-surface transition-colors ${
          invalid ? 'border-danger-border focus-within:border-danger' : 'border-border focus-within:border-primary'
        }`}
      >
        {leading}
        {value.map((a) => (
          <AssigneeChip
            key={a.user_id}
            assignee={a}
            allowCC={allowCC}
            onToggleCC={() => toggleCC(a.user_id)}
            onRemove={() => removeAssignee(a.user_id)}
          />
        ))}
        {value.length === 0 && !leading && placeholder && (
          <span className="px-1.5 text-body text-text-muted">{placeholder}</span>
        )}
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
          <Plus size={12} />
          {addLabel}
        </Button>
      </div>

      {/* Picker — kit Dialog (small), matching its previous centered-overlay shape. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm" className="max-w-[440px] max-h-[80vh] flex flex-col overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <DialogBody className="p-0 flex flex-col flex-1 overflow-hidden">
            {/* Search + sort */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
              {/* Search */}
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, role, or department…"
                  className="w-full pl-8 pr-3 py-[7px] text-body text-text-primary placeholder:text-text-muted border border-border-light rounded-lg focus:border-primary focus:outline-hidden bg-surface"
                />
              </div>

              {/* Sort toggle */}
              <div className="flex items-center border border-border-light rounded-[6px] p-0.5 gap-0.5 shrink-0">
                {(['frequency', 'workload', 'name'] as SortMode[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSort(s)}
                    className={`px-2 py-1 rounded-tick text-meta font-medium transition-colors ${
                      sort === s ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:bg-surface-control'
                    }`}
                  >
                    {s === 'frequency' ? 'Frequent' : s === 'workload' ? 'Workload' : 'A-Z'}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected chips — so the current selection is visible inside the
                dialog (toggle CC / remove right here). */}
            {value.length > 0 && (
              <div className="px-4 py-2.5 border-b border-border-light shrink-0 flex flex-wrap gap-1.5 max-h-[104px] overflow-y-auto">
                {value.map((a) => (
                  <AssigneeChip
                    key={a.user_id}
                    assignee={a}
                    allowCC={allowCC}
                    onToggleCC={() => toggleCC(a.user_id)}
                    onRemove={() => removeAssignee(a.user_id)}
                  />
                ))}
              </div>
            )}

            {/* Panel body */}
            <div className="overflow-y-auto flex-1">
              {/* Assign to me shortcut — scrolls with the list */}
              {currentUser && !selectedIds.has(currentUser.user_id) && !hiddenIds?.includes(currentUser.user_id) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { user_id: currentUser.user_id, name: currentUser.name, is_cc: false }])
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-body font-medium text-primary-text hover:bg-primary-subtle border-b border-border-light transition-colors"
                >
                  <UserPlus size={13} />
                  {selfLabel}
                </button>
              )}

              {loading ? (
                <div className="py-1">
                  {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
                </div>
              ) : !data || visibleTotal === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-surface-control flex items-center justify-center mb-3">
                    <Search size={16} className="text-text-muted" />
                  </div>
                  <p className="text-body font-medium text-text-primary">
                    {search ? 'No users found' : allowCC ? 'No eligible assignees' : 'No one to choose from'}
                  </p>
                  <p className="text-meta text-text-secondary mt-1">
                    {search ? 'Try a different search term.' : 'Check visibility settings in Task Masters.'}
                  </p>
                </div>
              ) : (
                <div>
                  {departments.map((dept) => (
                    <div key={dept.department_id}>
                      {/* Department header (hidden for search flat list) */}
                      {dept.department_id !== 'search' && (
                        <div className="px-3 py-1.5 bg-surface-sunken border-b border-border-light">
                          <span className="text-meta font-medium text-text-muted uppercase tracking-wide">
                            {dept.department_name}
                            <span className="ml-1.5 font-normal normal-case text-text-muted">({dept.users.length})</span>
                          </span>
                        </div>
                      )}
                      {dept.users.map((user) => (
                        <UserRow
                          key={user.user_id}
                          user={user}
                          selected={selectedIds.has(user.user_id)}
                          onToggle={() => toggleUser(user)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogBody>

          {/* Footer: selected count + confirm (tick) */}
          <DialogFooter className="justify-between">
            <p className="text-meta text-text-secondary min-w-0 truncate">
              {!allowCC ? (
                value.length > 0 ? (
                  <><span className="font-medium text-text-primary">{value.length}</span> selected</>
                ) : (
                  <span className="text-text-muted">Select people, then confirm</span>
                )
              ) : value.length > 0 ? (
                <>
                  <span className="font-medium text-text-primary">{value.filter((a) => !a.is_cc).length}</span> assignee{value.filter((a) => !a.is_cc).length !== 1 ? 's' : ''},&nbsp;
                  <span className="font-medium text-text-primary">{value.filter((a) => a.is_cc).length}</span> CC
                  <span className="text-text-muted"> · Click badge to toggle CC</span>
                </>
              ) : (
                <span className="text-text-muted">Select assignees, then confirm</span>
              )}
            </p>
            <Button type="button" onClick={() => setOpen(false)} className="shrink-0">
              <Check size={15} strokeWidth={3} />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
