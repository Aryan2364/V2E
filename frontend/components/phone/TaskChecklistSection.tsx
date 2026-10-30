'use client'

import React from 'react'
import { Ban, Check, RotateCcw, ShieldCheck } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { TERMINAL_STATUS_PHASES, type Task, type TaskChecklistItem } from '@/lib/types/tasks'
import { PhoneButton, ROW, ROW_BLOCK, cx } from './primitives'
import { PhoneSheet } from './PhoneSheet'
import { TaskReasonSheet } from './TaskReasonSheet'

/*
 * The checklist on the phone task screen - full parity with the computer's
 * TaskChecklistCard (components/tasks/TaskChecklistCard.tsx), through the same
 * tasksApi calls. Each gate below is that card's gate, line for line:
 *
 *   - canAct (shared mode)  = open task, started, and (a working assignee OR the
 *     creator/admin)                                   [card renderSharedItem ~229]
 *   - tick in all_must      = working assignee, open, started      [card ~295-318]
 *   - Can't do / Clear      = same as the tick                     [card ~270-292, ~337-360]
 *   - Done for everyone / Undo = creator/admin, open, started      [card ~362-388]
 *   - Challenge a person    = creator/admin, that person has acted, started
 *                             (a closed task does NOT block it)    [card ~181]
 *
 * Rows stay one tap-target wide: the circle ticks, the rest of the row opens
 * that item's actions sheet (who has marked it, Can't do, Done for everyone,
 * Challenge). Every call returns the refreshed task, which replaces the
 * screen's task in place - rows keep their keys, so nothing flickers.
 */

function personName(a: { user?: { name?: string } | null; user_name?: string; user_id: string }): string {
  return a.user?.name ?? a.user_name ?? 'Someone'
}

