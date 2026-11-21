import { Prisma } from '@prisma/client';
import { PrismaBaseService } from './prisma-base.service';
import { AuditContextService, AuditBufferEntry } from '../common/cls/audit-context.service';
import {
  auditConfigFor,
  GLOBAL_IGNORE_FIELDS,
  ModelAuditConfig,
} from '../audit/auditable-models';
import { swallow } from '../common/swallow';

/** Per-bulk-op row cap — beyond this we log one summary entry, not per-row. */
const BULK_ROW_CAP = 200;

const camel = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

function isScalar(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    typeof v === 'bigint' ||
    v instanceof Date
  );
}

function toJsonSafe(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v ?? null;
}

function normalizeForCompare(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function ignored(field: string, cfg: ModelAuditConfig): boolean {
  return GLOBAL_IGNORE_FIELDS.has(field) || (cfg.ignoreFields?.includes(field) ?? false);
}

function labelFor(row: Record<string, any> | null, cfg: ModelAuditConfig): string | null {
  if (!row) return null;
  for (const f of cfg.labelFields) {
    if (row[f] != null && row[f] !== '') return String(row[f]);
  }
  return null;
}

/** Build a {field:{before,after}} diff over scalar fields that actually changed. */
function buildDiff(
  before: Record<string, any>,
  after: Record<string, any>,
  cfg: ModelAuditConfig,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (ignored(k, cfg)) continue;
    if (!isScalar(before?.[k]) && !isScalar(after?.[k])) continue;
    if (normalizeForCompare(before?.[k]) !== normalizeForCompare(after?.[k])) {
      changes[k] = { before: toJsonSafe(before?.[k]), after: toJsonSafe(after?.[k]) };
    }
  }
  return changes;
}

/** Snapshot scalar fields as before-only (delete) or after-only (create). */
function snapshot(
  row: Record<string, any>,
  cfg: ModelAuditConfig,
  side: 'before' | 'after',
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, v] of Object.entries(row)) {
    if (ignored(k, cfg)) continue;
    if (!isScalar(v)) continue;
    if (v === null || v === '') continue; // no point recording an absent value
    changes[k] = side === 'after' ? { before: null, after: toJsonSafe(v) } : { before: toJsonSafe(v), after: null };
  }
  return changes;
}

/**
 * Prisma client extension that captures every create/update/delete (and their
 * bulk variants) on auditable models into the request/run-scoped audit buffer.
 * Uses the BASE client for prior-row reads so it never re-enters itself.
 *
 * Writes are buffered (never inline) and flushed by AuditWriterService after the
 * response — audit capture must never slow or fail the originating mutation.
 */
