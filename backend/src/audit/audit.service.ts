import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService, ActorType } from '../common/cls/audit-context.service';
import { AuditEnrichmentService } from './audit-enrichment.service';
import {
  AUDIT_MODULES,
  MAPPED_RESOURCES,
  OTHER_MODULE_KEY,
  resourcesForModule,
  humanizeResource,
  type AuditResourceFacet,
} from './auditable-models';
import { clampTake } from '../common/pagination';

export type AuditAction = string; // create | update | delete | <semantic verb>

export interface AuditChange {
  before: unknown;
  after: unknown;
}

export interface RecordAuditInput {
  orgId?: string;
  actorId?: string | null;
  actorType?: ActorType;
  action: AuditAction;
  resource: string;
  entityId: string;
  entityType?: string | null;
  entityLabel?: string | null;
  changes?: Record<string, AuditChange> | null;
  triggerSource?: string | null;
  triggerContext?: Record<string, unknown> | null;
  occurredAt?: Date;
}

export interface AuditListFilters {
  /** Specific entity type (e.g. `task_status`). Wins over `module`. */
  resource?: string;
  /** Module key (e.g. `tasks`) — expands to all its resource keys. */
  module?: string;
  entity_id?: string;
  action?: string;
  actor_user_id?: string;
  actor_type?: string;
  trigger_source?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
  skip?: number;
  take?: number;
}

