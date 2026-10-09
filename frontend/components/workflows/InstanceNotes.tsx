'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, StickyNote, Trash2 } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import StyledSelect from '@/components/ui/StyledSelect'
import { useToast } from '@/components/ui/Toast'
import { workflowsApi, workflowErrorMessage } from '@/lib/api/workflows'
import type { InstanceNote, WorkflowInstanceStep } from '@/lib/types/workflows'
import { Avatar, BTN, ErrorBanner, GatedButton, InfoTip, Skeleton, fmtDateTime } from './shared'

const PAGE = 10
const BODY_MAX = 2000
/** A note may be left only for a step that is not finished. */
const DONE = new Set(['completed', 'skipped'])

export type NotesState = { status: 'loading' | 'ready' | 'failed'; data: InstanceNote[]; error: string }

/** An instance's notes (newest first), with add / delete that keep the list in place. */
export function useInstanceNotes(orgId: string, templateId: string, instanceId: string, enabled = true) {
  const [state, setState] = useState<NotesState>({ status: 'loading', data: [], error: '' })

  const load = useCallback(async () => {
    if (!orgId || !enabled) return
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }))
    try {
      const list = await workflowsApi.listNotes(orgId, templateId, instanceId)
      setState({ status: 'ready', data: list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)), error: '' })
    } catch (e) {
      setState((s) => ({ status: 'failed', data: s.data, error: workflowErrorMessage(e, 'Notes could not be loaded.') }))
    }
  }, [orgId, templateId, instanceId, enabled])

  useEffect(() => {
    load()
  }, [load])

  const add = useCallback(
    async (body: string, forRowId: string | null) => {
      const note = await workflowsApi.addNote(orgId, templateId, instanceId, { body, for_row_id: forRowId })
      if (note && typeof note === 'object' && 'id' in note) {
        setState((s) => ({ ...s, status: 'ready', data: [note, ...s.data.filter((n) => n.id !== note.id)] }))
      } else {
        await load()
      }
    },
    [orgId, templateId, instanceId, load],
  )

  const remove = useCallback(
    async (noteId: string) => {
      await workflowsApi.deleteNote(orgId, templateId, instanceId, noteId)
      setState((s) => ({ ...s, data: s.data.filter((n) => n.id !== noteId) }))
    },
    [orgId, templateId, instanceId],
  )

  return { state, load, add, remove }
}

/** "B1 “Budget check”" for a row. */
export function rowLabel(row: Pick<WorkflowInstanceStep, 'title'>, label: string | undefined): string {
  return `${label ? `${label} ` : ''}“${row.title || 'Untitled step'}”`
}

