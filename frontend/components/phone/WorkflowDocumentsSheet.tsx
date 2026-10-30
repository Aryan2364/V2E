'use client'

import React from 'react'
import { Download, ExternalLink, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { tasksApi } from '@/lib/api/tasks'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import { formatBytes, validateFile } from '@/lib/attachments'
import { fmtDateTime } from '@/lib/phone-format'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { taskHref } from '@/lib/phone-routes'
import type { RunDocuments, RunFile, RunStepFile } from '@/lib/types/workflows'
import { REASONS } from '@/components/workflows/shared'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton } from './primitives'

/*
 * Every file of a run in one place - the phone twin of the computer's
 * RunDocumentsDrawer (components/workflows/RunDocumentsDrawer.tsx): the files
 * added to the run itself (anyone involved can add; the uploader or an editor
 * can remove) and, grouped by step, each step's attachments, discussion files
 * and the proof the viewer may see, each group linking to its task. Same
 * calls: getDocuments, uploadRunFile, deleteRunFile, downloadRunFile,
 * tasksApi.downloadProof / downloadAttachment.
 */
export function WorkflowDocumentsSheet({
  orgId,
  templateId,
  instanceId,
  open,
  onClose,
  canUpload,
  canManage,
  onCountChange,
}: {
  orgId: string
  templateId: string
  instanceId: string
  open: boolean
  onClose: () => void
  /** Tri-state: undefined = not known yet (disabled, no reason shown). */
  canUpload: boolean | undefined
  /** May remove anyone's run files (people who can change the workflow). */
  canManage: boolean
  onCountChange?: (n: number) => void
}) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [docs, setDocs] = React.useState<RunDocuments | null>(null)
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [uploading, setUploading] = React.useState<string[]>([])
  const [removeTarget, setRemoveTarget] = React.useState<RunFile | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(async () => {
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      const d = await workflowsApi.getDocuments(orgId, templateId, instanceId)
      const clean: RunDocuments = { step_files: Array.isArray(d?.step_files) ? d.step_files : [], run_files: Array.isArray(d?.run_files) ? d.run_files : [] }
      setDocs(clean)
      setStatus('ready')
      onCountChange?.(clean.run_files.length + clean.step_files.reduce((n, g) => n + g.files.length, 0))
    } catch {
      setStatus('failed')
    }
  }, [orgId, templateId, instanceId, onCountChange])

  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [open, load])

  async function upload(file: File) {
    const problem = validateFile(file)
    if (problem) {
      addToast(problem, 'error')
      return
    }
    setUploading((u) => [...u, file.name])
    try {
      await workflowsApi.uploadRunFile(orgId, templateId, instanceId, await shrinkImageForUpload(file))
      addToast(`${file.name} added`, 'success')
      void load()
    } catch (e) {
      addToast(workflowErrorMessage(e, `${file.name} did not upload. Try again.`), 'error')
    } finally {
      setUploading((u) => u.filter((n) => n !== file.name))
    }
  }

  async function open_(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be opened. Try again.'), 'error')
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await workflowsApi.deleteRunFile(orgId, templateId, instanceId, removeTarget.id)
      addToast(`${removeTarget.file_name} removed`, 'success')
      setRemoveTarget(null)
      void load()
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be removed. Try again.'), 'error')
    } finally {
      setRemoving(false)
    }
  }

  const stepGroups = (docs?.step_files ?? []).filter((g) => g.files.length > 0)

  return (
    <>
      <PhoneSheet open={open && !removeTarget} onOpenChange={(o) => !o && onClose()} title="Instance documents" fullHeight>
        {status === 'idle' || status === 'loading' ? (
          <div className="flex flex-col gap-[8px]" aria-busy>
            <span className="h-[56px] rounded-[8px] bg-surface-control" />
            <span className="h-[56px] rounded-[8px] bg-surface-control" />
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-start gap-[8px]">
            <p className="text-body text-text-secondary">The documents could not be loaded. Check your connection, then try again.</p>
            <PhoneButton variant="secondary" onClick={() => void load()}>
              Try again
            </PhoneButton>
          </div>
        ) : (
          <div className="flex flex-col gap-[20px]">
            <section className="flex flex-col gap-[8px]">
              <h3 className="text-label font-medium text-text-secondary">Instance files</h3>
              <p className="text-meta text-text-secondary">Shared with everyone in this instance.</p>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  Array.from(e.target.files ?? []).forEach((f) => void upload(f))
                  e.target.value = ''
                }}
              />
              {canUpload !== undefined ? (
                <PermissionTooltip allowed={canUpload} reason={REASONS.upload}>
                  <PhoneButton variant="secondary" fullWidth disabled={canUpload !== true} onClick={() => fileRef.current?.click()}>
                    <Paperclip aria-hidden /> Add a file
                  </PhoneButton>
                </PermissionTooltip>
              ) : null}
              <ul className="flex flex-col gap-[8px]">
                {uploading.map((n) => (
                  <li key={n} className="flex min-h-[48px] items-center gap-[8px] rounded-[8px] border border-border-light bg-surface px-[12px] text-label text-text-secondary">
                    <Loader2 aria-hidden className="size-[16px] shrink-0 animate-spin" />
                    <span className="min-w-0 flex-1 truncate">Uploading {n}…</span>
                  </li>
                ))}
                {docs?.run_files.map((f) => (
                  <FileRow
                    key={f.id}
                    name={f.file_name}
                    tag={f.in_comment ? 'In the discussion' : undefined}
                    meta={`${formatBytes(f.size_bytes)}${f.uploaded_by ? ` · ${f.uploaded_by.name}` : ''} · ${fmtDateTime(f.created_at)}`}
                    onOpen={() => void open_(() => workflowsApi.downloadRunFile(orgId, templateId, instanceId, f.id))}
                    onRemove={canManage || (!!user && f.uploaded_by?.id === user.id) ? () => setRemoveTarget(f) : undefined}
                  />
                ))}
              </ul>
              {uploading.length === 0 && (docs?.run_files.length ?? 0) === 0 ? <p className="text-body text-text-secondary">No instance files yet.</p> : null}
            </section>

            <section className="flex flex-col gap-[12px]">
              <h3 className="text-label font-medium text-text-secondary">Step files</h3>
              {stepGroups.length === 0 ? (
                <p className="text-body text-text-secondary">No step files yet. Files added to step tasks appear here.</p>
              ) : (
                stepGroups.map((g) => (
                  <div key={g.row_id} className="flex flex-col gap-[8px]">
                    <div className="flex items-center justify-between gap-[8px]">
                      <h4 className="min-w-0 truncate text-body font-medium text-text-primary">{g.step_title}</h4>
                      {g.task_id ? (
                        <Link href={taskHref(g.task_id)} className="inline-flex min-h-[44px] shrink-0 items-center gap-[4px] text-label font-medium text-primary-text">
                          Open task <ExternalLink aria-hidden className="size-[13px]" />
                        </Link>
                      ) : null}
                    </div>
                    <ul className="flex flex-col gap-[8px]">
                      {g.files.map((f: RunStepFile) => (
                        <FileRow
                          key={f.id}
                          name={f.file_name}
                          tag={f.is_proof ? 'Proof' : f.in_comment ? 'In the discussion' : undefined}
                          meta={`${formatBytes(f.size_bytes)}${f.uploaded_by ? ` · ${f.uploaded_by.name}` : ''} · ${fmtDateTime(f.created_at)}`}
                          onOpen={
                            g.task_id
                              ? () => void open_(() => (f.is_proof ? tasksApi.downloadProof(orgId, g.task_id!, f.id) : tasksApi.downloadAttachment(orgId, g.task_id!, f.id)))
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </PhoneSheet>

      <PhoneSheet
        open={!!removeTarget}
        onOpenChange={(o) => !o && !removing && setRemoveTarget(null)}
        title={`Remove “${removeTarget?.file_name ?? ''}”?`}
        footer={
          <PhoneButton variant="primary" fullWidth loading={removing} className="border-danger bg-danger active:border-danger active:bg-danger" onClick={() => void confirmRemove()}>
            Remove file
          </PhoneButton>
        }
      >
        <p className="text-body text-text-secondary">It is removed for everyone. This cannot be undone.</p>
      </PhoneSheet>
    </>
  )
}

function FileRow({ name, meta, tag, onOpen, onRemove }: { name: string; meta: string; tag?: string; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-[4px] rounded-[8px] border border-border-light bg-surface pl-[12px]">
      <FileText aria-hidden className="size-[16px] shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 py-[8px] pl-[4px]">
        <span className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-body text-text-primary">{name}</span>
          {tag ? <span className="shrink-0 rounded-full border border-border px-[8px] text-meta font-medium text-text-secondary">{tag}</span> : null}
        </span>
        <span className="block truncate text-meta text-text-secondary">{meta}</span>
      </span>
      {onOpen ? (
        <button type="button" aria-label={`Open ${name}`} onClick={onOpen} className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control">
          <Download aria-hidden className="size-[18px]" />
        </button>
      ) : null}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-danger-bg">
          <Trash2 aria-hidden className="size-[18px]" />
        </button>
      ) : null}
    </li>
  )
}
