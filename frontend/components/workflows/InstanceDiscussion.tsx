'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AtSign, CornerUpLeft, Download, FileText, Flag, Loader2, MessageSquare, Paperclip, RefreshCw, Send, ShieldCheck, Trash2, Undo2, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getNow } from '@/lib/clock'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/Tooltip'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { DiscussionFile, DiscussionMessage, DiscussionStep, PersonRef } from '@/lib/types/workflows'
import { Avatar, BTN, ErrorBanner, InfoTip, Skeleton } from './shared'
import {
  MESSAGE_MAX,
  activeMentionIds,
  addMessage,
  fileSize,
  filterPeople,
  firstUnreadId,
  insertMention,
  mentionQuery,
  mergeMessages,
  messageTime,
  removeMessage,
  splitMentions,
  taggableSteps,
} from './discussion'

/** Top-level messages per page. */
const PAGE = 20
/** Quiet refresh while the page is visible. */
const REFRESH_MS = 30000
/** Longer messages start collapsed. */
const LONG = 400

type Load = 'loading' | 'ready' | 'failed'

/** Lets the task page's proof card know a shared file was promoted. */
export interface DiscussionProof {
  /** The viewer may promote their own files on this task's messages to proof. */
  canSubmit: boolean
  allowedExtensions: string[]
  onMark: (attachmentId: string) => Promise<void>
}

/**
 * The ONE discussion of a workflow instance — on the instance page and, as "Comments",
 * on every step task's page. Messages from every step and from the instance page, by
 * person and time (no step numbers). A send-back's reason is highlighted with the step
 * it went back to; a message for a later step shows "For “…”". Anyone who can see the
 * instance can write; type "@" to mention someone who can see it.
 */
