import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from './clock.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_REPLAY_DAYS = 730; // safety cap (~2 years) per catch-up

/**
 * Drives the "what would have happened" simulation for test orgs.
 *
 * Day-granular engines (recurring spawn, workflow date-triggers) are replayed
 * once per simulated day between the last replayed point and the org's current
 * simulated time. Deadline-based engines (reminders, escalations, ticket SLA,
 * workflow overdue) are monotonic, so they run once at the final instant.
 */
@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly scheduler: SchedulerService,
    private readonly workflow: WorkflowEngineService,
    private readonly tickets: TicketsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every 5 minutes, advance every actively-simulated test org. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tickAllTestOrgs() {
    const orgs = await this.prisma.organization.findMany({
      where: { is_test: true, sim_epoch: { not: null } },
      select: { id: true },
    });
    for (const org of orgs) {
      await this.catchUp(org.id).catch((err) =>
        this.logger.error(`Replay tick failed for org ${org.id}: ${err}`),
      );
    }
  }

  /** Replay all time-sensitive engines for one org up to its current simulated time. */
  async catchUp(orgId: string): Promise<{ daysReplayed: number; to: string } | null> {
    if (this.inFlight.has(orgId)) return null; // a run is already in progress
    this.inFlight.add(orgId);
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { is_test: true, sim_epoch: true, sim_anchor: true, sim_replayed_until: true },
      });
      if (!org || !org.is_test || !org.sim_epoch) return null;

      const to = this.clock.nowFor(org);
      const lastDay = startOfDay(to);

      // Day-granular replay: start the day after the last replayed day, or at the
      // epoch day itself on the first run (so the epoch day fires immediately).
      const cursor = org.sim_replayed_until
        ? nextDay(startOfDay(org.sim_replayed_until))
        : startOfDay(org.sim_epoch);

      let daysReplayed = 0;
      while (cursor <= lastDay && daysReplayed < MAX_REPLAY_DAYS) {
        const dayInstant = endOfDay(cursor);
        await this.scheduler.spawnRecurringForOrg(orgId, dayInstant);
        await this.scheduler.spawnDemandedLogsForOrg(orgId, dayInstant);
        // Rhythms replay day-of (horizon 0): each simulated day materialises only its
        // own occurrence, mirroring how recurring tasks replay one day at a time.
        await this.scheduler.spawnMeetingRhythmsForOrg(orgId, dayInstant, 0);
        await this.workflow.processSchedulesForOrg(orgId, dayInstant);
        // Waiting workflow steps start on their own simulated day (not all at the end).
        await this.workflow.processWaitingStepsForOrg(orgId, dayInstant);
        cursor.setDate(cursor.getDate() + 1);
        daysReplayed++;
      }
      if (daysReplayed >= MAX_REPLAY_DAYS) {
        this.logger.warn(`Replay for org ${orgId} hit the ${MAX_REPLAY_DAYS}-day cap; remaining days deferred to next run`);
      }

      // Deadline-based engines: run once at the final simulated instant.
      await this.scheduler.processRemindersForOrg(orgId, to);
      await this.scheduler.processMeetingRemindersForOrg(orgId, to);
      await this.scheduler.processEscalationsForOrg(orgId, to);
      await this.workflow.processOverdueStepsForOrg(orgId, to);
      await this.tickets.processSlaForOrg(orgId, to);
      await this.notifications.processOverdueNotificationsForOrg(orgId, to);
      await this.scheduler.detectTaskOverdueForOrg(orgId, to);
      await this.scheduler.processGoalCheckInsForOrg(orgId, to);

      await this.prisma.organization.update({
        where: { id: orgId },
        data: { sim_replayed_until: to },
      });

      if (daysReplayed > 0) {
        this.logger.log(`Replayed ${daysReplayed} day(s) for org ${orgId} up to ${to.toISOString()}`);
      }
      return { daysReplayed, to: to.toISOString() };
    } finally {
      this.inFlight.delete(orgId);
    }
  }
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function nextDay(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return x;
}
