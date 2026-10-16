'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getKnowledgePost, addKnowledgeComment, deleteKnowledgeComment, toggleKnowledgeReaction } from '@/lib/api/knowledge'
import type { KnowledgePost, KnowledgeComment } from '@/lib/types/communication'
import { formatDate, formatDateTime } from '@/lib/format'
import Link from 'next/link'
import { Trash2, MessageSquare } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'

const REACTIONS = ['👍', '❤️', '💡', '🎉', '🔥']

export default function KnowledgePostPage() {
  const { postId } = useParams<{ postId: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [post, setPost] = useState<KnowledgePost | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!orgId || !postId) return
    getKnowledgePost(orgId, postId).then(setPost).finally(() => setLoading(false))
  }, [orgId, postId])

  async function handleComment(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !postId || !comment.trim()) return
    setSubmitting(true)
    try {
      const c = await addKnowledgeComment(orgId, postId, comment.trim(), replyTo?.id)
      setPost(prev => {
        if (!prev) return prev
        if (replyTo) {
          return {
            ...prev,
            comments: prev.comments?.map(cm =>
              cm.id === replyTo.id ? { ...cm, replies: [...(cm.replies ?? []), c] } : cm
            ),
          }
        }
        return { ...prev, comments: [...(prev.comments ?? []), c] }
      })
      setComment('')
      setReplyTo(null)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!orgId) return
    await deleteKnowledgeComment(orgId, commentId)
    setPost(prev => {
      if (!prev) return prev
      return {
        ...prev,
        comments: prev.comments?.filter(c => c.id !== commentId).map(c => ({
          ...c,
          replies: c.replies?.filter(r => r.id !== commentId),
        })),
      }
    })
  }

  async function handleReact(emoji: string) {
    if (!orgId || !postId) return
    const res = await toggleKnowledgeReaction(orgId, postId, emoji)
    setPost(prev => {
      if (!prev) return prev
      const reactions = prev.reactions ?? []
      if (res.toggled) {
        return { ...prev, reactions: [...reactions, { emoji, user_id: user?.id ?? '' }] }
      } else {
        return { ...prev, reactions: reactions.filter(r => !(r.emoji === emoji && r.user_id === user?.id)) }
      }
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!post) return null

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-2xl mx-auto">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/communication/knowledge" />}>Knowledge hub</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{post?.title ?? "Post"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="bg-surface border border-border-light rounded-card p-6 mb-4">
          <h1 className="text-section font-medium text-text-primary mb-2">{post.title}</h1>
          <div className="flex items-center gap-3 text-meta text-text-muted mb-4">
            <span>{post.created_by?.name}</span>
            <span>·</span>
            <span>{formatDate(post.created_at)}</span>
          </div>

          {post.tags?.length > 0 && (
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {post.tags.map(t => (
                <span key={t} className="text-meta bg-primary-subtle text-primary-text px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}

          <p className="text-label text-text-primary leading-relaxed whitespace-pre-wrap">{post.body}</p>

          <div className="flex items-center gap-1.5 mt-4 flex-wrap">
            {REACTIONS.map(emoji => {
              const count = post.reactions?.filter(r => r.emoji === emoji).length ?? 0
              const mine = post.reactions?.some(r => r.emoji === emoji && r.user_id === user?.id)
              return (
                <button
                  key={emoji}
                  onClick={() => handleReact(emoji)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-label border transition-colors ${mine ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
                >
                  {emoji} {count > 0 && <span className="text-meta font-medium">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-surface border border-border-light rounded-card p-6">
          <h2 className="text-label font-medium text-text-primary mb-4 flex items-center gap-1.5">
            <MessageSquare size={15} />
            {post.comments?.length ?? 0} Comments
          </h2>

          <div className="flex flex-col gap-4 mb-4">
            {(post.comments ?? []).map(c => (
              <CommentRow key={c.id} comment={c} userId={user?.id ?? ''} isHR={isHR} onDelete={handleDeleteComment} onReply={() => setReplyTo({ id: c.id, name: c.created_by.name })} />
            ))}
          </div>

          {replyTo && (
            <div className="flex items-center gap-2 mb-2 text-meta text-text-secondary bg-surface-control px-3 py-1.5 rounded-control">
              <span>Replying to <strong>{replyTo.name}</strong></span>
              <button onClick={() => setReplyTo(null)} className="ml-auto text-text-muted hover:text-text-secondary">✕</button>
            </div>
          )}

          <form onSubmit={handleComment} className="flex gap-2">
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Write a comment…'}
              className="flex-1 border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
            />
            <button
              type="submit"
              disabled={submitting || !comment.trim()}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-control text-label font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Post
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function CommentRow({ comment, userId, isHR, onDelete, onReply }: {
  comment: KnowledgeComment
  userId: string
  isHR: boolean
  onDelete: (id: string) => void
  onReply: () => void
}) {
  return (
    <div>
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0">
          {comment.created_by?.name?.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-label font-medium text-text-primary">{comment.created_by?.name}</span>
              <span className="text-meta text-text-muted ml-2">{formatDateTime(comment.created_at)}</span>
            </div>
            <div className="flex gap-1">
              <button onClick={onReply} className="text-meta text-primary-text hover:underline">Reply</button>
              {(comment.created_by_user_id === userId || isHR) && (
                <button onClick={() => onDelete(comment.id)} className="p-1 text-text-muted hover:text-danger rounded-xs transition-colors">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
          <p className="text-label text-text-primary mt-0.5 whitespace-pre-wrap">{comment.body}</p>
        </div>
      </div>

      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-8 mt-3 flex flex-col gap-3">
          {comment.replies.map(reply => (
            <div key={reply.id} className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-text-secondary flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0">
                {reply.created_by?.name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-meta font-medium text-text-primary">{reply.created_by?.name}</span>
                    <span className="text-meta text-text-muted ml-2">{formatDateTime(reply.created_at)}</span>
                  </div>
                  {(reply.created_by_user_id === userId || isHR) && (
                    <button onClick={() => onDelete(reply.id)} className="p-1 text-text-muted hover:text-danger rounded-xs transition-colors">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="text-meta text-text-primary mt-0.5 whitespace-pre-wrap">{reply.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
