/*
 * Who may do what on a task's detail screen - the pure rules shared by the
 * computer's task page and the phone's task screen. Mirrors the backend's
 * updateTask / checkTaskPermission / reopenTask rules; no React, no clock
 * (callers pass `now`) so every rule is unit-testable.
 */
import type { Task, TaskMasterConfig, TaskStatus } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'

export interface TaskFlagsInput {
  task: Task
  userId: string | undefined
  /** Platform admin (the phone also counts the permission system's admin). */
  isAdmin: boolean
  now: Date
  /** Open (non-terminal) statuses, to pick the "not started" fallback. Optional. */
  openStatuses?: TaskStatus[]
}

export type TaskAssignee = NonNullable<Task['assignees']>[number]

export interface TaskFlags {
  /** Working (non-CC) assignees. */
  assignees: TaskAssignee[]
  ccUsers: TaskAssignee[]
  /** This person's own working-assignee row, even on a simulated-future task. */
  myAssignee: TaskAssignee | undefined
  currentUserIsCC: boolean
  isCreator: boolean
  isFutureTask: boolean
  /** Creator or admin, and not a simulated-future task. */
  canEdit: boolean
  isAllMustComplete: boolean
  /** A working assignee and the task is not a simulated-future one. */
  isAssignee: boolean
  /** A working assignee at all (ignores the simulated future). */
  isOnTask: boolean
  completedCount: number
  totalAssignees: number
  /** Parts flagged "can't complete" that are not done. */
  blockedCount: number
  pendingCount: number
  notStartedId: string
  /** The task's overall status is terminal (Complete / Incomplete / Partially completed). */
  isTaskTerminal: boolean
  isIncompleteStatus: boolean
  isPartiallyCompletedStatus: boolean
  /** Anyone actually on the task may manage CC; closed tasks are frozen. */
  canManageCc: boolean
  /** Reassigning the work: an assigner-level act on an open task. */
  canEditRoster: boolean
  myTrackId: string
  /** Shared status (any_can_complete): any assignee or the owner may move it. */
  canMoveSharedStatus: boolean
  /** Names of working assignees who have not finished. */
  pendingNames: string[]
}

export function assigneeName(a: TaskAssignee, fallback = 'Someone'): string {
  return a.user?.name ?? a.user_name ?? fallback
}

export function deriveTaskFlags({ task, userId, isAdmin, now, openStatuses = [] }: TaskFlagsInput): TaskFlags {
  const assignees = task.assignees?.filter((a) => !a.is_cc) ?? []
  const ccUsers = task.assignees?.filter((a) => a.is_cc) ?? []
  const currentUserIsCC = task.assignees?.some((a) => a.user_id === userId && a.is_cc) ?? false
  const isCreator = task.created_by_user_id === userId
  const isFutureTask = new Date(task.created_at) > now
  const canEdit = (isCreator || isAdmin) && !isFutureTask

  const isAllMustComplete = task.completion_mode === 'all_must_complete'
  const myAssignee = assignees.find((a) => a.user_id === userId)
  const isOnTask = !!myAssignee
  const isAssignee = isOnTask && !isFutureTask
  const completedCount = assignees.filter((a) => a.is_completed).length
  const totalAssignees = assignees.length
  const blockedCount = assignees.filter((a) => a.cannot_complete && !a.is_completed).length
  const pendingCount = totalAssignees - completedCount - blockedCount
  const notStartedId = openStatuses.find((s) => s.type === 'not_started')?.id ?? openStatuses[0]?.id ?? ''
  const isTaskTerminal = !!task.status && TERMINAL_STATUS_PHASES.includes(task.status.type)
  const isIncompleteStatus = task.status?.type === 'incomplete'
  const isPartiallyCompletedStatus = task.status?.type === 'partially_completed'
  const canManageCc = (isCreator || isAdmin || isOnTask || currentUserIsCC) && !isFutureTask && !isTaskTerminal
  const canEditRoster = canEdit && !isTaskTerminal
  const myTrackId = myAssignee?.status_id ?? notStartedId
  const canMoveSharedStatus = (isAssignee || canEdit) && !isFutureTask
  const pendingNames = assignees.filter((a) => !a.is_completed).map((a) => assigneeName(a))

  return {
    assignees, ccUsers, myAssignee, currentUserIsCC, isCreator, isFutureTask, canEdit,
    isAllMustComplete, isAssignee, isOnTask, completedCount, totalAssignees, blockedCount, pendingCount,
    notStartedId, isTaskTerminal, isIncompleteStatus, isPartiallyCompletedStatus,
    canManageCc, canEditRoster, myTrackId, canMoveSharedStatus, pendingNames,
  }
}

