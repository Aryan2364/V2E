import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Task } from '@/lib/types/tasks'

/*
 * The ONE completion path for the phone (KIT-PENDING-phone-task-tick.md item
 * 2). My work's row circle and the task detail screen's action bar both call
 * these, and both show the same Undo toast with the same message, so a task
 * completes and un-completes identically wherever it is ticked.
 */

/** The Undo toast's text, shared by every phone screen that completes a task. */
export const COMPLETED_UNDO_MESSAGE = 'Task completed · Undo'

/** Completes the viewer's part (all_must_complete) or the whole task (shared modes). */
export function completeForMe(orgId: string, task: Task): Promise<Task> {
  if (task.completion_mode === 'all_must_complete') return tasksApi.completeAssignee(orgId, task.id, 'me')
  return tasksApi.completeTask(orgId, task.id)
}

/**
 * Is the task's undo window still open? Mirrors reopenTask in tasks.service.ts:
 * inside the window any participant reverses a closure with no reason; once
 * `reopen_expires_at` has passed only the creator or an admin may reopen, and
 * a reason is required (see reopenAfterWindow).
 */
export function isUndoWindowOpen(task: Pick<Task, 'reopen_expires_at'>): boolean {
  return !!task.reopen_expires_at && new Date(task.reopen_expires_at) > getNow()
}

/** Reopens a closed task after its undo window: creator/admin only, reason required. */
export function reopenAfterWindow(orgId: string, taskId: string, reason: string): Promise<Task> {
  return tasksApi.reopenTask(orgId, taskId, reason.trim())
}

/**
 * Reverses completeForMe INSIDE the undo window - the Undo toast's handler and
 * the detail screen's "Reopen task" while the window is open. It sends no
 * reason, so after the window the backend refuses it: use reopenAfterWindow.
 */
export async function undoCompleteForMe(orgId: string, task: Task): Promise<void> {
  if (task.completion_mode === 'all_must_complete') {
    await tasksApi.reopenAssigneePart(orgId, task.id, 'me')
  } else {
    await tasksApi.reopenTask(orgId, task.id)
  }
}
