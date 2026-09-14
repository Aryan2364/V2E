// Person Scorecard report — types shared by the roster + detail pages and the
// Excel export. Mirrors the backend PersonScorecardService shapes, which follow
// the client's "Person Wise Task Scorecard" format (occurrence-based metrics).

export type ScorecardScope = 'own' | 'team' | 'department' | 'org'

export interface ScorecardPerson {
  user_id: string
  name: string
  email: string | null
  role_title: string | null
  department_name: string | null
}

export type ScorecardGrade =
  | 'Very Good'
  | 'Good'
  | 'Average'
  | 'Late but Closing'
  | 'Needs Attention'
  | 'Too Few Tasks to Judge'

/** The client's discipline metric set, per person — column-for-column with the sheet. */
export interface ScorecardMetrics {
  different_tasks: number       // Different Tasks Handled (distinct task names = real scope)
  recurring_unique: number      // distinct active recurring templates held (detail view)
  total_given: number           // Total Task Entries
  avg_repeat: number | null     // Average Times Each Task Repeats (total ÷ different)
  completed: number
  pending: number               // Tasks Still Pending (overdue + ongoing)
  overdue: number
  ongoing: number
  completion_pct: number | null // Completion Rate (0–100)
  completed_on_time: number     // Finished On or Before Due Date
  completed_with_date: number   // completed entries with a completion date + due (on-time denominator)
  completed_no_date: number     // completed but no date entered — a data gap
  on_time_pct: number | null    // On Time Rate (0–100)
  avg_delay_days: number | null // COMPLETED work: Average Delay in Days (minus = early)
  longest_delay_days: number | null       // COMPLETED work: worst single delay
  avg_pending_age_days: number | null      // PENDING work: mean (today − due) over overdue tasks
  longest_pending_age_days: number | null  // PENDING work: oldest overdue task
  // Integrity columns (additive). Every on-time/late/delay/overdue figure above is
  // measured against the task's FROZEN original deadline, not the editable one.
  withdrawn: number        // entries the person was removed from before their original
                           // deadline without finishing — excluded from every metric and
                           // from the grade denominator, shown so the removal is visible
  handed_over: number      // entries already LATE when taken off this person and given to
                           // someone else. Counted in total_given as a late mark they keep,
                           // but never in pending/overdue/pending-age: the work is not
                           // theirs any more, so it must not read as outstanding on them
  revised_entries: number  // graded entries whose deadline was revised at least once
  grade: ScorecardGrade
}

/** Overall / Total row — same numbers, no grade and no per-person template count. */
export type ScorecardTotals = Omit<ScorecardMetrics, 'grade' | 'recurring_unique'>

export interface RosterItem extends ScorecardPerson, ScorecardMetrics {}

export interface RosterResponse {
  people: RosterItem[]
  totals: ScorecardTotals
  applied_scope: ScorecardScope | null
  max_scope: ScorecardScope | null
}

/** Where a task stands today, from the dates (independent of the work stage). */
export type EntryDateStatus =
  | 'completed'
  | 'overdue'
  | 'in_progress'
  | 'not_yet_due'
  | 'closed'
  // Taken off this person and given to someone else — TERMINAL for them. Never
  // pending, never chased. See `handover` for who actually holds it now.
  | 'handed_over'

/** Where a released entry went, so the reader is never left chasing the wrong person. */
export interface HandoverInfo {
  at: string                            // when they were taken off
  to: string[]                          // who holds it NOW (may be empty = nobody)
  days_late_at_handover: number | null  // frozen lateness they keep; null when ungraded
}

/** One row per task entry — the "Task Data" detail sheet + the person detail list. */
export interface TaskEntryRow {
  task_id: string
  title: string
  frequency: string
  department: string | null
  assigned_by: string | null
  due_date: string | null
  completion_date: string | null
  status: string | null            // work stage label (what the person did)
  date_status: EntryDateStatus     // where it stands today (from the dates)
  delay_days: number | null        // completed only: signed completion − ORIGINAL due
  days_late: number | null         // completed → signed delay; overdue → today − ORIGINAL due; else null
  on_time: 'Yes' | 'No' | ''
  // Integrity columns (additive)
  original_deadline: string | null // the frozen date this row was graded against;
                                   // === due_date unless the deadline was moved
  deadline_revision_count: number  // > 0 ⇒ flag "revised Nx" beside the due date
  is_withdrawn: boolean            // removed before due without finishing — listed, not graded
  // Non-null ⇒ the person no longer holds this entry and `date_status` is 'handed_over'.
  handover: HandoverInfo | null
}

/** Supporting "unique recurring tasks held" row. */
export interface RecurringRow {
  template_id: string
  title: string
  cadence_label: string
  frequency: string
  start_date: string | null
  end_date: string | null
  next_run: string | null
  fired: number
  done: number
  on_time_rate: number | null
  last_completed_at: string | null
  freshness_state: 'current' | 'behind' | 'none'
  freshness_label: string
  withdrawn: number // occurrences released to someone else — out of fired/done/on_time_rate
  handed_over: number // occurrences already late when passed on — same exclusion, and kept
                      // out of the behind-count so they never age against this cadence
}

export interface Scorecard {
  employee: ScorecardPerson
  metrics: ScorecardMetrics
  recurring_tasks: RecurringRow[]
  entries: TaskEntryRow[]
}

export interface AllScorecardsResponse {
  cards: Scorecard[]
  totals: ScorecardTotals
  applied_scope: ScorecardScope | null
  max_scope: ScorecardScope | null
}

export interface ScorecardWindow {
  from_date?: string
  to_date?: string
}

// ─── Pending & Overdue Ageing report ─────────────────────────────────────────────
// Mirrors the backend TaskAgeingService shapes (client "Pending and Overdue Ageing
// Report": Person-wise + Task-wise + Pending Task List).

