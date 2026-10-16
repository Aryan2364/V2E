'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, Trash2Icon, PencilIcon, XIcon, CheckIcon } from 'lucide-react'
import {
  getCultureStandards,
  createCultureStandard,
  updateCultureStandard,
  deleteCultureStandard,
} from '@/lib/api/culture'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet'
import type { CultureStandard, BehaviorType } from '@/lib/types'

interface CultureManagerDrawerProps {
  open: boolean
  orgId: string
  onClose: () => void
  /** Called after any add/edit/delete so the read view behind the drawer refreshes. */
  onChanged: () => void
}

// ─── Inline add / edit form (mirrors setup step-2) ──────────────────────────────

function InlineForm({
  initial,
  onSave,
  onCancel,
}: {
  type: BehaviorType
  initial?: { title: string; description: string }
  onSave: (title: string, description: string) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    if (!description.trim()) {
      setError('Description is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(title.trim(), description.trim())
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message
      setError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border-light bg-surface-sunken p-4">
      <div>
        <Label required>Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Proactive Communication"
          className="mt-1 max-w-none"
          autoFocus
        />
      </div>
      <div>
        <Label required>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Describe this standard in detail…"
          className="mt-1"
        />
      </div>
      {error && <p className="text-label text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" loading={saving} onClick={handleSave}>
          <CheckIcon size={13} /> Save
        </Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={onCancel}>
          <XIcon size={13} /> Cancel
        </Button>
      </div>
    </div>
  )
}

function CultureCard({
  standard,
  onEdit,
  onDelete,
}: {
  standard: CultureStandard
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex gap-3 rounded-lg border border-border-light bg-surface p-4 transition-shadow hover:shadow-xs">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-text-primary">{standard.title}</p>
        {standard.description && (
          <p className="mt-1 text-body text-text-secondary">{standard.description}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-primary-subtle hover:text-primary-text"
          aria-label="Edit"
        >
          <PencilIcon size={14} />
        </button>
        <button
          onClick={onDelete}
          className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger"
          aria-label="Delete"
        >
          <Trash2Icon size={14} />
        </button>
      </div>
    </div>
  )
}

function Column({
  title,
  type,
  items,
  orgId,
  onRefresh,
}: {
  title: string
  type: BehaviorType
  items: CultureStandard[]
  orgId: string
  onRefresh: () => void
}) {
  const isExpected = type === 'expected_behavior'
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const headerBg = isExpected ? 'bg-success-bg border-success-border' : 'bg-danger-bg border-danger-border'
  const headerText = isExpected ? 'text-success' : 'text-danger'
  const dotColor = isExpected ? 'bg-success' : 'bg-danger'

  const handleAdd = async (t: string, d: string) => {
    await createCultureStandard(orgId, { title: t, description: d, type })
    setShowForm(false)
    onRefresh()
  }
  const handleEdit = async (id: string, t: string, d: string) => {
    await updateCultureStandard(orgId, id, { title: t, description: d })
    setEditingId(null)
    onRefresh()
  }
  const handleDelete = async (id: string) => {
    await deleteCultureStandard(orgId, id)
    setConfirmDeleteId(null)
    onRefresh()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className={`flex items-center gap-2 rounded-t-card border border-b-0 px-4 py-3 ${headerBg}`}>
        <span
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${dotColor}`}
        >
          <span className="translate-y-px text-meta leading-none font-medium text-primary-foreground tabular-nums">
            {items.length}
          </span>
        </span>
        <h3 className={`text-body font-medium ${headerText}`}>{title}</h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className={`ml-auto inline-flex items-center gap-1 text-label font-medium ${headerText} hover:opacity-80`}
          >
            <PlusIcon size={13} /> Add
          </button>
        )}
      </div>

      <div className="flex flex-col rounded-b-card border border-border-light bg-surface-sunken">
        {/* Add form sits below the fixed header so it stays visible while typing */}
        {showForm && (
          <div className="px-3 pt-3">
            <InlineForm type={type} onSave={handleAdd} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Scrollable card list — the column heading above stays fixed */}
        <div className="flex max-h-90 min-h-30 flex-col gap-2 overflow-y-auto p-3">
          {items.length === 0 && !showForm && (
            <div className="flex flex-col items-center gap-1 py-8">
              <p className="text-center text-label text-text-muted">No standards added yet.</p>
            </div>
          )}

          {items.map((item) =>
            editingId === item.id ? (
              <InlineForm
                key={item.id}
                type={type}
                initial={{ title: item.title, description: item.description }}
                onSave={(t, d) => handleEdit(item.id, t, d)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={item.id}>
                {confirmDeleteId === item.id ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-bg p-3">
                    <p className="text-label text-danger">Delete &quot;{item.title}&quot;?</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="danger" onClick={() => handleDelete(item.id)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <CultureCard
                    standard={item}
                    onEdit={() => setEditingId(item.id)}
                    onDelete={() => setConfirmDeleteId(item.id)}
                  />
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Manage culture standards (expected / unacceptable behaviors) from a right-hand
 * drawer — so admins edit in place in Settings instead of being sent to the setup
 * wizard. Each standard is created/updated/deleted individually; the parent read
 * view refreshes via onChanged.
 */
export default function CultureManagerDrawer({
  open,
  orgId,
  onClose,
  onChanged,
}: CultureManagerDrawerProps) {
  const [standards, setStandards] = useState<CultureStandard[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setStandards(await getCultureStandards(orgId))
    } catch {
      setStandards([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Reload whenever the drawer opens.
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleRefresh = () => {
    load()
    onChanged()
  }

  const expected = standards.filter((s) => s.type === 'expected_behavior')
  const unacceptable = standards.filter((s) => s.type === 'unacceptable_behavior')

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right" className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Manage Culture Standards</SheetTitle>
        </SheetHeader>

        <SheetBody>
          {loading ? (
            <div className="flex gap-4">
              <Skeleton className="h-48 flex-1 rounded-card" />
              <Skeleton className="h-48 flex-1 rounded-card" />
            </div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <Column
                title="Expected Behaviors"
                type="expected_behavior"
                items={expected}
                orgId={orgId}
                onRefresh={handleRefresh}
              />
              <Column
                title="Unacceptable Behaviors"
                type="unacceptable_behavior"
                items={unacceptable}
                orgId={orgId}
                onRefresh={handleRefresh}
              />
            </div>
          )}
        </SheetBody>

        <SheetFooter>
          <Button onClick={onClose}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
