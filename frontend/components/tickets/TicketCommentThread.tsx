'use client'

import React, { useState } from 'react'
import { Send, Trash2, Link2 } from 'lucide-react'
import type { TicketComment } from '@/lib/types/tickets'

interface Props {
  comments: TicketComment[]
  currentUserId: string
  onAdd: (body: string, replyTo?: string, attachmentUrl?: string) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

function timeAgo(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CommentItem({
  comment,
  currentUserId,
  onDelete,
  onReply,
  depth = 0,
}: {
  comment: TicketComment
  currentUserId: string
  onDelete: (id: string) => Promise<void>
  onReply: (id: string) => void
  depth?: number
}) {
  const [justDeleted, setJustDeleted] = useState(false)
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const isOwn = comment.user_id === currentUserId

  function handleDelete() {
    setJustDeleted(true)
    const t = setTimeout(() => { onDelete(comment.id) }, 10000)
    setUndoTimer(t)
  }

  function handleUndo() {
    if (undoTimer) clearTimeout(undoTimer)
    setJustDeleted(false)
    setUndoTimer(null)
  }

  if (justDeleted) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-[#F8FAFC] rounded-[8px] text-sm text-[#94A3B8]">
        Comment deleted.
        <button type="button" onClick={handleUndo} className="text-[#2563EB] font-medium hover:underline">Undo</button>
        <span className="text-xs">(10s)</span>
      </div>
    )
  }

  return (
    <div className={depth > 0 ? 'ml-8 border-l-2 border-[#E2E8F0] pl-3' : ''}>
      <div className="flex gap-3 py-2">
        <div className="w-7 h-7 rounded-full bg-[#2563EB] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {getInitials(comment.user_name ?? comment.user_id.slice(0, 4))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#0F172A]">{comment.user_name ?? 'User'}</span>
            <span className="text-xs text-[#94A3B8]">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-sm text-[#1E293B] mt-0.5 whitespace-pre-wrap">{comment.body}</p>
          {(comment.attachment_urls ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {comment.attachment_urls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline bg-[#EFF6FF] px-2 py-0.5 rounded-xs border border-[#BFDBFE]">
                  <Link2 size={10} /> Attachment {i + 1}
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1">
            {depth === 0 && (
              <button type="button" onClick={() => onReply(comment.id)} className="text-xs text-[#475569] hover:text-[#2563EB]">Reply</button>
            )}
            {isOwn && (
              <button type="button" onClick={handleDelete} className="text-xs text-[#94A3B8] hover:text-[#DC2626] flex items-center gap-0.5">
                <Trash2 size={10} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {(comment.replies ?? []).map((reply) => (
        <CommentItem key={reply.id} comment={reply} currentUserId={currentUserId} onDelete={onDelete} onReply={onReply} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function TicketCommentThread({ comments, currentUserId, onAdd, onDelete }: Props) {
  const [body, setBody] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [showUrlField, setShowUrlField] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | undefined>()
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    try {
      await onAdd(body.trim(), replyingTo, attachmentUrl.trim() || undefined)
      setBody('')
      setAttachmentUrl('')
      setShowUrlField(false)
      setReplyingTo(undefined)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-0">
      {comments.length === 0 && (
        <p className="text-sm text-[#94A3B8] text-center py-4">No comments yet.</p>
      )}
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} currentUserId={currentUserId} onDelete={onDelete} onReply={setReplyingTo} />
      ))}

      {/* Input */}
      <div className="mt-4 border border-[#E2E8F0] rounded-[10px] p-3 bg-white">
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-[#2563EB]">
            Replying to comment
            <button type="button" onClick={() => setReplyingTo(undefined)} className="text-[#DC2626] hover:underline">Cancel</button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }}
          className="w-full text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden resize-none"
        />
        {showUrlField && (
          <input
            type="url"
            value={attachmentUrl}
            onChange={(e) => setAttachmentUrl(e.target.value)}
            placeholder="Paste attachment URL..."
            className="w-full mt-2 px-3 py-1.5 border border-[#CBD5E1] rounded-[6px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-hidden"
          />
        )}
        <div className="flex items-center justify-between mt-2">
          <button type="button" onClick={() => setShowUrlField(!showUrlField)} className="flex items-center gap-1 text-xs text-[#475569] hover:text-[#2563EB]">
            <Link2 size={12} /> Attach URL
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!body.trim() || sending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
          >
            <Send size={13} /> {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
