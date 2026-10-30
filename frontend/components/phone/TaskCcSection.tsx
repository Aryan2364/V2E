'use client'

import React from 'react'
import { Plus, X } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import { useEligibleAssignees, type AssigneeSortMode } from '@/components/tasks/useEligibleAssignees'
import { useToast } from '@/components/ui/Toast'
import type { Task } from '@/lib/types/tasks'
import { PeoplePickerSheet, type PickerSection } from './PeoplePickerSheet'
import { PhoneButton, ROW_BLOCK } from './primitives'

/*
 * "CC" on the phone task screen: who is looped in, and (for anyone desktop
 * lets manage CC) add / remove. Desktop saves the roster with ONE
 * PATCH :id carrying only cc_user_ids (page.tsx handleSaveAssignees), so
 * working assignees are never touched; this does the same. The task is
 * re-read afterwards and swapped in place - same rows, no flicker.
 */

const SORTS: { key: AssigneeSortMode; label: string }[] = [
  { key: 'frequency', label: 'Frequent' },
  { key: 'workload', label: 'Workload' },
  { key: 'name', label: 'A-Z' },
]

export function TaskCcSection({
  orgId,
  task,
  canManage,
  onTaskUpdate,
}: {
  orgId: string
  task: Task
  canManage: boolean
  onTaskUpdate: (updated: Task) => void
}) {
  const { addToast } = useToast()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const all = task.assignees ?? []
  const cc = all.filter((a) => a.is_cc)
  const nameOf = (a: (typeof all)[number]) => a.user?.name ?? a.user_name ?? 'Someone'

  // Everyone already on the task is left out of the picker.
  const { search, setSearch, sort, setSort, loading, failed, departments, reload } = useEligibleAssignees({
    orgId,
    open: pickerOpen,
    hiddenIds: all.map((a) => a.user_id),
  })
  const sections: PickerSection[] = departments.map((d) => ({
    id: d.department_id,
    name: d.department_id === 'search' ? undefined : d.department_name,
    people: d.users.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      role: u.role_title,
      department: u.department_id === 'search' ? null : u.department_name,
      note: u.on_leave_today ? 'On leave' : null,
    })),
  }))

  /** Saves the full CC list, then swaps the re-read task in. Throws the server's refusal. */
  async function saveCc(ids: string[]) {
    await tasksApi.updateTask(orgId, task.id, { cc_user_ids: ids } as never)
    onTaskUpdate(await tasksApi.getTask(orgId, task.id))
  }

  async function add(picked: { user_id: string }[]) {
    if (picked.length === 0) return
    setBusyId('add')
    try {
      await saveCc([...cc.map((a) => a.user_id), ...picked.map((p) => p.user_id)])
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not add them. Try again.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(userId: string) {
    setBusyId(userId)
    try {
      await saveCc(cc.filter((a) => a.user_id !== userId).map((a) => a.user_id))
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not remove them. Try again.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (cc.length === 0 && !canManage) return null

  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="text-label font-medium text-text-secondary">CC</h2>
      {cc.length > 0 ? (
        <ul className={ROW_BLOCK}>
          {cc.map((a) => (
            <li key={a.user_id} className="flex min-h-[48px] items-center gap-[12px] py-[2px] pl-[16px] pr-[4px]">
              <span className="min-w-0 flex-1 truncate text-body text-text-primary">{nameOf(a)}</span>
              {canManage ? (
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(a)} from CC`}
                  disabled={busyId !== null}
                  onClick={() => void remove(a.user_id)}
                  className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control disabled:opacity-100"
                >
                  <X aria-hidden className="size-[18px]" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-text-secondary">No one is CC&apos;d.</p>
      )}
      {canManage ? (
        <PhoneButton type="button" variant="secondary" loading={busyId === 'add'} disabled={busyId !== null} onClick={() => setPickerOpen(true)} className="self-start">
          <Plus aria-hidden />
          Add CC
        </PhoneButton>
      ) : null}

      <PeoplePickerSheet<AssigneeSortMode>
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add CC"
        sections={sections}
        loading={loading}
        failed={failed}
        onRetry={reload}
        selected={[]}
        onDone={(people) => void add(people)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, role or department"
        sort={{ value: sort, onChange: setSort, options: SORTS }}
      />
    </section>
  )
}