/** One note: who, when, which step it is for, the text, and Delete when allowed. */
export function NoteItem({
  note,
  stepName,
  onDelete,
  showStep = true,
}: {
  note: InstanceNote
  /** The step it is for, in words (from this page's rows), when known. */
  stepName?: string | null
  onDelete?: (n: InstanceNote) => void
  showStep?: boolean
}) {
  const fs = note.for_step
  const forStep = note.for_row_id ? stepName ?? (fs ? `${fs.number_label ? `${fs.number_label} ` : ''}“${fs.title || 'Untitled step'}”` : 'a later step') : null
  return (
    <li className="flex items-start gap-2.5">
      <Avatar name={note.author?.name || '?'} size="md" />
      <div className="min-w-0 flex-1 rounded-[10px] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-semibold text-[#0F172A]">{note.author?.name || 'Someone'}</span>
            <span className="text-[#475569]"> · {fmtDateTime(note.created_at)}</span>
          </p>
          {onDelete && note.can_delete && (
            <button
              type="button"
              aria-label="Delete note"
              onClick={() => onDelete(note)}
              className="-my-1 -mr-1.5 inline-flex items-center justify-center w-9 h-9 sm:w-7 sm:h-7 rounded-[6px] text-[#475569] hover:bg-[#FEF3C7] hover:text-[#B91C1C] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] shrink-0"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {showStep && forStep && (
          <p className="mt-0.5 text-[12px] font-medium text-[#92400E] break-words">For step {forStep}</p>
        )}
        <p className="mt-1 text-sm text-[#1E293B] whitespace-pre-wrap break-words">{note.body}</p>
      </div>
    </li>
  )
}

/**
 * The instance's Notes: everyone in the instance can read them and add one. A note can
 * be for a later step — it then shows at the top of that step's task once it starts.
 */
export default function InstanceNotes({
  notes,
  rows,
  labels,
  canAdd,
  addReason,
  onAdd,
  onDelete,
  onRetry,
}: {
  notes: NotesState
  /** The instance's steps, in order. */
  rows: WorkflowInstanceStep[]
  /** Row id → "1", "B2". */
  labels: Map<string, string>
  canAdd: boolean | undefined
  addReason: string
  onAdd: (body: string, forRowId: string | null) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
  onRetry: () => void
}) {
  const { addToast } = useToast()
  const [draft, setDraft] = useState('')
  const [forRow, setForRow] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [deleteTarget, setDeleteTarget] = useState<InstanceNote | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const open = rows.filter((r) => !DONE.has(r.status) && !r.is_branch)
  const stepOptions = [
    { value: '', label: 'No — for the whole instance' },
    ...open.map((r) => ({ value: r.id, label: `Step ${rowLabel(r, labels.get(r.id))}` })),
  ]
  // A step that has finished since it was picked is no longer offered.
  useEffect(() => {
    if (forRow && !open.some((r) => r.id === forRow)) setForRow('')
  }, [forRow, open])

  const nameOf = (id: string | null) => {
    const r = id ? rows.find((x) => x.id === id) : undefined
    return r ? rowLabel(r, labels.get(r.id)) : null
  }

  const body = draft.trim()
  async function post() {
    if (!body || posting || canAdd !== true) return
    setPosting(true)
    setPostError(null)
    try {
      await onAdd(body, forRow || null)
      const step = nameOf(forRow || null)
      setDraft('')
      setForRow('')
      addToast(step ? `Note added for step ${step}` : 'Note added', 'success')
    } catch (e) {
      setPostError(workflowErrorMessage(e, 'Your note was not added. Try again.'))
    } finally {
      setPosting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
      addToast('Note deleted', 'success')
    } catch (e) {
      setDeleteError(workflowErrorMessage(e, 'The note could not be deleted. Try again.'))
    } finally {
      setDeleting(false)
    }
  }

  const list = notes.data
  return (
    <section aria-labelledby="instance-notes" className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StickyNote size={16} className="text-[#475569]" />
        <h2 id="instance-notes" className="flex items-center gap-1 text-[18px] font-semibold text-[#0F172A]">
          Notes{' '}
          <InfoTip label="Notes" text="Everyone in this instance can read them. A note for a later step shows on that step’s task when it starts." />
        </h2>
      </div>

      {/* Composer */}
      <div className="flex flex-col gap-2.5">
        <label htmlFor="instance-note" className="sr-only">
          Add a note
        </label>
        <textarea
          id="instance-note"
          value={draft}
          rows={2}
          maxLength={BODY_MAX}
          disabled={posting || canAdd !== true}
          onChange={(e) => {
            setDraft(e.target.value)
            setPostError(null)
          }}
          placeholder="Add a note"
          className="w-full px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-y disabled:bg-[#F8FAFC] disabled:cursor-not-allowed"
        />
        {open.length > 0 && (
          <div>
            <span id="note-for-label" className="block text-sm font-medium text-[#374151] mb-1.5">
              For a later step (optional){' '}
              <InfoTip label="For a later step" text="Shown at the top of that step’s task when it starts. Its assignees are told." />
            </span>
            <div aria-labelledby="note-for-label">
              <StyledSelect value={forRow} onChange={setForRow} options={stepOptions} disabled={posting || canAdd !== true} searchPlaceholder="Search steps…" />
            </div>
          </div>
        )}
        {postError && <ErrorBanner message={postError} onClose={() => setPostError(null)} />}
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[12px] tabular-nums ${draft.length >= BODY_MAX ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>
            {draft.length}/{BODY_MAX}
          </span>
          <GatedButton allowed={canAdd} reason={addReason} icon={StickyNote} variant="secondary" loading={posting} disabled={!body} onClick={post}>
            {posting ? 'Adding…' : 'Add note'}
          </GatedButton>
        </div>
      </div>

      {/* List */}
      {notes.status === 'loading' ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : notes.status === 'failed' && list.length === 0 ? (
        <div className="flex flex-col gap-2 text-sm text-[#B91C1C]">
          <span>{notes.error}</span>
          <button type="button" onClick={onRetry} className={`${BTN.quiet} self-start`}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-[#475569]">No notes yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {list.slice(0, limit).map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                stepName={nameOf(n.for_row_id)}
                onDelete={(note) => {
                  setDeleteError(null)
                  setDeleteTarget(note)
                }}
              />
            ))}
          </ul>
          {list.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={`${BTN.quiet} self-start`}>
              Show {Math.min(PAGE, list.length - limit)} more
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this note?"
        message="It is removed for everyone in this instance."
        confirmLabel="Delete note"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </section>
  )
}
