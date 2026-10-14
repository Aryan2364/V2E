'use client'

import React from 'react'
import { Search, Check } from 'lucide-react'
import type { PersonOption } from '@/components/meetings/MeetingAttendeeSelector'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, cx } from './primitives'

/*
 * Searchable multi-select attendee picker - kit §41.7 rule 7, §41.8 rule 8
 * (search fixed at the top, full height). Each picked person gets a
 * "Mark optional" toggle (CreateMeetingDto's optional_user_ids), as the
 * desktop's own MeetingAttendeeSelector offers via its chips.
 */
export function AttendeePickerSheet({
  open,
  onOpenChange,
  people,
  selected,
  optional,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  people: PersonOption[]
  selected: string[]
  optional: string[]
  onApply: (selected: string[], optional: string[]) => void
}) {
  const [query, setQuery] = React.useState('')
  const [draftSelected, setDraftSelected] = React.useState<string[]>(selected)
  const [draftOptional, setDraftOptional] = React.useState<string[]>(optional)

  React.useEffect(() => {
    if (open) {
      setDraftSelected(selected)
      setDraftOptional(optional)
      setQuery('')
    }
  }, [open, selected, optional])

  const filtered = people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))

  function toggle(id: string) {
    setDraftSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }
  function toggleOptional(id: string) {
    setDraftOptional((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Attendees"
      footer={
        <PhoneButton
          type="button"
          variant="primary"
          fullWidth
          onClick={() => {
            onApply(draftSelected, draftOptional.filter((id) => draftSelected.includes(id)))
            onOpenChange(false)
          }}
        >
          {draftSelected.length > 0 ? `Add ${draftSelected.length} attendee${draftSelected.length > 1 ? 's' : ''}` : 'Add attendees'}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[12px]">
        <div className="sticky top-0 flex min-h-[44px] items-center gap-[8px] rounded-[8px] border border-phone-border bg-phone-surface px-[12px]">
          <Search aria-hidden className="size-[16px] shrink-0 text-phone-text-secondary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            className="w-full bg-transparent text-phone-body text-phone-text-primary outline-none placeholder:text-phone-text-muted"
          />
        </div>

        <ul className="-mx-[16px] divide-y divide-phone-border-light">
          {filtered.map((p) => {
            const isSelected = draftSelected.includes(p.user_id)
            const isOptional = draftOptional.includes(p.user_id)
            return (
              <li key={p.user_id} className="flex min-h-[48px] items-center gap-[12px] px-[16px]">
                <button
                  type="button"
                  onClick={() => toggle(p.user_id)}
                  className="flex min-w-0 flex-1 items-center gap-[12px] py-[6px] text-left"
                >
                  <span
                    aria-hidden
                    className={cx(
                      'flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-2',
                      isSelected ? 'border-phone-primary bg-phone-primary' : 'border-phone-border-strong bg-transparent',
                    )}
                  >
                    {isSelected ? <Check aria-hidden className="size-[14px] text-phone-primary-foreground" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-phone-body text-phone-text-primary">{p.name}</span>
                </button>
                {isSelected ? (
                  <button
                    type="button"
                    onClick={() => toggleOptional(p.user_id)}
                    className={cx(
                      'shrink-0 rounded-full border px-[8px] py-[4px] text-phone-meta font-medium',
                      isOptional ? 'border-phone-primary bg-phone-primary-subtle text-phone-primary-text' : 'border-phone-border text-phone-text-secondary',
                    )}
                  >
                    {isOptional ? 'Optional' : 'Required'}
                  </button>
                ) : null}
              </li>
            )
          })}
          {filtered.length === 0 ? (
            <li className="px-[16px] py-[24px] text-center text-phone-body text-phone-text-secondary">No one matches &quot;{query}&quot;</li>
          ) : null}
        </ul>
      </div>
    </PhoneSheet>
  )
}
