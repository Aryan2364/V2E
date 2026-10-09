// Pure wording for an open send-back (no React, unit-tested). The reason itself is plain
// text the person typed: callers render it as a text node (never as HTML).

import type { StepSendBack } from '@/lib/types/workflows'
import { badgeDate } from './instanceLabel'

/** A reason longer than this is shortened (with "View reason") where space is tight. */
export const REASON_SHORT_LIMIT = 120

/** The reason, trimmed; null when there is none. */
export function sendBackReason(sb: StepSendBack | null | undefined): string | null {
  const r = sb?.reason?.trim()
  return r ? r : null
}

/** Whether a reason needs a "View reason" toggle to be read in full. */
export function isLongReason(reason: string | null | undefined): boolean {
  return !!reason && (reason.length > REASON_SHORT_LIMIT || reason.includes('\n'))
}

/** The first `limit` characters of a reason, cut at a word, with "…" when shortened. */
export function shortReason(reason: string, limit = REASON_SHORT_LIMIT): string {
  const flat = reason.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * The lead-in before the quoted reason (the step's own panel, flow box, task banner):
 *  - sender: "Sent back to 1 “Collect documents” by Priya · 17 Oct"
 *  - target: "Asked for more info by 3 “Review” (Priya)"
 *  - target on its task page (`banner`): "Sent back from 3 “Review” by Priya"
 */
export function sendBackLead(sb: StepSendBack, now: Date, opts: { banner?: boolean } = {}): string {
  const who = sb.by?.name ?? null
  if (sb.role === 'sender') {
    const date = sb.at ? badgeDate(sb.at, now) : ''
    return `Sent back to ${sb.to_label}${who ? ` by ${who}` : ''}${date ? ` · ${date}` : ''}`
  }
  if (opts.banner) return `Sent back from ${sb.from_label}${who ? ` by ${who}` : ''}`
  return `Asked for more info by ${sb.from_label}${who ? ` (${who})` : ''}`
}

/** The line that follows a sender's reason. */
export const SENDER_RESUMES = 'Resumes when that step is done.'
/** The line that follows a target's reason. */
export const TARGET_RETURNS = 'When this step is done, the instance goes back there.'
