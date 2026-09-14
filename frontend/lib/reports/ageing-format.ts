import type { AgeBucketKey, AgeBuckets } from '@/lib/types/reports'

// Shared labels, ordering and meaning-carrying colours for the Pending & Overdue
// Ageing report. Colour tracks severity: Not Yet Due is neutral (not late), then
// the late bands deepen amber → red so the eye lands on the oldest pile first.

export interface BucketMeta {
  key: AgeBucketKey
  label: string       // full column label (client wording)
  short: string       // compact heading
  color: string       // text colour for a non-zero count
  headTint: string    // subtle header background tint
}

export const BUCKETS: BucketMeta[] = [
  { key: 'not_yet_due', label: 'Not Yet Due', short: 'Not Yet Due', color: '#475569', headTint: '#F8FAFC' },
  { key: 'd1_7', label: '1 to 7 Days Late', short: '1–7', color: '#B45309', headTint: '#FFFBEB' },
  { key: 'd8_15', label: '8 to 15 Days Late', short: '8–15', color: '#B45309', headTint: '#FFFBEB' },
  { key: 'd16_30', label: '16 to 30 Days Late', short: '16–30', color: '#C2410C', headTint: '#FFF7ED' },
  { key: 'd31_60', label: '31 to 60 Days Late', short: '31–60', color: '#DC2626', headTint: '#FEF2F2' },
  { key: 'd61_90', label: '61 to 90 Days Late', short: '61–90', color: '#DC2626', headTint: '#FEF2F2' },
  { key: 'd90_plus', label: 'More than 90 Days Late', short: '90+', color: '#B91C1C', headTint: '#FEE2E2' },
]

/**
 * Withdrawn is deliberately NOT in `BUCKETS`: it is not an age band, it never feeds
 * Total Pending, and keeping it out leaves the seven signed-off band columns (and the
 * Excel band headers built from them) exactly as they were. It gets its own neutral
 * slate treatment because it is informational, not a severity — nobody is late here.
 */
export const WITHDRAWN_META: BucketMeta = {
  key: 'withdrawn',
  label: 'Withdrawn (removed before due)',
  short: 'Withdrawn',
  color: '#64748B',
  headTint: '#F1F5F9',
}

/**
 * Handed over is also NOT an age band, for the same reasons and one more: the person
 * on the row cannot act on it at all. It carries the lateness the task HAD when they
 * let it go, frozen — never a number that keeps climbing while someone else holds it.
 */
export const HANDED_OVER_META: BucketMeta = {
  key: 'handed_over',
  label: 'Handed over to someone else',
  short: 'Handed over',
  color: '#475569',
  headTint: '#F1F5F9',
}

/** The three late bands that make up "More than a Month Late". */
export const OVER_MONTH_BUCKETS: AgeBucketKey[] = ['d31_60', 'd61_90', 'd90_plus']

export const BUCKET_LABEL: Record<AgeBucketKey, string> = Object.fromEntries(
  [...BUCKETS, WITHDRAWN_META, HANDED_OVER_META].map((b) => [b.key, b.label]),
) as Record<AgeBucketKey, string>

/** Count colour: muted when zero (so the eye skips empty cells), band colour otherwise. */
export function countColor(key: AgeBucketKey, value: number): string {
  if (value === 0) return '#CBD5E1'
  return [...BUCKETS, WITHDRAWN_META, HANDED_OVER_META].find((b) => b.key === key)?.color ?? '#0F172A'
}

export function bandValue(b: AgeBuckets, key: AgeBucketKey): number {
  return b[key]
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** "10 June 2026" — for the As-on chip. */
export function fmtAsOn(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function daysLateText(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return `${n} ${n === 1 ? 'day' : 'days'}`
}