export default function InstanceDiscussion({
  orgId,
  templateId,
  instanceId,
  taskId = null,
  title = 'Discussion',
  canWrite,
  writeReason,
  proof,
  onChanged,
  sectionId = 'instance-discussion',
  compact = false,
}: {
  orgId: string
  templateId: string
  instanceId: string
  /** On a step task page: messages written here belong to this task. */
  taskId?: string | null
  title?: string
  /** Tri-state: undefined = not known yet (disabled, no reason shown). */
  canWrite: boolean | undefined
  writeReason: string
  proof?: DiscussionProof
  /** After a message is posted or removed (counts / history / documents may change). */
  onChanged?: () => void
  sectionId?: string
  /** A card among the task page's cards (smaller heading). */
  compact?: boolean
}) {
  const { user } = useAuth()
  const myId = user?.id
  const { addToast } = useToast()

  // ── Thread ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<Load>('loading')
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [steps, setSteps] = useState<DiscussionStep[]>([])
  /** Where the "New" divider sits — fixed for this visit so it doesn't jump as you read. */
  const [dividerId, setDividerId] = useState<string | null>(null)
  const [people, setPeople] = useState<PersonRef[]>([])

  const sectionRef = useRef<HTMLElement>(null)
  const markingRef = useRef(false)

  const load = useCallback(
    async (quiet = false) => {
      if (!orgId || !templateId || !instanceId) return
      if (!quiet) setStatus((s) => (s === 'ready' ? 'ready' : 'loading'))
      try {
        const page = await workflowsApi.getDiscussion(orgId, templateId, instanceId, { limit: PAGE })
        setMessages((shown) => (quiet ? mergeMessages(shown, page.messages) : page.messages))
        if (!quiet) {
          setHasMore(page.has_more)
          setNextBefore(page.next_before)
          setDividerId(firstUnreadId(page.messages, page.last_read_at, myId))
        }
        setTotal(page.total_count)
        setUnread(page.unread_count)
        setSteps(page.steps)
        setStatus('ready')
      } catch (e) {
        if (!quiet) {
          setLoadError(workflowErrorMessage(e, 'The discussion could not be loaded.'))
          setStatus('failed')
        }
      }
    },
    [orgId, templateId, instanceId, myId],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!orgId || !templateId || !instanceId) return
    workflowsApi
      .getDiscussionPeople(orgId, templateId, instanceId)
      .then(setPeople)
      .catch(() => setPeople([]))
  }, [orgId, templateId, instanceId])

  // New messages arrive while the page is open: refresh quietly while it is visible.
  useEffect(() => {
    if (status !== 'ready') return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [status, load])

  // Read = the discussion has been on screen. The divider stays where it was.
  const markRead = useCallback(async () => {
    if (markingRef.current) return
    markingRef.current = true
    try {
      await workflowsApi.markDiscussionRead(orgId, templateId, instanceId)
      setUnread(0)
    } catch {
      // Unread stays as it was (e.g. preview mode); nothing to tell the person.
    } finally {
      markingRef.current = false
    }
  }, [orgId, templateId, instanceId])

  useEffect(() => {
    const el = sectionRef.current
    if (!el || status !== 'ready' || unread === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      markRead()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) markRead()
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [status, unread, markRead])

  // "Show earlier messages" keeps what you were looking at in place.
  const anchorRef = useRef<{ id: string; top: number } | null>(null)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  async function loadEarlier() {
    if (!nextBefore || loadingEarlier) return
    setLoadingEarlier(true)
    const first = messages[0]
    const node = first ? itemRefs.current.get(first.id) : undefined
    anchorRef.current = first && node ? { id: first.id, top: node.getBoundingClientRect().top } : null
    try {
      const page = await workflowsApi.getDiscussion(orgId, templateId, instanceId, { before: nextBefore, limit: PAGE })
      setMessages((shown) => mergeMessages(page.messages, shown))
      setHasMore(page.has_more)
      setNextBefore(page.next_before)
    } catch (e) {
      addToast(workflowErrorMessage(e, 'Earlier messages could not be loaded.'), 'error')
    } finally {
      setLoadingEarlier(false)
    }
  }
  useLayoutEffect(() => {
    const a = anchorRef.current
    if (!a) return
    anchorRef.current = null
    const node = itemRefs.current.get(a.id)
    const scroller = node ? scrollParent(node) : null
    if (node && scroller) scroller.scrollTop += node.getBoundingClientRect().top - a.top
  }, [messages])

  // ── Composer ────────────────────────────────────────────────────────────────
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [forRow, setForRow] = useState('')
  const [showFor, setShowFor] = useState(false)
  const [replyTo, setReplyTo] = useState<DiscussionMessage | null>(null)
  const [picked, setPicked] = useState<PersonRef[]>([])
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The folded "For a later step" row stays in the DOM (it animates) but can't be reached.
  const forPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = forPanelRef.current as (HTMLDivElement & { inert?: boolean }) | null
    if (el) el.inert = !(showFor && !replyTo)
  }, [showFor, replyTo])

  const tagChoices = useMemo(() => taggableSteps(steps, taskId), [steps, taskId])
  // A step that finished since it was picked is no longer offered.
  useEffect(() => {
    if (forRow && !tagChoices.some((s) => s.row_id === forRow)) setForRow('')
  }, [forRow, tagChoices])

  const suggestions = useMemo(
    () => (mention ? filterPeople(people, mention.query, myId ? [myId] : []) : []),
    [mention, people, myId],
  )

  // Auto-grow the write box (one line when empty, up to ~6 lines).
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value.slice(0, MESSAGE_MAX)
    setText(value)
    setPostError(null)
    setMention(mentionQuery(value, e.target.selectionStart ?? value.length))
    setMentionIndex(0)
  }

  function pickPerson(p: PersonRef) {
    const el = textRef.current
    if (!mention || !el) return
    const caret = el.selectionStart ?? text.length
    const next = insertMention(text, mention.start, caret, p.name)
    setText(next.text.slice(0, MESSAGE_MAX))
    setPicked((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]))
    setMention(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickPerson(suggestions[Math.min(mentionIndex, suggestions.length - 1)])
        return
      }
    }
    if (e.key === 'Escape' && mention) {
      e.preventDefault()
      setMention(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  function startMention() {
    const el = textRef.current
    if (!el || canWrite !== true) return
    const caret = el.selectionStart ?? text.length
    const needsSpace = caret > 0 && !/\s/.test(text[caret - 1])
    const insert = `${needsSpace ? ' ' : ''}@`
    const next = (text.slice(0, caret) + insert + text.slice(caret)).slice(0, MESSAGE_MAX)
    setText(next)
    const pos = caret + insert.length
    setMention({ start: pos - 1, query: '' })
    setMentionIndex(0)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const body = text.trim()
  const canSend = canWrite === true && !posting && (!!body || files.length > 0)

  async function send() {
    if (!canSend) return
    setPosting(true)
    setPostError(null)
    const sentText = body
    let created: DiscussionMessage | null = null
    try {
      created = await workflowsApi.postDiscussion(orgId, templateId, instanceId, {
        body: sentText,
        reply_to_id: replyTo?.id ?? null,
        for_row_id: forRow || null,
        mention_user_ids: activeMentionIds(text, picked),
        task_id: taskId,
        with_files: files.length > 0,
      })
      const uploaded: DiscussionFile[] = []
      let failed = false
      for (const f of files) {
        try {
          uploaded.push(await workflowsApi.uploadDiscussionFile(orgId, templateId, instanceId, created.id, f))
        } catch (e) {
          failed = true
          setPostError(workflowErrorMessage(e, 'A file did not upload.'))
          break
        }
      }
      if (failed && !sentText && uploaded.length === 0) {
        // Nothing worth keeping — take back the empty message.
        await workflowsApi.deleteDiscussionMessage(orgId, templateId, instanceId, created.id).catch(() => undefined)
        setPostError('The file didn’t upload, so nothing was posted. Try again.')
        return
      }
      const shown: DiscussionMessage = { ...created, attachments: [...(created.attachments ?? []), ...uploaded] }
      setMessages((list) => addMessage(list, shown))
      setTotal((n) => n + 1)
      setText('')
      setPicked([])
      setReplyTo(null)
      setForRow('')
      setShowFor(false)
      if (failed) {
        setFiles((list) => list.slice(uploaded.length))
        setPostError('Your message was posted, but a file didn’t upload. Attach it again.')
      } else {
        setFiles([])
      }
      onChanged?.()
    } catch (e) {
      setPostError(workflowErrorMessage(e, 'Your message was not posted. Try again.'))
    } finally {
      setPosting(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<DiscussionMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await workflowsApi.deleteDiscussionMessage(orgId, templateId, instanceId, deleteTarget.id)
      setMessages((list) => removeMessage(list, deleteTarget.id))
      setTotal((n) => Math.max(0, n - 1))
      if (replyTo?.id === deleteTarget.id) setReplyTo(null)
      setDeleteTarget(null)
      addToast('Message deleted', 'success')
      onChanged?.()
    } catch (e) {
      setDeleteError(workflowErrorMessage(e, 'The message could not be deleted. Try again.'))
    } finally {
      setDeleting(false)
    }
  }

  // ── Files ───────────────────────────────────────────────────────────────────
  const [markingId, setMarkingId] = useState<string | null>(null)
  async function download(f: DiscussionFile) {
    try {
      await workflowsApi.downloadDiscussionFile(orgId, templateId, instanceId, f.id)
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be opened.'), 'error')
    }
  }
  async function markProof(f: DiscussionFile) {
    if (!proof) return
    setMarkingId(f.id)
    try {
      await proof.onMark(f.id)
      await load(true)
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be marked as proof.'), 'error')
    } finally {
      setMarkingId(null)
    }
  }

  function reply(m: DiscussionMessage) {
    setReplyTo(m)
    setForRow('')
    setShowFor(false)
    requestAnimationFrame(() => textRef.current?.focus())
  }

  const now = getNow()
  const headingId = `${sectionId}-title`
  const forStep = tagChoices.find((s) => s.row_id === forRow)

  return (
    <section
      ref={sectionRef}
      id={sectionId}
      aria-labelledby={headingId}
      className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-6 flex flex-col gap-4 min-w-0 scroll-mt-24"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <MessageSquare size={16} className="text-[#475569]" aria-hidden />
        <h2 id={headingId} className={`flex items-center gap-1.5 ${compact ? 'text-[15px]' : 'text-[18px]'} font-semibold text-[#0F172A]`}>
          {title}
          {total > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </h2>
        <InfoTip
          label={title}
          text="One discussion for the whole instance, on every step’s task. Everyone who can see the instance can read and write. Type @ to mention someone."
        />
        {unread > 0 && (
          <span className="ml-auto inline-flex items-center rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] px-2.5 py-0.5 text-[12px] font-medium">
            {unread} new
          </span>
        )}
      </div>

      {/* Messages */}
      {status === 'loading' ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : status === 'failed' ? (
        <div className="flex flex-col items-start gap-2 text-sm text-[#B91C1C]">
          <span>{loadError}</span>
          <button type="button" onClick={() => load()} className={BTN.quiet}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-[#475569]">No messages yet. Start the discussion.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {hasMore && (
            <button type="button" onClick={loadEarlier} disabled={loadingEarlier} className={`${BTN.quiet} self-center`}>
              {loadingEarlier ? <Loader2 size={14} className="animate-spin" /> : null}
              {loadingEarlier ? 'Loading…' : 'Show earlier messages'}
            </button>
          )}
          <ul className="flex flex-col gap-4">
            {messages.map((m) => (
              <li
                key={m.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(m.id, el)
                  else itemRefs.current.delete(m.id)
                }}
                className="flex flex-col gap-3"
              >
                {m.id === dividerId && <NewDivider />}
                <MessageItem
                  m={m}
                  now={now}
                  myId={myId}
                  taskId={taskId}
                  proof={proof}
                  markingId={markingId}
                  canReply={canWrite === true}
                  onReply={reply}
                  onDelete={(x) => {
                    setDeleteError(null)
                    setDeleteTarget(x)
                  }}
                  onDownload={download}
                  onMarkProof={markProof}
                />
                {m.replies.length > 0 && (
                  <ul className="flex flex-col gap-3 pl-6 sm:pl-10 border-l-2 border-[#F1F5F9] ml-4">
                    {m.replies.map((r) => (
                      <li key={r.id}>
                        <MessageItem
                          m={r}
                          now={now}
                          myId={myId}
                          taskId={taskId}
                          proof={proof}
                          markingId={markingId}
                          canReply={canWrite === true}
                          onReply={reply}
                          onDelete={(x) => {
                            setDeleteError(null)
                            setDeleteTarget(x)
                          }}
                          onDownload={download}
                          onMarkProof={markProof}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Composer */}
      <div className="flex flex-col gap-2 border-t border-[#F1F5F9] pt-4">
        {(replyTo || forStep) && (
          <div className="flex flex-wrap gap-1.5">
            {replyTo && (
              <Chip
                icon={CornerUpLeft}
                label={`Replying to ${replyTo.author?.name ?? 'a message'}${replyTo.body ? `: ${short(replyTo.body, 60)}` : ''}`}
                onClear={() => setReplyTo(null)}
                clearLabel="Cancel reply"
              />
            )}
            {forStep && (
              <Chip icon={Flag} tone="amber" label={`For “${forStep.title}”`} onClear={() => setForRow('')} clearLabel="Remove the step" />
            )}
          </div>
        )}

        <div className="relative rounded-[12px] border border-[#CBD5E1] bg-white focus-within:border-[#2563EB] focus-within:ring-1 focus-within:ring-[#2563EB] transition-colors">
          {/* @mention suggestions: people who can see this instance */}
          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="People who can see this instance"
              className="absolute bottom-full left-0 mb-1.5 z-30 w-full sm:w-80 max-h-64 overflow-y-auto rounded-[10px] border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] py-1"
            >
              {suggestions.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === mentionIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickPerson(p)}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={`w-full flex items-center gap-2.5 px-3 min-h-[44px] sm:min-h-[38px] text-left text-sm text-[#0F172A] transition-colors ${
                      i === mentionIndex ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <Avatar name={p.name} size="sm" />
                    <span className="truncate">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mention && suggestions.length === 0 && mention.query.length > 0 && (
            <p className="absolute bottom-full left-0 mb-1.5 z-30 rounded-[10px] border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] px-3 py-2 text-[13px] text-[#475569]">
              No one who can see this instance matches “{mention.query}”.
            </p>
          )}

          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 max-w-[240px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] text-xs font-medium pl-2 pr-1 py-1 rounded-[6px]"
                >
                  <FileText size={12} className="shrink-0" aria-hidden />
                  <span className="truncate">{f.name}</span>
                  <span className="text-[#475569] shrink-0">{fileSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((list) => list.filter((_, idx) => idx !== i))}
                    disabled={posting}
                    aria-label={`Remove ${f.name}`}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-[#BFDBFE] disabled:opacity-50 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <label htmlFor={`${sectionId}-input`} className="sr-only">
            Write a message
          </label>
          <textarea
            id={`${sectionId}-input`}
            ref={textRef}
            value={text}
            rows={1}
            maxLength={MESSAGE_MAX}
            disabled={canWrite !== true || posting}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onClick={(e) => setMention(mentionQuery(text, e.currentTarget.selectionStart ?? text.length))}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            aria-autocomplete="list"
            aria-expanded={!!mention && suggestions.length > 0}
            placeholder={replyTo ? 'Write a reply' : 'Write a message — @ to mention someone'}
            className="block w-full border-0 bg-transparent px-3 pt-2.5 pb-1 text-base sm:text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none resize-none max-h-40 overflow-y-auto disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? [])
                if (list.length) setFiles((prev) => [...prev, ...list])
                e.target.value = ''
              }}
            />
            <Tooltip label="Mention someone">
              <button type="button" onClick={startMention} disabled={canWrite !== true || posting} aria-label="Mention someone" className={BTN.icon}>
                <AtSign size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Attach files">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={canWrite !== true || posting}
                aria-label="Attach files"
                className={BTN.icon}
              >
                <Paperclip size={16} className="-rotate-45" />
              </button>
            </Tooltip>
            {tagChoices.length > 0 && !replyTo && (
              <Tooltip label="Show this message at the top of a later step’s task when it starts">
                <button
                  type="button"
                  onClick={() => setShowFor((v) => !v)}
                  disabled={canWrite !== true || posting}
                  aria-expanded={showFor}
                  aria-label="For a later step"
                  className={`${BTN.icon} ${showFor || forRow ? '!text-[#92400E] !bg-[#FFFBEB]' : ''}`}
                >
                  <Flag size={16} />
                </button>
              </Tooltip>
            )}
            <span className="ml-auto flex items-center gap-2">
              {text.length > MESSAGE_MAX - 200 && (
                <span className={`text-[12px] tabular-nums ${text.length >= MESSAGE_MAX ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>
                  {text.length}/{MESSAGE_MAX}
                </span>
              )}
              <PermissionTooltip allowed={canWrite} reason={writeReason}>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  aria-label="Send"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1"
                >
                  {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  <span className="hidden sm:inline">{posting ? 'Sending…' : 'Send'}</span>
                </button>
              </PermissionTooltip>
            </span>
          </div>
        </div>

        <div className={`grid transition-all duration-200 ease-in-out ${showFor && !replyTo ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div ref={forPanelRef} className={showFor && !replyTo ? 'overflow-visible' : 'overflow-hidden'}>
            <span id={`${sectionId}-for`} className="flex items-center gap-1 text-sm font-medium text-[#374151] mb-1.5">
              For a later step (optional)
              <InfoTip label="For a later step" text="Shown at the top of that step’s task when it starts. Its assignees are told." />
            </span>
            <div aria-labelledby={`${sectionId}-for`} className="sm:max-w-sm">
              <StyledSelect
                value={forRow}
                onChange={setForRow}
                options={[{ value: '', label: 'No — for everyone now' }, ...tagChoices.map((s) => ({ value: s.row_id, label: s.title || 'Untitled step' }))]}
                disabled={canWrite !== true || posting}
                searchPlaceholder="Search steps…"
              />
            </div>
          </div>
        </div>

        {postError && <ErrorBanner message={postError} onClose={() => setPostError(null)} />}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this message?"
        message="It is removed for everyone, with its files."
        confirmLabel="Delete message"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </section>
  )
}

function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** The nearest scrolling ancestor (the page's own scroll area), for keeping place on "Show earlier". */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
    p = p.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

function NewDivider() {
  return (
    <div className="flex items-center gap-2" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-[#FCA5A5]" />
      <span className="text-[12px] font-semibold text-[#B91C1C] uppercase tracking-wide">New</span>
      <span className="h-px flex-1 bg-[#FCA5A5]" />
    </div>
  )
}

function Chip({
  icon: Icon,
  label,
  onClear,
  clearLabel,
  tone = 'blue',
}: {
  icon: LucideIcon
  label: string
  onClear: () => void
  clearLabel: string
  tone?: 'blue' | 'amber'
}) {
  const cls = tone === 'amber' ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]' : 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]'
  return (
    <span className={`inline-flex items-center gap-1.5 max-w-full border rounded-[8px] pl-2.5 pr-1 py-1 text-[13px] ${cls}`}>
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/70 transition-colors"
      >
        <X size={13} />
      </button>
    </span>
  )
}

function MessageItem({
  m,
  now,
  myId,
  taskId,
  proof,
  markingId,
  canReply,
  onReply,
  onDelete,
  onDownload,
  onMarkProof,
}: {
  m: DiscussionMessage
  now: Date
  myId: string | undefined
  taskId: string | null
  proof?: DiscussionProof
  markingId: string | null
  canReply: boolean
  onReply: (m: DiscussionMessage) => void
  onDelete: (m: DiscussionMessage) => void
  onDownload: (f: DiscussionFile) => void
  onMarkProof: (f: DiscussionFile) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (m.deleted) {
    return <p className="text-sm italic text-[#475569] pl-10">This message was deleted.</p>
  }
  const name = m.author?.name ?? 'Someone'
  const long = m.body.length > LONG
  const segments = splitMentions(long && !expanded ? `${m.body.slice(0, LONG)}…` : m.body, m.mentions)
  const sentBack = m.send_back
  const mentionsMe = !!myId && m.mentions.some((p) => p.id === myId)

  const bodyNode = m.body ? (
    <p className="text-sm text-[#1E293B] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {segments.map((s, i) =>
        s.mention ? (
          <span
            key={i}
            className={`rounded px-0.5 font-medium ${s.mention.id === myId ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#EFF6FF] text-[#1D4ED8]'}`}
          >
            {s.text}
          </span>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </p>
  ) : null

  const extOk = (f: DiscussionFile) => {
    const list = proof?.allowedExtensions ?? []
    return list.length === 0 || list.includes((f.file_name.split('.').pop() ?? '').toLowerCase())
  }

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <Avatar name={name} size="md" />
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
          <span className="text-sm font-semibold text-[#0F172A] break-words">{name}</span>
          <span className="text-[12px] text-[#475569]">· {messageTime(m.created_at, now)}</span>
          {m.for_step && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] px-2 py-0.5 text-[12px] font-medium max-w-full">
              <Flag size={11} className="shrink-0" aria-hidden />
              <span className="truncate">For “{m.for_step.title}”</span>
            </span>
          )}
        </div>

        {sentBack ? (
          <div className="rounded-[10px] border border-[#DDD6FE] bg-[#F5F3FF] px-3 py-2 flex flex-col gap-1">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#4C1D95] break-words">
              <Undo2 size={14} className="shrink-0" aria-hidden /> Sent back to “{sentBack.to_title}”
            </p>
            {bodyNode}
          </div>
        ) : (
          <div className={mentionsMe ? 'rounded-[8px] bg-[#FFFBEB] -mx-1.5 px-1.5 py-0.5' : ''}>{bodyNode}</div>
        )}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start text-[13px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] min-h-[32px]"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}

        {m.attachments.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {m.attachments.map((f) => {
              const canPromote =
                !!proof?.canSubmit && f.task_id === taskId && f.uploaded_by_user_id === myId && !f.is_proof && extOk(f)
              return (
                <li key={f.id} className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-2 min-w-0 max-w-full rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] pl-2.5 pr-1 py-1">
                    <FileText size={14} className="shrink-0 text-[#475569]" aria-hidden />
                    <span className="truncate text-[13px] text-[#0F172A]">{f.file_name}</span>
                    <span className="shrink-0 text-[12px] text-[#475569]">{fileSize(f.size_bytes)}</span>
                    {f.is_proof && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-[#166534]">
                        <ShieldCheck size={12} /> Proof
                      </span>
                    )}
                    <Tooltip label={`Download “${f.file_name}”`}>
                      <button type="button" onClick={() => onDownload(f)} aria-label={`Download ${f.file_name}`} className={`${BTN.icon} !w-9 !h-9 sm:!w-7 sm:!h-7`}>
                        <Download size={14} />
                      </button>
                    </Tooltip>
                  </span>
                  {canPromote && (
                    <button
                      type="button"
                      onClick={() => onMarkProof(f)}
                      disabled={markingId === f.id}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] disabled:text-[#64748B] min-h-[32px]"
                    >
                      {markingId === f.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Mark as proof
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {(canReply || m.can_delete) && (
          <div className="flex items-center gap-1 -ml-2">
            {canReply && (
              <button
                type="button"
                onClick={() => onReply(m)}
                className="inline-flex items-center gap-1 rounded-[6px] px-2 min-h-[36px] sm:min-h-[28px] text-[12px] font-semibold text-[#475569] hover:text-[#1D4ED8] hover:bg-[#EFF6FF] transition-colors"
              >
                <CornerUpLeft size={13} /> Reply
              </button>
            )}
            {m.can_delete && (
              <button
                type="button"
                onClick={() => onDelete(m)}
                aria-label="Delete message"
                className="inline-flex items-center gap-1 rounded-[6px] px-2 min-h-[36px] sm:min-h-[28px] text-[12px] font-semibold text-[#475569] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
