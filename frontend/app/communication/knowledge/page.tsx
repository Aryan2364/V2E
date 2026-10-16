'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getKnowledgePosts, getKnowledgeTags, deleteKnowledgePost, togglePinKnowledge, toggleKnowledgeReaction } from '@/lib/api/knowledge'
import type { KnowledgePost } from '@/lib/types/communication'
import Link from 'next/link'
import { BookOpen, Plus, Pin, Trash2, Search, Tag } from 'lucide-react'

const REACTIONS = ['👍', '❤️', '💡', '🎉', '🔥']

export default function KnowledgePage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [posts, setPosts] = useState<KnowledgePost[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState('')

  useEffect(() => {
    if (!orgId) return
    getKnowledgeTags(orgId).then(setTags)
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    getKnowledgePosts(orgId, {
      search: search || undefined,
      tag: activeTag || undefined,
    }).then(setPosts).finally(() => setLoading(false))
  }, [orgId, search, activeTag])

  async function handlePin(id: string) {
    if (!orgId) return
    const updated = await togglePinKnowledge(orgId, id)
    setPosts(prev => prev.map(p => p.id === id ? { ...p, is_pinned: updated.is_pinned } : p))
  }

  async function handleDelete(id: string) {
    if (!orgId) return
    await deleteKnowledgePost(orgId, id)
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  async function handleReact(id: string, emoji: string) {
    if (!orgId) return
    const res = await toggleKnowledgeReaction(orgId, id, emoji)
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p
      const reactions = p.reactions ?? []
      if (res.toggled) {
        return { ...p, reactions: [...reactions, { emoji, user_id: user?.id ?? '' }] }
      } else {
        return { ...p, reactions: reactions.filter(r => !(r.emoji === emoji && r.user_id === user?.id)) }
      }
    }))
  }

  const pinned = posts.filter(p => p.is_pinned)
  const rest = posts.filter(p => !p.is_pinned)

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#0F172A]">Knowledge Hub</h1>
            <p className="text-sm text-[#475569] mt-0.5">Tips, guides and insights shared by the team</p>
          </div>
          <Link
            href="/communication/knowledge/new"
            className="flex items-center gap-2 bg-[#2563EB] text-white px-4 py-2 rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus size={16} />
            Share
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search knowledge posts…"
            className="w-full pl-9 pr-4 py-2 border border-[#CBD5E1] rounded-[8px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] bg-white"
          />
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(t => t === tag ? '' : tag)}
                className={[
                  'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  activeTag === tag
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB] hover:text-[#2563EB]',
                ].join(' ')}
              >
                <Tag size={10} />
                {tag}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen size={40} className="text-[#CBD5E1] mb-3" />
            <p className="text-[#475569] font-medium">No posts yet</p>
            <p className="text-sm text-[#94A3B8]">Be the first to share your knowledge</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pinned.length > 0 && (
              <>
                <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">Pinned</p>
                {pinned.map(p => <KnowledgeCard key={p.id} post={p} userId={user?.id ?? ''} isHR={isHR} onPin={handlePin} onDelete={handleDelete} onReact={handleReact} />)}
                {rest.length > 0 && <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mt-2">Recent</p>}
              </>
            )}
            {rest.map(p => <KnowledgeCard key={p.id} post={p} userId={user?.id ?? ''} isHR={isHR} onPin={handlePin} onDelete={handleDelete} onReact={handleReact} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function KnowledgeCard({ post, userId, isHR, onPin, onDelete, onReact }: {
  post: KnowledgePost
  userId: string
  isHR: boolean
  onPin: (id: string) => void
  onDelete: (id: string) => void
  onReact: (id: string, emoji: string) => void
}) {
  return (
    <div className={`bg-white border rounded-[12px] p-5 flex flex-col gap-3 ${post.is_pinned ? 'border-[#2563EB]' : 'border-[#E2E8F0]'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {post.is_pinned && <div className="flex items-center gap-1 text-xs text-[#2563EB] font-semibold mb-1"><Pin size={11} />Pinned</div>}
          <Link href={`/communication/knowledge/${post.id}`}>
            <h3 className="text-base font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors">{post.title}</h3>
          </Link>
          <p className="text-sm text-[#475569] mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {post.tags.map(t => (
                <span key={t} className="text-xs bg-[#EFF6FF] text-[#2563EB] px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isHR && (
            <button onClick={() => onPin(post.id)} className={`p-1.5 rounded-[6px] transition-colors ${post.is_pinned ? 'text-[#2563EB] hover:bg-[#EFF6FF]' : 'text-[#94A3B8] hover:bg-[#F1F5F9]'}`}>
              <Pin size={14} />
            </button>
          )}
          {(post.created_by_user_id === userId || isHR) && (
            <button onClick={() => onDelete(post.id)} className="p-1.5 rounded-[6px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {REACTIONS.map(emoji => {
          const count = post.reactions?.filter(r => r.emoji === emoji).length ?? 0
          const mine = post.reactions?.some(r => r.emoji === emoji && r.user_id === userId)
          return (
            <button
              key={emoji}
              onClick={() => onReact(post.id, emoji)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${mine ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]' : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569] hover:border-[#2563EB]'}`}
            >
              {emoji} {count > 0 && <span>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 text-xs text-[#94A3B8]">
        <span>{post.created_by?.name}</span>
        <span>·</span>
        <span>{new Date(post.created_at).toLocaleDateString()}</span>
        <span>·</span>
        <span>{post._count?.comments ?? 0} comments</span>
      </div>
    </div>
  )
}