export function auditExtension(base: PrismaBaseService, ctx: AuditContextService) {
  const buffer = (entry: Omit<AuditBufferEntry, keyof SystemSeed> & Partial<SystemSeed>) => {
    const orgId = entry.organization_id;
    if (!orgId) return;
    ctx.push({
      organization_id: orgId,
      actor_user_id: ctx.actorType === 'system' ? null : ctx.actorId,
      actor_type: ctx.actorType,
      action: entry.action,
      resource: entry.resource,
      entity_id: entry.entity_id,
      entity_type: entry.entity_type ?? null,
      entity_label: entry.entity_label ?? null,
      changes: entry.changes ?? null,
      trigger_source: ctx.triggerSource,
      trigger_context: ctx.triggerContext,
      occurred_at: ctx.occurredAt ?? new Date(),
      request_id: ctx.requestId,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    });
  };

  return Prisma.defineExtension({
    name: 'audit-capture',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result: any = await query(args);
          try {
            if (!ctx.isActive) return result;
            const cfg = auditConfigFor(model);
            if (!cfg || !result?.id) return result;
            const orgId = ctx.orgId ?? result.organization_id;
            if (!orgId || ctx.isHandled(cfg.resource, result.id)) return result;
            const changes = snapshot(result, cfg, 'after');
            buffer({
              organization_id: orgId,
              action: 'create',
              resource: cfg.resource,
              entity_id: result.id,
              entity_type: model,
              entity_label: labelFor(result, cfg),
              changes: Object.keys(changes).length ? changes : null,
            });
          } catch (err) {
            swallow('audit.capture')(err);
          }
          return result;
        },

        async update({ model, args, query }) {
          const cfg = auditConfigFor(model);
          let before: any = null;
          if (cfg && ctx.isActive) {
            before = await (base as any)[camel(model)].findUnique({ where: (args as any).where }).catch(swallow('audit.captureBefore', null));
          }
          const result: any = await query(args);
          try {
            if (!cfg || !ctx.isActive || !result?.id) return result;
            const orgId = ctx.orgId ?? result.organization_id;
            if (!orgId || ctx.isHandled(cfg.resource, result.id)) return result;
            const changes = before ? buildDiff(before, result, cfg) : {};
            if (!Object.keys(changes).length) return result;
            buffer({
              organization_id: orgId,
              action: 'update',
              resource: cfg.resource,
              entity_id: result.id,
              entity_type: model,
              entity_label: labelFor(result, cfg) ?? labelFor(before, cfg),
              changes,
            });
          } catch (err) {
            swallow('audit.capture')(err);
          }
          return result;
        },

        async delete({ model, args, query }) {
          const cfg = auditConfigFor(model);
          let before: any = null;
          if (cfg && ctx.isActive) {
            before = await (base as any)[camel(model)].findUnique({ where: (args as any).where }).catch(swallow('audit.captureBefore', null));
          }
          const result: any = await query(args);
          try {
            if (!cfg || !ctx.isActive) return result;
            const row = before ?? result;
            if (!row?.id) return result;
            const orgId = ctx.orgId ?? row.organization_id;
            if (!orgId || ctx.isHandled(cfg.resource, row.id)) return result;
            buffer({
              organization_id: orgId,
              action: 'delete',
              resource: cfg.resource,
              entity_id: row.id,
              entity_type: model,
              entity_label: labelFor(row, cfg),
              changes: snapshot(row, cfg, 'before'),
            });
          } catch (err) {
            swallow('audit.capture')(err);
          }
          return result;
        },

        async updateMany({ model, args, query }) {
          const cfg = auditConfigFor(model);
          let rows: any[] = [];
          if (cfg && ctx.isActive) {
            rows = await (base as any)[camel(model)]
              .findMany({ where: (args as any).where, take: BULK_ROW_CAP + 1 })
              .catch(() => []);
          }
          const result = await query(args);
          try {
            if (!cfg || !ctx.isActive || !rows.length) return result;
            const data = ((args as any).data ?? {}) as Record<string, any>;
            captureBulk(model, cfg, rows, 'update', data, ctx, buffer);
          } catch (err) {
            swallow('audit.capture')(err);
          }
          return result;
        },

        async deleteMany({ model, args, query }) {
          const cfg = auditConfigFor(model);
          let rows: any[] = [];
          if (cfg && ctx.isActive) {
            rows = await (base as any)[camel(model)]
              .findMany({ where: (args as any).where, take: BULK_ROW_CAP + 1 })
              .catch(() => []);
          }
          const result = await query(args);
          try {
            if (!cfg || !ctx.isActive || !rows.length) return result;
            captureBulk(model, cfg, rows, 'delete', null, ctx, buffer);
          } catch (err) {
            swallow('audit.capture')(err);
          }
          return result;
        },
      },
    },
  });
}

type SystemSeed = Pick<
  AuditBufferEntry,
  'actor_user_id' | 'actor_type' | 'trigger_source' | 'trigger_context' | 'occurred_at' | 'request_id' | 'ip' | 'user_agent'
>;

function captureBulk(
  model: string,
  cfg: ModelAuditConfig,
  rows: any[],
  kind: 'update' | 'delete',
  data: Record<string, any> | null,
  ctx: AuditContextService,
  buffer: (e: any) => void,
) {
  const orgId = ctx.orgId ?? rows[0]?.organization_id;
  if (!orgId) return;

  // Too many rows — emit one summary entry rather than flooding the log.
  if (rows.length > BULK_ROW_CAP) {
    buffer({
      organization_id: orgId,
      action: kind === 'delete' ? 'delete' : 'update',
      resource: cfg.resource,
      entity_id: '*',
      entity_type: model,
      entity_label: `${rows.length}+ ${cfg.resource} rows`,
      changes: { _bulk: { before: null, after: `${rows.length}+ rows affected` } },
    });
    return;
  }

  for (const row of rows) {
    if (!row?.id || ctx.isHandled(cfg.resource, row.id)) continue;
    let changes: Record<string, { before: unknown; after: unknown }> = {};
    if (kind === 'delete') {
      changes = snapshot(row, cfg, 'before');
    } else if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (GLOBAL_IGNORE_FIELDS.has(k) || (cfg.ignoreFields?.includes(k) ?? false)) continue;
        if (!isScalar(v)) continue;
        if (normalizeForCompare(row[k]) !== normalizeForCompare(v)) {
          changes[k] = { before: toJsonSafe(row[k]), after: toJsonSafe(v) };
        }
      }
    }
    if (kind === 'update' && !Object.keys(changes).length) continue;
    buffer({
      organization_id: orgId,
      action: kind,
      resource: cfg.resource,
      entity_id: row.id,
      entity_type: model,
      entity_label: labelFor(row, cfg),
      changes,
    });
  }
}
