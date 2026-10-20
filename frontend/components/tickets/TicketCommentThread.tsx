'use client'

import React, { useMemo, useRef, useState } from 'react'
import { Trash2, Link2, CornerDownRight, X } from 'lucide-react'
import type { TicketComment } from '@/lib/types/tickets'
import { Button } from '@/components/ui/button'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'
import { Input } from '@/components/ui/input'

interface Props {
  comments: TicketComment[]
  currentUserId: string
  onAdd: (body: string, replyTo?: string, attachmentUrl?: string) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
}

/** Delete waits this long behind an Undo before it is sent. */
const UNDO_MS = 10000

/** Replies are nested in the data; the kit thread is one list, oldest first, each reply naming who it answers. */
function flatten(comments: TicketComment[], parentName?: string): { comment: TicketComment; replyingTo?: string }[] {
  return comments.flatMap((c) => [
    { comment: c, replyingTo: parentName },
    ...flatten(c.replies ?? [], c.user_name ?? 'User'),
  ])
}

export default function TicketCommentThread({ comments, currentUserId, onAdd, onDelete }: Props) {
  const [body, setBody] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [showUrlField, setShowUrlField] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | undefined>()
  // Comments deleted but still inside their 10s Undo window.
  const [pendingDelete, setPendingDelete] = useState<Record<string, ReturnType<typeof setTimeout>>>({})
  const timers = useRef(pendingDelete)
  timers.current = pendingDelete
  const textareaRef = useRef<HTMLTextAreaElement>(null)


  function handleDelete(id: string) {
    const t = setTimeout(() => { onDelete(id) }, UNDO_MS)
    setPendingDelete((prev) => ({ ...prev, [id]: t }))
  }

  function handleUndo(id: string) {
    const t = timers.current[id]
    if (t) clearTimeout(t)
    setPendingDelete((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function handleSend() {
    if (!body.trim()) return
    // Throws on failure: the box keeps the text and shows its error toast.
    await onAdd(body.trim(), replyingTo, attachmentUrl.trim() || undefined)
    setBody('')
    setAttachmentUrl('')
    setShowUrlField(false)
    setReplyingTo(undefined)
  }

  const all = useMemo(() => flatten(comments), [comments])
  const replyTarget = replyingTo ? all.find((x) => x.comment.id === replyingTo)?.comment : undefined

  const items: ThreadItem[] = all.map(({ comment, replyingTo: to }) => {
    const base = { id: comment.id, who: comment.user_name ?? 'User', when: comment.created_at }
    if (pendingDelete[comment.id]) {
      return {
        ...base,
        text: 'Comment deleted.',
        actions: (
          <>
            <Button variant="ghost" size="sm" onClick={() => handleUndo(comment.id)}>Undo</Button>
            <span className="text-meta text-text-muted">(10s)</span>
          </>
        ),
      }
    }
    const isOwn = comment.user_id === currentUserId
    const isTop = !to
    return {
      ...base,
      text: comment.body,
      replyingTo: to,
      attachments:
        (comment.attachment_urls ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {comment.attachment_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-meta text-primary-text hover:underline bg-primary-subtle px-2 py-0.5 rounded-xs border border-primary-border"
              >
                <Link2 size={10} /> Attachment {i + 1}
              </a>
            ))}
          </div>
        ) : undefined,
      actions:
        isTop || isOwn ? (
          <>
            {isTop && (
              <Button variant="ghost" size="sm" onClick={() => { setReplyingTo(comment.id); textareaRef.current?.focus() }}>
                <CornerDownRight size={12} /> Reply
              </Button>
            )}
            {isOwn && (
              <Button variant="ghost" size="sm" className="text-text-muted hover:text-danger" onClick={() => handleDelete(comment.id)}>
                <Trash2 size={12} /> Delete
              </Button>
            )}
          </>
        ) : undefined,
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <CommentThread items={items} onWrite={() => textareaRef.current?.focus()} />

      {replyingTo && (
        <div className="flex items-center gap-2 text-meta text-primary-text">
          Replying to {replyTarget?.user_name ?? 'comment'}
          <Button variant="ghost" size="sm" onClick={() => setReplyingTo(undefined)}>
            <X size={12} /> Cancel
          </Button>
        </div>
      )}
      {showUrlField && (
        <Input
          type="url"
          value={attachmentUrl}
          onChange={(e) => setAttachmentUrl(e.target.value)}
          placeholder="Paste attachment URL..."
          aria-label="Attachment URL"
        />
      )}
      <CommentBox
        value={body}
        onChange={setBody}
        onSend={handleSend}
        textareaRef={textareaRef}
        placeholder="Add a comment..."
        tools={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach URL"
            aria-pressed={showUrlField}
            onClick={() => setShowUrlField(!showUrlField)}
          >
            <Link2 size={14} />
          </Button>
        }
      />
    </div>
  )
}
