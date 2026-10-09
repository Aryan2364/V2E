// A workflow step's form model (StepCard) — the draft it edits, its API shape, and what an
// open new-step form gives up when the builder adds it without its own button. Pure, so
// the unit tests can load it (no React, no JSX).
import type { CompletionMode, SelectedAssignee } from '@/lib/types/tasks'
import type { ChecklistItem, DueRule, EscalationMode, IfLate, StartRule, StepInput } from '@/lib/types/workflows'
import { DEFAULT_DUE_RULE, DEFAULT_START_RULE, cleanRule } from './timing'

export interface StepDraft {
  title: string
  description: string
  /** Assignees and CCs together, as the task form's picker holds them. */
  assignees: SelectedAssignee[]
  completion_mode: CompletionMode
  /** When it starts and when it is due (relative due rules are mirrored to due_days / due_time). */
  start_rule: StartRule
  due_rule: DueRule
  /** "Also waits for": steps on other paths (tracks). */
  merge_step_ids: string[]
  if_late: IfLate
  escalation_mode: EscalationMode
  escalation_user_ids: string[]
  priority_id: string
  category_id: string
  tag_ids: string[]
  checklist_items: ChecklistItem[]
  proof_required: boolean
  proof_allowed_extensions: string[]
}

type DraftKey = keyof StepDraft

export function normItems(items: ChecklistItem[] | null | undefined): ChecklistItem[] {
  return (Array.isArray(items) ? items : [])
    .filter((c) => c && typeof c.title === 'string' && c.title.trim())
    .map((c) => ({
      title: c.title,
      ...(c.group_title ? { group_title: c.group_title } : {}),
      ...(c.template_id ? { template_id: c.template_id } : {}),
    }))
}

export function blankStepDraft(me?: { user_id: string; name: string }): StepDraft {
  return {
    title: '',
    description: '',
    assignees: me ? [{ user_id: me.user_id, name: me.name, is_cc: false }] : [],
    completion_mode: 'any_can_complete',
    start_rule: DEFAULT_START_RULE,
    due_rule: DEFAULT_DUE_RULE,
    merge_step_ids: [],
    if_late: 'wait',
    escalation_mode: 'manager',
    escalation_user_ids: [],
    priority_id: '',
    category_id: '',
    tag_ids: [],
    checklist_items: [],
    proof_required: false,
    proof_allowed_extensions: [],
  }
}

/** Draft fields → API fields. */
export function toInput(patch: Partial<StepDraft>): StepInput {
  const out: StepInput = {}
  for (const [k, v] of Object.entries(patch) as [DraftKey, StepDraft[DraftKey]][]) {
    switch (k) {
      case 'title':
        out.title = (v as string).trim()
        break
      case 'description':
        out.description = (v as string).trim() || null
        break
      case 'assignees': {
        const list = v as SelectedAssignee[]
        out.assignee_user_ids = list.filter((a) => !a.is_cc).map((a) => a.user_id)
        out.cc_user_ids = list.filter((a) => a.is_cc).map((a) => a.user_id)
        break
      }
      case 'start_rule':
        out.start_rule = cleanRule(v as StartRule)
        break
      case 'due_rule': {
        const r = cleanRule(v as DueRule)
        out.due_rule = r
        // Older readers still use due_days / due_time for a relative due.
        if (r.kind === 'days_after_start') {
          out.due_days = typeof r.days === 'number' ? r.days : 1
          out.due_time = r.time || '18:00'
        }
        break
      }
      case 'priority_id':
      case 'category_id':
        out[k] = (v as string) || null
        break
      case 'checklist_items':
        out.checklist_items = normItems(v as ChecklistItem[])
        break
      case 'escalation_user_ids':
        out.escalation_user_ids = (v as string[]).filter(Boolean)
        break
      default:
        ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Why an open new-step form is being added without its own button:
 *  - 'add': another form was asked for — the step must be addable as it is;
 *  - 'draft' / 'save': the workflow is being saved — what is filled in is kept as it is,
 *    and the save's own checks (none for a draft, all of them for Save) decide.
 */
export type CommitReason = 'add' | 'draft' | 'save'

/**
 * Add an open new-step form's step without its button: the step to add, 'blank' when
 * nothing has been filled in (nothing worth keeping), or 'invalid' when it cannot be added
 * as it is (the form then shows why).
 */
export type CommitNewStep = (reason?: CommitReason) => StepInput | 'blank' | 'invalid'

/** A new-step form someone has filled in (anything differs from how it opened). */
export function draftTouched(draft: StepDraft, initial: StepDraft): boolean {
  return !same(toInput(draft), toInput(initial))
}

/**
 * What an open new-step form gives up when it is added without its button (see
 * CommitReason). Untouched → 'blank'. 'add' needs it to be addable (`checked` validates
 * and shows why not); a save keeps it as it is — a draft may have no title yet, and shows
 * as "Untitled step"; Save's full checks then name what is missing.
 */
export function commitDraft(
  draft: StepDraft,
  initial: StepDraft,
  reason: CommitReason,
  checked: (d: StepDraft) => StepInput | null,
): StepInput | 'blank' | 'invalid' {
  if (!draftTouched(draft, initial)) return 'blank'
  if (reason === 'add') return checked(draft) ?? 'invalid'
  return toInput({ ...draft, escalation_user_ids: draft.escalation_mode === 'people' ? draft.escalation_user_ids : [] })
}
