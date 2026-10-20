'use client'

import { useEffect, useState } from 'react'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getBoard, getPost, addComment, deleteComment, toggleReaction } from '@/lib/api/bulletin'
import type { BulletinBoard, BulletinPost } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'

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

  useEffect(() => {
    if (!orgId || !boardId || !postId) return
    Promise.all([getBoard(orgId, boardId), getPost(orgId, boardId, postId)])
      .then(([b, p]) => { setBoard(b); setPost(p) })
      .finally(() => setLoading(false))
  }, [orgId, boardId, postId])

  async function handleComment() {
    if (!orgId || !boardId || !postId || !comment.trim()) return
    const c = await addComment(orgId, boardId, postId, comment.trim())
    setPost(prev => prev ? { ...prev, comments: [...(prev.comments ?? []), c] } : prev)
    setComment('')
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
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/communication/bulletin" />}>Bulletin boards</BreadcrumbLink>
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
          <p className="text-label text-text-primary leading-relaxed whitespace-pre-wrap">{post.body}</p>

          {canReact && (
            <div className="flex items-center gap-1.5 mt-4 flex-wrap">
              {REACTIONS.map(emoji => {
                const count = post.reactions?.filter(r => r.emoji === emoji).length ?? 0
                const myReaction = post.reactions?.some(r => r.emoji === emoji && r.user_id === user?.id)
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-label border transition-colors ${myReaction ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
                  >
                    {emoji} {count > 0 && <span className="text-meta font-medium">{count}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border-light rounded-card p-6">
          <h2 className="text-label font-medium text-text-primary mb-4">{post.comments?.length ?? 0} Comments</h2>

          <CommentThread
            className="mb-4"
            items={(post.comments ?? []).map((c): ThreadItem => ({
              id: c.id,
              who: c.created_by?.name ?? 'Someone',
              when: c.created_at,
              text: c.body,
              actions:
                c.created_by_user_id === user?.id || isHR ? (
                  <button
                    onClick={() => handleDeleteComment(c.id)}
                    aria-label="Delete comment"
                    className="p-1 text-text-muted hover:text-danger rounded-xs transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : undefined,
            }))}
          />

          {canComment && (
            <CommentBox value={comment} onChange={setComment} onSend={handleComment} placeholder="Write a comment…" />
          )}
        </div>
      </div>
    </div>
  )
}
