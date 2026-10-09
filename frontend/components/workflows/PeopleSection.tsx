'use client'

import React, { useState } from 'react'
import type { PersonRef } from '@/lib/types/workflows'
import type { WorkflowLookups } from './useWorkflowLookups'
import PeoplePicker, { personNames } from './PeoplePicker'

export interface PeopleValue {
  ownerIds: string[]
  editorIds: string[]
}

type Key = keyof PeopleValue

const ROWS: { key: Key; label: string; help: string }[] = [
  {
    key: 'ownerIds',
    label: 'Owners',
    help: 'Can do everything, are told when a step is late or a run needs attention, and decide who else is involved. At least one.',
  },
  {
    key: 'editorIds',
    label: 'Can change it',
    help: 'Change its steps and how it starts, pause or resume it, and manage its runs.',
  },
]

/**
 * Who owns the workflow and who can change it. Who can start it is chosen under
 * "How it starts → Manually". Part of the workflow being edited — saved with it.
 */
export default function PeopleSection({
  orgId,
  currentUser,
  value,
  onChange,
  allowed,
  reason,
  lookups,
  known,
}: {
  orgId: string
  /** Offered as the picker's "Add me" shortcut. */
  currentUser?: { user_id: string; name: string }
  value: PeopleValue
  onChange: (next: PeopleValue) => void
  allowed: boolean | undefined
  reason: string
  lookups: WorkflowLookups
  /** People already on the workflow (named even if they have left). */
  known: PersonRef[]
}) {
  const [ownerError, setOwnerError] = useState<string | null>(null)

  const names = personNames(lookups, known)

  function set(key: Key, list: string[]) {
    if (key === 'ownerIds' && list.length === 0) {
      setOwnerError('A workflow needs at least one owner.')
      return
    }
    setOwnerError(null)
    onChange({ ...value, [key]: list })
  }

  return (
    <section
      aria-labelledby="people-heading"
      className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-5"
    >
      <div className="min-w-0">
        <h2 id="people-heading" className="text-[18px] font-semibold text-[#0F172A]">
          People
        </h2>
        <p className="text-[13px] text-[#475569]">Everyone in your organisation can view this workflow while it is live.</p>
      </div>

      {allowed === false && (
        <p className="text-[13px] text-[#334155] rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">{reason}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {ROWS.map((r) => (
          <div key={r.key} className="min-w-0">
            <span className="block text-sm font-medium text-[#374151] mb-2">
              {r.label}
              {r.key === 'ownerIds' && <span className="text-[#DC2626]"> *</span>}
            </span>
            <PeoplePicker
              orgId={orgId}
              ids={value[r.key]}
              onChange={(list) => set(r.key, list)}
              names={names}
              loading={lookups.status === 'loading'}
              title={r.label}
              disabled={allowed !== true}
              invalid={r.key === 'ownerIds' && !!ownerError}
              placeholder={r.key === 'editorIds' ? 'No one yet' : undefined}
              currentUser={currentUser}
            />
            {r.key === 'ownerIds' && ownerError ? (
              <p className="mt-1.5 text-[13px] text-[#B91C1C]">{ownerError}</p>
            ) : (
              <p className="mt-1.5 text-[13px] text-[#475569]">{r.help}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
