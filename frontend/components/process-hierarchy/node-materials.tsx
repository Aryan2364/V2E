'use client'

import { useEffect, useRef, useState } from 'react'
import {
  FileText, Link2, StickyNote, Plus, Pencil, Trash2, Download, ExternalLink, X, Loader2, Upload,
} from 'lucide-react'
import {
  processHierarchyApi,
  type NodeArtifactLink,
  type ProcessArtifact,
  type ProcessArtifactContentType,
  type ProcessArtifactDirection,
} from '@/lib/api/process-hierarchy'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth/context'
import MaterialViewer from '@/components/learning/MaterialViewer'
import type { MaterialViewData, PreviewKind } from '@/lib/types/learning'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'

const TITLE_MAX = 50

// ─── Preview-kind resolver (mirrors the Learning module's mapping) ───────────
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
const VID = ['mp4', 'webm', 'mov', 'm4v']
const AUD = ['mp3', 'wav', 'ogg', 'm4a']
function extOf(name?: string | null) { return (name?.split('.').pop() ?? '').toLowerCase() }
function resolvePreviewKind(fileName?: string | null, mime?: string | null): PreviewKind {
  const e = extOf(fileName)
  const m = (mime ?? '').toLowerCase()
  if (e === 'pdf' || m.includes('pdf')) return 'pdf'
  if (IMG.includes(e) || m.startsWith('image/')) return 'image'
  if (VID.includes(e) || m.startsWith('video/')) return 'video'
  if (AUD.includes(e) || m.startsWith('audio/')) return 'audio'
  if (e === 'docx') return 'docx'
  if (e === 'xlsx' || e === 'xls') return 'xlsx'
  if (e === 'csv') return 'csv'
  if (e === 'txt') return 'text'
  return 'none'
}

function MaterialIcon({ type }: { type: ProcessArtifactContentType }) {
  const I = type === 'link' ? Link2 : type === 'article' ? StickyNote : FileText
  return <I size={13} className="text-primary-text shrink-0" />
}

