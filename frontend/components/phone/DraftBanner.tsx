'use client'

import { fmtDateTime, fmtTime } from '@/lib/phone-format'
import React from 'react'
import { CircleAlert, X } from 'lucide-react'
import type { Draft, DraftValues } from '@/lib/drafts'
import { PhoneButton, cx } from './primitives'

/*
 * The draft banner - plan-phone-2026-10-14.md slice 5, kit §41.7 rules 13-14.
 * Ported in spirit from the kit's components/ui/draft-banner.tsx, built from
 * v2e's own phone primitives (v2e has no shadcn Banner/Button components).
 *
 *   - THE OFFER (rule 13): "You have an unsaved draft from 3:45 PM.", with
 *     "Use draft" and "Discard" - never a close button, the person chooses
 *     one.
 *   - NOT USED (rule 14): "Your draft from 3:45 PM was not used, because
 *     <name> changed this record at 4:10 PM." Reports only; closing it
 *     deletes the draft.
 */

function when(date: Date, now: Date): string {
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return fmtTime(date)
  }
  return fmtDateTime(date)
}

export function DraftBanner<T extends DraftValues>({
  draft,
  onUse,
  className,
}: {
  draft: Draft<T>
  onUse: (values: Partial<T>) => void
  className?: string
}) {
  const { offer } = draft
  if (!offer) return null
  const now = new Date()

  if ('conflict' in offer) {
    const { savedAt, changedBy, changedAt } = offer.conflict
    return (
      <div
        role="status"
        className={cx(
          'flex items-start gap-[8px] rounded-[8px] border border-border bg-surface-sunken px-[12px] py-[10px]',
          className,
        )}
      >
        <CircleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-text-secondary" />
        <p className="min-w-0 flex-1 text-label text-text-secondary">
          Your draft from {when(savedAt, now)} was not used, because{' '}
          {changedBy ? `${changedBy} changed` : 'this record was changed'} this record at {when(changedAt, now)}.
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={draft.discard}
          className="-my-[10px] -mr-[12px] flex size-[44px] shrink-0 items-center justify-center text-text-secondary"
        >
          <X aria-hidden className="size-[16px]" />
        </button>
      </div>
    )
  }

  return (
    <div
      role="status"
      className={cx(
        'flex flex-col gap-[8px] rounded-[8px] border border-primary-border bg-primary-subtle px-[12px] py-[10px]',
        className,
      )}
    >
      <div className="flex items-start gap-[8px]">
        <CircleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-primary-text" />
        <p className="min-w-0 flex-1 text-label text-primary-text">
          You have an unsaved draft from {when(offer.savedAt, now)}.
        </p>
      </div>
      <div className="flex gap-[8px] self-end">
        <PhoneButton type="button" variant="secondary" onClick={draft.discard}>
          Discard
        </PhoneButton>
        <PhoneButton type="button" variant="primary" onClick={() => onUse(draft.restore())}>
          Use draft
        </PhoneButton>
      </div>
    </div>
  )
}