/**
 * Shared, software-wide audit log. The single source of truth for "who (or what)
 * changed this, when, and from what to what". Most writes arrive automatically
 * via the Prisma capture extension; modules call `record()` / `recordTransition()`
 * for high-value events that deserve a human action name and de-dupe.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: AuditContextService,
    private readonly enrichment: AuditEnrichmentService,
  ) {}

  /** Emit a semantic audit entry; de-dupes the automatic extension for this entity. */
  async record(input: RecordAuditInput): Promise<void> {
    const orgId = input.orgId ?? this.ctx.orgId;
    if (!orgId) return; // nothing to scope the entry to
    const actorType = input.actorType ?? this.ctx.actorType;
    const actorId = input.actorId !== undefined ? input.actorId : this.ctx.actorId;

    // Suppress the automatic extension entry for this same entity (no double-log).
    this.ctx.markHandled(input.resource, input.entityId);

    await this.prisma.auditLog.create({
      data: {
        organization_id: orgId,
        actor_user_id: actorType === 'system' ? null : actorId ?? null,
        actor_type: actorType,
        action: input.action,
        resource: input.resource,
        entity_id: input.entityId,
        entity_type: input.entityType ?? null,
        entity_label: input.entityLabel ?? null,
        changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        trigger_source: input.triggerSource ?? this.ctx.triggerSource,
        trigger_context: (input.triggerContext ?? this.ctx.triggerContext ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        occurred_at: input.occurredAt ?? this.ctx.occurredAt ?? new Date(),
        request_id: this.ctx.requestId,
        ip: this.ctx.ip,
        user_agent: this.ctx.userAgent,
      },
    });
  }

  /**
   * Convenience for status/state changes that deserve a human verb
   * (e.g. action "Marked overdue", field "status": ongoing → overdue).
   */
  async recordTransition(input: {
    orgId?: string;
    action: string;
    resource: string;
    entityId: string;
    entityType?: string | null;
    entityLabel?: string | null;
    field?: string;
    from: unknown;
    to: unknown;
    actorType?: ActorType;
    actorId?: string | null;
    triggerSource?: string | null;
    triggerContext?: Record<string, unknown> | null;
    occurredAt?: Date;
  }): Promise<void> {
    const field = input.field ?? 'status';
    await this.record({
      orgId: input.orgId,
      action: input.action,
      resource: input.resource,
      entityId: input.entityId,
      entityType: input.entityType,
      entityLabel: input.entityLabel,
      actorType: input.actorType,
      actorId: input.actorId,
      triggerSource: input.triggerSource,
      triggerContext: input.triggerContext,
      occurredAt: input.occurredAt,
      changes: { [field]: { before: input.from, after: input.to } },
    });
  }

  /**
   * Build a { field: { before, after } } diff for the changed fields only.
   * Dates are compared by ISO value so equal timestamps don't register a change.
   */
  diff<T extends Record<string, any>>(
    before: T,
    after: Partial<T>,
    fields: (keyof T)[],
  ): Record<string, AuditChange> | null {
    const changes: Record<string, AuditChange> = {};
    for (const f of fields) {
      if (!(f in after)) continue;
      const b = normalize(before[f]);
      const a = normalize(after[f]);
      if (b !== a) {
        changes[f as string] = { before: before[f] ?? null, after: after[f] ?? null };
      }
    }
    return Object.keys(changes).length ? changes : null;
  }

  async list(orgId: string, filters: AuditListFilters = {}) {
    const where: Prisma.AuditLogWhereInput = { organization_id: orgId };
    if (filters.resource) {
      where.resource = filters.resource;
    } else if (filters.module) {
      // A module spans several resource keys; the Other bucket is "everything unmapped".
      where.resource =
        filters.module === OTHER_MODULE_KEY
          ? { notIn: MAPPED_RESOURCES }
          : { in: resourcesForModule(filters.module) };
    }
    if (filters.entity_id) where.entity_id = filters.entity_id;
    if (filters.action) where.action = filters.action;
    if (filters.actor_user_id) where.actor_user_id = filters.actor_user_id;
    if (filters.actor_type) where.actor_type = filters.actor_type;
    if (filters.trigger_source) where.trigger_source = filters.trigger_source;
    if (filters.from_date || filters.to_date) {
      where.occurred_at = {};
      if (filters.from_date) where.occurred_at.gte = new Date(filters.from_date);
      if (filters.to_date) where.occurred_at.lte = new Date(filters.to_date);
    }
    if (filters.search) {
      where.OR = [
        { entity_label: { contains: filters.search, mode: 'insensitive' } },
        { entity_id: { contains: filters.search, mode: 'insensitive' } },
        { action: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const take = clampTake(filters.take, 100, 200);
    const skip = filters.skip ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        // Business time first; physical write time breaks ties so ordering and
        // pagination stay deterministic even when a test org's clock has jumped
        // around (many rows can share an occurred_at, or land out of write order).
        orderBy: [{ occurred_at: 'desc' }, { created_at: 'desc' }],
        skip,
        take,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const enriched = await this.enrichment.enrich(items as any[]);
    return { items: enriched, total, skip, take };
  }

  /** Distinct resource keys present for an org. */
  async resources(orgId: string): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { organization_id: orgId },
      distinct: ['resource'],
      select: { resource: true },
      orderBy: { resource: 'asc' },
    });
    return rows.map((r) => r.resource);
  }

  /**
   * The full module taxonomy, grouped (Module → Type), driving the two-tier
   * filter. All canonical modules are always returned so the dropdown shows the
   * complete auditable scope, not just modules that happen to have activity.
   * Any present-but-unmapped resource is collected into a dynamic "Other" bucket.
   */
  async resourceModules(orgId: string): Promise<
    { key: string; label: string; resources: AuditResourceFacet[] }[]
  > {
    const modules: { key: string; label: string; resources: AuditResourceFacet[] }[] =
      AUDIT_MODULES.map((m) => ({ key: m.key, label: m.label, resources: m.resources }));

    const present = await this.resources(orgId);
    const mapped = new Set(MAPPED_RESOURCES);
    const other = present.filter((r) => !mapped.has(r)).sort();
    if (other.length) {
      modules.push({
        key: OTHER_MODULE_KEY,
        label: 'Other',
        resources: other.map((r) => ({ key: r, label: humanizeResource(r) })),
      });
    }
    return modules;
  }

  /** Distinct trigger sources for system entries — drives the trigger filter. */
  async triggerSources(orgId: string): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { organization_id: orgId, trigger_source: { not: null } },
      distinct: ['trigger_source'],
      select: { trigger_source: true },
      orderBy: { trigger_source: 'asc' },
    });
    return rows.map((r) => r.trigger_source!).filter(Boolean);
  }
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}
