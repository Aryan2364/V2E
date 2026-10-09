// Pure helpers for the instance discussion (InstanceDiscussion.tsx): @mentions, the
// unread divider, merging refreshed pages, the "For a later step" choices.
import type { DiscussionMessage, DiscussionStep, PersonRef } from '@/lib/types/workflows'

/** Longest message, in characters (matches the server). */
export const MESSAGE_MAX = 2000
/** Most people one message may @mention (matches the server). */
export const MENTION_MAX = 20
/** Longest "@who" typed before the list stops looking. */
const QUERY_MAX = 40
/** A step a message can no longer be "for". */
const DONE_STEPS = new Set(['completed', 'skipped'])

/**
 * The "@…" being typed at the caret: `start` = index of the "@", `query` = what follows
 * it. Null when the caret isn't in a mention (the "@" must start the text or follow a
 * space / line break / bracket; the query stops at a line break or two spaces).
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  const before = at === 0 ? '' : upto[at - 1]
  if (before && !/[\s([{"'“]/.test(before)) return null
  const query = upto.slice(at + 1)
  if (query.length > QUERY_MAX || /[\n\r]/.test(query) || /\s{2,}/.test(query) || query.startsWith(' ')) return null
  return { start: at, query }
}

/** People matching a typed query: name starts first, then any word, then anywhere. */
export function filterPeople(people: PersonRef[], query: string, excludeIds: string[] = [], limit = 6): PersonRef[] {
  const q = query.trim().toLowerCase()
  const skip = new Set(excludeIds)
  const scored: { p: PersonRef; score: number }[] = []
  for (const p of people) {
    if (skip.has(p.id)) continue
    const name = (p.name || '').toLowerCase()
    let score = -1
    if (!q) score = 3
    else if (name.startsWith(q)) score = 0
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1
    else if (name.includes(q)) score = 2
    if (score >= 0) scored.push({ p, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((s) => s.p)
}

/** Replace the "@query" at `start…caret` with "@Name " and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const token = `@${name} `
  const next = text.slice(0, start) + token + text.slice(caret).replace(/^ /, '')
  return { text: next, caret: start + token.length }
}

/** Ids of picked people whose "@Name" is still in the text (deleted mentions drop out). */
export function activeMentionIds(text: string, picked: PersonRef[]): string[] {
  const out: string[] = []
  for (const p of picked) {
    if (!p.name || out.includes(p.id)) continue
    if (text.includes(`@${p.name}`)) out.push(p.id)
  }
  return out.slice(0, MENTION_MAX)
}

export type MentionSegment = { text: string; mention?: PersonRef }

/** Split a message into plain text and "@Name" mentions (longest names first). */
export function splitMentions(body: string, mentions: PersonRef[]): MentionSegment[] {
  const names = mentions.filter((m) => m.name).sort((a, b) => b.name.length - a.name.length)
  if (!body || !names.length) return body ? [{ text: body }] : []
  const out: MentionSegment[] = []
  let i = 0
  let plain = ''
  while (i < body.length) {
    const hit = body[i] === '@' ? names.find((m) => body.startsWith(`@${m.name}`, i)) : undefined
    if (hit) {
      if (plain) out.push({ text: plain })
      plain = ''
      out.push({ text: `@${hit.name}`, mention: hit })
      i += hit.name.length + 1
    } else {
      plain += body[i]
      i++
    }
  }
  if (plain) out.push({ text: plain })
  return out
}

/** A message (or one of its replies) by someone else after the read marker. */
function isUnread(m: DiscussionMessage, lastReadAt: string | null, myId: string | undefined): boolean {
  if (m.deleted || !m.author || m.author.id === myId) return false
  return !lastReadAt || new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
}

/** The top-level message the "New" divider goes above (first one that is, or holds, an unread message). */
export function firstUnreadId(messages: DiscussionMessage[], lastReadAt: string | null, myId: string | undefined): string | null {
  for (const m of messages) {
    if (isUnread(m, lastReadAt, myId) || m.replies.some((r) => isUnread(r, lastReadAt, myId))) return m.id
  }
  return null
}

/** Merge a fresh page into what is shown: same ids are updated in place, order by time. */
export function mergeMessages(shown: DiscussionMessage[], fresh: DiscussionMessage[]): DiscussionMessage[] {
  const byId = new Map(shown.map((m) => [m.id, m]))
  for (const m of fresh) byId.set(m.id, m)
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id),
  )
}

/** Drop a removed message: kept as a placeholder when it still has replies; a reply goes. */
export function removeMessage(shown: DiscussionMessage[], id: string): DiscussionMessage[] {
  const out: DiscussionMessage[] = []
  for (const m of shown) {
    if (m.id === id) {
      if (m.replies.length) out.push({ ...m, deleted: true, body: '', author: null, attachments: [], mentions: [], can_delete: false })
      continue
    }
    out.push(m.replies.some((r) => r.id === id) ? { ...m, replies: m.replies.filter((r) => r.id !== id) } : m)
  }
  return out
}

/** Add a just-posted message (top-level, or a reply under its top message). */
export function addMessage(shown: DiscussionMessage[], m: DiscussionMessage): DiscussionMessage[] {
  if (m.reply_to_id) {
    return shown.map((top) =>
      top.id === m.reply_to_id ? { ...top, replies: [...top.replies.filter((r) => r.id !== m.id), m] } : top,
    )
  }
  return mergeMessages(shown, [m])
}

/** Steps a message can be "for": not done or skipped, and not the step it is written on. */
export function taggableSteps(steps: DiscussionStep[], currentTaskId?: string | null): DiscussionStep[] {
  return steps.filter((s) => !DONE_STEPS.has(String(s.status)) && !(currentTaskId && s.task_id === currentTaskId))
}

/** Live messages shown (top-level + replies). */
export function countShown(messages: DiscussionMessage[]): number {
  return messages.reduce((n, m) => n + (m.deleted ? 0 : 1) + m.replies.filter((r) => !r.deleted).length, 0)
}

/** "12 KB", "1.4 MB". */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "11:11 PM" today, "8 Oct, 11:11 PM" this year, "8 Oct 2025, 11:11 PM" before. */
export function messageTime(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = d.getHours()
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return time
  const day = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`
  return `${day}, ${time}`
}
