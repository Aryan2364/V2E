import { DEFAULT_DUE_DAYS, DEFAULT_DUE_TIME, PreviewTimelineDto } from './dto/definition.dto'
import { Frequency, RunStartPoint, allowedDueKinds, allowedStartKinds, cycleLengthOf, firstStepTimingProblem, frequencyOf, laterStepTimingProblem, parseDueRule, parseStartRule, runStartPointOf, timingProblem } from './engine/timing'
import { Injectable } from '@nestjs/common'
import { Principal } from '../access-rights/permissions.service'
import { ProposedStep, TIMELINE_RUNS, TimelineRun, TimelineStep } from './workflow-template.types'
import { ScheduleEntryLike, calendarDateToStored, scheduleEntryProblem } from './engine/schedule'
import { TimelineStepInput } from './workflow-engine.shared'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { overlapWarning, sampleOrderMessages, scheduleData, stepLabel, upcomingOccurrences } from './workflow-definition.validation'
import { planTracks } from './tracks'
import { safeTimeZone } from './engine/tz'
import { unique } from './workflow-view.formatter'

/** The builder's example timeline (preview) and the overlap warnings shown on save. */
@Injectable()
export class WorkflowTimelineService {
  constructor(
    private readonly engineSupport: WorkflowEngineSupportService,
    private readonly access: WorkflowAccessService,
  ) {}

  /**
   * `POST /workflows/preview-timeline` — the live example run under the Steps section.
   * Body = the in-memory definition (the definition save's shape); nothing is stored
   * and no workflow row is read, so module access is enough (OrgScopeGuard). Scheduled
   * workflows: the next 3 occurrences of its schedules from the org clock; manual-only
   * (or schedules with no upcoming occurrence): one run starting now. Fields the
   * request omits take the new-step defaults.
   */
  async previewTimeline(orgId: string, dto: PreviewTimelineDto, _p: Principal) {
    const { tz, now } = await this.access.scheduleContext(orgId)
    // The same tracks → graph as a save; anything not valid yet is simply left out.
    const { plan } = planTracks(
      dto.tracks,
      dto.steps.map((s) => ({ key: s.key, title: s.title, track_key: s.track_key, merge_step_keys: s.merge_step_keys })),
    )
    const byKey = new Map(dto.steps.map((s) => [s.key, s]))
    const steps: TimelineStep[] = plan.display.map((key) => byKey.get(key)!).map((s) => ({
      key: s.key,
      title: (s.title ?? '').trim(),
      label: plan.labels.get(s.key) ?? '?',
      deps: plan.deps.get(s.key) ?? [],
      start_rule: s.start_rule ?? null,
      due_rule: s.due_rule ?? null,
      due_days: s.due_days ?? DEFAULT_DUE_DAYS,
      due_time: s.due_time ?? DEFAULT_DUE_TIME,
      holiday_user_id: s.assignee_user_ids?.[0] ?? null,
    }))
    const entries: ScheduleEntryLike[] = []
    for (const e of dto.starts.schedules) {
      if (scheduleEntryProblem(e)) continue
      const start = calendarDateToStored(e.start_date)
      if (!start) continue
      const endCondition = e.end_condition ?? 'never'
      entries.push({
        schedule_type: e.schedule_type,
        every: e.every ?? 1,
        days: e.days ?? [],
        month_days: e.month_days ?? [],
        yearly_dates: e.yearly_dates ?? [],
        time: e.time,
        start_date: start,
        end_condition: endCondition,
        end_date: endCondition === 'on_date' ? calendarDateToStored(e.end_date) : null,
        end_after: endCondition === 'after_n' ? e.end_after ?? null : null,
        occurrence_count: 0,
      })
    }
    const frequency = frequencyOf(dto.starts.schedules)
    return this.timeline(orgId, safeTimeZone(tz), now, steps, entries, frequency, runStartPointOf(dto.starts.schedules, frequency))
  }

  /**
   * Non-blocking timing warnings for a save (the builder shows them): the same check
   * the example timeline runs. Never fails a save.
   */
  async saveWarnings(
    orgId: string,
    proposed: ProposedStep[],
    schedules: ReturnType<typeof scheduleData>['data'][],
  ): Promise<string[]> {
    try {
      const { tz, now } = await this.access.scheduleContext(orgId)
      const entries: ScheduleEntryLike[] = schedules.map((d) => ({
        ...d,
        days: d.days,
        month_days: d.month_days,
        yearly_dates: d.yearly_dates,
        occurrence_count: 0,
      }))
      const steps: TimelineStep[] = proposed.map((s) => ({
        key: s.id,
        title: s.state.title,
        label: s.label,
        deps: s.deps,
        start_rule: s.state.start_rule,
        due_rule: s.state.due_rule,
        due_days: s.state.due_days,
        due_time: s.state.due_time,
        holiday_user_id: s.state.assignee_user_ids[0] ?? null,
      }))
      const frequency = frequencyOf(schedules)
      return (await this.timeline(orgId, safeTimeZone(tz), now, steps, entries, frequency, runStartPointOf(schedules, frequency)))
        .warnings
    } catch {
      return []
    }
  }

