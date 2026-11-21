'use client'

import { formatCountdown } from '@/lib/tasks/format'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shell/page-header'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CheckCircle2, RotateCcw, Trash2, Pencil, History, MoreVertical, XCircle } from 'lucide-react'
import { formatDate as fmtDateOnly } from '@/lib/format'
import Tooltip from '@/components/ui/tooltip'
import type { TaskDetailCtx } from './types'
import type { TaskDetailPanels } from './useTaskDetailPanels'

export function TaskDetailHeader({ ctx, panels, canDelete }: { ctx: TaskDetailCtx; panels: TaskDetailPanels; canDelete: boolean }) {
  const { d, task, flags, reopenSecondsLeft } = ctx
  const { actionLoading } = d
  const { isFutureTask, canEdit, isTaskTerminal, currentUserIsCC, isAllMustComplete, isAssignee, myAssignee, pendingNames, isCreator, isIncompleteStatus, completedCount, totalAssignees } = flags
  const { setShowEditModal, setShowActivity, showDeleteConfirm, setShowDeleteConfirm, setConfirmCompleteAll, setShowReopenModal, handleComplete, handleCompleteWholeTask, handleReopen } = panels
  return (
    <>
  {isFutureTask && (
    <div className="bg-danger-bg border border-danger-border rounded-control px-6 py-4 text-body font-medium text-danger shrink-0">
      This task was created in a simulated future ({fmtDateOnly(task.created_at)}). To interact with it, please time-travel to this date or later.
    </div>
  )}
  {/* Header — breadcrumb + title through PageHeader (no back arrow, section 1.11);
      the task's many status-dependent action buttons stay in their own row below,
      since they are not a single "one primary action" PageHeader models. */}
  <PageHeader
    title={task.title}
    trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
    actions={
      canEdit ? (
        <Tooltip label="Edit task">
          <Button variant="ghost" size="icon-sm" aria-label="Edit task" onClick={() => setShowEditModal(true)}>
            <Pencil size={16} />
          </Button>
        </Tooltip>
      ) : undefined
    }
  />
  <div className="flex items-start justify-end gap-4 flex-wrap shrink-0 -mt-4">
    <div className="flex items-start gap-2 shrink-0">
      <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
      {!isTaskTerminal && !currentUserIsCC ? (
        isAllMustComplete ? (
          // Everyone must finish their own part — personal action(s) + a live counter.
          // (Incomplete / Can't-complete now live inside the Status dropdown.)
          <div className="flex items-center gap-2.5">
            {isAssignee && (
              myAssignee?.is_completed ? (
                <span className="flex items-center gap-2 px-3.5 py-[8px] text-body font-medium text-success bg-success-bg border border-success-border rounded-control select-none">
                  <CheckCircle2 size={15} />
                  You&apos;re done
                </span>
              ) : (
                <Button
                  onClick={handleComplete}
                  loading={actionLoading === 'complete'}
                  loadingLabel="Completing"
                  className="bg-success border-success text-primary-foreground hover:bg-success hover:border-success"
                >
                  <CheckCircle2 size={15} />
                  Complete my part
                </Button>
              )
            )}
            {/* Owner override — close the whole task for everyone (heads-up if pending). */}
            {canEdit && (
              <Tooltip label="Complete the whole task for everyone">
                <Button
                  variant="secondary"
                  onClick={() => (pendingNames.length > 0 ? setConfirmCompleteAll(true) : handleCompleteWholeTask())}
                  disabled={actionLoading === 'complete'}
                  className="border-success-border text-success hover:bg-success-bg"
                >
                  <CheckCircle2 size={15} />
                  Complete task
                </Button>
              </Tooltip>
            )}
          </div>
        ) : (
          // Any one assignee can close the whole task via Complete. (Incomplete lives
          // in the Status dropdown.)
          (isAssignee || canEdit) ? (
            <Button
              onClick={handleComplete}
              loading={actionLoading === 'complete'}
              loadingLabel="Completing"
              className="bg-success border-success text-primary-foreground hover:bg-success hover:border-success"
            >
              <CheckCircle2 size={15} />
              Complete
            </Button>
          ) : null
        )
      ) : !currentUserIsCC && (
        reopenSecondsLeft > 0 ? (
          // Undo window open — a frictionless, reason-free revert for any participant,
          // so an accidental Complete/Incomplete can be taken back. Locks when it ends.
          <Tooltip label="Undo — revert this task to open (no reason needed while the window is open)">
            <Button
              onClick={() => handleReopen()}
              loading={actionLoading === 'reopen'}
              loadingLabel="Undoing"
              className="bg-warning-bg border-warning-border text-warning hover:bg-warning-bg"
            >
              <RotateCcw size={15} />
              {`Undo (${formatCountdown(reopenSecondsLeft)})`}
            </Button>
          </Tooltip>
        ) : isCreator ? (
          // After the window it's locked — only the creator can reopen, with a reason.
          <Button
            onClick={() => setShowReopenModal(true)}
            disabled={actionLoading === 'reopen'}
            className="bg-warning-bg border-warning-border text-warning hover:bg-warning-bg"
          >
            <RotateCcw size={15} />
            Reopen
          </Button>
        ) : (
          // Locked outcome (read-only) for everyone else.
          <span
            className="flex items-center gap-2 px-4 py-[8px] text-body font-medium rounded-control cursor-default select-none"
            style={{
              backgroundColor: (task.status?.color ?? 'var(--text-muted)') + '1A',
              color: task.status?.color ?? 'var(--text-muted)',
              border: `1px solid ${(task.status?.color ?? 'var(--text-muted)')}44`,
            }}
          >
            {task.status?.type === 'completed' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {task.status?.label ?? (isIncompleteStatus ? 'Incomplete' : 'Completed')}
          </span>
        )
      )}
      </div>
      {/* Per-person completion counter — plain text, right-aligned directly under the button. */}
      {!isTaskTerminal && !currentUserIsCC && isAllMustComplete && totalAssignees > 0 && (
        <span className="text-meta font-medium text-text-secondary select-none">
          {completedCount}/{totalAssignees} completed
        </span>
      )}
      </div>
      {/* Overflow menu — holds the Activity log and the (destructive) Delete
          action, so neither gets a prominent primary button. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="secondary" size="icon" aria-label="More actions" />}
        >
          <MoreVertical size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowActivity(true)}>
            <History size={14} />
            Activity log
          </DropdownMenuItem>
          {canDelete && !showDeleteConfirm && (
            <DropdownMenuItem variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={14} />
              Delete task
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
    </>
  )
}
