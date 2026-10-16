'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getBoard, getPosts, createPost, togglePinPost, deletePost, toggleReaction } from '@/lib/api/bulletin'
import type { BulletinBoard, BulletinPost } from '@/lib/types/communication'
import Link from 'next/link'
import { ArrowLeft, Plus, Pin, Trash2 } from 'lucide-react'

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

  useEffect(() => {
    if (!orgId || !boardId) return
    Promise.all([getBoard(orgId, boardId), getPosts(orgId, boardId)])
      .then(([b, p]) => { setBoard(b); setPosts(p) })
      .finally(() => setLoading(false))
  }, [orgId, boardId])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !boardId || !form.title.trim() || !form.body.trim()) return
    setPosting(true)
    try {
      const post = await createPost(orgId, boardId, { title: form.title.trim(), body: form.body.trim() } as any)
      setPosts(prev => [post, ...prev])
      setForm({ title: '', body: '' })
      setShowForm(false)
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
        <Link href="/communication/bulletin" className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 w-fit">
          <ArrowLeft size={16} />
          Bulletin Boards
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : board && (
          <>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-text-primary">{board.name}</h1>
                {board.description && <p className="text-sm text-text-secondary mt-0.5">{board.description}</p>}
              </div>
              {canPost && (
                <button
                  onClick={() => setShowForm(s => !s)}
                  className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-primary-hover transition-colors"
                >
                  <Plus size={16} />
                  New Post
                </button>
              )}
            </div>

            {showForm && (
              <form onSubmit={handlePost} className="bg-white border border-border-light rounded-[12px] p-5 mb-6 flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Title</label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Post title"
                    className="w-full border border-border rounded-[8px] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Content</label>
                  <textarea
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    rows={4}
                    placeholder="Write something..."
                    className="w-full border border-border rounded-[8px] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary resize-y"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-border-light text-text-secondary px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-surface-sunken">Cancel</button>
                  <button type="submit" disabled={posting} className="flex-1 bg-primary text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed">
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-4">
              {posts.map(post => (
                <div key={post.id} className={`bg-white border rounded-[12px] p-5 flex flex-col gap-3 ${post.is_pinned ? 'border-primary' : 'border-border-light'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {post.is_pinned && <div className="flex items-center gap-1 text-xs text-primary-text font-semibold mb-1"><Pin size={11} />Pinned</div>}
                      <Link href={`/communication/bulletin/${boardId}/posts/${post.id}`}>
                        <h3 className="text-base font-semibold text-text-primary hover:text-primary-text transition-colors">{post.title}</h3>
                      </Link>
                      <p className="text-sm text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isHR && (
                        <button onClick={() => handlePin(post.id)} className={`p-1.5 rounded-[6px] transition-colors ${post.is_pinned ? 'text-primary-text hover:bg-primary-subtle' : 'text-text-muted hover:bg-surface-control'}`}>
                          <Pin size={14} />
                        </button>
                      )}
                      {(post.created_by_user_id === user?.id || isHR) && (
                        <button onClick={() => handleDelete(post.id)} className="p-1.5 rounded-[6px] text-text-muted hover:text-danger hover:bg-danger-bg transition-colors">
                          <Trash2 size={14} />
                        </button>
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
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${myReaction ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
                          >
                            {emoji} {count > 0 && <span>{count}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span>{post.created_by?.name}</span>
                    <span>·</span>
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{post._count?.comments ?? 0} comments</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
