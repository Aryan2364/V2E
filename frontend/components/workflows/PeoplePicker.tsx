'use client'

import React, { useRef } from 'react'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import type { SelectedAssignee } from '@/lib/types/tasks'
import type { PersonRef } from '@/lib/types/workflows'
import type { WorkflowLookups } from './useWorkflowLookups'

/**
 * Names for the people a workflow list may hold: current org members, then anyone
 * already saved on the workflow who has since left (marked so).
 */
export function personNames(lookups: WorkflowLookups, known: PersonRef[]): Map<string, string> {
  const names = new Map<string, string>(lookups.members.map((m) => [m.user_id, m.name]))
  known.forEach((p) => {
    if (!names.has(p.id)) names.set(p.id, `${p.name} (no longer active)`)
  })
  return names
}

/**
 * A workflow people list (who can start it, editors, viewers) in the same picker the
 * task form uses for Assignees & CC — without the CC role. The workflow keeps plain
 * id lists; chips are named from `names`, so saved people show even when they are no
 * longer offered by the picker, and can still be removed.
 */
export default function PeoplePicker({
  orgId,
  ids,
  onChange,
  names,
  loading,
  title,
  disabled,
  invalid,
  placeholder,
  currentUser,
  leading,
  hiddenIds,
}: {
  orgId: string
  ids: string[]
  onChange: (ids: string[]) => void
  names: Map<string, string>
  /** The people lookup is still loading (an unnamed id is not "unknown" yet). */
  loading: boolean
  title: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  currentUser?: { user_id: string; name: string }
  /** Fixed chips shown first (e.g. the creator, who is always an editor). */
  leading?: React.ReactNode
  /** People not offered (already covered by a fixed chip); dropped if picked anyway. */
  hiddenIds?: string[]
}) {
  // Names of people picked in this session, for anyone the members list lacks.
  const picked = useRef(new Map<string, string>())

  const value: SelectedAssignee[] = ids.map((id) => ({
    user_id: id,
    name:
      names.get(id) ??
      picked.current.get(id) ??
      (currentUser?.user_id === id ? currentUser.name : loading ? 'Loading…' : 'Unknown person'),
    is_cc: false,
  }))

  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0 m-0">
      <AssigneeSelector
        orgId={orgId}
        value={value}
        onChange={(next) => {
          next.forEach((a) => picked.current.set(a.user_id, a.name))
          onChange(next.map((a) => a.user_id).filter((id) => !hiddenIds?.includes(id)))
        }}
        disabled={disabled}
        currentUser={currentUser}
        allowCC={false}
        title={title}
        selfLabel="Add me"
        placeholder={placeholder}
        invalid={invalid}
        leading={leading}
        hiddenIds={hiddenIds}
      />
    </fieldset>
  )
}
