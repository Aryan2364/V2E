import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ClockFields {
  is_test: boolean;
  sim_epoch: Date | null;
  sim_anchor: Date | null;
}

/**
 * Per-organization simulated clock.
 *
 * Real (non-test) orgs always get the wall clock. Test orgs with a sim_epoch set
 * get a *ticking* simulated time: simEpoch + (realNow - simAnchor). This is the
 * single source of truth for "what time is it for this org".
 */
@Injectable()
export class ClockService {
  private readonly logger = new Logger(ClockService.name);
  private readonly cache = new Map<string, { value: ClockFields; expires: number }>();
  private readonly TTL_MS = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Compute the effective "now" for an org whose clock fields are already loaded. */
  nowFor(org: ClockFields): Date {
    if (org.is_test && org.sim_epoch && org.sim_anchor) {
      return new Date(org.sim_epoch.getTime() + (Date.now() - org.sim_anchor.getTime()));
    }
    return new Date();
  }

  /** Effective "now" for an org by id (cached). No orgId ⇒ real time. */
  async now(orgId?: string): Promise<Date> {
    if (!orgId) return new Date();
    return this.nowFor(await this.getFields(orgId));
  }

  private async getFields(orgId: string): Promise<ClockFields> {
    const cached = this.cache.get(orgId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { is_test: true, sim_epoch: true, sim_anchor: true },
    });
    const value: ClockFields = org ?? { is_test: false, sim_epoch: null, sim_anchor: null };
    this.cache.set(orgId, { value, expires: Date.now() + this.TTL_MS });
    return value;
  }

  invalidate(orgId: string) {
    this.cache.delete(orgId);
  }

  /** Full clock state for the API / UI. */
  async getState(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { is_test: true, sim_epoch: true, sim_anchor: true, sim_replayed_until: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return {
      is_test: org.is_test,
      ticking: !!(org.is_test && org.sim_epoch && org.sim_anchor),
      simulated_now: this.nowFor(org).toISOString(),
      real_now: new Date().toISOString(),
      sim_epoch: org.sim_epoch?.toISOString() ?? null,
      sim_anchor: org.sim_anchor?.toISOString() ?? null,
      sim_replayed_until: org.sim_replayed_until?.toISOString() ?? null,
    };
  }

  /** Set (or jump) the simulated clock. Test orgs only. */
  async setClock(orgId: string, datetime: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { is_test: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.is_test) {
      throw new BadRequestException('The simulated clock can only be set for test organizations');
    }

    const epoch = new Date(datetime);
    if (isNaN(epoch.getTime())) throw new BadRequestException('Invalid datetime');

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { sim_epoch: epoch, sim_anchor: new Date() },
    });
    this.invalidate(orgId);
    this.logger.log(`Sim clock for org ${orgId} set to ${epoch.toISOString()}`);
    return this.getState(orgId);
  }

  /** Clear the simulation — back to real time. */
  async resetClock(orgId: string) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { sim_epoch: null, sim_anchor: null, sim_replayed_until: null },
    });
    this.invalidate(orgId);
    this.logger.log(`Sim clock for org ${orgId} reset to real time`);
    return this.getState(orgId);
  }
}
