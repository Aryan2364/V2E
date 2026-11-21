'use client'

import { formatCountdown } from '@/lib/tasks/format'
import { Button } from '@/components/ui/button'
import { MARK_TASK, MARK_MY_PART } from './constants'
import { CheckCircle2, XCircle } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format'
import StyledSelect from '@/components/ui/StyledSelect'
import { HoverList } from './HoverList'
import type { TaskDetailCtx } from './types'
import type { TaskDetailPanels } from './useTaskDetailPanels'

export function TaskStatusCard({ ctx, panels }: { ctx: TaskDetailCtx; panels: TaskDetailPanels }) {
  const { d, task, flags, openStatuses, reopenSecondsLeft } = ctx
  const { isTaskTerminal, isIncompleteStatus, isPartiallyCompletedStatus, assignees, isAllMustComplete, isAssignee, myAssignee, canEdit, myTrackId, completedCount, totalAssignees, blockedCount, pendingCount, canMoveSharedStatus, isCreator } = flags
  const { selectedStatusId } = d
  const { setIncompleteReason, setIncompleteTarget } = panels
  const handleSharedStatusChange = d.changeSharedStatus
  const handleMyTrackChange = d.changeMyTrack
  return (
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-visible">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-subtle border-b border-primary-border rounded-t-[12px]">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <p className="text-meta font-medium text-primary-text uppercase tracking-widest">Status</p>
          </div>
          <div className="p-4">
            {isTaskTerminal && task.status ? (
              // Task is closed overall — read-only, with who completed it.
              <div>
                <span
                  className="inline-flex items-center rounded-[999px] px-3 py-1 text-body font-medium"
                  style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                >
                  {task.status.label}
                </span>

                {isIncompleteStatus ? (
                  // Incomplete is one deliberate call by the owner — single attribution is correct.
                  <>
                    {task.completed_by && (
                      <p className="mt-2 text-meta text-text-secondary">
                        Marked incomplete by <span className="font-medium text-text-primary">{task.completed_by.name}</span>
                        {task.completed_at && <span className="text-text-muted"> · {formatDate(task.completed_at)}</span>}
                      </p>
                    )}
                    {task.incomplete_reason && (
                      <p className="mt-2 text-meta text-warning bg-warning-bg border border-warning-border rounded-control px-3 py-2 whitespace-pre-wrap">
                        <span className="font-medium">Reason:</span> {task.incomplete_reason}
                      </p>
                    )}
                  </>
                ) : isPartiallyCompletedStatus ? (
                  // Partially completed — show BOTH who finished and who couldn't (+ their reasons).
                  (() => {
                    const done = assignees.filter((a) => a.is_completed)
                    const couldnt = assignees.filter((a) => a.cannot_complete)
                    return (
                      <>
                        <p className="mt-2 text-meta text-text-secondary">
                          <span className="font-medium text-text-primary">{done.length} of {assignees.length}</span> completed
                          {task.completed_at && <span className="text-text-muted"> · {formatDate(task.completed_at)}</span>}
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {done.map((a) => (
                            <li key={a.id} className="flex items-start gap-1.5 text-meta">
                              <CheckCircle2 size={13} className="text-success shrink-0 mt-px" />
                              <span className="font-medium text-text-primary min-w-0">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                            </li>
                          ))}
                          {couldnt.map((a) => (
                            <li key={a.id} className="flex items-start gap-1.5 text-meta">
                              <XCircle size={13} className="text-text-secondary shrink-0 mt-px" />
                              <span className="min-w-0">
                                <span className="font-medium text-text-primary">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                                {a.cannot_complete_reason && <span className="text-warning"> — {a.cannot_complete_reason}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )
                  })()
                ) : isAllMustComplete ? (
                  // Collective completion — EVERY part counts, not just whoever finished last.
                  (() => {
                    const doneParts = [...assignees]
                      .filter((a) => a.is_completed)
                      .sort((a, b) => new Date(a.completed_at ?? 0).getTime() - new Date(b.completed_at ?? 0).getTime())
                    return (
                      <>
                        <p className="mt-2 text-meta text-text-secondary">
                          Completed by{' '}
                          <span className="font-medium text-text-primary">
                            all {doneParts.length} assignee{doneParts.length !== 1 ? 's' : ''}
                          </span>
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {doneParts.map((a) => {
                            const nm = a.user?.name ?? a.user_name ?? 'Unknown'
                            return (
                              <li key={a.id} className="flex items-start gap-1.5 text-meta">
                                <CheckCircle2 size={13} className="text-success shrink-0 mt-px" />
                                <span className="min-w-0">
                                  <span className="font-medium text-text-primary">{nm}</span>
                                  {a.completed_at && <span className="text-text-muted"> · {formatDate(a.completed_at)}</span>}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )
                  })()
                ) : (
                  // any_can_complete — one person closes it for everyone; single name is right.
                  task.completed_by && (
                    <p className="mt-2 text-meta text-text-secondary">
                      Completed by <span className="font-medium text-text-primary">{task.completed_by.name}</span>
                      {task.completed_at && <span className="text-text-muted"> · {formatDate(task.completed_at)}</span>}
                    </p>
                  )
                )}

                <p className="mt-1 text-meta text-text-muted">
                  {reopenSecondsLeft > 0
                    ? `You can undo this for the next ${formatCountdown(reopenSecondsLeft)}. After that it locks.`
                    : isCreator
                      ? 'Reopen the task to change its status.'
                      : 'This task is locked. Only the task creator can reopen it.'}
                </p>
              </div>
            ) : isAllMustComplete ? (
              <>
              {isAssignee ? (
                // My own status track — moves only my part. Once MY part is done, the
                // track control no longer applies to me (there's no open state left to
                // pick) — show a read-only "done" chip instead of a select that looks
                // unset and silently no-ops on change.
                myAssignee?.is_completed ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-[999px] px-3 py-1 text-body font-medium text-success bg-success-bg border border-success-border">
                      <CheckCircle2 size={14} /> Your part is done
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 text-danger hover:text-danger"
                        onClick={() => { setIncompleteReason(''); setIncompleteTarget('task') }}
                      >
                        <XCircle size={13} />
                        Mark whole task incomplete
                      </Button>
                    )}
                    <p className="mt-2 text-meta text-text-muted">Everyone&apos;s progress is shown in Assignees below.</p>
                  </>
                ) : (
                  <>
                    <StyledSelect
                      value={myTrackId}
                      onChange={(v) => {
                        if (v === MARK_MY_PART) { setIncompleteReason(''); setIncompleteTarget('my_part') }
                        else if (v === MARK_TASK) { setIncompleteReason(''); setIncompleteTarget('task') }
                        else handleMyTrackChange(v)
                      }}
                      options={[
                        ...openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
                        { value: MARK_MY_PART, label: "Can't complete (my part)", variant: 'danger' as const, divider: true, action: true },
                        ...(canEdit ? [{ value: MARK_TASK, label: 'Mark whole task incomplete', variant: 'danger' as const, divider: true, action: true }] : []),
                      ]}
                    />
                    <p className="mt-2 text-meta text-text-muted">This is <span className="font-medium text-text-muted">your</span> status. Everyone&apos;s progress is shown in Assignees below.</p>
                  </>
                )
              ) : (
                // Creator/admin without a personal part — read-only overall roll-up, plus
                // the owner's "Mark task incomplete" action (kept inside the Status card).
                <>
                  {task.status && (
                    <span
                      className="inline-flex items-center rounded-[999px] px-3 py-1 text-body font-medium"
                      style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                    >
                      {task.status.label}
                    </span>
                  )}
                  <p className="mt-2 text-meta text-text-secondary">
                    <HoverList
                      heading="Completed"
                      className="font-medium text-text-primary"
                      trigger={<>{completedCount} of {totalAssignees}</>}
                      items={completedCount > 0
                        ? assignees.filter((a) => a.is_completed).map((a) => a.user?.name ?? a.user_name ?? 'Unknown')
                        : ['No parts completed yet']}
                    /> parts done
                    {blockedCount > 0 && (
                      <> · <span className="text-danger">{blockedCount} incomplete</span></>
                    )}
                    {pendingCount > 0 && (
                      <> · <HoverList
                        heading="Pending"
                        className="text-text-muted"
                        trigger={<>{pendingCount} pending</>}
                        items={assignees.filter((a) => !a.is_completed && !a.cannot_complete).map((a) => a.user?.name ?? a.user_name ?? 'Unknown')}
                      /></>
                    )}
                  </p>
                  {blockedCount > 0 && canEdit && (
                    <p className="mt-1 text-meta text-danger">A part was closed incomplete — reassign it, or close the whole task incomplete.</p>
                  )}
                  <p className="mt-1 text-meta text-text-muted">Set each person&apos;s status in Assignees below.</p>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-danger hover:text-danger"
                      onClick={() => { setIncompleteReason(''); setIncompleteTarget('task') }}
                    >
                      <XCircle size={13} />
                      Mark task incomplete
                    </Button>
                  )}
                </>
              )}

              {/* Why the task is stalled — one quiet, shared note (everyone sees it here,
                  so no one has to hunt in Assignees or hover). Subordinate to the status
                  pill: a left accent, not a filled alert box. Read-only — the person's
                  choice to close their part is final. */}
              {blockedCount > 0 && (
                <div className="mt-3 border-l-2 border-danger-border pl-2.5 space-y-1.5">
                  {assignees.filter((a) => a.cannot_complete && !a.is_completed).map((a) => (
                    <p key={a.id} className="text-meta leading-snug">
                      <span className="font-medium text-danger">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                      <span className="text-danger"> marked it incomplete</span>
                      {a.cannot_complete_reason && (
                        <span className="block italic text-danger whitespace-pre-wrap">“{a.cannot_complete_reason}”</span>
                      )}
                    </p>
                  ))}
                </div>
              )}
              </>
            ) : (
              // Shared status (any_can_complete) — anyone on the task can move it; the
              // "Incomplete" close sits at the bottom of the same dropdown.
              <>
                {canMoveSharedStatus ? (
                  <StyledSelect
                    value={selectedStatusId}
                    onChange={(v) => {
                      if (v === MARK_TASK) { setIncompleteReason(''); setIncompleteTarget('task') }
                      else handleSharedStatusChange(v)
                    }}
                    options={[
                      ...openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
                      { value: MARK_TASK, label: 'Incomplete', variant: 'danger' as const, divider: true, action: true },
                    ]}
                  />
                ) : (
                  task.status && (
                    <span
                      className="inline-flex items-center rounded-[999px] px-3 py-1 text-body font-medium"
                      style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                    >
                      {task.status.label}
                    </span>
                  )
                )}
                {task.status_actor && (
                  <p className="mt-2 text-meta text-text-muted">
                    Changed by <span className="font-medium text-text-secondary">{task.status_actor.name}</span>
                    {task.status && (
                      <> to <span className="font-medium text-text-secondary">{task.status.label}</span></>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
  )
}
