'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Upload, Trash2, Download, FileText, Loader2, Paperclip } from 'lucide-react'
import { processHierarchyApi, type ProcessArtifact, type ProcessArtifactType } from '@/lib/api/process-hierarchy'
import StyledSelect from '@/components/ui/StyledSelect'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Tooltip from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog'

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

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Paperclip size={16} />
            <DialogTitle>Document library</DialogTitle>
          </div>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 p-0">
        {canEdit && (
          <div className="px-4 py-3 border-b border-border-light space-y-2 bg-surface-sunken">
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name…" aria-label="Document name"
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="flex-1" />
              <StyledSelect
                value={type}
                onChange={(v) => setType(v as ProcessArtifactType)}
                options={TYPE_OPTIONS}
                wrapperClassName="w-32 shrink-0"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={create} disabled={!name.trim() || busy}>
                <Plus size={14} /> Add (metadata)
              </Button>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload file
              </Button>
            </div>
          </div>
        )}

        <div className="px-4 py-3">
          {artifacts === null ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-text" /></div>
          ) : artifacts.length === 0 ? (
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mb-3">
                <FileText size={22} className="text-text-muted" />
              </div>
              <p className="text-meta font-medium text-text-primary">No documents yet</p>
              <p className="text-meta text-text-secondary mt-1 max-w-xs">
                {canEdit ? 'Add a document by name, or upload a file, to attach it to steps as an input or output.' : 'Documents added to this map will appear here.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {artifacts.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 border border-border-light rounded-[8px] px-3 py-2">
                  <FileText size={15} className="text-primary-text shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-meta text-text-primary truncate">{a.name}</p>
                    <p className="text-meta text-text-muted capitalize">{a.artifact_type}{a.storage_key ? ' · file attached' : ' · reference only'}</p>
                  </div>
                  {a.storage_key && (
                    <Tooltip label="Download">
                      <Button variant="ghost" size="icon-sm" onClick={() => download(a.id)} aria-label="Download"><Download size={15} /></Button>
                    </Tooltip>
                  )}
                  {canEdit && (
                    <Tooltip label="Delete document">
                      <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDel(a)} aria-label="Delete document"><Trash2 size={15} /></Button>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
