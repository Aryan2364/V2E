import { tasksApi } from '@/lib/api/tasks'
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

/** Reverses completeForMe - the Undo toast's handler and the detail screen's "Reopen task". */
export async function undoCompleteForMe(orgId: string, task: Task): Promise<void> {
  if (task.completion_mode === 'all_must_complete') {
    await tasksApi.reopenAssigneePart(orgId, task.id, 'me')
  } else {
    await tasksApi.reopenTask(orgId, task.id)
  }
}
