'use client'

import { Suspense, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getKnowledgePostsPaged, getKnowledgeTags, deleteKnowledgePost, togglePinKnowledge, toggleKnowledgeReaction } from '@/lib/api/knowledge'
import type { KnowledgePost } from '@/lib/types/communication'
import { formatDate } from '@/lib/format'
import Link from 'next/link'
import { BookOpen, Plus, Pin, Trash2, Search, Tag } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { useListAddress, queryOf, type AddressParams } from '@/lib/list-address'

const REACTIONS = ['👍', '❤️', '💡', '🎉', '🔥']
const PAGE_SIZE = 25

type Criteria = { q: string; tag: string; page: number }

function readCriteria(params: AddressParams): Criteria {
  return {
    q: params.get('q') ?? '',
    tag: params.get('tag') ?? '',
    page: Number(params.get('page')) > 0 ? Number(params.get('page')) : 1,
  }
}
function criteriaQuery(c: Criteria): string {
  return queryOf([
    ['q', c.q.trim()],
    ['tag', c.tag],
    ['page', c.page !== 1 && c.page.toString()],
  ])
}

function KnowledgePageInner() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const [posts, setPosts] = useState<KnowledgePost[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const { criteria, apply } = useListAddress<Criteria>({ read: readCriteria, query: criteriaQuery })
  const { q: search, tag: activeTag, page } = criteria

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => setSearchInput(search), [search])
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) apply({ ...criteria, q: searchInput, page: 1 }, 'replace')
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => {
    if (!orgId) return
    getKnowledgeTags(orgId).then(setTags)
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    getKnowledgePostsPaged(orgId, {
      search: search || undefined,
      tag: activeTag || undefined,
      page,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      setPosts(res.items)
      setTotal(res.total)
    }).finally(() => setLoading(false))
  }, [orgId, search, activeTag, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const setPage = (next: number) => apply({ ...criteria, page: next }, 'push')
  const setActiveTag = (next: string) => apply({ ...criteria, tag: next, page: 1 }, 'push')

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
        <PageHeader
          title="Knowledge hub"
          meta="Tips, guides and insights shared by the team"
          actions={
            <Button render={<Link href="/communication/knowledge/new" />}>
              <Plus size={16} />
              Share
            </Button>
          }
        />

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search knowledge posts…"
            className="w-full pl-8 pr-4 py-2 border border-border rounded-control text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary bg-surface"
          />
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                aria-pressed={activeTag === tag}
                className={[
                  'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex items-center gap-1 px-2.5 py-1 rounded-full text-meta font-medium border transition-colors',
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
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen size={40} className="text-muted mb-3" />
            <p className="text-text-secondary font-medium">{search || activeTag ? 'No posts match this search' : 'No posts yet'}</p>
            <p className="text-label text-text-muted">{search || activeTag ? 'Try a different search or tag' : 'Be the first to share your knowledge'}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              {pinned.length > 0 && (
                <>
                  <p className="text-meta font-medium text-text-muted uppercase tracking-wider">Pinned</p>
                  {pinned.map(p => <KnowledgeCard key={p.id} post={p} userId={user?.id ?? ''} isHR={isHR} onPin={handlePin} onDelete={handleDelete} onReact={handleReact} />)}
                  {rest.length > 0 && <p className="text-meta font-medium text-text-muted uppercase tracking-wider mt-2">Recent</p>}
                </>
              )}
              {rest.map(p => <KnowledgeCard key={p.id} post={p} userId={user?.id ?? ''} isHR={isHR} onPin={handlePin} onDelete={handleDelete} onReact={handleReact} />)}
            </div>
            <PaginationBar className="mt-4 rounded-card">
              <PaginationCount>{rangeStart}–{rangeEnd} of {total}</PaginationCount>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious aria-disabled={page <= 1} onClick={() => page > 1 && setPage(page - 1)} />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink isActive>{page}</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext aria-disabled={page >= totalPages} onClick={() => page < totalPages && setPage(page + 1)} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </PaginationBar>
          </>
        )}
      </div>
    </div>
  )
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={null}>
      <KnowledgePageInner />
    </Suspense>
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
          {post.is_pinned && <div className="flex items-center gap-1 text-meta text-primary-text font-medium mb-1"><Pin size={11} />Pinned</div>}
          <Link href={`/communication/knowledge/${post.id}`}>
            <h3 className="text-body font-medium text-text-primary hover:text-primary-text transition-colors">{post.title}</h3>
          </Link>
          <p className="text-label text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {post.tags.map(t => (
                <span key={t} className="text-meta bg-primary-subtle text-primary-text px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isHR && (
            <Tooltip label={post.is_pinned ? 'Unpin post' : 'Pin post'}>
              <Button variant="ghost" size="icon" onClick={() => onPin(post.id)} aria-label={post.is_pinned ? 'Unpin post' : 'Pin post'} aria-pressed={!!post.is_pinned} className={post.is_pinned ? 'text-primary-text' : undefined}>
                <Pin size={14} />
              </Button>
            </Tooltip>
          )}
          {(post.created_by_user_id === userId || isHR) && (
            <Tooltip label="Delete post">
              <Button variant="ghost" size="icon" onClick={() => onDelete(post.id)} aria-label="Delete post">
                <Trash2 size={14} />
              </Button>
            </Tooltip>
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
              aria-pressed={!!mine}
              className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex items-center gap-1 px-2 py-0.5 rounded-full text-meta border transition-colors ${mine ? 'bg-primary-subtle border-primary text-primary-text' : 'bg-surface-sunken border-border-light text-text-secondary hover:border-primary'}`}
            >
              {emoji} {count > 0 && <span>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 text-meta text-text-muted">
        <span>{post.created_by?.name}</span>
        <span>·</span>
        <span>{formatDate(post.created_at)}</span>
        <span>·</span>
        <span>{post._count?.comments ?? 0} comments</span>
      </div>
    </div>
  )
}
