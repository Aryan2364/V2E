'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { processHierarchyApi, type ProcessMapSummary, type ProcessTemplateSummary } from '@/lib/api/process-hierarchy'
import { Workflow, Plus, ChevronRight, X, Loader2, Layers, Trash2, Search, Star, FolderPlus } from 'lucide-react'

const LEAF = 'process_hierarchy.map.manage'

/** Close-on-Escape for a modal/overlay. */
function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])
}

export default function ProcessHierarchyListPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const { can } = usePermissions()
  const canCreate = can(LEAF, 'write')
  const router = useRouter()

  const [maps, setMaps] = useState<ProcessMapSummary[]>([])
  const [loading, setLoading] = useState(true)
  // undefined = create dialog closed; null = new top-level map; string = new sub-map under that id.
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined)
  const [showTemplates, setShowTemplates] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const reload = useCallback(async () => {
    if (!orgId) return
    const data = await processHierarchyApi.listMaps(orgId).catch(() => [])
    setMaps(data)
  }, [orgId])

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    reload().finally(() => setLoading(false))
  }, [orgId, reload])

  const idSet = new Set(maps.map((m) => m.id))
  const childrenBy = new Map<string, ProcessMapSummary[]>()
  for (const m of maps) {
    // Orphans (parent hidden/deleted) fall back to the top level so nothing disappears.
    const key = m.parent_map_id && idSet.has(m.parent_map_id) ? m.parent_map_id : '__root__'
    const list = childrenBy.get(key) ?? []
    list.push(m); childrenBy.set(key, list)
  }
  childrenBy.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)))
  const roots = childrenBy.get('__root__') ?? []
  const pinned = maps.filter((m) => m.is_pinned).sort((a, b) => a.name.localeCompare(b.name))

  const q = query.trim().toLowerCase()
  const results = q
    ? maps.filter((m) => m.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
    : null

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  async function togglePin(m: ProcessMapSummary) {
    setMaps((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_pinned: !x.is_pinned } : x)))
    try { await processHierarchyApi.updateMap(orgId, m.id, { is_pinned: !m.is_pinned }) } catch { reload() }
  }

  const pathOf = (m: ProcessMapSummary): string[] => {
    const byId = new Map(maps.map((x) => [x.id, x]))
    const crumbs: string[] = []
    let cur = m.parent_map_id ? byId.get(m.parent_map_id) : undefined
    let guard = 0
    while (cur && guard < 20) { crumbs.unshift(cur.name); cur = cur.parent_map_id ? byId.get(cur.parent_map_id) : undefined; guard++ }
    return crumbs
  }

  const renderRow = (m: ProcessMapSummary, depth: number) => {
    const kids = childrenBy.get(m.id) ?? []
    const isOpen = expanded.has(m.id)
    return (
      <div key={m.id}>
        <div className="group flex items-center gap-1 rounded-lg pr-2 hover:bg-surface-control transition-colors" style={{ paddingLeft: 4 + depth * 18 }}>
          <button onClick={() => kids.length && toggle(m.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-xs ${kids.length ? 'text-text-muted hover:bg-surface-control-pressed' : 'opacity-0 pointer-events-none'}`}>
            <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
          <Tooltip label={m.name}>
            <button onClick={() => router.push(`/dashboard/process-hierarchy/${m.id}`)} className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
              <Workflow size={16} className="shrink-0 text-primary-text" />
              <span className="truncate text-[14px] font-medium text-text-primary">{m.name}</span>
              {m.node_count > 0 && (
                <Tooltip label={`${m.node_count} step${m.node_count !== 1 ? 's' : ''}`}>
                  <span
                    className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-medium tabular-nums">{m.node_count}</span>
                </Tooltip>
              )}
              {kids.length > 0 && (
                <Tooltip label={`${kids.length} sub-map${kids.length !== 1 ? 's' : ''}`}>
                  <span
                    className="shrink-0 text-[11px] text-text-muted">· {kids.length} inside</span>
                </Tooltip>
              )}
              {m.is_owner && <span className="shrink-0 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-surface-control text-text-secondary">Owner</span>}
            </button>
          </Tooltip>
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Tooltip label={m.is_pinned ? 'Unpin' : 'Pin to top'}>
              <button onClick={() => togglePin(m)} aria-label="Pin"
                className={`w-7 h-7 flex items-center justify-center rounded-[6px] hover:bg-surface-control-pressed ${m.is_pinned ? 'text-warning' : 'text-text-muted hover:text-text-primary'}`}>
                <Star size={14} fill={m.is_pinned ? 'var(--warning)' : 'none'} />
              </button>
            </Tooltip>
            {canCreate && (
              <Tooltip label="Add a sub-map here">
                <button onClick={() => setCreateParent(m.id)} aria-label="Add sub-map"
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-text-muted hover:text-primary-text hover:bg-surface-control-pressed"><FolderPlus size={14} /></button>
              </Tooltip>
            )}
          </div>
        </div>
        {isOpen && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    )
  }

  // A top-level map as a proper card; its sub-maps nest inside it (expandable).
  const renderCard = (m: ProcessMapSummary) => {
    const kids = childrenBy.get(m.id) ?? []
    const isOpen = expanded.has(m.id)
    return (
      <div key={m.id} className="group relative flex flex-col bg-surface border border-border-light rounded-card shadow-card hover:border-primary-border hover:shadow-md transition-all">
        <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <Tooltip label={m.is_pinned ? 'Unpin' : 'Pin to top'}>
            <button onClick={() => togglePin(m)} aria-label="Pin"
              className={`w-7 h-7 flex items-center justify-center rounded-[6px] hover:bg-surface-control ${m.is_pinned ? 'text-warning' : 'text-text-muted hover:text-text-primary'}`}>
              <Star size={15} fill={m.is_pinned ? 'var(--warning)' : 'none'} />
            </button>
          </Tooltip>
          {canCreate && (
            <Tooltip label="Add a sub-map here">
              <button onClick={() => setCreateParent(m.id)} aria-label="Add sub-map"
                className="w-7 h-7 flex items-center justify-center rounded-[6px] text-text-muted hover:text-primary-text hover:bg-surface-control"><FolderPlus size={15} /></button>
            </Tooltip>
          )}
        </div>
        {/* Header — icon + name open the map; the meta row keeps a fixed shape so every
            card is the SAME height whether or not it has sub-maps. */}
        <div className="p-4 flex items-start gap-3">
          <button onClick={() => router.push(`/dashboard/process-hierarchy/${m.id}`)} aria-label={`Open ${m.name}`}
            className="shrink-0 w-10 h-10 rounded-lg bg-primary-subtle flex items-center justify-center hover:bg-primary-subtle transition-colors"><Workflow size={20} className="text-primary-text" /></button>
          <div className="min-w-0 flex-1 pr-8">
            <Tooltip label={m.name}>
              <button onClick={() => router.push(`/dashboard/process-hierarchy/${m.id}`)} className="block w-full text-left">
                <span className="block text-[15px] font-medium text-text-primary truncate">{m.name}</span>
              </button>
            </Tooltip>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {m.node_count > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary">
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-medium tabular-nums">{m.node_count}</span>
                  step{m.node_count !== 1 ? 's' : ''}
                </span>
              )}
              {m.is_owner && <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-surface-control text-text-secondary">Owner</span>}
              {kids.length > 0 && (
                <button onClick={() => toggle(m.id)}
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary-text hover:bg-primary-subtle rounded-full px-1.5 py-0.5 transition-colors">
                  <ChevronRight size={12} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  {kids.length} inside
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Expanded sub-maps grow only this card (grid uses items-start, so peers stay put). */}
        {isOpen && kids.length > 0 && (
          <div className="mx-4 pb-3 pt-2 space-y-0.5 border-t border-border-light">{kids.map((k) => renderRow(k, 0))}</div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Sticky header (title + primary actions stay pinned while the list scrolls) */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-surface-sunken/95 backdrop-blur border-b border-border-light pb-4 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium text-text-primary leading-tight">Process Hierarchy</h1>
            <p className="mt-1 text-[15px] text-text-secondary">
              Explore how the company does things — drill into any area to see the process flow beneath it.
            </p>
          </div>
          {canCreate && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowTemplates(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-primary-text bg-white border-2 border-primary hover:bg-primary-subtle transition-colors"
              >
                <Layers size={16} /> From template
              </button>
              <button
                onClick={() => setCreateParent(null)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover transition-colors"
              >
                <Plus size={16} /> New Map
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="pt-6">
        {maps.length === 0 ? (
          <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-control flex items-center justify-center mb-4">
              <Workflow size={28} className="text-text-muted" />
            </div>
            <h2 className="text-lg font-medium text-text-primary">No process maps yet</h2>
            <p className="text-text-secondary text-sm mt-1 max-w-sm">
              {canCreate
                ? 'Create your first map to start documenting how your teams work.'
                : 'Maps shared with you will appear here once they are created.'}
            </p>
            {canCreate && (
              <button
                onClick={() => setCreateParent(null)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                <Plus size={15} /> New Map
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search maps…"
                className="w-full pl-8 pr-8 py-2.5 text-[15px] rounded-lg border border-border bg-white focus:border-primary focus:outline-hidden text-text-primary placeholder:text-text-muted" />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"><X size={15} /></button>
              )}
            </div>

            {results ? (
              results.length === 0 ? (
                <p className="text-[13px] text-text-muted text-center py-8">No maps match “{query}”.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-start">
                  {results.map((m) => (
                    <button key={m.id} onClick={() => router.push(`/dashboard/process-hierarchy/${m.id}`)}
                      className="text-left bg-surface border border-border-light rounded-card shadow-card hover:border-primary-border hover:shadow-md transition-all p-3.5 flex items-start gap-2.5">
                      <span className="shrink-0 w-9 h-9 rounded-[9px] bg-primary-subtle flex items-center justify-center"><Workflow size={17} className="text-primary-text" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-text-primary">{m.name}</span>
                        {pathOf(m).length > 0
                          ? <span className="block truncate text-[11px] text-text-muted mt-0.5">{pathOf(m).join(' › ')}</span>
                          : <span className="block text-[11px] text-text-muted mt-0.5">Top-level map</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <>
                {/* Pinned = quick-jump shortcuts, not a group — shown as chips. */}
                {pinned.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide mb-1.5">Pinned</p>
                    <div className="flex flex-wrap gap-2">
                      {pinned.map((m) => (
                        <button key={m.id} onClick={() => router.push(`/dashboard/process-hierarchy/${m.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-border-light hover:border-primary text-[13px] font-medium text-text-primary transition-colors">
                          <Star size={12} className="text-warning" fill="var(--warning)" /> <span className="truncate max-w-[160px]">{m.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Each top-level map is its OWN card, laid out in a grid that fills the
                    width; anything nested inside it lives in that card (expandable). */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
                  {roots.map((m) => renderCard(m))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {createParent !== undefined && (
        <CreateMapModal
          orgId={orgId}
          parentId={createParent}
          onClose={() => setCreateParent(undefined)}
          onCreated={(id) => router.push(`/dashboard/process-hierarchy/${id}`)}
        />
      )}

      {showTemplates && (
        <TemplatePickerModal
          orgId={orgId}
          onClose={() => setShowTemplates(false)}
          onInstantiated={(id) => router.push(`/dashboard/process-hierarchy/${id}`)}
        />
      )}
    </div>
  )
}

function TemplatePickerModal({ orgId, onClose, onInstantiated }: {
  orgId: string; onClose: () => void; onInstantiated: (id: string) => void
}) {
  const { addToast } = useToast()
  const [templates, setTemplates] = useState<ProcessTemplateSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [naming, setNaming] = useState<ProcessTemplateSummary | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ProcessTemplateSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  useEscape(onClose)

  const reload = () => processHierarchyApi.listTemplates(orgId).then(setTemplates).catch(() => setTemplates([]))
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId])

  async function instantiate(t: ProcessTemplateSummary, name: string) {
    setBusy(t.id)
    try {
      const map = await processHierarchyApi.instantiateTemplate(orgId, t.id, name.trim())
      onInstantiated(map.id)
    } catch {
      addToast('Could not create a map from that template. Please try again.', 'error')
    } finally { setBusy(null) }
  }
  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await processHierarchyApi.deleteTemplate(orgId, confirmDelete.id)
      setConfirmDelete(null)
      reload()
    } catch {
      addToast('Could not delete the template. Please try again.', 'error')
    } finally { setDeleting(false) }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-card shadow-xl w-full max-w-md max-h-[80vh] flex flex-col animate-[fadeIn_.15s_ease-out]">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-border-light">
            <Layers size={16} className="text-primary-text" />
            <h3 className="text-base font-medium text-text-primary">Create from template</h3>
            <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {templates === null ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-text" /></div>
            ) : templates.length === 0 ? (
              <p className="text-[13px] text-text-muted text-center py-8">No templates yet. Open a map and use “Save as template”.</p>
            ) : (
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 border border-border-light rounded-lg px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-text-primary truncate">{t.name}</p>
                      {t.description && <p className="text-[12px] text-text-secondary truncate">{t.description}</p>}
                    </div>
                    <button onClick={() => setNaming(t)} disabled={busy === t.id}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted">
                      {busy === t.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Use
                    </button>
                    <Tooltip label="Delete template">
                      <button onClick={() => setConfirmDelete(t)} aria-label="Delete template"
                        className="shrink-0 text-text-muted hover:text-danger"><Trash2 size={15} /></button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {naming && (
        <NameModal
          title="Name the new map"
          label="Map name"
          initial={naming.name.replace(/ template$/i, '')}
          confirmLabel="Create map"
          busy={busy === naming.id}
          onCancel={() => setNaming(null)}
          onSubmit={(name) => { const t = naming; setNaming(null); instantiate(t, name) }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        danger
        title="Delete template?"
        message={confirmDelete ? `“${confirmDelete.name}” will be removed. Maps already created from it are unaffected.` : ''}
        confirmLabel="Delete template"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => { if (!deleting) setConfirmDelete(null) }}
      />
    </>,
    document.body,
  )
}

/** Styled replacement for window.prompt — a portaled, on-brand single-field name dialog. */
function NameModal({ title, label, initial, confirmLabel, busy, onCancel, onSubmit }: {
  title: string; label: string; initial: string; confirmLabel: string; busy?: boolean
  onCancel: () => void; onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  useEscape(onCancel)
  const submit = () => { if (name.trim() && !busy) onSubmit(name.trim()) }
  return createPortal(
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-card shadow-xl w-full max-w-md p-6 animate-[fadeIn_.15s_ease-out]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-text-primary">{title}</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text-primary transition-colors"><X size={18} /></button>
        </div>
        <label className="block text-sm font-medium text-text-secondary mb-1">{label}</label>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full px-3 py-2.5 text-[15px] rounded-lg border border-border focus:border-primary focus:outline-hidden bg-white text-text-primary"
        />
        <div className="flex justify-end mt-6">
          <button onClick={submit} disabled={!name.trim() || busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors">
            {busy && <Loader2 size={15} className="animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CreateMapModal({ orgId, parentId, onClose, onCreated }: { orgId: string; parentId?: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  useEscape(onClose)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const map = await processHierarchyApi.createMap(orgId, { name: name.trim(), description: description.trim() || undefined, parent_map_id: parentId ?? null })
      onCreated(map.id)
    } catch {
      addToast('Could not create the map. Please try again.', 'error')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-card shadow-xl w-full max-w-md p-6 animate-[fadeIn_.15s_ease-out]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-text-primary">{parentId ? 'New sub-map' : 'New process map'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. How Sales Works"
              className="w-full px-3 py-2.5 text-[15px] rounded-lg border border-border focus:border-primary focus:outline-hidden bg-white text-text-primary placeholder:text-text-muted"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description <span className="text-text-muted font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this map cover?"
              className="w-full px-3 py-2.5 text-[15px] rounded-lg border border-border focus:border-primary focus:outline-hidden bg-white text-text-primary placeholder:text-text-muted resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <button
            onClick={submit}
            disabled={!name.trim() || saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
          >
            {saving && <Loader2 size={15} className="animate-spin" />} Create Map
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