/**
 * Delete: platform admins, or when the org opens it to all members
 * (`employee` in task_delete_roles). Being the creator does NOT grant delete.
 * `undefined` = the org's config has not loaded yet (not known is not "not allowed").
 */
export function canDeleteTask(isPlatformAdmin: boolean, config: TaskMasterConfig | null | undefined): boolean | undefined {
  if (isPlatformAdmin) return true
  if (config === undefined) return undefined
  return (config?.task_delete_roles ?? []).includes('employee')
}

/** What the "Reopen" control does for this viewer. */
export type ReopenKind = 'direct' | 'reason' | null

export interface PhoneActionInput {
  task: Task
  flags: TaskFlags
  isAdmin: boolean
  /** The undo window is still open. */
  windowOpen: boolean
}

export interface PhoneActions {
  canMoveShared: boolean
  canCantComplete: boolean
  reopenKind: ReopenKind
  partReopen: boolean
  canCompleteForAll: boolean
  canWholeIncomplete: boolean
  statusMine: boolean
  canChangeStatus: boolean
  canSharedIncomplete: boolean
  canChangeMode: boolean
  canSubmitProof: boolean
  /** This viewer's own part is already done (drives "Complete task" vs Reopen). */
  myPartDone: boolean
}

/** The phone's menu and button gates, each mirroring the desktop page's rule for it. */
export function derivePhoneActions({ task, flags, isAdmin, windowOpen }: PhoneActionInput): PhoneActions {
  const { myAssignee, isOnTask, isAssignee, isCreator, isFutureTask, canEdit, currentUserIsCC, isTaskTerminal, isAllMustComplete, assignees } = flags
  const canMoveShared = (isAssignee || canEdit) && !currentUserIsCC
  const canCantComplete = isOnTask && !isFutureTask && !isTaskTerminal && !myAssignee?.is_completed && !myAssignee?.cannot_complete
  const reopenKind: ReopenKind = isTaskTerminal
    ? windowOpen && (isOnTask || isCreator || isAdmin)
      ? 'direct'
      : isCreator || isAdmin
        ? 'reason'
        : null
    : isAllMustComplete && !!myAssignee?.is_completed
      ? 'direct'
      : null
  const partReopen = isAllMustComplete && !!myAssignee?.is_completed
  const canCompleteForAll = isAllMustComplete && canEdit && !isTaskTerminal && !currentUserIsCC
  const statusMine = isAllMustComplete && isAssignee && !myAssignee?.is_completed && !myAssignee?.cannot_complete
  const canChangeStatus = !isTaskTerminal && !currentUserIsCC && (isAllMustComplete ? statusMine : canMoveShared)
  const canSharedIncomplete = !isAllMustComplete && !isTaskTerminal && canMoveShared
  const canChangeMode = canEdit && assignees.length > 1
  const canSubmitProof = !!task.proof_required && isAssignee && !isTaskTerminal
  const myPartDone = isAllMustComplete ? !!myAssignee?.is_completed : isTaskTerminal
  return {
    canMoveShared, canCantComplete, reopenKind, partReopen, canCompleteForAll,
    canWholeIncomplete: canCompleteForAll,
    statusMine, canChangeStatus, canSharedIncomplete, canChangeMode, canSubmitProof, myPartDone,
  }
}
