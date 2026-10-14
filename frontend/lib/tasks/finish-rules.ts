import type { Task, TaskChecklistItem } from '@/lib/types/tasks'

/*
 * Shared "can this tap finish the task directly, or does it need the Finish
 * sheet" logic for the phone (plan-phone-2026-10-14.md §5.1,
 * KIT-PENDING-phone-task-tick.md item 3). Used by TaskPhoneRow (to decide
 * what a circle tap does, and what row marker to show) and FinishTaskSheet
 * (to decide what's still outstanding and when "Complete task" unlocks).
 *
 * Checked BEFORE calling any complete endpoint — never by calling complete
 * and catching a validation error, which the backend would reject and
 * surface as a confusing failure for something that's actually normal.
 */

/** Whether an item is still outstanding for the given completion mode and viewer. */
function itemIsUnfinished(item: TaskChecklistItem, completionMode: Task['completion_mode']): boolean {
  if (completionMode === 'all_must_complete') {
    // Per-person: done or skipped both clear it for THIS viewer.
    return item.my_state !== 'done' && item.my_state !== 'skipped'
  }
  // any_can_complete / shared: one shared tick.
  return !item.is_completed && !item.cant_do
}

export function unfinishedChecklistItems(task: Task): TaskChecklistItem[] {
  const items = task.checklist ?? []
  return items.filter((item) => itemIsUnfinished(item, task.completion_mode))
}

export function checklistCounts(task: Task): { done: number; total: number } {
  const items = task.checklist ?? []
  const total = items.length
  const done = total - unfinishedChecklistItems(task).length
  return { done, total }
}

/** Has the current viewer already submitted proof for their part? */
export function hasSubmittedProof(task: Task, userId: string | undefined): boolean {
  if (!task.proof_required) return true
  if (!userId) return false
  return !!task.proof_summary?.submitted_user_ids?.includes(userId)
}

/** True when a tap on the circle can complete the task directly (no Finish sheet needed). */
export function canQuickComplete(task: Task, userId: string | undefined): boolean {
  if (task.proof_required && !hasSubmittedProof(task, userId)) return false
  if (unfinishedChecklistItems(task).length > 0) return false
  return true
}

/** The row's line-2 marker (KIT-PENDING item 3): a paperclip and/or "n/N". */
export function rowMarker(task: Task, userId: string | undefined): { proof: boolean; checklist: string | null } {
  const needsProof = task.proof_required && !hasSubmittedProof(task, userId)
  const { done, total } = checklistCounts(task)
  const needsChecklist = total > 0 && done < total
  return {
    proof: needsProof,
    checklist: needsChecklist ? `${done}/${total}` : null,
  }
}

/** Plain-language reason the Finish sheet's "Complete task" button is disabled, or null when ready. */
export function finishBlockedReason(task: Task, userId: string | undefined): string | null {
  const checklistLeft = unfinishedChecklistItems(task).length > 0
  const proofLeft = task.proof_required && !hasSubmittedProof(task, userId)
  if (checklistLeft && proofLeft) return 'Finish the checklist and attach proof to complete'
  if (checklistLeft) return 'Finish the checklist to complete'
  if (proofLeft) return 'Attach proof to finish'
  return null
}
