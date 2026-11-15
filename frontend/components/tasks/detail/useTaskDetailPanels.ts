'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui/sonner'
import type { TaskDetail } from '@/lib/hooks/useTaskDetail'
import { showActionError } from './showActionError'

/**
 * The computer task page's own UI state (which reason box / dialog is open) and the
 * handlers that tie it to the shared data layer. Errors are shown as a warning toast.
 */
export function useTaskDetailPanels(d: TaskDetail) {
  const router = useRouter()
  const [showActivity, setShowActivity] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  // Marking incomplete: which outcome we're capturing a reason for - the whole task
  // ('task') or only my own part ('my_part', all_must_complete). Null = box closed.
  const [incompleteTarget, setIncompleteTarget] = useState<null | 'task' | 'my_part'>(null)
  const [incompleteReason, setIncompleteReason] = useState('')
  // Owner override: closing the whole all_must task as Complete while some parts are
  // still pending shows a heads-up first.
  const [confirmCompleteAll, setConfirmCompleteAll] = useState(false)

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      showActionError(e)
    }
  }

  const handleComplete = () => guard(() => d.complete())

  const handleCompleteWholeTask = async () => {
    try {
      await d.completeWholeTask({ onApplied: () => setConfirmCompleteAll(false) })
    } catch (e) {
      setConfirmCompleteAll(false)
      showActionError(e)
    }
  }

  const handleReopen = (reason?: string) =>
    guard(() => d.reopen(reason, { onApplied: () => { setShowReopenModal(false); setReopenReason('') } }))

  // Close the whole task as Incomplete (reason required).
  const handleMarkIncomplete = async () => {
    if (!incompleteReason.trim()) return
    await guard(() => d.markIncomplete(incompleteReason, { onApplied: () => { setIncompleteTarget(null); setIncompleteReason('') } }))
  }

  // all_must_complete: flag only my own part as can't-complete (reason required).
  const handleFlagMyPart = async () => {
    if (!incompleteReason.trim()) return
    await guard(() => d.flagMyPart(incompleteReason, { onApplied: () => { setIncompleteTarget(null); setIncompleteReason('') } }))
  }

  const handleDelete = async () => {
    // The backend requires a non-blank reason - catch it here so the field's
    // "(optional)" label never lies and a blank submit doesn't silently no-op.
    if (!deleteReason.trim()) {
      toast.warning('A reason is required to delete this task.')
      return
    }
    try {
      await d.deleteTask(deleteReason)
      router.push('/dashboard/tasks')
    } catch (e) {
      showActionError(e)
    }
  }

  return {
    showActivity, setShowActivity,
    deleteReason, setDeleteReason, showDeleteConfirm, setShowDeleteConfirm,
    showReopenModal, setShowReopenModal, reopenReason, setReopenReason,
    showEditModal, setShowEditModal,
    incompleteTarget, setIncompleteTarget, incompleteReason, setIncompleteReason,
    confirmCompleteAll, setConfirmCompleteAll,
    guard, handleComplete, handleCompleteWholeTask, handleReopen, handleMarkIncomplete, handleFlagMyPart, handleDelete,
  }
}

export type TaskDetailPanels = ReturnType<typeof useTaskDetailPanels>
