'use client'

import React, { useState } from 'react'
import { CheckSquare, Check, Ban, ShieldCheck, RotateCcw, Users, X, ChevronDown } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Tooltip from '@/components/ui/Tooltip'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import { TERMINAL_STATUS_PHASES, type Task, type TaskChecklistItem, type TaskChecklistItemStateEntry } from '@/lib/types/tasks'

interface Props {
  task: Task
  orgId: string
  taskId: string
  currentUserId: string
  /** Assigner/admin — may override for everyone and challenge a person's item. */
  canEdit: boolean
  onChanged: (task: Task) => void
}

function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export default function TaskChecklistCard({ task, orgId, taskId, currentUserId, canEdit, onChanged }: Props) {
  const { addToast } = useToast()
  const items = task.checklist ?? []
  const isAllMust = task.completion_mode === 'all_must_complete'
  const isTerminal = !!task.status && TERMINAL_STATUS_PHASES.includes(task.status.type)
  const isFutureTask = task ? new Date(task.created_at) > getNow() : false
  const iAmWorker = (task.assignees ?? []).some((a) => a.user_id === currentUserId && !a.is_cc)

  // "Who has marked this" panel expands IN FLOW right under the item (never a
  // JS-positioned fixed portal — those drift on the page column's overflow-scroll).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [skipItem, setSkipItem] = useState<TaskChecklistItem | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const [challenge, setChallenge] = useState<{ item: TaskChecklistItem; userId: string; userName: string } | null>(null)

  if (items.length === 0) return null

  async function run(key: string, fn: () => Promise<Task>) {
    setBusy(key)
    try {
      const updated = await fn()
      onChanged(updated)
    } catch (e: any) {
      // Surface the backend's plain-English reason (e.g. the gate message) via the
      // app's own toast — never a native browser dialog.
      const msg = e?.response?.data?.message ?? e?.message ?? 'Something went wrong.'
      addToast(Array.isArray(msg) ? msg.join('\n') : msg, 'warning')
    } finally {
      setBusy(null)
    }
  }

  // Why a checkbox is disabled — an accurate tooltip instead of a misleading
  // "tick when done" on a control that can't be clicked.
  function disabledReason(): string | null {
    if (isTerminal) return 'This task is closed — reopen it to change the checklist.'
    if (isFutureTask) return 'This task hasn’t started yet.'
    return null
  }

  // ── Aggregate helpers (all_must) ──
  const workerCount = (task.assignees ?? []).filter((a) => !a.is_cc).length
  const resolvedCount = items.filter((it) => {
    if (isAllMust) return (it.done_count ?? 0) + (it.skipped_count ?? 0) >= (it.assignee_count ?? workerCount) && (it.assignee_count ?? workerCount) > 0
    return it.is_completed || !!it.cant_do
  }).length

  // Group items by section, preserving order (mirrors the old inline renderer).
  const order: string[] = []
  const byGroup = new Map<string, TaskChecklistItem[]>()
  for (const item of items) {
    const key = item.group_title ?? ''
    if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key) }
    byGroup.get(key)!.push(item)
  }
  const grouped = order.some((k) => k !== '')

  return (
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6 overflow-visible">
      <div className="flex items-center gap-2 mb-1">
        <CheckSquare size={16} className="text-primary-text" />
        <h3 className="text-[15px] font-semibold text-text-primary">Checklist</h3>
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-semibold">
          {resolvedCount}/{items.length}
        </span>
      </div>
      {isAllMust && (
        <p className="text-[13px] text-text-secondary mb-4 flex items-center gap-1.5">
          <Users size={13} className="text-text-muted" />
          Everyone must complete — each person ticks their own. Counts show how many of {workerCount} are done.
        </p>
      )}

      <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
        {order.map((key) => {
          const groupItems = byGroup.get(key)!
          return (
            <div key={key || '__ungrouped'} className="space-y-2">
              {grouped && (
                <div className="text-[13px] font-semibold text-text-secondary">{key || 'Checklist'}</div>
              )}
              {groupItems.map((item) =>
                isAllMust
                  ? renderAllMustItem(item)
                  : renderSharedItem(item),
              )}
            </div>
          )
        })}
      </div>

      {/* Skip (can't do) reason dialog */}
      <Modal isOpen={!!skipItem} onClose={() => setSkipItem(null)} title="Can’t do this item" size="sm" closeOnEscape={false}>
        <p className="text-[14px] text-text-secondary mb-3">
          Tell everyone why this step can’t be done. It counts toward finishing your part, and stays visible with your reason.
        </p>
        <textarea
          value={skipReason}
          onChange={(e) => setSkipReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Reason (required)"
          className="w-full rounded-[8px] border border-border focus:border-primary focus:outline-hidden focus:ring-0 px-3 py-2 text-[15px] text-text-primary placeholder:text-text-muted"
        />
        <div className="flex justify-end mt-4">
          <button
            onClick={() =>
              skipItem &&
              run(`skip:${skipItem.id}`, () =>
                tasksApi.skipChecklistItem(orgId, taskId, skipItem.id, skipReason.trim()),
              ).then(() => { setSkipItem(null); setSkipReason('') })
            }
            disabled={!skipReason.trim() || busy === `skip:${skipItem?.id}`}
            className="px-5 py-2.5 rounded-[8px] font-semibold text-white bg-warning hover:bg-warning disabled:bg-surface-control-pressed disabled:text-text-muted"
          >
            {busy === `skip:${skipItem?.id}` ? 'Saving…' : 'Mark can’t do'}
          </button>
        </div>
      </Modal>

      {/* Challenge confirm — reopens the person's part */}
      <Modal isOpen={!!challenge} onClose={() => setChallenge(null)} title="Reopen this item?" size="sm">
        <p className="text-[14px] text-text-primary">
          This reopens the task for <span className="font-semibold">{challenge?.userName}</span> so they can address
          {' '}<span className="font-semibold">“{challenge?.item.title}”</span>. Their other finished items stay as they are.
        </p>
        <div className="flex justify-end mt-4">
          <button
            onClick={() =>
              challenge &&
              run(`challenge:${challenge.item.id}:${challenge.userId}`, () =>
                tasksApi.challengeChecklistItem(orgId, taskId, challenge.item.id, challenge.userId),
              ).then(() => setChallenge(null))
            }
            disabled={!!challenge && busy === `challenge:${challenge.item.id}:${challenge.userId}`}
            className="px-5 py-2.5 rounded-[8px] font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted"
          >
            Reopen &amp; challenge
          </button>
        </div>
      </Modal>

    </div>
  )

  /** In-flow "who has marked this" panel — rendered inside the item's own container so
   *  it scrolls with the card and can never drift off its anchor. */
  function renderWhoPanel(item: TaskChecklistItem) {
    const workers = (task.assignees ?? []).filter((a) => !a.is_cc)
    const states = item.states ?? []
    return (
      <div className="mt-1.5 ml-7 mr-2 rounded-[8px] border border-border-light bg-surface-sunken overflow-hidden">
        <div className="max-h-[240px] overflow-y-auto divide-y divide-surface-control">
          {workers.length === 0 && <div className="px-3 py-2 text-[12px] text-text-muted">No assignees yet</div>}
          {workers.map((a) => {
            const st = states.find((s) => s.user_id === a.user_id)
            return (
              <PersonRow
                key={a.user_id}
                name={a.user?.name ?? a.user_name ?? a.user_id}
                state={st}
                canChallenge={canEdit && !!st && !isFutureTask}
                onChallenge={() => {
                  setExpandedId(null)
                  setChallenge({ item, userId: a.user_id, userName: a.user?.name ?? a.user_name ?? 'this person' })
                }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  function renderSharedItem(item: TaskChecklistItem) {
    const done = item.is_completed
    const cantDo = !!item.cant_do
    const key = `shared:${item.id}`
    const canAct = !isTerminal && (iAmWorker || canEdit) && !isFutureTask
    return (
      <div key={item.id} className="flex items-start gap-3">
        <Tooltip
          label={
            !canAct
              ? (disabledReason() ?? 'Only an assignee can tick this item.')
              : cantDo ? 'Marked can’t-do — click to tick as done' : done ? 'Done — click to untick' : 'Tick when done'
          }
        >
          <button
            type="button"
            disabled={!canAct || busy === key}
            onClick={() =>
              run(key, () =>
                done
                  ? tasksApi.uncheckChecklistItem(orgId, taskId, item.id)
                  : tasksApi.checkChecklistItem(orgId, taskId, item.id),
              )
            }
            className={[
              'mt-0.5 w-4 h-4 rounded-sm border-2 shrink-0 flex items-center justify-center transition-colors',
              done ? 'bg-success border-success' : cantDo ? 'bg-warning border-warning' : 'border-border hover:border-primary',
              !canAct ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
            role="checkbox"
            aria-checked={done}
          >
            {done && <Check size={11} className="text-white" strokeWidth={3} />}
            {cantDo && <Ban size={10} className="text-white" strokeWidth={2.5} />}
          </button>
        </Tooltip>

        <div className="flex-1 min-w-0">
          <span className={`text-sm ${done ? 'line-through text-text-muted' : cantDo ? 'line-through text-warning' : 'text-text-primary'}`}>
            {item.title}
          </span>
          {done && item.completed_by?.name && (
            <span className="text-[12px] text-text-muted"> · {item.completed_by.name}</span>
          )}
          {cantDo && item.cant_do_reason && (
            <p className="text-[12px] text-warning mt-0.5">Can’t do — {item.cant_do_reason}</p>
          )}
        </div>

        {/* Right-aligned "can't do" / clear */}
        {canAct && (
          cantDo ? (
            <button
              type="button"
              onClick={() => run(key, () => tasksApi.uncheckChecklistItem(orgId, taskId, item.id))}
              className="shrink-0 mt-0.5 text-[12px] font-medium text-text-secondary hover:underline"
            >
              Clear can’t-do
            </button>
          ) : !done ? (
            <Tooltip label="Can’t do this">
              <button
                type="button"
                onClick={() => { setSkipItem(item); setSkipReason('') }}
                aria-label="Can’t do this"
                className="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-[6px] text-warning hover:bg-warning-bg transition-colors"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </Tooltip>
          ) : null
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  function renderAllMustItem(item: TaskChecklistItem) {
    const doneCount = item.done_count ?? 0
    const skippedCount = item.skipped_count ?? 0
    const total = item.assignee_count ?? workerCount
    const allResolved = doneCount + skippedCount >= total && total > 0
    const states = item.states ?? []
    // Derive MY state from the per-person states (keyed by user id) rather than the
    // server's `my_state` — that field is only populated on a principal-aware read, so a
    // post-save refresh would otherwise drop my own tick even though it was saved.
    const mine = states.find((s) => s.user_id === currentUserId)
    const my = mine?.state ?? item.my_state ?? null
    const myReason = mine?.reason ?? item.my_reason ?? null
    const overridden = states.some((s) => s.is_override)
    const rowBusy = busy?.startsWith(`amust:${item.id}`)

    return (
      <div key={item.id} className="rounded-[8px] border border-transparent hover:border-border-light hover:bg-surface-sunken transition-colors">
        <div className="flex items-start gap-3 px-2 py-1.5">
          {/* Personal checkbox / state — only working assignees act here */}
          {iAmWorker ? (
            <Tooltip
              label={
                (isTerminal || isFutureTask)
                  ? (disabledReason() ?? '')
                  : my === 'done' ? 'Done — click to untick' : my === 'skipped' ? 'You marked this can’t-do' : 'Tick when you’ve done it'
              }
            >
              <button
                type="button"
                disabled={isTerminal || !!rowBusy || isFutureTask}
                onClick={() =>
                  run(`amust:${item.id}:self`, () =>
                    my === 'done'
                      ? tasksApi.uncheckChecklistItem(orgId, taskId, item.id)
                      : tasksApi.checkChecklistItem(orgId, taskId, item.id),
                  )
                }
                className={[
                  'mt-0.5 w-4 h-4 rounded-sm border-2 shrink-0 flex items-center justify-center transition-colors',
                  my === 'done'
                    ? 'bg-success border-success'
                    : my === 'skipped'
                      ? 'bg-warning border-warning'
                      : 'border-border hover:border-primary',
                  isTerminal || isFutureTask ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
                role="checkbox"
                aria-checked={my === 'done'}
              >
                {my === 'done' && <Check size={11} className="text-white" strokeWidth={3} />}
                {my === 'skipped' && <Ban size={10} className="text-white" strokeWidth={2.5} />}
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="You’re not a working assignee on this task">
              <span className="mt-0.5 w-4 h-4 rounded-xs border-2 border-dashed border-border shrink-0" />
            </Tooltip>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm ${my === 'done' ? 'text-text-secondary' : my === 'skipped' ? 'line-through text-warning' : 'text-text-primary'}`}>
                {item.title}
              </span>

              {/* Aggregate badge — click to expand an in-flow list of who has marked it */}
              <button
                type="button"
                onClick={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
                className={[
                  'inline-flex items-center gap-1 h-[20px] px-2 rounded-full text-[11px] font-semibold cursor-pointer transition-colors',
                  allResolved ? 'bg-success-bg text-success border border-success-border' : 'bg-primary-subtle text-primary-text border border-primary-border',
                ].join(' ')}
                aria-label="Who has marked this item"
                aria-expanded={expandedId === item.id}
              >
                <Check size={11} strokeWidth={3} />
                {doneCount}/{total}
                {skippedCount > 0 && <span className="text-warning">· {skippedCount} can’t-do</span>}
                {overridden && <ShieldCheck size={11} className="text-primary-text" />}
                <ChevronDown size={11} className={expandedId === item.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            </div>

            {/* My own skip reason, always visible inline */}
            {my === 'skipped' && myReason && (
              <p className="text-[12px] text-warning mt-0.5">Can’t do — {myReason}</p>
            )}
          </div>

          {/* Personal "can't do" / clear — pinned to the right end of the line */}
          {iAmWorker && !isTerminal && !isFutureTask && (
            my !== 'skipped' ? (
              <Tooltip label="Can’t do this">
                <button
                  type="button"
                  onClick={() => { setSkipItem(item); setSkipReason('') }}
                  aria-label="Can’t do this"
                  className="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-[6px] text-warning hover:bg-warning-bg transition-colors"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={() => run(`amust:${item.id}:self`, () => tasksApi.uncheckChecklistItem(orgId, taskId, item.id))}
                className="shrink-0 mt-0.5 text-[12px] font-medium text-text-secondary hover:underline"
              >
                Clear can’t-do
              </button>
            )
          )}

          {/* Assigner override control */}
          {canEdit && !isTerminal && !isFutureTask && (
            overridden ? (
              <Tooltip label="Undo done-for-everyone">
                <button
                  type="button"
                  disabled={!!rowBusy}
                  onClick={() => run(`amust:${item.id}:clearoverride`, () => tasksApi.clearChecklistOverride(orgId, taskId, item.id))}
                  className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary hover:text-text-primary px-2 py-1 rounded-[6px] hover:bg-surface-control"
                >
                  <RotateCcw size={12} /> Undo override
                </button>
              </Tooltip>
            ) : (
              <Tooltip label="Mark done for everyone">
                <button
                  type="button"
                  disabled={!!rowBusy}
                  onClick={() => run(`amust:${item.id}:override`, () => tasksApi.overrideChecklistItem(orgId, taskId, item.id))}
                  className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-primary-text hover:text-primary-text px-2 py-1 rounded-[6px] hover:bg-primary-subtle"
                >
                  <ShieldCheck size={12} /> Done for all
                </button>
              </Tooltip>
            )
          )}
        </div>

        {/* In-flow "who marked this" list — part of the item, so it never drifts */}
        {expandedId === item.id && renderWhoPanel(item)}
      </div>
    )
  }
}

function PersonRow({
  name,
  state,
  canChallenge,
  onChallenge,
}: {
  name: string
  state?: TaskChecklistItemStateEntry
  canChallenge: boolean
  onChallenge: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="w-6 h-6 rounded-full bg-primary-subtle text-text-secondary text-[10px] font-semibold flex items-center justify-center shrink-0">
        {initials(name)}
      </span>
      <span className="text-[13px] text-text-primary flex-1 min-w-0 truncate">{name}</span>
      {state?.state === 'done' ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
          {state.is_override ? <ShieldCheck size={12} /> : <Check size={12} strokeWidth={3} />}
          {state.is_override ? `Done for all${state.marked_by_name ? ` · ${state.marked_by_name}` : ''}` : 'Done'}
        </span>
      ) : state?.state === 'skipped' ? (
        <Tooltip label={state.reason ?? ''}>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
            <Ban size={12} /> Can’t do{state.reason ? ` · ${state.reason}` : ''}
          </span>
        </Tooltip>
      ) : (
        <span className="text-[11px] font-medium text-text-muted">Pending</span>
      )}
      {canChallenge && (
        <Tooltip label="Reopen this person’s item">
          <button
            type="button"
            onClick={onChallenge}
            className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary-text hover:text-primary-text px-1.5 py-0.5 rounded-[6px] hover:bg-primary-subtle shrink-0"
          >
            <RotateCcw size={11} /> Challenge
          </button>
        </Tooltip>
      )}
    </div>
  )
}