// ─── Top-level component used by the drawer's Documents section ──────────────
export default function NodeDocuments({
  orgId, mapId, nodeId, inputs, outputs, canEdit, onChanged, onArtifactsChanged,
}: {
  orgId: string; mapId: string; nodeId: string
  inputs: NodeArtifactLink[]; outputs: NodeArtifactLink[]
  canEdit: boolean; onChanged: () => void; onArtifactsChanged?: () => void
}) {
  const { addToast } = useToast()
  const [toDelete, setToDelete] = useState<{ linkId: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [articleEditor, setArticleEditor] = useState<{ direction: ProcessArtifactDirection; artifact?: ProcessArtifact } | null>(null)
  const [preview, setPreview] = useState<ProcessArtifact | null>(null)

  const linkToNode = (artifactId: string, direction: ProcessArtifactDirection) =>
    processHierarchyApi.linkArtifact(orgId, mapId, nodeId, { artifact_id: artifactId, direction })

  async function uploadFile(direction: ProcessArtifactDirection, file: File, allowDownload: boolean) {
    const form = new FormData()
    form.append('file', file)
    form.append('name', file.name.slice(0, TITLE_MAX))
    form.append('allow_download', allowDownload ? 'true' : 'false')
    try {
      const created = await processHierarchyApi.uploadArtifact(orgId, mapId, form)
      onArtifactsChanged?.()
      await linkToNode(created.id, direction)
      onChanged()
    } catch { addToast('Upload failed. Please try again.', 'error') }
  }
  async function addLink(direction: ProcessArtifactDirection, name: string, url: string) {
    try {
      const created = await processHierarchyApi.createMaterial(orgId, mapId, { name, url })
      await linkToNode(created.id, direction)
      onChanged()
    } catch (e: any) { addToast(e?.response?.data?.message ?? 'Could not add the link.', 'error') }
  }
  async function editLink(artifact: ProcessArtifact, name: string, url: string) {
    try { await processHierarchyApi.updateArtifact(orgId, mapId, artifact.id, { name, url }); onChanged() }
    catch (e: any) { addToast(e?.response?.data?.message ?? 'Could not update the link.', 'error') }
  }
  async function saveArticle(direction: ProcessArtifactDirection, name: string, body: string, existing?: ProcessArtifact) {
    try {
      if (existing) await processHierarchyApi.updateArtifact(orgId, mapId, existing.id, { name, content_body: body })
      else { const created = await processHierarchyApi.createMaterial(orgId, mapId, { name, content_body: body }); await linkToNode(created.id, direction) }
      setArticleEditor(null); onChanged()
    } catch { addToast('Could not save the article.', 'error') }
  }
  async function download(a: ProcessArtifact) {
    try { const { url } = await processHierarchyApi.downloadArtifact(orgId, mapId, a.id); window.open(url, '_blank', 'noopener') }
    catch { addToast('Could not download this file.', 'error') }
  }
  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try { await processHierarchyApi.unlinkArtifact(orgId, mapId, nodeId, toDelete.linkId); setToDelete(null); onChanged() }
    catch { addToast('Could not remove the document.', 'error') }
    finally { setDeleting(false) }
  }
  function open(a: ProcessArtifact) {
    if (a.content_type === 'link' && a.url) { window.open(a.url, '_blank', 'noopener'); return }
    setPreview(a)
  }

  return (
    <div className="space-y-4">
      <DirectionSection direction="input" title="Inputs (needed)" links={inputs} canEdit={canEdit}
        onUploadFile={uploadFile} onAddLink={addLink} onEditLink={editLink}
        onNewArticle={() => setArticleEditor({ direction: 'input' })}
        onEditArticle={(a) => setArticleEditor({ direction: 'input', artifact: a })}
        onOpen={open} onDownload={download} onDelete={(l) => setToDelete({ linkId: l.id, name: l.artifact.name })} />
      <DirectionSection direction="output" title="Outputs (produced)" links={outputs} canEdit={canEdit}
        onUploadFile={uploadFile} onAddLink={addLink} onEditLink={editLink}
        onNewArticle={() => setArticleEditor({ direction: 'output' })}
        onEditArticle={(a) => setArticleEditor({ direction: 'output', artifact: a })}
        onOpen={open} onDownload={download} onDelete={(l) => setToDelete({ linkId: l.id, name: l.artifact.name })} />

      {articleEditor && (
        <ArticleEditorModal initial={articleEditor.artifact ?? null}
          onCancel={() => setArticleEditor(null)}
          onSave={(name, body) => saveArticle(articleEditor.direction, name, body, articleEditor.artifact)} />
      )}
      {preview && <MaterialPreviewModal orgId={orgId} mapId={mapId} artifact={preview} onClose={() => setPreview(null)} onDownload={download} />}

      <ConfirmDialog open={!!toDelete} danger title="Remove this document?"
        message={toDelete ? `This removes “${toDelete.name}” from this step. The file stays in the map library.` : ''}
        confirmLabel="Remove" loading={deleting} onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setToDelete(null) }} />
    </div>
  )
}

