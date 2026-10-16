'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Upload, Trash2, Download, FileText, Loader2, Paperclip } from 'lucide-react'
import { processHierarchyApi, type ProcessArtifact, type ProcessArtifactType } from '@/lib/api/process-hierarchy'
import StyledSelect from '@/components/ui/StyledSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/Toast'

const TYPES: ProcessArtifactType[] = ['document', 'form', 'report', 'data', 'other']
const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))

export default function ArtifactLibrary({ orgId, mapId, canEdit, onClose }: {
  orgId: string; mapId: string; canEdit: boolean; onClose: () => void
}) {
  const { addToast } = useToast()
  const [artifacts, setArtifacts] = useState<ProcessArtifact[] | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProcessArtifactType>('document')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<ProcessArtifact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => processHierarchyApi.listArtifacts(orgId, mapId).then(setArtifacts).catch(() => setArtifacts([]))
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId, mapId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    try { await processHierarchyApi.createArtifact(orgId, mapId, { name: name.trim(), artifact_type: type }); setName(''); reload() }
    catch { addToast('Could not add the document. Please try again.', 'error') }
    finally { setBusy(false) }
  }
  async function upload(file: File) {
    setBusy(true)
    try { const form = new FormData(); form.append('file', file); form.append('name', file.name); form.append('artifact_type', type); await processHierarchyApi.uploadArtifact(orgId, mapId, form); reload() }
    catch { addToast('Upload failed. Check the file and try again.', 'error') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!confirmDel) return
    setDeleting(true)
    try { await processHierarchyApi.deleteArtifact(orgId, mapId, confirmDel.id); setConfirmDel(null); reload() }
    catch { addToast('Could not delete the document. Please try again.', 'error') }
    finally { setDeleting(false) }
  }
  async function download(id: string) {
    try { const { url } = await processHierarchyApi.downloadArtifact(orgId, mapId, id); window.open(url, '_blank') }
    catch { addToast('Could not open the file. Please try again.', 'error') }
  }

  const body = (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-[12px] shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col animate-[fadeIn_.15s_ease-out]">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-border-light">
          <Paperclip size={16} className="text-primary-text" />
          <h3 className="text-base font-medium text-text-primary">Document library</h3>
          <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        {canEdit && (
          <div className="px-4 py-3 border-b border-border-light space-y-2 bg-surface-sunken">
            <div className="flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name…"
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="flex-1 px-3 py-2 text-[14px] rounded-[8px] border border-border focus:border-primary focus:outline-hidden bg-white" />
              <StyledSelect
                value={type}
                onChange={(v) => setType(v as ProcessArtifactType)}
                options={TYPE_OPTIONS}
                wrapperClassName="w-32 shrink-0"
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={create} disabled={!name.trim() || busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[8px] bg-primary text-white hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted">
                <Plus size={14} /> Add (metadata)
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[8px] border border-primary text-primary-text hover:bg-primary-subtle">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload file
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {artifacts === null ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-text" /></div>
          ) : artifacts.length === 0 ? (
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mb-3">
                <FileText size={22} className="text-text-muted" />
              </div>
              <p className="text-[14px] font-medium text-text-primary">No documents yet</p>
              <p className="text-[13px] text-text-secondary mt-1 max-w-xs">
                {canEdit ? 'Add a document by name, or upload a file, to attach it to steps as an input or output.' : 'Documents added to this map will appear here.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {artifacts.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 border border-border-light rounded-[8px] px-3 py-2">
                  <FileText size={15} className="text-primary-text shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-text-primary truncate">{a.name}</p>
                    <p className="text-[12px] text-text-muted capitalize">{a.artifact_type}{a.storage_key ? ' · file attached' : ' · reference only'}</p>
                  </div>
                  {a.storage_key && (
                    <Tooltip label="Download">
                      <button onClick={() => download(a.id)} aria-label="Download" className="text-text-secondary hover:text-primary-text shrink-0"><Download size={15} /></button>
                    </Tooltip>
                  )}
                  {canEdit && (
                    <Tooltip label="Delete document">
                      <button onClick={() => setConfirmDel(a)} aria-label="Delete document" className="text-text-muted hover:text-danger shrink-0"><Trash2 size={15} /></button>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        danger
        title="Delete document?"
        message={confirmDel ? `“${confirmDel.name}” will be removed from every step that uses it. This cannot be undone.` : ''}
        confirmLabel="Delete document"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => { if (!deleting) setConfirmDel(null) }}
      />
    </div>
  )
  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
