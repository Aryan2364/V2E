'use client'

import { useEffect, useRef, useState } from 'react'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getKnowledgePost, addKnowledgeComment, deleteKnowledgeComment, toggleKnowledgeReaction } from '@/lib/api/knowledge'
import type { KnowledgePost, KnowledgeComment } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
import Link from 'next/link'
import { Trash2, MessageSquare } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'

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
  const commentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!orgId || !postId) return
    getKnowledgePost(orgId, postId).then(setPost).finally(() => setLoading(false))
  }, [orgId, postId])

  async function handleComment() {
    if (!orgId || !postId || !comment.trim()) return
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
        <PageHeader title={post.title} trail={[{ label: 'Knowledge hub', href: '/communication/knowledge' }]} />

        <div className="bg-surface border border-border-light rounded-card p-6 mb-4">
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
                  aria-pressed={!!mine}
                  className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex items-center gap-1 px-2.5 py-1 rounded-full text-label border transition-colors ${mine ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
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
            {post.comments?.length ?? 0} comments
          </h2>

          <CommentThread
            className="mb-4"
            onWrite={() => commentRef.current?.focus()}
            items={(post.comments ?? []).flatMap((c): ThreadItem[] => {
              const deleteButton = (x: KnowledgeComment) =>
                x.created_by_user_id === user?.id || isHR ? (
                  <Tooltip label="Delete comment">
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteComment(x.id)} aria-label="Delete comment">
                      <Trash2 size={12} />
                    </Button>
                  </Tooltip>
                ) : undefined
              return [
                {
                  id: c.id,
                  who: c.created_by?.name ?? 'Someone',
                  when: c.created_at,
                  text: c.body,
                  actions: (
                    <>
                      <button
                        onClick={() => { setReplyTo({ id: c.id, name: c.created_by.name }); commentRef.current?.focus() }}
                        className="rounded-xs text-meta text-primary-text hover:underline outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring "
                      >
                        Reply
                      </button>
                      {deleteButton(c)}
                    </>
                  ),
                },
                ...(c.replies ?? []).map((r): ThreadItem => ({
                  id: r.id,
                  who: r.created_by?.name ?? 'Someone',
                  when: r.created_at,
                  text: r.body,
                  replyingTo: c.created_by?.name,
                  actions: deleteButton(r),
                })),
              ]
            })}
          />

          {replyTo && (
            <div className="flex items-center gap-2 mb-2 text-meta text-text-secondary bg-surface-control px-3 py-1.5 rounded-control">
              <span>Replying to <strong>{replyTo.name}</strong></span>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</Button>
            </div>
          )}

          <CommentBox
            value={comment}
            onChange={setComment}
            onSend={handleComment}
            textareaRef={commentRef}
            placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Write a comment…'}
          />
        </div>
      </div>
    </div>
  )
}
