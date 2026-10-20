'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getBoards, createBoard, deleteBoard } from '@/lib/api/bulletin'
import type { BulletinBoard } from '@/lib/types/communication'
import Link from 'next/link'
import { Layout, Plus, Trash2, MessageSquare, Eye, MessageCircle } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/ui/sonner'

const MODE_LABEL: Record<string, string> = {
  read_only: 'Read only',
  comments_only: 'Comments',
  comments_and_reactions: 'Comments and reactions',
}

export default function BulletinBoardsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isHR = !!user?.is_admin
  const isAdmin = !!user?.is_admin
  const [boards, setBoards] = useState<BulletinBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', interaction_mode: 'comments_and_reactions' })
  const [creating, setCreating] = useState(false)
  const [nameError, setNameError] = useState('')
  const [boardToDelete, setBoardToDelete] = useState<BulletinBoard | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!orgId) return
    getBoards(orgId).then(setBoards).finally(() => setLoading(false))
  }, [orgId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    if (!form.name.trim()) {
      setNameError('Enter a name for the board.')
      requestAnimationFrame(() => document.getElementById('board-name')?.focus())
      return
    }
    setNameError('')
    setCreating(true)
    try {
      const board = await createBoard(orgId, {
        name: form.name.trim(),
        description: form.description.trim(),
        interaction_mode: form.interaction_mode as any,
        scope: 'company_wide' as any,
      } as any)
      setBoards(prev => [board, ...prev])
      setForm({ name: '', description: '', interaction_mode: 'comments_and_reactions' })
      setShowCreate(false)
      toast.success('Board added')
    } catch {
      toast.error('Could not add the board. Try again.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!orgId) return
    setDeleting(true)
    try {
      await deleteBoard(orgId, id)
      setBoards(prev => prev.filter(b => b.id !== id))
      toast.success('Board deleted')
    } catch {
      toast.error('Could not delete the board. Try again.')
    } finally {
      setDeleting(false)
      setBoardToDelete(null)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-page-title font-medium text-text-primary">Bulletin Boards</h1>
            <p className="text-label text-text-secondary mt-0.5">Company and team boards for posts and updates</p>
          </div>
          {isHR && (
            <button
              onClick={() => setShowCreate(s => !s)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-control text-label font-medium hover:bg-primary-hover transition-colors"
            >
              <Plus size={16} />
              New board
            </button>
          )}
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="bg-surface border border-border-light rounded-card p-4 mb-6 flex flex-col gap-4">
            <h2 className="text-body font-medium text-text-primary">New board</h2>
            <div>
              <Label className="mb-2" htmlFor="board-name" required>Board name</Label>
              <input
                id="board-name"
                value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); if (nameError) setNameError('') }}
                placeholder="For example, Engineering"
                aria-invalid={nameError ? true : undefined}
                className="w-full max-w-[480px] border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary aria-invalid:border-danger"
              />
              <InlineFieldError>{nameError}</InlineFieldError>
            </div>
            <div>
              <Label className="mb-2">Description</Label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="For example, Announcements and updates for the team"
                className="w-full border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
              />
            </div>
            <div>
              <Label className="mb-2">Interaction mode</Label>
              <StyledSelect
                value={form.interaction_mode}
                onChange={(v) => setForm(f => ({ ...f, interaction_mode: v }))}
                options={[
                  { value: 'read_only', label: 'Read only' },
                  { value: 'comments_only', label: 'Comments only' },
                  { value: 'comments_and_reactions', label: 'Comments and reactions' },
                ]}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setShowCreate(false); setNameError('') }} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating} loading={creating} loadingLabel="Adding">
                Add board
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Layout size={40} className="text-muted mb-3" />
            <p className="text-text-secondary font-medium">No boards yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {boards.map(board => (
              <div key={board.id} className="bg-surface border border-border-light rounded-card p-4 flex flex-col gap-3 hover:border-primary transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <Link href={`/communication/bulletin/${board.id}`}>
                      <h3 className="text-body font-medium text-text-primary hover:text-primary-text transition-colors">{board.name}</h3>
                    </Link>
                    {board.description && <p className="text-meta text-text-secondary mt-0.5 line-clamp-2">{board.description}</p>}
                  </div>
                  {isAdmin && (
                    <button onClick={() => setBoardToDelete(board)} aria-label="Delete board" className="p-1.5 text-text-muted hover:text-danger hover:bg-danger-bg rounded-control transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-meta text-text-muted">
                  <span className="flex items-center gap-1">
                    <MessageSquare size={12} />
                    {board._count?.posts ?? 0} posts
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    {board.interaction_mode === 'read_only' ? <Eye size={12} /> : <MessageCircle size={12} />}
                    {MODE_LABEL[board.interaction_mode]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!boardToDelete}
        title={`Delete ${boardToDelete?.name ?? 'board'}?`}
        message="This removes the board and every post and comment on it. This cannot be undone."
        confirmLabel="Delete board"
        danger
        loading={deleting}
        onConfirm={() => boardToDelete && handleDelete(boardToDelete.id)}
        onCancel={() => setBoardToDelete(null)}
      />
    </div>
  )
}
