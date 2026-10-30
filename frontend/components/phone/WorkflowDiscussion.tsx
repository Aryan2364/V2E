'use client'

import React from 'react'
import { AtSign, CornerUpLeft, Download, FileText, Flag, Loader2, Paperclip, RefreshCw, ShieldCheck, Trash2, Undo2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { DiscussionFile, DiscussionMessage, DiscussionStep, PersonRef } from '@/lib/types/workflows'
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
  removeMessage,
  splitMentions,
  taggableSteps,
} from '@/components/workflows/discussion'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, ROW, ROW_BLOCK, cx } from './primitives'

/*
 * The run's ONE shared discussion on the phone: the twin of the computer's
 * InstanceDiscussion (components/workflows/InstanceDiscussion.tsx), which the
 * computer shows INSTEAD of task comments on a workflow step task (task page
 * ~1204-1215) and on the run page. Same endpoints and helpers
 * (workflowsApi.getDiscussion / postDiscussion / uploadDiscussionFile /
 * deleteDiscussionMessage / markDiscussionRead / getDiscussionPeople and
 * components/workflows/discussion.ts):
 *   - messages from every step and the run page, oldest first, "Show earlier"
 *     20 at a time, refreshed quietly every 30 s while visible, a "New"
 *     divider at the first unread message, marked read once on screen;
 *   - @mentions: type "@" or tap the @ button, pick from the people who can
 *     see the run; only names still in the text are sent (activeMentionIds);
 *   - reply to a message, "For a later step" (shows at the top of that step's
 *     task when it starts), photos and files on a message, delete a message
 *     (the server says can_delete), and on a step task a file of mine can be
 *     used as proof when the task asks for it;
 *   - the kit comment box is pinned at the bottom of the screen; when writing
 *     is not allowed it is disabled and the reason is said above it.
 */
const PAGE = 20
const REFRESH_MS = 30000
type Load = 'loading' | 'ready' | 'failed'

/** Lets the task screen know a shared file was promoted to proof. */
export interface DiscussionProof {
  canSubmit: boolean
  allowedExtensions: string[]
  onMark: (attachmentId: string) => Promise<void>
}

