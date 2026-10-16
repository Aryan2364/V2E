'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getBoard, getPost, addComment, deleteComment, toggleReaction } from '@/lib/api/bulletin'
import type { BulletinBoard, BulletinPost } from '@/lib/types/communication'
import { formatDate, formatDateTime } from '@/lib/format'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥']

export default function BulletinPostPage() {
  const { boardId, postId } = useParams<{ boardId: string; postId: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [board, setBoard] = useState<BulletinBoard | null>(null)
  const [post, setPost] = useState<BulletinPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!orgId || !boardId || !postId) return
    Promise.all([getBoard(orgId, boardId), getPost(orgId, boardId, postId)])
      .then(([b, p]) => { setBoard(b); setPost(p) })
      .finally(() => setLoading(false))
  }, [orgId, boardId, postId])

  async function handleComment(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !boardId || !postId || !comment.trim()) return
    setSubmitting(true)
    try {
      const c = await addComment(orgId, boardId, postId, comment.trim())
      setPost(prev => prev ? { ...prev, comments: [...(prev.comments ?? []), c] } : prev)
      setComment('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!orgId) return
    await deleteComment(orgId, commentId)
    setPost(prev => prev ? { ...prev, comments: prev.comments?.filter(c => c.id !== commentId) } : prev)
  }

  async function handleReact(emoji: string) {
    if (!orgId || !boardId || !postId) return
    await toggleReaction(orgId, boardId, postId, emoji)
    const updated = await getPost(orgId, boardId, postId)
    setPost(updated)
  }

  const canComment = board && board.interaction_mode !== 'read_only'
  const canReact = board && board.interaction_mode === 'comments_and_reactions'

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!post) return null

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-2xl mx-auto">
        <Link href={`/communication/bulletin/${boardId}`} className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 w-fit">
          <ArrowLeft size={16} />
          Back to {board?.name ?? 'Board'}
        </Link>

        <div className="bg-surface border border-border-light rounded-card p-6 mb-4">
          <h1 className="text-xl font-medium text-text-primary mb-2">{post.title}</h1>
          <div className="flex items-center gap-3 text-xs text-text-muted mb-4">
            <span>{post.created_by?.name}</span>
            <span>·</span>
            <span>{formatDate(post.created_at)}</span>
          </div>
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{post.body}</p>

          {canReact && (
            <div className="flex items-center gap-1.5 mt-4 flex-wrap">
              {REACTIONS.map(emoji => {
                const count = post.reactions?.filter(r => r.emoji === emoji).length ?? 0
                const myReaction = post.reactions?.some(r => r.emoji === emoji && r.user_id === user?.id)
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-colors ${myReaction ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
                  >
                    {emoji} {count > 0 && <span className="text-xs font-medium">{count}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border-light rounded-card p-6">
          <h2 className="text-sm font-medium text-text-primary mb-4">{post.comments?.length ?? 0} Comments</h2>

          <div className="flex flex-col gap-4 mb-4">
            {(post.comments ?? []).map(c => (
              <div key={c.id} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium shrink-0">
                  {c.created_by?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-text-primary">{c.created_by?.name}</span>
                      <span className="text-xs text-text-muted ml-2">{formatDateTime(c.created_at)}</span>
                    </div>
                    {(c.created_by_user_id === user?.id || isHR) && (
                      <button onClick={() => handleDeleteComment(c.id)} className="p-1 text-text-muted hover:text-danger rounded-xs transition-colors">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">{c.body}</p>
                </div>
              </div>
            ))}
          </div>

          {canComment && (
            <form onSubmit={handleComment} className="flex gap-2">
              <input
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
              />
              <button
                type="submit"
                disabled={submitting || !comment.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-control text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Post
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
