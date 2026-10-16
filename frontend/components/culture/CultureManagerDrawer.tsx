'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import {
  getCultureStandards,
  createCultureStandard,
  updateCultureStandard,
  deleteCultureStandard,
} from '@/lib/api/culture'
import Button from '@/components/ui/Button'
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
  type,
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

  const isExpected = type === 'expected_behavior'
  const accentBorder = isExpected ? 'focus:border-success' : 'focus:border-danger'
  const inputCls = `w-full rounded-[8px] border border-border bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 ${accentBorder} transition-colors`
  const textareaCls = `w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 ${accentBorder} transition-colors resize-none`

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
    <div className="bg-surface-sunken border border-border-light rounded-[10px] p-4 flex flex-col gap-3 mt-2">
      <div>
        <label className="text-xs font-semibold text-text-secondary mb-1 block">
          Title <span className="text-danger">*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Proactive Communication"
          className={inputCls}
          autoFocus
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-text-secondary mb-1 block">
          Description <span className="text-danger">*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Describe this standard in detail…"
          className={textareaCls}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-primary text-white text-xs font-semibold hover:bg-primary-hover disabled:opacity-60 transition-colors"
        >
          {saving ? (
            <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Check size={13} />
          )}
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] border border-border text-text-secondary text-xs font-semibold hover:bg-surface-control transition-colors"
        >
          <X size={13} /> Cancel
        </button>
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
    <div className="group bg-white border border-border-light rounded-[10px] p-4 flex gap-3 transition-shadow hover:shadow-xs">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-text-primary">{standard.title}</p>
        {standard.description && (
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">{standard.description}</p>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={onEdit}
          className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors"
          aria-label="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-danger hover:bg-danger-bg transition-colors"
          aria-label="Delete"
        >
          <Trash2 size={14} />
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
    <div className="flex-1 flex flex-col min-w-0">
      <div className={`rounded-t-[12px] border border-b-0 px-4 py-3 flex items-center gap-2 ${headerBg}`}>
        <span
          className={`w-5 h-5 shrink-0 rounded-full inline-flex items-center justify-center ${dotColor}`}
        >
          <span className="text-[11px] font-bold leading-none text-white tabular-nums translate-y-px">
            {items.length}
          </span>
        </span>
        <h3 className={`font-bold text-sm ${headerText}`}>{title}</h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold ${headerText} hover:opacity-80 transition-opacity`}
          >
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      <div className="border border-border-light rounded-b-[12px] bg-surface-sunken flex flex-col">
        {/* Add form sits below the fixed header so it stays visible while typing */}
        {showForm && (
          <div className="px-3 pt-3">
            <InlineForm type={type} onSave={handleAdd} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Scrollable card list — the column heading above stays fixed */}
        <div className="p-3 flex flex-col gap-2 max-h-[360px] overflow-y-auto min-h-[120px]">
          {items.length === 0 && !showForm && (
            <div className="flex flex-col items-center gap-1 py-8">
              <p className="text-xs text-[#CBD5E1] text-center">No standards added yet.</p>
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
                  <div className="bg-danger-bg border border-danger-border rounded-[10px] p-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-danger">Delete &quot;{item.title}&quot;?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="px-2.5 py-1 rounded-[6px] bg-danger text-white text-xs font-semibold hover:bg-danger-hover"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded-[6px] border border-border text-xs font-semibold"
                      >
                        Cancel
                      </button>
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
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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

  if (!mounted) return null

  return createPortal(
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-60" onClick={onClose} />}

      <div
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-2xl bg-white border-l border-border-light shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h3 className="font-semibold text-text-primary">Manage Culture Standards</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-5">
          {loading ? (
            <div className="flex gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex-1 h-48 rounded-[12px] bg-surface-control-pressed animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
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
          </div>

          <div className="px-5 pt-4 pb-12 border-t border-border-light flex gap-3">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