export function WorkflowDiscussion({
  orgId,
  templateId,
  instanceId,
  taskId = null,
  title = 'Comments',
  canWrite,
  writeReason,
  proof,
  onChanged,
}: {
  orgId: string
  templateId: string
  instanceId: string
  /** On a step task: messages written here belong to this task. */
  taskId?: string | null
  title?: string
  /** Tri-state: undefined = not known yet (disabled, no reason shown). */
  canWrite: boolean | undefined
  writeReason: string
  proof?: DiscussionProof
  /** After a message is posted or removed (counts / history / files may change). */
  onChanged?: () => void
}) {
  const { user } = useAuth()
  const myId = user?.id
  const { addToast } = useToast()

  const [status, setStatus] = React.useState<Load>('loading')
  const [loadError, setLoadError] = React.useState('')
  const [messages, setMessages] = React.useState<DiscussionMessage[]>([])
  const [hasMore, setHasMore] = React.useState(false)
  const [nextBefore, setNextBefore] = React.useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = React.useState(false)
  const [total, setTotal] = React.useState(0)
  const [unread, setUnread] = React.useState(0)
  const [steps, setSteps] = React.useState<DiscussionStep[]>([])
  /** Where the "New" divider sits - fixed for this visit so it doesn't jump as you read. */
  const [dividerId, setDividerId] = React.useState<string | null>(null)
  const [people, setPeople] = React.useState<PersonRef[]>([])
  const sectionRef = React.useRef<HTMLElement>(null)
  const markingRef = React.useRef(false)

  const load = React.useCallback(
    async (quiet = false) => {
      if (!orgId || !templateId || !instanceId) return
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

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  React.useEffect(() => {
    if (!orgId || !templateId || !instanceId) return
    workflowsApi
      .getDiscussionPeople(orgId, templateId, instanceId)
      .then(setPeople)
      .catch(() => setPeople([]))
  }, [orgId, templateId, instanceId])

  // New messages arrive while the screen is open: refresh quietly while it is visible.
  React.useEffect(() => {
    if (status !== 'ready') return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [status, load])

  // Read = the discussion has been on screen. The divider stays where it was.
  const markRead = React.useCallback(async () => {
    if (markingRef.current) return
    markingRef.current = true
    try {
      await workflowsApi.markDiscussionRead(orgId, templateId, instanceId)
      setUnread(0)
    } catch {
      // Unread stays as it was; nothing to tell the person.
    } finally {
      markingRef.current = false
    }
  }, [orgId, templateId, instanceId])

  React.useEffect(() => {
    const el = sectionRef.current
    if (!el || status !== 'ready' || unread === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      const t = setTimeout(() => void markRead(), 0)
      return () => clearTimeout(t)
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void markRead()
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [status, unread, markRead])

  async function loadEarlier() {
    if (!nextBefore || loadingEarlier) return
    setLoadingEarlier(true)
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

  // ── Composer ────────────────────────────────────────────────────────────────
  const [text, setText] = React.useState('')
  const [files, setFiles] = React.useState<File[]>([])
  const [forRow, setForRow] = React.useState('')
  const [forOpen, setForOpen] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<DiscussionMessage | null>(null)
  const [picked, setPicked] = React.useState<PersonRef[]>([])
  const [posting, setPosting] = React.useState(false)
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null)
  const textRef = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const tagChoices = React.useMemo(() => taggableSteps(steps, taskId), [steps, taskId])
  // A step that finished since it was picked is no longer offered.
  const pickedFor = forRow && tagChoices.some((s) => s.row_id === forRow) ? forRow : ''

  const suggestions = React.useMemo(() => (mention ? filterPeople(people, mention.query, myId ? [myId] : []) : []), [mention, people, myId])

  function onTextChange(raw: string) {
    const value = raw.slice(0, MESSAGE_MAX)
    setText(value)
    setMention(mentionQuery(value, textRef.current?.selectionStart ?? value.length))
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
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  /** Posts the message, then its files. Throws (the box keeps the text and toasts) only when the message itself fails. */
  async function send() {
    const body = text.trim()
    if (canWrite !== true || posting || (!body && files.length === 0)) return
    setPosting(true)
    try {
      let created: DiscussionMessage
      try {
        created = await workflowsApi.postDiscussion(orgId, templateId, instanceId, {
          body,
          reply_to_id: replyTo?.id ?? null,
          for_row_id: pickedFor || null,
          mention_user_ids: activeMentionIds(text, picked),
          task_id: taskId,
          with_files: files.length > 0,
        })
      } catch (e) {
        throw new Error(workflowErrorMessage(e, 'Your message was not posted. Try again.'))
      }
      const uploaded: DiscussionFile[] = []
      let failed = false
      for (const f of files) {
        try {
          uploaded.push(await workflowsApi.uploadDiscussionFile(orgId, templateId, instanceId, created.id, await shrinkImageForUpload(f)))
        } catch (e) {
          failed = true
          addToast(workflowErrorMessage(e, 'A file did not upload.'), 'error')
          break
        }
      }
      if (failed && !body && uploaded.length === 0) {
        // Nothing worth keeping - take back the empty message.
        await workflowsApi.deleteDiscussionMessage(orgId, templateId, instanceId, created.id).catch(() => undefined)
        throw new Error('The file did not upload, so nothing was posted. Try again.')
      }
      const shown: DiscussionMessage = { ...created, attachments: [...(created.attachments ?? []), ...uploaded] }
      setMessages((list) => addMessage(list, shown))
      setTotal((n) => n + 1)
      setText('')
      setPicked([])
      setReplyTo(null)
      setForRow('')
      if (failed) {
        setFiles((list) => list.slice(uploaded.length))
        addToast('Your message was posted, but a file did not upload. Attach it again.', 'error')
      } else {
        setFiles([])
      }
      onChanged?.()
    } finally {
      setPosting(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = React.useState<DiscussionMessage | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await workflowsApi.deleteDiscussionMessage(orgId, templateId, instanceId, deleteTarget.id)
      setMessages((list) => removeMessage(list, deleteTarget.id))
      setTotal((n) => Math.max(0, n - 1))
      if (replyTo?.id === deleteTarget.id) setReplyTo(null)
      setDeleteTarget(null)
      addToast('Message deleted', 'success')
      onChanged?.()
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The message could not be deleted. Try again.'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  // ── Files ───────────────────────────────────────────────────────────────────
  const [markingId, setMarkingId] = React.useState<string | null>(null)
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
  }
  // Replying puts the cursor in the box.
  const replyId = replyTo?.id
  React.useEffect(() => {
    if (replyId) textRef.current?.focus()
  }, [replyId])

  const flat = messages.flatMap((m) => [m, ...m.replies])
  const items: ThreadItem[] = flat.map((m) => {
    const parent = flat.find((x) => x.id === m.reply_to_id)
    return messageItem(m, {
      myId,
      taskId,
      proof,
      markingId,
      canReply: canWrite === true,
      replyingTo: parent ? (parent.author?.name ?? 'Someone') : undefined,
      isFirstUnread: m.id === dividerId,
      onReply: reply,
      onDelete: setDeleteTarget,
      onDownload: download,
      onMarkProof: markProof,
    })
  })
  const forStep = tagChoices.find((s) => s.row_id === pickedFor)
  const disabled = canWrite !== true || posting

  return (
    <section ref={sectionRef} aria-label={title} className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[8px]">
        <h2 className="text-label font-medium text-text-secondary">
          {title}
          {total > 0 ? ` (${total})` : ''}
        </h2>
        {unread > 0 ? (
          <span className="ml-auto inline-flex items-center rounded-full border border-warning-border bg-warning-bg px-[10px] py-[2px] text-meta font-medium text-warning">{unread} new</span>
        ) : null}
      </div>

      {status === 'failed' ? (
        <div className="flex flex-col items-start gap-[8px]">
          <p className="text-body text-text-secondary">{loadError}</p>
          <PhoneButton variant="secondary" onClick={() => void load()}>
            <RefreshCw aria-hidden /> Try again
          </PhoneButton>
        </div>
      ) : (
        <CommentThread
          followLatest={false}
          loading={status === 'loading'}
          items={items}
          hasEarlier={hasMore}
          onShowEarlier={() => void loadEarlier()}
          onWrite={() => textRef.current?.focus()}
          label={title}
        />
      )}

      {canWrite === false ? <p className="text-label text-text-secondary">{writeReason}</p> : null}

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
      <CommentBox
        label="Write a message"
        value={text}
        onChange={onTextChange}
        onSend={send}
        textareaRef={textRef}
        maxLength={MESSAGE_MAX}
        disabled={disabled}
        hasContent={files.length > 0}
        placeholder={replyTo ? 'Write a reply' : 'Write a message - @ to mention someone'}
        textareaProps={{
          onClick: (e) => setMention(mentionQuery(text, e.currentTarget.selectionStart ?? text.length)),
          onBlur: () => setTimeout(() => setMention(null), 250),
          'aria-autocomplete': 'list',
          'aria-expanded': !!mention && suggestions.length > 0,
        }}
        attachments={
          replyTo || forStep || files.length > 0 || mention ? (
            <div className="flex w-full flex-col gap-[6px]">
              {mention && suggestions.length > 0 ? (
                <ul role="listbox" aria-label="People who can see this instance" className="max-h-[220px] overflow-y-auto rounded-[8px] border border-border-light bg-surface">
                  {suggestions.map((p) => (
                    <li key={p.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => pickPerson(p)}
                        className="flex min-h-[44px] w-full items-center px-[12px] text-left text-body text-text-primary active:bg-surface-control"
                      >
                        <span className="truncate">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {mention && suggestions.length === 0 && mention.query.length > 0 ? (
                <p className="rounded-[8px] border border-border-light bg-surface px-[12px] py-[8px] text-label text-text-secondary">No one who can see this instance matches “{mention.query}”.</p>
              ) : null}
              <div className="flex flex-wrap gap-[6px]">
                {replyTo ? (
                  <Chip icon={<CornerUpLeft aria-hidden />} label={`Replying to ${replyTo.author?.name ?? 'a message'}`} onClear={() => setReplyTo(null)} clearLabel="Cancel reply" />
                ) : null}
                {forStep ? <Chip icon={<Flag aria-hidden />} label={`For “${forStep.title}”`} onClear={() => setForRow('')} clearLabel="Remove the step" warn /> : null}
                {files.map((f, i) => (
                  <Chip
                    key={`${f.name}-${i}`}
                    icon={<FileText aria-hidden />}
                    label={`${f.name} ${fileSize(f.size)}`}
                    onClear={() => setFiles((list) => list.filter((_, idx) => idx !== i))}
                    clearLabel={`Remove ${f.name}`}
                  />
                ))}
              </div>
            </div>
          ) : undefined
        }
        tools={
          <>
            <ToolButton label="Mention someone" disabled={disabled} onClick={startMention}>
              <AtSign aria-hidden />
            </ToolButton>
            <ToolButton label="Attach photo or file" disabled={disabled} onClick={() => fileRef.current?.click()}>
              <Paperclip aria-hidden />
            </ToolButton>
            {tagChoices.length > 0 && !replyTo ? (
              <ToolButton label="For a later step" disabled={disabled} active={!!pickedFor} onClick={() => setForOpen(true)}>
                <Flag aria-hidden />
              </ToolButton>
            ) : null}
          </>
        }
      />

      <PhoneSheet open={forOpen} onOpenChange={setForOpen} title="For a later step">
        <div className="flex flex-col gap-[12px]">
          <p className="text-body text-text-secondary">Shown at the top of that step’s task when it starts. Its assignees are told.</p>
          <ul role="radiogroup" aria-label="For a later step" className={ROW_BLOCK}>
            {[{ row_id: '', title: 'No - for everyone now' }, ...tagChoices].map((s) => (
              <li key={s.row_id || 'none'}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={pickedFor === s.row_id}
                  onClick={() => {
                    setForRow(s.row_id)
                    setForOpen(false)
                  }}
                  className={cx(ROW, pickedFor === s.row_id && 'font-medium')}
                >
                  <span className="min-w-0 flex-1 wrap-break-word">{s.title || 'Untitled step'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </PhoneSheet>

      <PhoneSheet
        open={!!deleteTarget}
        onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}
        title="Delete this message?"
        footer={
          <PhoneButton variant="primary" fullWidth loading={deleting} className="border-danger bg-danger active:border-danger active:bg-danger" onClick={() => void confirmDelete()}>
            Delete message
          </PhoneButton>
        }
      >
        <p className="text-body text-text-secondary">It is removed for everyone, with its files.</p>
      </PhoneSheet>
    </section>
  )
}

function ToolButton({ label, disabled, active, onClick, children }: { label: string; disabled: boolean; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control disabled:opacity-50 [&_svg]:size-[20px]',
        active && 'bg-warning-bg text-warning',
      )}
    >
      {children}
    </button>
  )
}

function Chip({ icon, label, onClear, clearLabel, warn = false }: { icon: React.ReactNode; label: string; onClear: () => void; clearLabel: string; warn?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-[6px] rounded-[8px] border py-[2px] pl-[10px] text-label [&_svg]:size-[14px] [&_svg]:shrink-0',
        warn ? 'border-warning-border bg-warning-bg text-warning' : 'border-primary-border bg-primary-subtle text-primary-text',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label={clearLabel} className="-my-[10px] inline-flex size-[44px] shrink-0 items-center justify-center rounded-full active:bg-surface/70">
        <X aria-hidden />
      </button>
    </span>
  )
}

type MessageDeps = {
  myId: string | undefined
  taskId: string | null
  proof?: DiscussionProof
  markingId: string | null
  canReply: boolean
  replyingTo?: string
  isFirstUnread: boolean
  onReply: (m: DiscussionMessage) => void
  onDelete: (m: DiscussionMessage) => void
  onDownload: (f: DiscussionFile) => void
  onMarkProof: (f: DiscussionFile) => void
}

/** One discussion message as an entry of the kit comment thread (the computer's messageItem, phone sizes). */
function messageItem(m: DiscussionMessage, d: MessageDeps): ThreadItem {
  const { myId, taskId, proof, markingId, canReply } = d
  const base = {
    id: m.id,
    who: m.author?.name ?? 'Someone',
    when: m.created_at,
    tag: m.for_step ? `For “${m.for_step.title}”` : undefined,
    replyingTo: d.replyingTo,
    dividerBefore: d.isFirstUnread ? 'New' : undefined,
  }
  if (m.deleted) return { ...base, tag: undefined, text: <span className="italic text-text-secondary">This message was deleted.</span> }

  const sentBack = m.send_back
  const mentionsMe = !!myId && m.mentions.some((p) => p.id === myId)
  const segments = splitMentions(m.body, m.mentions)
  const bodyNode = m.body ? (
    <span className="wrap-anywhere">
      {segments.map((seg, i) =>
        seg.mention ? (
          <span key={i} className={cx('rounded-xs px-[2px] font-medium', seg.mention.id === myId ? 'bg-warning-bg text-warning' : 'bg-primary-subtle text-primary-text')}>
            {seg.text}
          </span>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </span>
  ) : null

  const text = sentBack ? (
    <span className="flex flex-col gap-[4px] whitespace-normal rounded-[10px] border border-border-light bg-surface-control px-[12px] py-[8px]">
      <span className="flex items-center gap-[6px] text-label font-medium text-text-secondary wrap-break-word">
        <Undo2 aria-hidden className="size-[14px] shrink-0" /> Sent back to “{sentBack.to_title}”
      </span>
      <span className="whitespace-pre-line">{bodyNode}</span>
    </span>
  ) : mentionsMe ? (
    <span className="rounded-[8px] bg-warning-bg px-[6px] py-[2px] box-decoration-clone">{bodyNode}</span>
  ) : (
    bodyNode
  )

  const extOk = (f: DiscussionFile) => {
    const list = proof?.allowedExtensions ?? []
    return list.length === 0 || list.includes((f.file_name.split('.').pop() ?? '').toLowerCase())
  }

  return {
    ...base,
    text,
    attachments:
      m.attachments.length > 0 ? (
        <ul className="flex flex-col gap-[8px]">
          {m.attachments.map((f) => {
            const canPromote = !!proof?.canSubmit && f.task_id === taskId && f.uploaded_by_user_id === myId && !f.is_proof && extOk(f)
            return (
              <li key={f.id} className="flex flex-col items-start gap-[4px]">
                <button
                  type="button"
                  onClick={() => d.onDownload(f)}
                  aria-label={`Open ${f.file_name}`}
                  className="inline-flex min-h-[44px] max-w-full items-center gap-[6px] rounded-[6px] border border-border-light px-[8px] py-[4px] text-label text-text-secondary"
                >
                  <Download aria-hidden className="size-[14px] shrink-0" />
                  <span className="truncate">{f.file_name}</span>
                  <span className="shrink-0 text-meta">{fileSize(f.size_bytes)}</span>
                  {f.is_proof ? (
                    <span className="inline-flex shrink-0 items-center gap-[4px] text-meta font-medium text-success">
                      <ShieldCheck aria-hidden className="size-[12px]" /> Proof
                    </span>
                  ) : null}
                </button>
                {canPromote ? (
                  <PhoneButton variant="secondary" loading={markingId === f.id} onClick={() => d.onMarkProof(f)}>
                    {markingId === f.id ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />}
                    <span className="max-w-[220px] truncate">Use “{f.file_name}” as proof</span>
                  </PhoneButton>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : undefined,
    actions:
      canReply || m.can_delete ? (
        <>
          {canReply ? (
            <button type="button" onClick={() => d.onReply(m)} className="inline-flex min-h-[44px] items-center gap-[4px] rounded-[6px] px-[8px] text-label font-medium text-text-secondary active:bg-surface-control">
              <CornerUpLeft aria-hidden className="size-[14px]" /> Reply
            </button>
          ) : null}
          {m.can_delete ? (
            <button type="button" onClick={() => d.onDelete(m)} aria-label="Delete message" className="inline-flex min-h-[44px] items-center gap-[4px] rounded-[6px] px-[8px] text-label font-medium text-text-secondary active:bg-danger-bg">
              <Trash2 aria-hidden className="size-[14px]" /> Delete
            </button>
          ) : null}
        </>
      ) : undefined,
  }
}
