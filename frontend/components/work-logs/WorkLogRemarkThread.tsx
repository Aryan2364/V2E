'use client'

import React, { useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import type { WorkLogRemark } from '@/lib/types/workLogs'
import { formatDate } from '@/lib/format'

// Remarks + threaded replies on a Work Log entry. Ported from TicketCommentThread for
// consistency: one-level replies, optimistic delete with undo.
interface Props {
  remarks: WorkLogRemark[]
  currentUserId: string
  onAdd: (body: string, replyTo?: string) => Promise<void>
  onDelete: (remarkId: string) => Promise<void>
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

function timeAgo(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return formatDate(d)
}

function RemarkItem({
  remark,
  currentUserId,
  onDelete,
  onReply,
  depth = 0,
}: {
  remark: WorkLogRemark
  currentUserId: string
  onDelete: (id: string) => Promise<void>
  onReply: (id: string) => void
  depth?: number
}) {
  const [justDeleted, setJustDeleted] = useState(false)
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const isOwn = remark.user_id === currentUserId

  function handleDelete() {
    setJustDeleted(true)
    const t = setTimeout(() => onDelete(remark.id), 10000)
    setUndoTimer(t)
  }
  function handleUndo() {
    if (undoTimer) clearTimeout(undoTimer)
    setJustDeleted(false)
    setUndoTimer(null)
  }

  if (justDeleted) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-surface-sunken rounded-[8px] text-sm text-text-muted">
        Remark deleted.
        <button type="button" onClick={handleUndo} className="text-primary-text font-medium hover:underline">Undo</button>
        <span className="text-xs">(10s)</span>
      </div>
    )
  }

  return (
    <div className={depth > 0 ? 'ml-8 border-l-2 border-border-light pl-3' : ''}>
      <div className="flex gap-3 py-2">
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-meta font-medium shrink-0">
          {getInitials(remark.user_name ?? remark.user_id.slice(0, 4))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{remark.user_name ?? 'User'}</span>
            <span className="text-xs text-text-muted">{timeAgo(remark.created_at)}</span>
          </div>
          <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">{remark.body}</p>
          <div className="flex items-center gap-3 mt-1">
            {depth === 0 && (
              <button type="button" onClick={() => onReply(remark.id)} className="text-xs text-text-secondary hover:text-primary-text">
                Reply
              </button>
            )}
            {isOwn && (
              <button type="button" onClick={handleDelete} className="text-xs text-text-muted hover:text-danger flex items-center gap-0.5">
                <Trash2 size={10} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {(remark.replies ?? []).map((reply) => (
        <RemarkItem key={reply.id} remark={reply} currentUserId={currentUserId} onDelete={onDelete} onReply={onReply} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function WorkLogRemarkThread({ remarks, currentUserId, onAdd, onDelete }: Props) {
  const [body, setBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | undefined>()
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    try {
      await onAdd(body.trim(), replyingTo)
      setBody('')
      setReplyingTo(undefined)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-0">
      {remarks.length === 0 && <p className="text-sm text-text-muted text-center py-4">No remarks yet.</p>}
      {remarks.map((r) => (
        <RemarkItem key={r.id} remark={r} currentUserId={currentUserId} onDelete={onDelete} onReply={setReplyingTo} />
      ))}

      <div className="mt-4 border border-border-light rounded-[10px] p-3 bg-white">
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-primary-text">
            Replying to remark
            <button type="button" onClick={() => setReplyingTo(undefined)} className="text-danger hover:underline">Cancel</button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a remark…"
          rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }}
          className="w-full text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden resize-none"
        />
        <div className="flex items-center justify-end mt-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={!body.trim() || sending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
          >
            <Send size={13} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
