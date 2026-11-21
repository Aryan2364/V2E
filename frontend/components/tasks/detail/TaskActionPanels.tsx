'use client'

import { Button } from '@/components/ui/button'
import type { TaskDetailCtx } from './types'
import type { TaskDetailPanels } from './useTaskDetailPanels'

/** The inline confirmation boxes: reopen, complete for everyone, mark incomplete, delete. */
export function TaskActionPanels({ ctx, panels }: { ctx: TaskDetailCtx; panels: TaskDetailPanels }) {
  const { d, flags } = ctx
  const { actionLoading } = d
  const { pendingNames, isAllMustComplete } = flags
  const {
    showReopenModal, setShowReopenModal, reopenReason, setReopenReason, handleReopen,
    confirmCompleteAll, setConfirmCompleteAll, handleCompleteWholeTask,
    incompleteTarget, setIncompleteTarget, incompleteReason, setIncompleteReason, handleFlagMyPart, handleMarkIncomplete,
    showDeleteConfirm, setShowDeleteConfirm, deleteReason, setDeleteReason, handleDelete,
  } = panels
  return (
    <>
  {/* Reopen reason modal (creator only) */}
  {showReopenModal && (
    <div className="bg-warning-bg border border-warning-border rounded-card p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <div className="flex-1">
        <p className="text-body font-medium text-warning">Reopen this task?</p>
        <p className="text-meta text-warning mt-0.5">As the task creator, a reason is required.</p>
        <textarea
          value={reopenReason}
          onChange={(e) => setReopenReason(e.target.value)}
          placeholder="Reason for reopening (required)"
          rows={2}
          className="mt-2 w-full border border-warning-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden bg-surface focus:border-warning resize-none"
        />
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          onClick={() => handleReopen(reopenReason)}
          disabled={!reopenReason.trim()}
          loading={actionLoading === 'reopen'}
          loadingLabel="Reopening"
          className="bg-warning border-warning text-primary-foreground hover:bg-warning hover:border-warning"
        >
          Confirm Reopen
        </Button>
        <Button variant="secondary" onClick={() => { setShowReopenModal(false); setReopenReason('') }}>
          Cancel
        </Button>
      </div>
    </div>
  )}

  {/* Owner heads-up before force-completing the whole all_must task while some
      parts are still pending. */}
  {confirmCompleteAll && (
    <div className="bg-success-bg border border-success-border rounded-card p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <div className="flex-1">
        <p className="text-body font-medium text-success">Complete the whole task?</p>
        <p className="text-meta text-success mt-0.5">
          Heads up — {pendingNames.slice(0, 3).join(', ')}
          {pendingNames.length > 3 ? ` +${pendingNames.length - 3} more` : ''}{' '}
          {pendingNames.length === 1 ? "hasn't" : "haven't"} completed their part. As the task owner,
          completing now closes it for everyone.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          onClick={handleCompleteWholeTask}
          loading={actionLoading === 'complete'}
          loadingLabel="Completing"
          className="bg-success border-success text-primary-foreground hover:bg-success hover:border-success"
        >
          Complete for everyone
        </Button>
        <Button variant="secondary" onClick={() => setConfirmCompleteAll(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )}

  {/* Mark-incomplete reason box — required remark for closing the task (or my part)
      as not-done. Shown for both any_can_complete (whole task) and all_must_complete
      (my_part, or the creator closing the whole task). */}
  {incompleteTarget && (
    <div className="bg-danger-bg border border-danger-border rounded-card p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <div className="flex-1">
        <p className="text-body font-medium text-danger">
          {incompleteTarget === 'my_part' ? "Can't complete your part?" : 'Mark this task incomplete?'}
        </p>
        <p className="text-meta text-danger mt-0.5">
          {incompleteTarget === 'my_part'
            ? 'Your part will be flagged as not-done. A reason is required — the task creator will decide how to close the task.'
            : isAllMustComplete && pendingNames.length > 0
              ? `Heads up — ${pendingNames.slice(0, 3).join(', ')}${pendingNames.length > 3 ? ` +${pendingNames.length - 3} more` : ''} ${pendingNames.length === 1 ? "hasn't" : "haven't"} finished. As the task owner, this closes it as not-done for everyone. A reason is required.`
              : 'The task will be closed as not-done. A reason is required.'}
        </p>
        <textarea
          value={incompleteReason}
          onChange={(e) => setIncompleteReason(e.target.value)}
          placeholder="Reason (required)"
          rows={2}
          autoFocus
          className="mt-2 w-full border border-danger-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden bg-surface focus:border-danger resize-none"
        />
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          variant="danger"
          onClick={incompleteTarget === 'my_part' ? handleFlagMyPart : handleMarkIncomplete}
          disabled={!incompleteReason.trim()}
          loading={actionLoading === 'incomplete' || actionLoading === 'flag'}
          loadingLabel="Saving"
        >
          {incompleteTarget === 'my_part' ? "Flag my part" : 'Confirm Incomplete'}
        </Button>
        <Button variant="secondary" onClick={() => { setIncompleteTarget(null); setIncompleteReason('') }}>
          Cancel
        </Button>
      </div>
    </div>
  )}

  {/* Delete confirmation */}
  {showDeleteConfirm && (
    <div className="bg-danger-bg border border-danger-border rounded-card p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <div className="flex-1">
        <p className="text-body font-medium text-danger">Delete this task?</p>
        <input
          type="text"
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          placeholder="Reason for deletion (required)"
          autoFocus
          className="mt-2 w-full border border-danger-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden bg-surface focus:border-danger"
        />
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          variant="danger"
          onClick={handleDelete}
          disabled={!deleteReason.trim()}
          loading={actionLoading === 'delete'}
          loadingLabel="Deleting"
        >
          Confirm Delete
        </Button>
        <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )}
    </>
  )
}
