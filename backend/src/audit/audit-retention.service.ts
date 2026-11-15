import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaBaseService } from '../prisma/prisma-base.service';
import { ClockService } from '../clock/clock.service';
import { runExclusive } from '../common/run-exclusive';

/**
 * Operational retention: nightly batched delete of audit entries older than the
 * retention window. Per-org cutoff is keyed off the (possibly simulated) clock so
 * replays in test orgs aren't pruned prematurely.
 *
 * Phase 6 (deferred) will make audit_logs append-only/tamper-evident; until then
 * this is a plain operational sweep.
 */
@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);
  private readonly RETENTION_DAYS = Number(process.env['AUDIT_RETENTION_DAYS'] ?? 365);
  private readonly BATCH = 5_000;

  constructor(
    private readonly base: PrismaBaseService,
    private readonly clock: ClockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async prune(): Promise<void> {
    return runExclusive('AuditRetentionService.prune', async () => {
    const orgs = await this.base.organization.findMany({ select: { id: true } });
    let totalDeleted = 0;
    for (const { id: orgId } of orgs) {
      const now = await this.clock.now(orgId);
      const cutoff = new Date(now.getTime() - this.RETENTION_DAYS * 24 * 60 * 60 * 1000);
      let deleted = 0;
      // Batched delete so a large backlog doesn't lock the table.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await this.base.auditLog.findMany({
          where: { organization_id: orgId, created_at: { lt: cutoff } },
          select: { id: true },
          take: this.BATCH,
        });
        if (!batch.length) break;
        const res = await this.base.auditLog.deleteMany({
          where: { id: { in: batch.map((b) => b.id) } },
        });
        deleted += res.count;
        if (batch.length < this.BATCH) break;
      }
      totalDeleted += deleted;
    }
    if (totalDeleted) this.logger.log(`Audit retention pruned ${totalDeleted} entries`);
    });
  }
}
