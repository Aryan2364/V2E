'use client'

import { useState } from 'react'
import { getInitials, avatarColor } from '@/lib/tasks/format'
import { Button } from '@/components/ui/button'
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format'
import Tooltip from '@/components/ui/tooltip'
import StyledSelect from '@/components/ui/StyledSelect'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import type { SelectedAssignee } from '@/lib/types/tasks'
import type { TaskDetailCtx } from './types'
import type { TaskDetailPanels } from './useTaskDetailPanels'

export function TaskAssigneesCard({ ctx, panels }: { ctx: TaskDetailCtx; panels: TaskDetailPanels }) {
  const { d, task, orgId, user, openStatuses, flags } = ctx
  const { actionLoading } = d
  const { assignees, ccUsers, canManageCc, canEditRoster, canEdit, isAllMustComplete, notStartedId } = flags
  const [editingAssignees, setEditingAssignees] = useState(false)
  const [editAssigneesList, setEditAssigneesList] = useState<SelectedAssignee[]>([])
  const [savingAssignees, setSavingAssignees] = useState(false)
  const [assigneeError, setAssigneeError] = useState<string | null>(null)
  // Reopening ONE assignee's finished part (all_must_complete): whose, + an optional note.
  const [reopenPartTarget, setReopenPartTarget] = useState<string | null>(null)
  const [reopenPartReason, setReopenPartReason] = useState('')

  const handleAssigneeRowStatus = d.changeAssigneeTrack
  const handleCompleteAssignee = (userId: string) => panels.guard(() => d.completeAssignee(userId))
  // Assigner reopens ONE person's finished part for rework (all_must_complete). Others untouched.
  const handleReopenAssigneePart = (userId: string) =>
    panels.guard(() =>
      d.reopenAssigneePart(userId, reopenPartReason, { onApplied: () => { setReopenPartTarget(null); setReopenPartReason('') } }),
    )

  async function handleSaveAssignees() {
    // A task must have someone to actually do the work - at least one primary
    // (non-CC) assignee. A CC-only assignment is not allowed.
    if (editAssigneesList.filter((a) => !a.is_cc).length === 0) {
      setAssigneeError('At least one assignee is required — CC-only is not allowed. Someone must be responsible for the work.')
      return
    }
    setAssigneeError(null)
    setSavingAssignees(true)
    try {
      // ONE atomic call that reconciles the whole roster (see useTaskDetail.saveRoster).
      await d.saveRoster(editAssigneesList, canEditRoster)
      setEditingAssignees(false)
    } catch (e) {
      // Surface the server's real reason (outside your assignable set, not eligible
      // to hold a task, task is closed) instead of failing silently.
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
      setAssigneeError(
        (Array.isArray(m) ? m[0] : m) || 'Could not save those changes. Please try again.',
      )
    } finally {
      setSavingAssignees(false)
    }
  }

  return (
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-success-bg border-b border-success-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <p className="text-meta font-medium text-success uppercase tracking-widest">Assignees</p>
            </div>
            {/* The creator / admin may change who the work is assigned to; anyone
                on the task may manage CC (see canManageCc). */}
            {canManageCc && (!editingAssignees ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-success hover:text-success"
                onClick={() => {
                  setEditAssigneesList((task.assignees ?? []).map((a) => ({
                    user_id: a.user_id,
                    name: a.user?.name ?? a.user_name ?? 'Unknown',
                    is_cc: a.is_cc,
                  })))
                  setAssigneeError(null)
                  setEditingAssignees(true)
                }}
              >
                Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="bg-success border-success text-primary-foreground hover:bg-success hover:border-success"
                  onClick={handleSaveAssignees}
                  loading={savingAssignees}
                  loadingLabel="Saving"
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEditingAssignees(false); setAssigneeError(null) }}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
          <div className="p-4">
            {editingAssignees ? (
              <div className="space-y-2">
                {canEditRoster ? (
                  <>
                    <AssigneeSelector
                      orgId={orgId}
                      value={editAssigneesList}
                      onChange={(v) => { setEditAssigneesList(v); if (assigneeError) setAssigneeError(null) }}
                      currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                    />
                    <p className="text-meta text-text-secondary">
                      Click someone&apos;s badge to switch them between Assignee and CC — they keep their progress.
                    </p>
                  </>
                ) : (
                  /* CC-only: this person may loop others in but not reassign the
                     work, so the working assignees stay read-only. They're kept in
                     the list that gets saved, so nothing is dropped. */
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {editAssigneesList.filter((a) => !a.is_cc).map((a) => (
                        <span
                          key={a.user_id}
                          className="inline-flex items-center rounded-full border border-border-light bg-surface-sunken px-2.5 py-1 text-body text-text-primary"
                        >
                          {a.name}
                        </span>
                      ))}
                    </div>
                    <AssigneeSelector
                      orgId={orgId}
                      value={editAssigneesList.filter((a) => a.is_cc)}
                      onChange={(v) => {
                        setEditAssigneesList([
                          ...editAssigneesList.filter((a) => !a.is_cc),
                          ...v.map((x) => ({ ...x, is_cc: true })),
                        ])
                        if (assigneeError) setAssigneeError(null)
                      }}
                      currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                    />
                    <p className="text-meta text-text-secondary">
                      You can CC people in. Changing who the task is assigned to is up to{' '}
                      {task.created_by?.name ?? 'whoever assigned it'}.
                    </p>
                  </>
                )}
                {assigneeError && (
                  <p className="text-meta text-danger bg-danger-bg border border-danger-border rounded-control px-2.5 py-2">
                    {assigneeError}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {assignees.map((a) => {
                  const name = a.user?.name ?? a.user_name ?? 'Unknown'
                  const email = a.user?.email ?? a.user_email ?? ''
                  const overdue = !!a.is_overdue
                  // Creator/admin can drive any person's track — but only in per-person mode,
                  // and not once the person has closed their part as incomplete (final).
                  const editable = !!canEdit && isAllMustComplete && !a.is_completed && !a.cannot_complete
                  const trackColor = a.status?.color ?? 'var(--text-muted)'
                  const trackLabel = a.status?.label ?? 'Not Started'
                  return (
                    <div key={a.id} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                          {getInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-body font-medium text-text-primary truncate">{name}</p>
                          <p className="text-meta text-text-secondary truncate">{email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {overdue && (
                            <span className="text-meta font-medium uppercase tracking-wide bg-danger-bg text-danger border border-danger-border rounded-xs px-1.5 py-0.5">
                              Overdue
                            </span>
                          )}
                          {/* Only the narrow, glanceable chips sit beside the name so it
                              keeps full width. The editable select + Done drop to their
                              own row below. */}
                          {isAllMustComplete && (
                            a.is_completed ? (
                              // Chip + a Reopen link stacked beneath it (right-aligned) so the
                              // cluster stays narrow and never clips the name.
                              <div className="flex flex-col items-end gap-1">
                                <span className="flex items-center gap-1 text-meta font-medium text-success bg-success-bg border border-success-border rounded-full px-2 py-0.5">
                                  <CheckCircle2 size={12} /> Completed
                                </span>
                                {canEdit && reopenPartTarget !== a.user_id && (
                                  <Tooltip label={`Reopen ${name}'s part for rework`}>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => { setReopenPartReason(''); setReopenPartTarget(a.user_id) }}
                                    >
                                      <RotateCcw size={11} /> Reopen
                                    </Button>
                                  </Tooltip>
                                )}
                              </div>
                            ) : a.cannot_complete ? (
                              // Person closed their part as incomplete. Chip + a Challenge link
                              // stacked beneath (assigner disputes it and sends the work back).
                              <div className="flex flex-col items-end gap-1">
                                <span className="flex items-center gap-1 text-meta font-medium text-danger bg-danger-bg border border-danger-border rounded-full px-2 py-0.5">
                                  <XCircle size={12} /> Incomplete
                                </span>
                                {canEdit && reopenPartTarget !== a.user_id && (
                                  <Tooltip label={`Reopen ${name}'s part`}>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => { setReopenPartReason(''); setReopenPartTarget(a.user_id) }}
                                    >
                                      <RotateCcw size={11} /> Reopen
                                    </Button>
                                  </Tooltip>
                                )}
                              </div>
                            ) : !editable ? (
                              <span
                                className="text-meta font-medium rounded-full px-2 py-0.5"
                                style={{ backgroundColor: trackColor + '1A', color: trackColor, border: `1px solid ${trackColor}40` }}
                              >
                                {trackLabel}
                              </span>
                            ) : null
                          )}
                        </div>
                      </div>

                      {/* Inline controls for the creator/admin to move or finish this person's part. */}
                      {editable && (
                        <div className="flex items-center gap-2">
                          <StyledSelect
                            size="sm"
                            value={a.status_id ?? notStartedId}
                            onChange={(v) => handleAssigneeRowStatus(a.user_id, v)}
                            options={openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                            wrapperClassName="flex-1 min-w-0"
                          />
                          <Tooltip label={`Mark ${name}'s part complete`}>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="shrink-0 border-success-border text-success hover:bg-success-bg"
                              onClick={() => handleCompleteAssignee(a.user_id)}
                              loading={actionLoading === `complete-${a.user_id}`}
                              loadingLabel="…"
                            >
                              <CheckCircle2 size={12} /> Done
                            </Button>
                          </Tooltip>
                        </div>
                      )}

                      {/* Reopen / challenge reason box — optional feedback for the person. */}
                      {reopenPartTarget === a.user_id && (
                        <div className="rounded-control border border-primary-border bg-primary-subtle p-2.5">
                          <p className="text-meta font-medium text-primary-text mb-1.5">Reopen {name}&apos;s part — add a note (optional)</p>
                          <textarea
                            value={reopenPartReason}
                            onChange={(e) => setReopenPartReason(e.target.value.slice(0, 500))}
                            rows={2}
                            autoFocus
                            placeholder="What would you like them to do?"
                            className="w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden resize-none"
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleReopenAssigneePart(a.user_id)}
                              loading={actionLoading === `reopen-part-${a.user_id}`}
                              loadingLabel="Reopening"
                            >
                              <RotateCcw size={12} /> Reopen part
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setReopenPartTarget(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {ccUsers.length > 0 && (
                  <>
                    <p className="text-meta font-medium text-text-muted uppercase tracking-wide pt-1">CC</p>
                    {ccUsers.map((a) => {
                      const name = a.user?.name ?? a.user_name ?? 'Unknown'
                      const email = a.user?.email ?? a.user_email ?? ''
                      return (
                        <div key={a.id} className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0`}>
                            {getInitials(name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-body font-medium text-text-primary truncate">{name}</p>
                            {email && <p className="text-meta text-text-secondary truncate">{email}</p>}
                          </div>
                          <span className="text-meta font-medium bg-warning-bg text-warning border border-warning-border rounded-xs px-1.5 py-0.5">CC</span>
                        </div>
                      )
                    })}
                  </>
                )}
                {/* People taken off the task. Removal is soft on purpose: the
                    record that someone held this task has to survive, or a person
                    who was already late could be quietly removed into a clean
                    scorecard. They're excluded from every count and gate above. */}
                {(task.removed_assignees?.length ?? 0) > 0 && (
                  <>
                    <p className="text-meta font-medium text-text-muted uppercase tracking-wide pt-1">
                      Previously on this task
                    </p>
                    {task.removed_assignees!.map((a) => {
                      const name = a.user?.name ?? a.user_name ?? 'Unknown'
                      return (
                        <div key={a.id} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface-control-pressed flex items-center justify-center text-text-secondary text-meta font-medium shrink-0">
                            {getInitials(name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-body font-medium text-text-secondary truncate">{name}</p>
                            <p className="text-meta text-text-secondary truncate">
                              {a.is_cc ? 'CC · ' : ''}
                              {a.removed_at ? `Removed ${formatDate(a.removed_at)}` : 'Removed'}
                              {a.removed_by?.name ? ` by ${a.removed_by.name}` : ''}
                            </p>
                          </div>
                          {a.is_completed && (
                            <span className="text-meta font-medium bg-success-bg text-success border border-success-border rounded-xs px-1.5 py-0.5">
                              Had finished
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
                {assignees.length === 0 && ccUsers.length === 0 && (
                  <p className="text-body text-text-secondary">No assignees yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
  )
}
