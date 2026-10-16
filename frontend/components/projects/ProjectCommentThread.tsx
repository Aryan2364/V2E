'use client'

import { useState } from 'react'
import { Send, Trash2, Loader2, CornerDownRight } from 'lucide-react'
import type { ProjectComment } from '@/lib/types/projects'
import { projectsApi } from '@/lib/api/projects'
import { useAuth } from '@/lib/auth/context'
import { formatDateTime } from '@/lib/format'

interface ProjectCommentThreadProps {
  orgId: string
  projectId: string
  comments: ProjectComment[]
  onRefresh: () => void
}

export default function ProjectCommentThread({ orgId, projectId, comments, onRefresh }: ProjectCommentThreadProps) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const topLevel = comments.filter((c) => !c.reply_to_comment_id && !c.is_deleted)

  async function handleSubmit() {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await projectsApi.addComment(orgId, projectId, { body: body.trim(), reply_to_comment_id: replyTo ?? undefined })
      setBody('')
      setReplyTo(null)
      onRefresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await projectsApi.deleteComment(orgId, projectId, id)
      onRefresh()
    } finally {
      setDeletingId(null)
    }
  }

  function CommentItem({ comment, depth = 0 }: { comment: ProjectComment; depth?: number }) {
    const replies = comments.filter((c) => c.reply_to_comment_id === comment.id && !c.is_deleted)
    return (
      <div className={depth > 0 ? 'ml-6 border-l border-border-light pl-4' : ''}>
        <div className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-primary-subtle border border-primary-border flex items-center justify-center">
                  <span className="text-[9px] font-medium text-primary-text">{comment.user_id.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-xs text-text-muted">
                  {formatDateTime(comment.created_at)}
                </span>
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{comment.body}</p>
              {comment.attachment_urls?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {comment.attachment_urls.map((a, i) => (
                    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-text underline">{a.name}</a>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setReplyTo(comment.id)}
                className="mt-1 text-xs text-text-secondary hover:text-primary-text transition-colors flex items-center gap-1"
              >
                <CornerDownRight size={11} /> Reply
              </button>
            </div>
            {comment.user_id === user?.id && (
              <button
                type="button"
                onClick={() => handleDelete(comment.id)}
                disabled={deletingId === comment.id}
                className="p-1 rounded-xs hover:bg-danger-bg text-danger shrink-0"
              >
                {deletingId === comment.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            )}
          </div>
        </div>
        {replies.map((r) => <CommentItem key={r.id} comment={r} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div>
      {topLevel.length === 0 && (
        <p className="text-sm text-text-muted py-4">No comments yet. Start the conversation.</p>
      )}
      <div className="divide-y divide-surface-control-pressed mb-4">
        {topLevel.map((c) => <CommentItem key={c.id} comment={c} />)}
      </div>

      {replyTo && (
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <CornerDownRight size={12} />
          Replying to comment
          <button type="button" onClick={() => setReplyTo(null)} className="text-danger hover:underline">Cancel</button>
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
          rows={2}
          className="flex-1 px-3 py-2 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden resize-none"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }}
        />
        <button
          type="button"
          disabled={submitting || !body.trim()}
          onClick={handleSubmit}
          className="h-10 px-3 rounded-[8px] bg-primary hover:bg-primary-hover text-white disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-1.5 text-sm font-medium self-start"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Post
        </button>
      </div>
    </div>
  )
}
