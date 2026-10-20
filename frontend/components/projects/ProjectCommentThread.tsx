'use client'

import { useRef, useState } from 'react'
import { Trash2, Loader2, CornerDownRight, X } from 'lucide-react'
import type { ProjectComment } from '@/lib/types/projects'
import { projectsApi } from '@/lib/api/projects'
import { useAuth } from '@/lib/auth/context'
import { Button } from '@/components/ui/button'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'

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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSubmit() {
    if (!body.trim()) return
    // Throws on failure: the box keeps the text and shows its error toast.
    await projectsApi.addComment(orgId, projectId, { body: body.trim(), reply_to_comment_id: replyTo ?? undefined })
    setBody('')
    setReplyTo(null)
    onRefresh()
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

  // The data carries only the author's id, so the thread names the reader and otherwise "Team member".
  const nameOf = (userId: string) => (userId === user?.id ? (user?.name ?? 'You') : 'Team member')
  const live = comments
    .filter((c) => !c.is_deleted)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const replyTarget = replyTo ? live.find((c) => c.id === replyTo) : undefined

  const items: ThreadItem[] = live.map((comment) => {
    const parent = comment.reply_to_comment_id ? live.find((c) => c.id === comment.reply_to_comment_id) : undefined
    return {
      id: comment.id,
      who: nameOf(comment.user_id),
      when: comment.created_at,
      text: comment.body,
      replyingTo: parent ? nameOf(parent.user_id) : undefined,
      attachments:
        comment.attachment_urls?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {comment.attachment_urls.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="text-meta text-primary-text underline">{a.name}</a>
            ))}
          </div>
        ) : undefined,
      actions: (
        <>
          <Button variant="ghost" size="sm" onClick={() => { setReplyTo(comment.id); textareaRef.current?.focus() }}>
            <CornerDownRight size={12} /> Reply
          </Button>
          {comment.user_id === user?.id && (
            <Button
              variant="ghost"
              size="sm"
              className="text-text-muted hover:text-danger"
              onClick={() => handleDelete(comment.id)}
              disabled={deletingId === comment.id}
            >
              {deletingId === comment.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
            </Button>
          )}
        </>
      ),
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <CommentThread items={items} onWrite={() => textareaRef.current?.focus()} />

      {replyTo && (
        <div className="flex items-center gap-2 text-meta text-text-secondary">
          <CornerDownRight size={12} />
          Replying to {replyTarget ? nameOf(replyTarget.user_id) : 'comment'}
          <Button variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
            <X size={12} /> Cancel
          </Button>
        </div>
      )}

      <CommentBox
        value={body}
        onChange={setBody}
        onSend={handleSubmit}
        textareaRef={textareaRef}
        placeholder="Write a comment..."
      />
    </div>
  )
}
