'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, CheckCircle2, Clock, Download, Lock, Users, Trash2 } from 'lucide-react'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import Modal from '@/components/ui/Modal'
import Tooltip from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { extensionOf, fileKindLabel, formatBytes } from '@/lib/attachments'
import type { Task, TaskAssigneeUser, TaskAttachment, ProofVisibility } from '@/lib/types/tasks'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  task: Task
  assignees: TaskAssigneeUser[]
  /** Bumped by the parent to force a proof reload (e.g. after "mark as proof" from a comment). */
  reloadToken: number
  /** Task is closed — hide the upload control. */
  locked?: boolean
  onChanged: () => void
}

/**
 * File-based proof of completion.
 * - Assigner (creator/admin): a per-person scoreboard — who has submitted, who's pending,
 *   with every file (they can see all).
 * - Assignee: just uploads their own proof and sees a flat list of the files they can see
 *   (their own + any a teammate chose to share). No per-person pending/submitted list.
 * On upload (all_must) a popup asks, PER FILE, whether it's visible to only the assigner or
 * everyone. In any_can mode one proof satisfies the task and is always shared.
 */
export default function ProofOfCompletionCard({ task, assignees, reloadToken, locked, onChanged }: Props) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [proofs, setProofs] = useState<TaskAttachment[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  // Files picked but awaiting a per-file visibility decision (all_must). queue[0] is current.
  const [queue, setQueue] = useState<File[]>([])
  const [choice, setChoice] = useState<ProofVisibility>('private')
  // Proof pending deletion — proof is evidence, so removing it is confirmed first
  // (mirrors the plain-attachment delete guard).
  const [proofToDelete, setProofToDelete] = useState<TaskAttachment | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isAllMust = task.completion_mode === 'all_must_complete'
  const isAssigner = task.created_by_user_id === user?.id || !!user?.is_admin
  const primary = assignees.filter((a) => !a.is_cc)
  const myAssignee = primary.find((a) => a.user_id === user?.id)
  const iAmAssignee = !!myAssignee
  const allowed = task.proof_allowed_extensions ?? []
  // A proof I uploaded can be removed until it's locked in: task closed, or (all_must) I've
  // already completed my own part with it. The backend enforces this too.
  const canManageMine = !locked && !(isAllMust && !!myAssignee?.is_completed)

  const load = useCallback(() => {
    if (!orgId) return
    tasksApi.listProofs(orgId, task.id).then(setProofs).catch(() => setProofs([]))
  }, [orgId, task.id])
  useEffect(() => { load() }, [load, reloadToken])

  const summary = task.proof_summary
  const submittedIds = new Set(summary?.submitted_user_ids ?? [])
  const requiredCount = summary?.required_user_ids?.length ?? primary.length
  const submittedCount = summary?.submitted_user_ids?.length ?? 0

  const proofsByUser = new Map<string, TaskAttachment[]>()
  for (const p of proofs) {
    const uid = p.uploaded_by_user_id ?? ''
    const list = proofsByUser.get(uid) ?? []
    list.push(p)
    proofsByUser.set(uid, list)
  }

  // Picked some files → validate types, then either open the per-file visibility popup
  // (all_must) or upload straight away as shared (any_can).
  function handleFiles(files: File[]) {
    setErrors([])
    if (allowed.length > 0) {
      const bad = files.filter((f) => !allowed.includes(extensionOf(f.name)))
      if (bad.length) {
        setErrors(bad.map((f) => `"${f.name}" isn't an accepted proof type.`))
        return
      }
    }
    if (isAllMust) {
      setChoice('private')
      setQueue(files)
    } else {
      void uploadAll(files, 'everyone')
    }
  }

  async function uploadAll(files: File[], visibility: ProofVisibility) {
    setUploading(true)
    try {
      for (const f of files) await tasksApi.uploadProof(orgId, task.id, f, visibility)
      load()
      onChanged()
    } catch (e: any) {
      setErrors([e?.response?.data?.message ?? 'Upload failed. Please try again.'])
    } finally {
      setUploading(false)
    }
  }

  // Confirm visibility for the current queued file, upload it, then advance the queue.
  async function confirmCurrent() {
    const file = queue[0]
    if (!file) return
    setUploading(true)
    try {
      await tasksApi.uploadProof(orgId, task.id, file, choice)
      const rest = queue.slice(1)
      setQueue(rest)
      setChoice('private')
      if (rest.length === 0) { load(); onChanged() }
    } catch (e: any) {
      setErrors([e?.response?.data?.message ?? 'Upload failed. Please try again.'])
      setQueue([])
    } finally {
      setUploading(false)
    }
  }

  const download = (a: TaskAttachment) => tasksApi.downloadProof(orgId, task.id, a.id).catch(() => {})

  async function handleDeleteProof(a: TaskAttachment) {
    setErrors([])
    setDeleting(true)
    try {
      await tasksApi.deleteAttachment(orgId, task.id, a.id)
      setProofToDelete(null)
      load()
      onChanged()
    } catch (e: any) {
      setErrors([e?.response?.data?.message ?? 'Could not remove the file.'])
      setProofToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  function FileRow({ a, showUploader }: { a: TaskAttachment; showUploader?: boolean }) {
    const mine = a.uploaded_by_user_id === user?.id
    return (
      <div className="flex items-center gap-2 text-[12px]">
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-5 rounded-xs bg-primary-subtle text-primary-text text-[9px] font-medium">
          {fileKindLabel(a.file_name)}
        </span>
        <Tooltip label={a.file_name}>
          <button onClick={() => download(a)} className="min-w-0 truncate text-primary-text hover:underline text-left">
            {a.file_name}
          </button>
        </Tooltip>
        {showUploader && a.uploaded_by_name && <span className="shrink-0 text-text-muted">· {a.uploaded_by_name}</span>}
        <span className="shrink-0 text-text-muted">{formatBytes(a.size_bytes)}</span>
        <span className="shrink-0 text-text-muted">· {formatWhen(a.created_at)}</span>
        {a.proof_visibility === 'everyone' && (
          <Tooltip label="Visible to everyone on the task">
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-text-muted">
              <Users size={10} /> shared
            </span>
          </Tooltip>
        )}
        <Tooltip label="Download">
          <button onClick={() => download(a)} aria-label="Download" className="ml-auto shrink-0 text-text-muted hover:text-primary-text">
            <Download size={13} />
          </button>
        </Tooltip>
        {mine && canManageMine && !a.comment_id && (
          <Tooltip label="Remove this proof">
            <button onClick={() => setProofToDelete(a)} aria-label="Remove this proof" className="shrink-0 text-text-muted hover:text-danger">
              <Trash2 size={13} />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }

  const uploader = iAmAssignee && !locked && (
    <div className="mt-3">
      <FileDropzone onFiles={handleFiles} onReject={setErrors} disabled={uploading} compact />
      {uploading && queue.length === 0 && <p className="mt-1 text-[11px] text-text-muted">Uploading…</p>}
      {errors.length > 0 && <div className="mt-2"><AttachmentErrorBox errors={errors} onDismiss={() => setErrors([])} /></div>}
    </div>
  )

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-medium text-text-primary flex items-center gap-2">
          <ShieldCheck size={15} className="text-primary-text" />
          Proof of Completion
        </h3>
        {isAllMust ? (
          <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${submittedCount >= requiredCount && requiredCount > 0 ? 'bg-success-bg text-success border border-success-border' : 'bg-warning-bg text-warning border border-warning-border'}`}>
            {submittedCount}/{requiredCount} submitted
          </span>
        ) : (
          summary?.task_has_any_proof ? (
            <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-success-bg text-success border border-success-border">Submitted</span>
          ) : (
            <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-warning-bg text-warning border border-warning-border">Pending</span>
          )
        )}
      </div>

      {allowed.length > 0 && (
        <p className="text-[11px] text-text-muted mb-2">Accepted: {allowed.join(', ')}</p>
      )}

      {/* Uploader sits up top for an assignee ("upload here"), then the files below. */}
      {uploader}

      {isAllMust && isAssigner ? (
        // Assigner oversight — per-person scoreboard with everyone's files.
        <div className="space-y-2.5 mt-3">
          {primary.map((a) => {
            const name = a.user?.name ?? a.user_name ?? 'Unknown'
            const submitted = submittedIds.has(a.user_id)
            const files = proofsByUser.get(a.user_id) ?? []
            const isMe = a.user_id === user?.id
            return (
              <div key={a.id} className="border-l-2 border-border-light pl-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{name}{isMe && <span className="text-text-muted font-normal"> (you)</span>}</span>
                  {submitted ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success"><CheckCircle2 size={12} /> Submitted</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning"><Clock size={12} /> Pending</span>
                  )}
                </div>
                {files.length > 0 && (
                  <div className="mt-1.5 space-y-1">{files.map((f) => <FileRow key={f.id} a={f} />)}</div>
                )}
                {submitted && files.length === 0 && !isMe && (
                  <p className="mt-1 text-[11px] text-text-muted inline-flex items-center gap-1"><Lock size={10} /> File visible to the assigner only</p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        // Assignee (or any_can) — a flat list of the files this viewer can see.
        <div className="space-y-1.5 mt-3">
          {proofs.length > 0 ? (
            proofs.map((p) => <FileRow key={p.id} a={p} showUploader />)
          ) : (
            <p className="text-[13px] text-text-muted">
              {isAllMust ? 'No proof yet. Upload yours above.' : 'No proof submitted yet. One proof file from anyone on the task is enough.'}
            </p>
          )}
        </div>
      )}

      {/* Per-file visibility popup (all_must) — asked once per file as it's uploaded. */}
      <Modal
        isOpen={queue.length > 0}
        onClose={() => { if (!uploading) setQueue([]) }}
        title="Who can see this proof?"
        size="sm"
        closeOnEscape={!uploading}
      >
        {queue[0] && (
          <div>
            <p className="text-[13px] text-text-secondary mb-3 break-all">
              <span className="font-medium text-text-primary">{queue[0].name}</span>
            </p>
            <div className="space-y-2">
              {([
                { v: 'private' as ProofVisibility, label: 'Only the assigner', hint: 'Your teammates won’t see this file.' },
                { v: 'everyone' as ProofVisibility, label: 'Everyone on the task', hint: 'All assignees can view and download it.' },
              ]).map((o) => (
                <label key={o.v} className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${choice === o.v ? 'border-primary bg-primary-subtle' : 'border-border-light hover:bg-surface-sunken'}`}>
                  <input type="radio" name="proof-visibility" className="accent-primary mt-0.5" checked={choice === o.v} onChange={() => setChoice(o.v)} />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">{o.label}</span>
                    <span className="block text-[11px] text-text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {queue.length > 1 && <p className="mt-2 text-[11px] text-text-muted">{queue.length - 1} more file{queue.length - 1 !== 1 ? 's' : ''} after this.</p>}
            {/* No footer Cancel — the header X / backdrop dismiss this (both discard the
                queue), so a duplicate Cancel would break the cancel-vs-X rule. */}
            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={confirmCurrent}
                disabled={uploading}
                className="text-sm font-medium text-white bg-primary rounded-lg px-4 py-2 hover:bg-primary-hover disabled:opacity-60 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm before removing a proof file — it's evidence, so guard it like the
          plain-attachment delete does. */}
      <Modal
        isOpen={!!proofToDelete}
        onClose={() => { if (!deleting) setProofToDelete(null) }}
        title="Remove this proof?"
        size="sm"
        closeOnEscape={!deleting}
      >
        {proofToDelete && (
          <div>
            <p className="text-[14px] text-text-secondary">
              <span className="font-medium text-text-primary break-all">{proofToDelete.file_name}</span> will be permanently
              removed and will no longer count toward the proof requirement. This can’t be undone.
            </p>
            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={() => handleDeleteProof(proofToDelete)}
                disabled={deleting}
                className="text-sm font-medium text-white bg-danger rounded-lg px-4 py-2 hover:bg-danger-hover disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Removing…' : 'Remove proof'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
