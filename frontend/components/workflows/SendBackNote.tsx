'use client'

import React, { useId, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { getNow } from '@/lib/clock'
import type { StepSendBack } from '@/lib/types/workflows'
import { SENDER_RESUMES, TARGET_RETURNS, isLongReason, sendBackLead, sendBackReason, shortReason } from './sendBack'

/**
 * A send-back reason as a quote. Plain text (a text node — never HTML), wrapping long
 * words and keeping the person's line breaks. With `collapsible`, a long reason starts
 * shortened with a "View reason" toggle.
 */
export function ReasonQuote({ reason, collapsible = false, className = '' }: { reason: string; collapsible?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const long = collapsible && isLongReason(reason)
  return (
    <div className={`flex flex-col items-start gap-1 min-w-0 ${className}`}>
      <blockquote
        id={id}
        className="w-full min-w-0 border-l-[3px] border-border-light bg-surface/70 rounded-r-[6px] pl-3 pr-2 py-1.5 text-body leading-relaxed text-text-secondary whitespace-pre-wrap wrap-break-word wrap-anywhere"
      >
        “{long && !open ? shortReason(reason) : reason}”
      </blockquote>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          className="text-label font-medium text-text-secondary hover:underline rounded-xs min-h-[32px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          {open ? 'Show less' : 'View reason'}
        </button>
      )}
    </div>
  )
}

/**
 * An open send-back on a step:
 *  - `panel` (the step's panel on the instance page): the lead-in, the reason, and what
 *    happens next;
 *  - `banner` (the reopened task's own page): "Sent back from 3 “Review” by Priya";
 *  - `compact` (flow box, "In progress" list): two short lines, the reason shortened.
 */
export default function SendBackNote({ sendBack, variant }: { sendBack: StepSendBack; variant: 'panel' | 'banner' | 'compact' }) {
  const now = getNow()
  const reason = sendBackReason(sendBack)
  const lead = sendBackLead(sendBack, now, { banner: variant === 'banner' })
  const next = sendBack.role === 'sender' ? SENDER_RESUMES : TARGET_RETURNS

  if (variant === 'compact') {
    return (
      <span className="flex flex-col gap-0.5 min-w-0 text-meta text-text-secondary">
        <span className="font-medium line-clamp-2 wrap-break-word">{lead}</span>
        {reason && <span className="italic line-clamp-2 wrap-break-word wrap-anywhere">“{shortReason(reason, 90)}”</span>}
      </span>
    )
  }

  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-border-light bg-surface-control px-3.5 py-2.5 text-body text-text-secondary">
      <Undo2 size={16} className="shrink-0 mt-0.5" aria-hidden />
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <p className="font-medium wrap-break-word">
          {lead}
          {reason ? ':' : '.'}
        </p>
        {reason ? <ReasonQuote reason={reason} collapsible={variant === 'banner'} /> : <p className="text-text-secondary">No reason was given.</p>}
        <p>{next}</p>
      </div>
    </div>
  )
}
