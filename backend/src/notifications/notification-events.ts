// Central notification catalog. Every notification belongs to a module so a
// whole module's notifications can be switched off in one place later (when
// per-customer module access control is built).

export const NOTIF_EVENTS = {
  tasks: [
    'task_assigned',
    'task_unassigned', // removed from a task's assignees/CC
    'task_status_changed', // status moved (e.g. In Progress → Done) outside the Complete action
    'task_deadline_changed', // the deadline was revised — the people who have to hit it are told
    'task_attachment_added', // a file attached directly to the task (not via a comment)
    'task_completed',
    'task_incomplete', // task closed as not-done (terminal Incomplete) with a reason
    'task_part_flagged', // an assignee flagged their own part as can't-complete (all_must_complete)
    'task_checklist_skipped', // an assignee marked a checklist item "can't do" (with a reason)
    'task_checklist_overridden', // the assigner marked a checklist item done for everyone
    'task_checklist_challenged', // the assigner reopened a person's part to re-do a checklist item
    'task_reopened',
    'task_comment',
    'task_reminder',
    'task_overdue',
    'task_overdue_followup',
    'task_escalated',
    'recurring_spawned',
    'assignee_on_leave_conflict', // new leave overlaps an existing task's deadline
    'recurring_assignee_on_leave', // upcoming recurring occurrence lands on an assignee's leave
  ],
  goals: [
    'goal_check_in_due', // the owner owes a check-in today (driven by review cadence)
    'goal_check_in_overdue', // still not checked in, N days past the due date
    'goal_at_risk', // owner logged at-risk/off-track — told to the owners of the goals this one supports
  ],
  projects: ['project_created', 'project_member_added', 'milestone_completed'],
  workflows: [
    'workflow_triggered',
    'workflow_step_assigned',
    'workflow_step_overdue',
    'workflow_upstream_delay',
    'workflow_completed',
  ],
  tickets: ['ticket_raised', 'ticket_status_changed', 'ticket_sla_breached', 'ticket_comment', 'ticket_escalated'],
  meetings: [
    'meeting_invited', // added to a meeting / rhythm (opt-out: you're on it, not asked)
    'meeting_response', // an attendee declined (with a reason)
    'meeting_updated', // time/location/link changed on a meeting you're on
    'meeting_reminder',
    'meeting_cancelled',
  ],
  work_logs: [
    'work_log_demanded',
    'work_log_demand_due',
    'work_log_remark',
    'work_log_remark_reply',
    'work_log_submitted',
  ],
  communication: [],
  system: [],
  leave: ['leave_requested', 'leave_decided', 'leave_overridden'],
  process_hierarchy: [
    'process_review_requested', // a contributor sent a node/sub-tree for review
    'process_finalized', // an owner/admin marked a node final
    'process_sent_back', // an owner/admin sent a node back to draft
  ],
} as const;

export type NotifModule = keyof typeof NOTIF_EVENTS;

export const ALL_NOTIF_EVENTS: { module: NotifModule; event: string }[] = (
  Object.keys(NOTIF_EVENTS) as NotifModule[]
).flatMap((m) => NOTIF_EVENTS[m].map((event) => ({ module: m, event })));
