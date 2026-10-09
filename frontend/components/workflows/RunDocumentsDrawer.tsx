'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Download, ExternalLink, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import { formatBytes } from '@/lib/attachments'
import type { RunDocuments, RunFile, RunStepFile } from '@/lib/types/workflows'
import Sheet from './Sheet'
import { BTN, EmptyState, ErrorState, InfoTip, REASONS, Skeleton, fmtDateTime, taskHref } from './shared'

interface Uploading {
  key: string
  file: File
  pct: number
  error?: string
}

/**
 * Every file of a run in one place: the files of each step (attachments, files shared in
 * comments, and the proof the viewer may see), grouped by step, plus files added to the
 * run itself — which anyone involved can add, and the uploader or an editor can remove.
 */
export default function RunDocumentsDrawer({
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
  canUpload: boolean | undefined
  /** May remove anyone's run files (people who can change the workflow). */
  canManage: boolean
  onCountChange?: (n: number) => void
}) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [docs, setDocs] = useState<RunDocuments | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState<Uploading[]>([])
  const [rejects, setRejects] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<RunFile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      const d = await workflowsApi.getDocuments(orgId, templateId, instanceId)
      const clean: RunDocuments = { step_files: Array.isArray(d?.step_files) ? d.step_files : [], run_files: Array.isArray(d?.run_files) ? d.run_files : [] }
      setDocs(clean)
      setStatus('ready')
      onCountChange?.(clean.run_files.length + clean.step_files.reduce((n, g) => n + g.files.length, 0))
    } catch (e) {
      setError(workflowErrorMessage(e, 'Check your connection and try again.'))
      setStatus('failed')
    }
  }, [orgId, templateId, instanceId, onCountChange])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function upload(file: File, key = `${file.name}-${Date.now()}-${Math.random()}`) {
    setUploads((u) => [...u.filter((x) => x.key !== key), { key, file, pct: 0 }])
    try {
      await workflowsApi.uploadRunFile(orgId, templateId, instanceId, file, (pct) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct } : x))),
      )
      setUploads((u) => u.filter((x) => x.key !== key))
      addToast(`${file.name} added`, 'success')
      load()
    } catch (e) {
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: workflowErrorMessage(e, 'Upload failed.') } : x)))
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await workflowsApi.deleteRunFile(orgId, templateId, instanceId, deleteTarget.id)
      addToast(`${deleteTarget.file_name} removed`, 'success')
      setDeleteTarget(null)
      load()
    } catch (e) {
      setDeleteError(workflowErrorMessage(e, 'The file could not be removed. Try again.'))
    } finally {
      setDeleting(false)
    }
  }

  const download = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      addToast(workflowErrorMessage(e, 'The file could not be downloaded. Try again.'), 'error')
    }
  }

  const stepGroups = (docs?.step_files ?? []).filter((g) => g.files.length > 0)

  return (
    <>
      <Sheet open={open} onClose={onClose} labelId="run-docs-title" title="Documents" eyebrow="This run" wide>
        {status === 'loading' || status === 'idle' ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : status === 'failed' ? (
          <ErrorState title="Documents could not be loaded" message={error} onRetry={load} />
        ) : (
          <>
            {/* Run files */}
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="flex items-center gap-1 text-[15px] font-semibold text-[#0F172A]">
                  Run files <InfoTip label="Run files" text="Shared with everyone in this run." />
                </h3>
              </div>
              {canUpload !== undefined && (
                <PermissionTooltip allowed={canUpload} reason={REASONS.upload} className="flex w-full flex-col">
                  <FileDropzone onFiles={(files) => files.forEach((f) => upload(f))} onReject={setRejects} disabled={canUpload !== true} />
                </PermissionTooltip>
              )}
              {rejects.length > 0 && <AttachmentErrorBox errors={rejects} onDismiss={() => setRejects([])} />}
              {(uploads.length > 0 || (docs?.run_files.length ?? 0) > 0) ? (
                <ul className="flex flex-col gap-1.5">
                  {uploads.map((u) => (
                    <li key={u.key} className={`flex items-center gap-2 rounded-[8px] border px-3 py-2 ${u.error ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#E2E8F0]'}`}>
                      {u.error ? <AlertTriangle size={15} className="shrink-0 text-[#B91C1C]" /> : <Loader2 size={15} className="shrink-0 animate-spin text-[#2563EB]" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-[#0F172A] truncate">{u.file.name}</span>
                        <span className={`block text-[12px] ${u.error ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>{u.error ?? `Uploading… ${u.pct}%`}</span>
                      </span>
                      {u.error && (
                        <>
                          <button type="button" onClick={() => upload(u.file, u.key)} className={BTN.quiet}>
                            <RefreshCw size={14} /> Retry
                          </button>
                          <button type="button" aria-label={`Dismiss ${u.file.name}`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className={BTN.icon}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                  {docs?.run_files.map((f) => {
                    const mayRemove = canManage || (!!user && f.uploaded_by?.id === user.id)
                    return (
                      <FileRow
                        key={f.id}
                        name={f.file_name}
                        meta={`${formatBytes(f.size_bytes)}${f.uploaded_by ? ` · ${f.uploaded_by.name}` : ''} · ${fmtDateTime(f.created_at)}`}
                        onDownload={() => download(() => workflowsApi.downloadRunFile(orgId, templateId, instanceId, f.id))}
                        onRemove={
                          mayRemove
                            ? () => {
                                setDeleteError(null)
                                setDeleteTarget(f)
                              }
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-[#475569]">No run files yet.</p>
              )}
            </section>

            {/* Step files */}
            <section className="flex flex-col gap-3 pt-2 border-t border-[#F1F5F9]">
              <div>
                <h3 className="flex items-center gap-1 text-[15px] font-semibold text-[#0F172A]">
                  Step files <InfoTip label="Step files" text="Attachments, comment files and proof from each step’s task." />
                </h3>
              </div>
              {stepGroups.length === 0 ? (
                <EmptyState icon={FileText} title="No step files yet" text="Files added to step tasks appear here." />
              ) : (
                stepGroups.map((g) => (
                  <div key={g.row_id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-[#334155] truncate">{g.step_title}</h4>
                      {g.task_id && (
                        <Link href={taskHref(g.task_id)} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1D4ED8] hover:underline shrink-0">
                          Open task <ExternalLink size={13} />
                        </Link>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {g.files.map((f: RunStepFile) => (
                        <FileRow
                          key={f.id}
                          name={f.file_name}
                          tag={f.is_proof ? 'Proof' : f.in_comment ? 'In a comment' : undefined}
                          meta={`${formatBytes(f.size_bytes)}${f.uploaded_by ? ` · ${f.uploaded_by.name}` : ''} · ${fmtDateTime(f.created_at)}`}
                          onDownload={
                            g.task_id
                              ? () =>
                                  download(() =>
                                    f.is_proof ? tasksApi.downloadProof(orgId, g.task_id!, f.id) : tasksApi.downloadAttachment(orgId, g.task_id!, f.id),
                                  )
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </Sheet>

      {/* While the confirmation is up, Escape must not close the panel behind it. */}
      {deleteTarget && <span data-sheet-blocker="true" hidden />}
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Remove “${deleteTarget?.file_name ?? ''}”?`}
        message="It is removed for everyone. This cannot be undone."
        confirmLabel="Remove file"
        danger
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </>
  )
}

function FileRow({ name, meta, tag, onDownload, onRemove }: { name: string; meta: string; tag?: string; onDownload?: () => void; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-[8px] border border-[#E2E8F0] bg-white px-3 py-2">
      <FileText size={15} className="shrink-0 text-[#475569]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-[#0F172A] truncate">{name}</span>
          {tag && <span className="shrink-0 rounded-full border border-[#CBD5E1] px-2 py-0.5 text-[11px] font-medium text-[#334155]">{tag}</span>}
        </span>
        <span className="block text-[12px] text-[#475569] truncate">{meta}</span>
      </span>
      {onDownload && (
        <button type="button" aria-label={`Download ${name}`} onClick={onDownload} className={BTN.icon}>
          <Download size={16} />
        </button>
      )}
      {onRemove && (
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className={`${BTN.icon} hover:!text-[#B91C1C] hover:!bg-[#FEF2F2]`}>
          <Trash2 size={16} />
        </button>
      )}
    </li>
  )
}
