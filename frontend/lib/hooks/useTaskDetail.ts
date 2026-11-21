'use client'

/*
 * The task detail data layer, shared by the computer's task page and the phone's
 * task screen (their UIs stay separate). It owns the loaded task and what hangs off
 * it, and every mutation the two screens share. Mutations apply the server's answer
 * to local state and then throw on failure: each screen shows the error its own way
 * (the computer a warning toast, the phone an error toast or an inline sheet message).
 *
 * `variant` decides what is fetched on mount, so each screen keeps making exactly
 * the calls it made before this hook existed:
 *   'full'  - computer: task, categories, priorities, statuses, comments, activity,
 *             attachments and config in one parallel load.
 *   'lean'  - phone: the task, the org config and the comments, each on its own.
 */
import { useCallback, useEffect, useState } from 'react'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import { secondsUntil } from '@/lib/tasks/format'
import type {
  Task,
  TaskActivityLog,
  TaskAttachment,
  TaskCategory,
  TaskComment,
  TaskMasterConfig,
  TaskPriority,
  TaskStatus,
} from '@/lib/types/tasks'

export type TaskDetailVariant = 'full' | 'lean'

export interface UseTaskDetailOptions {
  orgId: string
  taskId: string | undefined
  userId: string | undefined
  variant: TaskDetailVariant
}

/** How to refresh the task after a mutation: wait for it (the default) or let it run behind. */
export interface MutationOptions {
  /** Runs right after the server's answer has been applied, before any reload. */
  onApplied?: () => void
  reload?: 'await' | 'background'
}

/** What the composer should do after the computer's comment flow finishes. */
export interface SendCommentResult {
  clearText: boolean
  clearFiles: boolean
  error: string | null
}

