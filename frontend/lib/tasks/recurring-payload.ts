import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import type { CompletionMode } from '@/lib/types/tasks'

/*
 * The one place a recurring template's create payload and schedule rules are
 * built. Shared by the desktop CreateTaskModal (recurring mode) and the phone
 * Create Task screen, so both send the identical shape and check the same
 * rules. Pure: no state, no network.
 */

export type CreateRecurringDto = Parameters<typeof tasksApi.createRecurring>[1]

/** A fresh schedule entry: daily, 09:00, starting today, never ending. */
export function defaultScheduleEntry(): ScheduleEntryDraft {
  return {
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: getNow().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

/** The first thing wrong with one schedule entry, in the desktop's words, or null. */
export function scheduleEntryError(entry: ScheduleEntryDraft): string | null {
  if (entry.schedule_type === 'weekly' && entry.days.length === 0) {
    return 'Select at least one day of the week for each weekly schedule.'
  }
  if (entry.schedule_type === 'monthly' && entry.month_days.length === 0) {
    return 'Select at least one day of the month for each monthly schedule.'
  }
  if (entry.schedule_type === 'yearly' && entry.yearly_dates.length === 0) {
    return 'Select at least one date for each yearly schedule.'
  }
  if (entry.end_condition === 'on_date' && !entry.end_date) {
    return 'End date is required for schedules ending "On date".'
  }
  return null
}

/** The first thing wrong across all entries, or null. */
export function scheduleEntriesError(entries: ScheduleEntryDraft[]): string | null {
  for (const entry of entries) {
    const err = scheduleEntryError(entry)
    if (err) return err
  }
  return null
}

export interface RecurringPayloadInput {
  title: string
  description: string
  categoryId?: string
  priorityId?: string
  tagIds?: string[]
  scheduleEntries: ScheduleEntryDraft[]
  completionMode: CompletionMode
  proofRequired: boolean
  proofAllowedExtensions: string[]
  escalationIds: string[]
  goalId?: string
  assignees: { user_id: string; is_cc?: boolean }[]
  checklistItems: CreateRecurringDto['checklist_items']
  reminders: CreateRecurringDto['reminders']
}

export function buildRecurringPayload(i: RecurringPayloadInput): CreateRecurringDto {
  return {
    title: i.title.trim(),
    description: i.description.trim() || undefined,
    category_id: i.categoryId || undefined,
    priority_id: i.priorityId || undefined,
    ...(i.tagIds && i.tagIds.length > 0 ? { tag_ids: i.tagIds } : {}),
    schedule_entries: i.scheduleEntries.map((en, idx) => ({
      schedule_type: en.schedule_type,
      every: en.every,
      days: en.days,
      month_days: en.month_days,
      yearly_dates: en.yearly_dates,
      time: en.time,
      start_date: en.start_date,
      end_condition: en.end_condition,
      end_date: en.end_condition === 'on_date' ? en.end_date : undefined,
      end_after: en.end_condition === 'after_n' ? en.end_after : undefined,
      order_index: idx,
    })),
    completion_mode: i.completionMode,
    proof_required: i.proofRequired,
    proof_allowed_extensions: i.proofRequired ? i.proofAllowedExtensions : [],
    escalation_user_ids: i.escalationIds.length > 0 ? i.escalationIds : undefined,
    linked_goal_id: i.goalId || undefined,
    assignee_user_ids: i.assignees.filter((a) => !a.is_cc).map((a) => a.user_id),
    cc_user_ids: i.assignees.filter((a) => a.is_cc).map((a) => a.user_id),
    checklist_items: i.checklistItems,
    reminders: i.reminders,
  }
}