// ─── One direction (Inputs / Outputs): list + add-flow ───────────────────────
function DirectionSection({
  direction, title, links, canEdit,
  onUploadFile, onAddLink, onEditLink, onNewArticle, onEditArticle, onOpen, onDownload, onDelete,
}: {
  direction: ProcessArtifactDirection; title: string; links: NodeArtifactLink[]; canEdit: boolean
  onUploadFile: (d: ProcessArtifactDirection, f: File, allowDownload: boolean) => void
  onAddLink: (d: ProcessArtifactDirection, name: string, url: string) => void
  onEditLink: (a: ProcessArtifact, name: string, url: string) => void
  onNewArticle: () => void
  onEditArticle: (a: ProcessArtifact) => void
  onOpen: (a: ProcessArtifact) => void
  onDownload: (a: ProcessArtifact) => void
  onDelete: (l: NodeArtifactLink) => void
}) {
  const [mode, setMode] = useState<'closed' | 'chooser' | 'file' | 'link'>('closed')
  const [editing, setEditing] = useState<ProcessArtifact | null>(null)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [allowDownload, setAllowDownload] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => { setMode('closed'); setEditing(null); setLinkTitle(''); setLinkUrl(''); setAllowDownload(true) }
  const startEditLink = (a: ProcessArtifact) => { setEditing(a); setLinkTitle(a.name); setLinkUrl(a.url ?? ''); setMode('link') }
  const submitLink = () => {
    if (!linkTitle.trim() || !linkUrl.trim()) return
    // Accept a bare "example.com" — the backend requires a protocol.
    const url = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`
    if (editing) onEditLink(editing, linkTitle.trim(), url)
    else onAddLink(direction, linkTitle.trim(), url)
    reset()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-meta font-medium text-text-secondary">{title}</p>
        {canEdit && mode === 'closed' && (
          <Tooltip label="Add">
            <Button variant="secondary" size="icon-sm" onClick={() => setMode('chooser')} aria-label={`Add ${direction}`}>
              <Plus size={14} />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* Chooser: File / Link / Article */}
      {mode === 'chooser' && (
        <div className="mb-2 flex items-center gap-1.5 rounded-[8px] bg-surface-sunken border border-border-light p-1.5">
          <input ref={fileRef} type="file" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUploadFile(direction, f, allowDownload); reset() } e.target.value = '' }} />
          <ChooserBtn icon={<FileText size={13} />} label="File" onClick={() => setMode('file')} />
          <ChooserBtn icon={<Link2 size={13} />} label="Link" onClick={() => { setEditing(null); setLinkTitle(''); setLinkUrl(''); setMode('link') }} />
          <ChooserBtn icon={<StickyNote size={13} />} label="Article" onClick={() => { reset(); onNewArticle() }} />
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={reset} aria-label="Cancel"><X size={14} /></Button>
        </div>
      )}

      {/* File: pick download/view-only, then choose the file */}
      {mode === 'file' && (
        <div className="mb-2 rounded-[8px] bg-surface-sunken border border-border-light p-2.5 space-y-2">
          <div className="inline-flex rounded-[8px] border border-border-light overflow-hidden bg-surface">
            {[{ v: true, l: 'Download' }, { v: false, l: 'View-only' }].map(({ v, l }) => (
              <button key={l} type="button" onClick={() => setAllowDownload(v)}
                className={`px-2.5 py-1.5 text-meta font-medium transition-colors ${allowDownload === v ? 'bg-primary text-primary-foreground' : 'bg-surface text-text-secondary hover:bg-surface-control'}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={reset}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Choose file
            </Button>
          </div>
        </div>
      )}

      {/* Link: title + url */}
      {mode === 'link' && (
        <div className="mb-2 rounded-[8px] bg-surface-sunken border border-border-light p-2.5 space-y-2">
          <Input autoFocus value={linkTitle} maxLength={TITLE_MAX} onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Title" aria-label="Title" />
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitLink()}
            placeholder="https://…" aria-label="Link address" />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={reset}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submitLink} disabled={!linkTitle.trim() || !linkUrl.trim()}>
              {editing ? 'Save' : 'Add link'}
            </Button>
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-meta text-text-muted">None</p>
      ) : (
        <div className="space-y-1">
          {links.map((l) => (
            <MaterialRow key={l.id} link={l} canEdit={canEdit}
              onOpen={() => onOpen(l.artifact)} onDownload={() => onDownload(l.artifact)}
              onEdit={() => (l.artifact.content_type === 'article' ? onEditArticle(l.artifact) : startEditLink(l.artifact))}
              onDelete={() => onDelete(l)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChooserBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      {icon} {label}
    </Button>
  )
}

function MaterialRow({ link, canEdit, onOpen, onDownload, onEdit, onDelete }: {
  link: NodeArtifactLink; canEdit: boolean
  onOpen: () => void; onDownload: () => void; onEdit: () => void; onDelete: () => void
}) {
  const a = link.artifact
  const editable = a.content_type === 'link' || a.content_type === 'article'
  return (
    <div className="flex items-center gap-2 text-meta bg-surface-sunken border border-border-light rounded-[6px] px-2 py-1.5">
      <MaterialIcon type={a.content_type} />
      <Tooltip label={a.name}><button type="button" onClick={onOpen} className="flex-1 min-w-0 truncate rounded-xs text-left text-text-primary hover:text-primary-text focus-visible:outline-2 focus-visible:outline-primary-ring">{a.name}</button></Tooltip>
      {a.content_type === 'link' && <ExternalLink size={12} className="text-text-muted shrink-0" />}
      {a.content_type === 'file' && a.allow_download && (
        <Tooltip label="Download"><Button variant="ghost" size="icon-sm" onClick={onDownload} aria-label="Download"><Download size={13} /></Button></Tooltip>
      )}
      {canEdit && editable && (
        <Tooltip label="Edit"><Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit"><Pencil size={12} /></Button></Tooltip>
      )}
      {canEdit && (
        <Tooltip label="Remove"><Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Remove"><Trash2 size={13} /></Button></Tooltip>
      )}
    </div>
  )
}

// ─── Article write / edit dialog ─────────────────────────────────────────────
function ArticleEditorModal({ initial, onSave, onCancel }: {
  initial: ProcessArtifact | null; onSave: (name: string, body: string) => void | Promise<void>; onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [body, setBody] = useState(initial?.content_body ?? '')
  const [busy, setBusy] = useState(false)
  const save = () => {
    if (!name.trim() || !body.trim() || busy) return
    setBusy(true)
    Promise.resolve(onSave(name.trim(), body)).finally(() => setBusy(false))
  }
  return (
    <Dialog
      open
      onOpenChange={(next, details) => {
        if (next) return
        if (busy) { details.cancel(); return }
        onCancel()
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit article' : 'Write an article'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center justify-between mb-1">
            <Label>Title</Label>
            <span className="text-meta text-text-muted tabular-nums">{name.length}/{TITLE_MAX}</span>
          </div>
          <Input autoFocus value={name} maxLength={TITLE_MAX} onChange={(e) => setName(e.target.value)} className="mb-3" />
          <Label className="mb-2">Content</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10}
            placeholder="Write the article…" className="resize-none" />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !body.trim()} loading={busy} loadingLabel="Saving">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Preview popup (file via MaterialViewer, article as text) ────────────────
export function MaterialPreviewModal({ orgId, mapId, artifact, onClose, onDownload }: {
  orgId: string; mapId: string; artifact: ProcessArtifact; onClose: () => void; onDownload: (a: ProcessArtifact) => void
}) {
  const { user } = useAuth()
  const isFile = artifact.content_type === 'file'
  const [view, setView] = useState<{ url: string } | null>(null)
  const [loading, setLoading] = useState(isFile)

  useEffect(() => {
    if (!isFile) return
    processHierarchyApi.viewArtifact(orgId, mapId, artifact.id)
      .then((r) => setView({ url: r.url })).catch(() => setView(null)).finally(() => setLoading(false))
  }, [orgId, mapId, artifact.id, isFile])

  const kind = resolvePreviewKind(artifact.file_name, artifact.mime_type)
  const viewOnly = isFile && !artifact.allow_download
  const data: MaterialViewData = { kind, url: view?.url ?? null, allow_download: artifact.allow_download, file_name: artifact.file_name }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-2">
            <MaterialIcon type={artifact.content_type} />
            <DialogTitle className="truncate">{artifact.name}</DialogTitle>
          </div>
        </DialogHeader>
        <DialogBody>
          {artifact.content_type === 'article' ? (
            <div className="whitespace-pre-wrap text-meta leading-relaxed text-text-primary">{artifact.content_body}</div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={22} className="animate-spin text-primary-text" /></div>
          ) : (
            <MaterialViewer
              data={data}
              viewOnly={viewOnly}
              watermark={viewOnly ? `${user?.name ?? ''} · ${user?.email ?? ''}` : undefined}
              onDownload={artifact.allow_download ? () => onDownload(artifact) : undefined}
              pdfLoader={() => processHierarchyApi.viewArtifactBytes(orgId, mapId, artifact.id)}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
