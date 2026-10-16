'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getKnowledgePosts, getKnowledgeTags, deleteKnowledgePost, togglePinKnowledge, toggleKnowledgeReaction } from '@/lib/api/knowledge'
import type { KnowledgePost } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
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
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-medium text-text-primary">Knowledge Hub</h1>
            <p className="text-sm text-text-secondary mt-0.5">Tips, guides and insights shared by the team</p>
          </div>
          <Link
            href="/communication/knowledge/new"
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-control text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            <Plus size={16} />
            Share
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search knowledge posts…"
            className="w-full pl-8 pr-4 py-2 border border-border rounded-control text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary bg-surface"
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
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface text-text-secondary border-border-light hover:border-primary hover:text-primary-text',
                ].join(' ')}
              >
                <Tag size={10} />
                {tag}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen size={40} className="text-muted mb-3" />
            <p className="text-text-secondary font-medium">No posts yet</p>
            <p className="text-sm text-text-muted">Be the first to share your knowledge</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pinned.length > 0 && (
              <>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Pinned</p>
                {pinned.map(p => <KnowledgeCard key={p.id} post={p} userId={user?.id ?? ''} isHR={isHR} onPin={handlePin} onDelete={handleDelete} onReact={handleReact} />)}
                {rest.length > 0 && <p className="text-xs font-medium text-text-muted uppercase tracking-wider mt-2">Recent</p>}
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
    <div className={`bg-surface border rounded-card p-4 flex flex-col gap-3 ${post.is_pinned ? 'border-primary' : 'border-border-light'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {post.is_pinned && <div className="flex items-center gap-1 text-xs text-primary-text font-medium mb-1"><Pin size={11} />Pinned</div>}
          <Link href={`/communication/knowledge/${post.id}`}>
            <h3 className="text-base font-medium text-text-primary hover:text-primary-text transition-colors">{post.title}</h3>
          </Link>
          <p className="text-sm text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {post.tags.map(t => (
                <span key={t} className="text-xs bg-primary-subtle text-primary-text px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isHR && (
            <button onClick={() => onPin(post.id)} className={`p-1.5 rounded-control transition-colors ${post.is_pinned ? 'text-primary-text hover:bg-primary-subtle' : 'text-text-muted hover:bg-surface-control'}`}>
              <Pin size={14} />
            </button>
          )}
          {(post.created_by_user_id === userId || isHR) && (
            <button onClick={() => onDelete(post.id)} className="p-1.5 rounded-control text-text-muted hover:text-danger hover:bg-danger-bg transition-colors">
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
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${mine ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
            >
              {emoji} {count > 0 && <span>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span>{post.created_by?.name}</span>
        <span>·</span>
        <span>{formatDate(post.created_at)}</span>
        <span>·</span>
        <span>{post._count?.comments ?? 0} comments</span>
      </div>
    </div>
  )
}