export function useTaskDetail({ orgId, taskId, userId, variant }: UseTaskDetailOptions) {
  const full = variant === 'full'

  const [task, setTask] = useState<Task | null>(null)
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  // null = not loaded yet (phone shows skeletons); the computer starts with an empty list.
  const [commentsState, setComments] = useState<TaskComment[] | null>(full ? [] : null)
  const [commentsFailed, setCommentsFailed] = useState(false)
  // Every attachment on the task - creation-time files AND files shared in comments.
  const [allAttachments, setAllAttachments] = useState<TaskAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [deletingAttachment, setDeletingAttachment] = useState(false)
  const [activityLogs, setActivityLogs] = useState<TaskActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // The computer passes the config to useCanEditTask as soon as the page renders, so it
  // starts as null (a provided value); the phone lets that hook fetch it, so undefined.
  const [config, setConfig] = useState<TaskMasterConfig | null | undefined>(full ? null : undefined)
  const [selectedStatusId, setSelectedStatusId] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Bumped to make the proof card / files section re-list (e.g. after "use as proof").
  const [proofReloadToken, setProofReloadToken] = useState(0)

  const comments = commentsState ?? []
  const commentsLoading = commentsState === null

  // ─── Loading ────────────────────────────────────────────────────────────────

  const reload = useCallback(async (): Promise<void> => {
    if (!orgId || !taskId) return
    if (!full) {
      await tasksApi
        .getTask(orgId, taskId)
        .then(setTask)
        .catch(() => setError(true))
      return
    }
    try {
      const [t, cats, pris, sts, cmts, logs, atts, cfg] = await Promise.all([
        tasksApi.getTask(orgId, taskId).catch(() => null),
        tasksApi.getCategories(orgId).catch(() => []),
        tasksApi.getPriorities(orgId).catch(() => []),
        tasksApi.getStatuses(orgId).catch(() => []),
        tasksApi.getComments(orgId, taskId).catch(() => []),
        tasksApi.getLogs(orgId, taskId).catch(() => []),
        tasksApi.listAllAttachments(orgId, taskId).catch(() => []),
        tasksApi.getConfig(orgId).catch(() => null),
      ])
      setTask(t)
      setCategories(cats)
      setPriorities(pris)
      setStatuses(sts)
      setComments(cmts)
      setActivityLogs(logs)
      setAllAttachments(atts)
      setConfig(cfg)
      if (t) setSelectedStatusId(t.status_id)
    } finally {
      setLoading(false)
    }
  }, [orgId, taskId, full])

  useEffect(() => {
    void reload()
  }, [reload])

  // Phone: the org config (Delete's rule needs task_delete_roles) loads on its own.
  useEffect(() => {
    if (full || !orgId) return
    tasksApi.getConfig(orgId).then(setConfig).catch(() => setConfig(null))
  }, [full, orgId])

  const loadComments = useCallback(() => {
    if (!orgId || !taskId) return
    setCommentsFailed(false)
    tasksApi.getComments(orgId, taskId).then(setComments).catch(() => setCommentsFailed(true))
  }, [orgId, taskId])

  // Phone: comments load on their own (the computer's single load already has them).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads on mount, as the phone screen always did
    if (!full) loadComments()
  }, [full, loadComments])

  const refreshAllAttachments = useCallback(async () => {
    if (!orgId || !taskId) return
    setAllAttachments(await tasksApi.listAllAttachments(orgId, taskId).catch(() => []))
  }, [orgId, taskId])

  const refreshLogs = useCallback(() => {
    if (!orgId || !taskId) return
    tasksApi.getLogs(orgId, taskId).then(setActivityLogs).catch(() => {})
  }, [orgId, taskId])

  const retryTask = useCallback(() => {
    setError(false)
    void reload()
  }, [reload])

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const apply = (updated: Task) => {
    setTask(updated)
    setSelectedStatusId(updated.status_id)
  }

  async function settle(opts: MutationOptions | undefined) {
    opts?.onApplied?.()
    if (opts?.reload === 'background') void reload()
    else await reload()
  }

  async function track<T>(key: string, fn: () => Promise<T>): Promise<T> {
    setActionLoading(key)
    try {
      return await fn()
    } finally {
      setActionLoading(null)
    }
  }

  function bumpProof() {
    setProofReloadToken((t) => t + 1)
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  /** Shared status (any_can_complete). A failure reverts the select quietly. */
  async function changeSharedStatus(newStatusId: string) {
    if (!task) return
    setSelectedStatusId(newStatusId)
    try {
      apply(await tasksApi.setSharedStatus(orgId, taskId!, newStatusId))
    } catch {
      setSelectedStatusId(task.status_id)
    }
  }

  /** My own status track (all_must_complete). A failure is ignored. */
  async function changeMyTrack(newStatusId: string) {
    if (!task) return
    try {
      apply(await tasksApi.setAssigneeStatus(orgId, taskId!, newStatusId))
    } catch {
      // ignore - the select reverts to the task's value on next render
    }
  }

  /** The owner moving one person's track (all_must_complete). A failure is ignored. */
  async function changeAssigneeTrack(assigneeUserId: string, newStatusId: string) {
    if (!task) return
    try {
      apply(await tasksApi.setAssigneeStatus(orgId, taskId!, newStatusId, assigneeUserId))
    } catch {
      // ignore
    }
  }

  // ─── Completing / reopening / closing ───────────────────────────────────────

  function completeAssignee(assigneeUserId: string) {
    return track(`complete-${assigneeUserId}`, async () => {
      apply(await tasksApi.completeAssignee(orgId, taskId!, assigneeUserId))
    })
  }

  /** The owner reopens ONE person's finished part for rework (all_must_complete). */
  function reopenAssigneePart(assigneeUserId: string, reason: string, opts?: MutationOptions) {
    return track(`reopen-part-${assigneeUserId}`, async () => {
      apply(await tasksApi.reopenAssigneePart(orgId, taskId!, assigneeUserId, reason.trim() || undefined))
      opts?.onApplied?.()
    })
  }

  /** Complete the task (or, in all_must_complete, my part). */
  function complete(opts?: MutationOptions) {
    return track('complete', async () => {
      apply(await tasksApi.completeTask(orgId, taskId!))
      await settle(opts)
    })
  }

  /** Owner override: force-complete the whole all_must task for everyone. */
  function completeWholeTask(opts?: MutationOptions) {
    return track('complete', async () => {
      apply(await tasksApi.completeTask(orgId, taskId!, true))
      await settle(opts)
    })
  }

  /** Reopen a closed task (a reason only when the undo window has ended). */
  function reopen(reason?: string, opts?: MutationOptions) {
    return track('reopen', async () => {
      apply(await tasksApi.reopenTask(orgId, taskId!, reason))
      await settle(opts)
    })
  }

  /** Close the whole task as Incomplete (reason required). */
  function markIncomplete(reason: string, opts?: MutationOptions) {
    return track('incomplete', async () => {
      apply(await tasksApi.markIncomplete(orgId, taskId!, reason.trim()))
      await settle(opts)
    })
  }

  /** all_must_complete: flag only my own part as can't-complete (reason required). */
  function flagMyPart(reason: string, opts?: MutationOptions) {
    return track('flag', async () => {
      apply(await tasksApi.flagCannotComplete(orgId, taskId!, reason.trim()))
      opts?.onApplied?.()
    })
  }

  /** Delete the task. On success the action stays "loading" - the caller navigates away. */
  async function deleteTask(reason: string) {
    setActionLoading('delete')
    try {
      await tasksApi.deleteTask(orgId, taskId!, reason.trim())
    } catch (e) {
      setActionLoading(null)
      throw e
    }
  }

  // ─── People and settings ────────────────────────────────────────────────────

  /**
   * Replace the whole roster in ONE atomic call. A participant without assigner rights
   * manages CC only: omitting `assignee_user_ids` leaves the working roster untouched.
   */
  async function saveRoster(list: { user_id: string; is_cc?: boolean }[], canEditRoster: boolean) {
    await tasksApi.updateTask(orgId, taskId!, {
      ...(canEditRoster ? { assignee_user_ids: list.filter((a) => !a.is_cc).map((a) => a.user_id) } : {}),
      cc_user_ids: list.filter((a) => a.is_cc).map((a) => a.user_id),
    } as Parameters<typeof tasksApi.updateTask>[2])
    await reload()
  }

  async function saveCompletionMode(mode: 'any_can_complete' | 'all_must_complete') {
    await tasksApi.updateTask(orgId, taskId!, { completion_mode: mode })
    await reload()
  }

  /** Patch tags in place so nothing on the page flickers, then refresh the activity trail quietly. */
  function patchTags(updated: Task) {
    setTask((prev) => (prev ? { ...prev, tags: updated.tags, updated_at: updated.updated_at ?? prev.updated_at } : prev))
    refreshLogs()
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  /**
   * Computer flow: post a comment (text, files, or both). Resolves with what the composer
   * should do; never throws. If the request errors but the comment landed server-side, it
   * is treated as posted rather than a false failure.
   */
  async function sendComment(text: string, files: File[]): Promise<SendCommentResult> {
    const body = text.trim()
    const hadText = !!body
    let created: TaskComment | null = null
    try {
      created = await tasksApi.addComment(orgId, taskId!, body)
      if (files.length > 0) {
        try {
          for (const file of files) {
            await tasksApi.uploadCommentAttachment(orgId, taskId!, created.id, file)
          }
        } catch {
          // The comment posted but a file upload failed (e.g. storage error).
          if (!hadText) {
            // Nothing worth keeping - roll back the empty, attachment-less comment.
            await tasksApi.deleteComment(orgId, taskId!, created.id).catch(() => {})
            return { clearText: false, clearFiles: false, error: 'Couldn’t upload the file. Nothing was posted — please try again.' }
          }
          // Keep the text; just report the failed attachment and refresh state.
          setComments(await tasksApi.getComments(orgId, taskId!).catch(() => comments))
          await refreshAllAttachments()
          return { clearText: true, clearFiles: false, error: 'Your comment was posted, but the file failed to upload. Try attaching it again.' }
        }
        // Reload so the comment shows its now-persisted attachments.
        setComments(await tasksApi.getComments(orgId, taskId!).catch(() => [...comments, created!]))
        // Comment files also belong in the sidebar Attachments card.
        await refreshAllAttachments()
      } else {
        setComments((prev) => [...(prev ?? []), created!])
      }
      return { clearText: true, clearFiles: true, error: null }
    } catch (err) {
      // The request errored, but the comment may still have been created server-side
      // (a flaky/slow response after the DB write). Reconcile before claiming failure.
      console.error('addComment failed:', err)
      const fresh = await tasksApi.getComments(orgId, taskId!).catch(() => null)
      const posted =
        !!fresh &&
        fresh.some((c) => c.user_id === userId && c.body === body && !comments.some((old) => old.id === c.id))
      if (fresh && posted) {
        setComments(fresh)
        await refreshAllAttachments()
        return { clearText: true, clearFiles: true, error: null }
      }
      return { clearText: false, clearFiles: false, error: 'Couldn’t post your comment. Please try again.' }
    }
  }

  /**
   * Phone flow: post a comment, then its files one by one (each may be shrunk first by
   * `prepare`). Throws when the comment itself fails; a file that fails is only counted.
   */
  async function postComment(text: string, files: File[], prepare?: (f: File) => Promise<File>): Promise<{ failedFiles: number }> {
    const created = await tasksApi.addComment(orgId, taskId!, text)
    let failed = 0
    for (const file of files) {
      try {
        await tasksApi.uploadCommentAttachment(orgId, taskId!, created.id, prepare ? await prepare(file) : file)
      } catch {
        failed += 1
      }
    }
    if (files.length > 0) {
      // The files are on the server now: reload once so the comment shows them. Same row keys, so nothing flickers.
      const fresh = await tasksApi.getComments(orgId, taskId!).catch(() => null)
      setComments(fresh ?? ((prev) => [...(prev ?? []), created]))
    } else {
      setComments((prev) => [...(prev ?? []), created])
    }
    return { failedFiles: failed }
  }

  /** Delete one of my comments (its files go with it). Throws on failure. */
  async function removeComment(commentId: string) {
    await tasksApi.deleteComment(orgId, taskId!, commentId)
    setComments((prev) => (prev ?? []).filter((x) => x.id !== commentId))
  }

  /**
   * After a comment was removed its files are gone too: refresh what listed them and,
   * if a file was a proof, the task + proof card so nothing stale keeps counting.
   */
  async function syncAfterCommentRemoved() {
    if (full) await refreshAllAttachments()
    if (task?.proof_required) {
      if (full) {
        const fresh = await tasksApi.getTask(orgId, taskId!).catch(() => null)
        if (fresh) setTask(fresh)
      } else {
        void reload()
      }
      bumpProof()
    }
  }

  /** Use a file I shared in a comment as my proof of completion. Throws on failure. */
  function markCommentFileAsProof(attachmentId: string) {
    return track(`mark-proof-${attachmentId}`, async () => {
      await tasksApi.markCommentAttachmentAsProof(orgId, taskId!, attachmentId)
      if (full) await reload()
      else void reload()
      bumpProof()
      const fresh = await tasksApi.getComments(orgId, taskId!).catch(() => null)
      if (fresh) setComments(fresh)
    })
  }

  /** Same, for a file in a workflow run's shared discussion (no comment list of ours to refresh). */
  async function markDiscussionFileAsProof(attachmentId: string) {
    await tasksApi.markCommentAttachmentAsProof(orgId, taskId!, attachmentId)
    if (full) await reload()
    else void reload()
    bumpProof()
  }

  // ─── Task-level attachments (computer) ──────────────────────────────────────

  async function uploadTaskFiles(files: File[]) {
    if (files.length === 0) return
    setUploadingAttachment(true)
    setAttachmentError(null)
    try {
      for (const file of files) {
        await tasksApi.uploadTaskAttachment(orgId, taskId!, file)
      }
      await refreshAllAttachments()
    } catch {
      // Reflect whatever did upload, then surface a friendly message.
      await refreshAllAttachments()
      setAttachmentError('Couldn’t upload the file. Please try again.')
    } finally {
      setUploadingAttachment(false)
    }
  }

  /** Optimistic remove; reverts with a message if the server refuses. Never throws. */
  async function removeAttachment(a: TaskAttachment) {
    setAttachmentError(null)
    setDeletingAttachment(true)
    const prev = allAttachments
    setAllAttachments((list) => list.filter((x) => x.id !== a.id))
    try {
      await tasksApi.deleteAttachment(orgId, taskId!, a.id)
    } catch {
      setAllAttachments(prev)
      setAttachmentError('Couldn’t remove the attachment. Please try again.')
    } finally {
      setDeletingAttachment(false)
    }
  }

  return {
    // data
    task, setTask, applyTask: apply, categories, priorities, statuses, config,
    comments, commentsLoading, commentsFailed, loadComments,
    allAttachments, uploadingAttachment, attachmentError, deletingAttachment,
    activityLogs, loading, error, retryTask,
    selectedStatusId, actionLoading, proofReloadToken, bumpProof,
    reload, refreshAllAttachments,
    // status
    changeSharedStatus, changeMyTrack, changeAssigneeTrack,
    // completing / closing
    completeAssignee, reopenAssigneePart, complete, completeWholeTask, reopen, markIncomplete, flagMyPart, deleteTask,
    // people + settings
    saveRoster, saveCompletionMode, patchTags,
    // comments
    sendComment, postComment, removeComment, syncAfterCommentRemoved, markCommentFileAsProof, markDiscussionFileAsProof,
    // attachments
    uploadTaskFiles, removeAttachment,
  }
}

export type TaskDetail = ReturnType<typeof useTaskDetail>

/** Seconds left in the task's undo window, ticking every second (0 once closed or none). */
export function useReopenCountdown(expiresAt: string | null | undefined): number {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!expiresAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the countdown resets when the window goes away
      setSecs(0)
      return
    }
    const tick = () => setSecs(secondsUntil(expiresAt, getNow()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return secs
}

/** Re-renders once the moment the undo window ends, so "who may reopen" is re-evaluated. */
export function useUndoWindowTick(expiresAt: string | null | undefined): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!expiresAt) return
    const ms = new Date(expiresAt).getTime() - getNow().getTime()
    if (ms <= 0) return
    const id = setTimeout(() => setTick((n) => n + 1), ms + 50)
    return () => clearTimeout(id)
  }, [expiresAt])
}