export function TaskChecklistSection({
  orgId,
  task,
  userId,
  canEdit,
  onTaskUpdate,
}: {
  orgId: string
  task: Task
  userId: string | undefined
  /** Creator or admin, and not a simulated-future task (desktop page `canEdit`). */
  canEdit: boolean
  onTaskUpdate: (t: Task) => void
}) {
  const { addToast } = useToast()
  const items = task.checklist ?? []
  const isAllMust = task.completion_mode === 'all_must_complete'
  const isTerminal = !!task.status && TERMINAL_STATUS_PHASES.includes(task.status.type)
  const isFutureTask = new Date(task.created_at) > getNow()
  const workers = (task.assignees ?? []).filter((a) => !a.is_cc)
  const iAmWorker = workers.some((a) => a.user_id === userId)

  const [busy, setBusy] = React.useState<string | null>(null)
  // One panel at a time. `itemId` is looked up from the live task, so a sheet always shows fresh state.
  const [panel, setPanel] = React.useState<
    null | { kind: 'actions' | 'skip'; itemId: string } | { kind: 'challenge'; itemId: string; userId: string; userName: string }
  >(null)

  if (items.length === 0) return null

  /** Runs one checklist call; a refusal shows the server's own sentence. Resolves true on success. */
  async function run(key: string, fn: () => Promise<Task>): Promise<boolean> {
    setBusy(key)
    try {
      onTaskUpdate(await fn())
      return true
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not update the checklist. Try again.'), 'error')
      return false
    } finally {
      setBusy(null)
    }
  }

  /** Switches panel once the current sheet has finished closing (each sheet owns a history entry). */
  function goPanel(next: NonNullable<typeof panel>) {
    setPanel(null)
    window.setTimeout(() => setPanel(next), 250)
  }

  const workerCount = workers.length
  const totalFor = (it: TaskChecklistItem) => it.assignee_count ?? workerCount
  const resolvedCount = items.filter((it) => {
    if (isAllMust) return (it.done_count ?? 0) + (it.skipped_count ?? 0) >= totalFor(it) && totalFor(it) > 0
    return it.is_completed || !!it.cant_do
  }).length

  /** My state on an all_must item, from the per-person states (the server's my_state is only set on some reads). */
  function myStateOf(it: TaskChecklistItem) {
    const mine = (it.states ?? []).find((s) => s.user_id === userId)
    return { state: mine?.state ?? it.my_state ?? null, reason: mine?.reason ?? it.my_reason ?? null }
  }

  /** The circle's rule: who may tick this item right now. */
  function canTick(): boolean {
    if (isTerminal || isFutureTask) return false
    return isAllMust ? iAmWorker : iAmWorker || canEdit
  }
  // Why the circle is off: the card's disabledReason(), plus its "only an assignee" line.
  const tickReason = isTerminal
    ? 'This task is closed. Reopen it to change the checklist.'
    : isFutureTask
      ? 'This task has not started yet.'
      : isAllMust
        ? 'Only people working on this task can tick their own part'
        : 'Only an assignee can tick this item'

  function tick(it: TaskChecklistItem) {
    // Card: all_must toggles on my own 'done'; shared toggles on is_completed
    // (a can't-do item ticks as done).
    const done = isAllMust ? myStateOf(it).state === 'done' : it.is_completed
    void run(`tick:${it.id}`, () =>
      done ? tasksApi.uncheckChecklistItem(orgId, task.id, it.id) : tasksApi.checkChecklistItem(orgId, task.id, it.id),
    )
  }

  // Group by section, in order, as the card does.
  const order: string[] = []
  const byGroup = new Map<string, TaskChecklistItem[]>()
  for (const it of items) {
    const key = it.group_title ?? ''
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
      order.push(key)
    }
    byGroup.get(key)!.push(it)
  }
  const grouped = order.some((k) => k !== '')

  const note = isTerminal
    ? 'This task is closed. Reopen it to change the checklist.'
    : !iAmWorker
      ? checklistNote(task)
      : isAllMust
        ? 'Everyone must complete: each person ticks their own.'
        : null

  const panelItem = panel ? items.find((i) => i.id === panel.itemId) ?? null : null

  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="text-label font-medium text-text-secondary">
        Checklist · {resolvedCount}/{items.length}
      </h2>
      {note ? <p className="text-label text-text-secondary">{note}</p> : null}
      {order.map((key) => (
        <div key={key || '__ungrouped'} className="flex flex-col gap-[8px]">
          {grouped ? <h3 className="text-label font-medium text-text-secondary">{key || 'Checklist'}</h3> : null}
          <ul className={ROW_BLOCK}>
            {byGroup.get(key)!.map((it) => {
              const my = myStateOf(it)
              const done = isAllMust ? my.state === 'done' : it.is_completed
              const skipped = isAllMust ? my.state === 'skipped' : !!it.cant_do
              const rowBusy = busy === `tick:${it.id}`
              const tickable = canTick()
              const total = totalFor(it)
              const overridden = (it.states ?? []).some((s) => s.is_override)
              const hasSheet = isAllMust || tickable
              const detail = isAllMust
                ? `${it.done_count ?? 0}/${total} done${(it.skipped_count ?? 0) > 0 ? ` · ${it.skipped_count} can't do` : ''}`
                : done && it.completed_by?.name
                  ? `Done · ${it.completed_by.name}`
                  : null
              const reason = isAllMust ? (skipped ? my.reason : null) : it.cant_do_reason
              const body = (
                <>
                  <span className={cx('min-w-0 flex-1', 'flex flex-col gap-[2px]')}>
                    <span
                      className={cx(
                        'line-clamp-2 break-words text-body text-text-primary',
                        done && 'text-text-muted line-through',
                        skipped && 'text-warning line-through',
                      )}
                    >
                      {it.title}
                    </span>
                    {detail || reason || overridden ? (
                      <span className={cx('line-clamp-2 text-meta', skipped ? 'text-warning' : 'text-text-secondary')}>
                        {skipped && reason ? `Can't do: ${reason}` : detail}
                        {overridden ? ' · Done for everyone' : ''}
                      </span>
                    ) : null}
                  </span>
                </>
              )
              return (
                <li key={it.id} className="flex items-stretch">
                  {isAllMust && !iAmWorker ? (
                    <span aria-hidden className="flex min-h-[48px] w-[52px] shrink-0 items-center justify-center">
                      <span className="size-[22px] rounded-full border-2 border-dashed border-border-strong" />
                    </span>
                  ) : (
                    <PermissionTooltip allowed={tickable} reason={tickReason}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        aria-label={`${done ? 'Untick' : 'Tick'} ${it.title}`}
                        disabled={!tickable || rowBusy}
                        onClick={() => tick(it)}
                        className="flex min-h-[48px] w-[52px] shrink-0 items-center justify-center active:bg-surface-control disabled:pointer-events-none"
                      >
                        <Circle done={done} skipped={skipped} />
                      </button>
                    </PermissionTooltip>
                  )}
                  {hasSheet ? (
                    <button
                      type="button"
                      onClick={() => setPanel({ kind: 'actions', itemId: it.id })}
                      className="flex min-h-[48px] min-w-0 flex-1 items-center gap-[12px] py-[10px] pr-[16px] text-left active:bg-surface-control"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-[48px] min-w-0 flex-1 items-center gap-[12px] py-[10px] pr-[16px]">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      <PhoneSheet open={panel?.kind === 'actions' && !!panelItem} onOpenChange={(o) => !o && setPanel(null)} title={panelItem?.title ?? 'Checklist item'}>
        {panelItem ? (
          <ActionsBody
            item={panelItem}
            task={task}
            isAllMust={isAllMust}
            canTickNow={canTick()}
            canEdit={canEdit}
            isTerminal={isTerminal}
            isFutureTask={isFutureTask}
            myState={myStateOf(panelItem).state}
            busy={busy}
            onTick={() => {
              void run(`tick:${panelItem.id}`, () =>
                (isAllMust ? myStateOf(panelItem).state === 'done' : panelItem.is_completed)
                  ? tasksApi.uncheckChecklistItem(orgId, task.id, panelItem.id)
                  : tasksApi.checkChecklistItem(orgId, task.id, panelItem.id),
              ).then((ok) => ok && setPanel(null))
            }}
            onSkip={() => goPanel({ kind: 'skip', itemId: panelItem.id })}
            onClearSkip={() => {
              void run(`tick:${panelItem.id}`, () => tasksApi.uncheckChecklistItem(orgId, task.id, panelItem.id)).then((ok) => ok && setPanel(null))
            }}
            onOverride={() => {
              void run(`override:${panelItem.id}`, () => tasksApi.overrideChecklistItem(orgId, task.id, panelItem.id)).then((ok) => ok && setPanel(null))
            }}
            onClearOverride={() => {
              void run(`override:${panelItem.id}`, () => tasksApi.clearChecklistOverride(orgId, task.id, panelItem.id)).then((ok) => ok && setPanel(null))
            }}
            onChallenge={(uid, name) => goPanel({ kind: 'challenge', itemId: panelItem.id, userId: uid, userName: name })}
          />
        ) : null}
      </PhoneSheet>

      <TaskReasonSheet
        open={panel?.kind === 'skip' && !!panelItem}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Can't do this item"
        intro="Tell everyone why this step can't be done. It counts toward finishing your part, and stays visible with your reason."
        placeholder="Reason"
        confirmLabel="Mark can't do"
        busyLabel="Saving…"
        onConfirm={async (reason) => {
          if (!panelItem) return
          onTaskUpdate(await tasksApi.skipChecklistItem(orgId, task.id, panelItem.id, reason))
        }}
      />

      <PhoneSheet
        open={panel?.kind === 'challenge' && !!panelItem}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Reopen this item?"
        footer={
          <PhoneButton
            variant="primary"
            fullWidth
            loading={busy?.startsWith('challenge:')}
            onClick={() => {
              if (panel?.kind !== 'challenge' || !panelItem) return
              void run(`challenge:${panelItem.id}`, () => tasksApi.challengeChecklistItem(orgId, task.id, panelItem.id, panel.userId)).then(
                (ok) => ok && setPanel(null),
              )
            }}
          >
            Reopen &amp; challenge
          </PhoneButton>
        }
      >
        <p className="text-body text-text-secondary">
          This reopens the task for <span className="font-medium text-text-primary">{panel?.kind === 'challenge' ? panel.userName : ''}</span> so they
          can address <span className="font-medium text-text-primary">“{panelItem?.title}”</span>. Their other finished items stay as they are.
        </p>
      </PhoneSheet>
    </section>
  )
}

function Circle({ done, skipped }: { done: boolean; skipped: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        done ? 'border-primary bg-primary' : skipped ? 'border-warning bg-warning' : 'border-border-strong bg-transparent',
      )}
    >
      {done ? <Check className="size-[12px] text-primary-foreground" strokeWidth={3} /> : null}
      {skipped && !done ? <Ban className="size-[12px] text-primary-foreground" strokeWidth={2.5} /> : null}
    </span>
  )
}

function ActionsBody({
  item,
  task,
  isAllMust,
  canTickNow,
  canEdit,
  isTerminal,
  isFutureTask,
  myState,
  busy,
  onTick,
  onSkip,
  onClearSkip,
  onOverride,
  onClearOverride,
  onChallenge,
}: {
  item: TaskChecklistItem
  task: Task
  isAllMust: boolean
  canTickNow: boolean
  canEdit: boolean
  isTerminal: boolean
  isFutureTask: boolean
  myState: 'done' | 'skipped' | null
  busy: string | null
  onTick: () => void
  onSkip: () => void
  onClearSkip: () => void
  onOverride: () => void
  onClearOverride: () => void
  onChallenge: (userId: string, userName: string) => void
}) {
  const states = item.states ?? []
  const overridden = states.some((s) => s.is_override)
  const done = isAllMust ? myState === 'done' : item.is_completed
  const skipped = isAllMust ? myState === 'skipped' : !!item.cant_do
  const isBusy = !!busy
  const workers = (task.assignees ?? []).filter((a) => !a.is_cc)

  return (
    <div className="flex flex-col gap-[16px]">
      <ul className={ROW_BLOCK}>
        {canTickNow ? (
          <ActionRow icon={<Check aria-hidden />} label={done ? 'Untick' : skipped ? 'Tick as done' : 'Mark done'} disabled={isBusy} onClick={onTick} />
        ) : null}
        {/* Can't do / Clear can't-do: same gate as the tick (the card shows it only to those who can act). */}
        {canTickNow && !done && !skipped ? <ActionRow icon={<Ban aria-hidden />} label="Can't do this" disabled={isBusy} onClick={onSkip} /> : null}
        {canTickNow && skipped ? <ActionRow icon={<RotateCcw aria-hidden />} label="Clear can't-do" disabled={isBusy} onClick={onClearSkip} /> : null}
        {/* Assigner override: all_must items only, as on the card. */}
        {isAllMust && canEdit && !isTerminal && !isFutureTask ? (
          overridden ? (
            <ActionRow icon={<RotateCcw aria-hidden />} label="Undo done for everyone" disabled={isBusy} onClick={onClearOverride} />
          ) : (
            <ActionRow icon={<ShieldCheck aria-hidden />} label="Mark done for everyone" disabled={isBusy} onClick={onOverride} />
          )
        ) : null}
      </ul>

      {isAllMust ? (
        <section className="flex flex-col gap-[8px]">
          <h3 className="text-label font-medium text-text-secondary">Who has marked this</h3>
          {workers.length === 0 ? <p className="text-body text-text-secondary">No assignees yet</p> : null}
          <ul className={ROW_BLOCK}>
            {workers.map((a) => {
              const st = states.find((s) => s.user_id === a.user_id)
              const name = personName(a)
              return (
                <li key={a.user_id} className="flex min-h-[48px] items-center gap-[12px] px-[16px] py-[8px]">
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate text-body text-text-primary">{name}</span>
                    <span className={cx('text-meta', st?.state === 'skipped' ? 'text-warning' : st?.state === 'done' ? 'text-success' : 'text-text-secondary')}>
                      {st?.state === 'done'
                        ? st.is_override
                          ? `Done for everyone${st.marked_by_name ? ` · ${st.marked_by_name}` : ''}`
                          : 'Done'
                        : st?.state === 'skipped'
                          ? `Can't do${st.reason ? `: ${st.reason}` : ''}`
                          : 'Pending'}
                    </span>
                  </span>
                  {/* Card: canEdit && the person has acted && task started (a closed task does not block it). */}
                  {canEdit && !!st && !isFutureTask ? (
                    <button
                      type="button"
                      onClick={() => onChallenge(a.user_id, name)}
                      className="inline-flex min-h-[44px] shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-label font-medium text-primary-text active:bg-primary-subtle"
                    >
                      <RotateCcw aria-hidden className="size-[14px]" />
                      Challenge
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ActionRow({ icon, label, disabled, onClick }: { icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" disabled={disabled} onClick={onClick} className={cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0', 'disabled:text-text-muted')}>
        {icon}
        {label}
      </button>
    </li>
  )
}

/** For people who cannot tick: who does, and how far it has got. */
function checklistNote(task: Task): string {
  const items = task.checklist ?? []
  const done = items.filter((i) => i.is_completed).length
  const workers = (task.assignees ?? []).filter((a) => !a.is_cc)
  const who = workers.length === 1 ? workers[0].user?.name ?? workers[0].user_name ?? 'The assignee' : 'The assignees'
  const progress = task.completion_mode === 'all_must_complete' && workers.length > 1 ? '' : ` · ${done} of ${items.length} done`
  return `${who} ticks these off as they work${progress}`
}