/** The seven age bands, in grid order. `withdrawn` is deliberately not one of them. */
export type AgeBandKey =
  | 'not_yet_due'
  | 'd1_7'
  | 'd8_15'
  | 'd16_30'
  | 'd31_60'
  | 'd61_90'
  | 'd90_plus'

/**
 * What a pending row can be tagged as. `withdrawn` and `handed_over` are two extra
 * non-age keys covering the same fact on either side of the due date: the person has
 * been taken off, so it is not their pending work and there is no honest number of
 * days to keep ageing them by. It shares the `bucket` field with the
 * real bands on purpose — the drilldown filters on `bucket`, so a row can never
 * belong to both a band and the withdrawn tally and `clicked count === rows shown`
 * keeps holding.
 */
export type AgeBucketKey = AgeBandKey | 'withdrawn' | 'handed_over'

/** The seven age bands + three derived figures — one shared block per row. */
export interface AgeBuckets {
  not_yet_due: number
  d1_7: number
  d8_15: number
  d16_30: number
  d31_60: number
  d61_90: number
  d90_plus: number
  total_pending: number      // sum of the SEVEN age bands, incl. Not Yet Due.
                             // Withdrawn is NOT in here.
  over_month_late: number     // d31_60 + d61_90 + d90_plus
  oldest_late_days: number | null
  avg_late_days: number | null
  // Integrity columns (additive). Days Late and the band are measured against the
  // task's FROZEN original deadline, not the editable one.
  withdrawn: number        // open entries the person was removed from before their
                           // original deadline — not pending for them any more, so kept
                           // out of total_pending / over_month_late / oldest / average
  handed_over: number      // open entries already late when taken off this person. Same
                           // exclusion as withdrawn: not their backlog, so it can never sit
                           // in total_pending or keep ageing against them
  revised_entries: number  // pending entries whose deadline was revised at least once
}

export interface PersonAgeRow extends AgeBuckets {
  user_id: string
  name: string
  role_title: string | null
  department_name: string | null
}

export interface TaskAgeRow extends AgeBuckets {
  title: string
  frequency: string
}

export interface PendingTaskRow {
  task_id: string
  title: string
  assigned_to: string
  assigned_to_user_id: string
  assigned_by: string | null
  department: string | null
  frequency: string
  due_date: string | null   // the LIVE due date — this list doubles as the operational
                            // "what is outstanding and when" view
  days_late: number | null  // measured from original_deadline; null when Not Yet Due,
                            // undated, or Withdrawn
  bucket: AgeBucketKey
  bucket_label: string
  status: 'Overdue' | 'Not Yet Due' | 'Withdrawn' | 'Handed Over'
  // Integrity columns (additive)
  original_deadline: string | null // the frozen date this row was aged against;
                                   // === due_date unless the deadline was moved
  deadline_revision_count: number
  is_withdrawn: boolean            // === (bucket === 'withdrawn')
  // Non-null ⇒ taken off this person; `to` names who holds it now.
  handover: HandoverInfo | null
}

export interface AgeingReport {
  as_on_date: string
  people: PersonAgeRow[]
  tasks: TaskAgeRow[]
  pending: PendingTaskRow[]
  totals: AgeBuckets
  frequencies: string[]
  list_truncated: boolean
  applied_scope: ScorecardScope | null
  max_scope: ScorecardScope | null
}

// ─── Monthly Task Compliance Calendar ────────────────────────────────────────────
// Mirrors the backend TaskCalendarService shapes (client "Report 3").

/**
 * `withdrawn` = the person was removed from that occurrence before its original
 * deadline came due: the square is drawn so the removal is visible, but it carries no
 * verdict and is excluded from Scheduled / on-time / late / missed and Brought Forward.
 */
export type DayResult = 'on_time' | 'late' | 'missed' | 'future' | 'withdrawn' | 'handed_over'

export interface CalendarDay {
  day: number
  iso: string
  dow: string
  weekend: boolean
}

export interface CalendarCell {
  day: number        // day-of-month from the LIVE deadline (where the square is drawn)
  result: DayResult  // verdict judged against original_deadline
  task_id: string
  due_date: string   // live deadline
  completion_date: string | null
  status: string | null
  // Integrity columns (additive)
  original_deadline: string | null // the frozen date the verdict used; === due_date
                                   // unless the deadline was moved
  deadline_revision_count: number
  is_withdrawn: boolean            // === (result === 'withdrawn')
  // Non-null ⇒ taken off this person; `to` names who holds it now.
  handover: HandoverInfo | null
}

export interface CalendarRow {
  title: string
  person: string
  user_id: string
  frequency: string
  department: string | null
  brought_forward: number
  scheduled: number  // graded occurrences only — still on_time + late + missed + future
  on_time: number
  late: number
  missed: number
  future: number
  // Integrity columns (additive)
  withdrawn: number        // in-month occurrences released before their original deadline
  handed_over: number      // in-month occurrences already late when taken off this person —
                           // shown on the square but never carried forward or counted as an
                           // ongoing miss, because the occurrence is someone else's now
  revised_entries: number  // in-month occurrences whose deadline was revised at least once
  cells: CalendarCell[]
}

export interface CalendarTotals {
  rows: number
  brought_forward: number
  scheduled: number
  on_time: number
  late: number
  missed: number
  future: number
  withdrawn: number
  handed_over: number     // separate total — never folded into the graded columns
  revised_entries: number
}

export interface CalendarReport {
  month: string
  month_label: string
  as_on_date: string
  days: CalendarDay[]
  rows: CalendarRow[]
  totals: CalendarTotals
  frequencies: string[]
  applied_scope: ScorecardScope | null
  max_scope: ScorecardScope | null
}
