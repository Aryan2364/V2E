'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getBoard, getPosts, createPost, togglePinPost, deletePost, toggleReaction } from '@/lib/api/bulletin'
import type { BulletinBoard, BulletinPost } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
import Link from 'next/link'
import { Plus, Pin, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import Tooltip from '@/components/ui/tooltip'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { toast } from '@/components/ui/sonner'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥']

export default function BulletinBoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [board, setBoard] = useState<BulletinBoard | null>(null)
  const [posts, setPosts] = useState<BulletinPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', body: '' })
  const [posting, setPosting] = useState(false)
  const [postToDelete, setPostToDelete] = useState<BulletinPost | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; body?: string }>({})

  useEffect(() => {
    if (!orgId || !boardId) return
    Promise.all([getBoard(orgId, boardId), getPosts(orgId, boardId)])
      .then(([b, p]) => { setBoard(b); setPosts(p) })
      .finally(() => setLoading(false))
  }, [orgId, boardId])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !boardId) return
    if (!form.title.trim() || !form.body.trim()) {
      setFieldErrors({
        title: form.title.trim() ? undefined : 'Enter a title for the post.',
        body: form.body.trim() ? undefined : 'Write the content of the post.',
      })
      requestAnimationFrame(() => document.getElementById(form.title.trim() ? 'board-post-body' : 'board-post-title')?.focus())
      return
    }
    setFieldErrors({})
    setPosting(true)
    try {
      const post = await createPost(orgId, boardId, { title: form.title.trim(), body: form.body.trim() } as any)
      setPosts(prev => [post, ...prev])
      setForm({ title: '', body: '' })
      setShowForm(false)
      toast.success('Post added')
    } catch {
      toast.error('Could not add the post. Try again.')
    } finally {
      setPosting(false)
    }
  }

  async function handlePin(postId: string) {
    if (!orgId || !boardId) return
    const updated = await togglePinPost(orgId, boardId, postId)
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, is_pinned: updated.is_pinned } : p))
  }

  async function handleDelete(postId: string) {
    if (!orgId || !boardId) return
    await deletePost(orgId, boardId, postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
  }

  async function handleReact(postId: string, emoji: string) {
    if (!orgId || !boardId) return
    await toggleReaction(orgId, boardId, postId, emoji)
    const updated = await getPosts(orgId, boardId)
    setPosts(updated)
  }

  const canPost = board && board.interaction_mode !== 'read_only'
  const canReact = board && board.interaction_mode === 'comments_and_reactions'

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-3xl mx-auto">
        <PageHeader
          title={board?.name ?? 'Board'}
          meta={board?.description || undefined}
          trail={[{ label: 'Bulletin boards', href: '/communication/bulletin' }]}
          actions={
            board && canPost ? (
              <Button onClick={() => setShowForm(s => !s)}>
                <Plus size={16} />
                New post
              </Button>
            ) : undefined
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : board && (
          <>
            {showForm && (
              <form onSubmit={handlePost} className="bg-surface border border-border-light rounded-card p-4 mb-6 flex flex-col gap-4">
                <div>
                  <Label className="mb-2" htmlFor="board-post-title" required>Title</Label>
                  <input
                    id="board-post-title"
                    value={form.title}
                    onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }}
                    placeholder="For example, Holiday schedule for October"
                    aria-invalid={fieldErrors.title ? true : undefined}
                    className="w-full max-w-[480px] border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary aria-invalid:border-danger"
                  />
                  <InlineFieldError>{fieldErrors.title}</InlineFieldError>
                </div>
                <div>
                  <Label className="mb-2" htmlFor="board-post-body" required>Content</Label>
                  <textarea
                    id="board-post-body"
                    value={form.body}
                    onChange={e => { setForm(f => ({ ...f, body: e.target.value })); setFieldErrors((p) => (p.body ? { ...p, body: undefined } : p)) }}
                    rows={4}
                    aria-invalid={fieldErrors.body ? true : undefined}
                    className="w-full border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary resize-y aria-invalid:border-danger"
                  />
                  <InlineFieldError>{fieldErrors.body}</InlineFieldError>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setFieldErrors({}) }} disabled={posting}>Cancel</Button>
                  <Button type="submit" disabled={posting} loading={posting} loadingLabel="Posting">Add post</Button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-4">
              {posts.map(post => (
                <div key={post.id} className={`bg-surface border rounded-card p-4 flex flex-col gap-3 ${post.is_pinned ? 'border-primary' : 'border-border-light'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {post.is_pinned && <div className="flex items-center gap-1 text-meta text-primary-text font-medium mb-1"><Pin size={11} />Pinned</div>}
                      <Link href={`/communication/bulletin/${boardId}/posts/${post.id}`}>
                        <h3 className="text-body font-medium text-text-primary hover:text-primary-text transition-colors">{post.title}</h3>
                      </Link>
                      <p className="text-label text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isHR && (
                        <Tooltip label={post.is_pinned ? 'Unpin post' : 'Pin post'}>
                          <Button variant="ghost" size="icon" onClick={() => handlePin(post.id)} aria-label={post.is_pinned ? 'Unpin post' : 'Pin post'} aria-pressed={!!post.is_pinned} className={post.is_pinned ? 'text-primary-text' : undefined}>
                            <Pin size={14} />
                          </Button>
                        </Tooltip>
                      )}
                      {(post.created_by_user_id === user?.id || isHR) && (
                        <Tooltip label="Delete post">
                          <Button variant="ghost" size="icon" onClick={() => setPostToDelete(post)} aria-label="Delete post">
                            <Trash2 size={14} />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {canReact && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {REACTIONS.map(emoji => {
                        const count = post.reactions?.filter(r => r.emoji === emoji).length ?? 0
                        const myReaction = post.reactions?.some(r => r.emoji === emoji && r.user_id === user?.id)
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReact(post.id, emoji)}
                            aria-pressed={!!myReaction}
                            className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex items-center gap-1 px-2 py-0.5 rounded-full text-meta border transition-colors ${myReaction ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
                          >
                            {emoji} {count > 0 && <span>{count}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-meta text-text-muted">
                    <span>{post.created_by?.name}</span>
                    <span>·</span>
                    <span>{formatDate(post.created_at)}</span>
                    <span>·</span>
                    <span>{post._count?.comments ?? 0} comments</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!postToDelete}
        title="Delete this post?"
        message="This removes the post and its reactions. This cannot be undone."
        confirmLabel="Delete post"
        danger
        onConfirm={async () => {
          if (!postToDelete) return
          const id = postToDelete.id
          setPostToDelete(null)
          try { await handleDelete(id); toast.success('Post deleted') } catch { toast.error('Could not delete the post. Try again.') }
        }}
        onCancel={() => setPostToDelete(null)}
      />
    </div>
  )
}
