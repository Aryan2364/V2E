'use client'

import React from 'react'
import { Info } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import type { PersonRef } from '@/lib/types/workflows'
import type { WorkflowLookups } from './useWorkflowLookups'
import PeoplePicker, { personNames } from './PeoplePicker'
import { InfoTip, initials } from './shared'

export interface PeopleValue {
  /** Editors besides the creator (who always is one). */
  editorIds: string[]
  viewerIds: string[]
}

type Key = keyof PeopleValue

const ROWS: { key: Key; label: string; tip: string; empty: string }[] = [
  {
    key: 'editorIds',
    label: 'Editors',
    tip: 'Can edit the workflow, pause it and manage its instances. Alerted when something is late or stuck.',
    empty: 'No one yet',
  },
  {
    key: 'viewerIds',
    label: 'Viewers',
    tip: 'Can see the workflow and all its instances. Can’t change anything.',
    empty: 'No one yet',
  },
]

export const CREATOR_TIP = 'Created this workflow — always an editor'

/** The creator's chip: always an editor, so it has no remove button. */
export function CreatorChip({ person }: { person: PersonRef }) {
  return (
    <Tooltip label={CREATOR_TIP} openOnTap>
      <span
        tabIndex={0}
        aria-label={`${person.name}, creator. ${CREATOR_TIP}.`}
        className="inline-flex items-center gap-1.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] pl-1.5 pr-2 py-1 max-w-[220px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      >
        <span aria-hidden className="w-5 h-5 rounded-full bg-[#2563EB] flex items-center justify-center text-white text-[9px] font-bold shrink-0">
          {initials(person.name)}
        </span>
        <span className="text-xs font-medium text-[#0F172A] truncate">{person.name}</span>
        <span className="text-[10px] font-semibold text-[#1D4ED8] shrink-0">Creator</span>
        <Info size={12} aria-hidden className="text-[#1D4ED8] shrink-0" />
      </span>
    </Tooltip>
  )
}

/**
 * Who can change the workflow (Editors — the creator always, plus anyone added) and who
 * can only look (Viewers). Who can run it is chosen under "How it starts → Manually".
 * Part of the workflow being edited — saved with it.
 */
export default function PeopleSection({
  orgId,
  currentUser,
  creator,
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
  /** The permanent editor (null while not known). */
  creator: PersonRef | null
  value: PeopleValue
  onChange: (next: PeopleValue) => void
  allowed: boolean | undefined
  reason: string
  lookups: WorkflowLookups
  /** People already on the workflow (named even if they have left). */
  known: PersonRef[]
}) {
  const names = personNames(lookups, known)
  const creatorIds = creator ? [creator.id] : []

  function set(key: Key, list: string[]) {
    // Someone is an editor or a viewer, not both: adding to one list takes them off the other.
    const other: Key = key === 'editorIds' ? 'viewerIds' : 'editorIds'
    onChange({ ...value, [key]: list, [other]: value[other].filter((id) => !list.includes(id)) } as PeopleValue)
  }

  return (
    <section
      aria-labelledby="people-heading"
      className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-5"
    >
      <div className="min-w-0">
        <h2 id="people-heading" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
          People <InfoTip label="People" text="Only editors, viewers and admins can see this workflow. People in an instance see that instance." />
        </h2>
      </div>

      {allowed === false && (
        <p className="text-[13px] text-[#334155] rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">{reason}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {ROWS.map((r) => {
          const isEditors = r.key === 'editorIds'
          return (
            <div key={r.key} className="min-w-0">
              <span className="block text-sm font-medium text-[#374151] mb-2">
                {r.label} <InfoTip label={r.label} text={r.tip} />
              </span>
              <PeoplePicker
                orgId={orgId}
                ids={value[r.key].filter((id) => !creatorIds.includes(id))}
                onChange={(list) => set(r.key, list)}
                names={names}
                loading={lookups.status === 'loading'}
                title={r.label}
                disabled={allowed !== true}
                placeholder={r.empty}
                currentUser={currentUser}
                leading={isEditors && creator ? <CreatorChip person={creator} /> : undefined}
                hiddenIds={creatorIds}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