  /**
   * Plan example runs with the engine (exactly what a run would store), plus warnings:
   *  - a step whose timing isn't valid for how the workflow repeats (planned with the
   *    defaults instead), or a first step timed before the run starts (Save's words);
   *  - a step timed "N days after start" that lands before a step it starts after is due;
   *  - an explicit day (the builder's calendar) before the day the step it waits for is
   *    due, or a due day before its own start — Save's words (`sampleOrderMessages`);
   *  - runs that overlap: a run's last planned date after the next scheduled run starts.
   * A legacy (inferred) calendar day before the previous step's dates is not a warning:
   * it is planned in the next cycle, and the builder labels it so ("1st (next month)").
   */
  private async timeline(
    orgId: string,
    tz: string,
    now: Date,
    steps: TimelineStep[],
    schedules: ScheduleEntryLike[],
    frequency: Frequency,
    runStart: RunStartPoint | null = null,
  ): Promise<{ runs: TimelineRun[]; warnings: string[] }> {
    const warnings: string[] = []
    const label = new Map(steps.map((s) => [s.key, stepLabel(s.label, s.title)]))
    const name = (key: string) => {
      const st = steps.find((s) => s.key === key)
      return st?.title.trim() || `Step ${st?.label ?? '?'}`
    }
    const inputs: TimelineStepInput[] = steps.map((s) => {
      const problem = timingProblem(s.start_rule, s.due_rule, frequency)
      if (problem) warnings.push(`${label.get(s.key)}: ${problem}`)
      const placed = problem
        ? null
        : s.deps.length === 0
          ? firstStepTimingProblem(s.start_rule, s.due_rule, runStart)
          : laterStepTimingProblem(s.start_rule)
      if (placed) warnings.push(`${label.get(s.key)}: ${placed}`)
      const start =s.start_rule ? parseStartRule(s.start_rule) : null
      const due = s.due_rule ? parseDueRule(s.due_rule) : null
      const startOk = start?.ok && allowedStartKinds(frequency).includes(start.rule.kind) && !problem
      const dueOk = due?.ok && allowedDueKinds(frequency).includes(due.rule.kind) && !problem
      return {
        key: s.key,
        deps: s.deps,
        start_rule: startOk && start?.ok ? start.rule : null,
        due_rule: dueOk && due?.ok ? due.rule : null,
        due_days: s.due_days,
        due_time: s.due_time,
        holiday_user_id: s.holiday_user_id,
      }
    })

    // Explicit days before the step they wait for is due: Save refuses them; a draft
    // (and this example) only warns — in Save's own words.
    for (const [key, msg] of await sampleOrderMessages(steps, schedules, frequency, runStart, tz, now)) {
      warnings.push(`${label.get(key)}: ${msg}`)
    }

    // One occurrence more than is shown: the run after the last one, for the overlap check.
    const upcoming = upcomingOccurrences(schedules, now, tz, TIMELINE_RUNS + 1)
    let starts = upcoming.slice(0, TIMELINE_RUNS)
    if (!starts.length) starts = [now]
    const every = cycleLengthOf(frequency)
    const plans = await this.engineSupport.planTimelines(orgId, tz, inputs, starts, every)
    let overlap: string | null = null
    const runs: TimelineRun[] = []
    for (const [i, plan] of plans.entries()) {
      const runAt = starts[i]
      runs.push({
        starts_at: runAt,
        steps: plan.steps.map((x) => ({
          key: x.key,
          title: name(x.key),
          planned_start_at: x.planned_start_at,
          planned_due_at: x.planned_due_at,
        })),
      })
      for (const w of plan.warnings) {
        warnings.push(
          `${label.get(w.key)} starts before ${label.get(w.predecessor_key) ?? `“${name(w.predecessor_key)}”`} is due, so it is planned later.`,
        )
      }
      // Scheduled runs only (upcoming is empty for an example run starting now).
      const next = upcoming[i + 1]
      if (!overlap && next) overlap = overlapWarning(plan.steps, next, tz, i > 0 ? runAt : null)
    }
    if (overlap) warnings.push(overlap)
    return { runs, warnings: unique(warnings) }
  }
}
