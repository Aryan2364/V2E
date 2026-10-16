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
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/communication/bulletin" className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#0F172A] mb-6 w-fit">
          <ArrowLeft size={16} />
          Bulletin Boards
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : board && (
          <>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-[#0F172A]">{board.name}</h1>
                {board.description && <p className="text-sm text-[#475569] mt-0.5">{board.description}</p>}
              </div>
              {canPost && (
                <button
                  onClick={() => setShowForm(s => !s)}
                  className="flex items-center gap-2 bg-[#2563EB] text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] transition-colors"
                >
                  <Plus size={16} />
                  New Post
                </button>
              )}
            </div>

            {showForm && (
              <form onSubmit={handlePost} className="bg-white border border-[#E2E8F0] rounded-[12px] p-5 mb-6 flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Title</label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Post title"
                    className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Content</label>
                  <textarea
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    rows={4}
                    placeholder="Write something..."
                    className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] resize-y"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-[#E2E8F0] text-[#475569] px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-[#F8FAFC]">Cancel</button>
                  <button type="submit" disabled={posting} className="flex-1 bg-[#2563EB] text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed">
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-4">
              {posts.map(post => (
                <div key={post.id} className={`bg-white border rounded-[12px] p-5 flex flex-col gap-3 ${post.is_pinned ? 'border-[#2563EB]' : 'border-[#E2E8F0]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {post.is_pinned && <div className="flex items-center gap-1 text-xs text-[#2563EB] font-semibold mb-1"><Pin size={11} />Pinned</div>}
                      <Link href={`/communication/bulletin/${boardId}/posts/${post.id}`}>
                        <h3 className="text-base font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors">{post.title}</h3>
                      </Link>
                      <p className="text-sm text-[#475569] mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isHR && (
                        <button onClick={() => handlePin(post.id)} className={`p-1.5 rounded-[6px] transition-colors ${post.is_pinned ? 'text-[#2563EB] hover:bg-[#EFF6FF]' : 'text-[#94A3B8] hover:bg-[#F1F5F9]'}`}>
                          <Pin size={14} />
                        </button>
                      )}
                      {(post.created_by_user_id === user?.id || isHR) && (
                        <button onClick={() => handleDelete(post.id)} className="p-1.5 rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors">
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
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${myReaction ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569] hover:border-[#2563EB]'}`}
                          >
                            {emoji} {count > 0 && <span>{count}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-[#94A3B8]">
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
